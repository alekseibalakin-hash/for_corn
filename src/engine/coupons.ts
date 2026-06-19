import {
  rewardById as defaultRewardById,
  rewardsByTier as defaultRewardsByTier,
  shelfLifeDaysFor as defaultShelfLife,
} from '../content';
import type { Achievement, Reward, Tier } from '../content/types';
import type { Coupon, HistoryEntry, HistoryReason } from './types';
import { DAY_MS } from './types';

export type Rng = () => number;

/** Источник наград — по умолчанию из контента, инъектируется в тестах. */
export interface RewardSource {
  byId(id: string): Reward | undefined;
  byTier(tier: Tier): Reward[];
  shelfLifeDays(reward: Reward): number;
}

export const contentRewardSource: RewardSource = {
  byId: defaultRewardById,
  byTier: defaultRewardsByTier,
  shelfLifeDays: defaultShelfLife,
};

/**
 * Выбор награды для ачивки: фиксированная по rewardId, иначе случайная из тира
 * (основной путь, DESIGN §2/§6). Бросает, если награды нет — это битый контент.
 *
 * Для разнообразия (DESIGN §15) исключаем награды из excludeRewardIds (то, что уже
 * лежит в кошельке): не выдаём дубль, пока есть из чего выбрать. Если весь тир уже
 * в кошельке — падаем обратно на полный пул.
 */
export function selectReward(
  achievement: Achievement,
  rng: Rng,
  source: RewardSource = contentRewardSource,
  excludeRewardIds?: ReadonlySet<string>,
): Reward {
  if (achievement.rewardId) {
    const reward = source.byId(achievement.rewardId);
    if (!reward) throw new Error(`Награда «${achievement.rewardId}» не найдена (ачивка ${achievement.id})`);
    return reward;
  }
  if (achievement.rewardTier) {
    const full = source.byTier(achievement.rewardTier);
    if (full.length === 0) throw new Error(`Пустой тир ${achievement.rewardTier} (ачивка ${achievement.id})`);
    const fresh = excludeRewardIds ? full.filter((r) => !excludeRewardIds.has(r.id)) : full;
    const pool = fresh.length > 0 ? fresh : full;
    const idx = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
    return pool[idx];
  }
  throw new Error(`У ачивки ${achievement.id} нет ни rewardId, ни rewardTier`);
}

export interface CreateCouponArgs {
  achievement: Achievement;
  reward: Reward;
  now: number;
  /** Порядковый номер в выдаче — для уникальности id при одинаковом now. */
  seq: number;
  source?: RewardSource;
}

export function createCoupon({ achievement, reward, now, seq, source = contentRewardSource }: CreateCouponArgs): Coupon {
  const shelfLifeDays = source.shelfLifeDays(reward);
  // note ачивки приоритетнее note награды (DESIGN §5/§6).
  const note = achievement.note ?? reward.note;
  return {
    id: `cpn-${now}-${seq}`,
    rewardId: reward.id,
    tier: reward.tier,
    unlockedAt: now,
    expiresAt: now + shelfLifeDays * DAY_MS,
    ...(note ? { note } : {}),
    achievementId: achievement.id,
  };
}

export function isExpired(coupon: Coupon, now: number): boolean {
  return now >= coupon.expiresAt;
}

export function msUntilExpiry(coupon: Coupon, now: number): number {
  return coupon.expiresAt - now;
}

function toHistory(coupon: Coupon, now: number, reason: HistoryReason): HistoryEntry {
  return {
    id: coupon.id,
    rewardId: coupon.rewardId,
    tier: coupon.tier,
    unlockedAt: coupon.unlockedAt,
    expiresAt: coupon.expiresAt,
    achievementId: coupon.achievementId,
    resolvedAt: now,
    reason,
  };
}

export interface SweepResult {
  wallet: Coupon[];
  expired: HistoryEntry[];
}

/** Сгорание: переносит просроченные купоны из кошелька в историю (DESIGN §6). */
export function sweepExpired(wallet: Coupon[], now: number): SweepResult {
  const active: Coupon[] = [];
  const expired: HistoryEntry[] = [];
  for (const coupon of wallet) {
    if (isExpired(coupon, now)) expired.push(toHistory(coupon, now, 'expired'));
    else active.push(coupon);
  }
  return { wallet: active, expired };
}

export interface RedeemResult {
  wallet: Coupon[];
  entry: HistoryEntry;
}

/** Использование купона: убирает из кошелька, отдаёт запись истории `redeemed`. */
export function redeemCoupon(wallet: Coupon[], couponId: string, now: number): RedeemResult {
  const coupon = wallet.find((c) => c.id === couponId);
  if (!coupon) throw new Error(`Купон ${couponId} не найден в кошельке`);
  return {
    wallet: wallet.filter((c) => c.id !== couponId),
    entry: toHistory(coupon, now, 'redeemed'),
  };
}

/** §B1: трата купона на +5 ходов продолжить уровень. НЕ растит rewardsRedeemed, НЕ пишет в completed. */
export function spendCoupon(wallet: Coupon[], couponId: string, now: number): RedeemResult {
  const coupon = wallet.find((c) => c.id === couponId);
  if (!coupon) throw new Error(`Купон ${couponId} не найден в кошельке`);
  return {
    wallet: wallet.filter((c) => c.id !== couponId),
    entry: toHistory(coupon, now, 'spent'),
  };
}

/**
 * §B1: первый «тратибельный на желание» купон — live (не сгоревший) тира small ИЛИ medium.
 * large и именные (они large-тира — гарантировано reservedRewardIds в content) НЕ тратятся:
 * важные/интересные. Чистая функция ⇒ инвариант покрыт тестом (адверс-ревью #8: раньше жил
 * в хук-колбэке spendCouponForRetry без единого теста).
 */
export function pickSpendableCoupon(wallet: Coupon[], now: number): Coupon | undefined {
  return wallet.find((c) => !isExpired(c, now) && (c.tier === 'small' || c.tier === 'medium'));
}

/**
 * Купоны, сгорающие в ближайшее окно (по умолчанию — сутки). Для баннера-напоминания
 * на входе и подсветки «скоро сгорит» (DESIGN §6). Отсортированы по близости конца.
 */
export function expiringSoon(wallet: Coupon[], now: number, withinMs: number = DAY_MS): Coupon[] {
  return wallet
    .filter((c) => !isExpired(c, now) && c.expiresAt - now <= withinMs)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

export type Presentation = 'card' | 'fullscreen';

/**
 * Стиль раскрытия по тиру (DESIGN §15): любую награду надо «Забрать» карточкой.
 * 🌸/💝 — карточка (сочность по тиру внутри), 💎 — полный экран + конфетти.
 */
export function presentationForTier(tier: Tier): Presentation {
  return tier === 'large' ? 'fullscreen' : 'card';
}
