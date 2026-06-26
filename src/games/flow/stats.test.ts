import { describe, expect, it } from 'vitest';
import { MAX_DEPTH } from '../match3/depthMirror';
import { STORAGE_KEYS } from '../../storage/types';
import {
  FL_KEYS,
  buildFLSnapshot,
  commitFLGame,
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
    const loaded = { totalScore: 999, bestScore: 200, gamesPlayed: 5, maxLevel: 3 };
    const recovered = recoverFlowDepth(loaded, 9);
    expect(recovered).toEqual({ ...loaded, maxLevel: 9 });
  });
});

describe('buildFLSnapshot — плоский снапшот для движка наград', () => {
  it('per-game (score/moves) — как есть; cumulative totalScore/bestScore — с текущим уровнем', () => {
    const stats = { totalScore: 500, bestScore: 200, gamesPlayed: 3, maxLevel: 4 };
    const game = { score: 250, moves: 18 };
    const snap = buildFLSnapshot(stats, game);
    expect(snap[FL_KEYS.score]).toBe(250);
    expect(snap[FL_KEYS.moves]).toBe(18);
    expect(snap[FL_KEYS.totalScore]).toBe(750); // 500 + 250 (живой вклад)
    expect(snap[FL_KEYS.bestScore]).toBe(250); // max(200, 250)
    expect(snap[FL_KEYS.gamesPlayed]).toBe(3);
    expect(snap[FL_KEYS.maxLevel]).toBe(4);
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

  it('все ключи снапшота под префиксом fl_ (совпадение с achievements.ts / game:\'fl\')', () => {
    const snap = buildFLSnapshot(defaultFLStats(), defaultFLGame());
    for (const key of Object.keys(snap)) expect(key.startsWith('fl_')).toBe(true);
  });
});

describe('commitFLGame — закрытие уровня вкатывает очки в cumulative', () => {
  it('totalScore += score, bestScore = max; maxLevel/gamesPlayed не трогает', () => {
    const stats = { totalScore: 100, bestScore: 80, gamesPlayed: 2, maxLevel: 3 };
    const game = { score: 250, moves: 10 };
    const next = commitFLGame(stats, game);
    expect(next.totalScore).toBe(350);
    expect(next.bestScore).toBe(250);
    expect(next.maxLevel).toBe(3);
    expect(next.gamesPlayed).toBe(2);
  });

  it('сохраняет поднятую на победе maxLevel (commit поверх bumped stats)', () => {
    const bumped = { totalScore: 0, bestScore: 0, gamesPlayed: 1, maxLevel: 7 };
    const game = { score: 360, moves: 8 };
    expect(commitFLGame(bumped, game).maxLevel).toBe(7);
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
