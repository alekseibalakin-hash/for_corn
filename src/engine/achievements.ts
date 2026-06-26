import { achievements as defaultAchievements, maxChallengeCouponsPerDay as defaultCap, maxEasyPerDayTotal as defaultEasyTotal, maxEasyPerGamePerDay as defaultEasyPerGame } from '../content';
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
  // «Блоки-фигуры» (Фаза 2) — сбрасываются с уровнем, восстанавливаются при резюме; edge-гейт не даёт
  // уронить купон на первом размещении при резюме уровня с уже высоким счётом/линиями.
  'bb_score',
  'bb_lines',
  'bb_moves',
  // Flow «Соедини фигурки» — сбрасываются с уровнем, восстанавливаются при резюме; edge-гейт не даёт
  // уронить купон при первом ходе после резюма уровня с уже высоким счётом/ходами (§2.1 flow-phase2).
  'fl_score',
  'fl_moves',
]);

// Кумулятивные МОНОТОННЫЕ статы-вехи с чётким переходом ВНУТРИ хода (prevSnapshot несёт старое
// значение, напр. глубина бампится на победе ПЕРЕД grant) — тоже edge-гейтим: веха срабатывает
// РОВНО на ходе пересечения порога и НЕ перевыдаётся на резюме/новом заходе. Фикс прод-бага: веха
// глубины m3_maxSpicyLevel (ужин «вершина перчинки») выпадала на КАЖДОМ заходе после первого хода,
// т.к. держалась ТОЛЬКО на pending, а просроченный/несошедшийся купон pending не закрывал.
// (dailyStreak/rewardsRedeemed сюда НЕ входят — они меняются ВНЕ хода, edge их бы сломал.)
const EDGE_MONOTONIC_STATS = new Set([
  'm3_maxSpicyLevel', // глубина «с перчинкой» (ужин-вершина) — прод-баг, ради которого это и завели
  // «5 букв»: тот же класс (монотонные, единственный grant в useWordle с prevSnapshot) — закрываем
  // превентивно, чтобы w5-вехи не перевыдавались на game-end после порога при сошедшем/просроченном купоне.
  'w5_dailyWins', // всего побед (welcome/5/20)
  'w5_maxDailyStreak', // серия слова дня (3/7)
  'w5_bestGuess', // лучшая попытка (≤3)
  // «Блоки-фигуры»: глубина bb_maxLevel — ТОТ ЖЕ класс, что m3_maxSpicyLevel. Без edge-гейта веха-
  // награда глубины выпадала бы на КАЖДОМ заходе (прод-баг v18 «ужин каждый заход»: level-веха без
  // edge держится только на pending, а просроченный купон pending не ловит). Встроено С НАЧАЛА (§2.1).
  'bb_maxLevel',
  // Flow «Соедини фигурки»: тот же класс — монотонная глубина, единственный grant-сайт на победе
  // уровня с prevSnapshot. Без edge-гейта веха-награда выпадала бы на каждом заходе (§2.1 flow-phase2).
  'fl_maxLevel',
  // Фаза 2.5: звёздные счётчики — монотонные кумулятивные, edge-гейт предотвращает перевыдачу
  // при заходе (тот же класс, что fl_maxLevel и m3_maxSpicyLevel).
  'fl_totalStars',
  'fl_perfectCount',
]);

function triggerUsesEdgeStat(trigger: Trigger): boolean {
  if (isCondition(trigger)) return PER_GAME_STATS.has(trigger.stat) || EDGE_MONOTONIC_STATS.has(trigger.stat);
  if (isAllOf(trigger)) return trigger.allOf.some(triggerUsesEdgeStat);
  if (isAnyOf(trigger)) return trigger.anyOf.some(triggerUsesEdgeStat);
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
  /** @deprecated Больше не используется движком. Оставлен ради обратной совместимости call-sites. */
  maxChallengeCouponsPerDay?: number;
  /** Капируемые купоны (любой тир без rewardId): потолок на игру в сутки. */
  maxEasyPerGamePerDay?: number;
  /** Капируемые купоны: потолок по всему хабу в сутки. */
  maxEasyPerDayTotal?: number;
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
/**
 * Капируемый купон = любой тир БЕЗ фиксированного rewardId (п.0.5).
 * Именные (rewardId: restaurant / fine-dining) освобождены от лимита — они редкие вершины.
 * Large без rewardId теперь тоже капируется: иначе 14 large-вех шли мимо лимита.
 */
function isCappedCoupon(a: Achievement): boolean {
  return !a.rewardId;
}

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
  // maxChallengeCouponsPerDay сохранён в сигнатуре ради обратной совместимости, но не используется.
  maxChallengeCouponsPerDay: _maxChallengeCouponsPerDay = defaultCap,
  maxEasyPerGamePerDay = defaultEasyPerGame,
  maxEasyPerDayTotal = defaultEasyTotal,
  rewardSource = contentRewardSource,
}: EvaluateParams): EvaluateResult {
  // Сброс дневных счётчиков в полночь (смена локальной даты).
  const dayRollover = progress.couponDayDate !== today;
  const completed = new Set(progress.completed);
  const cooldowns: Record<string, number> = { ...progress.challengeCooldowns };
  let easyCouponsTotalToday = dayRollover ? 0 : (progress.easyCouponsTotalToday ?? 0);
  const easyCouponsByGameToday: Record<string, number> = dayRollover ? {} : { ...(progress.easyCouponsByGameToday ?? {}) };

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
    // Edge-triggering вех: порог должен быть пересечён ИМЕННО этим ходом. Если он уже выполнялся ДО
    // хода (резюм партии с высокой плиткой / новый заход с уже достигнутой глубиной) — не ретро-выдаём.
    if (
      prevSnapshot &&
      triggerUsesEdgeStat(achievement.trigger) &&
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
    // Именная награда: если купон с тем же rewardId уже живёт в кошельке — не дублируем.
    // Перевыдастся после погашения или сгорания (DESIGN §15).
    if (achievement.rewardId && liveRewardIds.has(achievement.rewardId)) {
      skipped.push({ id: achievement.id, reason: 'pending' });
      continue;
    }

    if (achievement.type === 'challenge') {
      const cooldownUntil = cooldowns[achievement.id];
      if (cooldownUntil !== undefined && now < cooldownUntil) {
        skipped.push({ id: achievement.id, reason: 'cooldown' });
        continue;
      }
    }

    // Двухуровневый лимит капируемых купонов: per-game И hub-total. Капнутый — НЕ идёт на кулдаун.
    if (isCappedCoupon(achievement)) {
      const gameCount = easyCouponsByGameToday[gameId] ?? 0;
      if (gameCount >= maxEasyPerGamePerDay || easyCouponsTotalToday >= maxEasyPerDayTotal) {
        skipped.push({ id: achievement.id, reason: 'dailyCap' });
        continue;
      }
    }

    if (achievement.type === 'challenge') {
      cooldowns[achievement.id] = now + (achievement.cooldownDays ?? 0) * DAY_MS;
    }

    const reward = selectReward(achievement, rng, rewardSource, liveRewardIds);
    const coupon = createCoupon({ achievement, reward, now, seq: grants.length, source: rewardSource });
    grants.push({ achievement, reward, coupon });
    // Свежий купон тоже «занимает» задание и награду в рамках этого прогона.
    pendingAchievementIds.add(achievement.id);
    liveRewardIds.add(reward.id);

    if (isCappedCoupon(achievement)) {
      easyCouponsByGameToday[gameId] = (easyCouponsByGameToday[gameId] ?? 0) + 1;
      easyCouponsTotalToday += 1;
    }
  }

  const nextProgress: Progress = {
    ...progress,
    challengeCooldowns: cooldowns,
    easyCouponsTotalToday,
    easyCouponsByGameToday,
    couponDayDate: today,
    // §B2: сброс счётчика партий в полночь — синхронно со сбросом купонных счётчиков.
    ...(dayRollover ? { gamesPlayedToday: 0 } : {}),
  };

  return { grants, progress: nextProgress, skipped };
}
