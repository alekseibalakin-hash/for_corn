// Чистая логика «Блоков-фигур» (DESIGN-BLOCKS.md §1, briefs/blocks-phase1.md §1).
// Никакого React/UI — только функции над сеткой и фигурами, покрытые юнит-тестами.
// Поле 8×8. Cell: 'empty' | 'fill' | 'block'. Блок = особая клетка-цель (нельзя ставить на неё
// фигуру; исчезает при сжигании её ряда/столбца — прогресс цели). Без вращения фигур в рантайме.

export { mulberry32 } from '../../engine/rng';
export type { Rng } from '../../engine/rng';

export const GRID_SIZE = 8;

export type Cell = 'empty' | 'fill' | 'block';
/** Grid[row][col], индексы 0-based. */
export type Grid = Cell[][];

export interface Coord {
  r: number;
  c: number;
}

/** Фигура-полимино: нормализованные офсеты от (0,0). min(r) = 0, min(c) = 0. */
export interface Piece {
  cells: Coord[];
}

export function emptyGrid(): Grid {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, (): Cell => 'empty')
  );
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row] as Cell[]);
}

// ============================================================================
// Набор фигур (16 форм, без вращения в рантайме).
// ============================================================================

export const PIECE_SET: Piece[] = [
  // 1 клетка
  { cells: [{ r: 0, c: 0 }] },                                                             // DOT
  // 2 клетки — прямые
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] },                                            // I2H
  { cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }] },                                            // I2V
  // 3 клетки — прямые
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }] },                           // I3H
  { cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }] },                           // I3V
  // 4 клетки — прямые
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }] },          // I4H
  { cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }, { r: 3, c: 0 }] },          // I4V
  // 5 клеток — прямые
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }, { r: 0, c: 4 }] }, // I5H
  { cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }, { r: 3, c: 0 }, { r: 4, c: 0 }] }, // I5V
  // 2×2 квадрат
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }] },          // O2x2
  // L-тромино (4 угла, 3 клетки)
  { cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 1, c: 1 }] },                           // CORNER_DR
  { cells: [{ r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }] },                           // CORNER_DL
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }] },                           // CORNER_UR
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }] },                           // CORNER_UL
  // T-тетромино
  { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 1, c: 1 }] },          // T_DOWN
  // L-тетромино вертикальный
  { cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }, { r: 2, c: 1 }] },          // L_V
];

// ============================================================================
// Базовые операции над сеткой.
// ============================================================================

/** Можно ли поставить фигуру piece с якорем (r, c): все клетки в границах и в 'empty'. */
export function canPlace(grid: Grid, piece: Piece, r: number, c: number): boolean {
  for (const cell of piece.cells) {
    const nr = r + cell.r;
    const nc = c + cell.c;
    if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) return false;
    if (grid[nr][nc] !== 'empty') return false;
  }
  return true;
}

/** Поставить фигуру piece с якорем (r, c); чистая функция — возвращает новую сетку. */
export function place(grid: Grid, piece: Piece, r: number, c: number): Grid {
  const next = cloneGrid(grid);
  for (const cell of piece.cells) {
    next[r + cell.r][c + cell.c] = 'fill';
  }
  return next;
}

export interface ClearResult {
  grid: Grid;
  clearedRows: number;
  clearedCols: number;
  /** Сколько 'block'-клеток было снято (прогресс цели). */
  clearedBlocks: number;
}

/**
 * Найти полные ряды И столбцы (все 8 клеток ≠ 'empty') и очистить их в 'empty'.
 * Клетка на пересечении полного ряда и полного столбца очищается один раз.
 * Возвращает clearedBlocks — сколько особых блоков снято (прогресс уровня).
 */
export function clearLines(grid: Grid): ClearResult {
  const rowFull = Array.from({ length: GRID_SIZE }, (_, row) =>
    grid[row].every(cell => cell !== 'empty')
  );
  const colFull = Array.from({ length: GRID_SIZE }, (_, col) =>
    grid.every(row => row[col] !== 'empty')
  );

  const clearedRows = rowFull.filter(Boolean).length;
  const clearedCols = colFull.filter(Boolean).length;

  if (clearedRows === 0 && clearedCols === 0) {
    return { grid, clearedRows: 0, clearedCols: 0, clearedBlocks: 0 };
  }

  let clearedBlocks = 0;
  const newGrid = cloneGrid(grid);
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (rowFull[r] || colFull[c]) {
        if (newGrid[r][c] === 'block') clearedBlocks++;
        newGrid[r][c] = 'empty';
      }
    }
  }

  return { grid: newGrid, clearedRows, clearedCols, clearedBlocks };
}

/** Число 'block'-клеток на сетке (= оставшаяся цель уровня). */
export function countBlocks(grid: Grid): number {
  let n = 0;
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++)
      if (grid[r][c] === 'block') n++;
  return n;
}

/** Есть ли хоть одна валидная позиция для данной фигуры. */
export function anyPlacement(grid: Grid, piece: Piece): boolean {
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++)
      if (canPlace(grid, piece, r, c)) return true;
  return false;
}

/** Хоть одна из данных фигур влезает на доску (для детектирования тупика/фейл-стейта). */
export function hasAnyMove(grid: Grid, pieces: Piece[]): boolean {
  return pieces.some(p => anyPlacement(grid, p));
}

/**
 * Очки за одно размещение.
 * placedCells — число клеток фигуры; бонус за несколько линий за раз = totalLines² × 10
 * (множитель стимулирует комбо-очистки, аналог спайси).
 */
export function score(placedCells: number, clearedRows: number, clearedCols: number): number {
  const lines = clearedRows + clearedCols;
  return placedCells + (lines > 0 ? lines * lines * 10 : 0);
}
