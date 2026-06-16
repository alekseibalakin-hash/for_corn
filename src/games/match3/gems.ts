// UI-адаптер Match-3 со СТАБИЛЬНЫМИ id (зеркало src/ui/tiles.ts). id живёт ТОЛЬКО здесь —
// в logic.ts/Gem/Board его НЕТ (это гарантия 175 logic-тестов). Framer Motion анимирует
// перемещение фишки по её стабильному id (настоящее падение), а не перерисовывает поле.
// Источник правды по типам — logic.Board; gemsToBoard сворачивает обратно (как tilesToGrid).

import { SIZE, type Board, type CascadeStep, type Cell, type Coord, type GemType, type Special } from './logic';

/** Визуальная фишка: id для layout-анимации + позиция + флаги входа/«только что создана». */
export interface VisualGem {
  id: number;
  type: GemType;
  special?: Special;
  r: number;
  c: number;
  /** Только что прилетела сверху (refill) — анимируем влёт из-за края. */
  isNew: boolean;
  /** Только что создана как спецфишка — разовый pop (без вечного пульса). */
  justMade?: boolean;
}

let idCounter = 1;
const nextId = (): number => idCounter++;

const keyOf = (r: number, c: number): number => r * SIZE + c;

/** Свежий id каждой непустой клетке (load / new-game / reshuffle / settled-board). isNew=false. */
export function boardToGems(board: Board): VisualGem[] {
  const gems: VisualGem[] = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const cell = board[r][c];
      if (cell) gems.push({ id: nextId(), type: cell.type, special: cell.special, r, c, isNew: false });
    }
  }
  return gems;
}

/** Свернуть в plain Board {type,special} (id ОТБРАСЫВАЕТСЯ) — для logic и персиста (зеркало tilesToGrid). */
export function gemsToBoard(gems: VisualGem[]): Board {
  const board: Board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null as Cell));
  for (const g of gems) board[g.r][g.c] = g.special ? { type: g.type, special: g.special } : { type: g.type };
  return board;
}

/** Поменять местами (r,c) двух фишек по их позициям (для слайда свопа и его отката). */
export function swapGems(gems: VisualGem[], a: Coord, b: Coord): VisualGem[] {
  return gems.map((g) => {
    if (g.r === a.r && g.c === a.c) return { ...g, r: b.r, c: b.c };
    if (g.r === b.r && g.c === b.c) return { ...g, r: a.r, c: a.c };
    return g;
  });
}

/**
 * Воспроизвести ОДИН шаг каскада на визуальных фишках, СОХРАНЯЯ id выживших — один-в-один с
 * logic.step (clear → создать спец → gravity → refill):
 *  a) ретайрим (id НЕ переносим) фишки на step.cleared И на step.created (под спец старая не выживает);
 *  b) created → НОВАЯ VisualGem (nextId, justMade) на ПРЕД-гравитационной клетке created.r/c;
 *  c) ГРАВИТАЦИЯ один-в-один с logic.applyGravity (по столбцам, write=SIZE-1, r=SIZE-1..0) —
 *     живые и created оседают вниз, СОХРАНЯЯ id, получая новые (r,c);
 *  d) верхние «дыры» = refill: НОВАЯ VisualGem (nextId, isNew) с типом из step.board[r][c] (ПОСТ-гравитация).
 * Инвариант (см. gems.test.ts): gemsToBoard(applyStep(prev, step)) === step.board по {type,special}.
 */
export function applyStep(prev: VisualGem[], step: CascadeStep): VisualGem[] {
  // a) Кого не переносим: очищенные + клетки под создаваемые спецы.
  const retired = new Set<number>();
  for (const cell of step.cleared) retired.add(keyOf(cell.r, cell.c));
  for (const cre of step.created) retired.add(keyOf(cre.r, cre.c));

  // Пред-гравитационная сетка визуальных фишек: выжившие хранят id; created — новая на своей клетке.
  const grid: (VisualGem | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null as VisualGem | null));
  for (const g of prev) {
    if (retired.has(keyOf(g.r, g.c))) continue;
    grid[g.r][g.c] = { ...g, isNew: false, justMade: false };
  }
  for (const cre of step.created) {
    grid[cre.r][cre.c] = { id: nextId(), type: cre.type, special: cre.special, r: cre.r, c: cre.c, isNew: false, justMade: true };
  }

  // c) Гравитация — точная копия logic.applyGravity, но с сохранением id и обновлением (r,c).
  const out: VisualGem[] = [];
  const occupied: boolean[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
  for (let c = 0; c < SIZE; c++) {
    let write = SIZE - 1;
    for (let r = SIZE - 1; r >= 0; r--) {
      const g = grid[r][c];
      if (g) {
        out.push({ ...g, r: write, c });
        occupied[write][c] = true;
        write--;
      }
    }
  }

  // d) Рефилл верхних дыр — типы из step.board (пост-гравитация, источник истины по новым фишкам).
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE; r++) {
      if (occupied[r][c]) continue;
      const cell = step.board[r][c];
      if (cell) out.push({ id: nextId(), type: cell.type, special: cell.special, r, c, isNew: true });
    }
  }
  return out;
}
