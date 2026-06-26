import { describe, expect, it } from 'vitest';
import {
  adjacent,
  emptyFlowGrid,
  isSimplePath,
  isSolvedByPlayer,
  isValidFlowSolution,
  sameCoord,
  type Coord,
  type FlowPair,
} from './logic';

// ---- Хелперы ----

const C = (r: number, c: number): Coord => ({ r, c });
const pair = (a: Coord, b: Coord): FlowPair => ({ figure: 'heart', color: '#fff', a, b });

// Гамильтонов путь на 3×3 (змейка), разрезанный на 2 сегмента — валидное полное покрытие.
const SEG0 = [C(0, 0), C(0, 1), C(0, 2), C(1, 2)];
const SEG1 = [C(1, 1), C(1, 0), C(2, 0), C(2, 1), C(2, 2)];
const PAIRS_3 = [pair(C(0, 0), C(1, 2)), pair(C(1, 1), C(2, 2))];
const SOLUTION_3 = [SEG0, SEG1];

// ============================================================================

describe('emptyFlowGrid', () => {
  it('N×N, все null', () => {
    const g = emptyFlowGrid(5);
    expect(g.length).toBe(5);
    for (const row of g) {
      expect(row.length).toBe(5);
      for (const cell of row) expect(cell).toBeNull();
    }
  });
});

describe('sameCoord / adjacent', () => {
  it('sameCoord', () => {
    expect(sameCoord(C(1, 2), C(1, 2))).toBe(true);
    expect(sameCoord(C(1, 2), C(2, 1))).toBe(false);
  });

  it('adjacent: только ортогональные соседи', () => {
    expect(adjacent(C(0, 0), C(0, 1))).toBe(true);
    expect(adjacent(C(0, 0), C(1, 0))).toBe(true);
    expect(adjacent(C(0, 0), C(1, 1))).toBe(false); // диагональ
    expect(adjacent(C(0, 0), C(0, 2))).toBe(false); // через клетку
    expect(adjacent(C(0, 0), C(0, 0))).toBe(false); // та же клетка
  });
});

// ============================================================================

describe('isSimplePath', () => {
  it('валидный путь', () => {
    expect(isSimplePath([C(0, 0), C(0, 1), C(1, 1)])).toBe(true);
  });

  it('одна клетка — валиден', () => {
    expect(isSimplePath([C(2, 3)])).toBe(true);
  });

  it('пустой → false', () => {
    expect(isSimplePath([])).toBe(false);
  });

  it('разрыв (несоседние подряд) → false', () => {
    expect(isSimplePath([C(0, 0), C(0, 2)])).toBe(false);
    expect(isSimplePath([C(0, 0), C(2, 0)])).toBe(false);
  });

  it('повтор клетки → false', () => {
    expect(isSimplePath([C(0, 0), C(0, 1), C(0, 0)])).toBe(false);
  });

  it('диагональный шаг → false', () => {
    expect(isSimplePath([C(0, 0), C(1, 1)])).toBe(false);
  });

  it('не кидает на мусоре', () => {
    for (const bad of [null, undefined, 42, 'x', {}, [null], [{ r: 0 }], [{ r: 'a', c: 0 }]]) {
      expect(() => isSimplePath(bad)).not.toThrow();
      expect(isSimplePath(bad)).toBe(false);
    }
  });

  it('NaN/Infinity/дробные координаты → false (НЕ просачиваются как «число»)', () => {
    expect(isSimplePath([{ r: NaN, c: 0 }])).toBe(false);
    expect(isSimplePath([{ r: 0, c: Infinity }])).toBe(false);
    expect(isSimplePath([{ r: 1.5, c: 0 }])).toBe(false);
  });
});

// ============================================================================

describe('isValidFlowSolution — ПРЯМОЕ доказательство проходимости (нециркулярно)', () => {
  it('валидное полное покрытие 3×3 → true', () => {
    expect(isValidFlowSolution(3, PAIRS_3, SOLUTION_3)).toBe(true);
  });

  it('концы в обратном порядке тоже валидны', () => {
    const reversed = [pair(C(1, 2), C(0, 0)), pair(C(2, 2), C(1, 1))];
    expect(isValidFlowSolution(3, reversed, SOLUTION_3)).toBe(true);
  });

  it('неполное покрытие (не все клетки) → false', () => {
    // Убираем последнюю клетку второго сегмента — (2,2) не покрыта.
    const partial = [SEG0, SEG1.slice(0, -1)];
    const partialPairs = [PAIRS_3[0], pair(C(1, 1), C(2, 1))];
    expect(isValidFlowSolution(3, partialPairs, partial)).toBe(false);
  });

  it('пересечение путей (общая клетка) → false', () => {
    // Второй сегмент начинается с (0,2) — уже занятой первым сегментом.
    const overlapping = [SEG0, [C(0, 2), C(0, 1)]];
    const op = [PAIRS_3[0], pair(C(0, 2), C(0, 1))];
    expect(isValidFlowSolution(3, op, overlapping)).toBe(false);
  });

  it('концы пути не совпадают с концами пары → false', () => {
    const wrong = [pair(C(0, 0), C(2, 2)), PAIRS_3[1]]; // b0 должен быть (1,2), а тут (2,2)
    expect(isValidFlowSolution(3, wrong, SOLUTION_3)).toBe(false);
  });

  it('клетка вне поля → false', () => {
    const oob = [[C(0, 0), C(0, 1), C(0, 2), C(0, 3)], SEG1];
    const oobPairs = [pair(C(0, 0), C(0, 3)), PAIRS_3[1]];
    expect(isValidFlowSolution(3, oobPairs, oob)).toBe(false);
  });

  it('число пар ≠ числу путей → false', () => {
    expect(isValidFlowSolution(3, PAIRS_3, [SEG0])).toBe(false);
  });

  it('пустые pairs/solution → false', () => {
    expect(isValidFlowSolution(3, [], [])).toBe(false);
  });

  it('некорректный size → false', () => {
    expect(isValidFlowSolution(0, PAIRS_3, SOLUTION_3)).toBe(false);
    expect(isValidFlowSolution(-1, PAIRS_3, SOLUTION_3)).toBe(false);
    expect(isValidFlowSolution(2.5, PAIRS_3, SOLUTION_3)).toBe(false);
  });

  it('не кидает на мусоре', () => {
    expect(() => isValidFlowSolution(3, null as never, null as never)).not.toThrow();
    expect(isValidFlowSolution(3, null as never, null as never)).toBe(false);
  });

  it('NaN-координата в пути → false, НЕ кидает (контракт «не кидает на мусоре»)', () => {
    const nanPairs = [pair(C(0, 0), C(0, 1))];
    expect(() => isValidFlowSolution(5, nanPairs, [[{ r: NaN, c: 0 }]])).not.toThrow();
    expect(isValidFlowSolution(5, nanPairs, [[{ r: NaN, c: 0 }]])).toBe(false);
  });

  it('вырожденная пара (a===b) → false (концы пары должны быть различны)', () => {
    const degen = [{ figure: 'x', color: '#0', a: C(0, 0), b: C(0, 0) }];
    expect(isValidFlowSolution(1, degen, [[C(0, 0)]])).toBe(false);
    // и в составе большего «покрытия» (8 клеток змейкой + 1 вырожденная) — тоже false.
    const snake8 = [C(0, 0), C(0, 1), C(0, 2), C(1, 2), C(1, 1), C(1, 0), C(2, 0), C(2, 1)];
    const pairs = [pair(C(0, 0), C(2, 1)), { figure: 'y', color: '#1', a: C(2, 2), b: C(2, 2) }];
    expect(isValidFlowSolution(3, pairs, [snake8, [C(2, 2)]])).toBe(false);
  });
});

// ============================================================================

describe('isSolvedByPlayer', () => {
  it('полное верное решение → победа', () => {
    expect(isSolvedByPlayer(3, PAIRS_3, SOLUTION_3)).toBe(true);
  });

  it('пустой прогресс → не победа', () => {
    expect(isSolvedByPlayer(3, PAIRS_3, [])).toBe(false);
  });

  it('частичный прогресс (одна пара не дотянута) → не победа', () => {
    const partial = [SEG0, [C(1, 1), C(1, 0)]]; // вторая пара не дошла до (2,2)
    expect(isSolvedByPlayer(3, PAIRS_3, partial)).toBe(false);
  });

  it('NaN-координата в пути игрока → false, НЕ кидает (Фаза 2 зовёт на каждый drop)', () => {
    expect(() => isSolvedByPlayer(3, PAIRS_3, [[{ r: NaN, c: 0 }], SEG1])).not.toThrow();
    expect(isSolvedByPlayer(3, PAIRS_3, [[{ r: NaN, c: 0 }], SEG1])).toBe(false);
  });
});
