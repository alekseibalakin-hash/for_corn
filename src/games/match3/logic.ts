// Чистая логика Match-3 (Фаза B). Никакого React/UI здесь нет — только функции над полем,
// покрытые юнит-тестами (зеркало src/game для 2048). Поле 8×8, 6 типов фишек. «Вкус» —
// спецфишки: линия (4-в-ряд), цветобомба (5), бомба (форма L/T). Спецы активируются, когда
// попадают в совпадение или ими свопнули, и цепляют другие спецы (цепная активация).

/** Источник случайности — инъектируется ради детерминированных тестов (как в 2048). */
export type Rng = () => number;

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

// ---- Детерминированный ГПСЧ (mulberry32) для тестов: одинаковый seed → одинаковое поле. ----
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
export function findMatches(board: Board): Match[] {
  const h = new Set<number>();
  const v = new Set<number>();

  // Горизонтальные runs.
  for (let r = 0; r < SIZE; r++) {
    let runStart = 0;
    for (let c = 1; c <= SIZE; c++) {
      const prev = board[r][c - 1];
      const cur = c < SIZE ? board[r][c] : null;
      if (cur && prev && cur.type === prev.type) continue;
      const len = c - runStart;
      if (prev && len >= 3) for (let cc = runStart; cc < c; cc++) h.add(keyOf(r, cc));
      runStart = c;
    }
  }
  // Вертикальные runs.
  for (let c = 0; c < SIZE; c++) {
    let runStart = 0;
    for (let r = 1; r <= SIZE; r++) {
      const prev = board[r - 1][c];
      const cur = r < SIZE ? board[r][c] : null;
      if (cur && prev && cur.type === prev.type) continue;
      const len = r - runStart;
      if (prev && len >= 3) for (let rr = runStart; rr < r; rr++) v.add(keyOf(rr, c));
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

/** Падение: в каждом столбце живые фишки оседают вниз, сверху — пусто. */
export function applyGravity(board: Board): Board {
  const nb = emptyBoard();
  for (let c = 0; c < SIZE; c++) {
    let write = SIZE - 1;
    for (let r = SIZE - 1; r >= 0; r--) {
      const g = board[r][c];
      if (g) nb[write--][c] = { ...g };
    }
  }
  return nb;
}

/** Добивка: пустые клетки заполняются новыми случайными фишками (по столбцам, сверху вниз). */
export function refill(board: Board, rng: Rng): Board {
  const nb = cloneBoard(board);
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE; r++) {
      if (!nb[r][c]) nb[r][c] = { type: randType(rng) };
    }
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
  initial: Coord[],
  forced: Map<number, GemType | undefined>,
): { cleared: Set<number>; detonated: { r: number; c: number; special: Special }[] } {
  const cleared = new Set<number>();
  for (const cell of initial) if (inBounds(cell.r, cell.c)) cleared.add(keyOf(cell.r, cell.c));

  const detonatedSet = new Set<number>();
  const detonated: { r: number; c: number; special: Special }[] = [];
  const queue: number[] = [];

  const enqueue = (k: number) => {
    const g = board[rOf(k)][cOf(k)];
    if (g?.special && !detonatedSet.has(k)) queue.push(k);
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
  /** Поле после очистки+создания+гравитации+добивки (стабильное). */
  board: Board;
  clearedCount: number;
  cascadeLevel: number;
  scoreGained: number;
}

export interface ResolveResult {
  board: Board;
  gemsCleared: number;
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
  clearedCount: number;
  active: boolean;
}

function step(board: Board, rng: Rng, ignite?: Ignite, preferred?: Coord[]): StepOut {
  const matches = findMatches(board);
  const hasIgnite = !!(ignite && ((ignite.detonate && ignite.detonate.length) || (ignite.clear && ignite.clear.length)));
  if (matches.length === 0 && !hasIgnite) {
    return { board, cleared: [], created: [], detonated: [], clearedCount: 0, active: false };
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
  const { cleared, detonated } = expandClears(board, initial, forced);

  // 3) Новое поле: чистим, затем ставим созданные спецы (они переживают этот шаг).
  const nb = cloneBoard(board);
  const clearedCoords: Coord[] = [];
  let clearedCount = 0;
  for (const k of cleared) {
    if (createdKeys.has(k)) continue; // под создаваемый спец — не чистим
    const r = rOf(k);
    const c = cOf(k);
    if (nb[r][c]) {
      clearedCount++;
      clearedCoords.push({ r, c });
    }
    nb[r][c] = null;
  }
  for (const x of created) nb[x.r][x.c] = { type: x.type, special: x.special };

  // 4) Гравитация + добивка.
  const settled = refill(applyGravity(nb), rng);
  return { board: settled, cleared: clearedCoords, created, detonated, clearedCount, active: true };
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
  opts?: { ignite?: Ignite; preferred?: Coord[] },
): ResolveResult {
  let cur = cloneBoard(board);
  let level = 0;
  let gemsCleared = 0;
  let scoreGained = 0;
  let biggestClear = 0;
  const steps: CascadeStep[] = [];

  let ignite = opts?.ignite;
  let preferred = opts?.preferred;
  // Защита от патологического зацикливания (не должно случаться: каждый активный шаг что-то чистит).
  for (let guard = 0; guard < SIZE * SIZE * 4; guard++) {
    const out = step(cur, rng, ignite, preferred);
    if (!out.active) break;
    level++;
    const stepScore = 10 * out.clearedCount * level;
    gemsCleared += out.clearedCount;
    scoreGained += stepScore;
    biggestClear = Math.max(biggestClear, out.clearedCount);
    steps.push({
      cleared: out.cleared,
      created: out.created,
      detonated: out.detonated,
      board: out.board,
      clearedCount: out.clearedCount,
      cascadeLevel: level,
      scoreGained: stepScore,
    });
    cur = out.board;
    ignite = undefined;
    preferred = undefined;
  }

  return { board: cur, gemsCleared, scoreGained, maxCascade: level, biggestClear, steps };
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
export function isValidSwap(board: Board, a: Coord, b: Coord): boolean {
  if (!isAdjacent(a, b)) return false;
  const ga = board[a.r][a.c];
  const gb = board[b.r][b.c];
  if (!ga || !gb) return false;
  if (ga.special || gb.special) return true;
  return findMatches(applySwap(board, a, b)).length > 0;
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
export function resolveSwap(board: Board, a: Coord, b: Coord, rng: Rng): ResolveResult {
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
  return resolveCascades(swapped, rng, { ignite, preferred: [a, b] });
}

/**
 * Активировать спецфишку «на месте» по тапу (как Candy Crush: тап по спецу = детонация, без
 * свопа). Форс-детонируем спец в `cell` и проигрываем каскады — та же форма ResolveResult, что у
 * resolveSwap (steps/board/scoreGained/gemsCleared/maxCascade/biggestClear). Поле НЕ свопается:
 * детонация идёт по исходному полю. Для colorBomb без партнёра цель — её собственный тип (так
 * expandClears трактует forced без colorTarget, см. строку с `forced.get(k) ?? g.type`).
 * Если в клетке нет спецфишки — пустой результат (вызывающий код это не должен допускать).
 */
export function activateInPlace(board: Board, cell: Coord, rng: Rng): ResolveResult {
  const gem = board[cell.r][cell.c];
  if (!gem?.special) {
    return resolveCascades(board, rng); // no-op: нет спеца — нечего детонировать
  }
  const ignite: Ignite = { detonate: [{ coord: cell }] };
  return resolveCascades(board, rng, { ignite, preferred: [cell] });
}

// ============================================================================
// hasAnyMove / reshuffle / createBoard.
// ============================================================================

/**
 * Первая валидная пара-своп (вправо/вниз) или null — тот же перебор, что в hasAnyMove. Нужна
 * UI для ненавязчивой подсказки при простое (подсветить пару). Чистая, без побочных эффектов.
 */
export function findAnyMove(board: Board): [Coord, Coord] | null {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE && isValidSwap(board, { r, c }, { r, c: c + 1 })) return [{ r, c }, { r, c: c + 1 }];
      if (r + 1 < SIZE && isValidSwap(board, { r, c }, { r: r + 1, c })) return [{ r, c }, { r: r + 1, c }];
    }
  }
  return null;
}

export function hasAnyMove(board: Board): boolean {
  return findAnyMove(board) !== null;
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

/** Переразложить фишки, если ходов нет: без готовых совпадений и с валидным ходом. */
export function reshuffle(board: Board, rng: Rng): Board {
  const gems = board.flat().filter((g): g is Gem => g !== null);
  for (let attempt = 0; attempt < 100; attempt++) {
    const shuffled = shuffleGems(gems, rng);
    const nb = emptyBoard();
    let i = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) nb[r][c] = shuffled[i++] ?? { type: randType(rng) };
    if (findMatches(nb).length === 0 && hasAnyMove(nb)) return nb;
  }
  return createBoard(rng); // крайне маловероятный запасной путь
}
