import { achievements as defaultAchievements, maxChallengeCouponsPerDay as defaultCap } from '../content';
import { isAllOf, isAnyOf, isCondition, type Achievement, type Trigger } from '../content/types';
import { contentRewardSource, createCoupon, isExpired, selectReward, type RewardSource, type Rng } from './coupons';
import { evalTrigger } from './trigger';
import { DAY_MS, type Coupon, type Grant, type Progress, type SkippedAchievement, type StatSnapshot } from './types';

/**
 * Per-game статы — сбрасываются с новой партией и восстанавливаются «как есть» при резюме
 * (CurrentGameStats). Для заданий с таким триггером выдача — по ПЕРЕСЕЧЕНИЮ порога ходом
 * (edge), а не по факту «уже ≥ порога» (level): иначе резюм партии с уже высокой плиткой
 * выдаёт веху на первом же свайпе. Кумулятивные/глобальные статы (totalScore/gamesPlayed/
 * dailyStreak/rewardsRedeemed) остаются level — они меняются ВНЕ хода (напр. стрик), и edge
 * их бы сломал (перехода в пределах одного хода у них нет).
 */
const PER_GAME_STATS = new Set([
  // 2048
  'maxTileThisGame',
  'sessionScore',
  'movesThisGame',
  'timeToCurrentMaxTileSec',
  // match3 (Фаза B) — сбрасываются с партией, восстанавливаются при резюме; edge-гейт не даёт
  // уронить купон на первом свопе резюма партии с уже высоким счётом/комбо.
  'm3_score',
  'm3_combo',
  'm3_moves',
  'm3_biggestClear',
]);

function triggerUsesPerGameStat(trigger: Trigger): boolean {
  if (isCondition(trigger)) return PER_GAME_STATS.has(trigger.stat);
  if (isAllOf(trigger)) return trigger.allOf.some(triggerUsesPerGameStat);
  if (isAnyOf(trigger)) return trigger.anyOf.some(triggerUsesPerGameStat);
  return false;
}

export interface EvaluateParams {
  snapshot: StatSnapshot;
  /**
   * Снапшот ДО хода (опционально). Для заданий с per-game триггером купон выдаём только при
   * ПЕРЕСЕЧЕНИИ порога этим ходом: если триггер уже выполнялся на prevSnapshot — пропускаем
   * (резюм партии не должен ретро-выдавать веху на первом свайпе). Не передан — поведение level.
   */
  prevSnapshot?: StatSnapshot;
  progress: Progress;
  /** Активные купоны — для «pending» (живой купон → не дублируем) и разнообразия наград. */
  wallet: Coupon[];
  /** Текущее время (epoch ms) — инъектируется ради детерминизма. */
  now: number;
  /** Локальная дата YYYY-MM-DD «сегодня» — для дневного потолка/сброса в полночь. */
  today: string;
  /**
   * Активная игра хаба (DESIGN-HUB §3). Берём ачивки, где `(a.game ?? '2048') === gameId`
   * ИЛИ `a.game === 'any'`. По умолчанию '2048' — untagged конфиг и старые вызовы целы.
   */
  gameId?: string;
  rng?: Rng;
  achievementsList?: Achievement[];
  maxChallengeCouponsPerDay?: number;
  rewardSource?: RewardSource;
}

export interface EvaluateResult {
  grants: Grant[];
  progress: Progress;
  skipped: SkippedAchievement[];
}

/**
 * Прогон всех ачивок по snapshot. ЕДИНЫЙ жизненный цикл заданий (DESIGN §15):
 *  - задание не выдаётся, если оно `completed` (купон уже использован) — навсегда;
 *  - задание не выдаётся, если в кошельке уже есть его ЖИВОЙ купон (pending);
 *  - per-game вехи (maxTileThisGame/sessionScore/...) выдаются только при ПЕРЕСЕЧЕНИИ порога
 *    этим ходом (см. prevSnapshot) — резюм партии не ретро-выдаёт их на первом свайпе;
 *  - иначе при выполнении триггера выдаём купон (и milestone, и challenge);
 *  - challenge дополнительно ограничен cooldownDays и дневным потолком купонов
 *    (maxChallengeCouponsPerDay, счётчик в progress, сброс в локальную полночь).
 *    Достигнут потолок → НЕ выдаём и НЕ ставим на кулдаун (доступно, когда сбросится).
 * Сгорание купона прогресс не трогает → задание снова станет доступным.
 * Разнообразие: случайный купон не повторяет награду, уже лежащую в кошельке.
 */
export function evaluateAchievements({
  snapshot,
  prevSnapshot,
  progress,
  wallet,
  now,
  today,
  gameId = '2048',
  rng = Math.random,
  achievementsList = defaultAchievements,
  maxChallengeCouponsPerDay = defaultCap,
  rewardSource = contentRewardSource,
}: EvaluateParams): EvaluateResult {
  // Сброс дневного счётчика в полночь (смена локальной даты).
  const dayRollover = progress.couponDayDate !== today;
  const completed = new Set(progress.completed);
  const cooldowns: Record<string, number> = { ...progress.challengeCooldowns };
  let challengeCouponsToday = dayRollover ? 0 : progress.challengeCouponsToday;

  // Живые купоны: какие задания «pending» и какие награды уже на руках (для разнообразия).
  const live = wallet.filter((c) => !isExpired(c, now));
  const pendingAchievementIds = new Set(live.map((c) => c.achievementId));
  const liveRewardIds = new Set(live.map((c) => c.rewardId));

  const grants: Grant[] = [];
  const skipped: SkippedAchievement[] = [];

  // Фильтр по игре (DESIGN-HUB §3): только задания активной игры (+ кросс-игровые 'any').
  const forThisGame = achievementsList.filter((a) => (a.game ?? '2048') === gameId || a.game === 'any');

  for (const achievement of forThisGame) {
    if (!evalTrigger(achievement.trigger, snapshot)) {
      skipped.push({ id: achievement.id, reason: 'notTriggered' });
      continue;
    }
    // Edge-triggering per-game вех: порог должен быть пересечён ИМЕННО этим ходом. Если он
    // уже выполнялся ДО хода (напр. резюм партии с высокой плиткой) — не ретро-выдаём купон.
    if (
      prevSnapshot &&
      triggerUsesPerGameStat(achievement.trigger) &&
      evalTrigger(achievement.trigger, prevSnapshot)
    ) {
      skipped.push({ id: achievement.id, reason: 'alreadyCrossed' });
      continue;
    }
    if (completed.has(achievement.id)) {
      skipped.push({ id: achievement.id, reason: 'completed' });
      continue;
    }
    if (pendingAchievementIds.has(achievement.id)) {
      skipped.push({ id: achievement.id, reason: 'pending' });
      continue;
    }

    if (achievement.type === 'challenge') {
      const cooldownUntil = cooldowns[achievement.id];
      if (cooldownUntil !== undefined && now < cooldownUntil) {
        skipped.push({ id: achievement.id, reason: 'cooldown' });
        continue;
      }
      if (challengeCouponsToday >= maxChallengeCouponsPerDay) {
        skipped.push({ id: achievement.id, reason: 'dailyCap' });
        continue;
      }
      cooldowns[achievement.id] = now + (achievement.cooldownDays ?? 0) * DAY_MS;
      challengeCouponsToday += 1;
    }

    const reward = selectReward(achievement, rng, rewardSource, liveRewardIds);
    const coupon = createCoupon({ achievement, reward, now, seq: grants.length, source: rewardSource });
    grants.push({ achievement, reward, coupon });
    // Свежий купон тоже «занимает» задание и награду в рамках этого прогона.
    pendingAchievementIds.add(achievement.id);
    liveRewardIds.add(reward.id);
  }

  const nextProgress: Progress = {
    ...progress,
    challengeCooldowns: cooldowns,
    challengeCouponsToday,
    couponDayDate: today,
  };

  return { grants, progress: nextProgress, skipped };
}
