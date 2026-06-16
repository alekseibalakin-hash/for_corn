import { describe, expect, it } from 'vitest';
import { applyStep, boardToGems, gemsToBoard, swapGems } from './gems';
import { mulberry32, resolveCascades, resolveSwap, SIZE, type Board, type Cell, type Coord, type GemType, type Special } from './logic';

// ---- Хелперы (зеркало logic.test.ts) ----
const D = 3;
const E = 4;

/** Холст без совпадений: тип = (r+c)%3. */
function canvas(): Board {
  const b: Board = [];
  for (let r = 0; r < SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < SIZE; c++) row.push({ type: (r + c) % 3 });
    b.push(row);
  }
  return b;
}
function put(b: Board, r: number, c: number, type: GemType, special?: Special): void {
  b[r][c] = special ? { type, special } : { type };
}

/** Сравнить два поля ПОЭЛЕМЕНТНО по {type, special} (id адаптера игнорируется). */
function expectSameBoard(a: Board, b: Board): void {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const ca = a[r][c];
      const cb = b[r][c];
      expect({ type: ca?.type ?? null, special: ca?.special ?? null }).toEqual({
        type: cb?.type ?? null,
        special: cb?.special ?? null,
      });
    }
  }
}

/** Многокаскадный сетап (из logic.test.ts): col0 D-тройка + E, падающая в row7 → каскад ≥2. */
function cascadeBoard(): Board {
  const b = canvas();
  put(b, 5, 0, D);
  put(b, 6, 0, D);
  put(b, 7, 0, D);
  put(b, 4, 0, E);
  put(b, 7, 1, E);
  put(b, 7, 2, E);
  return b;
}

/** Сетап свопа, создающего спецфишку (линия из 4 при свопе (0,2)↔(1,2)). */
function line4Board(): Board {
  const b = canvas();
  put(b, 0, 0, D);
  put(b, 0, 1, D);
  put(b, 0, 3, D);
  put(b, 1, 2, D);
  return b;
}

describe('gems — round-trip', () => {
  it('gemsToBoard(boardToGems(b)) == b по {type,special} (включая спецы)', () => {
    const b = canvas();
    put(b, 0, 0, D, 'line');
    put(b, 1, 1, E, 'bomb');
    put(b, 2, 2, 0, 'colorBomb');
    expectSameBoard(gemsToBoard(boardToGems(b)), b);
  });

  it('boardToGems даёт уникальные id и по фишке на каждую непустую клетку', () => {
    const gems = boardToGems(canvas());
    expect(gems).toHaveLength(SIZE * SIZE);
    expect(new Set(gems.map((g) => g.id)).size).toBe(gems.length);
  });
});

describe('gems — ИНВАРИАНТ ГРАВИТАЦИИ (замок от десинка с logic)', () => {
  it('многокаскадный ход: gemsToBoard(applyStep(prev, step)) == step.board НА КАЖДОМ шаге', () => {
    const b = cascadeBoard();
    const res = resolveCascades(b, mulberry32(1));
    expect(res.steps.length).toBeGreaterThanOrEqual(2); // действительно многокаскадный
    let gems = boardToGems(b);
    res.steps.forEach((st) => {
      gems = applyStep(gems, st);
      expectSameBoard(gemsToBoard(gems), st.board);
    });
  });

  it('своп с созданием спеца: applyStep синхронен с logic на всех шагах', () => {
    const b = line4Board();
    const a = { r: 0, c: 2 };
    const bb = { r: 1, c: 2 };
    const res = resolveSwap(b, a, bb, mulberry32(1));
    expect(res.steps[0].created.length).toBeGreaterThan(0); // спец действительно создан
    // gems стартуют со свопнутых позиций (как в хуке: swapGems перед playResolve)
    let gems = swapGems(boardToGems(b), a, bb);
    res.steps.forEach((st) => {
      gems = applyStep(gems, st);
      expectSameBoard(gemsToBoard(gems), st.board);
    });
  });

  it('инвариант держится на нескольких разных seed', () => {
    for (const seed of [1, 7, 42, 123]) {
      const b = cascadeBoard();
      const res = resolveCascades(b, mulberry32(seed));
      let gems = boardToGems(b);
      res.steps.forEach((st) => {
        gems = applyStep(gems, st);
        expectSameBoard(gemsToBoard(gems), st.board);
      });
    }
  });
});

describe('gems — id-отношения (не конкретные числа: idCounter глобален)', () => {
  it('выжившая (нетронутый столбец) сохраняет id и позицию; refill получает НОВЫЕ id', () => {
    const b = cascadeBoard();
    const res = resolveCascades(b, mulberry32(1));
    const prev = boardToGems(b);
    const prevIds = new Set(prev.map((g) => g.id));
    const next = applyStep(prev, res.steps[0]);

    // id уникальны
    expect(new Set(next.map((g) => g.id)).size).toBe(next.length);

    // фишка в нетронутом столбце 7 сохранила id и (r,c)
    const survivor = prev.find((g) => g.r === 7 && g.c === 7)!;
    const moved = next.find((g) => g.id === survivor.id);
    expect(moved).toBeDefined();
    expect({ r: moved!.r, c: moved!.c }).toEqual({ r: 7, c: 7 });

    // новые фишки (refill) — id НЕ из prev, помечены isNew
    const fresh = next.filter((g) => !prevIds.has(g.id));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((g) => g.isNew)).toBe(true);
  });

  it('created-спец получает НОВЫЙ id и флаг justMade', () => {
    const b = line4Board();
    const a = { r: 0, c: 2 };
    const bb = { r: 1, c: 2 };
    const res = resolveSwap(b, a, bb, mulberry32(1));
    const prev = swapGems(boardToGems(b), a, bb);
    const prevIds = new Set(prev.map((g) => g.id));
    const next = applyStep(prev, res.steps[0]);

    const made = next.find((g) => g.justMade);
    expect(made).toBeDefined();
    expect(made!.special).toBeDefined();
    expect(prevIds.has(made!.id)).toBe(false);
  });
});

describe('gems — ИНВАРИАНТ на комбо двух спецфишек (Match-3 v2, замок от десинка)', () => {
  // Каждое комбо разрешаем свопом и проверяем applyStep≡logic на ВСЕХ шагах (вкл. каскады после клира).
  const combos: { name: string; make: () => Board; a: Coord; bb: Coord }[] = [
    {
      name: 'line + bomb (толстый крест)',
      make: () => { const x = canvas(); put(x, 4, 4, E, 'line'); put(x, 4, 5, E, 'bomb'); return x; },
      a: { r: 4, c: 4 }, bb: { r: 4, c: 5 },
    },
    {
      name: 'colorBomb + line',
      make: () => { const x = canvas(); put(x, 1, 1, 5, 'colorBomb'); put(x, 1, 2, E, 'line'); put(x, 6, 6, E); return x; },
      a: { r: 1, c: 1 }, bb: { r: 1, c: 2 },
    },
    {
      name: 'colorBomb + bomb',
      make: () => { const x = canvas(); put(x, 1, 1, 5, 'colorBomb'); put(x, 1, 2, E, 'bomb'); put(x, 5, 5, E); return x; },
      a: { r: 1, c: 1 }, bb: { r: 1, c: 2 },
    },
    {
      name: 'colorBomb + colorBomb (всё поле)',
      make: () => { const x = canvas(); put(x, 4, 4, 0, 'colorBomb'); put(x, 4, 5, 0, 'colorBomb'); return x; },
      a: { r: 4, c: 4 }, bb: { r: 4, c: 5 },
    },
    {
      name: 'bomb + bomb (5×5)',
      make: () => { const x = canvas(); put(x, 4, 4, 0, 'bomb'); put(x, 4, 5, 0, 'bomb'); return x; },
      a: { r: 4, c: 4 }, bb: { r: 4, c: 5 },
    },
    {
      name: 'line + line (крест)',
      make: () => { const x = canvas(); put(x, 4, 3, E, 'line'); put(x, 4, 4, E, 'line'); return x; },
      a: { r: 4, c: 3 }, bb: { r: 4, c: 4 },
    },
  ];

  combos.forEach(({ name, make, a, bb }) => {
    it(`gemsToBoard(applyStep(prev, step)) == step.board на всех шагах: ${name}`, () => {
      const board = make();
      const res = resolveSwap(board, a, bb, mulberry32(7));
      expect(res.steps.length).toBeGreaterThanOrEqual(1);
      let gems = swapGems(boardToGems(board), a, bb);
      res.steps.forEach((st) => {
        gems = applyStep(gems, st);
        expectSameBoard(gemsToBoard(gems), st.board);
      });
    });
  });
});
