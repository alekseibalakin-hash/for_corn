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
});

describe('milestone', () => {
  it('НЕ ограничивается дневным потолком — все 5 вех выдаются сразу', () => {
    const list = ['m1', 'm2', 'm3', 'm4', 'm5'].map(milestone);
    const res = run(list, defaultProgress(TODAY), { maxChallengeCouponsPerDay: 1 });
    expect(res.grants).toHaveLength(5);
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

describe('АНТИ-ГРАЙНД: дневной потолок купонов-от-challenge', () => {
  it('упирается в потолок (3), лишние челленджи пропускаются как dailyCap', () => {
    const list = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => challenge(id));
    const res = run(list, defaultProgress(TODAY));
    expect(res.grants).toHaveLength(3);
    expect(res.progress.challengeCouponsToday).toBe(3);
    const capped = res.skipped.filter((s) => s.reason === 'dailyCap').map((s) => s.id);
    expect(capped).toEqual(['c4', 'c5']);
  });

  it('вехи продолжают выдаваться, даже когда потолок челленджей выбран', () => {
    const list = [challenge('c1'), challenge('c2'), challenge('c3'), milestone('big')];
    const res = run(list, defaultProgress(TODAY));
    expect(res.grants.map((g) => g.achievement.id)).toEqual(['c1', 'c2', 'c3', 'big']);
  });

  it('капнутый челлендж НЕ ставится на cooldown — остаётся доступным назавтра', () => {
    const list = [challenge('c1'), challenge('c2'), challenge('c3'), challenge('c4')];
    const res = run(list, defaultProgress(TODAY));
    expect(res.progress.challengeCooldowns['c4']).toBeUndefined();
  });

  it('СБРОС В ПОЛНОЧЬ: новая локальная дата обнуляет счётчик', () => {
    const today = run(['c1', 'c2', 'c3'].map((id) => challenge(id)), defaultProgress(TODAY));
    expect(today.progress.challengeCouponsToday).toBe(3);
    const cappedToday = run([challenge('c4')], today.progress);
    expect(cappedToday.grants).toHaveLength(0);

    const tomorrow = run([challenge('c4')], cappedToday.progress, { now: NOW + DAY_MS, today: '2026-06-16' });
    expect(tomorrow.progress.challengeCouponsToday).toBe(1);
    expect(tomorrow.grants).toHaveLength(1);
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
