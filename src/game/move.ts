import { cloneGrid, flipRows, gridsEqual, transpose } from './grid';
import type { Direction, Grid, MoveResult } from './types';

interface RowSlide {
  row: number[];
  scoreGained: number;
  merged: number[];
}

/**
 * Сдвиг одной строки влево с классическим слиянием 2048:
 * - плитки уезжают к левому краю;
 * - две равные сливаются ровно один раз за ход (без цепной реакции 2+2+2+2 → 8);
 * - слияние идёт слева направо.
 */
export function slideRowLeft(row: number[]): RowSlide {
  const tiles = row.filter((v) => v !== 0);
  const result: number[] = [];
  const merged: number[] = [];
  let scoreGained = 0;

  for (let i = 0; i < tiles.length; i++) {
    const current = tiles[i];
    const next = tiles[i + 1];
    if (next !== undefined && current === next) {
      const value = current * 2;
      result.push(value);
      scoreGained += value;
      merged.push(value);
      i++; // соседа поглотили — пропускаем
    } else {
      result.push(current);
    }
  }

  while (result.length < row.length) result.push(0);
  return { row: result, scoreGained, merged };
}

/**
 * Приводим поле к «левому» представлению, сдвигаем влево, возвращаем обратно.
 * left   — как есть
 * right  — зеркалим строки
 * up     — транспонируем
 * down   — транспонируем + зеркалим
 */
function toLeftFrame(grid: Grid, dir: Direction): Grid {
  switch (dir) {
    case 'left':
      return cloneGrid(grid);
    case 'right':
      return flipRows(grid);
    case 'up':
      return transpose(grid);
    case 'down':
      return flipRows(transpose(grid));
  }
}

function fromLeftFrame(grid: Grid, dir: Direction): Grid {
  switch (dir) {
    case 'left':
      return grid;
    case 'right':
      return flipRows(grid);
    case 'up':
      return transpose(grid);
    case 'down':
      return transpose(flipRows(grid));
  }
}

/**
 * Чистый ход в направлении. Новую плитку НЕ спавнит — это отдельный шаг,
 * чтобы логику было удобно тестировать и переиспользовать.
 */
export function move(grid: Grid, dir: Direction): MoveResult {
  const framed = toLeftFrame(grid, dir);
  let scoreGained = 0;
  const mergedValues: number[] = [];

  const slid = framed.map((row) => {
    const { row: nextRow, scoreGained: s, merged } = slideRowLeft(row);
    scoreGained += s;
    mergedValues.push(...merged);
    return nextRow;
  });

  const nextGrid = fromLeftFrame(slid, dir);
  const moved = !gridsEqual(grid, nextGrid);

  return { grid: nextGrid, moved, scoreGained, mergedValues };
}
