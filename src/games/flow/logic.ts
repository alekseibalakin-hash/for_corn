// Чистая логика Flow «Соедини фигурки» (DESIGN-FLOW.md §5, briefs/flow-phase1.md §2).
// Никакого React/UI — только модель поля/пути + валидаторы, покрытые юнит-тестами.
//
// Игра: поле N×N, K пар «фигурок-концов». Игрок тянет путь от одного конца к парному по
// ортогональным соседям без самопересечений и без пересечения чужих путей. ЦЕЛЬ: соединить ВСЕ
// пары И заполнить ВСЁ поле (полное покрытие). Уровень строится ИЗ готового решения (construction,
// levels.ts §3), поэтому проходим ПО ПОСТРОЕНИЮ.
//
// АНТИ-ЦИРКУЛЯРНОСТЬ (брифа §8): проходимость доказывается isValidFlowSolution — ПРЯМОЙ проверкой
// покрытия (каждый путь валиден + пути не пересекаются + объединение = все клетки), НЕ солвером
// (levels.ts §4). Солвер — независимый witness качества (уникальность/нетривиальность).

export { mulberry32 } from '../../engine/rng';
export type { Rng } from '../../engine/rng';

export interface Coord {
  r: number;
  c: number;
}

/** Клетка сетки: индекс цвета/пары (0..K-1) или null = пусто. */
export type Cell = number | null;
/** Grid[row][col], индексы 0-based. */
export type Grid = Cell[][];

/** Пара концов одной фигурки. figure/color — нейтральный глиф + цвет трассы (для рендера Фазы 2). */
export interface FlowPair {
  figure: string;
  color: string;
  a: Coord;
  b: Coord;
}

/** Сгенерированный уровень: загадка (size + K пар) + solution (ДОКАЗАТЕЛЬСТВО проходимости). */
export interface FlowLevel {
  level: number;
  /** Seed уровня (детерминизм — тот же (level, seed) даёт тот же уровень). */
  seed: number;
  /** N — сторона поля. */
  size: number;
  /** K пар концов (загадка). */
  pairs: FlowPair[];
  /** [пара] → путь концы→концы. Покрывает ВСЕ N×N клеток (свидетель проходимости, для тестов/хинта). */
  solution: Coord[][];
}

/** Per-game состояние уровня (наградный слой Фазы 2). */
export interface FlowCurrentGame {
  score: number;
  moves: number;
  /** Звёзды за уровень (1-3). Устанавливаются только на победе (handleWin); при резюме — undefined. */
  stars?: number;
}

/** Снимок незаконченного уровня для резюма (персист-слот Фазы 2; мягко читается normalizeFlow). */
export interface FlowLevelState {
  level: number;
  seed: number;
  size: number;
  /**
   * Пары ЯВНО (не регенерим из seed) — иначе смена генератора рассинхронит сохранённый слот
   * (выученный урок Блоков: pairs/grid живут в слоте, а не пересчитываются).
   */
  pairs: FlowPair[];
  /** Текущий прогресс игрока по парам (может быть пустым — свежий старт). */
  paths: Coord[][];
  game: FlowCurrentGame;
}

// ============================================================================
// Базовые операции над сеткой.
// ============================================================================

export function emptyFlowGrid(size: number): Grid {
  return Array.from({ length: size }, () => Array.from({ length: size }, (): Cell => null));
}

/** Совпадают ли координаты. */
export function sameCoord(a: Coord, b: Coord): boolean {
  return a.r === b.r && a.c === b.c;
}

/** Ортогональные соседи: |dr| + |dc| === 1. */
export function adjacent(a: Coord, b: Coord): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

/** Непустой путь: соседние клетки подряд ортогонально смежны, без повторов. НЕ кидает на мусоре. */
export function isSimplePath(cells: unknown): cells is Coord[] {
  if (!Array.isArray(cells) || cells.length === 0) return false;
  const seen = new Set<string>();
  for (let i = 0; i < cells.length; i++) {
    const cur = cells[i] as Coord | undefined;
    // Number.isInteger отсеивает не только не-числа, но и NaN/Infinity/дробные: иначе клетка {r:NaN}
    // проскочила бы (typeof NaN === 'number') и owner[NaN] уронил бы isValidFlowSolution (НЕ кидать!).
    if (!cur || !Number.isInteger(cur.r) || !Number.isInteger(cur.c)) return false;
    const key = `${cur.r},${cur.c}`;
    if (seen.has(key)) return false; // повтор клетки
    seen.add(key);
    if (i > 0 && !adjacent(cells[i - 1] as Coord, cur)) return false; // разрыв
  }
  return true;
}

/**
 * ПРЯМОЕ доказательство проходимости (брифа §2, §8) — НЕ через солвер, чтобы не было циркулярности.
 * true ⟺ загадка (size, pairs) решена набором solution:
 *  • pairs.length === solution.length (по пути на пару);
 *  • каждый solution[i] — простой путь, концы которого = pairs[i].a / pairs[i].b (в любом порядке);
 *  • все клетки в границах поля;
 *  • пути НЕ пересекаются (каждая клетка занята ≤ 1 раз);
 *  • объединение покрывает ВСЕ N×N клеток РОВНО раз (полное покрытие = «расчистка»).
 * Чистая функция, НЕ кидает на мусоре.
 */
export function isValidFlowSolution(size: number, pairs: FlowPair[], solution: Coord[][]): boolean {
  if (!Number.isInteger(size) || size <= 0) return false;
  if (!Array.isArray(pairs) || !Array.isArray(solution)) return false;
  if (pairs.length === 0 || pairs.length !== solution.length) return false;

  // Сетка-владелец: каждая клетка занимается ровно одним путём (ловит и пересечения, и покрытие).
  const owner: Cell[][] = emptyFlowGrid(size);
  let covered = 0;

  for (let i = 0; i < pairs.length; i++) {
    const path = solution[i];
    const pair = pairs[i];
    if (!isSimplePath(path)) return false;
    if (!pair || typeof pair.a?.r !== 'number' || typeof pair.b?.r !== 'number') return false;
    if (sameCoord(pair.a, pair.b)) return false; // вырожденная пара (a===b) — не загадка, не «решено»

    for (const cell of path) {
      if (cell.r < 0 || cell.r >= size || cell.c < 0 || cell.c >= size) return false; // вне поля
      if (owner[cell.r][cell.c] !== null) return false; // пересечение
      owner[cell.r][cell.c] = i;
      covered++;
    }

    // Концы пути = концы пары (любой порядок).
    const start = path[0];
    const end = path[path.length - 1];
    const ab = sameCoord(start, pair.a) && sameCoord(end, pair.b);
    const ba = sameCoord(start, pair.b) && sameCoord(end, pair.a);
    if (!ab && !ba) return false;
  }

  // Полное покрытие: ровно N×N клеток.
  return covered === size * size;
}

/**
 * Детектор победы (Фаза 2 зовёт на каждый drop): игрок соединил все пары + заполнил всё поле.
 * Семантически идентичен прямой проверке решения, поэтому делегирует isValidFlowSolution
 * (неполный/пустой paths → length-mismatch / невалидный путь → false, как и должно).
 */
export function isSolvedByPlayer(size: number, pairs: FlowPair[], paths: Coord[][]): boolean {
  return isValidFlowSolution(size, pairs, paths);
}
