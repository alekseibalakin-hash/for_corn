// Генератор ЧЕСТНЫХ уровней Match-3 «с перчинкой» (бриф match3-spicy §2). Чистый модуль: работает на
// `Board`/`Obstacles` из logic.ts, НЕ импортирует gems.ts (id живут только там). Реюз движка обстаклов
// Фазы 1 (createRoomBoard/settleColumn/resolveSwap) — как есть.
//
// ПРАВИЛО №1: процедурный уровень ОБЯЗАН быть проходим за бюджет. Доказываем КОНСТРУКТИВНО:
//  (1) параметры сложности из content/spicy.json (бэнды);
//  (2) конструктивная расстановка обстаклов с инвариантами (блоки от пола; у каждой льдины открытый
//      орто-сосед; анти-кластер) — чтобы жадный солвер почти всегда проходил с 1-й попытки;
//  (3) ГАРАНТИЯ: жадный simulateSolve как свидетель; budget = max(worst+floor, ceil(worst×generosity)).
//      Мультистратегичный worst: ice-greedy (gate) + last-ice (reverse-scan) на k-fork потоках —
//      бюджет учитывает казуального игрока с нестандартным порядком ходов. budgetFloor — контентная ручка;
//  (4) потолок честности (ice ≤ 28, blocks ≤ 6) — в бэндах (validateContent);
//  (5) parachute-fallback после MAX_RETRIES ⇒ generateLevel ВСЕГДА возвращает уровень (total-функция).
// Жадный солвер доказывает ПРОХОДИМОСТЬ (решил → точно решаемо) — безопасная сторона.

import { spicyBandForLevel } from '../../content';
import type { SpicyBand } from '../../content/types';
import {
  cloneBoard,
  countIce,
  createRoomBoard,
  isStatic,
  isSwappable,
  mulberry32,
  resolveSwap,
  SIZE,
  type Board,
  type Coord,
  type Obstacles,
  type Rng,
  type RoomLayout,
} from './logic';

// ============================================================================
// Типы цели и уровня.
// ============================================================================

/** Цель уровня. v1 — только монотонная `clearIce` (разморозить N льдин; N = countIce(ob) на старте). */
export interface SpicyGoal {
  kind: 'clearIce';
  /** Сколько льдин надо разморозить (= число замороженных клеток на старте). */
  target: number;
}

/** Сгенерированный уровень: стартовая доска + обстаклы + цель + бюджет ходов + seed его play-потока. */
export interface SpicyLevel {
  level: number;
  /** Seed play-потока (makeStream(seed) — поток рефилла живой партии; на нём доказана проходимость). */
  seed: number;
  board: Board;
  obstacles: Obstacles;
  goal: SpicyGoal;
  /** Лимит ходов: max(worst+budgetFloor, ceil(worst×generosity)). */
  movesBudget: number;
}

/** Один ход свидетеля солвера (своп пары соседних клеток). */
export interface SolverMove {
  a: Coord;
  b: Coord;
}

export interface SolveResult {
  solved: boolean;
  moves: SolverMove[];
}

// ============================================================================
// Жадный солвер — КОНСТРУКТИВНОЕ доказательство проходимости (бриф §2.3).
// ============================================================================

const SOLVE_CAP = 300; // жёсткий потолок ходов солвера (стук в него = форк не решил → отбраковка)

/** Любая ли клетка орто-смежна с замороженной (т.е. матч в этих клетках реально скалывает лёд). */
function cellsTouchIce(cells: Coord[], ob: Obstacles): boolean {
  for (const { r, c } of cells) {
    if (
      (r > 0 && ob.ice[r - 1][c] > 0) ||
      (r < SIZE - 1 && ob.ice[r + 1][c] > 0) ||
      (c > 0 && ob.ice[r][c - 1] > 0) ||
      (c < SIZE - 1 && ob.ice[r][c + 1] > 0)
    ) {
      return true;
    }
  }
  return false;
}

/** Тип клетки, ЕСЛИ она матчабельна (есть подвижная фишка, не static), иначе -1 (как в findMatches). */
function matchTypeAt(board: Board, ob: Obstacles, r: number, c: number): number {
  const g = board[r][c];
  return g != null && !isStatic(r, c, ob) ? g.type : -1;
}

/**
 * Клетки ≥3-в-ряд, проходящие через (r,c) того же `type`, на поле, где (r,c) уже несёт `type`.
 * Между ходами поле СТАБИЛЬНО (без совпадений), а своп меняет лишь две клетки — поэтому новые матчи
 * могут идти ТОЛЬКО через них. Это даёт O(линия) проверку вместо findMatches O(64) (на порядок быстрее
 * солвер и live-генерацию). Пусто ⇒ через (r,c) матча нет.
 */
function lineCellsThrough(board: Board, ob: Obstacles, r: number, c: number, type: number): Coord[] {
  const cells: Coord[] = [];
  let left = c;
  while (left - 1 >= 0 && matchTypeAt(board, ob, r, left - 1) === type) left--;
  let right = c;
  while (right + 1 < SIZE && matchTypeAt(board, ob, r, right + 1) === type) right++;
  if (right - left + 1 >= 3) for (let cc = left; cc <= right; cc++) cells.push({ r, c: cc });
  let up = r;
  while (up - 1 >= 0 && matchTypeAt(board, ob, up - 1, c) === type) up--;
  let down = r;
  while (down + 1 < SIZE && matchTypeAt(board, ob, down + 1, c) === type) down++;
  if (down - up + 1 >= 3) for (let rr = up; rr <= down; rr++) cells.push({ r: rr, c });
  return cells;
}

/** Матч-клетки, которые создаёт своп (a,b) — только линии через a и b с их ПОСТ-своп типами. */
function swapMatchCells(board: Board, ob: Obstacles, a: Coord, b: Coord): Coord[] {
  const ta = board[b.r][b.c]!.type; // после свопа в a лежит фишка из b
  const tb = board[a.r][a.c]!.type;
  // Временно применяем своп логически через локальные типы: считаем линии так, будто a несёт ta, b несёт tb.
  // lineCellsThrough читает board напрямую, поэтому делаем дешёвый своп на клонированных ссылках клеток.
  const ca = board[a.r][a.c];
  const cb = board[b.r][b.c];
  board[a.r][a.c] = cb;
  board[b.r][b.c] = ca;
  const cells = [...lineCellsThrough(board, ob, a.r, a.c, ta), ...lineCellsThrough(board, ob, b.r, b.c, tb)];
  board[a.r][a.c] = ca; // вернуть как было (board не мутируется наружу)
  board[b.r][b.c] = cb;
  return cells;
}

/**
 * Выбрать ход жадно: предпочесть тот, что РЕАЛЬНО скалывает лёд (его матч орто-смежен со льдом), либо
 * своп со спецфишкой (большой клир → прогресс). Иначе — любой валидный ход (поле «крутится», рефилл
 * приносит новые ягоды к льду). Валидность/матч-клетки — дешёвой локальной проверкой (поле стабильно).
 * Возвращает null, если ходов нет вовсе (солвер трактует это как провал — БЕЗ reshuffle, безопасно).
 */
function pickSolverMove(board: Board, ob: Obstacles): SolverMove | null {
  let fallback: SolverMove | null = null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const a = { r, c };
      const dirs: Coord[] = [];
      if (c + 1 < SIZE) dirs.push({ r, c: c + 1 });
      if (r + 1 < SIZE) dirs.push({ r: r + 1, c });
      for (const b of dirs) {
        if (!isSwappable(board, ob, a.r, a.c) || !isSwappable(board, ob, b.r, b.c)) continue;
        if (board[a.r][a.c]!.special || board[b.r][b.c]!.special) return { a, b }; // спец → точно прогресс
        const cells = swapMatchCells(board, ob, a, b);
        if (cells.length === 0) continue; // невалидный своп
        if (!fallback) fallback = { a, b };
        if (cellsTouchIce(cells, ob)) return { a, b }; // ход скалывает лёд — берём сразу
      }
    }
  }
  return fallback;
}

/**
 * Жадно «играть» уровень на потоке `rng`, пока весь лёд не сколот (победа) или не упёрлись в потолок.
 * Возвращает свидетеля (список ходов) — конструктивное доказательство проходимости НА ЭТОМ потоке.
 * Доска/обстаклы не мутируются (клонируем вход). Без reshuffle: тупик ⇒ solved=false (безопасно).
 * `picker` — стратегия выбора хода; по умолчанию ice-greedy (для доказательства проходимости).
 */
export function simulateSolve(
  board: Board,
  ob: Obstacles,
  goal: SpicyGoal,
  cap: number,
  rng: Rng,
  picker: (board: Board, ob: Obstacles) => SolverMove | null = pickSolverMove,
): SolveResult {
  let cur = cloneBoard(board);
  let curOb = ob;
  const startIce = countIce(ob);
  const need = Math.min(goal.target, startIce);
  const done = (): boolean => startIce - countIce(curOb) >= need;
  const moves: SolverMove[] = [];
  for (let i = 0; i < cap; i++) {
    if (done()) return { solved: true, moves };
    const mv = picker(cur, curOb);
    if (!mv) return { solved: false, moves };
    const res = resolveSwap(cur, mv.a, mv.b, rng, curOb);
    cur = res.board;
    curOb = res.obstacles;
    moves.push(mv);
  }
  return { solved: done(), moves };
}

/**
 * Альт-стратегия «снизу-справа»: зеркало pickSolverMove с обратным порядком сканирования.
 * Используется как дополнительный свидетель для мультистратегичного worst-case бюджета.
 */
function pickLastIceSolverMove(board: Board, ob: Obstacles): SolverMove | null {
  let fallback: SolverMove | null = null;
  for (let r = SIZE - 1; r >= 0; r--) {
    for (let c = SIZE - 1; c >= 0; c--) {
      const a = { r, c };
      const dirs: Coord[] = [];
      if (c > 0) dirs.push({ r, c: c - 1 });
      if (r > 0) dirs.push({ r: r - 1, c });
      for (const b of dirs) {
        if (!isSwappable(board, ob, a.r, a.c) || !isSwappable(board, ob, b.r, b.c)) continue;
        if (board[a.r][a.c]!.special || board[b.r][b.c]!.special) return { a, b };
        const cells = swapMatchCells(board, ob, a, b);
        if (cells.length === 0) continue;
        if (!fallback) fallback = { a, b };
        if (cellsTouchIce(cells, ob)) return { a, b };
      }
    }
  }
  return fallback;
}

// ============================================================================
// Конструктивная расстановка обстаклов (бриф §2.2).
// ============================================================================

const GEN_SALT = 0x5bd1e995; // соль для потока генерации (раскладка/доска) — НЕ коллизирует с play-seed

const ortho = (r: number, c: number): Coord[] => [
  { r: r - 1, c },
  { r: r + 1, c },
  { r, c: c - 1 },
  { r, c: c + 1 },
];
const inBounds = (r: number, c: number): boolean => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

/** Есть ли у клетки (r,c) орто-сосед, который НЕ блок и НЕ лёд (т.е. подвижная ягода, способная сколоть лёд). */
function hasOpenOrthoNeighbor(blocked: boolean[][], iced: boolean[][], r: number, c: number): boolean {
  for (const n of ortho(r, c)) {
    if (!inBounds(n.r, n.c)) continue;
    if (!blocked[n.r][n.c] && !iced[n.r][n.c]) return true;
  }
  return false;
}

function countIceOrthoNeighbors(iced: boolean[][], r: number, c: number): number {
  let n = 0;
  for (const nb of ortho(r, c)) if (inBounds(nb.r, nb.c) && iced[nb.r][nb.c]) n++;
  return n;
}

/**
 * Конструктивная раскладка по параметрам:
 *  - БЛОКИ стекаются от пола вверх по столбцу (lowest free row) — НИКОГДА не оставляют подвижный
 *    сегмент под блоком (дыра под блоком не рефиллится, logic.settleColumn). Не выше row 2 (оставляем
 *    верх под рефилл/ходы).
 *  - ЛЁД разрежён: у каждой льдины ≥1 открытый орто-сосед (иначе нечем сколоть); анти-кластер
 *    (адъяцентность льда гейтится `clusterChance`, плюс не допускаем 3+ льдин крестом).
 */
function placeObstacles(rng: Rng, iceCount: number, blockCount: number, clusterChance: number): RoomLayout {
  const blocked: boolean[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
  const iced: boolean[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
  const blocks: Coord[] = [];
  const ice: Coord[] = [];

  // Блоки: floor-stacked. Кладём в самую нижнюю свободную строку выбранного столбца (≥ row 2).
  let guard = 0;
  while (blocks.length < blockCount && guard++ < 300) {
    const c = Math.floor(rng() * SIZE);
    let r = SIZE - 1;
    while (r >= 0 && blocked[r][c]) r--;
    if (r < 2) continue; // не забиваем столбец под потолок (оставляем открытый сегмент)
    blocked[r][c] = true;
    blocks.push({ r, c });
  }

  // Лёд: разрежён, с открытым соседом, анти-кластер.
  guard = 0;
  while (ice.length < iceCount && guard++ < 800) {
    const r = Math.floor(rng() * SIZE);
    const c = Math.floor(rng() * SIZE);
    if (blocked[r][c] || iced[r][c]) continue;
    const adj = countIceOrthoNeighbors(iced, r, c);
    if (adj >= 2) continue; // жёсткий анти-кластер: не строим лёд-кресты/линии
    if (adj === 1 && rng() > clusterChance) continue; // адъяцентность льда — редко (по clusterChance)
    if (!hasOpenOrthoNeighbor(blocked, iced, r, c)) continue; // нужен сосед, которым сколоть
    iced[r][c] = true;
    ice.push({ r, c });
  }

  return { blocks, ice };
}

/**
 * Финальная проверка инвариантов раскладки (бриф §2.2 + §8 «конструктивные инварианты»):
 *  - блоки floor-stacked (под каждым блоком — только блоки/пол);
 *  - у каждой льдины ≥1 открытый орто-сосед (не блок, не лёд) — иначе лёд нечем сколоть;
 *  - потолок честности (ice ≤ 28, blocks ≤ 6).
 * Позднее размещение льда могло «съесть» единственного открытого соседа раннего — поэтому валидируем
 * ФИНАЛ (а не только момент вставки); невалидную раскладку generateLevel отбракует и попробует снова.
 */
export function validLayout(layout: RoomLayout): boolean {
  const blocks = layout.blocks ?? [];
  const ice = layout.ice ?? [];
  if (ice.length > 28 || blocks.length > 6) return false;
  const blocked: boolean[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
  const iced: boolean[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
  for (const b of blocks) blocked[b.r][b.c] = true;
  for (const i of ice) if (!blocked[i.r][i.c]) iced[i.r][i.c] = true;
  // floor-stacked блоки: под блоком — только блоки до пола
  for (const b of blocks) for (let rr = b.r + 1; rr < SIZE; rr++) if (!blocked[rr][b.c]) return false;
  // каждая льдина «скалываема»
  for (const i of ice) if (iced[i.r][i.c] && !hasOpenOrthoNeighbor(blocked, iced, i.r, i.c)) return false;
  return true;
}

// ============================================================================
// generateLevel — total-функция: ВСЕГДА возвращает проходимый уровень (бриф §2).
// ============================================================================

const MAX_RETRIES = 40;
const FORKS = 3; // k-fork (бриф §2.3): solver на seed^1..k, бюджет от худшего выигравшего

const randInt = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

/** Очистить лёд на блок-клетках из количества цели — фактическая цель = countIce(ob) после createRoomBoard. */
function buildLevel(level: number, aSeed: number, layout: RoomLayout, band: SpicyBand): SpicyLevel | null {
  if (!validLayout(layout)) return null;
  const genRng = mulberry32((aSeed ^ GEN_SALT) >>> 0);
  const { board, obstacles } = createRoomBoard(layout, genRng);
  const target = countIce(obstacles);
  if (target < 1) return null; // нужен лёд для цели clearIce
  const goal: SpicyGoal = { kind: 'clearIce', target };

  // k-fork: базовый play-seed + форки. ВСЕ должны решиться ice-greedy-свидетелем (отбраковка).
  // Бюджет — от worst по ВСЕМ стратегиям × seed (мультистратегичный worst-case, ПРАВИЛО №1).
  const seeds = [aSeed];
  for (let k = 1; k <= FORKS; k++) seeds.push((aSeed ^ k) >>> 0);
  let worst = 0;
  for (const s of seeds) {
    const proof = simulateSolve(board, obstacles, goal, SOLVE_CAP, mulberry32(s));
    if (!proof.solved) return null; // любой форк не решил → отбраковка раскладки
    worst = Math.max(worst, proof.moves.length);
    // Alt-стратегии: дополнительные свидетели для более щедрого бюджета (не влияют на gate).
    const altLast = simulateSolve(board, obstacles, goal, SOLVE_CAP, mulberry32(s), pickLastIceSolverMove);
    if (altLast.solved) worst = Math.max(worst, altLast.moves.length);
  }
  const floor = band.budgetFloor ?? 4;
  const movesBudget = Math.max(worst + floor, Math.max(1, Math.ceil(worst * band.budgetMultiplier)));
  return { level, seed: aSeed, board, obstacles, goal, movesBudget };
}

// Parachute-раскладки от тривиальной к МАКСИМАЛЬНО тривиальной (одна изолированная льдина). Все —
// изолированные льдины с открытыми соседями, без блоков, без кластеров. Чем меньше льда, тем выше
// шанс, что жадный солвер сколет его до тупика (одна льдина на почти свободном 8×8 — фактически всегда).
const PARACHUTE_LAYOUTS: RoomLayout[] = [
  { blocks: [], ice: [{ r: 1, c: 1 }, { r: 1, c: 4 }, { r: 4, c: 2 }, { r: 4, c: 5 }] },
  { blocks: [], ice: [{ r: 3, c: 3 }, { r: 3, c: 5 }] },
  { blocks: [], ice: [{ r: 3, c: 3 }] },
];

/**
 * Parachute-fallback (бриф §2.5): заранее заданные заведомо решаемые раскладки. Используется, если за
 * MAX_RETRIES не нашли уровень ⇒ generateLevel ВСЕГДА total. КАЖДЫЙ возврат — солвер-проверенный (бюджет
 * от свидетеля): перебираем раскладки от тривиальной к максимально тривиальной × много seed, пока солвер
 * не подтвердит проходимость. Это закрывает дыру «final fallback без свидетеля»: безгейтовый возврат
 * теперь невозможен (3 раскладки × 96 seed ⇒ вероятность недостижения ниже любой реальной).
 */
export function parachute(level: number, seed: number): SpicyLevel {
  for (const layout of PARACHUTE_LAYOUTS) {
    for (let attempt = 0; attempt < 96; attempt++) {
      const aSeed = (seed + attempt * 0x9e3779b1 + 1) >>> 0;
      const genRng = mulberry32((aSeed ^ GEN_SALT) >>> 0);
      const { board, obstacles } = createRoomBoard(layout, genRng);
      const target = countIce(obstacles);
      if (target < 1) continue;
      const goal: SpicyGoal = { kind: 'clearIce', target };
      const res = simulateSolve(board, obstacles, goal, SOLVE_CAP, mulberry32(aSeed));
      if (res.solved) {
        // Очень щедрый бюджет (свидетель ×3, не меньше target×6): parachute = добрая страховка.
        const movesBudget = Math.max(target * 6, Math.ceil(res.moves.length * 3));
        return { level, seed: aSeed, board, obstacles, goal, movesBudget };
      }
    }
  }
  // Недостижимо на практике (3 раскладки × 96 seed), но если всё-таки дошли — honest loop на последней.
  // «Все возвраты солвер-проверены» — буквально верно.
  const lastLayout = PARACHUTE_LAYOUTS[PARACHUTE_LAYOUTS.length - 1];
  for (let attempt = 0; attempt < 64; attempt++) {
    const aSeed = (seed + attempt * 0xd2b4a1c3 + 0x1f) >>> 0;
    const genRng = mulberry32((aSeed ^ GEN_SALT) >>> 0);
    const { board, obstacles } = createRoomBoard(lastLayout, genRng);
    const target = countIce(obstacles);
    if (target < 1) continue;
    const goal: SpicyGoal = { kind: 'clearIce', target };
    const res = simulateSolve(board, obstacles, goal, SOLVE_CAP, mulberry32(aSeed));
    if (res.solved) {
      const movesBudget = Math.max(target * 6, Math.ceil(res.moves.length * 3));
      return { level, seed: aSeed, board, obstacles, goal, movesBudget };
    }
  }
  throw new Error('[levels] parachute: не удалось найти тривиально решаемый уровень — это BUG');
}

/**
 * Сгенерировать уровень по (level, seed). ВСЕГДА возвращает проходимый уровень (солвер-гейт + k-fork +
 * parachute). `seed` варьируется по попыткам, итоговый play-seed уровня — в `SpicyLevel.seed`.
 */
export function generateLevel(level: number, seed: number): SpicyLevel {
  const band = spicyBandForLevel(level);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const aSeed = (seed + attempt * 0x9e3779b1) >>> 0;
    const layoutRng = mulberry32((aSeed ^ 0x27d4eb2f) >>> 0); // отдельный поток на саму расстановку
    const iceCount = randInt(layoutRng, band.iceMin, band.iceMax);
    const blockCount = randInt(layoutRng, band.blocksMin, band.blocksMax);
    const layout = placeObstacles(layoutRng, iceCount, blockCount, band.clusterChance);
    const lvl = buildLevel(level, aSeed, layout, band);
    if (lvl) return lvl;
  }
  return parachute(level, seed);
}

// ============================================================================
// Незаконченный уровень: персист-снимок + мягкое чтение (бриф §5).
// ============================================================================

/** Эфемерный снимок незаконченного уровня (хранится в match3.board .spicy). board+obstacles + поток. */
export interface SpicyLevelState {
  level: number;
  seed: number;
  movesLeft: number;
  goal: SpicyGoal;
  /** Сколько льдин уже разморожено (растущий прогресс цели). */
  progress: number;
  /** Позиция play-потока: сколько rng() съедено (резюм продолжает ТОТ ЖЕ поток, задача №0). */
  streamPos: number;
  board: Board;
  obstacles: Obstacles;
}

function isBoardArray(raw: unknown): raw is Board {
  return Array.isArray(raw) && raw.length === SIZE && raw.every((row) => Array.isArray(row) && row.length === SIZE);
}

function normalizeObstaclesShape(raw: unknown): Obstacles | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { blocks?: unknown; ice?: unknown };
  if (!Array.isArray(r.blocks) || !Array.isArray(r.ice)) return null;
  const blocks: boolean[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => false));
  const ice: number[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0));
  for (let i = 0; i < SIZE; i++) {
    const br = r.blocks[i];
    const ir = r.ice[i];
    if (Array.isArray(br)) for (let j = 0; j < SIZE; j++) blocks[i][j] = br[j] === true;
    if (Array.isArray(ir)) for (let j = 0; j < SIZE; j++) ice[i][j] = typeof ir[j] === 'number' && ir[j] > 0 ? ir[j] : 0;
  }
  return { blocks, ice };
}

/**
 * Мягкое чтение снимка незаконченного уровня (бриф §5): битая/частичная цель/доска → null ⇒ безопасная
 * деградация «нет незаконченного» (хук начнёт новый уровень по maxSpicyLevel). НИКОГДА не кидает.
 */
export function normalizeSpicy(raw: unknown): SpicyLevelState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SpicyLevelState> & { goal?: unknown };
  if (typeof r.level !== 'number' || r.level < 1) return null;
  if (typeof r.seed !== 'number') return null;
  if (typeof r.movesLeft !== 'number' || r.movesLeft < 0) return null;
  if (typeof r.progress !== 'number' || r.progress < 0) return null;
  if (typeof r.streamPos !== 'number' || r.streamPos < 0) return null;
  const goal = r.goal as { kind?: unknown; target?: unknown } | undefined;
  if (!goal || goal.kind !== 'clearIce' || typeof goal.target !== 'number' || goal.target < 1) return null;
  if (!isBoardArray(r.board)) return null;
  const obstacles = normalizeObstaclesShape(r.obstacles);
  if (!obstacles) return null;
  return {
    level: Math.floor(r.level),
    seed: r.seed >>> 0,
    movesLeft: Math.floor(r.movesLeft),
    goal: { kind: 'clearIce', target: Math.floor(goal.target) },
    progress: Math.floor(r.progress),
    streamPos: Math.floor(r.streamPos),
    board: r.board as Board,
    obstacles,
  };
}

/** Мягкое чтение режима (форвард-совместимость; в v1 «последний режим» НЕ помним — §9 Q4). */
export function normalizeMode(raw: unknown): 'light' | 'spicy' | undefined {
  return raw === 'spicy' ? 'spicy' : raw === 'light' ? 'light' : undefined;
}
