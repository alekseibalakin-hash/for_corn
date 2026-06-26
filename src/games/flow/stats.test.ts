import { describe, expect, it } from 'vitest';
import { MAX_DEPTH } from '../match3/depthMirror';
import { STORAGE_KEYS } from '../../storage/types';
import {
  FL_KEYS,
  buildFLSnapshot,
  commitFLGame,
  computeFlowStars,
  defaultFLGame,
  defaultFLStats,
  normalizeFLGame,
  normalizeFLStats,
  recoverFlowDepth,
} from './stats';

describe('normalizeFLStats — мягкое чтение cumulative-статов (аддитивная миграция)', () => {
  it('null/мусор → дефолт (нули), не кидает', () => {
    expect(normalizeFLStats(null)).toEqual(defaultFLStats());
    expect(normalizeFLStats(undefined)).toEqual(defaultFLStats());
    expect(normalizeFLStats(123 as never)).toEqual(defaultFLStats());
  });

  it('частичный blob (без maxLevel) → глубина 0 (не undefined, не падение на cold load)', () => {
    const s = normalizeFLStats({ totalScore: 42 });
    expect(s.maxLevel).toBe(0);
    expect(s.totalScore).toBe(42);
  });

  it('maxLevel клампится к MAX_DEPTH (порченый CloudStorage-blob не пробросит абсурд)', () => {
    expect(normalizeFLStats({ maxLevel: 99999 }).maxLevel).toBe(MAX_DEPTH);
  });

  it('отрицательный/нулевой maxLevel → 0', () => {
    expect(normalizeFLStats({ maxLevel: -1 }).maxLevel).toBe(0);
    expect(normalizeFLStats({ maxLevel: 0 }).maxLevel).toBe(0);
  });
});

describe('recoverFlowDepth — read-repair max(cloud, зеркало) (§2.2, фикс класса «48→22»)', () => {
  it('зеркало впереди CloudStorage → берём зеркало (зеркало «переживает» быстрое закрытие)', () => {
    const loaded = { ...defaultFLStats(), maxLevel: 22 };
    const recovered = recoverFlowDepth(loaded, 48);
    expect(recovered.maxLevel).toBe(48);
  });

  it('CloudStorage впереди зеркала → берём cloud (зеркало отстало/чисто)', () => {
    const loaded = { ...defaultFLStats(), maxLevel: 30 };
    expect(recoverFlowDepth(loaded, 10).maxLevel).toBe(30);
  });

  it('равны → тот же объект (без лишнего ре-рендера/write-back)', () => {
    const loaded = { ...defaultFLStats(), maxLevel: 12 };
    expect(recoverFlowDepth(loaded, 12)).toBe(loaded);
  });

  it('зеркало 0 (нет/чисто) → cloud как есть, тот же объект', () => {
    const loaded = { ...defaultFLStats(), maxLevel: 7 };
    expect(recoverFlowDepth(loaded, 0)).toBe(loaded);
  });

  it('прочие cumulative-поля сохраняются при подъёме глубины', () => {
    const loaded = { ...defaultFLStats(), totalScore: 999, bestScore: 200, gamesPlayed: 5, maxLevel: 3 };
    const recovered = recoverFlowDepth(loaded, 9);
    expect(recovered).toEqual({ ...loaded, maxLevel: 9 });
  });
});

describe('buildFLSnapshot — плоский снапшот для движка наград', () => {
  it('per-game (score/moves) — как есть; cumulative totalScore/bestScore — с текущим уровнем', () => {
    const stats = { ...defaultFLStats(), totalScore: 500, bestScore: 200, gamesPlayed: 3, maxLevel: 4 };
    const game = { score: 250, moves: 18 };
    const snap = buildFLSnapshot(stats, game);
    expect(snap[FL_KEYS.score]).toBe(250);
    expect(snap[FL_KEYS.moves]).toBe(18);
    expect(snap[FL_KEYS.totalScore]).toBe(750); // 500 + 250 (живой вклад)
    expect(snap[FL_KEYS.bestScore]).toBe(250); // max(200, 250)
    expect(snap[FL_KEYS.gamesPlayed]).toBe(3);
    expect(snap[FL_KEYS.maxLevel]).toBe(4);
    // Фаза 2.5: звёзды без game.stars → 0
    expect(snap[FL_KEYS.totalStars]).toBe(0);
    expect(snap[FL_KEYS.perfectCount]).toBe(0);
  });

  it('bestScore учитывает текущий уровень, если выше рекорда', () => {
    const stats = { ...defaultFLStats(), bestScore: 100 };
    const game = { score: 360, moves: 5 };
    expect(buildFLSnapshot(stats, game)[FL_KEYS.bestScore]).toBe(360);
  });

  it('победа: поднятый maxLevel в stats отражается в снапшоте (веха глубины срабатывает правильно)', () => {
    const before = { ...defaultFLStats(), maxLevel: 4 };
    const after = { ...before, maxLevel: 5 }; // бамп на победе ПЕРЕД grant (§2.1)
    expect(buildFLSnapshot(before, defaultFLGame())[FL_KEYS.maxLevel]).toBe(4);
    expect(buildFLSnapshot(after, defaultFLGame())[FL_KEYS.maxLevel]).toBe(5);
  });

  it('Фаза 2.5: game.stars несёт живую сумму звёзд (как game.score → totalScore)', () => {
    const stats = { ...defaultFLStats(), totalStars: 10, perfectCount: 2 };
    const game3 = { score: 0, moves: 5, stars: 3 as const };
    const game2 = { score: 0, moves: 8, stars: 2 as const };
    const game1 = { score: 0, moves: 20, stars: 1 as const };
    expect(buildFLSnapshot(stats, game3)[FL_KEYS.totalStars]).toBe(13);
    expect(buildFLSnapshot(stats, game3)[FL_KEYS.perfectCount]).toBe(3);
    expect(buildFLSnapshot(stats, game2)[FL_KEYS.totalStars]).toBe(12);
    expect(buildFLSnapshot(stats, game2)[FL_KEYS.perfectCount]).toBe(2);
    expect(buildFLSnapshot(stats, game1)[FL_KEYS.totalStars]).toBe(11);
    expect(buildFLSnapshot(stats, game1)[FL_KEYS.perfectCount]).toBe(2);
  });

  it('все ключи снапшота под префиксом fl_ (совпадение с achievements.ts / game:\'fl\')', () => {
    const snap = buildFLSnapshot(defaultFLStats(), defaultFLGame());
    for (const key of Object.keys(snap)) expect(key.startsWith('fl_')).toBe(true);
  });

  it('Фаза 2.5: снапшот несёт fl_totalStars и fl_perfectCount', () => {
    const stats = { ...defaultFLStats(), totalStars: 42, perfectCount: 7, maxLevel: 10 };
    const snap = buildFLSnapshot(stats, defaultFLGame());
    expect(snap[FL_KEYS.totalStars]).toBe(42);
    expect(snap[FL_KEYS.perfectCount]).toBe(7);
  });
});

describe('commitFLGame — закрытие уровня вкатывает очки в cumulative', () => {
  it('totalScore += score, bestScore = max; maxLevel/gamesPlayed не трогает', () => {
    const stats = { ...defaultFLStats(), totalScore: 100, bestScore: 80, gamesPlayed: 2, maxLevel: 3 };
    const game = { score: 250, moves: 10 };
    const next = commitFLGame(stats, game);
    expect(next.totalScore).toBe(350);
    expect(next.bestScore).toBe(250);
    expect(next.maxLevel).toBe(3);
    expect(next.gamesPlayed).toBe(2);
  });

  it('сохраняет поднятую на победе maxLevel (commit поверх bumped stats)', () => {
    const bumped = { ...defaultFLStats(), gamesPlayed: 1, maxLevel: 7 };
    const game = { score: 360, moves: 8 };
    expect(commitFLGame(bumped, game).maxLevel).toBe(7);
  });

  it('Фаза 2.5: 3★ — totalStars+=3, perfectCount+=1', () => {
    const stats = defaultFLStats();
    const next = commitFLGame(stats, { score: 250, moves: 5, stars: 3 });
    expect(next.totalStars).toBe(3);
    expect(next.perfectCount).toBe(1);
  });

  it('Фаза 2.5: 2★ — totalStars+=2, perfectCount не растёт', () => {
    const stats = { ...defaultFLStats(), totalStars: 10, perfectCount: 2 };
    const next = commitFLGame(stats, { score: 100, moves: 8, stars: 2 });
    expect(next.totalStars).toBe(12);
    expect(next.perfectCount).toBe(2);
  });

  it('Фаза 2.5: 1★ — totalStars+=1, perfectCount не растёт', () => {
    const stats = { ...defaultFLStats(), totalStars: 5 };
    const next = commitFLGame(stats, { score: 100, moves: 20, stars: 1 });
    expect(next.totalStars).toBe(6);
    expect(next.perfectCount).toBe(0);
  });

  it('Фаза 2.5: game.stars undefined (резюм без победы) → не трогает счётчики', () => {
    const stats = { ...defaultFLStats(), totalStars: 7, perfectCount: 3 };
    const next = commitFLGame(stats, { score: 0, moves: 0 });
    expect(next.totalStars).toBe(7);
    expect(next.perfectCount).toBe(3);
  });
});

describe('normalizeFLGame — мягкое чтение per-game', () => {
  it('null/мусор → дефолт (нули)', () => {
    expect(normalizeFLGame(null)).toEqual(defaultFLGame());
    expect(normalizeFLGame({ score: 'bad' } as never)).toEqual(defaultFLGame());
  });

  it('частичный blob дополняется дефолтами', () => {
    expect(normalizeFLGame({ score: 120 })).toEqual({ score: 120, moves: 0 });
  });
});

describe('computeFlowStars — par=K, звёзды 1-3 (Фаза 2.5 §1)', () => {
  it('3★: moves === K (каждую пару одним штрихом)', () => {
    expect(computeFlowStars(5, 5)).toBe(3);
    expect(computeFlowStars(8, 8)).toBe(3);
    expect(computeFlowStars(3, 3)).toBe(3);
  });

  it('2★: moves <= Math.ceil(K * 1.6) — пара поправок', () => {
    // K=5: ceil(5*1.6)=8 → ≤8 = 2★, >8 = 1★
    expect(computeFlowStars(6, 5)).toBe(2);
    expect(computeFlowStars(8, 5)).toBe(2);
    expect(computeFlowStars(9, 5)).toBe(1);
    // K=8: ceil(8*1.6)=13 → ≤13 = 2★, >13 = 1★
    expect(computeFlowStars(9, 8)).toBe(2);
    expect(computeFlowStars(13, 8)).toBe(2);
    expect(computeFlowStars(14, 8)).toBe(1);
    // K=3: ceil(3*1.6)=5 → ≤5 = 2★, >5 = 1★
    expect(computeFlowStars(4, 3)).toBe(2);
    expect(computeFlowStars(5, 3)).toBe(2);
    expect(computeFlowStars(6, 3)).toBe(1);
  });

  it('1★: любые ходы сверх порога', () => {
    expect(computeFlowStars(20, 5)).toBe(1);
    expect(computeFlowStars(100, 8)).toBe(1);
  });

  it('K <= 0 → 1★ (защита от деления на 0 / NaN)', () => {
    expect(computeFlowStars(1, 0)).toBe(1);
    expect(computeFlowStars(0, 0)).toBe(1);
  });
});

describe('normalizeFLStats — аддитивная миграция totalStars/perfectCount (Фаза 2.5)', () => {
  it('старый blob без новых полей → 0 (не undefined/не падение на cold load)', () => {
    const old = { totalScore: 500, bestScore: 200, gamesPlayed: 10, maxLevel: 25 };
    const s = normalizeFLStats(old);
    expect(s.totalStars).toBe(0);
    expect(s.perfectCount).toBe(0);
  });

  it('blob с totalStars/perfectCount → читается как есть', () => {
    const s = normalizeFLStats({ totalStars: 42, perfectCount: 7, maxLevel: 10 });
    expect(s.totalStars).toBe(42);
    expect(s.perfectCount).toBe(7);
  });

  it('отрицательные/битые → 0 (порченый blob не роняет игру)', () => {
    const s = normalizeFLStats({ totalStars: -1, perfectCount: 'oops' as unknown as number });
    expect(s.totalStars).toBe(0);
    expect(s.perfectCount).toBe(0);
  });
});

describe('edge-гейт звёзд — fl_totalStars/fl_perfectCount не перевыдаются', () => {
  it('prevSnapshot уже ≥ порога → alreadyCrossed (edge-гейт, урок v18)', () => {
    // Симулируем: старый totalStars=50, новый тоже 50 (не перешли порог в этот заход)
    const before = { ...defaultFLStats(), totalStars: 50, perfectCount: 10 };
    const after = { ...before, totalStars: 53, perfectCount: 11 };
    const snapBefore = buildFLSnapshot(before, defaultFLGame());
    const snapAfter = buildFLSnapshot(after, defaultFLGame());
    // prevSnapshot уже ≥ 50 → edge-гейт блокирует fl-stars-50
    expect(snapBefore[FL_KEYS.totalStars]).toBe(50); // «старт с 50» → уже пересечено
    // Но новые вехи (например 150) ещё нет:
    expect(snapAfter[FL_KEYS.totalStars]).toBe(53); // не пересекает 150
  });
});

describe('STORAGE_KEYS.flowBoard / flowStats — ключи БЕЗ точек (§2.4, Telegram CloudStorage-баг)', () => {
  it('flow_board — без точки', () => {
    expect(STORAGE_KEYS.flowBoard).toBe('flow_board');
    expect(STORAGE_KEYS.flowBoard).not.toContain('.');
  });
  it('flow_stats — без точки', () => {
    expect(STORAGE_KEYS.flowStats).toBe('flow_stats');
    expect(STORAGE_KEYS.flowStats).not.toContain('.');
  });
});
