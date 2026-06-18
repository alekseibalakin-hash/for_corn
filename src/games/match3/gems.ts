// UI-адаптер Match-3 со СТАБИЛЬНЫМИ id (зеркало src/ui/tiles.ts). id живёт ТОЛЬКО здесь —
// в logic.ts/Gem/Board его НЕТ (это гарантия 175 logic-тестов). Framer Motion анимирует
// перемещение фишки по её стабильному id (настоящее падение), а не перерисовывает поле.
// Источник правды по типам — logic.Board; gemsToBoard сворачивает обратно (как tilesToGrid).

import {
  emptyObstacles,
  isStatic,
  settleColumn,
  SIZE,
  type Board,
  type CascadeStep,
  type Cell,
  type Coord,
  type GemType,
  type Obstacles,
  type Special,
} from './logic';

/** Визуальная фишка: id для layout-анимации + позиция + флаги входа/«только что создана». */
export interface VisualGem {
  id: number;
  type: GemType;
  special?: Special;
  r: number;
  c: number;
  /** Слоёв инея на фишке (>0 ⇒ заморожена: неподвижна, рендерится с морозом, при оттаивании оживает). */
  ice?: number;
  /** Только что прилетела сверху (refill) — анимируем влёт из-за края. */
  isNew: boolean;
  /** Только что создана как спецфишка — разовый pop (без вечного пульса). */
  justMade?: boolean;
}

const EMPTY_OBSTACLES: Obstacles = emptyObstacles();

let idCounter = 1;
const nextId = (): number => idCounter++;

const keyOf = (r: number, c: number): number => r * SIZE + c;

/**
 * Свежий id каждой непустой клетке (load / new-game / reshuffle / settled-board). isNew=false.
 * Лёд берётся из `ob.ice` (бриф §4): замороженная фишка остаётся VisualGem со своим id, неся `ice`.
 * Блок-клетки (board=null) фишек НЕ дают — блоки рисуются отдельным статичным слоем.
 */
export function boardToGems(board: Board, ob: Obstacles = EMPTY_OBSTACLES): VisualGem[] {
  const gems: VisualGem[] = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const cell = board[r][c];
      if (cell) gems.push({ id: nextId(), type: cell.type, special: cell.special, r, c, ice: ob.ice[r][c] || undefined, isNew: false });
    }
  }
  return gems;
}

/** Свернуть в plain Board {type,special} (id/ice ОТБРАСЫВАЮТСЯ) — для logic и персиста (зеркало tilesToGrid). */
export function gemsToBoard(gems: VisualGem[]): Board {
  const board: Board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null as Cell));
  for (const g of gems) board[g.r][g.c] = g.special ? { type: g.type, special: g.special } : { type: g.type };
  return board;
}

/**
 * Восстановить слои Obstacles из визуальных фишек: ice читается с самих VisualGem (фишка под льдом
 * несёт `ice`), blocks приходят извне (блок — не фишка, в gems его нет). Для инварианта gems.test:
 * сравнить с CascadeStep.obstacles ⇒ ловит десинк отслеживания льда между logic и gems-слоем (бриф §4).
 */
export function gemsToObstacles(gems: VisualGem[], blocks: boolean[][]): Obstacles {
  const ice = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0));
  for (const g of gems) if (g.ice && g.ice > 0) ice[g.r][g.c] = g.ice;
  return { blocks: blocks.map((row) => row.slice()), ice };
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
 * logic.step (clear → создать спец → СКОЛ ЛЬДА → gravity → refill). `ob` — препятствия ДО шага
 * (как у logic: лёд этого шага ещё static), дефолт — пустые (эндлесс: поведение прежнее):
 *  a) ретайрим (id НЕ переносим) фишки на step.cleared И на step.created. Лёд НЕ в cleared ⇒ фишка
 *     под льдом выживает со своим id (не пере-рождается);
 *  b) created → НОВАЯ VisualGem (nextId, justMade) на ПРЕД-гравитационной клетке created.r/c;
 *  b') скол льда: на step.iceHit-клетках ice-- у выжившей фишки (id сохраняется);
 *  c) ГРАВИТАЦИЯ через ОБЩУЮ settleColumn (то же, что logic.applyGravity) — обстаклы стоят, живые
 *     оседают в своём сегменте, СОХРАНЯЯ id; refill — только верхний открытый сегмент (refillRows);
 *  d) refill: НОВАЯ VisualGem (nextId, isNew) с типом из step.board[r][c] (ПОСТ-гравитация).
 * Инвариант (gems.test.ts): gemsToBoard(applyStep(prev,step,ob)) === step.board по {type,special}
 * И gemsToObstacles(...) === step.obstacles по {blocks,ice}.
 */
export function applyStep(prev: VisualGem[], step: CascadeStep, ob: Obstacles = EMPTY_OBSTACLES): VisualGem[] {
  // a) Кого не переносим: очищенные + клетки под создаваемые спецы.
  const retired = new Set<number>();
  for (const cell of step.cleared) retired.add(keyOf(cell.r, cell.c));
  for (const cre of step.created) retired.add(keyOf(cre.r, cre.c));
  const iceHitSet = new Set<number>();
  if (step.iceHit) for (const h of step.iceHit) iceHitSet.add(keyOf(h.r, h.c));

  // Пред-гравитационная сетка: выжившие хранят id (и сколотый лёд); created — новая на своей клетке.
  const grid: (VisualGem | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null as VisualGem | null));
  for (const g of prev) {
    const k = keyOf(g.r, g.c);
    if (retired.has(k)) continue;
    const ice = iceHitSet.has(k) && g.ice ? Math.max(0, g.ice - 1) : g.ice;
    grid[g.r][g.c] = { ...g, ice: ice || undefined, isNew: false, justMade: false };
  }
  for (const cre of step.created) {
    grid[cre.r][cre.c] = { id: nextId(), type: cre.type, special: cre.special, r: cre.r, c: cre.c, isNew: false, justMade: true };
  }

  // c) Гравитация — ОБЩАЯ settleColumn (зеркало logic.applyGravity по построению). Обстаклы (по ob ДО
  // шага) стоят на местах; живые подвижные оседают, сохраняя id.
  const out: VisualGem[] = [];
  const occupied: boolean[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
  for (let c = 0; c < SIZE; c++) {
    const isStaticAt = (r: number): boolean => isStatic(r, c, ob);
    const isFilledAt = (r: number): boolean => grid[r][c] != null && !isStaticAt(r);
    const { moves, refillRows } = settleColumn(isStaticAt, isFilledAt);
    const movedTo = new Map(moves.map((m) => [m.from, m.to] as const));
    for (let r = 0; r < SIZE; r++) {
      const g = grid[r][c];
      if (isStaticAt(r)) {
        if (g) out.push({ ...g, r, c }); // лёд: замороженная фишка стоит на месте
        occupied[r][c] = true; // блок (без фишки) или лёд — позиция занята, refill сюда не льёт
        continue;
      }
      if (!g) continue;
      const to = movedTo.has(r) ? movedTo.get(r)! : r;
      out.push({ ...g, r: to, c });
      occupied[to][c] = true;
    }
    // d) Рефилл ТОЛЬКО верхнего открытого сегмента — типы из step.board (источник истины по новым фишкам).
    for (const rr of refillRows) {
      if (occupied[rr][c]) continue;
      const cell = step.board[rr][c];
      if (cell) out.push({ id: nextId(), type: cell.type, special: cell.special, r: rr, c, isNew: true });
    }
  }
  return out;
}
