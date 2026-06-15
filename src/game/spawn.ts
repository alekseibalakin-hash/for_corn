import { cloneGrid, createEmptyGrid, emptyCells } from './grid';
import type { Grid, Rng } from './types';

/** Значение новой плитки: 4 с вероятностью 10%, иначе 2 (DESIGN §3). */
export function pickSpawnValue(rng: Rng): 2 | 4 {
  return rng() < 0.1 ? 4 : 2;
}

export interface SpawnResult {
  grid: Grid;
  spawned: { r: number; c: number; value: number } | null;
}

/**
 * Спавн одной плитки в случайную пустую ячейку. Возвращает НОВОЕ поле.
 * Порядок rng: 1) выбор ячейки, 2) выбор значения — важно для тестов.
 */
export function spawnTile(grid: Grid, rng: Rng = Math.random): SpawnResult {
  const empties = emptyCells(grid);
  if (empties.length === 0) return { grid, spawned: null };

  const idx = Math.floor(rng() * empties.length);
  const cell = empties[Math.min(idx, empties.length - 1)];
  const value = pickSpawnValue(rng);

  const next = cloneGrid(grid);
  next[cell.r][cell.c] = value;
  return { grid: next, spawned: { r: cell.r, c: cell.c, value } };
}

/** Стартовое поле: пустое + две плитки. */
export function createInitialGrid(rng: Rng = Math.random): Grid {
  let grid = createEmptyGrid();
  grid = spawnTile(grid, rng).grid;
  grid = spawnTile(grid, rng).grid;
  return grid;
}
