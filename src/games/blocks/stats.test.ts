import { describe, expect, it } from 'vitest';
import { MAX_DEPTH } from '../match3/depthMirror';
import {
  BB_KEYS,
  buildBBSnapshot,
  commitBBGame,
  defaultBBGame,
  defaultBBStats,
  normalizeBBGame,
  normalizeBBStats,
  recoverBBDepth,
} from './stats';

describe('normalizeBBStats — мягкое чтение cumulative-статов (аддитивная миграция)', () => {
  it('null/мусор → дефолт (нули), не кидает', () => {
    expect(normalizeBBStats(null)).toEqual(defaultBBStats());
    expect(normalizeBBStats(undefined)).toEqual(defaultBBStats());
    expect(normalizeBBStats(123 as never)).toEqual(defaultBBStats());
  });

  it('частичный blob (без maxLevel) → глубина 0 (не undefined, не падение на cold load)', () => {
    const s = normalizeBBStats({ totalScore: 50 });
    expect(s.maxLevel).toBe(0);
    expect(s.totalScore).toBe(50);
  });

  it('maxLevel клампится к MAX_DEPTH (порченый CloudStorage-blob не пробросит абсурд)', () => {
    expect(normalizeBBStats({ maxLevel: 99999 }).maxLevel).toBe(MAX_DEPTH);
  });

  it('отрицательный/нулевой maxLevel → 0', () => {
    expect(normalizeBBStats({ maxLevel: -5 }).maxLevel).toBe(0);
    expect(normalizeBBStats({ maxLevel: 0 }).maxLevel).toBe(0);
  });
});

describe('recoverBBDepth — read-repair max(cloud, зеркало) (§2.2, фикс класса «48→22»)', () => {
  it('зеркало впереди CloudStorage → берём зеркало (зеркало «переживает» отставший cloud)', () => {
    const loaded = { ...defaultBBStats(), maxLevel: 22 };
    const recovered = recoverBBDepth(loaded, 48);
    expect(recovered.maxLevel).toBe(48);
  });

  it('CloudStorage впереди зеркала → берём cloud (зеркало отстало/чисто)', () => {
    const loaded = { ...defaultBBStats(), maxLevel: 30 };
    expect(recoverBBDepth(loaded, 10).maxLevel).toBe(30);
  });

  it('равны → тот же объект (без лишнего ре-рендера/записи)', () => {
    const loaded = { ...defaultBBStats(), maxLevel: 12 };
    expect(recoverBBDepth(loaded, 12)).toBe(loaded);
  });

  it('зеркало 0 (нет/чисто) → cloud как есть', () => {
    const loaded = { ...defaultBBStats(), maxLevel: 7 };
    expect(recoverBBDepth(loaded, 0)).toBe(loaded);
  });

  it('прочие поля cumulative сохраняются при подъёме глубины', () => {
    const loaded = { totalScore: 999, bestScore: 500, gamesPlayed: 8, maxLevel: 5 };
    const recovered = recoverBBDepth(loaded, 9);
    expect(recovered).toEqual({ ...loaded, maxLevel: 9 });
  });
});

describe('buildBBSnapshot — плоский снапшот для движка наград', () => {
  it('per-game берутся как есть; cumulative — «вживую» (текущий уровень прибавляется)', () => {
    const stats = { totalScore: 1000, bestScore: 400, gamesPlayed: 5, maxLevel: 3 };
    const game = { ...defaultBBGame(), sessionScore: 250, moves: 7, bestLines: 2 };
    const snap = buildBBSnapshot(stats, game);
    expect(snap[BB_KEYS.score]).toBe(250);
    expect(snap[BB_KEYS.lines]).toBe(2);
    expect(snap[BB_KEYS.moves]).toBe(7);
    expect(snap[BB_KEYS.totalScore]).toBe(1250); // 1000 + 250 (живой вклад)
    expect(snap[BB_KEYS.bestScore]).toBe(400); // max(400, 250)
    expect(snap[BB_KEYS.gamesPlayed]).toBe(5);
    expect(snap[BB_KEYS.maxLevel]).toBe(3);
  });

  it('победа: поднятый maxLevel в stats отражается в снапшоте (веха глубины срабатывает на ходе победы)', () => {
    const before = { ...defaultBBStats(), maxLevel: 4 };
    const after = { ...before, maxLevel: 5 }; // бамп на победе level 5 ПЕРЕД grant
    expect(buildBBSnapshot(before, defaultBBGame())[BB_KEYS.maxLevel]).toBe(4);
    expect(buildBBSnapshot(after, defaultBBGame())[BB_KEYS.maxLevel]).toBe(5);
  });

  it('bestScore учитывает текущую сессию, если она выше сохранённого рекорда', () => {
    const stats = { ...defaultBBStats(), bestScore: 100 };
    const game = { ...defaultBBGame(), sessionScore: 300 };
    expect(buildBBSnapshot(stats, game)[BB_KEYS.bestScore]).toBe(300);
  });

  it('все ключи снапшота под префиксом bb_ (совпадение с PER_GAME/EDGE_MONOTONIC и game:bb)', () => {
    const snap = buildBBSnapshot(defaultBBStats(), defaultBBGame());
    for (const key of Object.keys(snap)) expect(key.startsWith('bb_')).toBe(true);
  });
});

describe('commitBBGame — закрытие уровня вкатывает очки в cumulative', () => {
  it('totalScore += sessionScore, bestScore = max; maxLevel/gamesPlayed не трогает', () => {
    const stats = { totalScore: 100, bestScore: 80, gamesPlayed: 2, maxLevel: 3 };
    const game = { ...defaultBBGame(), sessionScore: 120 };
    const next = commitBBGame(stats, game);
    expect(next.totalScore).toBe(220);
    expect(next.bestScore).toBe(120);
    expect(next.maxLevel).toBe(3);
    expect(next.gamesPlayed).toBe(2);
  });

  it('сохраняет поднятую на победе maxLevel (commit поверх bumped stats)', () => {
    const bumped = { totalScore: 0, bestScore: 0, gamesPlayed: 1, maxLevel: 5 };
    const game = { ...defaultBBGame(), sessionScore: 50 };
    expect(commitBBGame(bumped, game).maxLevel).toBe(5);
  });
});

describe('normalizeBBGame — мягкое чтение per-game', () => {
  it('null/мусор → дефолт', () => {
    expect(normalizeBBGame(null)).toEqual(defaultBBGame());
    expect(normalizeBBGame({ sessionScore: 'x' } as never)).toEqual(defaultBBGame());
  });
  it('частичный blob дополняется дефолтами', () => {
    expect(normalizeBBGame({ sessionScore: 40 })).toEqual({ sessionScore: 40, moves: 0, bestLines: 0 });
  });
});
