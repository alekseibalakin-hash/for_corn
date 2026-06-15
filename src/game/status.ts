import { emptyCells, maxTile } from './grid';
import { WIN_TILE, type Grid } from './types';

/** Есть ли хотя бы один возможный ход (пустая ячейка или пара соседей-близнецов). */
export function hasMoves(grid: Grid): boolean {
  if (emptyCells(grid).length > 0) return true;

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const v = grid[r][c];
      // сосед справа
      if (c + 1 < grid[r].length && grid[r][c + 1] === v) return true;
      // сосед снизу
      if (r + 1 < grid.length && grid[r + 1][c] === v) return true;
    }
  }
  return false;
}

/** Конец игры — ходов больше нет. */
export function isGameOver(grid: Grid): boolean {
  return !hasMoves(grid);
}

/** Достигнута ли целевая плитка (по умолчанию 2048). */
export function hasReached(grid: Grid, target: number = WIN_TILE): boolean {
  return maxTile(grid) >= target;
}
