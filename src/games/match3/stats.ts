import type { StatSnapshot } from '../../engine';
import { M3_STAT_PREFIX } from '../../ui/constants';

/**
 * Статы Match-3 (Фаза B). Неймспейс `m3_` (DESIGN-HUB §3) — отдельный от 2048, чтобы 25
 * существующих ачивок 2048 не зацепились. Зеркало engine/stats.ts: per-game сбрасывается с
 * партией (и edge-гейтится в achievements.ts), cumulative живёт вечно.
 */

/** Кумулятивные показатели match3 — живут вечно (ключ match3.stats). */
export interface M3CumulativeStats {
  totalScore: number;
  bestScore: number;
  gemsCleared: number;
  gamesPlayed: number;
}

/** Per-game показатели match3 — сбрасываются с новой партией (восстанавливаются при резюме). */
export interface M3CurrentGame {
  sessionScore: number;
  /** Макс. длина цепочки каскадов за один ход в этой партии. */
  maxCombo: number;
  moves: number;
  /** Макс. число фишек, убранных одним ходом в этой партии (растёт от спецфишек). */
  biggestClear: number;
  /** Фишек собрано за партию — для «живого» вклада в кумулятивный m3_gemsCleared. */
  gemsThisGame: number;
}

// Ключи снапшота строим из M3_STAT_PREFIX — чтобы префикс гарантированно совпадал с
// PER_GAME_STATS (achievements.ts) и game:'m3' ачивками (achievements.json).
export const M3_KEYS = {
  score: `${M3_STAT_PREFIX}score`,
  combo: `${M3_STAT_PREFIX}combo`,
  moves: `${M3_STAT_PREFIX}moves`,
  biggestClear: `${M3_STAT_PREFIX}biggestClear`,
  bestScore: `${M3_STAT_PREFIX}bestScore`,
  totalScore: `${M3_STAT_PREFIX}totalScore`,
  gemsCleared: `${M3_STAT_PREFIX}gemsCleared`,
  gamesPlayed: `${M3_STAT_PREFIX}gamesPlayed`,
} as const;

export function defaultM3Stats(): M3CumulativeStats {
  return { totalScore: 0, bestScore: 0, gemsCleared: 0, gamesPlayed: 0 };
}

export function defaultM3Game(): M3CurrentGame {
  return { sessionScore: 0, maxCombo: 0, moves: 0, biggestClear: 0, gemsThisGame: 0 };
}

/** Мягкое чтение сохранённых cumulative-статов (битые/частичные данные не роняют игру). */
export function normalizeM3Stats(raw: Partial<M3CumulativeStats> | null | undefined): M3CumulativeStats {
  const base = defaultM3Stats();
  if (!raw || typeof raw !== 'object') return base;
  return {
    totalScore: typeof raw.totalScore === 'number' ? raw.totalScore : 0,
    bestScore: typeof raw.bestScore === 'number' ? raw.bestScore : 0,
    gemsCleared: typeof raw.gemsCleared === 'number' ? raw.gemsCleared : 0,
    gamesPlayed: typeof raw.gamesPlayed === 'number' ? raw.gamesPlayed : 0,
  };
}

export function normalizeM3Game(raw: Partial<M3CurrentGame> | null | undefined): M3CurrentGame {
  const base = defaultM3Game();
  if (!raw || typeof raw !== 'object') return base;
  return {
    sessionScore: typeof raw.sessionScore === 'number' ? raw.sessionScore : 0,
    maxCombo: typeof raw.maxCombo === 'number' ? raw.maxCombo : 0,
    moves: typeof raw.moves === 'number' ? raw.moves : 0,
    biggestClear: typeof raw.biggestClear === 'number' ? raw.biggestClear : 0,
    gemsThisGame: typeof raw.gemsThisGame === 'number' ? raw.gemsThisGame : 0,
  };
}

/**
 * Плоский снапшот match3 для движка. Cumulative берутся «вживую» (текущая партия
 * прибавляется к итогам — как buildSnapshot 2048), иначе вехи totalScore/gemsCleared
 * не срабатывали бы до конца партии. Per-game (score/combo/moves/biggestClear) —
 * как есть; их edge-гейтит achievements.ts (PER_GAME_STATS).
 */
export function buildM3Snapshot(stats: M3CumulativeStats, game: M3CurrentGame): StatSnapshot {
  return {
    [M3_KEYS.score]: game.sessionScore,
    [M3_KEYS.combo]: game.maxCombo,
    [M3_KEYS.moves]: game.moves,
    [M3_KEYS.biggestClear]: game.biggestClear,
    [M3_KEYS.bestScore]: Math.max(stats.bestScore, game.sessionScore),
    [M3_KEYS.totalScore]: stats.totalScore + game.sessionScore,
    [M3_KEYS.gemsCleared]: stats.gemsCleared + game.gemsThisGame,
    [M3_KEYS.gamesPlayed]: stats.gamesPlayed,
  };
}

/** Закрытие партии: вкатываем её показатели в cumulative. gamesPlayed считается при старте. */
export function commitM3Game(stats: M3CumulativeStats, game: M3CurrentGame): M3CumulativeStats {
  return {
    ...stats,
    totalScore: stats.totalScore + game.sessionScore,
    bestScore: Math.max(stats.bestScore, game.sessionScore),
    gemsCleared: stats.gemsCleared + game.gemsThisGame,
  };
}
