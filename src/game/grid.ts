import { BOARD_SIZE, type Cell, type Grid } from './types';

export function createEmptyGrid(size: number = BOARD_SIZE): Grid {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    const ar = a[r];
    const br = b[r];
    if (ar.length !== br.length) return false;
    for (let c = 0; c < ar.length; c++) {
      if (ar[c] !== br[c]) return false;
    }
  }
  return true;
}

export interface CellPos {
  r: number;
  c: number;
}

export function emptyCells(grid: Grid): CellPos[] {
  const out: CellPos[] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === 0) out.push({ r, c });
    }
  }
  return out;
}

export function maxTile(grid: Grid): number {
  let max = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v > max) max = v;
    }
  }
  return max;
}

/** Транспонирование квадратной матрицы (строки <-> колонки). */
export function transpose(grid: Grid): Grid {
  const size = grid.length;
  const out: Grid = createEmptyGrid(size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      out[c][r] = grid[r][c];
    }
  }
  return out;
}

/** Разворот каждой строки (зеркало по горизонтали). */
export function flipRows(grid: Grid): Grid {
  return grid.map((row) => row.slice().reverse());
}

export function countTiles(grid: Grid, predicate: (v: Cell) => boolean): number {
  let n = 0;
  for (const row of grid) for (const v of row) if (predicate(v)) n++;
  return n;
}
