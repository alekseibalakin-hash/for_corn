// Генератор ЧЕСТНЫХ уровней «Блоков-фигур» (DESIGN-BLOCKS.md §4, briefs/blocks-phase1.md §2).
// Чистый модуль — только логика, без React. Зеркало match3/levels.ts (другая игра, тот же паттерн).
//
// ПРАВИЛО №1: уровень обязан быть проходим за setsBudget наборов фигур. Доказываем КОНСТРУКТИВНО:
//  (1) параметры сложности из content/blocks.json (бэнды);
//  (2) конструктивная расстановка блоков (placeBlocks): разнообразие рядов/столбцов, анти-кластер;
//  (3) ГАРАНТИЯ: жадный simulateSolveBlocks как свидетель; worst = max(k-fork потоков);
//      setsBudget = max(worst + floor, ceil(worst × generosity)), потолок = target × budgetK;
//  (4) потолок честности (blocksMax ≤ 16) — в бэндах (validateBlocksBands);
//  (5) parachute-fallback после MAX_RETRIES ⇒ generateLevel ВСЕГДА возвращает уровень (total-функция).
//
// Де-циркуляризация (fix briefs/blocks-phase1-fix.md §1-2):
//  • simulateSolveBlocks принимает SetPicker (default = greedyPicker) → чистая точка внедрения
//    casual-стратегии без изменения поведения генератора (§3);
//  • simulateCasualBlocks — независимый casual-witness с pickRng, отдельным от greedy-worst бюджета.

import { mulberry32 } from '../../engine/rng';
import type { Rng } from '../../engine/rng';
import { blocksBandForLevel } from '../../content';
import type { BlocksBand } from '../../content/types';
import {
  canPlace,
  clearLines,
  cloneGrid,
  countBlocks,
  emptyGrid,
  GRID_SIZE,
  PIECE_SET,
  place,
  type Coord,
  type Grid,
  type Piece,
} from './logic';

// ============================================================================
// Типы цели и уровня (briefs/blocks-phase1.md §2.1).
// ============================================================================

export interface BlockGoal {
  kind: 'clearBlocks';
  /** Число особых блоков на старте = сколько убрать. */
  target: number;
}

/** Сгенерированный уровень: стартовая сетка + цель + бюджет наборов + seed play-потока. */
export interface BlockLevel {
  level: number;
  /** Seed play-потока (makePieceStream(seed) — поток выдачи фигур; на нём доказана проходимость). */
  seed: number;
  grid: Grid;
  goal: BlockGoal;
  /** Лимит наборов фигур: max(worst + budgetFloor, ceil(worst × generosity)). */
  setsBudget: number;
}

/** Снимок незаконченного уровня для резюма (briefs/blocks-phase1.md §2.1). */
export interface BlockLevelState {
  level: number;
  seed: number;
  setsLeft: number;
  goal: BlockGoal;
  /** Сколько блоков уже убрано (растущий прогресс цели). */
  progress: number;
  /** Сколько nextSet() уже вызвано (для продолжения ТОГО ЖЕ потока — задача №0 briefs §2.2). */
  streamPos: number;
  grid: Grid;
  currentPieces: Piece[];
}

// ============================================================================
// Поток фигур (seeded — без него гарантия проходимости недействительна; briefs §2.2).
// ============================================================================

export interface PieceStream {
  /** Следующие 3 фигуры из потока. */
  nextSet(): [Piece, Piece, Piece];
  /** Сколько nextSet() уже вызвано (позиция потока для резюма). */
  pos(): number;
}

/**
 * Детерминированный поток фигур на mulberry32(seed). Каждый nextSet() потребляет 3 вызова rng().
 * Зеркало makeStream в match3/logic.ts.
 */
export function makePieceStream(seed: number): PieceStream {
  const rng = mulberry32(seed);
  let consumed = 0;
  const nextPiece = (): Piece => {
    consumed++;
    return PIECE_SET[Math.floor(rng() * PIECE_SET.length)];
  };
  return {
    nextSet(): [Piece, Piece, Piece] {
      return [nextPiece(), nextPiece(), nextPiece()];
    },
    pos() {
      return consumed;
    },
  };
}

// ============================================================================
// Тип пикера наборов (§3 briefs/blocks-phase1-fix.md).
//
// SetPicker принимает состояние доски + набор из 3 фигур + позиции блоков, возвращает
// результат размещения всех 3 фигур (или null при тупике). Дефолт: greedyPicker.
// Это чистая точка внедрения альтернативной стратегии без изменения генератора.
// ============================================================================

export type SetPicker = (
  grid: Grid,
  pieces: [Piece, Piece, Piece],
  blockPositions: Coord[],
) => { grid: Grid; clearedBlocks: number } | null;

// ============================================================================
// Жадный пикер (greedyPicker) — конструктивное доказательство проходимости (briefs §2.3).
// ============================================================================

const SOLVE_SETS_CAP = 200; // жёсткий потолок наборов (стук = форк не решил → отбраковка)

function getBlockPositions(grid: Grid): Coord[] {
  const positions: Coord[] = [];
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++)
      if (grid[r][c] === 'block') positions.push({ r, c });
  return positions;
}

/**
 * Насколько данная сетка «близка» к очистке блоков: для каждого блока берём max(fullness_row, fullness_col),
 * где fullness = число не-пустых клеток в этой линии. Выше → ближе к клиру → лучше.
 */
function blockClearProximity(grid: Grid, blockPositions: Coord[]): number {
  let total = 0;
  for (const { r, c } of blockPositions) {
    if (grid[r][c] !== 'block') continue;
    let rowFull = 0;
    let colFull = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      if (grid[r][i] !== 'empty') rowFull++;
      if (grid[i][c] !== 'empty') colFull++;
    }
    total += Math.max(rowFull, colFull);
  }
  return total;
}

/**
 * Выбрать лучшую позицию для фигуры: приоритет (1) очищает блок; (2) очищает любую линию;
 * (3) максимизирует close-to-full для блочных линий. Тай-брейк: top-left (детерминированный).
 */
function bestPlacement(
  grid: Grid,
  piece: Piece,
  blockPositions: Coord[],
): { r: number; c: number } | null {
  let best: { r: number; c: number } | null = null;
  let bestScore = -Infinity;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!canPlace(grid, piece, r, c)) continue;
      const placed = place(grid, piece, r, c);
      const { grid: cleared, clearedBlocks, clearedRows, clearedCols } = clearLines(placed);
      const totalLines = clearedRows + clearedCols;

      let sc: number;
      if (clearedBlocks > 0) {
        sc = 200000 + clearedBlocks * 10000 + totalLines * 100;
      } else if (totalLines > 0) {
        sc = 100000 + totalLines * 100;
      } else {
        sc = blockClearProximity(cleared, blockPositions);
      }

      if (sc > bestScore) {
        bestScore = sc;
        best = { r, c };
      }
    }
  }

  return best;
}

/**
 * Попытаться разместить все 3 фигуры набора во всех порядках (3! = 6 перебор).
 * Возвращает лучший результат (max clearedBlocks) или null если все порядки тупик.
 */
function tryPlaceSet(
  grid: Grid,
  pieces: [Piece, Piece, Piece],
  blockPositions: Coord[],
): { grid: Grid; clearedBlocks: number } | null {
  const perms: [number, number, number][] = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];

  let bestResult: { grid: Grid; clearedBlocks: number } | null = null;
  let bestCleared = -1;

  for (const [i, j, k] of perms) {
    const ordered = [pieces[i], pieces[j], pieces[k]] as [Piece, Piece, Piece];
    let cur = grid;
    let totalCleared = 0;
    let ok = true;

    for (const piece of ordered) {
      const pos = bestPlacement(cur, piece, blockPositions);
      if (!pos) { ok = false; break; }
      const placed = place(cur, piece, pos.r, pos.c);
      const { grid: cl, clearedBlocks } = clearLines(placed);
      totalCleared += clearedBlocks;
      cur = cl;
    }

    if (ok && totalCleared > bestCleared) {
      bestCleared = totalCleared;
      bestResult = { grid: cur, clearedBlocks: totalCleared };
    }
  }

  return bestResult;
}

/** Дефолтный (жадный) пикер: bestPlacement + 3!-перебор + blockClearProximity. Байт-в-байт прежнее поведение. */
export const greedyPicker: SetPicker = tryPlaceSet;

// ============================================================================
// Casual-пикер КОМПЕТЕНТНЫЙ (независимый witness для де-циркуляризации; fix §1, Раунд 2).
//
// Модель РЕАЛЬНОГО игрока (не near-random, не greedy-optimal):
//  • перебирает все 6 порядков 3 фигур набора (Fisher-Yates shuffle via pickRng);
//  • выбор позиции — density-heuristic: предпочесть немедленный клир линии/блока;
//    иначе предпочесть позицию в плотных рядах/столбцах (консолидация — доска не фрагментируется);
//  • БЕЗ 1-step lookahead, blockClearProximity-оптимума и без многонаборного lookahead.
// Ключевое отличие от greedyPicker: без lookahead-фильтра и без blockClearProximity-скоринга.
// Возвращает результат первого рабочего порядка; null = все 6 тупик → fair game-over для набора.
// ============================================================================

const ALL_PERMS: [number, number, number][] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

/** Ширина пула «близко к лучшему» для density-выбора позиции: позиции с score ≥ best − N равновероятны. */
const DENSITY_POOL_TOLERANCE = 1;

/**
 * Density-based position selection: предпочесть немедленный клир;
 * иначе — позицию в рядах/столбцах с максимальным заполнением (score = sum max(rowFill, colFill)
 * по клеткам фигуры). Консолидация заполнений делает строки/столбцы полными быстрее → клиры.
 */
function casualDensityPlacement(
  grid: Grid,
  piece: Piece,
  rowFill: number[],
  colFill: number[],
  pickRng: Rng,
): { r: number; c: number } | null {
  const clears: { r: number; c: number }[] = [];
  const best: { r: number; c: number; score: number }[] = [];

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!canPlace(grid, piece, r, c)) continue;
      const placed = place(grid, piece, r, c);
      const { clearedBlocks, clearedRows, clearedCols } = clearLines(placed);
      if (clearedBlocks > 0 || clearedRows > 0 || clearedCols > 0) {
        clears.push({ r, c });
      } else {
        let score = 0;
        for (const cell of piece.cells) score += Math.max(rowFill[r + cell.r], colFill[c + cell.c]);
        best.push({ r, c, score });
      }
    }
  }

  if (clears.length > 0) return clears[Math.floor(pickRng() * clears.length)];
  if (best.length === 0) return null;
  best.sort((a, b) => b.score - a.score);
  const pool = best.filter(p => p.score >= best[0].score - DENSITY_POOL_TOLERANCE);
  return pool[Math.floor(pickRng() * pool.length)];
}

/**
 * Компетентный casual-пикер: shuffled 6-perm + density-heuristic position selection.
 * Де-циркуляризован через pickRng (≠ play-stream). Не использует blockClearProximity.
 */
function makeCompetentCasualPicker(pickRng: Rng): SetPicker {
  return (grid, pieces, _blockPositions) => {
    const idx = [0, 1, 2, 3, 4, 5];
    for (let i = 5; i > 0; i--) {
      const j = Math.floor(pickRng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }

    for (const pi of idx) {
      const perm = ALL_PERMS[pi];
      let cur = grid;
      let totalCleared = 0;
      let ok = true;

      for (const pidx of perm) {
        const piece = pieces[pidx];
        const rowFill = Array.from({ length: GRID_SIZE }, (_, r) => cur[r].filter(c => c !== 'empty').length);
        const colFill = Array.from({ length: GRID_SIZE }, (_, c) => cur.map(row => row[c]).filter(x => x !== 'empty').length);
        const pos = casualDensityPlacement(cur, piece, rowFill, colFill, pickRng);
        if (!pos) { ok = false; break; }
        const placed = place(cur, piece, pos.r, pos.c);
        const { grid: cl, clearedBlocks } = clearLines(placed);
        totalCleared += clearedBlocks;
        cur = cl;
      }

      if (ok) return { grid: cur, clearedBlocks: totalCleared };
    }

    return null;
  };
}

/**
 * Компетентный casual-witness (fix briefs/blocks-phase1-fix.md §1, Раунд 2).
 * De-circularized: pickRng = mulberry32(seed ^ 0xdeadbeef) — отдельный от greedy-worst.
 * Верхняя граница human-play: 6-perm порядков + density-heuristic позиции.
 */
export function simulateCasualBlocks(
  grid: Grid,
  goal: BlockGoal,
  setsBudget: number,
  stream: PieceStream,
  pickRng: Rng,
): boolean {
  return simulateSolveBlocks(grid, goal, setsBudget, stream, makeCompetentCasualPicker(pickRng)).solved;
}

// ============================================================================
// Careless-пикер (нижняя граница human-проходимости, Раунд 3).
//
// Ставит 3 фигуры В ФИКСИРОВАННОМ порядке (0 → 1 → 2) БЕЗ перестановок.
// Density-heuristic позиция — та же, что у casual. Тупик в любой фигуре → null.
// Слабее компетентного (нет 6-perm), но честнее near-random:
//   если careless проходит уровень — нормальный игрок точно справится.
// De-circularized: pickRng = mulberry32(seed ^ 0xc0ffee42) — отдельная соль от casual.
// ============================================================================

function makeCarelessPicker(pickRng: Rng): SetPicker {
  return (grid, pieces, _blockPositions) => {
    let cur = grid;
    let totalCleared = 0;

    for (const piece of pieces) {
      const rowFill = Array.from({ length: GRID_SIZE }, (_, r) =>
        cur[r].filter(c => c !== 'empty').length
      );
      const colFill = Array.from({ length: GRID_SIZE }, (_, c) =>
        cur.map(row => row[c]).filter(x => x !== 'empty').length
      );
      const pos = casualDensityPlacement(cur, piece, rowFill, colFill, pickRng);
      if (!pos) return null;
      const placed = place(cur, piece, pos.r, pos.c);
      const { grid: cl, clearedBlocks } = clearLines(placed);
      totalCleared += clearedBlocks;
      cur = cl;
    }

    return { grid: cur, clearedBlocks: totalCleared };
  };
}

/**
 * Нижняя граница human-проходимости: careless-witness (фиксированный порядок 0→1→2, Раунд 3).
 * De-circularized: pickRng должен быть mulberry32(seed ^ 0xc0ffee42) — отдельный от greedy и casual.
 */
export function simulateCarelessBlocks(
  grid: Grid,
  goal: BlockGoal,
  setsBudget: number,
  stream: PieceStream,
  pickRng: Rng,
): boolean {
  return simulateSolveBlocks(grid, goal, setsBudget, stream, makeCarelessPicker(pickRng)).solved;
}

// ============================================================================
// simulateSolveBlocks с picker-параметром (§3 briefs/blocks-phase1-fix.md).
// Поведение генератора — байт-в-байт прежнее (greedyPicker = tryPlaceSet).
// ============================================================================

/**
 * Жадно (по умолчанию) или picker-стратегией «играть» уровень на потоке фигур.
 * Тупик (picker вернул null) = проигрыш. Доска не мутируется.
 */
export function simulateSolveBlocks(
  grid: Grid,
  _goal: BlockGoal,
  setsCap: number,
  stream: PieceStream,
  picker: SetPicker = greedyPicker,
): { solved: boolean; sets: number } {
  let cur = cloneGrid(grid);
  let blocksLeft = countBlocks(cur);

  for (let setIdx = 0; setIdx < setsCap; setIdx++) {
    if (blocksLeft === 0) return { solved: true, sets: setIdx };
    const pieces = stream.nextSet();
    const blockPositions = getBlockPositions(cur);
    const result = picker(cur, pieces, blockPositions);
    if (!result) return { solved: false, sets: setIdx + 1 }; // тупик
    cur = result.grid;
    blocksLeft -= result.clearedBlocks;
    if (blocksLeft < 0) blocksLeft = 0;
  }

  return { solved: blocksLeft === 0, sets: setsCap };
}

// ============================================================================
// Конструктивная расстановка блоков (briefs §2.4).
// ============================================================================

const GEN_SALT = 0x4f92c3a1; // соль потока расстановки — не коллизирует с play-seed

function countAdjBlocks(grid: Grid, r: number, c: number): number {
  let n = 0;
  if (r > 0 && grid[r - 1][c] === 'block') n++;
  if (r < GRID_SIZE - 1 && grid[r + 1][c] === 'block') n++;
  if (c > 0 && grid[r][c - 1] === 'block') n++;
  if (c < GRID_SIZE - 1 && grid[r][c + 1] === 'block') n++;
  return n;
}

/**
 * Расставить blockCount особых блоков на пустой сетке.
 * Анти-кластер: соседние блоки допускаются только с вероятностью clusterChance.
 * Ограничение: ≤ 4 блоков на строку/столбец (иначе клиру оставшихся 4+ клеток мешает теснота).
 */
function placeBlocks(rng: Rng, blockCount: number, clusterChance: number): Grid {
  const grid = emptyGrid();
  const placed: Coord[] = [];
  let guard = 0;

  while (placed.length < blockCount && guard++ < 800) {
    const r = Math.floor(rng() * GRID_SIZE);
    const c = Math.floor(rng() * GRID_SIZE);
    if (grid[r][c] === 'block') continue;

    const adj = countAdjBlocks(grid, r, c);
    if (adj >= 2) continue;
    if (adj === 1 && rng() > clusterChance) continue;

    // ≤ 4 блоков в строке/столбце (оставить ≥4 пустых → хоть I4H/V влезет)
    const rowCount = placed.filter(p => p.r === r).length;
    const colCount = placed.filter(p => p.c === c).length;
    if (rowCount >= 4 || colCount >= 4) continue;

    grid[r][c] = 'block';
    placed.push({ r, c });
  }

  return grid;
}

/**
 * Структурная проверка сетки с блоками (briefs §2.4).
 * Потолок: ≤16 блоков (валидация честности), ≥1 блок.
 * Нет строки/столбца, уже "полного" (все 8 клеток ≠ empty немедленно очистятся — не нужны игроку).
 * Нет строки/столбца с >5 блоками (иначе ≤3 пустых — слишком мало для фигур).
 */
export function validBlocksLayout(grid: Grid): boolean {
  const blocks = countBlocks(grid);
  if (blocks < 1 || blocks > 16) return false;

  for (let r = 0; r < GRID_SIZE; r++) {
    let rowBlocks = 0;
    let rowNonEmpty = 0;
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === 'block') rowBlocks++;
      if (grid[r][c] !== 'empty') rowNonEmpty++;
    }
    if (rowNonEmpty === GRID_SIZE) return false;
    if (rowBlocks > 5) return false;
  }
  for (let c = 0; c < GRID_SIZE; c++) {
    let colBlocks = 0;
    let colNonEmpty = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
      if (grid[r][c] === 'block') colBlocks++;
      if (grid[r][c] !== 'empty') colNonEmpty++;
    }
    if (colNonEmpty === GRID_SIZE) return false;
    if (colBlocks > 5) return false;
  }

  return true;
}

// ============================================================================
// buildLevel + k-fork (briefs §2.5).
// ============================================================================

const MAX_RETRIES = 80;
const FORKS = 3; // k-fork: play-seed ^ 1..k, бюджет от худшего прошедшего

const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

function buildLevel(
  level: number,
  aSeed: number,
  grid: Grid,
  band: BlocksBand,
): BlockLevel | null {
  if (!validBlocksLayout(grid)) return null;
  const target = countBlocks(grid);
  if (target < 1) return null;
  const goal: BlockGoal = { kind: 'clearBlocks', target };

  // k-fork: ВСЕ форки должны решиться жадным свидетелем (отбраковка, если хоть один нет).
  const seeds = [aSeed];
  for (let k = 1; k <= FORKS; k++) seeds.push((aSeed ^ k) >>> 0);

  let worst = 0;
  for (const s of seeds) {
    const stream = makePieceStream(s);
    const result = simulateSolveBlocks(grid, goal, SOLVE_SETS_CAP, stream); // greedy по умолчанию
    if (!result.solved) return null;
    worst = Math.max(worst, result.sets);
  }

  const floor = band.budgetFloor ?? 3;
  const baseBudget = Math.max(worst + floor, Math.ceil(worst * band.budgetMultiplier));
  const budgetK = band.budgetK ?? 6;
  const kCeiling = target * budgetK;
  if (kCeiling < worst) return null;
  const setsBudget = Math.min(baseBudget, kCeiling);

  return { level, seed: aSeed, grid, goal, setsBudget };
}

// ============================================================================
// parachute + generateLevel — total-функция (briefs §2.6).
// ============================================================================

/**
 * Parachute-fallback: масштабированный, каждый возврат солвер-проверен (total-функция).
 *
 * Фаза 1: те же бэнд-параметры, без кластеров, расширенный budgetK×3.
 * Фаза 2: постепенно меньше блоков (до blocksMin/2).
 * Фаза 3: тривиальный 1-блочный уровень (абсолютный запас; на практике недостижим после фаз 1-2).
 */
export function parachute(level: number, seed: number): BlockLevel {
  const band = blocksBandForLevel(level);
  const relaxedBand: BlocksBand = { ...band, budgetK: (band.budgetK ?? 6) * 3 };

  // Фаза 1: бэнд-блоки, без кластеров, расширенный kCeiling.
  for (let attempt = 0; attempt < 80; attempt++) {
    const aSeed = (seed + attempt * 0x9e3779b1) >>> 0;
    const layoutRng = mulberry32((aSeed ^ 0x27d4eb2f) >>> 0);
    const blockCount = randInt(layoutRng, band.blocksMin, band.blocksMax);
    const grid = placeBlocks(layoutRng, blockCount, 0.05);
    const lvl = buildLevel(level, aSeed, grid, relaxedBand);
    if (lvl) return lvl;
  }

  // Фаза 2: меньше блоков, расширенный бюджет.
  const blockFloor = Math.max(1, Math.floor(band.blocksMin / 2));
  for (let blockTarget = band.blocksMin - 1; blockTarget >= blockFloor; blockTarget--) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const aSeed = (seed + attempt * 0x9e3779b1 + blockTarget * 0x12345) >>> 0;
      const layoutRng = mulberry32((aSeed ^ 0x27d4eb2f) >>> 0);
      const grid = placeBlocks(layoutRng, blockTarget, 0.05);
      const lvl = buildLevel(level, aSeed, grid, relaxedBand);
      if (lvl) return lvl;
    }
  }

  // Фаза 3: тривиальный 1-блок в центре (абсолютный запас; на практике недостижим).
  const trivialPositions: Coord[] = [
    { r: 3, c: 3 }, { r: 3, c: 4 }, { r: 4, c: 3 }, { r: 4, c: 4 }, { r: 2, c: 2 },
  ];
  for (const pos of trivialPositions) {
    for (let attempt = 0; attempt < 64; attempt++) {
      const aSeed = (seed + attempt * 0xd2b4a1c3 + pos.r * 8 + pos.c) >>> 0;
      const trivialGrid = emptyGrid();
      trivialGrid[pos.r][pos.c] = 'block';
      const goal: BlockGoal = { kind: 'clearBlocks', target: 1 };
      const result = simulateSolveBlocks(trivialGrid, goal, SOLVE_SETS_CAP, makePieceStream(aSeed));
      if (result.solved) {
        const setsBudget = Math.max(result.sets + 3, Math.ceil(result.sets * 2.5));
        return { level, seed: aSeed, grid: trivialGrid, goal, setsBudget };
      }
    }
  }

  throw new Error('[blocks/levels] parachute: не удалось найти тривиальный уровень — это BUG');
}

/**
 * Сгенерировать уровень (level, seed). ВСЕГДА возвращает проходимый уровень
 * (конструктивная расстановка → солвер-гейт + k-fork → parachute).
 */
export function generateLevel(level: number, seed: number): BlockLevel {
  const band = blocksBandForLevel(level);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const aSeed = (seed + attempt * 0x9e3779b1) >>> 0;
    const layoutRng = mulberry32((aSeed ^ GEN_SALT) >>> 0);
    const blockCount = randInt(layoutRng, band.blocksMin, band.blocksMax);
    const grid = placeBlocks(layoutRng, blockCount, band.clusterChance);
    const lvl = buildLevel(level, aSeed, grid, band);
    if (lvl) return lvl;
  }
  return parachute(level, seed);
}

// ============================================================================
// Незаконченный уровень: мягкое чтение (briefs §2.1).
// ============================================================================

function isValidGrid(raw: unknown): raw is Grid {
  return (
    Array.isArray(raw) &&
    raw.length === GRID_SIZE &&
    raw.every(
      row =>
        Array.isArray(row) &&
        row.length === GRID_SIZE &&
        row.every(cell => cell === 'empty' || cell === 'fill' || cell === 'block'),
    )
  );
}

function isValidPieceArray(raw: unknown): raw is Piece[] {
  if (!Array.isArray(raw)) return false;
  return raw.every(
    p =>
      p &&
      typeof p === 'object' &&
      Array.isArray((p as Piece).cells) &&
      (p as Piece).cells.every(
        (cell: unknown) =>
          cell &&
          typeof cell === 'object' &&
          typeof (cell as Coord).r === 'number' &&
          typeof (cell as Coord).c === 'number',
      ),
  );
}

/**
 * Мягкое чтение снимка незаконченного уровня: битое/частичное → null ⇒ безопасная деградация.
 * НИКОГДА не кидает. Зеркало normalizeSpicy из match3/levels.ts.
 */
export function normalizeBlocks(raw: unknown): BlockLevelState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<BlockLevelState> & { goal?: unknown };
  if (typeof r.level !== 'number' || r.level < 1) return null;
  if (typeof r.seed !== 'number') return null;
  if (typeof r.setsLeft !== 'number' || r.setsLeft < 0) return null;
  if (typeof r.progress !== 'number' || r.progress < 0) return null;
  if (typeof r.streamPos !== 'number' || r.streamPos < 0) return null;
  const goal = r.goal as { kind?: unknown; target?: unknown } | undefined;
  if (!goal || goal.kind !== 'clearBlocks' || typeof goal.target !== 'number' || goal.target < 1) return null;
  if (!isValidGrid(r.grid)) return null;
  if (!isValidPieceArray(r.currentPieces)) return null;
  return {
    level: Math.floor(r.level),
    seed: r.seed >>> 0,
    setsLeft: Math.floor(r.setsLeft),
    goal: { kind: 'clearBlocks', target: Math.floor(goal.target) },
    progress: Math.floor(r.progress),
    streamPos: Math.floor(r.streamPos),
    grid: r.grid as Grid,
    currentPieces: r.currentPieces as Piece[],
  };
}

