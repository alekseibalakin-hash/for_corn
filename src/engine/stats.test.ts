import { describe, expect, it } from 'vitest';
import { buildSnapshot, commitGame, dailyCheckIn, defaultCurrentGame, defaultStats, normalizeProgress } from './stats';
import type { CumulativeStats } from './types';

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
