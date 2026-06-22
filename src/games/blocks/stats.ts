// Статы «Блоков-фигур» (Фаза 2). Неймспейс `bb_` (DESIGN-BLOCKS.md §6) — отдельный от 2048/m3/w5,
// чтобы их ачивки не зацепились. Зеркало match3/stats.ts: per-game сбрасывается с уровнем (и edge-
// гейтится в achievements.ts: PER_GAME_STATS), cumulative живёт вечно, bb_maxLevel — монотонная глубина
// (EDGE_MONOTONIC_STATS — иначе веха-награда сыпалась бы на КАЖДОМ заходе, прод-баг v18).

import type { StatSnapshot } from '../../engine';
import { BB_STAT_PREFIX } from '../../ui/constants';
import { MAX_DEPTH } from '../match3/depthMirror';

/** Кумулятивные показатели «блоков» — живут вечно (ключ bb_stats). */
export interface BBCumulativeStats {
  totalScore: number;
  bestScore: number;
  gamesPlayed: number;
  /**
   * Достигнутая ГЛУБИНА — максимум ПРОЙДЕННОГО уровня (монотонный, level-триггер). НЕ счётчик
   * прохождений (тот провоцировал бы грайнд ретраями). Не теряется при проигрыше/выходе. Веха
   * выдаётся при пересечении порога; ретрай/перепрохождение максимум не растят ⇒ молчат (бриф §5).
   */
  maxLevel: number;
}

/** Per-game показатели — сбрасываются с новым уровнем (восстанавливаются при резюме). */
export interface BBCurrentGame {
  /** Очки за текущий уровень. */
  sessionScore: number;
  /** Ходов (размещений фигур) на этом уровне. */
  moves: number;
  /** Макс. число линий (ряды+столбцы), сожжённых ОДНИМ размещением на этом уровне (комбо-линии). */
  bestLines: number;
}

// Ключи снапшота строим из BB_STAT_PREFIX — чтобы префикс гарантированно совпал с PER_GAME_STATS/
// EDGE_MONOTONIC_STATS (achievements.ts) и game:'bb' ачивками (achievements.json).
export const BB_KEYS = {
  score: `${BB_STAT_PREFIX}score`,
  lines: `${BB_STAT_PREFIX}lines`,
  moves: `${BB_STAT_PREFIX}moves`,
  bestScore: `${BB_STAT_PREFIX}bestScore`,
  totalScore: `${BB_STAT_PREFIX}totalScore`,
  gamesPlayed: `${BB_STAT_PREFIX}gamesPlayed`,
  maxLevel: `${BB_STAT_PREFIX}maxLevel`,
} as const;

export function defaultBBStats(): BBCumulativeStats {
  return { totalScore: 0, bestScore: 0, gamesPlayed: 0, maxLevel: 0 };
}

export function defaultBBGame(): BBCurrentGame {
  return { sessionScore: 0, moves: 0, bestLines: 0 };
}

/** Мягкое чтение сохранённых cumulative-статов (битые/частичные данные не роняют игру). */
export function normalizeBBStats(raw: Partial<BBCumulativeStats> | null | undefined): BBCumulativeStats {
  const base = defaultBBStats();
  if (!raw || typeof raw !== 'object') return base;
  return {
    totalScore: typeof raw.totalScore === 'number' ? raw.totalScore : 0,
    bestScore: typeof raw.bestScore === 'number' ? raw.bestScore : 0,
    gamesPlayed: typeof raw.gamesPlayed === 'number' ? raw.gamesPlayed : 0,
    // Аддитивная миграция + клампинг к MAX_DEPTH (как зеркало): порченый CloudStorage-blob не пробросит
    // абсурд. Забыть это поле = тихо обнулить глубину на cold load (урок спайси, бриф §2.2/§5).
    maxLevel: typeof raw.maxLevel === 'number' && raw.maxLevel > 0 ? Math.min(raw.maxLevel, MAX_DEPTH) : 0,
  };
}

export function normalizeBBGame(raw: Partial<BBCurrentGame> | null | undefined): BBCurrentGame {
  const base = defaultBBGame();
  if (!raw || typeof raw !== 'object') return base;
  return {
    sessionScore: typeof raw.sessionScore === 'number' ? raw.sessionScore : 0,
    moves: typeof raw.moves === 'number' ? raw.moves : 0,
    bestLines: typeof raw.bestLines === 'number' ? raw.bestLines : 0,
  };
}

/**
 * Read-repair глубины (§2.2 бриф, прод-баг «48→22»): на загрузке берём max(CloudStorage, зеркало).
 * Async CloudStorage может отстать от синхронного localStorage-зеркала (запись не долетела при быстром
 * закрытии). Чистая функция ради теста «зеркало переживает» (зеркало depthMirror.test). Возвращает
 * stats с поднятой глубиной, если зеркало впереди; иначе — те же stats (==, без лишнего ре-рендера).
 */
export function recoverBBDepth(loaded: BBCumulativeStats, mirrorDepth: number): BBCumulativeStats {
  const recovered = Math.max(loaded.maxLevel, mirrorDepth);
  return recovered > loaded.maxLevel ? { ...loaded, maxLevel: recovered } : loaded;
}

/**
 * Плоский снапшот для движка наград. Cumulative берутся «вживую» (текущий уровень прибавляется к
 * итогам — как buildM3Snapshot), иначе вехи totalScore не срабатывали бы до конца уровня. Per-game
 * (score/lines/moves) — как есть; их edge-гейтит achievements.ts (PER_GAME_STATS).
 */
export function buildBBSnapshot(stats: BBCumulativeStats, game: BBCurrentGame): StatSnapshot {
  return {
    [BB_KEYS.score]: game.sessionScore,
    [BB_KEYS.lines]: game.bestLines,
    [BB_KEYS.moves]: game.moves,
    [BB_KEYS.bestScore]: Math.max(stats.bestScore, game.sessionScore),
    [BB_KEYS.totalScore]: stats.totalScore + game.sessionScore,
    [BB_KEYS.gamesPlayed]: stats.gamesPlayed,
    // maxLevel — кумулятивный монотонный (глубина); level-триггер, edge-гейтится (НЕ в PER_GAME_STATS).
    [BB_KEYS.maxLevel]: stats.maxLevel,
  };
}

/** Закрытие уровня: вкатываем его показатели в cumulative. gamesPlayed считается при старте уровня. */
export function commitBBGame(stats: BBCumulativeStats, game: BBCurrentGame): BBCumulativeStats {
  return {
    ...stats,
    totalScore: stats.totalScore + game.sessionScore,
    bestScore: Math.max(stats.bestScore, game.sessionScore),
  };
}
