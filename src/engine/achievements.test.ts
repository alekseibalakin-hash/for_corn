import { describe, expect, it } from 'vitest';
import type { Achievement, Reward, Tier } from '../content/types';
import { evaluateAchievements } from './achievements';
import type { RewardSource } from './coupons';
import { defaultProgress } from './stats';
import { DAY_MS, type Coupon, type Progress, type StatSnapshot } from './types';

const REWARDS: Reward[] = [
  { id: 's1', tier: 'small', title: 'S1', text: '...' },
  { id: 's2', tier: 'small', title: 'S2', text: '...' },
  { id: 'm1', tier: 'medium', title: 'M1', text: '...' },
  { id: 'l1', tier: 'large', title: 'L1', text: '...' },
];
const SHELF: Record<Tier, number> = { small: 3, medium: 10, large: 30 };
const source: RewardSource = {
  byId: (id) => REWARDS.find((r) => r.id === id),
  byTier: (tier) => REWARDS.filter((r) => r.tier === tier),
  shelfLifeDays: (reward) => reward.shelfLifeDays ?? SHELF[reward.tier],
};

const NOW = 1_700_000_000_000;
const TODAY = '2026-06-15';

const always = { stat: 'k', op: '>=', value: 0 } as const;
const SNAP: StatSnapshot = { k: 1 };

const milestone = (id: string): Achievement => ({
  id,
  type: 'milestone',
  title: id,
  description: '',
  trigger: always,
  rewardTier: 'small',
});
const challenge = (id: string, cooldownDays = 1, rewardTier: Tier = 'small'): Achievement => ({
  id,
  type: 'challenge',
  title: id,
  description: '',
  trigger: always,
  rewardTier,
  cooldownDays,
});

const tagged = (id: string, game: string): Achievement => ({ ...milestone(id), game });

const coupon = (achievementId: string, rewardId: string, expiresAt: number): Coupon => ({
  id: `cpn-${achievementId}`,
  rewardId,
  tier: 'small',
  unlockedAt: NOW,
  expiresAt,
  achievementId,
});

function run(list: Achievement[], progress: Progress, over: Partial<Parameters<typeof evaluateAchievements>[0]> = {}) {
  return evaluateAchievements({
    snapshot: SNAP,
    progress,
    wallet: [],
    now: NOW,
    today: TODAY,
    rng: () => 0,
    achievementsList: list,
    maxChallengeCouponsPerDay: 3,
    maxEasyPerGamePerDay: 3,
    maxEasyPerDayTotal: 5,
    rewardSource: source,
    ...over,
  });
}

describe('единый жизненный цикл задания (DESIGN §15)', () => {
  it('выдаётся, когда триггер выполнен и ничего не мешает', () => {
    const res = run([milestone('m')], defaultProgress(TODAY));
    expect(res.grants).toHaveLength(1);
  });

  it('PENDING: пока живой купон в кошельке — не дублируется', () => {
    const live = coupon('m', 's1', NOW + 3 * DAY_MS);
    const res = run([milestone('m')], defaultProgress(TODAY), { wallet: [live] });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm', reason: 'pending' });
  });

  it('COMPLETE-ON-REDEEM: задание в completed больше не выпадает', () => {
    const progress: Progress = { ...defaultProgress(TODAY), completed: ['m'] };
    const res = run([milestone('m')], progress, { wallet: [] });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm', reason: 'completed' });
  });

  it('EXPIRE-RETRY: сгоревший купон (нет живого) → задание снова выдаётся', () => {
    const dead = coupon('m', 's1', NOW - 1); // просрочен
    const res = run([milestone('m')], defaultProgress(TODAY), { wallet: [dead] });
    expect(res.grants).toHaveLength(1);
  });

  it('сам прогон НЕ добавляет в completed (это делает использование купона)', () => {
    const res = run([milestone('m')], defaultProgress(TODAY));
    expect(res.progress.completed).toEqual([]);
  });

  it('касается и challenge: живой купон → pending (важнее, чем cooldown/cap)', () => {
    const live = coupon('c', 's1', NOW + 3 * DAY_MS);
    const res = run([challenge('c')], defaultProgress(TODAY), { wallet: [live] });
    expect(res.skipped).toContainEqual({ id: 'c', reason: 'pending' });
    expect(res.grants).toHaveLength(0);
  });

  it('A4: две ачивки с одним rewardId — пока первый live-купон в кошельке, второй не выдаётся', () => {
    // named — крупная именная ачивка с фикс. rewardId (по типу reach-2048 / m3-spicy-25).
    const named = (id: string): Achievement => ({
      id,
      type: 'milestone',
      title: id,
      description: '',
      trigger: always,
      rewardId: 'l1', // оба указывают на ту же награду
    });
    const a1 = named('named-a');
    const a2 = named('named-b');

    // Первая выдаётся — кошелёк пуст.
    const res1 = run([a1, a2], defaultProgress(TODAY));
    expect(res1.grants).toHaveLength(1);
    expect(res1.grants[0].achievement.id).toBe('named-a');
    expect(res1.skipped).toContainEqual({ id: 'named-b', reason: 'pending' });

    // Второй раз: l1 уже live — ни одна не выдаётся.
    const liveL1 = coupon('named-a', 'l1', NOW + 30 * DAY_MS);
    const res2 = run([a1, a2], defaultProgress(TODAY), { wallet: [liveL1] });
    expect(res2.grants).toHaveLength(0);
    expect(res2.skipped.filter((s) => s.reason === 'pending').map((s) => s.id)).toEqual(
      expect.arrayContaining(['named-a', 'named-b']),
    );
  });
});

describe('milestone', () => {
  it('ограничивается дневным лимитом лёгких купонов (per-game cap = 3)', () => {
    const list = ['m1', 'm2', 'm3', 'm4', 'm5'].map(milestone);
    const res = run(list, defaultProgress(TODAY)); // maxEasyPerGamePerDay: 3 из run()
    expect(res.grants).toHaveLength(3);
    expect(res.skipped.filter((s) => s.reason === 'dailyCap').map((s) => s.id)).toEqual(['m4', 'm5']);
  });

  it('large-веха (rewardTier: large, без rewardId) теперь тоже ограничивается лимитом (isCappedCoupon = !rewardId)', () => {
    // §0.5: расширяем лимит на ВСЕ тиры без rewardId — иначе 14 large-вех шли мимо лимита.
    const large: Achievement = { ...milestone('big'), rewardTier: 'large' };
    const list = ['m1', 'm2', 'm3', 'm4'].map(milestone).concat(large);
    const res = run(list, defaultProgress(TODAY));
    // m1..m3 выдаются (per-game cap = 3); m4 и big (large, нет rewardId) оба капнут
    expect(res.grants.map((g) => g.achievement.id)).not.toContain('big');
    expect(res.grants).toHaveLength(3); // только m1, m2, m3
    expect(res.skipped.filter((s) => s.reason === 'dailyCap').map((s) => s.id)).toContain('big');
  });
});

describe('challenge — cooldown', () => {
  it('после выдачи встаёт на cooldown и не повторяется до истечения', () => {
    const first = run([challenge('c', 2)], defaultProgress(TODAY));
    expect(first.grants).toHaveLength(1);
    expect(first.progress.challengeCooldowns['c']).toBe(NOW + 2 * DAY_MS);

    // купон уже использован (completed убран ради изоляции cooldown — здесь проверяем,
    // что даже без купона в кошельке cooldown держит). Передаём пустой кошелёк.
    const midCooldown = run([challenge('c', 2)], first.progress, { now: NOW + 1 * DAY_MS });
    expect(midCooldown.grants).toHaveLength(0);
    expect(midCooldown.skipped).toContainEqual({ id: 'c', reason: 'cooldown' });
  });

  it('после истечения cooldown — снова выдаётся', () => {
    const first = run([challenge('c', 2)], defaultProgress(TODAY));
    const after = run([challenge('c', 2)], first.progress, { now: NOW + 2 * DAY_MS, today: '2026-06-17' });
    expect(after.grants).toHaveLength(1);
  });
});

describe('АНТИ-ГРАЙНД: двухуровневый дневной лимит лёгких купонов', () => {
  it('per-game потолок (3): лишние easy-купоны пропускаются как dailyCap', () => {
    const list = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => challenge(id));
    const res = run(list, defaultProgress(TODAY));
    expect(res.grants).toHaveLength(3);
    expect(res.progress.easyCouponsByGameToday['2048']).toBe(3);
    const capped = res.skipped.filter((s) => s.reason === 'dailyCap').map((s) => s.id);
    expect(capped).toEqual(['c4', 'c5']);
  });

  it('hub-total потолок (5): ачивки разных игр суммируются', () => {
    // Игра A (2048): 3 easy → per-game cap hit; игра B (m3): 2 easy → total=5, 3-я capped
    const prog2048 = run(['c1', 'c2', 'c3'].map((id) => challenge(id)), defaultProgress(TODAY), { gameId: '2048' });
    expect(prog2048.progress.easyCouponsTotalToday).toBe(3);

    const m3miles = ['m1', 'm2', 'm3'].map((id) => tagged(id, 'm3'));
    const resM3 = run(m3miles, prog2048.progress, { gameId: 'm3' });
    expect(resM3.grants).toHaveLength(2); // total cap 5 → 3+2=5, 3-я blocked
    expect(resM3.progress.easyCouponsTotalToday).toBe(5);
  });

  it('вехи тоже ограничиваются лимитом (milestone с small/medium rewardTier — это easy)', () => {
    const list = [challenge('c1'), challenge('c2'), challenge('c3'), milestone('big')];
    const res = run(list, defaultProgress(TODAY));
    // c1, c2, c3 (easy) → per-game cap 3 исчерпан; milestone('big') тоже easy → dailyCap
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['c1', 'c2', 'c3']);
    expect(res.skipped).toContainEqual({ id: 'big', reason: 'dailyCap' });
  });

  it('капнутый челлендж НЕ ставится на cooldown — остаётся доступным назавтра', () => {
    const list = [challenge('c1'), challenge('c2'), challenge('c3'), challenge('c4')];
    const res = run(list, defaultProgress(TODAY));
    expect(res.progress.challengeCooldowns['c4']).toBeUndefined();
  });

  it('СБРОС В ПОЛНОЧЬ: новая локальная дата обнуляет easyCoupons-счётчики', () => {
    const today = run(['c1', 'c2', 'c3'].map((id) => challenge(id)), defaultProgress(TODAY));
    expect(today.progress.easyCouponsByGameToday['2048']).toBe(3);
    expect(today.progress.easyCouponsTotalToday).toBe(3);
    const cappedToday = run([challenge('c4')], today.progress);
    expect(cappedToday.grants).toHaveLength(0);

    const tomorrow = run([challenge('c4')], cappedToday.progress, { now: NOW + DAY_MS, today: '2026-06-16' });
    expect(tomorrow.progress.easyCouponsByGameToday['2048']).toBe(1);
    expect(tomorrow.progress.easyCouponsTotalToday).toBe(1);
    expect(tomorrow.grants).toHaveLength(1);
  });

  it('именная награда (rewardId) освобождена от лимита лёгких купонов', () => {
    const named: Achievement = { ...milestone('named'), rewardTier: undefined, rewardId: 'l1' };
    const filled = run(['c1', 'c2', 'c3'].map((id) => challenge(id)), defaultProgress(TODAY));
    // per-game cap уже = 3; именная ачивка должна выдаться поверх лимита
    const res = run([named], filled.progress);
    expect(res.grants.map((g) => g.achievement.id)).toContain('named');
  });
});

describe('награда: note, фикс и разнообразие', () => {
  it('note ачивки попадает в купон', () => {
    const ach: Achievement = { ...milestone('m'), note: 'личное слово' };
    const res = run([ach], defaultProgress(TODAY));
    expect(res.grants[0].coupon.note).toBe('личное слово');
  });

  it('фиксированная награда по rewardId', () => {
    const ach: Achievement = { ...milestone('m'), rewardTier: undefined, rewardId: 'l1' };
    const res = run([ach], defaultProgress(TODAY));
    expect(res.grants[0].reward.id).toBe('l1');
  });

  it('РАЗНООБРАЗИЕ: не выдаёт награду, которая уже лежит в кошельке', () => {
    // s1 уже на руках (по другому заданию) → из small-пула [s1,s2] остаётся s2
    const inWallet = coupon('other', 's1', NOW + 3 * DAY_MS);
    const res = run([milestone('m')], defaultProgress(TODAY), { wallet: [inWallet], rng: () => 0 });
    expect(res.grants[0].reward.id).toBe('s2');
  });

  it('две выдачи за один прогон не дублируют награду между собой', () => {
    const res = run([milestone('a'), milestone('b')], defaultProgress(TODAY), { rng: () => 0 });
    const rewardIds = res.grants.map((g) => g.reward.id);
    expect(new Set(rewardIds).size).toBe(rewardIds.length);
  });
});

describe('фильтр по game (ХАБ, DESIGN-HUB §3)', () => {
  it('по умолчанию gameId=2048: untagged ачивка трактуется как 2048 и выдаётся', () => {
    const res = run([milestone('m')], defaultProgress(TODAY));
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['m']);
  });

  it('ачивка другой игры (game:m3) НЕ попадает в прогон 2048 (даже не «skipped»)', () => {
    const res = run([tagged('only-m3', 'm3')], defaultProgress(TODAY)); // gameId по умолчанию '2048'
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toHaveLength(0); // отфильтрована до цикла, а не пропущена как notTriggered
  });

  it('в своей игре (gameId=m3) выдаётся её ачивка, а 2048-ачивки отсеяны', () => {
    const list = [milestone('mile-2048'), tagged('only-m3', 'm3')];
    const res = run(list, defaultProgress(TODAY), { gameId: 'm3' });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['only-m3']);
  });

  it("game:'any' засчитывается в любой игре хаба", () => {
    const list = [tagged('cross', 'any')];
    expect(run(list, defaultProgress(TODAY), { gameId: '2048' }).grants.map((g) => g.achievement.id)).toEqual(['cross']);
    expect(run(list, defaultProgress(TODAY), { gameId: 'm3' }).grants.map((g) => g.achievement.id)).toEqual(['cross']);
  });
});

describe('реальный контент', () => {
  const snapshotWithTile = (maxTile: number): StatSnapshot => ({
    gamesPlayed: 1,
    sessionScore: 0,
    maxTileThisGame: maxTile,
    movesThisGame: 10,
    timeToCurrentMaxTileSec: 999,
    totalScore: 0,
    bestScore: 0,
    bestTile: maxTile,
    totalMoves: 10,
    dailyStreak: 1,
    rewardsRedeemed: 0,
  });

  it('welcome срабатывает на плитке 64', () => {
    const res = evaluateAchievements({ snapshot: snapshotWithTile(64), progress: defaultProgress(TODAY), wallet: [], now: NOW, today: TODAY, rng: () => 0.5 });
    const ids = res.grants.map((g) => g.achievement.id);
    expect(ids).toContain('welcome');
    const welcome = res.grants.find((g) => g.achievement.id === 'welcome');
    expect(welcome?.coupon.note).toBe('Это всё для тебя. Отдыхай и играй в своё удовольствие ❤️');
  });

  it('welcome НЕ срабатывает до плитки 64 (например, на 32)', () => {
    const res = evaluateAchievements({ snapshot: snapshotWithTile(32), progress: defaultProgress(TODAY), wallet: [], now: NOW, today: TODAY, rng: () => 0.5 });
    const ids = res.grants.map((g) => g.achievement.id);
    expect(ids).not.toContain('welcome');
  });
});

describe('edge-triggering per-game вех (фикс «награда на первом ходу резюма»)', () => {
  const mile64: Achievement = { ...milestone('reach64'), trigger: { stat: 'maxTileThisGame', op: '>=', value: 64 } };
  const snap = (maxTile: number): StatSnapshot => ({ maxTileThisGame: maxTile });

  it('РЕЗЮМ: порог уже был пройден ДО хода → НЕ выдаётся (alreadyCrossed)', () => {
    const res = run([mile64], defaultProgress(TODAY), { snapshot: snap(64), prevSnapshot: snap(64) });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'reach64', reason: 'alreadyCrossed' });
  });

  it('ПЕРЕСЕЧЕНИЕ ходом: было <64, стало ≥64 → выдаётся', () => {
    const res = run([mile64], defaultProgress(TODAY), { snapshot: snap(64), prevSnapshot: snap(32) });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['reach64']);
  });

  it('без prevSnapshot — поведение как раньше (level): при ≥ выдаётся', () => {
    const res = run([mile64], defaultProgress(TODAY), { snapshot: snap(64) });
    expect(res.grants).toHaveLength(1);
  });

  it('глобальный триггер (dailyStreak) НЕ edge-гейтится: prev уже ≥ → всё равно выдаётся', () => {
    const streak3: Achievement = { ...milestone('streak3'), trigger: { stat: 'dailyStreak', op: '>=', value: 3 } };
    const res = run([streak3], defaultProgress(TODAY), { snapshot: { dailyStreak: 3 }, prevSnapshot: { dailyStreak: 3 } });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['streak3']);
  });

  it('составной (allOf) per-game триггер: уже выполнен до хода → не выдаётся', () => {
    const fast: Achievement = {
      ...challenge('fast'),
      trigger: {
        allOf: [
          { stat: 'maxTileThisGame', op: '>=', value: 256 },
          { stat: 'timeToCurrentMaxTileSec', op: '<=', value: 120 },
        ],
      },
    };
    const res = run([fast], defaultProgress(TODAY), {
      snapshot: { maxTileThisGame: 256, timeToCurrentMaxTileSec: 100 },
      prevSnapshot: { maxTileThisGame: 256, timeToCurrentMaxTileSec: 100 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'fast', reason: 'alreadyCrossed' });
  });
});

describe('edge-triggering m3 (тот же фикс резюма для Match-3, Фаза B)', () => {
  const m3score: Achievement = {
    ...tagged('m3-500', 'm3'),
    trigger: { stat: 'm3_score', op: '>=', value: 500 },
  };
  const m3combo: Achievement = {
    ...tagged('m3-combo', 'm3'),
    trigger: { stat: 'm3_combo', op: '>=', value: 4 },
  };

  it('РЕЗЮМ партии с высоким m3_score: порог уже пройден ДО свопа → НЕ выдаётся', () => {
    const res = run([m3score], defaultProgress(TODAY), {
      gameId: 'm3',
      snapshot: { m3_score: 900 },
      prevSnapshot: { m3_score: 900 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm3-500', reason: 'alreadyCrossed' });
  });

  it('ПЕРЕСЕЧЕНИЕ свопом: было <500, стало ≥500 → выдаётся', () => {
    const res = run([m3score], defaultProgress(TODAY), {
      gameId: 'm3',
      snapshot: { m3_score: 520 },
      prevSnapshot: { m3_score: 480 },
    });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['m3-500']);
  });

  it('m3_combo тоже edge-гейтится: резюм с высоким комбо не роняет купон на первом свопе', () => {
    const res = run([m3combo], defaultProgress(TODAY), {
      gameId: 'm3',
      snapshot: { m3_combo: 5 },
      prevSnapshot: { m3_combo: 5 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm3-combo', reason: 'alreadyCrossed' });
  });
});

describe('m3_maxSpicyLevel — веха глубины «с перчинкой» (level-триггер, НЕ per-game, бриф §6)', () => {
  const spicy = (id: string, value: number): Achievement => ({
    ...tagged(id, 'm3'),
    trigger: { stat: 'm3_maxSpicyLevel', op: '>=', value },
  });

  it('EDGE-ГЕЙТ: m3_maxSpicyLevel НЕ перевыдаётся, если порог уже пройден ДО хода (фикс «ужин каждый заход»)', () => {
    // prevSnapshot уже ≥ порога ⇒ веха пройдена РАНЕЕ ⇒ не ретро-выдаём. Иначе на КАЖДОМ новом заходе
    // после первого хода веха-глубина выпадала бы заново (pending не ловит просроченный/несошедшийся купон).
    const res = run([spicy('m3-spicy-3', 3)], defaultProgress(TODAY), {
      gameId: 'm3',
      snapshot: { m3_maxSpicyLevel: 5 },
      prevSnapshot: { m3_maxSpicyLevel: 5 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm3-spicy-3', reason: 'alreadyCrossed' });
  });

  it('её прод-баг: ужин-вершина НЕ выпадает на новом заходе (глубина 26, порог 25 уже пройден)', () => {
    const res = run([spicy('m3-spicy-25', 25)], defaultProgress(TODAY), {
      gameId: 'm3',
      snapshot: { m3_maxSpicyLevel: 26 },
      prevSnapshot: { m3_maxSpicyLevel: 26 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm3-spicy-25', reason: 'alreadyCrossed' });
  });

  it('первое пересечение порога выдаёт веху (новый игрок, prev ниже порога)', () => {
    const res = run([spicy('m3-spicy-1', 1)], defaultProgress(TODAY), {
      gameId: 'm3',
      snapshot: { m3_maxSpicyLevel: 1 },
      prevSnapshot: { m3_maxSpicyLevel: 0 },
    });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['m3-spicy-1']);
  });

  it('веха срабатывает РОВНО на ходе пересечения; ранее пройденные не дублятся (edge-гейт)', () => {
    const res = run([spicy('m3-spicy-1', 1), spicy('m3-spicy-3', 3), spicy('m3-spicy-5', 5)], defaultProgress(TODAY), {
      gameId: 'm3',
      snapshot: { m3_maxSpicyLevel: 3 }, // ход 2→3
      prevSnapshot: { m3_maxSpicyLevel: 2 },
    });
    // только порог, пересечённый ЭТИМ ходом (3); веха 1 заработана раньше (prev≥1), 5 не достигнут.
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['m3-spicy-3']);
  });

  it('completed закрывает навсегда (на ходе пересечения порога)', () => {
    const res = run([spicy('m3-spicy-3', 3)], { ...defaultProgress(TODAY), completed: ['m3-spicy-3'] }, {
      gameId: 'm3',
      snapshot: { m3_maxSpicyLevel: 3 },
      prevSnapshot: { m3_maxSpicyLevel: 2 }, // пересечение 2→3, но уже completed
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm3-spicy-3', reason: 'completed' });
  });

  it('живой купон (pending) не дублируется на ходе пересечения порога', () => {
    const wallet = [coupon('m3-spicy-3', 's1', NOW + DAY_MS)];
    const res = run([spicy('m3-spicy-3', 3)], defaultProgress(TODAY), {
      gameId: 'm3',
      wallet,
      snapshot: { m3_maxSpicyLevel: 3 },
      prevSnapshot: { m3_maxSpicyLevel: 2 }, // пересечение 2→3, но купон уже в кошельке
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'm3-spicy-3', reason: 'pending' });
  });
});

describe('w5 edge-гейт монотонных вех (тот же класс, что фикс глубины — превентивно)', () => {
  it('w5_maxDailyStreak: веха серии НЕ перевыдаётся, если порог уже пройден', () => {
    const ach: Achievement = { ...tagged('w5-streak-3', 'w5'), trigger: { stat: 'w5_maxDailyStreak', op: '>=', value: 3 } };
    const res = run([ach], defaultProgress(TODAY), {
      gameId: 'w5',
      snapshot: { w5_maxDailyStreak: 5 },
      prevSnapshot: { w5_maxDailyStreak: 5 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'w5-streak-3', reason: 'alreadyCrossed' });
  });

  it('w5_dailyWins: веха выдаётся РОВНО на ходе пересечения порога', () => {
    const ach: Achievement = { ...tagged('w5-wins-5', 'w5'), trigger: { stat: 'w5_dailyWins', op: '>=', value: 5 } };
    const res = run([ach], defaultProgress(TODAY), {
      gameId: 'w5',
      snapshot: { w5_dailyWins: 5 },
      prevSnapshot: { w5_dailyWins: 4 },
    });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['w5-wins-5']);
  });
});

describe('bb_maxLevel — веха глубины «Блоков» (level-триггер, edge-гейт встроен С НАЧАЛА, §2.1)', () => {
  const bb = (id: string, value: number): Achievement => ({
    ...tagged(id, 'bb'),
    trigger: { stat: 'bb_maxLevel', op: '>=', value },
  });

  it('EDGE-ГЕЙТ: bb_maxLevel НЕ перевыдаётся, если порог уже пройден ДО хода (не повторяем прод-баг v18)', () => {
    // prevSnapshot уже ≥ порога ⇒ веха пройдена РАНЕЕ ⇒ не ретро-выдаём. Без edge-гейта веха-награда
    // глубины сыпалась бы на КАЖДОМ заходе после первого размещения (pending не ловит просроченный купон).
    const res = run([bb('bb-depth-3', 3)], defaultProgress(TODAY), {
      gameId: 'bb',
      snapshot: { bb_maxLevel: 5 },
      prevSnapshot: { bb_maxLevel: 5 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'bb-depth-3', reason: 'alreadyCrossed' });
  });

  it('вершина блоков НЕ выпадает на новом заходе (глубина 26, порог 25 уже пройден)', () => {
    const res = run([bb('bb-summit-25', 25)], defaultProgress(TODAY), {
      gameId: 'bb',
      snapshot: { bb_maxLevel: 26 },
      prevSnapshot: { bb_maxLevel: 26 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'bb-summit-25', reason: 'alreadyCrossed' });
  });

  it('первое пересечение порога выдаёт веху (победа уровня 1: prev 0 → snap 1)', () => {
    const res = run([bb('bb-first', 1)], defaultProgress(TODAY), {
      gameId: 'bb',
      snapshot: { bb_maxLevel: 1 },
      prevSnapshot: { bb_maxLevel: 0 },
    });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['bb-first']);
  });

  it('веха срабатывает РОВНО на ходе пересечения; ранее пройденные не дублятся', () => {
    const res = run([bb('bb-first', 1), bb('bb-depth-3', 3), bb('bb-depth-5', 5)], defaultProgress(TODAY), {
      gameId: 'bb',
      snapshot: { bb_maxLevel: 3 }, // победа уровня 2→3
      prevSnapshot: { bb_maxLevel: 2 },
    });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['bb-depth-3']);
  });

  it('bb_score (per-game) edge-гейтится: резюм уровня с высоким счётом не роняет купон на 1-м размещении', () => {
    const ach: Achievement = { ...challenge('bb-score', 1), game: 'bb', trigger: { stat: 'bb_score', op: '>=', value: 1500 } };
    const res = run([ach], defaultProgress(TODAY), {
      gameId: 'bb',
      snapshot: { bb_score: 1800 },
      prevSnapshot: { bb_score: 1700 },
    });
    expect(res.grants).toHaveLength(0);
    expect(res.skipped).toContainEqual({ id: 'bb-score', reason: 'alreadyCrossed' });
  });

  it('bb_lines (per-game) выдаётся РОВНО на ходе пересечения (комбо-линии)', () => {
    const ach: Achievement = { ...challenge('bb-lines', 1), game: 'bb', trigger: { stat: 'bb_lines', op: '>=', value: 3 } };
    const res = run([ach], defaultProgress(TODAY), {
      gameId: 'bb',
      snapshot: { bb_lines: 3 },
      prevSnapshot: { bb_lines: 1 },
    });
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['bb-lines']);
  });
});
