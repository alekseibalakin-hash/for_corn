import { describe, expect, it } from 'vitest';
import {
  buildGlobalSnapshot,
  buildSnapshot,
  commitGame,
  dailyCheckIn,
  defaultCurrentGame,
  defaultGlobalStats,
  defaultProgress,
  defaultStats,
  mergeSnapshot,
  normalizeProgress,
  readGlobalStats,
  seedGlobals,
} from './stats';
import type { CumulativeStats, GlobalStats } from './types';

describe('normalizeProgress (мягкое чтение прогресса, DESIGN §15)', () => {
  it('null/undefined → дефолт', () => {
    expect(normalizeProgress(null, '2026-06-15').completed).toEqual([]);
    expect(normalizeProgress(undefined, '2026-06-15').couponDayDate).toBe('2026-06-15');
  });

  it('игнорирует старую форму v1 (unlockedMilestones) — completed с нуля', () => {
    const old = { unlockedMilestones: ['welcome'], challengeCooldowns: {}, challengeCouponsToday: 2, couponDayDate: '2026-06-10' } as never;
    const p = normalizeProgress(old, '2026-06-15');
    expect(p.completed).toEqual([]);
    expect(p.challengeCouponsToday).toBe(2); // знакомые поля сохраняются
    expect(p.couponDayDate).toBe('2026-06-10');
    expect('unlockedMilestones' in p).toBe(false); // старое поле не протекает
  });

  it('сохраняет completed и флаги', () => {
    const p = normalizeProgress(
      { completed: ['welcome', 'reach-128'], challengeCooldowns: { c: 1 }, challengeCouponsToday: 1, couponDayDate: '2026-06-15', onboardingSeen: true, victorySeenForCount: 17 },
      '2026-06-15',
    );
    expect(p.completed).toEqual(['welcome', 'reach-128']);
    expect(p.onboardingSeen).toBe(true);
    expect(p.victorySeenForCount).toBe(17);
  });
});

describe('buildSnapshot', () => {
  it('прибавляет текущую партию к cumulative «вживую»', () => {
    const stats: CumulativeStats = { ...defaultStats(), totalScore: 1000, bestScore: 800, bestTile: 256, totalMoves: 50 };
    const game = { ...defaultCurrentGame(0), sessionScore: 500, maxTileThisGame: 128, movesThisGame: 20 };
    const snap = buildSnapshot(stats, game);
    expect(snap.totalScore).toBe(1500);
    expect(snap.bestScore).toBe(800); // 800 > 500
    expect(snap.bestTile).toBe(256); // 256 > 128
    expect(snap.totalMoves).toBe(70);
    expect(snap.sessionScore).toBe(500);
    expect(snap.maxTileThisGame).toBe(128);
  });

  it('текущая партия может побить рекорды в snapshot', () => {
    const game = { ...defaultCurrentGame(0), sessionScore: 5000, maxTileThisGame: 512 };
    const snap = buildSnapshot(defaultStats(), game);
    expect(snap.bestScore).toBe(5000);
    expect(snap.bestTile).toBe(512);
  });

  it('хаб-неймспейс: НЕ содержит global-статов (dailyStreak/rewardsRedeemed) — их даёт rewards', () => {
    const snap = buildSnapshot({ ...defaultStats(), dailyStreak: 9, rewardsRedeemed: 7 }, defaultCurrentGame(0));
    expect(snap.dailyStreak).toBeUndefined();
    expect(snap.rewardsRedeemed).toBeUndefined();
  });
});

describe('buildGlobalSnapshot + mergeSnapshot (ХАБ-неймспейс, DESIGN-HUB §3)', () => {
  const globals: GlobalStats = { rewardsRedeemed: 4, dailyStreak: 7, lastPlayedDate: '2026-06-15', firstPlayedDate: '2026-06-01' };

  it('global-снапшот несёт только dailyStreak и rewardsRedeemed', () => {
    expect(buildGlobalSnapshot(globals)).toEqual({ dailyStreak: 7, rewardsRedeemed: 4 });
  });

  it('merge = global ⊕ игра; общий снапшот видит и хаб-стат, и игровой', () => {
    const merged = mergeSnapshot(buildGlobalSnapshot(globals), buildSnapshot(defaultStats(), { ...defaultCurrentGame(0), sessionScore: 500, maxTileThisGame: 256 }));
    expect(merged.rewardsRedeemed).toBe(4); // из global
    expect(merged.dailyStreak).toBe(7); // из global
    expect(merged.sessionScore).toBe(500); // из игры
    expect(merged.maxTileThisGame).toBe(256); // из игры
  });

  it('при пересечении ключей побеждает игра (но в норме множества не пересекаются)', () => {
    expect(mergeSnapshot({ dailyStreak: 7 }, { dailyStreak: 0 }).dailyStreak).toBe(0);
  });
});

describe('seedGlobals — одноразовая миграция хаб-статов из legacy 2048-stats (DESIGN-HUB §4)', () => {
  const legacy = { rewardsRedeemed: 5, dailyStreak: 3, lastPlayedDate: '2026-06-15', firstPlayedDate: '2026-06-01' };

  it('СЕНТИНЕЛ: rewardsRedeemed не задан → сеет ВСЕ глобальные поля (серия жены цела)', () => {
    const seeded = seedGlobals(defaultProgress('2026-06-16'), legacy);
    expect(seeded.rewardsRedeemed).toBe(5);
    expect(seeded.dailyStreak).toBe(3);
    expect(seeded.lastPlayedDate).toBe('2026-06-15');
    expect(seeded.firstPlayedDate).toBe('2026-06-01');
  });

  it('ИДЕМПОТЕНТНО: уже мигрированный progress (rewardsRedeemed — число) не перезатирается', () => {
    const already = { ...defaultProgress('2026-06-16'), rewardsRedeemed: 9, dailyStreak: 2, lastPlayedDate: '2026-06-16', firstPlayedDate: '2026-06-10' };
    const seeded = seedGlobals(already, legacy);
    expect(seeded.rewardsRedeemed).toBe(9);
    expect(seeded.dailyStreak).toBe(2);
    expect(seeded.lastPlayedDate).toBe('2026-06-16');
  });

  it('новый игрок без legacy → нули/null, rewardsRedeemed=0 (сентинел снят)', () => {
    const seeded = seedGlobals(defaultProgress('2026-06-16'), null);
    expect(seeded.rewardsRedeemed).toBe(0);
    expect(seeded.dailyStreak).toBe(0);
    expect(seeded.lastPlayedDate).toBeNull();
  });
});

describe('readGlobalStats + normalizeProgress (хаб-глобальные поля)', () => {
  it('readGlobalStats достаёт глобальные статы из progress с дефолтами', () => {
    expect(readGlobalStats(defaultProgress('2026-06-16'))).toEqual(defaultGlobalStats());
    expect(readGlobalStats({ ...defaultProgress('2026-06-16'), rewardsRedeemed: 3, dailyStreak: 5 })).toMatchObject({
      rewardsRedeemed: 3,
      dailyStreak: 5,
    });
  });

  it('normalizeProgress читает сохранённые глобальные поля', () => {
    const p = normalizeProgress(
      { completed: [], challengeCooldowns: {}, challengeCouponsToday: 0, couponDayDate: '2026-06-16', rewardsRedeemed: 4, dailyStreak: 2, lastPlayedDate: '2026-06-16', firstPlayedDate: null },
      '2026-06-16',
    );
    expect(p.rewardsRedeemed).toBe(4);
    expect(p.dailyStreak).toBe(2);
    expect(p.lastPlayedDate).toBe('2026-06-16');
    expect(p.firstPlayedDate).toBeNull();
  });

  it('СЕНТИНЕЛ: отсутствующие глобальные поля остаются undefined (не «выдуманы» в 0)', () => {
    const legacyShape = normalizeProgress(
      { completed: ['welcome'], challengeCooldowns: {}, challengeCouponsToday: 0, couponDayDate: '2026-06-16' },
      '2026-06-16',
    );
    expect(legacyShape.rewardsRedeemed).toBeUndefined();
    expect(legacyShape.dailyStreak).toBeUndefined();
    expect(legacyShape.lastPlayedDate).toBeUndefined();
  });
});

describe('commitGame', () => {
  it('вкатывает партию в cumulative', () => {
    const stats: CumulativeStats = { ...defaultStats(), totalScore: 1000, bestScore: 800, bestTile: 128, totalMoves: 10 };
    const game = { ...defaultCurrentGame(0), sessionScore: 1500, maxTileThisGame: 256, movesThisGame: 40 };
    const next = commitGame(stats, game);
    expect(next.totalScore).toBe(2500);
    expect(next.bestScore).toBe(1500);
    expect(next.bestTile).toBe(256);
    expect(next.totalMoves).toBe(50);
  });
});

describe('dailyCheckIn', () => {
  it('первый день: серия = 1, даты проставлены', () => {
    const next = dailyCheckIn(defaultStats(), '2026-06-15');
    expect(next.dailyStreak).toBe(1);
    expect(next.firstPlayedDate).toBe('2026-06-15');
    expect(next.lastPlayedDate).toBe('2026-06-15');
  });

  it('тот же день — серия не меняется', () => {
    const day1 = dailyCheckIn(defaultStats(), '2026-06-15');
    const again = dailyCheckIn(day1, '2026-06-15');
    expect(again.dailyStreak).toBe(1);
  });

  it('следующий день подряд — серия растёт', () => {
    const day1 = dailyCheckIn(defaultStats(), '2026-06-15');
    const day2 = dailyCheckIn(day1, '2026-06-16');
    expect(day2.dailyStreak).toBe(2);
  });

  it('пропуск дня — серия сбрасывается в 1', () => {
    const day1 = dailyCheckIn(defaultStats(), '2026-06-15');
    const day3 = dailyCheckIn(day1, '2026-06-17');
    expect(day3.dailyStreak).toBe(1);
    expect(day3.firstPlayedDate).toBe('2026-06-15'); // первый день сохраняется
  });

  it('держит серию через границу месяца', () => {
    const last = dailyCheckIn(defaultStats(), '2026-01-31');
    const next = dailyCheckIn(last, '2026-02-01');
    expect(next.dailyStreak).toBe(2);
  });
});
