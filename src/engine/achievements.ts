import { achievements as defaultAchievements, maxChallengeCouponsPerDay as defaultCap } from '../content';
import type { Achievement } from '../content/types';
import { contentRewardSource, createCoupon, isExpired, selectReward, type RewardSource, type Rng } from './coupons';
import { evalTrigger } from './trigger';
import { DAY_MS, type Coupon, type Grant, type Progress, type SkippedAchievement, type StatSnapshot } from './types';

export interface EvaluateParams {
  snapshot: StatSnapshot;
  progress: Progress;
  /** Активные купоны — для «pending» (живой купон → не дублируем) и разнообразия наград. */
  wallet: Coupon[];
  /** Текущее время (epoch ms) — инъектируется ради детерминизма. */
  now: number;
  /** Локальная дата YYYY-MM-DD «сегодня» — для дневного потолка/сброса в полночь. */
  today: string;
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
 *  - иначе при выполнении триггера выдаём купон (и milestone, и challenge);
 *  - challenge дополнительно ограничен cooldownDays и дневным потолком купонов
 *    (maxChallengeCouponsPerDay, счётчик в progress, сброс в локальную полночь).
 *    Достигнут потолок → НЕ выдаём и НЕ ставим на кулдаун (доступно, когда сбросится).
 * Сгорание купона прогресс не трогает → задание снова станет доступным.
 * Разнообразие: случайный купон не повторяет награду, уже лежащую в кошельке.
 */
export function evaluateAchievements({
  snapshot,
  progress,
  wallet,
  now,
  today,
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

  for (const achievement of achievementsList) {
    if (!evalTrigger(achievement.trigger, snapshot)) {
      skipped.push({ id: achievement.id, reason: 'notTriggered' });
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
