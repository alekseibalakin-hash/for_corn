import { describe, expect, it } from 'vitest';
import {
  buildM3Snapshot,
  commitM3Game,
  defaultM3Game,
  defaultM3Stats,
  M3_KEYS,
  normalizeM3Game,
  normalizeM3Stats,
} from './stats';

describe('buildM3Snapshot', () => {
  it('per-game поля — как есть, cumulative — «вживую» (партия прибавляется к итогам)', () => {
    const stats = { totalScore: 1000, bestScore: 800, gemsCleared: 500, gamesPlayed: 4, combos: 7 };
    const game = { sessionScore: 1200, maxCombo: 5, moves: 30, biggestClear: 18, gemsThisGame: 90 };
    const snap = buildM3Snapshot(stats, game);
    expect(snap[M3_KEYS.score]).toBe(1200);
    expect(snap[M3_KEYS.combo]).toBe(5);
    expect(snap[M3_KEYS.moves]).toBe(30);
    expect(snap[M3_KEYS.biggestClear]).toBe(18);
    // bestScore = max(800, 1200); totalScore = 1000+1200; gemsCleared = 500+90
    expect(snap[M3_KEYS.bestScore]).toBe(1200);
    expect(snap[M3_KEYS.totalScore]).toBe(2200);
    expect(snap[M3_KEYS.gemsCleared]).toBe(590);
    expect(snap[M3_KEYS.gamesPlayed]).toBe(4);
    // combos — кумулятивный (level), эмитится как есть (инкремент делает useMatch3 в сами stats).
    expect(snap[M3_KEYS.combos]).toBe(7);
  });

  it('все ключи снапшота начинаются с префикса m3_', () => {
    const snap = buildM3Snapshot(defaultM3Stats(), defaultM3Game());
    expect(Object.keys(snap).every((k) => k.startsWith('m3_'))).toBe(true);
  });
});

describe('commitM3Game', () => {
  it('вкатывает партию в cumulative, gamesPlayed/combos не трогает (combos переносится как есть)', () => {
    const stats = { totalScore: 1000, bestScore: 800, gemsCleared: 500, gamesPlayed: 4, combos: 7 };
    const game = { sessionScore: 1200, maxCombo: 5, moves: 30, biggestClear: 18, gemsThisGame: 90 };
    expect(commitM3Game(stats, game)).toEqual({
      totalScore: 2200,
      bestScore: 1200,
      gemsCleared: 590,
      gamesPlayed: 4,
      combos: 7,
    });
  });
});

describe('normalize (мягкое чтение хранилища)', () => {
  it('битые/пустые данные → дефолты', () => {
    expect(normalizeM3Stats(null)).toEqual(defaultM3Stats());
    expect(normalizeM3Game(undefined)).toEqual(defaultM3Game());
    expect(normalizeM3Stats({ totalScore: 'x' } as never)).toEqual(defaultM3Stats());
  });

  it('частичные данные дополняются дефолтами', () => {
    expect(normalizeM3Stats({ totalScore: 50 })).toEqual({ totalScore: 50, bestScore: 0, gemsCleared: 0, gamesPlayed: 0, combos: 0 });
  });

  it('combos читается из хранилища (аддитивная миграция: старые данные без combos → 0)', () => {
    expect(normalizeM3Stats({ combos: 12 }).combos).toBe(12);
    expect(normalizeM3Stats({ totalScore: 5 }).combos).toBe(0); // старый сейв без поля → 0
  });
});
