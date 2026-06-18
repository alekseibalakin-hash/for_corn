// Чистая логика Match-3 (Фаза B). Никакого React/UI здесь нет — только функции над полем,
// покрытые юнит-тестами (зеркало src/game для 2048). Поле 8×8, 6 типов фишек. «Вкус» —
// спецфишки: линия (4-в-ряд), цветобомба (5), бомба (форма L/T). Спецы активируются, когда
// попадают в совпадение или ими свопнули, и цепляют другие спецы (цепная активация).

import { mulberry32 } from '../../engine/rng';
import type { Rng } from '../../engine/rng';
export { mulberry32 };
export type { Rng };

export const SIZE = 8;
export const TYPE_COUNT = 6;

/** Тип фишки: 0..TYPE_COUNT-1 (в UI мапится на эмодзи 🍓🫐🍋🍇🌸💗). */
export type GemType = number;

/**
 * Спецфишка («вкус» матч-3):
 *  - 'line' — линия (из 4-в-ряд): активация сносит весь ряд И столбец;
 *  - 'colorBomb' — цветобомба (из 5-в-ряд): своп с обычной убирает ВСЕ фишки её типа;
 *  - 'bomb' — бомба (из формы L/T): активация сносит область 3×3.
 */
export type Special = 'line' | 'bomb' | 'colorBomb';

export interface Gem {
  type: GemType;
  special?: Special;
}

/** Ячейка поля. `null` — пустая (транзиентно во время каскадов; стабильное поле без null). */
export type Cell = Gem | null;
export type Board = Cell[][];

export interface Coord {
  r: number;
  c: number;
}

// ============================================================================
// Препятствия (Match-3 «Комнаты», Фаза 1) — OVERLAY-СЛОИ рядом с Board, НЕ поля Cell/Gem.
// Блок не имеет id и не является фишкой; лёд лежит ПОВЕРХ обычной фишки (та сохраняет id в gems.ts).
// Дефолт (нет препятствий) ⇒ всё поведение БАЙТ-В-БАЙТ как в эндлессе (гарантия для партии жены).
// ============================================================================

/**
 * Параллельные Board матрицы 8×8 препятствий:
 *  - `blocks[r][c]` — неподвижная не-фишка (постоянный разделитель столбца; клетка board=null);
 *  - `ice[r][c]` — счётчик инея (>0 ⇒ фишка под ним заморожена: не падает/не свопается/не матчится).
 * В Фазе 1 лёд = ровно 1 слой (см. бриф §6). Блоки в Фазе 1 неудаляемы.
 */
export interface Obstacles {
  blocks: boolean[][];
  ice: number[][];
}

/** Пустые препятствия (нет блоков/льда). */
export function emptyObstacles(): Obstacles {
  return {
    blocks: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false)),
    ice: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0)),
  };
}

// Разделяемый read-only дефолт: функции ядра НЕ мутируют ob, поэтому общий инстанс безопасен.
// Это и даёт «нулевую аллокацию» на эндлесс-пути (ob по умолчанию = этот объект).
const EMPTY_OBSTACLES: Obstacles = emptyObstacles();

/** Единственный источник правды о неподвижности клетки (бриф §1). */
export const isStatic = (r: number, c: number, ob: Obstacles): boolean => ob.blocks[r][c] || ob.ice[r][c] > 0;

/** Клетка свопабельна, если в ней есть подвижная (не-static) фишка. */
export const isSwappable = (board: Board, ob: Obstacles, r: number, c: number): boolean =>
  board[r][c] != null && !isStatic(r, c, ob);

/** Есть ли хоть одно препятствие (для эндлесс-оптимизаций и решения «писать ли obstacles в персист»). */
export function isEmptyObstacles(ob: Obstacles): boolean {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (ob.blocks[r][c] || ob.ice[r][c] > 0) return false;
  return true;
}

/**
 * Сколько клеток сейчас заморожено (ice>0). В Фазе 1 лёд = 1 слой, поэтому это и число льдин, и
 * остаток цели `clearIce` (Match-3 «с перчинкой», бриф §2). НЕ путать с `isEmptyObstacles`, которая
 * конфлейтит blocks+ice; здесь считаем РОВНО лёд (блоки в цель не входят).
 */
export function countIce(ob: Obstacles): number {
  let n = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (ob.ice[r][c] > 0) n++;
  return n;
}

export function cloneObstacles(ob: Obstacles): Obstacles {
  return { blocks: ob.blocks.map((row) => row.slice()), ice: ob.ice.map((row) => row.slice()) };
}

/**
 * Скол льда: для координат `iceHit` уменьшить ob.ice на 1 (с полом 0). Возвращает НОВЫЙ объект
 * (blocks переиспользуются — read-only) либо тот же ref, если сколов нет (эндлесс не аллоцирует).
 */
export function applyIceHits(ob: Obstacles, iceHit: Coord[] | undefined): Obstacles {
  if (!iceHit || iceHit.length === 0) return ob;
  const ice = ob.ice.map((row) => row.slice());
  for (const h of iceHit) if (ice[h.r][h.c] > 0) ice[h.r][h.c] -= 1;
  return { blocks: ob.blocks, ice };
}

/** Мягкое чтение сохранённых препятствий (битые/частичные данные → пустые слои, без краша). */
export function normalizeObstacles(raw: unknown): Obstacles {
  const ob = emptyObstacles();
  if (!raw || typeof raw !== 'object') return ob;
  const r = raw as { blocks?: unknown; ice?: unknown };
  if (Array.isArray(r.blocks)) {
    for (let i = 0; i < SIZE; i++) {
      const row = r.blocks[i];
      if (Array.isArray(row)) for (let j = 0; j < SIZE; j++) ob.blocks[i][j] = row[j] === true;
    }
  }
  if (Array.isArray(r.ice)) {
    for (let i = 0; i < SIZE; i++) {
      const row = r.ice[i];
      if (Array.isArray(row)) for (let j = 0; j < SIZE; j++) ob.ice[i][j] = typeof row[j] === 'number' && row[j] > 0 ? row[j] : 0;
    }
  }
  return ob;
}

/**
 * Воспроизводимый поток ГПСЧ с КУРСОРОМ (Match-3 «с перчинкой», задача №0). mulberry32 детерминирован
 * по своему состоянию, а оно полностью определяется числом сделанных вызовов. Поэтому персистим `seed`
 * + `pos` (сколько rng() съедено) — и `makeStream(seed, pos)` ВОССТАНАВЛИВАЕТ ровно ту же точку потока:
 * резюм продолжает ТОТ ЖЕ поток рефилла, а реплей свидетеля солвера на seed воспроизводит решение.
 *  - `rng` — функция-поток (считает вызовы);
 *  - `pos()` — сколько раз `rng` уже вызвали (для персиста).
 */
export interface SeededStream {
  rng: Rng;
  pos: () => number;
}
export function makeStream(seed: number, skip = 0): SeededStream {
  const base = mulberry32(seed >>> 0);
  for (let i = 0; i < skip; i++) base(); // перемотка к сохранённой позиции (то же состояние mulberry32)
  let n = skip;
  const rng: Rng = () => {
    n++;
    return base();
  };
  return { rng, pos: () => n };
}

// ---- Мелкие хелперы поля ----
const keyOf = (r: number, c: number): number => r * SIZE + c;
const rOf = (k: number): number => Math.floor(k / SIZE);
const cOf = (k: number): number => k % SIZE;
const inBounds = (r: number, c: number): boolean => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function isAdjacent(a: Coord, b: Coord): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null as Cell));
}

function randType(rng: Rng): GemType {
  return Math.min(TYPE_COUNT - 1, Math.floor(rng() * TYPE_COUNT));
}

// ============================================================================
// findMatches — совпадения ≥3 с распознаванием формы (3 / линия4 / линия5 / L|T).
// ============================================================================

export type MatchShape = 'three' | 'line4' | 'line5' | 'LT';

export interface Match {
  type: GemType;
  cells: Coord[];
  shape: MatchShape;
}

/** Спецфишка, которую порождает форма совпадения (three — без спеца). */
export function specialForShape(shape: MatchShape): Special | undefined {
  switch (shape) {
    case 'line4':
      return 'line';
    case 'line5':
      return 'colorBomb';
    case 'LT':
      return 'bomb';
    default:
      return undefined;
  }
}

/**
 * Все совпадения на поле. Алгоритм: помечаем клетки, входящие в горизонтальный run≥3 (hMatched)
 * и в вертикальный run≥3 (vMatched); объединяем помеченные одного типа в связные группы
 * (4-связность). Форма группы:
 *  - есть и горизонтальный, и вертикальный run одного типа → 'LT' (бомба);
 *  - иначе прямая линия: длина 3 → 'three', 4 → 'line4', ≥5 → 'line5'.
 */
export function findMatches(board: Board, ob: Obstacles = EMPTY_OBSTACLES): Match[] {
  const h = new Set<number>();
  const v = new Set<number>();

  // Тип фишки, ЕСЛИ клетка матчабельна (есть фишка И не static), иначе -1 (разрывает run как null).
  // Замороженная/блок-клетка не входит ни в одно совпадение (бриф §1). Дефолт ob ⇒ -1 только для null.
  const matchTypeAt = (r: number, c: number): number => {
    const g = board[r][c];
    return g != null && !isStatic(r, c, ob) ? g.type : -1;
  };

  // Горизонтальные runs.
  for (let r = 0; r < SIZE; r++) {
    let runStart = 0;
    for (let c = 1; c <= SIZE; c++) {
      const prevT = matchTypeAt(r, c - 1);
      const curT = c < SIZE ? matchTypeAt(r, c) : -1;
      if (curT !== -1 && prevT !== -1 && curT === prevT) continue;
      const len = c - runStart;
      if (prevT !== -1 && len >= 3) for (let cc = runStart; cc < c; cc++) h.add(keyOf(r, cc));
      runStart = c;
    }
  }
  // Вертикальные runs.
  for (let c = 0; c < SIZE; c++) {
    let runStart = 0;
    for (let r = 1; r <= SIZE; r++) {
      const prevT = matchTypeAt(r - 1, c);
      const curT = r < SIZE ? matchTypeAt(r, c) : -1;
      if (curT !== -1 && prevT !== -1 && curT === prevT) continue;
      const len = r - runStart;
      if (prevT !== -1 && len >= 3) for (let rr = runStart; rr < r; rr++) v.add(keyOf(rr, c));
      runStart = r;
    }
  }

  const matched = new Set<number>([...h, ...v]);
  if (matched.size === 0) return [];

  // Связные компоненты одного типа.
  const seen = new Set<number>();
  const matches: Match[] = [];
  for (const start of matched) {
    if (seen.has(start)) continue;
    const type = board[rOf(start)][cOf(start)]!.type;
    const cellsK: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      cellsK.push(k);
      const r = rOf(k);
      const c = cOf(k);
      const neighbors = [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ];
      for (const [nr, nc] of neighbors) {
        if (!inBounds(nr, nc)) continue;
        const nk = keyOf(nr, nc);
        if (seen.has(nk) || !matched.has(nk)) continue;
        const g = board[nr][nc];
        if (g && g.type === type) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    // Форма по ГЕОМЕТРИИ компоненты, а не по сырому числу клеток: line4/line5 — только для
    // НАСТОЯЩЕЙ прямой линии (все клетки в одной строке ИЛИ одном столбце). Любой не-прямой
    // кластер (угол/T/плюс/блок/стык двух троек) → 'LT' (бомба). Иначе блок 2×3 ошибочно
    // считался бы line5 (цветобомбой), а стык двух троек — тоже цветобомбой.
    const rows = new Set(cellsK.map(rOf));
    const cols = new Set(cellsK.map(cOf));
    const straight = rows.size === 1 || cols.size === 1;
    let shape: MatchShape;
    if (!straight) shape = 'LT';
    else if (cellsK.length >= 5) shape = 'line5';
    else if (cellsK.length === 4) shape = 'line4';
    else shape = 'three';
    matches.push({ type, shape, cells: cellsK.map((k) => ({ r: rOf(k), c: cOf(k) })) });
  }
  return matches;
}

/** Клетка под спецфишку: предпочесть свопнутую (если она в группе), иначе центр/пересечение. */
function pickSpecialCell(match: Match, preferred?: Coord[]): Coord {
  if (preferred) {
    const hit = match.cells.find((cell) => preferred.some((p) => p.r === cell.r && p.c === cell.c));
    if (hit) return hit;
  }
  if (match.shape === 'LT') {
    // Пересечение: клетка с соседом по группе и по горизонтали, и по вертикали.
    const set = new Set(match.cells.map((c) => keyOf(c.r, c.c)));
    const cross = match.cells.find((c) => {
      const hN = set.has(keyOf(c.r, c.c - 1)) || set.has(keyOf(c.r, c.c + 1));
      const vN = set.has(keyOf(c.r - 1, c.c)) || set.has(keyOf(c.r + 1, c.c));
      return hN && vN;
    });
    if (cross) return cross;
  }
  return match.cells[Math.floor(match.cells.length / 2)];
}

// ============================================================================
// Гравитация и добивка.
// ============================================================================

/**
 * ЕДИНСТВЕННЫЙ источник правды о падении столбца (бриф §3) — зовут И logic.applyGravity, И
 * gems.applyStep, поэтому зеркало не может рассинхрониться по построению. Чистая: только предикаты.
 *  - `isStaticAt(r)` — неподвижна ли клетка (блок/лёд): делит столбец на сегменты, не падает;
 *  - `isFilledAt(r)` — есть ли в клетке ПОДВИЖНАЯ живая фишка (не static, не null), которая падает.
 * Возвращает перемещения `from→to` (живые фишки оседают к низу своего сегмента) и `refillRows` —
 * строки ВЕРХНЕГО открытого сегмента (выше самого верхнего обстакла), куда можно долить. Под-блочные
 * дыры (сегменты ниже обстакла) в refillRows НЕ попадают — остаются null навсегда (бриф §3/§6).
 */
export function settleColumn(
  isStaticAt: (r: number) => boolean,
  isFilledAt: (r: number) => boolean,
): { moves: Array<{ from: number; to: number }>; refillRows: number[] } {
  const moves: Array<{ from: number; to: number }> = [];
  const refillRows: number[] = [];
  let r = SIZE - 1;
  while (r >= 0) {
    if (isStaticAt(r)) {
      r--;
      continue;
    }
    // Сегмент подвижных клеток [segTop, segBottom] между обстаклами (или до потолка/пола).
    const segBottom = r;
    let segTop = segBottom;
    while (segTop - 1 >= 0 && !isStaticAt(segTop - 1)) segTop--;
    // Оседание: живые фишки сегмента пишутся к низу (write идёт снизу вверх).
    let write = segBottom;
    for (let rr = segBottom; rr >= segTop; rr--) {
      if (isFilledAt(rr)) {
        if (rr !== write) moves.push({ from: rr, to: write });
        write--;
      }
    }
    // Пустые клетки сегмента = [segTop, write]. Рефиллим ТОЛЬКО верхний открытый сегмент (segTop===0).
    if (segTop === 0) for (let rr = segTop; rr <= write; rr++) refillRows.push(rr);
    r = segTop - 1; // прыжок выше сегмента (segTop-1 — обстакл или -1)
  }
  return { moves, refillRows };
}

/**
 * Падение: в каждом столбце живые фишки оседают вниз внутри своего сегмента; обстаклы остаются
 * на местах; сверху — пусто (добивку делает refill). Дефолт ob ⇒ один сегмент = весь столбец
 * (поведение идентично прежнему applyGravity).
 */
export function applyGravity(board: Board, ob: Obstacles = EMPTY_OBSTACLES): Board {
  const nb = emptyBoard();
  for (let c = 0; c < SIZE; c++) {
    const isStaticAt = (r: number): boolean => isStatic(r, c, ob);
    const isFilledAt = (r: number): boolean => board[r][c] != null && !isStaticAt(r);
    const { moves } = settleColumn(isStaticAt, isFilledAt);
    const movedFrom = new Map(moves.map((m) => [m.from, m.to] as const));
    for (let r = 0; r < SIZE; r++) {
      if (isStaticAt(r)) {
        if (board[r][c]) nb[r][c] = { ...board[r][c]! }; // лёд: фишка на месте; блок: остаётся null
        continue;
      }
      const g = board[r][c];
      if (!g) continue;
      const to = movedFrom.has(r) ? movedFrom.get(r)! : r;
      nb[to][c] = { ...g };
    }
  }
  return nb;
}

/**
 * Добивка: пустые клетки ВЕРХНЕГО открытого сегмента (выше самого верхнего обстакла) заполняются
 * новыми случайными фишками (по столбцам, сверху вниз — порядок rng сохранён). Под-блочные дыры НЕ
 * доливаются. Дефолт ob ⇒ верхний сегмент = весь столбец (заполняются все пустые, как прежде).
 */
export function refill(board: Board, rng: Rng, ob: Obstacles = EMPTY_OBSTACLES): Board {
  const nb = cloneBoard(board);
  for (let c = 0; c < SIZE; c++) {
    let topStatic = SIZE; // самый верхний обстакл в столбце (его нет ⇒ весь столбец открыт)
    for (let r = 0; r < SIZE; r++)
      if (isStatic(r, c, ob)) {
        topStatic = r;
        break;
      }
    for (let r = 0; r < topStatic; r++) if (!nb[r][c]) nb[r][c] = { type: randType(rng) };
  }
  return nb;
}

// ============================================================================
// Активация спецфишек: какие клетки сносит спец на позиции (r,c).
// ============================================================================

function effectCells(special: Special, at: Coord, board: Board, colorTarget: GemType): Coord[] {
  const out: Coord[] = [];
  if (special === 'line') {
    for (let c = 0; c < SIZE; c++) out.push({ r: at.r, c });
    for (let r = 0; r < SIZE; r++) out.push({ r, c: at.c });
  } else if (special === 'bomb') {
    for (let r = at.r - 1; r <= at.r + 1; r++)
      for (let c = at.c - 1; c <= at.c + 1; c++) if (inBounds(r, c)) out.push({ r, c });
  } else {
    // colorBomb: все фишки целевого типа (при свопе с обычной — её тип; иначе — свой).
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const g = board[r][c];
        if (g && g.type === colorTarget) out.push({ r, c });
      }
  }
  return out;
}

interface ForcedDet {
  coord: Coord;
  /** Цель цветобомбы при свопе с обычной фишкой (её тип). */
  colorTarget?: GemType;
}

/** Зажигание шага: форс-детонации спецов (свопнутые) + «сырые» клетки очистки (комбо). */
interface Ignite {
  detonate?: ForcedDet[];
  clear?: Coord[];
}

/**
 * Собрать ВСЕ очищаемые клетки с цепной активацией спецов. `initial` — стартовые клетки
 * (совпадения + комбо-очистка + позиции форс-детонаций). Любой спец, попавший в очистку
 * (или форс-детонированный), активируется; его эффект добавляет клетки и может цеплять
 * другие спецы. Возвращает множество ключей клеток + список детонировавших (для FX).
 */
function expandClears(
  board: Board,
  ob: Obstacles,
  initial: Coord[],
  forced: Map<number, GemType | undefined>,
): { cleared: Set<number>; detonated: { r: number; c: number; special: Special }[] } {
  const cleared = new Set<number>();
  for (const cell of initial) if (inBounds(cell.r, cell.c)) cleared.add(keyOf(cell.r, cell.c));

  const detonatedSet = new Set<number>();
  const detonated: { r: number; c: number; special: Special }[] = [];
  const queue: number[] = [];

  // Гейт: static-клетка (блок/лёд) НЕ детонирует — спец не пробивает обстакл (бриф §1).
  const enqueue = (k: number) => {
    const r = rOf(k);
    const c = cOf(k);
    const g = board[r][c];
    if (g?.special && !isStatic(r, c, ob) && !detonatedSet.has(k)) queue.push(k);
  };
  for (const k of cleared) enqueue(k);
  for (const k of forced.keys()) {
    cleared.add(k);
    enqueue(k);
  }

  while (queue.length) {
    const k = queue.shift()!;
    if (detonatedSet.has(k)) continue;
    const g = board[rOf(k)][cOf(k)];
    if (!g?.special) continue;
    detonatedSet.add(k);
    detonated.push({ r: rOf(k), c: cOf(k), special: g.special });
    const target = forced.has(k) ? forced.get(k) ?? g.type : g.type;
    for (const e of effectCells(g.special, { r: rOf(k), c: cOf(k) }, board, target)) {
      const ek = keyOf(e.r, e.c);
      cleared.add(ek);
      enqueue(ek);
    }
  }
  return { cleared, detonated };
}

// ============================================================================
// Шаг каскада и resolveCascades.
// ============================================================================

export interface CascadeStep {
  /** Визуально очищенные клетки этого шага (без созданных спецфишек). */
  cleared: Coord[];
  /** Спецфишки, созданные на этом шаге (остаются на поле). */
  created: { r: number; c: number; special: Special; type: GemType }[];
  /** Спецфишки, детонировавшие на этом шаге (для эффекта взрыва). */
  detonated: { r: number; c: number; special: Special }[];
  /** Клетки, у которых на этом шаге сколот иней (ice--) — ОТДЕЛЬНЫЙ канал, для FX (бриф §2). */
  iceHit?: Coord[];
  /** Поле после очистки+создания+гравитации+добивки (стабильное). */
  board: Board;
  /** Препятствия ПОСЛЕ шага (ice уже уменьшён на iceHit). Гравитация шага считалась по ob ДО. */
  obstacles: Obstacles;
  clearedCount: number;
  cascadeLevel: number;
  scoreGained: number;
}

export interface ResolveResult {
  board: Board;
  /** Препятствия после всего хода (для персиста/целей комнат, Фаза 2). */
  obstacles: Obstacles;
  gemsCleared: number;
  /** Сколько слоёв инея сколото за ход суммарно (для целей комнат, Фаза 2) — НЕ часть счёта. */
  iceCleared: number;
  scoreGained: number;
  /** Длина цепочки каскадов за этот ход. */
  maxCascade: number;
  /** Макс. число клеток, убранных за один шаг (растёт от спецфишек). */
  biggestClear: number;
  steps: CascadeStep[];
}

interface StepOut {
  board: Board;
  cleared: Coord[];
  created: { r: number; c: number; special: Special; type: GemType }[];
  detonated: { r: number; c: number; special: Special }[];
  iceHit: Coord[];
  clearedCount: number;
  active: boolean;
}

function step(board: Board, rng: Rng, ob: Obstacles, ignite?: Ignite, preferred?: Coord[]): StepOut {
  const matches = findMatches(board, ob);
  const hasIgnite = !!(ignite && ((ignite.detonate && ignite.detonate.length) || (ignite.clear && ignite.clear.length)));
  if (matches.length === 0 && !hasIgnite) {
    return { board, cleared: [], created: [], detonated: [], iceHit: [], clearedCount: 0, active: false };
  }

  // 1) Создаваемые спецфишки + «семена» очистки от совпадений (без клеток-создания спецов).
  const created: { r: number; c: number; special: Special; type: GemType }[] = [];
  const createdKeys = new Set<number>();
  const seeds: Coord[] = [];
  for (const m of matches) {
    const special = specialForShape(m.shape);
    if (special) {
      const cell = pickSpecialCell(m, preferred);
      created.push({ r: cell.r, c: cell.c, special, type: m.type });
      createdKeys.add(keyOf(cell.r, cell.c));
    }
  }
  for (const m of matches) {
    for (const cell of m.cells) if (!createdKeys.has(keyOf(cell.r, cell.c))) seeds.push(cell);
  }

  // 2) Стартовые клетки + цепная детонация (по исходному полю, до создания новых спецов).
  const initial: Coord[] = [...seeds];
  if (ignite?.clear) initial.push(...ignite.clear);
  const forced = new Map<number, GemType | undefined>();
  if (ignite?.detonate) for (const d of ignite.detonate) forced.set(keyOf(d.coord.r, d.coord.c), d.colorTarget);
  const { cleared, detonated } = expandClears(board, ob, initial, forced);

  // 3) Новое поле: чистим, затем ставим созданные спецы (они переживают этот шаг).
  // Гейт: static-клетку (блок/лёд) НЕ зануляем и НЕ считаем — спец не пробивает обстакл (бриф §1).
  const nb = cloneBoard(board);
  const clearedCoords: Coord[] = [];
  let clearedCount = 0;
  for (const k of cleared) {
    if (createdKeys.has(k)) continue; // под создаваемый спец — не чистим
    const r = rOf(k);
    const c = cOf(k);
    if (isStatic(r, c, ob)) continue; // обстакл переживает очистку
    if (nb[r][c]) {
      clearedCount++;
      clearedCoords.push({ r, c });
    }
    nb[r][c] = null;
  }
  for (const x of created) nb[x.r][x.c] = { type: x.type, special: x.special };

  // 3.5) Скол льда — ОТДЕЛЬНЫЙ канал (бриф §2): ice>0 клетка, орто-смежная с любой РЕАЛЬНО очищенной,
  // помечается в iceHit (ice-- применяет resolveCascades к ob СЛЕДУЮЩЕГО шага). НЕ в cleared, НЕ в счёт.
  const iceHit: Coord[] = [];
  if (clearedCoords.length) {
    const clearedSet = new Set(clearedCoords.map((cc) => keyOf(cc.r, cc.c)));
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (ob.ice[r][c] <= 0) continue;
        const touched =
          (r > 0 && clearedSet.has(keyOf(r - 1, c))) ||
          (r < SIZE - 1 && clearedSet.has(keyOf(r + 1, c))) ||
          (c > 0 && clearedSet.has(keyOf(r, c - 1))) ||
          (c < SIZE - 1 && clearedSet.has(keyOf(r, c + 1)));
        if (touched) iceHit.push({ r, c });
      }
  }

  // 4) Гравитация + добивка под обстаклы (та же ob, что и у findMatches — лёд этого шага ещё static).
  const settled = refill(applyGravity(nb, ob), rng, ob);
  return { board: settled, cleared: clearedCoords, created, detonated, iceHit, clearedCount, active: true };
}

/**
 * Нужна ли гравитация/добивка под данными препятствиями (проверяем после скола льда: бывшая
 * static-клетка стала подвижной, её sub-static сегмент ниже теперь в зоне гравитации).
 */
function needsSettle(board: Board, ob: Obstacles): boolean {
  for (let c = 0; c < SIZE; c++) {
    const isStaticAt = (r: number): boolean => isStatic(r, c, ob);
    const isFilledAt = (r: number): boolean => board[r][c] != null && !isStaticAt(r);
    const { moves, refillRows } = settleColumn(isStaticAt, isFilledAt);
    if (moves.length > 0 || refillRows.length > 0) return true;
  }
  return false;
}

/**
 * Цикл «совпадения → спецфишки → активация спецов и сбор ВСЕХ очищаемых клеток → гравитация →
 * добивка → снова», пока есть что убирать. `opts.ignite`/`opts.preferred` действуют только на
 * ПЕРВОМ шаге (своп). Счёт: 10 × число фишек × уровень_каскада (взрывы спецов засчитывают все
 * убранные клетки → крупные комбо дают большой счёт).
 */
export function resolveCascades(
  board: Board,
  rng: Rng,
  opts?: { ignite?: Ignite; preferred?: Coord[]; obstacles?: Obstacles },
): ResolveResult {
  let cur = cloneBoard(board);
  // ob — read-only во всём ядре (step/applyIceHits НЕ мутируют), поэтому клонировать не нужно.
  let ob = opts?.obstacles ?? EMPTY_OBSTACLES;
  let level = 0;
  let gemsCleared = 0;
  let iceCleared = 0;
  let scoreGained = 0;
  let biggestClear = 0;
  const steps: CascadeStep[] = [];

  let ignite = opts?.ignite;
  let preferred = opts?.preferred;
  // Защита от патологического зацикливания (не должно случаться: каждый активный шаг что-то чистит).
  for (let guard = 0; guard < SIZE * SIZE * 4; guard++) {
    const out = step(cur, rng, ob, ignite, preferred);
    if (!out.active) break;
    level++;
    const stepScore = 10 * out.clearedCount * level;
    gemsCleared += out.clearedCount;
    iceCleared += out.iceHit.length;
    scoreGained += stepScore;
    biggestClear = Math.max(biggestClear, out.clearedCount);
    // Гравитация шага считалась по ob ДО скола; ob ПОСЛЕ шага = ob с ice-- на iceHit (для след. шага).
    const nextOb = applyIceHits(ob, out.iceHit);
    steps.push({
      cleared: out.cleared,
      created: out.created,
      detonated: out.detonated,
      iceHit: out.iceHit.length ? out.iceHit : undefined,
      board: out.board,
      obstacles: nextOb,
      clearedCount: out.clearedCount,
      cascadeLevel: level,
      scoreGained: stepScore,
    });
    cur = out.board;
    ob = nextOb;
    ignite = undefined;
    preferred = undefined;

    // После скола льда (iceHit непустой): гравитация шага считалась по ob ДО скола — у оттаявшего
    // столбца может остаться дыра (sub-static сегмент ниже льда не рефиллится этим шагом). Если поле
    // не осело под новым ob, выдаём дополнительный «settle-only» шаг (cleared/created=[],
    // scoreGained=0): gravity+refill под post-thaw ob. Цикл продолжает: долитые фишки могут дать
    // матч → каскады идут штатно.
    if (out.iceHit.length > 0 && needsSettle(cur, ob)) {
      const settled = refill(applyGravity(cur, ob), rng, ob);
      steps.push({
        cleared: [],
        created: [],
        detonated: [],
        board: settled,
        obstacles: ob,
        clearedCount: 0,
        cascadeLevel: level,
        scoreGained: 0,
      });
      cur = settled;
    }
  }

  return { board: cur, obstacles: ob, gemsCleared, iceCleared, scoreGained, maxCascade: level, biggestClear, steps };
}

// ============================================================================
// Свопы: валидность и разрешение (включая спецфишки и базовые комбо).
// ============================================================================

const allCells = (): Coord[] => {
  const out: Coord[] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out.push({ r, c });
  return out;
};
const cellsOfType = (board: Board, type: GemType): Coord[] => {
  const out: Coord[] = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (board[r][c]?.type === type) out.push({ r, c });
  return out;
};
const square = (at: Coord, radius: number): Coord[] => {
  const out: Coord[] = [];
  for (let r = at.r - radius; r <= at.r + radius; r++)
    for (let c = at.c - radius; c <= at.c + radius; c++) if (inBounds(r, c)) out.push({ r, c });
  return out;
};
/** «Толстый крест»: 3 ряда (центр±1) + 3 столбца (центр±1) — для комбо line+bomb. */
const thickCross = (center: Coord): Coord[] => {
  const out: Coord[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    const r = center.r + dr;
    if (r >= 0 && r < SIZE) for (let c = 0; c < SIZE; c++) out.push({ r, c });
  }
  for (let dc = -1; dc <= 1; dc++) {
    const c = center.c + dc;
    if (c >= 0 && c < SIZE) for (let r = 0; r < SIZE; r++) out.push({ r, c });
  }
  return out;
};

export function applySwap(board: Board, a: Coord, b: Coord): Board {
  const nb = cloneBoard(board);
  const tmp = nb[a.r][a.c];
  nb[a.r][a.c] = nb[b.r][b.c];
  nb[b.r][b.c] = tmp;
  return nb;
}

/** Своп даёт совпадение ИЛИ это активация спеца (своп со спецфишкой всегда валиден). */
export function isValidSwap(board: Board, a: Coord, b: Coord, ob: Obstacles = EMPTY_OBSTACLES): boolean {
  if (!isAdjacent(a, b)) return false;
  // Только подвижные фишки: обстакл (блок/лёд) свопать нельзя (бриф §1). Дефолт ob ⇒ просто «обе непусты».
  if (!isSwappable(board, ob, a.r, a.c) || !isSwappable(board, ob, b.r, b.c)) return false;
  const ga = board[a.r][a.c]!;
  const gb = board[b.r][b.c]!;
  if (ga.special || gb.special) return true;
  return findMatches(applySwap(board, a, b), ob).length > 0;
}

/** Зажигание для комбо двух спецфишек (после свопа: origA уже на b, origB — на a). */
function comboIgnite(origA: Gem, origB: Gem, posOrigA: Coord, posOrigB: Coord, swapped: Board): Ignite {
  const sA = origA.special!;
  const sB = origB.special!;
  // colorBomb + colorBomb → всё поле.
  if (sA === 'colorBomb' && sB === 'colorBomb') return { clear: allCells() };
  // colorBomb + line/bomb → КАЖДАЯ фишка типа партнёра «становится» его спецом и детонирует
  // (цепная очистка всего цвета). Сама цветобомба детонирует по типу партнёра (выбирает его цвет),
  // а не по своему — поэтому colorTarget = тип партнёра.
  if (sA === 'colorBomb' || sB === 'colorBomb') {
    const cbIsA = sA === 'colorBomb';
    const cbPos = cbIsA ? posOrigA : posOrigB;
    const partnerPos = cbIsA ? posOrigB : posOrigA;
    const partnerSpecial = cbIsA ? sB : sA; // 'line' | 'bomb' (cb+cb уже обработан выше)
    const partnerType = swapped[partnerPos.r][partnerPos.c]!.type;
    const clear: Coord[] = [];
    for (const t of cellsOfType(swapped, partnerType)) {
      if (partnerSpecial === 'line') {
        for (let c = 0; c < SIZE; c++) clear.push({ r: t.r, c });
        for (let r = 0; r < SIZE; r++) clear.push({ r, c: t.c });
      } else {
        clear.push(...square(t, 1)); // bomb-конверсия: 3×3 вокруг каждой фишки типа
      }
    }
    return { clear, detonate: [{ coord: cbPos, colorTarget: partnerType }] };
  }
  // bomb + bomb → 5×5.
  if (sA === 'bomb' && sB === 'bomb') {
    return { clear: square(posOrigA, 2), detonate: [{ coord: posOrigA }, { coord: posOrigB }] };
  }
  // line + bomb → «толстый крест»: 3 ряда + 3 столбца, центр — на ЛИНИИ (тогда 3×3-эффект бомбы и
  // ряд/столбец линии целиком умещаются в крест, и набор очистки = ровно толстый крест).
  if ((sA === 'line' && sB === 'bomb') || (sA === 'bomb' && sB === 'line')) {
    const linePos = sA === 'line' ? posOrigA : posOrigB;
    return { clear: thickCross(linePos), detonate: [{ coord: posOrigA }, { coord: posOrigB }] };
  }
  // line + line (крест) — детонируем оба, цепь соберёт оба ряда и оба столбца.
  return { detonate: [{ coord: posOrigA }, { coord: posOrigB }] };
}

/**
 * Разрешить своп a↔b и каскады. Предполагается isValidSwap(board,a,b)===true. Возвращает
 * ResolveResult по уже свопнутому полю: обычные фишки → совпадения; спецфишка → активация
 * (одиночная или комбо при свопе двух спецов).
 */
export function resolveSwap(board: Board, a: Coord, b: Coord, rng: Rng, ob: Obstacles = EMPTY_OBSTACLES): ResolveResult {
  const origA = board[a.r][a.c]!;
  const origB = board[b.r][b.c]!;
  const swapped = applySwap(board, a, b); // после свопа: origA на b, origB на a
  const aSp = origA.special;
  const bSp = origB.special;

  let ignite: Ignite | undefined;
  if (aSp && bSp) {
    ignite = comboIgnite(origA, origB, b, a, swapped);
  } else {
    const detonate: ForcedDet[] = [];
    if (aSp) detonate.push({ coord: b, colorTarget: aSp === 'colorBomb' ? origB.type : undefined });
    if (bSp) detonate.push({ coord: a, colorTarget: bSp === 'colorBomb' ? origA.type : undefined });
    if (detonate.length) ignite = { detonate };
  }
  return resolveCascades(swapped, rng, { ignite, preferred: [a, b], obstacles: ob });
}

/**
 * Активировать спецфишку «на месте» по тапу (как Candy Crush: тап по спецу = детонация, без
 * свопа). Форс-детонируем спец в `cell` и проигрываем каскады — та же форма ResolveResult, что у
 * resolveSwap (steps/board/scoreGained/gemsCleared/maxCascade/biggestClear). Поле НЕ свопается:
 * детонация идёт по исходному полю. Для colorBomb без партнёра цель — её собственный тип (так
 * expandClears трактует forced без colorTarget, см. строку с `forced.get(k) ?? g.type`).
 * Если в клетке нет спецфишки — пустой результат (вызывающий код это не должен допускать).
 */
export function activateInPlace(board: Board, cell: Coord, rng: Rng, ob: Obstacles = EMPTY_OBSTACLES): ResolveResult {
  const gem = board[cell.r][cell.c];
  if (!gem?.special) {
    return resolveCascades(board, rng, { obstacles: ob }); // no-op: нет спеца — нечего детонировать
  }
  const ignite: Ignite = { detonate: [{ coord: cell }] };
  return resolveCascades(board, rng, { ignite, preferred: [cell], obstacles: ob });
}

// ============================================================================
// hasAnyMove / reshuffle / createBoard.
// ============================================================================

/**
 * Первая валидная пара-своп (вправо/вниз) или null — тот же перебор, что в hasAnyMove. Нужна
 * UI для ненавязчивой подсказки при простое (подсветить пару). Чистая, без побочных эффектов.
 */
export function findAnyMove(board: Board, ob: Obstacles = EMPTY_OBSTACLES): [Coord, Coord] | null {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE && isValidSwap(board, { r, c }, { r, c: c + 1 }, ob)) return [{ r, c }, { r, c: c + 1 }];
      if (r + 1 < SIZE && isValidSwap(board, { r, c }, { r: r + 1, c }, ob)) return [{ r, c }, { r: r + 1, c }];
    }
  }
  return null;
}

/** Клетка (r,c) орто-смежна хотя бы с одной замороженной клеткой (ice > 0). */
function adjToIce(ob: Obstacles, r: number, c: number): boolean {
  return (
    (r > 0 && ob.ice[r - 1][c] > 0) ||
    (r < SIZE - 1 && ob.ice[r + 1][c] > 0) ||
    (c > 0 && ob.ice[r][c - 1] > 0) ||
    (c < SIZE - 1 && ob.ice[r][c + 1] > 0)
  );
}

/**
 * Подсказка «с перчинкой»: возвращает первый валидный своп, хотя бы одна из клеток которого
 * орто-смежна со льдом → затем любой валидный своп (как findAnyMove). Контракт идентичен findAnyMove.
 */
export function findIcePreferredMove(board: Board, ob: Obstacles): [Coord, Coord] | null {
  let fallback: [Coord, Coord] | null = null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const dirs = [[0, 1], [1, 0]] as const;
      for (const [dr, dc] of dirs) {
        const b = { r: r + dr, c: c + dc };
        if (b.r >= SIZE || b.c >= SIZE) continue;
        const a = { r, c };
        if (!isValidSwap(board, a, b, ob)) continue;
        if (!fallback) fallback = [a, b];
        if (adjToIce(ob, r, c) || adjToIce(ob, b.r, b.c)) return [a, b];
      }
    }
  }
  return fallback;
}

export function hasAnyMove(board: Board, ob: Obstacles = EMPTY_OBSTACLES): boolean {
  return findAnyMove(board, ob) !== null;
}

function hasImmediateMatchAt(board: Board, r: number, c: number, type: GemType): boolean {
  const left2 = c >= 2 && board[r][c - 1]?.type === type && board[r][c - 2]?.type === type;
  const up2 = r >= 2 && board[r - 1][c]?.type === type && board[r - 2][c]?.type === type;
  return !!left2 || !!up2;
}

/** Стартовое поле БЕЗ готовых совпадений и хотя бы с одним валидным ходом. */
export function createBoard(rng: Rng): Board {
  for (let attempt = 0; attempt < 200; attempt++) {
    const board = emptyBoard();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        let type = randType(rng);
        let guard = 0;
        while (guard++ < 50 && hasImmediateMatchAt(board, r, c, type)) type = randType(rng);
        board[r][c] = { type };
      }
    }
    if (findMatches(board).length === 0 && hasAnyMove(board)) return board;
  }
  // Запасной путь (практически недостижим): гарантированно без совпадений «шахматкой» из 2 типов.
  const board = emptyBoard();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) board[r][c] = { type: (r + Math.floor(c / 2)) % 2 };
  return board;
}

function shuffleGems(gems: Gem[], rng: Rng): Gem[] {
  const arr = gems.map((g) => ({ ...g }));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Переразложить фишки, если ходов нет: без готовых совпадений и с валидным ходом. Room-aware (бриф §5):
 * тасуем ТОЛЬКО свободные подвижные фишки (isSwappable), обстаклы (блоки/лёд) остаются на местах.
 * Дефолт ob ⇒ свопабельны все непустые клетки (поведение идентично прежнему reshuffle).
 */
export function reshuffle(board: Board, rng: Rng, ob: Obstacles = EMPTY_OBSTACLES): Board {
  const slots: Coord[] = [];
  const gems: Gem[] = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (isSwappable(board, ob, r, c)) {
        slots.push({ r, c });
        gems.push(board[r][c]!);
      }
  for (let attempt = 0; attempt < 100; attempt++) {
    const shuffled = shuffleGems(gems, rng);
    const nb = cloneBoard(board); // сохраняем обстаклы (лёд-фишки, блок-null) на местах
    slots.forEach((s, i) => (nb[s.r][s.c] = shuffled[i] ? { ...shuffled[i] } : { type: randType(rng) }));
    if (findMatches(nb, ob).length === 0 && hasAnyMove(nb, ob)) return nb;
  }
  // Запасной путь. Без обстаклов — свежее поле (как прежде). С обстаклами — НЕ разрушаем раскладку:
  // отдаём последнюю перетасовку (редкий случай; комната без проигрыша переживёт готовое совпадение).
  if (isEmptyObstacles(ob)) return createBoard(rng);
  const nb = cloneBoard(board);
  const shuffled = shuffleGems(gems, rng);
  slots.forEach((s, i) => (nb[s.r][s.c] = shuffled[i] ? { ...shuffled[i] } : { type: randType(rng) }));
  return nb;
}

// ============================================================================
// Room-доска (Фаза 1): отдельный путь от createBoard, НЕ трогает эндлесс (бриф §1/§5).
// ============================================================================

/** Раскладка комнаты: где блоки и замороженные (ice=1) клетки. Фишки — случайные (как createBoard). */
export interface RoomLayout {
  blocks?: Coord[];
  ice?: Coord[];
}

/**
 * Стартовая доска комнаты: блок-клетки пусты (board=null), лёд-клетки получают обычную фишку (ice=1),
 * остальное — случайные фишки без готовых совпадений и хотя бы с одним валидным ходом (с учётом ob).
 */
export function createRoomBoard(layout: RoomLayout, rng: Rng): { board: Board; obstacles: Obstacles } {
  const ob = emptyObstacles();
  for (const b of layout.blocks ?? []) ob.blocks[b.r][b.c] = true;
  for (const i of layout.ice ?? []) if (!ob.blocks[i.r][i.c]) ob.ice[i.r][i.c] = 1;

  for (let attempt = 0; attempt < 200; attempt++) {
    const board = emptyBoard();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (ob.blocks[r][c]) continue; // блок — пустая клетка (не фишка)
        let type = randType(rng);
        let guard = 0;
        while (guard++ < 50 && hasImmediateMatchAt(board, r, c, type)) type = randType(rng);
        board[r][c] = { type };
      }
    }
    if (findMatches(board, ob).length === 0 && hasAnyMove(board, ob)) return { board, obstacles: ob };
  }
  // Запасной путь: «шахматка» из 2 типов (без совпадений), блок-клетки пусты.
  const board = emptyBoard();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) board[r][c] = ob.blocks[r][c] ? null : { type: (r + Math.floor(c / 2)) % 2 };
  return { board, obstacles: ob };
}
