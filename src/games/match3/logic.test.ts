import { describe, expect, it } from 'vitest';
import {
  activateInPlace,
  applyGravity,
  applySwap,
  cloneBoard,
  createBoard,
  findMatches,
  hasAnyMove,
  isValidSwap,
  mulberry32,
  refill,
  reshuffle,
  resolveCascades,
  resolveSwap,
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

describe('hasAnyMove / reshuffle', () => {
  it('мёртвое поле: ходов нет', () => {
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
