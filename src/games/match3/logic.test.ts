import { describe, expect, it } from 'vitest';
import {
  activateInPlace,
  applyGravity,
  applySwap,
  cloneBoard,
  createBoard,
  createRoomBoard,
  emptyObstacles,
  findAnyMove,
  findMatches,
  hasAnyMove,
  isAdjacent,
  isEmptyObstacles,
  isStatic,
  isSwappable,
  isValidSwap,
  mulberry32,
  normalizeObstacles,
  refill,
  reshuffle,
  resolveCascades,
  resolveSwap,
  settleColumn,
  SIZE,
  specialForShape,
  TYPE_COUNT,
  type Board,
  type Cell,
  type GemType,
  type Special,
} from './logic';

// ---- Хелперы построения поля для тестов ----

const A = 0;
const D = 3;
const E = 4;

/** Чистый «холст» без совпадений: тип = (r+c)%3 — соседи всегда разные. */
function canvas(): Board {
  const b: Board = [];
  for (let r = 0; r < SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < SIZE; c++) row.push({ type: (r + c) % 3 });
    b.push(row);
  }
  return b;
}

/** Поле БЕЗ ходов и совпадений: тип = (r+c)%TYPE_COUNT (одинаковые типы только за 6 клеток). */
function deadBoard(): Board {
  const b: Board = [];
  for (let r = 0; r < SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < SIZE; c++) row.push({ type: (r + c) % TYPE_COUNT });
    b.push(row);
  }
  return b;
}

function put(b: Board, r: number, c: number, type: GemType, special?: Special): void {
  b[r][c] = special ? { type, special } : { type };
}

function countGems(b: Board): number {
  return b.flat().filter(Boolean).length;
}

describe('mulberry32 (детерминизм rng)', () => {
  it('один seed → одинаковая последовательность', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('createBoard', () => {
  it('стартовое поле без совпадений и с валидным ходом', () => {
    const board = createBoard(mulberry32(1));
    expect(findMatches(board)).toHaveLength(0);
    expect(hasAnyMove(board)).toBe(true);
    expect(countGems(board)).toBe(SIZE * SIZE);
  });

  it('детерминирован по seed', () => {
    expect(createBoard(mulberry32(7))).toEqual(createBoard(mulberry32(7)));
  });
});

describe('findMatches — распознавание формы', () => {
  it('нет совпадений на чистом холсте', () => {
    expect(findMatches(canvas())).toHaveLength(0);
  });

  it('горизонтальная тройка → three', () => {
    const b = canvas();
    put(b, 0, 0, D);
    put(b, 0, 1, D);
    put(b, 0, 2, D);
    const m = findMatches(b);
    expect(m).toHaveLength(1);
    expect(m[0].shape).toBe('three');
    expect(m[0].cells).toHaveLength(3);
    expect(m[0].type).toBe(D);
  });

  it('линия из 4 → line4', () => {
    const b = canvas();
    for (let c = 0; c < 4; c++) put(b, 0, c, D);
    const m = findMatches(b);
    expect(m).toHaveLength(1);
    expect(m[0].shape).toBe('line4');
  });

  it('линия из 5 → line5', () => {
    const b = canvas();
    for (let c = 0; c < 5; c++) put(b, 0, c, D);
    const m = findMatches(b);
    expect(m[0].shape).toBe('line5');
  });

  it('форма L (угол) → LT', () => {
    const b = canvas();
    // горизонталь (2,1)(2,2)(2,3) + вертикаль (2,1)(3,1)(4,1), общий угол (2,1)
    put(b, 2, 1, D);
    put(b, 2, 2, D);
    put(b, 2, 3, D);
    put(b, 3, 1, D);
    put(b, 4, 1, D);
    const m = findMatches(b);
    expect(m).toHaveLength(1);
    expect(m[0].shape).toBe('LT');
    expect(m[0].cells).toHaveLength(5);
  });

  it('форма T (плюс) → LT', () => {
    const b = canvas();
    put(b, 2, 1, D);
    put(b, 2, 2, D);
    put(b, 2, 3, D);
    put(b, 1, 2, D);
    put(b, 3, 2, D);
    const m = findMatches(b);
    expect(m[0].shape).toBe('LT');
  });

  it('сплошной блок 2×3 — НЕ прямая линия → LT (бомба), а не line5', () => {
    const b = canvas();
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) put(b, r, c, D);
    const m = findMatches(b);
    expect(m).toHaveLength(1);
    expect(m[0].shape).toBe('LT'); // 6 клеток, но не прямая → бомба, не цветобомба
  });

  it('стык двух троек уголком (6 клеток, не прямая) → LT, а не line5', () => {
    const b = canvas();
    // горизонталь (2,0..2) + горизонталь (3,2..4), соединены в (2,2)-(3,2)
    put(b, 2, 0, D);
    put(b, 2, 1, D);
    put(b, 2, 2, D);
    put(b, 3, 2, D);
    put(b, 3, 3, D);
    put(b, 3, 4, D);
    const m = findMatches(b);
    expect(m).toHaveLength(1);
    expect(m[0].shape).toBe('LT');
  });

  it('настоящая прямая линия из 5 в столбце → line5', () => {
    const b = canvas();
    for (let r = 0; r < 5; r++) put(b, r, 0, D);
    expect(findMatches(b)[0].shape).toBe('line5');
  });

  it('два независимых совпадения разных типов', () => {
    const b = canvas();
    put(b, 0, 0, D);
    put(b, 0, 1, D);
    put(b, 0, 2, D);
    put(b, 5, 0, E);
    put(b, 6, 0, E);
    put(b, 7, 0, E);
    expect(findMatches(b)).toHaveLength(2);
  });
});

describe('specialForShape', () => {
  it('маппинг формы на спецфишку', () => {
    expect(specialForShape('three')).toBeUndefined();
    expect(specialForShape('line4')).toBe('line');
    expect(specialForShape('line5')).toBe('colorBomb');
    expect(specialForShape('LT')).toBe('bomb');
  });
});

describe('applyGravity / refill', () => {
  it('гравитация осаживает фишки вниз, верх пустеет', () => {
    const b = canvas();
    b[7][0] = null;
    b[6][0] = null;
    const g = applyGravity(b);
    expect(g[0][0]).toBeNull(); // верх столбца опустел
    expect(g[7][0]).not.toBeNull(); // низ занят
    // в столбце осталось 6 фишек
    expect(g.map((row) => row[0]).filter(Boolean)).toHaveLength(6);
  });

  it('refill заполняет все пустые клетки', () => {
    const b = canvas();
    b[0][0] = null;
    b[1][1] = null;
    const f = refill(b, mulberry32(3));
    expect(countGems(f)).toBe(SIZE * SIZE);
  });
});

describe('resolveSwap — создание спецфишек', () => {
  it('обычный своп в линию из 4 → создаётся line', () => {
    const b = canvas();
    put(b, 0, 0, D);
    put(b, 0, 1, D);
    put(b, 0, 3, D);
    put(b, 1, 2, D); // свопнём её вверх в (0,2)
    const res = resolveSwap(b, { r: 0, c: 2 }, { r: 1, c: 2 }, mulberry32(1));
    const created = res.steps[0].created;
    expect(created.some((x) => x.special === 'line' && x.type === D)).toBe(true);
  });

  it('обычный своп в линию из 5 → создаётся colorBomb', () => {
    const b = canvas();
    put(b, 0, 0, D);
    put(b, 0, 1, D);
    put(b, 0, 3, D);
    put(b, 0, 4, D);
    put(b, 1, 2, D);
    const res = resolveSwap(b, { r: 0, c: 2 }, { r: 1, c: 2 }, mulberry32(1));
    expect(res.steps[0].created.some((x) => x.special === 'colorBomb')).toBe(true);
  });

  it('обычный своп в форму T → создаётся bomb', () => {
    const b = canvas();
    put(b, 2, 1, D);
    put(b, 2, 3, D);
    put(b, 0, 2, D);
    put(b, 1, 2, D);
    put(b, 3, 2, D); // свопнём её в (2,2) — центр плюса
    const res = resolveSwap(b, { r: 2, c: 2 }, { r: 3, c: 2 }, mulberry32(1));
    const created = res.steps[0].created;
    expect(created.some((x) => x.special === 'bomb')).toBe(true);
    expect(created[0]).toMatchObject({ r: 2, c: 2 });
  });
});

describe('resolveSwap — активация одиночных спецфишек', () => {
  it('line: своп сносит весь ряд И столбец (15 клеток)', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    const res = resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(15); // 8 + 8 - 1
    expect(res.steps[0].detonated.some((d) => d.special === 'line')).toBe(true);
  });

  it('bomb: своп сносит область 3×3 (9 клеток в центре)', () => {
    const b = canvas();
    put(b, 4, 4, D, 'bomb');
    const res = resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(9);
  });

  it('colorBomb: своп с обычной убирает ВСЕ фишки её типа', () => {
    const b = canvas();
    put(b, 4, 4, D, 'colorBomb'); // тип цветобомбы — D
    const targetType = b[4][5]!.type; // обычный сосед — его тип станет целью
    // После свопа цветобомба оказывается в (4,5); чистятся все клетки целевого типа + сама бомба.
    const swapped = applySwap(b, { r: 4, c: 4 }, { r: 4, c: 5 });
    const cleared = new Set<number>();
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (swapped[r][c]!.type === targetType) cleared.add(r * SIZE + c);
    cleared.add(4 * SIZE + 5); // позиция самой цветобомбы
    const res = resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(cleared.size);
    expect(res.steps[0].detonated.some((d) => d.special === 'colorBomb')).toBe(true);
  });
});

describe('цепная активация спецов', () => {
  it('бомба в совпадении детонирует, её взрыв цепляет вторую бомбу', () => {
    const b = canvas();
    put(b, 0, 0, D, 'bomb'); // в горизонтальной тройке
    put(b, 0, 1, D);
    put(b, 0, 2, D);
    put(b, 1, 1, D, 'bomb'); // попадает в 3×3 первой бомбы → цепь
    const res = resolveCascades(b, mulberry32(1));
    const bombs = res.steps[0].detonated.filter((d) => d.special === 'bomb');
    expect(bombs).toHaveLength(2);
    expect(res.steps[0].clearedCount).toBe(9); // rows0-2 × cols0-2
  });
});

describe('базовые комбо двух спецфишек', () => {
  it('colorBomb + colorBomb → всё поле', () => {
    const b = canvas();
    put(b, 4, 4, A, 'colorBomb');
    put(b, 4, 5, A, 'colorBomb');
    const res = resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(SIZE * SIZE);
  });

  it('bomb + bomb → 5×5', () => {
    const b = canvas();
    put(b, 4, 4, A, 'bomb');
    put(b, 4, 5, A, 'bomb');
    const res = resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(25); // 5×5 вокруг (4,5)
  });

  it('line + line → крест (2 ряда + 2 столбца)', () => {
    const b = canvas();
    // тип E не встречается на холсте → своп не порождает побочного совпадения
    put(b, 4, 3, E, 'line');
    put(b, 4, 4, E, 'line');
    const res = resolveSwap(b, { r: 4, c: 3 }, { r: 4, c: 4 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(22); // row4 + col3 + col4
  });
});

describe('полный набор комбо двух спецфишек (Match-3 v2)', () => {
  it('line + bomb → «толстый крест» (3 ряда + 3 столбца = 39 клеток)', () => {
    const b = canvas();
    // тип E=4 не на холсте → своп не даёт побочного совпадения; центр креста — на ЛИНИИ.
    put(b, 4, 4, E, 'line');
    put(b, 4, 5, E, 'bomb');
    const res = resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    // После свопа линия в (4,5): ряды 3-5 (×8) + столбцы 4-6 (×8) − пересечение 3×3 = 39.
    expect(res.steps[0].clearedCount).toBe(39);
    expect(res.steps[0].detonated.some((d) => d.special === 'line')).toBe(true);
    expect(res.steps[0].detonated.some((d) => d.special === 'bomb')).toBe(true);
  });

  it('colorBomb + line → весь тип партнёра «становится» линиями и детонирует (ряды+столбцы)', () => {
    const b = canvas();
    put(b, 1, 1, 5, 'colorBomb'); // тип цветобомбы (5) не важен — берёт цвет партнёра
    put(b, 1, 2, E, 'line'); // партнёр — линия типа E=4
    put(b, 6, 6, E); // ещё одна фишка типа E (изолирована — без готового совпадения)
    const res = resolveSwap(b, { r: 1, c: 1 }, { r: 1, c: 2 }, mulberry32(1));
    // После свопа: линия типа 4 в (1,1), цветобомба в (1,2); фишки типа 4 — (1,1) и (6,6).
    // Очистка = (ряд1∪столбец1) ∪ (ряд6∪столбец6) ∪ цветобомба(1,2) = 28 клеток.
    expect(res.steps[0].clearedCount).toBe(28);
    expect(res.steps[0].detonated.some((d) => d.special === 'colorBomb')).toBe(true);
    expect(res.steps[0].detonated.some((d) => d.special === 'line')).toBe(true);
    // дальние от обеих «линий» клетки на этом шаге целы:
    expect(res.steps[0].cleared.some((c) => c.r === 0 && c.c === 0)).toBe(false);
    expect(res.steps[0].cleared.some((c) => c.r === 7 && c.c === 7)).toBe(false);
  });

  it('colorBomb + bomb → весь тип партнёра «становится» бомбами и детонирует (3×3 у каждой)', () => {
    const b = canvas();
    put(b, 1, 1, 5, 'colorBomb');
    put(b, 1, 2, E, 'bomb'); // партнёр — бомба типа E=4
    put(b, 5, 5, E); // ещё одна фишка типа E (изолирована)
    const res = resolveSwap(b, { r: 1, c: 1 }, { r: 1, c: 2 }, mulberry32(1));
    // После свопа: бомба типа 4 в (1,1), цветобомба в (1,2); фишки типа 4 — (1,1) и (5,5).
    // 3×3 вокруг (1,1) = ряды0-2×столбцы0-2 (9) + 3×3 вокруг (5,5) = ряды4-6×столбцы4-6 (9) = 18.
    expect(res.steps[0].clearedCount).toBe(18);
    expect(res.steps[0].detonated.some((d) => d.special === 'colorBomb')).toBe(true);
    expect(res.steps[0].detonated.some((d) => d.special === 'bomb')).toBe(true);
  });

  it('существующие базовые комбо целы: cb+cb=64, bomb+bomb=25, line+line=22', () => {
    const cb = canvas();
    put(cb, 4, 4, A, 'colorBomb');
    put(cb, 4, 5, A, 'colorBomb');
    expect(resolveSwap(cb, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1)).steps[0].clearedCount).toBe(SIZE * SIZE);

    const bb = canvas();
    put(bb, 4, 4, A, 'bomb');
    put(bb, 4, 5, A, 'bomb');
    expect(resolveSwap(bb, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1)).steps[0].clearedCount).toBe(25);

    const ll = canvas();
    put(ll, 4, 3, E, 'line');
    put(ll, 4, 4, E, 'line');
    expect(resolveSwap(ll, { r: 4, c: 3 }, { r: 4, c: 4 }, mulberry32(1)).steps[0].clearedCount).toBe(22);
  });
});

describe('activateInPlace — тап-детонация спеца (без свопа)', () => {
  it('line: тап сносит весь ряд И столбец (15 клеток), поле не свопалось', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    const res = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(15); // 8 + 8 - 1
    expect(res.steps[0].detonated.some((d) => d.special === 'line')).toBe(true);
  });

  it('bomb: тап сносит область 3×3 (9 клеток)', () => {
    const b = canvas();
    put(b, 4, 4, D, 'bomb');
    const res = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(9);
    expect(res.steps[0].detonated.some((d) => d.special === 'bomb')).toBe(true);
  });

  it('colorBomb без партнёра: тап убирает все фишки СВОЕГО типа + саму бомбу', () => {
    // Холст (r+c)%3: тип 0 в (4,4); считаем все клетки типа 0 (включая саму бомбу).
    const b = canvas();
    const cbType = b[4][4]!.type; // (4+4)%3 = 2 на самом деле; берём фактический тип клетки
    put(b, 4, 4, cbType, 'colorBomb');
    let sameType = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (b[r][c]!.type === cbType) sameType++;
    const res = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(sameType);
    expect(res.steps[0].detonated.some((d) => d.special === 'colorBomb')).toBe(true);
  });

  it('детонация цепляет соседний спец (line на месте задевает bomb в ряду)', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    put(b, 4, 1, D, 'bomb'); // в том же ряду 4 → попадёт в очистку line → детонирует
    const res = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1));
    expect(res.steps[0].detonated.some((d) => d.special === 'line')).toBe(true);
    expect(res.steps[0].detonated.some((d) => d.special === 'bomb')).toBe(true);
  });

  it('клетка без спеца → пустой результат (no-op)', () => {
    const res = activateInPlace(canvas(), { r: 0, c: 0 }, mulberry32(1));
    expect(res.steps).toHaveLength(0);
    expect(res.gemsCleared).toBe(0);
  });

  it('не мутирует исходное поле', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    const snapshot = cloneBoard(b);
    activateInPlace(b, { r: 4, c: 4 }, mulberry32(1));
    expect(b).toEqual(snapshot);
  });
});

describe('resolveCascades — каскад и счёт', () => {
  it('счёт первого шага = 10 × число фишек × уровень (изолированная тройка → 30)', () => {
    const b = canvas();
    put(b, 0, 0, D);
    put(b, 0, 1, D);
    put(b, 0, 2, D);
    const res = resolveCascades(b, mulberry32(1));
    expect(res.steps[0].clearedCount).toBe(3);
    expect(res.steps[0].scoreGained).toBe(30);
    expect(res.maxCascade).toBeGreaterThanOrEqual(1);
  });

  it('падение порождает новое совпадение → каскад ≥ 2', () => {
    const b = canvas();
    // вертикальная тройка D в столбце 0 (rows5-7); над ней E, которая упадёт в (7,0)
    put(b, 5, 0, D);
    put(b, 6, 0, D);
    put(b, 7, 0, D);
    put(b, 4, 0, E);
    put(b, 7, 1, E);
    put(b, 7, 2, E); // после падения row7 = E E E
    const res = resolveCascades(b, mulberry32(1));
    expect(res.maxCascade).toBeGreaterThanOrEqual(2);
  });

  it('взрыв спеца засчитывает все убранные клетки (биг-клир)', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    const res = resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    expect(res.biggestClear).toBeGreaterThanOrEqual(15);
  });

  it('поле без совпадений и без зажигания → пустой результат', () => {
    const res = resolveCascades(canvas(), mulberry32(1));
    expect(res.steps).toHaveLength(0);
    expect(res.gemsCleared).toBe(0);
    expect(res.maxCascade).toBe(0);
  });
});

describe('isValidSwap', () => {
  it('обычный своп, дающий тройку → валиден', () => {
    const b = canvas();
    put(b, 0, 1, D);
    put(b, 0, 2, D);
    put(b, 1, 0, D); // свопнём (0,0)<->(1,0): (0,0) станет D → D D D
    expect(isValidSwap(b, { r: 0, c: 0 }, { r: 1, c: 0 })).toBe(true);
  });

  it('обычный своп без тройки → НЕ валиден', () => {
    expect(isValidSwap(canvas(), { r: 0, c: 0 }, { r: 0, c: 1 })).toBe(false);
  });

  it('своп со спецфишкой валиден даже без тройки', () => {
    const b = canvas();
    put(b, 0, 0, D, 'line');
    expect(isValidSwap(b, { r: 0, c: 0 }, { r: 0, c: 1 })).toBe(true);
  });

  it('не-соседние клетки → НЕ валиден', () => {
    const b = canvas();
    put(b, 0, 0, D, 'line');
    expect(isValidSwap(b, { r: 0, c: 0 }, { r: 0, c: 2 })).toBe(false);
  });
});

describe('hasAnyMove / findAnyMove / reshuffle', () => {
  it('мёртвое поле: ходов нет', () => {
    expect(hasAnyMove(deadBoard())).toBe(false);
  });

  it('findAnyMove: на живом поле — валидная соседняя пара (для подсказки UI)', () => {
    const b = createBoard(mulberry32(1));
    const move = findAnyMove(b);
    expect(move).not.toBeNull();
    const [p, q] = move!;
    expect(isAdjacent(p, q)).toBe(true);
    expect(isValidSwap(b, p, q)).toBe(true);
  });

  it('findAnyMove: на мёртвом поле — null (согласован с hasAnyMove)', () => {
    expect(findAnyMove(deadBoard())).toBeNull();
    expect(hasAnyMove(deadBoard())).toBe(false);
  });

  it('после reshuffle есть валидный ход и нет готовых совпадений', () => {
    const re = reshuffle(deadBoard(), mulberry32(9));
    expect(findMatches(re)).toHaveLength(0);
    expect(hasAnyMove(re)).toBe(true);
    expect(countGems(re)).toBe(SIZE * SIZE);
  });

  it('reshuffle сохраняет мультимножество фишек', () => {
    const src = deadBoard();
    const re = reshuffle(src, mulberry32(2));
    const count = (b: Board) => {
      const m = new Map<number, number>();
      for (const cell of b.flat()) if (cell) m.set(cell.type, (m.get(cell.type) ?? 0) + 1);
      return m;
    };
    expect(count(re)).toEqual(count(src));
  });
});

describe('чистота функций', () => {
  it('resolveSwap не мутирует исходное поле', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    const snapshot = cloneBoard(b);
    resolveSwap(b, { r: 4, c: 4 }, { r: 4, c: 5 }, mulberry32(1));
    expect(b).toEqual(snapshot);
  });
});

// ============================================================================
// ПРЕПЯТСТВИЯ (Match-3 «Комнаты», Фаза 1). Дефолт (нет ob) ⇒ всё выше — байт-в-байт прежнее.
// ============================================================================

describe('isStatic / isSwappable', () => {
  it('блок и лёд статичны; обычная/пустая клетка — нет', () => {
    const b = canvas();
    const ob = emptyObstacles();
    ob.blocks[1][1] = true;
    b[1][1] = null;
    ob.ice[2][2] = 1;
    expect(isStatic(1, 1, ob)).toBe(true); // блок
    expect(isStatic(2, 2, ob)).toBe(true); // лёд
    expect(isStatic(0, 0, ob)).toBe(false);
    expect(isSwappable(b, ob, 0, 0)).toBe(true);
    expect(isSwappable(b, ob, 1, 1)).toBe(false); // блок-клетка
    expect(isSwappable(b, ob, 2, 2)).toBe(false); // замороженная
  });

  it('дефолт emptyObstacles: static нигде, isEmptyObstacles=true', () => {
    const ob = emptyObstacles();
    expect(isEmptyObstacles(ob)).toBe(true);
    expect(isStatic(3, 3, ob)).toBe(false);
  });
});

describe('findMatches с препятствиями (static разрывает run)', () => {
  it('замороженная клетка разрывает тройку своего же типа', () => {
    const b = canvas();
    put(b, 0, 0, D);
    put(b, 0, 1, D);
    put(b, 0, 2, D);
    expect(findMatches(b)).toHaveLength(1); // без ob — тройка
    const ob = emptyObstacles();
    ob.ice[0][1] = 1; // заморозили середину
    expect(findMatches(b, ob)).toHaveLength(0); // лёд разорвал run — совпадения нет
  });

  it('блок делит ряд: тройка «через блок» не считается', () => {
    const b = canvas();
    put(b, 3, 2, D);
    put(b, 3, 4, D); // блок будет на (3,3) — между ними
    const ob = emptyObstacles();
    ob.blocks[3][3] = true;
    b[3][3] = null;
    expect(findMatches(b, ob)).toHaveLength(0);
  });
});

describe('settleColumn (общий итератор гравитации)', () => {
  it('без static: пустой верх → refillRows сверху, осевшее не двигается', () => {
    const { moves, refillRows } = settleColumn(
      () => false,
      (r) => r >= 2, // filled rows 2..7, пусто 0,1
    );
    expect(refillRows).toEqual([0, 1]);
    expect(moves).toEqual([]);
  });

  it('блок делит столбец: под-блочный сегмент НЕ рефиллится, фишки оседают в своём сегменте', () => {
    const { moves, refillRows } = settleColumn(
      (r) => r === 4, // блок на 4
      (r) => r !== 4 && r !== 7, // дыра под блоком (7), верхний сегмент полон
    );
    expect(refillRows).toEqual([]); // верхний сегмент полон, нижний (segTop>0) не рефиллится
    expect(moves).toContainEqual({ from: 6, to: 7 });
    expect(moves).toContainEqual({ from: 5, to: 6 });
  });
});

describe('сегментная гравитация / refill под блоком', () => {
  it('блок делит столбец: фишки над не проваливаются, под-блочная дыра остаётся null навсегда', () => {
    const b = canvas();
    const ob = emptyObstacles();
    ob.blocks[4][0] = true;
    b[4][0] = null;
    b[6][0] = null; // клир под блоком
    b[7][0] = null;
    const g = applyGravity(b, ob);
    expect(g[4][0]).toBeNull(); // блок на месте (не фишка)
    expect(g[7][0]).not.toBeNull(); // (5,0) осела на дно своего сегмента
    expect(g[5][0]).toBeNull();
    expect(g[0][0]).not.toBeNull(); // верхний сегмент не провалился сквозь блок
    const f = refill(g, mulberry32(1), ob);
    expect(f[5][0]).toBeNull(); // под блоком НЕ доливается
    expect(f[6][0]).toBeNull();
    expect(f[4][0]).toBeNull(); // блок цел
  });

  it('верхний открытый сегмент доливается, дыры над блоком закрываются', () => {
    const b = canvas();
    const ob = emptyObstacles();
    ob.blocks[4][0] = true;
    b[4][0] = null;
    b[0][0] = null; // дыры в верхнем сегменте
    b[1][0] = null;
    const f = refill(applyGravity(b, ob), mulberry32(1), ob);
    expect(f[0][0]).not.toBeNull();
    expect(f[1][0]).not.toBeNull();
    expect(f[4][0]).toBeNull(); // блок цел
  });

  it('дефолт (нет ob): applyGravity/refill идентичны базовому поведению', () => {
    const b = canvas();
    b[7][0] = null;
    b[6][0] = null;
    const g = applyGravity(b);
    expect(g[0][0]).toBeNull();
    expect(g.map((row) => row[0]).filter(Boolean)).toHaveLength(6);
    const f = refill(g, mulberry32(3));
    expect(f.flat().filter(Boolean)).toHaveLength(SIZE * SIZE);
  });
});

describe('спец НЕ пробивает обстакл', () => {
  it('line: блок в ряду НЕ зануляется и НЕ считается (clearedCount меньше на блок)', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    const noOb = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1));
    expect(noOb.steps[0].clearedCount).toBe(15); // 8+8-1

    const ob = emptyObstacles();
    ob.blocks[4][1] = true;
    b[4][1] = null; // блок в ряду линии
    const withOb = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1), ob);
    expect(withOb.steps[0].clearedCount).toBe(14); // блок не убран
    expect(withOb.obstacles.blocks[4][1]).toBe(true); // блок цел
    expect(withOb.steps[0].board[4][1]).toBeNull(); // блок-клетка — не фишка
  });

  it('замороженная фишка в зоне взрыва выживает (не ретайрится), но её иней скалывается', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    const ob = emptyObstacles();
    ob.ice[4][6] = 1; // лёд в ряду линии
    put(b, 4, 6, 5);
    const res = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1), ob);
    // (4,6) не убрана (clearedCount 14, а не 15), но соседи по ряду очищены → иней сколот
    expect(res.steps[0].clearedCount).toBe(14);
    expect(res.steps[0].board[4][6]).not.toBeNull(); // фишка под льдом цела
    expect(res.obstacles.ice[4][6]).toBe(0); // оттаяла
  });

  it('замороженный спец НЕ детонирует по цепочке (обстакл не пробивается)', () => {
    const b = canvas();
    put(b, 4, 4, D, 'line');
    put(b, 4, 1, D, 'bomb'); // в ряду линии, но заморожен
    const ob = emptyObstacles();
    ob.ice[4][1] = 1;
    const res = activateInPlace(b, { r: 4, c: 4 }, mulberry32(1), ob);
    expect(res.steps[0].detonated.some((d) => d.special === 'line')).toBe(true);
    expect(res.steps[0].detonated.some((d) => d.special === 'bomb')).toBe(false); // заморожен — не цепляется
  });
});

describe('скол льда — отдельный канал (лёд = 1 слой)', () => {
  it('клир у орто-соседа льда → ice-- (раз за шаг); фишка цела; clearedCount не растёт', () => {
    const b = canvas();
    const ob = emptyObstacles();
    ob.ice[3][4] = 1;
    put(b, 3, 4, 5); // фишка под льдом
    put(b, 3, 1, D); // тройка, чей край (3,3) — орто-сосед льда (3,4)
    put(b, 3, 2, D);
    put(b, 3, 3, D);
    const res = resolveCascades(b, mulberry32(1), { obstacles: ob });
    expect(res.steps[0].clearedCount).toBe(3); // лёд-фишку НЕ считаем
    expect(res.steps[0].iceHit).toEqual([{ r: 3, c: 4 }]);
    expect(res.iceCleared).toBe(1);
    expect(res.obstacles.ice[3][4]).toBe(0); // оттаял (1 слой)
    expect(res.steps[0].board[3][4]).not.toBeNull(); // фишка под льдом на поле
    expect(isStatic(3, 4, res.obstacles)).toBe(false); // оживает
  });

  it('лёд НЕ у соседа клира не скалывается', () => {
    const b = canvas();
    const ob = emptyObstacles();
    ob.ice[0][7] = 1;
    put(b, 0, 7, 5);
    put(b, 5, 0, D); // тройка далеко от льда
    put(b, 6, 0, D);
    put(b, 7, 0, D);
    const res = resolveCascades(b, mulberry32(1), { obstacles: ob });
    expect(res.iceCleared).toBe(0);
    expect(res.obstacles.ice[0][7]).toBe(1);
  });
});

describe('isValidSwap / findAnyMove / reshuffle с препятствиями', () => {
  it('isValidSwap: своп с/из static невалиден', () => {
    const b = canvas();
    put(b, 0, 1, D);
    put(b, 0, 2, D);
    put(b, 1, 0, D); // (0,0)<->(1,0) → D D D
    expect(isValidSwap(b, { r: 0, c: 0 }, { r: 1, c: 0 })).toBe(true);
    const ob = emptyObstacles();
    ob.ice[0][0] = 1; // заморозили исток
    expect(isValidSwap(b, { r: 0, c: 0 }, { r: 1, c: 0 }, ob)).toBe(false);
  });

  it('findAnyMove возвращает только подвижную (isSwappable) пару', () => {
    const { board, obstacles } = createRoomBoard({ blocks: [{ r: 4, c: 4 }], ice: [{ r: 2, c: 2 }] }, mulberry32(1));
    const move = findAnyMove(board, obstacles);
    expect(move).not.toBeNull();
    const [p, q] = move!;
    expect(isSwappable(board, obstacles, p.r, p.c)).toBe(true);
    expect(isSwappable(board, obstacles, q.r, q.c)).toBe(true);
  });

  it('reshuffle room-aware: обстаклы на местах, фишка не попадает в static, мультимножество цело', () => {
    const b = createBoard(mulberry32(3));
    const ob = emptyObstacles();
    ob.blocks[2][2] = true;
    b[2][2] = null;
    ob.ice[5][5] = 1;
    const frozen = b[5][5];
    const re = reshuffle(b, mulberry32(9), ob);
    expect(re[2][2]).toBeNull(); // блок-клетка осталась пустой
    expect(re[5][5]).toEqual(frozen); // замороженная фишка НЕ тасуется
    // ни одна фишка не попала в static-клетку (кроме сохранённой замороженной)
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (ob.blocks[r][c]) expect(re[r][c]).toBeNull();
    const movable = (board: Board): Map<number, number> => {
      const m = new Map<number, number>();
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) if (isSwappable(board, ob, r, c)) m.set(board[r][c]!.type, (m.get(board[r][c]!.type) ?? 0) + 1);
      return m;
    };
    expect(movable(re)).toEqual(movable(b));
    expect(hasAnyMove(re, ob)).toBe(true);
    expect(findMatches(re, ob)).toHaveLength(0);
    // reshuffle не мутировал переданные obstacles
    expect(ob.blocks[2][2]).toBe(true);
    expect(ob.ice[5][5]).toBe(1);
  });
});

describe('createRoomBoard', () => {
  const layout = { blocks: [{ r: 4, c: 3 }, { r: 4, c: 4 }], ice: [{ r: 2, c: 2 }, { r: 5, c: 5 }] };

  it('блок-клетки пусты, лёд-клетки с фишкой ice=1, без совпадений, есть ход', () => {
    const { board, obstacles } = createRoomBoard(layout, mulberry32(1));
    expect(obstacles.blocks[4][3]).toBe(true);
    expect(board[4][3]).toBeNull();
    expect(board[4][4]).toBeNull();
    expect(obstacles.ice[2][2]).toBe(1);
    expect(board[2][2]).not.toBeNull(); // под льдом — обычная фишка
    expect(board[5][5]).not.toBeNull();
    expect(findMatches(board, obstacles)).toHaveLength(0);
    expect(hasAnyMove(board, obstacles)).toBe(true);
    expect(board.flat().filter(Boolean)).toHaveLength(SIZE * SIZE - 2); // минус 2 блока
  });

  it('детерминирован по seed', () => {
    expect(createRoomBoard(layout, mulberry32(7))).toEqual(createRoomBoard(layout, mulberry32(7)));
  });
});

describe('normalizeObstacles (миграция — бережно к данным жены)', () => {
  it('нет данных → пустые слои нужного размера', () => {
    const ob = normalizeObstacles(undefined);
    expect(isEmptyObstacles(ob)).toBe(true);
    expect(ob.blocks).toHaveLength(SIZE);
    expect(ob.ice[0]).toHaveLength(SIZE);
  });

  it('битые/частичные данные → безопасный пустой дефолт (без краша)', () => {
    expect(isEmptyObstacles(normalizeObstacles(42))).toBe(true);
    expect(isEmptyObstacles(normalizeObstacles({ blocks: 'oops', ice: null }))).toBe(true);
    expect(isEmptyObstacles(normalizeObstacles({ ice: [[-1, 'x']] }))).toBe(true); // мусорные значения → 0
  });

  it('round-trip через JSON: blocks/ice сохраняются', () => {
    const ob = emptyObstacles();
    ob.blocks[4][3] = true;
    ob.ice[2][2] = 1;
    const back = normalizeObstacles(JSON.parse(JSON.stringify(ob)));
    expect(back.blocks[4][3]).toBe(true);
    expect(back.ice[2][2]).toBe(1);
    expect(isEmptyObstacles(back)).toBe(false);
  });
});
