import { describe, expect, it } from 'vitest';
import {
  anyPlacement,
  canPlace,
  clearLines,
  cloneGrid,
  countBlocks,
  emptyGrid,
  GRID_SIZE,
  hasAnyMove,
  PIECE_SET,
  place,
  score,
  type Cell,
  type Grid,
  type Piece,
} from './logic';

// ---- Хелперы ----

function gridFrom(rows: string[]): Grid {
  return rows.map(row =>
    row.split('').map((ch): Cell => {
      if (ch === 'F') return 'fill';
      if (ch === 'B') return 'block';
      return 'empty';
    })
  );
}

// Одна фигура-точка (1 клетка)
const DOT: Piece = { cells: [{ r: 0, c: 0 }] };
// I3H — 3 клетки горизонтально
const I3H: Piece = { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }] };
// I3V — 3 клетки вертикально
const I3V: Piece = { cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }] };
// I8H — полная строка (8 клеток)
const I8H: Piece = { cells: Array.from({ length: 8 }, (_, c) => ({ r: 0, c })) };
// O2x2
const O2x2: Piece = { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }] };

// ============================================================================

describe('PIECE_SET — нормализованные формы', () => {
  it('каждая фигура содержит ≥1 клетку', () => {
    for (const p of PIECE_SET) expect(p.cells.length).toBeGreaterThanOrEqual(1);
  });

  it('нормализованы: min r = 0, min c = 0', () => {
    for (const p of PIECE_SET) {
      const minR = Math.min(...p.cells.map(c => c.r));
      const minC = Math.min(...p.cells.map(c => c.c));
      expect(minR).toBe(0);
      expect(minC).toBe(0);
    }
  });

  it('≥14 фигур в наборе', () => {
    expect(PIECE_SET.length).toBeGreaterThanOrEqual(14);
  });
});

// ============================================================================

describe('emptyGrid / cloneGrid', () => {
  it('emptyGrid: 8×8, все empty', () => {
    const g = emptyGrid();
    expect(g.length).toBe(GRID_SIZE);
    for (const row of g) {
      expect(row.length).toBe(GRID_SIZE);
      for (const cell of row) expect(cell).toBe('empty');
    }
  });

  it('cloneGrid не мутирует оригинал', () => {
    const g = emptyGrid();
    const clone = cloneGrid(g);
    clone[0][0] = 'fill';
    expect(g[0][0]).toBe('empty');
  });
});

// ============================================================================

describe('canPlace', () => {
  it('пустое поле — точка влезает в любую клетку', () => {
    const g = emptyGrid();
    expect(canPlace(g, DOT, 0, 0)).toBe(true);
    expect(canPlace(g, DOT, 7, 7)).toBe(true);
  });

  it('вышли за границу', () => {
    const g = emptyGrid();
    expect(canPlace(g, I3H, 0, 6)).toBe(false); // c+2 = 8 > 7
    expect(canPlace(g, I3V, 6, 0)).toBe(false); // r+2 = 8 > 7
  });

  it('заблокировано fill', () => {
    const g = emptyGrid();
    g[0][0] = 'fill';
    expect(canPlace(g, DOT, 0, 0)).toBe(false);
    expect(canPlace(g, I3H, 0, 0)).toBe(false); // клетка 0,0 занята
    expect(canPlace(g, I3H, 0, 1)).toBe(true);  // 0,1–0,3 свободны
  });

  it('заблокировано block', () => {
    const g = emptyGrid();
    g[3][3] = 'block';
    expect(canPlace(g, DOT, 3, 3)).toBe(false);
  });

  it('I3H помещается с минимальным смещением', () => {
    const g = emptyGrid();
    expect(canPlace(g, I3H, 0, 5)).toBe(true);  // клетки 0,5 / 0,6 / 0,7
    expect(canPlace(g, I3H, 0, 6)).toBe(false); // клетка 0,8 вне поля
  });
});

// ============================================================================

describe('place', () => {
  it('расставляет fill, оригинал не мутируется', () => {
    const g = emptyGrid();
    const next = place(g, I3H, 0, 0);
    expect(next[0][0]).toBe('fill');
    expect(next[0][1]).toBe('fill');
    expect(next[0][2]).toBe('fill');
    expect(next[0][3]).toBe('empty');
    expect(g[0][0]).toBe('empty'); // оригинал нетронут
  });

  it('не затрагивает block-клетки (размещение допускается только на empty)', () => {
    const g = emptyGrid();
    g[0][3] = 'block';
    const next = place(g, I3H, 1, 0); // другая строка
    expect(next[0][3]).toBe('block'); // block сохранён
  });
});

// ============================================================================

describe('clearLines', () => {
  it('нет полных линий → grid не изменяется, счётчики = 0', () => {
    const g = emptyGrid();
    g[0][0] = 'fill';
    const res = clearLines(g);
    expect(res.clearedRows).toBe(0);
    expect(res.clearedCols).toBe(0);
    expect(res.clearedBlocks).toBe(0);
    expect(res.grid[0][0]).toBe('fill');
  });

  it('полная строка → clearedRows = 1, строка очищена', () => {
    const g = emptyGrid();
    for (let c = 0; c < GRID_SIZE; c++) g[2][c] = 'fill';
    const res = clearLines(g);
    expect(res.clearedRows).toBe(1);
    expect(res.clearedCols).toBe(0);
    for (let c = 0; c < GRID_SIZE; c++) expect(res.grid[2][c]).toBe('empty');
  });

  it('полный столбец → clearedCols = 1', () => {
    const g = emptyGrid();
    for (let r = 0; r < GRID_SIZE; r++) g[r][5] = 'fill';
    const res = clearLines(g);
    expect(res.clearedCols).toBe(1);
    expect(res.clearedRows).toBe(0);
    for (let r = 0; r < GRID_SIZE; r++) expect(res.grid[r][5]).toBe('empty');
  });

  it('полная строка с block → block снят, clearedBlocks = 1', () => {
    const g = emptyGrid();
    for (let c = 0; c < GRID_SIZE; c++) g[3][c] = c === 4 ? 'block' : 'fill';
    const res = clearLines(g);
    expect(res.clearedRows).toBe(1);
    expect(res.clearedBlocks).toBe(1);
    for (let c = 0; c < GRID_SIZE; c++) expect(res.grid[3][c]).toBe('empty');
  });

  it('пересечение строки и столбца — block очищается один раз', () => {
    const g = emptyGrid();
    // полная строка 0
    for (let c = 0; c < GRID_SIZE; c++) g[0][c] = 'fill';
    // полный столбец 0
    for (let r = 0; r < GRID_SIZE; r++) g[r][0] = 'fill';
    // на пересечении (0,0) поставим block
    g[0][0] = 'block';
    const res = clearLines(g);
    expect(res.clearedRows).toBe(1);
    expect(res.clearedCols).toBe(1);
    expect(res.clearedBlocks).toBe(1); // только один, хотя и в строке и в столбце
    expect(res.grid[0][0]).toBe('empty');
  });

  it('две полных строки одновременно → clearedRows = 2', () => {
    const g = emptyGrid();
    for (let c = 0; c < GRID_SIZE; c++) { g[0][c] = 'fill'; g[7][c] = 'fill'; }
    const res = clearLines(g);
    expect(res.clearedRows).toBe(2);
  });

  it('строка из mix fill+block → полностью очищается', () => {
    const g = emptyGrid();
    for (let c = 0; c < GRID_SIZE; c++) g[1][c] = c % 2 === 0 ? 'fill' : 'block';
    const res = clearLines(g);
    expect(res.clearedRows).toBe(1);
    expect(res.clearedBlocks).toBe(4); // 4 block-клетки в строке
    for (let c = 0; c < GRID_SIZE; c++) expect(res.grid[1][c]).toBe('empty');
  });
});

// ============================================================================

describe('countBlocks', () => {
  it('пустое поле → 0', () => {
    expect(countBlocks(emptyGrid())).toBe(0);
  });

  it('считает только block', () => {
    const g = emptyGrid();
    g[0][0] = 'block';
    g[1][1] = 'fill';
    g[2][2] = 'block';
    expect(countBlocks(g)).toBe(2);
  });
});

// ============================================================================

describe('anyPlacement / hasAnyMove', () => {
  it('пустое поле — любая фигура влезает', () => {
    const g = emptyGrid();
    for (const p of PIECE_SET) expect(anyPlacement(g, p)).toBe(true);
  });

  it('почти полное поле — большая фигура не влезает, точка влезает', () => {
    const g = emptyGrid();
    // Заполним всё кроме одной клетки (0,0)
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++)
        if (!(r === 0 && c === 0)) g[r][c] = 'fill';
    expect(anyPlacement(g, DOT)).toBe(true);
    expect(anyPlacement(g, I3H)).toBe(false);
    expect(anyPlacement(g, O2x2)).toBe(false);
  });

  it('полное поле → hasAnyMove = false', () => {
    const g = emptyGrid();
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++)
        g[r][c] = 'fill';
    expect(hasAnyMove(g, PIECE_SET)).toBe(false);
  });

  it('hasAnyMove = true если хоть одна фигура влезает', () => {
    const g = emptyGrid();
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++)
        if (!(r === 0 && c === 0)) g[r][c] = 'fill';
    // Только точка может поместиться
    expect(hasAnyMove(g, [DOT, I3H])).toBe(true);
  });

  it('hasAnyMove = false если все фигуры не влезают', () => {
    const g = emptyGrid();
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++)
        g[r][c] = 'fill';
    expect(hasAnyMove(g, PIECE_SET)).toBe(false);
  });
});

// ============================================================================

describe('score', () => {
  it('только размещение, нет линий', () => {
    expect(score(3, 0, 0)).toBe(3);
    expect(score(5, 0, 0)).toBe(5);
  });

  it('одна строка → +10 (1² × 10)', () => {
    expect(score(3, 1, 0)).toBe(3 + 10);
  });

  it('одна строка + один столбец → +40 (2² × 10)', () => {
    expect(score(4, 1, 1)).toBe(4 + 40);
  });

  it('три линии одновременно → +90 (3² × 10)', () => {
    expect(score(5, 2, 1)).toBe(5 + 90);
  });

  it('нет линий, ноль клеток', () => {
    expect(score(0, 0, 0)).toBe(0);
  });
});

// ============================================================================

describe('Интеграция: place + clearLines', () => {
  it('полная строка после place → очищается', () => {
    // Заполняем строку 0, кроме позиций 0,1,2
    const g = emptyGrid();
    for (let c = 3; c < GRID_SIZE; c++) g[0][c] = 'fill';
    // Ставим I3H в (0,0) → строка 0 заполнена
    const placed = place(g, I3H, 0, 0);
    const { grid: cleared, clearedRows } = clearLines(placed);
    expect(clearedRows).toBe(1);
    for (let c = 0; c < GRID_SIZE; c++) expect(cleared[0][c]).toBe('empty');
  });

  it('block убирается когда его строка заполнена', () => {
    const g = emptyGrid();
    g[4][4] = 'block';
    for (let c = 0; c < GRID_SIZE; c++) if (c !== 4) g[4][c] = 'fill';
    const { clearedBlocks, clearedRows } = clearLines(g);
    expect(clearedRows).toBe(1);
    expect(clearedBlocks).toBe(1);
  });

  it('gridFrom хелпер работает корректно', () => {
    const g = gridFrom([
      'FFFFFFFF',
      'BBBBBBBB',
      'EEEEEEEE',
      'EEEEEEEE',
      'EEEEEEEE',
      'EEEEEEEE',
      'EEEEEEEE',
      'EEEEEEEE',
    ]);
    expect(g[0][0]).toBe('fill');
    expect(g[1][0]).toBe('block');
    expect(g[2][0]).toBe('empty');
    const res = clearLines(g);
    expect(res.clearedRows).toBe(2);
    expect(res.clearedBlocks).toBe(8);
  });

  it('I8H на пустом поле заполняет строку и сразу очищает', () => {
    const g = emptyGrid();
    const placed = place(g, I8H, 0, 0);
    const { clearedRows, grid: cleared } = clearLines(placed);
    expect(clearedRows).toBe(1);
    for (let c = 0; c < GRID_SIZE; c++) expect(cleared[0][c]).toBe('empty');
  });
});
