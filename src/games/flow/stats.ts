// Статы Flow «Соедини фигурки» (Фаза 2). Неймспейс `fl_` — отдельный от 2048/m3/w5/bb.
// Зеркало blocks/stats.ts: per-game сбрасываются с уровнем (edge-гейт в PER_GAME_STATS),
// cumulative живут вечно, fl_maxLevel — монотонная глубина (EDGE_MONOTONIC_STATS — иначе
// веха-награда сыпалась бы на КАЖДОМ заходе, прод-баг v18).

import type { StatSnapshot } from '../../engine';
import { FL_STAT_PREFIX } from '../../ui/constants';
import { MAX_DEPTH } from '../match3/depthMirror';
import type { FlowCurrentGame } from './logic';

export type { FlowCurrentGame } from './logic';

/** Кумулятивные показатели Flow — живут вечно (ключ flow_stats). */
export interface FLCumulativeStats {
  totalScore: number;
  bestScore: number;
  gamesPlayed: number;
  /**
   * Достигнутая глубина — максимум ПРОЙДЕННОГО уровня (монотонный, level-триггер). Веха
   * выдаётся при пересечении порога; ретрай/перепрохождение максимум не растят ⇒ молчат.
   */
  maxLevel: number;
}

// Ключи снапшота из FL_STAT_PREFIX — чтобы префикс совпал с PER_GAME_STATS/EDGE_MONOTONIC_STATS
// (achievements.ts) и game:'fl' ачивками (achievements.json).
export const FL_KEYS = {
  score: `${FL_STAT_PREFIX}score`,
  moves: `${FL_STAT_PREFIX}moves`,
  bestScore: `${FL_STAT_PREFIX}bestScore`,
  totalScore: `${FL_STAT_PREFIX}totalScore`,
  gamesPlayed: `${FL_STAT_PREFIX}gamesPlayed`,
  maxLevel: `${FL_STAT_PREFIX}maxLevel`,
} as const;

export function defaultFLStats(): FLCumulativeStats {
  return { totalScore: 0, bestScore: 0, gamesPlayed: 0, maxLevel: 0 };
}

export function defaultFLGame(): FlowCurrentGame {
  return { score: 0, moves: 0 };
}

/** Мягкое чтение сохранённых cumulative-статов (битые/частичные данные не роняют игру). */
export function normalizeFLStats(raw: Partial<FLCumulativeStats> | null | undefined): FLCumulativeStats {
  const base = defaultFLStats();
  if (!raw || typeof raw !== 'object') return base;
  return {
    totalScore: typeof raw.totalScore === 'number' ? raw.totalScore : 0,
    bestScore: typeof raw.bestScore === 'number' ? raw.bestScore : 0,
    gamesPlayed: typeof raw.gamesPlayed === 'number' ? raw.gamesPlayed : 0,
    // Аддитивная миграция + клампинг к MAX_DEPTH (порченый CloudStorage-blob не пробросит абсурд).
    maxLevel: typeof raw.maxLevel === 'number' && raw.maxLevel > 0 ? Math.min(raw.maxLevel, MAX_DEPTH) : 0,
  };
}

export function normalizeFLGame(raw: Partial<FlowCurrentGame> | null | undefined): FlowCurrentGame {
  const base = defaultFLGame();
  if (!raw || typeof raw !== 'object') return base;
  return {
    score: typeof raw.score === 'number' && raw.score >= 0 ? raw.score : 0,
    moves: typeof raw.moves === 'number' && raw.moves >= 0 ? raw.moves : 0,
  };
}

/**
 * Read-repair глубины (§2.2, фикс класса «48→22»): на загрузке берём max(CloudStorage, зеркало).
 * Чистая функция ради теста «зеркало переживает».
 */
export function recoverFlowDepth(loaded: FLCumulativeStats, mirrorDepth: number): FLCumulativeStats {
  const recovered = Math.max(loaded.maxLevel, mirrorDepth);
  return recovered > loaded.maxLevel ? { ...loaded, maxLevel: recovered } : loaded;
}

/**
 * Плоский снапшот для движка наград. Cumulative берутся «вживую» (текущий уровень прибавляется к
 * итогам), иначе вехи totalScore не срабатывали бы до конца уровня. Per-game (score/moves) —
 * как есть; их edge-гейтит achievements.ts (PER_GAME_STATS).
 */
export function buildFLSnapshot(stats: FLCumulativeStats, game: FlowCurrentGame): StatSnapshot {
  return {
    [FL_KEYS.score]: game.score,
    [FL_KEYS.moves]: game.moves,
    [FL_KEYS.bestScore]: Math.max(stats.bestScore, game.score),
    [FL_KEYS.totalScore]: stats.totalScore + game.score,
    [FL_KEYS.gamesPlayed]: stats.gamesPlayed,
    // maxLevel — монотонный; level-триггер, edge-гейтится (НЕ в PER_GAME_STATS).
    [FL_KEYS.maxLevel]: stats.maxLevel,
  };
}

/** Закрытие уровня: вкатываем его показатели в cumulative. gamesPlayed считается при старте уровня. */
export function commitFLGame(stats: FLCumulativeStats, game: FlowCurrentGame): FLCumulativeStats {
  return {
    ...stats,
    totalScore: stats.totalScore + game.score,
    bestScore: Math.max(stats.bestScore, game.score),
  };
}
