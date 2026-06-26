// Генератор уровней Flow «Соедини фигурки» (DESIGN-FLOW.md §2-§4, briefs/flow-phase1.md §3-§5).
// Чистый модуль — только логика, без React. Зеркало blocks/levels.ts (та же идиоматика:
// construction + солвер-гейт + parachute + seeded RNG).
//
// ЯКОРЯ ПРОДАКТА (DESIGN-FLOW §0): (1) нарастающая сложность; (2) много уровней; (3) ВСЕ проходимы.
//
// ПРАВИЛО №1 (проходимость — Якорь 3) доказывается КОНСТРУКЦИЕЙ, а не солвером:
//  (1) randomHamiltonian — случайный путь через ВСЕ клетки (фолбэк-змейка ⇒ путь есть ВСЕГДА);
//  (2) cutIntoSegments(K) — режем на K смежных сегментов ⇒ объединение = все клетки (покрытие);
//  (3) концы сегментов = пары ⇒ solution валиден ⇒ isValidFlowSolution === true ПО ПОСТРОЕНИЮ
//      (logic.ts — ПРЯМАЯ проверка покрытия, нециркулярно с солвером);
//  (4) parachute: после MAX_RETRIES отдаём построенный уровень (он проходим) ⇒ generateLevel total.
//
// Солвер countFlowSolutions (§4) — НЕЗАВИСИМЫЙ witness КАЧЕСТВА (уникальность/нетривиальность),
// НЕ доказательство проходимости. С жёстким SOLVE_NODE_CAP ⇒ не виснет; на capping — кандидат
// принимается (структурный гейт уже пройден). На больших полях (size > UNIQUENESS_MAX_SIZE)
// уникальность дорога ⇒ гейт структурный (изгиб+нетривиальность) без неё (брифа §8) — якоря целы.

import { mulberry32 } from '../../engine/rng';
import type { Rng } from '../../engine/rng';
import { flowBandForLevel } from '../../content';
import type { FlowBand } from '../../content/types';
import {
  isValidFlowSolution,
  sameCoord,
  type Coord,
  type FlowCurrentGame,
  type FlowLevel,
  type FlowLevelState,
  type FlowPair,
} from './logic';

export type { Coord, FlowCurrentGame, FlowLevel, FlowLevelState, FlowPair } from './logic';

// ============================================================================
// Константы генератора.
// ============================================================================

const MAX_RETRIES = 80; // попыток на качество, дальше — parachute (как Блоки)
const HAMILTON_STEP_CAP_MULT = 200; // потолок шагов рандом-гамильтона = size² × этого
const MIN_SEGMENT = 3; // минимальная длина сегмента: ⇒ нет тривиальных пар (длина-2 = прямой коннект)
const GEN_SALT = 0x7f4a91c3; // соль выбора K — отдельна от seed построения
const PARACHUTE_SALT = 0x50415241; // 'PARA' — соль парашюта

/** Сентинел солвера: число решений не определено (превышен node cap). Кандидат принимается на парашюте. */
export const SOLVE_CAP_EXCEEDED = -1;
/** Поля ≤ этого размера получают гейт уникальности; крупнее — структурный гейт (брифа §8, скорость). */
const UNIQUENESS_MAX_SIZE = 6;
const GEN_UNIQ_NODE_CAP = 20_000; // потолок узлов солвера в гейте уникальности (size ≤ 6)

const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

// ============================================================================
// Набор нейтральных фигур (DESIGN-FLOW §7). Для Фазы 1 — строковые идентификаторы (Фаза 2 рендерит
// lucide-глифы). K ≤ pairsMax ≤ size+2 ≤ 10 < FIGURES.length ⇒ фигуры/цвета в уровне различимы.
// ============================================================================

interface FlowFigure {
  figure: string;
  color: string;
}

const FIGURES: readonly FlowFigure[] = [
  { figure: 'heart', color: '#ef6f8e' },
  { figure: 'star', color: '#f4b13d' },
  { figure: 'flower', color: '#d977c8' },
  { figure: 'moon', color: '#6f8bef' },
  { figure: 'sun', color: '#f0883c' },
  { figure: 'leaf', color: '#5fb86f' },
  { figure: 'droplet', color: '#4cc4d6' },
  { figure: 'cat', color: '#c98a5e' },
  { figure: 'cherry', color: '#e25563' },
  { figure: 'cloud', color: '#8fa3b8' },
  { figure: 'snowflake', color: '#7ec8e3' },
  { figure: 'key', color: '#b59a4d' },
];

/** «Без цвета» (глубокие бэнды §7): трассы нейтральны, пара опознаётся ТОЛЬКО по фигуре — тяжелее. */
const NEUTRAL_COLOR = '#9aa0a6';

// ============================================================================
// §3. Гамильтонов путь (Якорь «проходимы»).
// ============================================================================

function neighborsOf(cell: number, size: number): number[] {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const res: number[] = [];
  if (r > 0) res.push(cell - size);
  if (r < size - 1) res.push(cell + size);
  if (c > 0) res.push(cell - 1);
  if (c < size - 1) res.push(cell + 1);
  return res;
}

const MAX_HAMILTON_RESTARTS = 8; // рестартов с разных стартовых клеток до фолбэка-змейки

/** Рандомизированный backtracking-DFS от фиксированного старта с эвристикой Варнсдорфа. */
function hamiltonFrom(start: number, size: number, total: number, stepCap: number, rng: Rng): Coord[] | null {
  const visited = new Uint8Array(total);
  const path: number[] = [];
  let steps = 0;
  visited[start] = 1;
  path.push(start);

  const onwardDegree = (cell: number): number => {
    let d = 0;
    for (const n of neighborsOf(cell, size)) if (!visited[n]) d++;
    return d;
  };

  const dfs = (cell: number): boolean => {
    if (path.length === total) return true;
    if (steps++ > stepCap) return false;

    // Кандидаты — непосещённые соседи; Варнсдорф: порядок по возрастанию onwardDegree, ничьи случайны.
    const cands = neighborsOf(cell, size).filter(n => !visited[n]);
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    cands.sort((a, b) => onwardDegree(a) - onwardDegree(b));

    for (const n of cands) {
      if (steps > stepCap) return false;
      visited[n] = 1;
      path.push(n);
      if (dfs(n)) return true;
      visited[n] = 0;
      path.pop();
    }
    return false;
  };

  if (!dfs(start)) return null;
  return path.map(idx => ({ r: Math.floor(idx / size), c: idx % size }));
}

/**
 * Случайный гамильтонов путь через ВСЕ клетки (по разу): рандомизированный backtracking-DFS с
 * эвристикой Варнсдорфа (предпочесть соседа с наименьшим числом дальнейших ходов — меньше тупиков,
 * быстрее) и РЕСТАРТАМИ с разных стартов. Жёсткий потолок шагов на попытку → null (фолбэк-змейка).
 *
 * ВАЖНО (паритет): на сетке гамильтонов путь раскрашивает клетки по очереди (шахматно). При НЕЧЁТНОМ
 * N² клеток на одну больше у мажорной раскраски ((r+c) чётно) ⇒ ОБА конца пути ОБЯЗАНЫ быть мажорными.
 * Старт с минорной клетки на нечётном поле НЕВОЗМОЖЕН (DFS обречён исчерпать дерево) — поэтому старты
 * берём только из допустимых концов (нечётное поле → (r+c) чётно; чётное → любая клетка).
 */
export function randomHamiltonian(size: number, rng: Rng): Coord[] | null {
  const total = size * size;
  if (total <= 0) return null;
  const stepCap = total * HAMILTON_STEP_CAP_MULT;

  const oddGrid = total % 2 === 1;
  const starts: number[] = [];
  for (let cell = 0; cell < total; cell++) {
    const r = Math.floor(cell / size);
    const c = cell % size;
    if (!oddGrid || (r + c) % 2 === 0) starts.push(cell);
  }
  for (let i = starts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [starts[i], starts[j]] = [starts[j], starts[i]];
  }

  const restarts = Math.min(starts.length, MAX_HAMILTON_RESTARTS);
  for (let t = 0; t < restarts; t++) {
    const res = hamiltonFrom(starts[t], size, total, stepCap, rng);
    if (res) return res;
  }
  return null;
}

/** Змейка (boustrophedon) — ВСЕГДА гамильтонов путь. Финальный фолбэк ⇒ покрывающий путь есть всегда. */
export function boustrophedonPath(size: number): Coord[] {
  const path: Coord[] = [];
  for (let r = 0; r < size; r++) {
    if (r % 2 === 0) {
      for (let c = 0; c < size; c++) path.push({ r, c });
    } else {
      for (let c = size - 1; c >= 0; c--) path.push({ r, c });
    }
  }
  return path;
}

/**
 * Режет путь на ≤ k смежных сегментов, каждый длиной ≥ minSeg (анти-тривиальность). Фактический
 * m = min(k, ⌊L / minSeg⌋) (если k·minSeg > L). Объединение сегментов = весь путь ⇒ покрытие.
 * Возвращает m сегментов; caller читает реальный .length.
 */
export function cutIntoSegments(path: Coord[], k: number, rng: Rng, minSeg: number): Coord[][] {
  const L = path.length;
  if (L < minSeg) return [path.slice()];
  const m = Math.max(1, Math.min(k, Math.floor(L / minSeg)));

  // База minSeg на сегмент, остаток раздаём по одной клетке случайным сегментам.
  const sizes = new Array<number>(m).fill(minSeg);
  let remaining = L - m * minSeg;
  while (remaining > 0) {
    sizes[Math.floor(rng() * m)]++;
    remaining--;
  }

  const segments: Coord[][] = [];
  let pos = 0;
  for (let i = 0; i < m; i++) {
    segments.push(path.slice(pos, pos + sizes[i]));
    pos += sizes[i];
  }
  return segments;
}

/**
 * Построить уровень КОНСТРУКЦИЕЙ: гамильтонов путь (или змейка) → cutIntoSegments → концы сегментов
 * = пары. isValidFlowSolution на результате ОБЯЗАН быть true (инвариант построения). Никогда не кидает.
 */
function buildLevel(level: number, seed: number, size: number, k: number): FlowLevel {
  const rng = mulberry32(seed >>> 0);
  const path = randomHamiltonian(size, rng) ?? boustrophedonPath(size);
  const segments = cutIntoSegments(path, k, rng, MIN_SEGMENT);

  const colorOff = flowBandForLevel(level).colorOff ?? false;
  const pairs: FlowPair[] = segments.map((seg, i) => {
    const fig = FIGURES[i % FIGURES.length];
    return {
      figure: fig.figure,
      color: colorOff ? NEUTRAL_COLOR : fig.color,
      a: { ...seg[0] },
      b: { ...seg[seg.length - 1] },
    };
  });
  const solution = segments.map(seg => seg.map(cell => ({ ...cell })));

  return { level, seed: seed >>> 0, size, pairs, solution };
}

// ============================================================================
// §4. Солвер-witness — ТОЛЬКО качество (НЕ проходимость).
//
// Модель «расширения голов»: каждый цвет растёт от конца a к концу b. На каждом шаге расширяем
// голову САМОГО МАЛОГО активного цвета в пустого соседа (или коннект к b, если смежно). Канонический
// порядок (детерминирован состоянием) ⇒ каждое решение считается РОВНО раз. Прунинг (обязателен):
//  (P1) у каждой пустой клетки ≥ 2 «заполнимых» соседа (пусто/активная-голова/активный-конец);
//  (P2) каждый активный цвет: конец b достижим от головы через пустые клетки (BFS);
//  (P3) каждая пустая клетка достижима от какой-то активной головы (нет изолированных карманов).
// SOLVE_NODE_CAP → сентинел «не определено».
// ============================================================================

/**
 * Считает решения загадки (size, pairs) до `limit` штук. Возвращает:
 *  • точное число решений (0..limit), если поиск завершён в пределах nodeCap;
 *  • SOLVE_CAP_EXCEEDED, если узлов больше nodeCap и решений найдено < limit (не определено).
 * Чистая функция, НЕ кидает, НЕ виснет (жёсткий nodeCap).
 */
export function countFlowSolutions(
  size: number,
  pairs: FlowPair[],
  limit: number,
  nodeCap: number,
): number {
  // Контракт «НЕ кидает / НЕ виснет» честен и для ПУБЛИЧНЫХ вызовов (Фаза 2 может звать из UI): жёсткие
  // гарды на мусор ДО разыменования pairs.length и до цикла (адверс-ревью wv0chjf3r, LOW-робастность).
  if (!Number.isInteger(size) || size <= 0 || !Array.isArray(pairs)) return 0;
  if (!Number.isInteger(limit) || limit <= 0) return 0;
  const N = size * size;
  const K = pairs.length;
  if (K === 0) return 0;
  // Не-конечный nodeCap (Infinity/NaN) не должен снимать предохранитель зависания.
  const cap = Number.isFinite(nodeCap) ? nodeCap : 0;

  const EMPTY = -1;
  const color = new Int32Array(N).fill(EMPTY);
  const ai = new Int32Array(K);
  const bi = new Int32Array(K);

  // Инициализация концов; защита от мусора/коллизий (пары построены дизъюнктными, но countFlowSolutions
  // публична → валидируем): вне поля / a===b / наложение концов ⇒ нет решений.
  for (let i = 0; i < K; i++) {
    const p = pairs[i];
    // Защита от мусора ДО разыменования (countFlowSolutions публична, контракт «НЕ кидает»):
    // отсутствующие/нечисловые/NaN/дробные концы ⇒ нет решений (зеркало гарда isValidFlowSolution).
    if (
      !p || !p.a || !p.b ||
      !Number.isInteger(p.a.r) || !Number.isInteger(p.a.c) ||
      !Number.isInteger(p.b.r) || !Number.isInteger(p.b.c)
    ) {
      return 0;
    }
    const a = p.a.r * size + p.a.c;
    const b = p.b.r * size + p.b.c;
    if (a < 0 || a >= N || b < 0 || b >= N || a === b) return 0;
    if (color[a] !== EMPTY || color[b] !== EMPTY) return 0; // наложение концов
    color[a] = i;
    color[b] = i;
    ai[i] = a;
    bi[i] = b;
  }

  const head = Int32Array.from(ai);
  const done = new Uint8Array(K);
  let emptyCount = N - 2 * K;
  let nodes = 0;
  let solutions = 0;
  let capped = false;

  // Соседи предвычислены (горячий путь).
  const nbr: number[][] = Array.from({ length: N }, (_, cell) => neighborsOf(cell, size));

  const pickColor = (): number => {
    for (let i = 0; i < K; i++) if (!done[i]) return i;
    return -1;
  };

  const pruneOk = (): boolean => {
    // Множества активных голов/концов (для «заполнимости» пустых клеток).
    const headSet = new Set<number>();
    const goalSet = new Set<number>();
    for (let i = 0; i < K; i++) {
      if (done[i]) continue;
      headSet.add(head[i]);
      goalSet.add(bi[i]);
    }

    // P1: каждая пустая клетка имеет ≥ 2 заполнимых соседа (иначе её не вшить в путь — она интерьер).
    for (let cell = 0; cell < N; cell++) {
      if (color[cell] !== EMPTY) continue;
      let deg = 0;
      for (const n of nbr[cell]) {
        if (color[n] === EMPTY || headSet.has(n) || goalSet.has(n)) {
          if (++deg >= 2) break;
        }
      }
      if (deg < 2) return false;
    }

    // P3: затопление пустых клеток от всех активных голов — ни одна пустая не должна остаться изолированной.
    const reach = new Uint8Array(N);
    const queue: number[] = [];
    for (let i = 0; i < K; i++) {
      if (done[i]) continue;
      for (const n of nbr[head[i]]) {
        if (color[n] === EMPTY && !reach[n]) {
          reach[n] = 1;
          queue.push(n);
        }
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      for (const n of nbr[queue[qi]]) {
        if (color[n] === EMPTY && !reach[n]) {
          reach[n] = 1;
          queue.push(n);
        }
      }
    }
    for (let cell = 0; cell < N; cell++) {
      if (color[cell] === EMPTY && !reach[cell]) return false;
    }

    // P2: каждый активный цвет должен мочь дотянуться от головы до своего конца через пустые клетки.
    for (let i = 0; i < K; i++) {
      if (done[i]) continue;
      const goal = bi[i];
      let connectable = false;
      const seen = new Uint8Array(N);
      const q: number[] = [head[i]];
      seen[head[i]] = 1;
      while (q.length && !connectable) {
        const cur = q.pop() as number;
        for (const n of nbr[cur]) {
          if (n === goal) { connectable = true; break; }
          if (color[n] === EMPTY && !seen[n]) {
            seen[n] = 1;
            q.push(n);
          }
        }
      }
      if (!connectable) return false;
    }

    return true;
  };

  const dfs = (): void => {
    if (solutions >= limit || capped) return;
    if (nodes++ > cap) {
      capped = true;
      return;
    }

    const i = pickColor();
    if (i === -1) {
      if (emptyCount === 0) solutions++; // все пары соединены И поле заполнено
      return;
    }

    if (!pruneOk()) return;

    // Ходы головы i: коннект к b (если смежно) + рост в пустых соседей. Порядок — ближе к цели
    // сперва (быстрее находит решение для limit=1; на счёт не влияет).
    const h = head[i];
    const goal = bi[i];
    const gr = Math.floor(goal / size);
    const gc = goal % size;
    interface Move { cell: number; connect: boolean; dist: number; }
    const moves: Move[] = [];
    for (const n of nbr[h]) {
      if (n === goal) {
        moves.push({ cell: n, connect: true, dist: -1 });
      } else if (color[n] === EMPTY) {
        const nr = Math.floor(n / size);
        const nc = n % size;
        moves.push({ cell: n, connect: false, dist: Math.abs(nr - gr) + Math.abs(nc - gc) });
      }
    }
    moves.sort((x, y) => x.dist - y.dist);

    for (const mv of moves) {
      if (solutions >= limit || capped) return;
      if (mv.connect) {
        done[i] = 1;
        dfs();
        done[i] = 0;
      } else {
        color[mv.cell] = i;
        head[i] = mv.cell;
        emptyCount--;
        dfs();
        emptyCount++;
        head[i] = h;
        color[mv.cell] = EMPTY;
      }
    }
  };

  dfs();

  if (solutions >= limit) return solutions; // достигнут lower-bound — определённо ≥ limit
  if (capped) return SOLVE_CAP_EXCEEDED; // поиск не завершён — не определено
  return solutions; // поиск завершён — точное число (< limit)
}

// ============================================================================
// §4-§5. Качество-гейт + generateLevel (total-функция).
// ============================================================================

/** Любая пара тривиальна (сегмент ≤ 2 клеток = прямой коннект соседних концов). С MIN_SEGMENT=3 — нет. */
function hasTrivialPair(solution: Coord[][]): boolean {
  return solution.some(seg => seg.length <= 2);
}

/** Доля «поворотов» среди интерьерных клеток всех сегментов (винтистость). Прямая трасса → 0. */
function bendRatio(solution: Coord[][]): number {
  let bends = 0;
  let interior = 0;
  for (const seg of solution) {
    for (let i = 1; i < seg.length - 1; i++) {
      interior++;
      const dr1 = seg[i].r - seg[i - 1].r;
      const dc1 = seg[i].c - seg[i - 1].c;
      const dr2 = seg[i + 1].r - seg[i].r;
      const dc2 = seg[i + 1].c - seg[i].c;
      if (dr1 !== dr2 || dc1 !== dc2) bends++;
    }
  }
  return interior === 0 ? 0 : bends / interior;
}

/**
 * Гейт качества (НЕ проходимости — она из конструкции). Структурный для всех: нет тривиальных пар +
 * доля изгибов ≥ порога бэнда. Плюс уникальность ТОЛЬКО для малых полей (size ≤ UNIQUENESS_MAX_SIZE,
 * брифа §8 — на больших дорого): провально-неуникальные (≥2 решения) отбраковываем; уникальные и
 * «не определено за nodeCap» — принимаем (структура уже ок). Якоря (проходим/много/сложнее) целы.
 */
function passesQualityGate(lvl: FlowLevel, band: FlowBand): boolean {
  if (hasTrivialPair(lvl.solution)) return false;
  if (bendRatio(lvl.solution) < band.minBendRatio) return false;

  if (lvl.size <= UNIQUENESS_MAX_SIZE) {
    const n = countFlowSolutions(lvl.size, lvl.pairs, 2, GEN_UNIQ_NODE_CAP);
    if (n === SOLVE_CAP_EXCEEDED) return true; // не определено — принимаем (структура ок)
    if (n >= 2) return false; // провально неуникален
    if (n <= 0) return false; // солвер не нашёл решения — защитно отбраковываем (не должно случаться)
    // n === 1 → уникален
  }
  return true;
}

/**
 * Сгенерировать уровень (level, seed). ВСЕГДА возвращает ПРОХОДИМЫЙ уровень (isValidFlowSolution===true):
 * конструкция (гамильтон → разрезы → пары) → гейт качества → PARACHUTE (построенный проходим).
 * НИКОГДА не кидает. Детерминирован: тот же (level, seed) → идентичный FlowLevel.
 */
export function generateLevel(level: number, seed: number): FlowLevel {
  const band = flowBandForLevel(level);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const aSeed = (seed + attempt * 0x9e3779b1) >>> 0;
    const pickRng = mulberry32((aSeed ^ GEN_SALT) >>> 0);
    const k = randInt(pickRng, band.pairsMin, band.pairsMax);
    const lvl = buildLevel(level, aSeed, band.size, k);
    if (passesQualityGate(lvl, band)) return lvl;
  }

  // PARACHUTE: качество не добралось — отдаём построенный (он ПРОХОДИМ, isValidFlowSolution===true).
  // Минимальный K (длиннее сегменты ⇒ винтистее, без гейта). Конструкция гарантирует валидность.
  return buildLevel(level, (seed ^ PARACHUTE_SALT) >>> 0, band.size, Math.max(band.pairsMin, 2));
}

// ============================================================================
// Резюм-хелперы (зеркало Блоков). Фаза 1 — чистые, без персиста.
// ============================================================================

function clonePair(p: FlowPair): FlowPair {
  return { figure: p.figure, color: p.color, a: { ...p.a }, b: { ...p.b } };
}

/** Свежий старт уровня: pairs из уровня (ЯВНО), пустой прогресс, обнулённый счёт. */
export function flowStateFromLevel(lvl: FlowLevel): FlowLevelState {
  return {
    level: lvl.level,
    seed: lvl.seed,
    size: lvl.size,
    pairs: lvl.pairs.map(clonePair),
    paths: [],
    game: { score: 0, moves: 0 },
  };
}

function normalizeFlowGame(raw: unknown): FlowCurrentGame {
  if (!raw || typeof raw !== 'object') return { score: 0, moves: 0 };
  const g = raw as Partial<FlowCurrentGame>;
  return {
    score: typeof g.score === 'number' && g.score >= 0 ? Math.floor(g.score) : 0,
    moves: typeof g.moves === 'number' && g.moves >= 0 ? Math.floor(g.moves) : 0,
  };
}

function validCoordInBounds(raw: unknown, size: number): raw is Coord {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as Partial<Coord>;
  if (typeof c.r !== 'number' || typeof c.c !== 'number') return false;
  if (!Number.isInteger(c.r) || !Number.isInteger(c.c)) return false;
  return c.r >= 0 && c.r < size && c.c >= 0 && c.c < size;
}

function isValidPairArray(raw: unknown, size: number): raw is FlowPair[] {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.every(p => {
    if (!p || typeof p !== 'object') return false;
    const pair = p as Partial<FlowPair>;
    if (typeof pair.figure !== 'string' || typeof pair.color !== 'string') return false;
    if (!validCoordInBounds(pair.a, size) || !validCoordInBounds(pair.b, size)) return false;
    return !sameCoord(pair.a, pair.b); // вырожденная пара (a===b) ⇒ слот битый
  });
}

function isValidPathArray(raw: unknown, size: number): raw is Coord[][] {
  if (!Array.isArray(raw)) return false;
  return raw.every(
    path => Array.isArray(path) && path.every(cell => validCoordInBounds(cell, size)),
  );
}

/**
 * Мягкое чтение снимка незаконченного уровня (зеркало normalizeBlocks): битое/частичное → null,
 * НИКОГДА не кидает. Валидирует size/pairs/paths/game; дробные level/seed округляет/коэрсит.
 */
export function normalizeFlow(raw: unknown): FlowLevelState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<FlowLevelState>;
  // Number.isFinite отсекает Infinity/NaN (иначе level=Infinity пережил бы guard `< 1` и просочился в
  // слот → узкий wrong-accept; адверс-ревью wv0chjf3r). Дробное finite — ок, ниже Math.floor (бриф §5).
  if (typeof r.level !== 'number' || !Number.isFinite(r.level) || r.level < 1) return null;
  if (typeof r.seed !== 'number') return null;
  if (typeof r.size !== 'number' || !Number.isInteger(r.size) || r.size < 1) return null;
  if (!isValidPairArray(r.pairs, r.size)) return null;
  if (!isValidPathArray(r.paths, r.size)) return null;

  return {
    level: Math.floor(r.level),
    seed: r.seed >>> 0,
    size: r.size,
    pairs: (r.pairs as FlowPair[]).map(clonePair),
    paths: (r.paths as Coord[][]).map(path => path.map(cell => ({ r: cell.r, c: cell.c }))),
    game: normalizeFlowGame(r.game),
  };
}

/**
 * Можно ли РЕЗЮМИТЬ сохранённый слот? ТОЛЬКО если его уровень — следующий непройденный
 * (level === flMaxLevel + 1). Иначе слот устарел (рассинхрон: глубина ушла вперёд) → игнор
 * (выученный прод-баг спайси «всегда предлагает L25»). НИКОГДА не кидает.
 */
export function isResumableFlowSlot(saved: FlowLevelState | null, flMaxLevel: number): boolean {
  return !!saved && saved.level === flMaxLevel + 1;
}

/** Проходимость как ПРЯМАЯ проверка (для тестов/инвариантов — нециркулярно с солвером). */
export function isLevelPassable(lvl: FlowLevel): boolean {
  return isValidFlowSolution(lvl.size, lvl.pairs, lvl.solution);
}
