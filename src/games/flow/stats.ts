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
  /** Сумма звёзд за все уровни (1-3 за уровень; монотонная — EDGE_MONOTONIC_STATS). Фаза 2.5. */
  totalStars: number;
  /** Число уровней пройденных идеально (3★, moves===K). Монотонная — EDGE_MONOTONIC_STATS. Фаза 2.5. */
  perfectCount: number;
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
  totalStars: `${FL_STAT_PREFIX}totalStars`,
  perfectCount: `${FL_STAT_PREFIX}perfectCount`,
} as const;

export function defaultFLStats(): FLCumulativeStats {
  return { totalScore: 0, bestScore: 0, gamesPlayed: 0, maxLevel: 0, totalStars: 0, perfectCount: 0 };
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
    // Аддитивная миграция Фазы 2.5: старый blob без этих полей → 0 (не undefined/не падение).
    totalStars: typeof raw.totalStars === 'number' && raw.totalStars >= 0 ? raw.totalStars : 0,
    perfectCount: typeof raw.perfectCount === 'number' && raw.perfectCount >= 0 ? raw.perfectCount : 0,
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
 * Фаза 2.5: game.stars (звёзды этого уровня, undefined=не выиграно/резюм=0) добавляется живым
 * суммой к totalStars/perfectCount — точно как game.score → totalScore. Edge-гейтятся.
 */
export function buildFLSnapshot(stats: FLCumulativeStats, game: FlowCurrentGame): StatSnapshot {
  const winStars = game.stars ?? 0;
  return {
    [FL_KEYS.score]: game.score,
    [FL_KEYS.moves]: game.moves,
    [FL_KEYS.bestScore]: Math.max(stats.bestScore, game.score),
    [FL_KEYS.totalScore]: stats.totalScore + game.score,
    [FL_KEYS.gamesPlayed]: stats.gamesPlayed,
    // maxLevel — монотонный; level-триггер, edge-гейтится (НЕ в PER_GAME_STATS).
    [FL_KEYS.maxLevel]: stats.maxLevel,
    // Фаза 2.5: монотонные счётчики звёзд — edge-гейтятся в EDGE_MONOTONIC_STATS.
    [FL_KEYS.totalStars]: stats.totalStars + winStars,
    [FL_KEYS.perfectCount]: stats.perfectCount + (winStars === 3 ? 1 : 0),
  };
}

/** Закрытие уровня: вкатываем его показатели в cumulative. gamesPlayed считается при старте уровня. */
export function commitFLGame(stats: FLCumulativeStats, game: FlowCurrentGame): FLCumulativeStats {
  const winStars = game.stars ?? 0;
  return {
    ...stats,
    totalScore: stats.totalScore + game.score,
    bestScore: Math.max(stats.bestScore, game.score),
    totalStars: stats.totalStars + winStars,
    perfectCount: stats.perfectCount + (winStars === 3 ? 1 : 0),
  };
}

/**
 * Число звёзд за уровень. par = K (кол-во пар). Фаза 2.5.
 *  3★ «Идеально»:  moves === K (каждую пару ровно одним штрихом, без перерисовок).
 *  2★ «Хорошо»:    moves <= Math.ceil(K * 1.6) (пара поправок).
 *  1★:             решено (любые ходы).
 */
export function computeFlowStars(moves: number, K: number): 1 | 2 | 3 {
  if (K <= 0) return 1;
  if (moves === K) return 3;
  if (moves <= Math.ceil(K * 1.6)) return 2;
  return 1;
}
