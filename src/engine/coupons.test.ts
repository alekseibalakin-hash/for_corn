import { describe, expect, it } from 'vitest';
import type { Achievement, Reward, Tier } from '../content/types';
import {
  createCoupon,
  expiringSoon,
  isExpired,
  pickSpendableCoupon,
  presentationForTier,
  redeemCoupon,
  selectReward,
  spendCoupon,
  sweepExpired,
  type RewardSource,
} from './coupons';
import { DAY_MS, type Coupon } from './types';

const REWARDS: Reward[] = [
  { id: 's1', tier: 'small', title: 'S1', text: '...' },
  { id: 's2', tier: 'small', title: 'S2', text: '...', note: 'note-награды' },
  { id: 's3', tier: 'small', title: 'S3', text: '...', shelfLifeDays: 7 },
  { id: 'm1', tier: 'medium', title: 'M1', text: '...' },
  { id: 'l1', tier: 'large', title: 'L1', text: '...' },
];

const SHELF: Record<Tier, number> = { small: 3, medium: 10, large: 30 };

const source: RewardSource = {
  byId: (id) => REWARDS.find((r) => r.id === id),
  byTier: (tier) => REWARDS.filter((r) => r.tier === tier),
  shelfLifeDays: (reward) => reward.shelfLifeDays ?? SHELF[reward.tier],
};

const ach = (over: Partial<Achievement>): Achievement => ({
  id: 'a',
  type: 'milestone',
  title: 't',
  description: 'd',
  trigger: { stat: 'x', op: '>=', value: 0 },
  ...over,
});

describe('selectReward', () => {
  it('по rewardId — конкретная награда', () => {
    expect(selectReward(ach({ rewardId: 'm1' }), () => 0, source).id).toBe('m1');
  });

  it('по rewardTier — случайная из тира (детерминированно через rng)', () => {
    const small = selectReward(ach({ rewardTier: 'small' }), () => 0, source);
    expect(small.tier).toBe('small');
    expect(small.id).toBe('s1'); // floor(0 * 3) = 0
    const last = selectReward(ach({ rewardTier: 'small' }), () => 0.999, source);
    expect(last.id).toBe('s3'); // floor(0.999 * 3) = 2
  });

  it('бросает на несуществующем rewardId', () => {
    expect(() => selectReward(ach({ rewardId: 'nope' }), () => 0, source)).toThrow();
  });

  it('разнообразие: исключает награды, уже лежащие в кошельке', () => {
    // small-пул [s1,s2,s3]; s1 исключаем → rng=0 даёт s2
    const r = selectReward(ach({ rewardTier: 'small' }), () => 0, source, new Set(['s1']));
    expect(r.id).toBe('s2');
  });

  it('если весь тир уже в кошельке — падаем на полный пул (без дублей не выйдет)', () => {
    const r = selectReward(ach({ rewardTier: 'small' }), () => 0, source, new Set(['s1', 's2', 's3']));
    expect(r.id).toBe('s1'); // исключать некого — полный пул, rng=0
  });
});

describe('createCoupon', () => {
  it('срок годности из дефолта тира', () => {
    const c = createCoupon({ achievement: ach({ rewardTier: 'medium' }), reward: REWARDS[3], now: 1000, seq: 0, source });
    expect(c.expiresAt).toBe(1000 + 10 * DAY_MS);
    expect(c.tier).toBe('medium');
  });

  it('срок годности — переопределение на награде', () => {
    const c = createCoupon({ achievement: ach({ rewardTier: 'small' }), reward: REWARDS[2], now: 0, seq: 0, source });
    expect(c.expiresAt).toBe(7 * DAY_MS); // s3 переопределяет на 7
  });

  it('note ачивки приоритетнее note награды', () => {
    const c = createCoupon({
      achievement: ach({ rewardId: 's2', note: 'note-ачивки' }),
      reward: REWARDS[1], // s2 имеет note-награды
      now: 0,
      seq: 0,
      source,
    });
    expect(c.note).toBe('note-ачивки');
  });

  it('берёт note награды, если у ачивки своего нет', () => {
    const c = createCoupon({ achievement: ach({ rewardId: 's2' }), reward: REWARDS[1], now: 0, seq: 0, source });
    expect(c.note).toBe('note-награды');
  });

  it('без note вообще — поле не выставляется', () => {
    const c = createCoupon({ achievement: ach({ rewardId: 's1' }), reward: REWARDS[0], now: 0, seq: 0, source });
    expect(c.note).toBeUndefined();
  });
});

const coupon = (over: Partial<Coupon>): Coupon => ({
  id: 'c1',
  rewardId: 's1',
  tier: 'small',
  unlockedAt: 0,
  expiresAt: 10 * DAY_MS,
  achievementId: 'a',
  ...over,
});

describe('жизненный цикл купона', () => {
  it('isExpired — по сроку', () => {
    const c = coupon({ expiresAt: 1000 });
    expect(isExpired(c, 999)).toBe(false);
    expect(isExpired(c, 1000)).toBe(true);
  });

  it('sweepExpired разделяет активные и сгоревшие', () => {
    const wallet = [coupon({ id: 'a', expiresAt: 500 }), coupon({ id: 'b', expiresAt: 2000 })];
    const { wallet: active, expired } = sweepExpired(wallet, 1000);
    expect(active.map((c) => c.id)).toEqual(['b']);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ id: 'a', reason: 'expired', resolvedAt: 1000 });
  });

  it('redeemCoupon переносит в историю как redeemed', () => {
    const wallet = [coupon({ id: 'a' }), coupon({ id: 'b' })];
    const { wallet: rest, entry } = redeemCoupon(wallet, 'a', 5000);
    expect(rest.map((c) => c.id)).toEqual(['b']);
    expect(entry).toMatchObject({ id: 'a', reason: 'redeemed', resolvedAt: 5000 });
  });

  it('redeemCoupon бросает на отсутствующем купоне', () => {
    expect(() => redeemCoupon([], 'x', 0)).toThrow();
  });

  it('expiringSoon ловит купоны на грани (по умолчанию сутки), сортирует по близости', () => {
    const now = 100 * DAY_MS;
    const wallet = [
      coupon({ id: 'far', expiresAt: now + 5 * DAY_MS }),
      coupon({ id: 'soon', expiresAt: now + 0.5 * DAY_MS }),
      coupon({ id: 'tomorrow', expiresAt: now + 0.9 * DAY_MS }),
      coupon({ id: 'dead', expiresAt: now - 1 }),
    ];
    const soon = expiringSoon(wallet, now);
    expect(soon.map((c) => c.id)).toEqual(['soon', 'tomorrow']);
  });
});

describe('spendCoupon (§B1 — трата на ретрай)', () => {
  it('убирает купон из кошелька и кладёт в историю с reason=spent', () => {
    const wallet = [coupon({ id: 'a', tier: 'small' }), coupon({ id: 'b', tier: 'medium' })];
    const { wallet: rest, entry } = spendCoupon(wallet, 'a', 9999);
    expect(rest.map((c) => c.id)).toEqual(['b']);
    expect(entry).toMatchObject({ id: 'a', reason: 'spent', resolvedAt: 9999 });
  });

  it('rewardsRedeemed не растёт (spendCoupon не вызывает addCompleted)', () => {
    // spendCoupon — это не redeem: купон сжигается на игровую пользу, не как «забрал подарок».
    // Проверяем, что entry.reason === 'spent', а не 'redeemed' (это и есть гарантия).
    const { entry } = spendCoupon([coupon({ id: 'x' })], 'x', 0);
    expect(entry.reason).toBe('spent');
  });

  it('не трогает large и именные (их надо явно не передавать — берёт по id)', () => {
    // Логика выбора купона (small/medium) в spendCouponForRetry — на уровне RewardsProvider.
    // spendCoupon сам по id берёт ЛЮБОЙ переданный (без фильтрации по тиру).
    const largeCoupon = coupon({ id: 'big', tier: 'large' });
    // Если вызвать spendCoupon с большим купоном — он уберёт его (контракт: caller решает что давать).
    const { entry } = spendCoupon([largeCoupon], 'big', 0);
    expect(entry.reason).toBe('spent');
  });

  it('бросает на отсутствующем купоне', () => {
    expect(() => spendCoupon([], 'ghost', 0)).toThrow();
  });
});

// #8 (адверс-ревью): инвариант «трата только live small/medium» раньше жил в хук-колбэке без теста.
// Теперь — чистая pickSpendableCoupon: проверяем, что large/именные/сгоревшие НЕ выбираются.
describe('pickSpendableCoupon (§B1 — выбор купона на желание)', () => {
  const now = 5 * DAY_MS;
  const live = (over: Partial<Coupon>) => coupon({ expiresAt: now + DAY_MS, ...over });

  it('берёт ПЕРВЫЙ live small/medium', () => {
    const wallet = [live({ id: 'a', tier: 'small' }), live({ id: 'b', tier: 'medium' })];
    expect(pickSpendableCoupon(wallet, now)?.id).toBe('a');
  });

  it('НЕ выбирает large (тратятся только small/medium)', () => {
    expect(pickSpendableCoupon([live({ id: 'big', tier: 'large' })], now)).toBeUndefined();
  });

  it('НЕ выбирает именные (restaurant/fine-dining — они large-тира, сверх лимита)', () => {
    const wallet = [
      live({ id: 'fd', tier: 'large', rewardId: 'fine-dining' }),
      live({ id: 'rest', tier: 'large', rewardId: 'restaurant' }),
    ];
    expect(pickSpendableCoupon(wallet, now)).toBeUndefined();
  });

  it('пропускает сгоревший small → берёт следующий live medium', () => {
    const wallet = [coupon({ id: 'dead', tier: 'small', expiresAt: now - 1 }), live({ id: 'm', tier: 'medium' })];
    expect(pickSpendableCoupon(wallet, now)?.id).toBe('m');
  });

  it('выбирает small/medium даже если large стоит раньше в списке', () => {
    const wallet = [live({ id: 'big', tier: 'large' }), live({ id: 's', tier: 'small' })];
    expect(pickSpendableCoupon(wallet, now)?.id).toBe('s');
  });

  it('нет подходящего (только large/именные/сгоревшие) → undefined (кнопка «желание» скрыта)', () => {
    const wallet = [live({ id: 'big', tier: 'large' }), coupon({ id: 'dead', tier: 'small', expiresAt: now - 1 })];
    expect(pickSpendableCoupon(wallet, now)).toBeUndefined();
  });
});

describe('presentationForTier', () => {
  it('🌸/💝 → card (забрать карточкой), 💎 → fullscreen (DESIGN §15)', () => {
    expect(presentationForTier('small')).toBe('card');
    expect(presentationForTier('medium')).toBe('card');
    expect(presentationForTier('large')).toBe('fullscreen');
  });
});
