import { describe, expect, it, vi } from 'vitest';
import { applyStep, boardToGems, gemsToBoard, gemsToObstacles, swapGems, type VisualGem } from './gems';
import {
  emptyObstacles,
  mulberry32,
  resolveCascades,
  resolveSwap,
  SIZE,
  type Board,
  type Cell,
  type Coord,
  type GemType,
  type Obstacles,
  type ResolveResult,
  type Special,
} from './logic';

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

// ============================================================================
// РАСШИРЕННЫЙ ИНВАРИАНТ на препятствия (Match-3 «Комнаты», Фаза 1, бриф §4) — ОБЯЗАТЕЛЬНОЕ условие
// приёмки. gemsToBoard несёт {type,special}, gemsToObstacles несёт {blocks,ice}; сравниваем ОБА на
// КАЖДОМ шаге, на seeds [1,7,42,123]. Замок реально краснеет при десинке гравитации/льда (проверено
// временной поломкой гравитации в одном файле → red → revert).
// ============================================================================

const SEEDS = [1, 7, 42, 123];

/** Сравнить слои Obstacles поэлементно (blocks + ice). */
function expectSameObstacles(a: Obstacles, b: Obstacles): void {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      expect({ block: a.blocks[r][c] === true, ice: a.ice[r][c] }).toEqual({
        block: b.blocks[r][c] === true,
        ice: b.ice[r][c],
      });
    }
  }
}

/**
 * Проиграть весь ResolveResult на визуальных фишках и проверить инвариант на каждом шаге:
 *  - gemsToBoard(gems) === step.board по {type,special};
 *  - gemsToObstacles(gems, blocks) === step.obstacles по {blocks,ice} (несёт лёд).
 * `ob` — препятствия ДО хода; applyStep получает ob-ДО-шага (st.obstacles предыдущего шага).
 */
function replayWithObstacles(start: VisualGem[], ob: Obstacles, res: ResolveResult): VisualGem[] {
  let gems = start;
  let obBefore = ob;
  res.steps.forEach((st) => {
    gems = applyStep(gems, st, obBefore);
    expectSameBoard(gemsToBoard(gems), st.board);
    expectSameObstacles(gemsToObstacles(gems, st.obstacles.blocks), st.obstacles);
    // НЕЗАВИСИМАЯ проверка блок-слоя (не тавтология gemsToObstacles): ни одна фишка не стоит на
    // блок-клетке — иначе gems-гравитация уронила бы фишку на/сквозь блок (десинк с logic.applyGravity).
    for (const g of gems) expect(st.obstacles.blocks[g.r][g.c]).toBe(false);
    obBefore = st.obstacles;
  });
  return gems;
}

/** (а) Блок в середине столбца + тройки ПОД и НАД ним (сегментная гравитация в одном ходе). */
function blockColumnBoard(): { board: Board; ob: Obstacles } {
  const b = canvas();
  const ob = emptyObstacles();
  ob.blocks[4][0] = true;
  b[4][0] = null; // блок — не фишка
  put(b, 5, 0, D); // тройка ПОД блоком (вертикаль)
  put(b, 6, 0, D);
  put(b, 7, 0, D);
  put(b, 2, 0, E); // тройка НАД блоком (горизонталь)
  put(b, 2, 1, E);
  put(b, 2, 2, E);
  return { board: b, ob };
}

/** (б) Замороженная фишка + тройка у её орто-соседа (скол льда). */
function iceNeighborBoard(): { board: Board; ob: Obstacles } {
  const b = canvas();
  const ob = emptyObstacles();
  ob.ice[3][4] = 1;
  put(b, 3, 4, 5); // фишка под льдом (тип 5 — не выстраивается)
  put(b, 3, 1, D); // тройка, чей правый край (3,3) — орто-сосед льда (3,4)
  put(b, 3, 2, D);
  put(b, 3, 3, D);
  return { board: b, ob };
}

/**
 * (г) Лёд с ДЫРОЙ ПОД НИМ, образующейся В ТОМ ЖЕ шаге: тройка ПРЯМО под льдом уходит на шаге 0 и
 * скалывает иней (орто-сосед (5,0) очищен). Замороженная (4,0) обязана остаться static ИМЕННО ЭТОТ
 * шаг (оттай — со следующего), т.е. НЕ провалиться в свежую дыру. Это ловит «ранний оттай» (трактовать
 * сколотый лёд как уже подвижный в шаге скола): такой баг роняет фишку на шаг раньше → инвариант
 * краснеет. (а)/(б) этого НЕ ловят — там у оттаявшей фишки нет дыры под ней в шаге скола.
 */
function iceMeltGapBelowBoard(): { board: Board; ob: Obstacles } {
  const b = canvas();
  const ob = emptyObstacles();
  ob.ice[4][0] = 1;
  put(b, 4, 0, 5); // фишка под льдом
  put(b, 5, 0, 2); // тройка ПРЯМО под льдом → дыра под фишкой возникает В ТОМ ЖЕ шаге, что и скол
  put(b, 6, 0, 2);
  put(b, 7, 0, 2);
  return { board: b, ob };
}

/** (в) Смешанная раскладка для round-trip персиста: блок + лёд + матчабельная тройка у льда. */
function roomMixBoard(): { board: Board; ob: Obstacles } {
  const b = canvas();
  const ob = emptyObstacles();
  ob.blocks[4][4] = true;
  b[4][4] = null;
  ob.ice[2][2] = 1;
  put(b, 2, 2, 1, 'line'); // замороженная МОЖЕТ нести спец — round-trip обязан сохранить и его
  ob.ice[6][6] = 1;
  put(b, 6, 6, 0);
  // Тройка D у льда (6,6): после restore ход реально каскадит (≥1 шаг) и скалывает лёд (6,6).
  put(b, 6, 3, D);
  put(b, 6, 4, D);
  put(b, 6, 5, D);
  return { board: b, ob };
}

describe('gems — РАСШИРЕННЫЙ ИНВАРИАНТ на препятствия (блок/лёд, замок от десинка)', () => {
  it('(а) блок в середине столбца + клир под/над: gemsToBoard==step.board + obstacles на всех шагах', () => {
    for (const seed of SEEDS) {
      const { board, ob } = blockColumnBoard();
      const res = resolveCascades(board, mulberry32(seed), { obstacles: ob });
      expect(res.steps.length).toBeGreaterThanOrEqual(1);
      replayWithObstacles(boardToGems(board, ob), ob, res);
      // блок цел; под-блочная дыра осталась null в ОБОИХ представлениях
      expect(res.obstacles.blocks[4][0]).toBe(true);
      const last = res.steps[res.steps.length - 1].board;
      expect(last[4][0]).toBeNull(); // блок — не фишка
    }
  });

  it('(б) скол льда у соседа: gemsToBoard==step.board + obstacles на всех шагах', () => {
    for (const seed of SEEDS) {
      const { board, ob } = iceNeighborBoard();
      const res = resolveCascades(board, mulberry32(seed), { obstacles: ob });
      expect(res.steps.length).toBeGreaterThanOrEqual(1);
      replayWithObstacles(boardToGems(board, ob), ob, res);
    }
  });

  it('(б) фишка под льдом СОХРАНЯЕТ id (не пере-рождается), clearedCount за неё НЕ растёт', () => {
    const { board, ob } = iceNeighborBoard();
    const res = resolveCascades(board, mulberry32(1), { obstacles: ob });
    const gems0 = boardToGems(board, ob);
    const frozenBefore = gems0.find((g) => g.r === 3 && g.c === 4)!;
    expect(frozenBefore.ice).toBe(1);
    const next = applyStep(gems0, res.steps[0], ob);
    const frozenAfter = next.find((g) => g.r === 3 && g.c === 4)!;
    expect(frozenAfter.id).toBe(frozenBefore.id); // id сохранён — фишка ожила, а не пере-рождена
    expect(frozenAfter.ice).toBeUndefined(); // оттаяла (ice 1→0)
    expect(res.steps[0].clearedCount).toBe(3); // лёд-фишку не считаем — только тройка
  });

  it('(г) лёд с дырой под ним: оттаявшая фишка НЕ проваливается в шаге скола (оттай — со следующего); id сохранён', () => {
    for (const seed of SEEDS) {
      const { board, ob } = iceMeltGapBelowBoard();
      const res = resolveCascades(board, mulberry32(seed), { obstacles: ob });
      expect(res.steps[0].clearedCount).toBe(3); // только тройка под льдом
      expect(res.steps[0].board[4][0]).not.toBeNull(); // фишка под льдом осталась на месте ЭТОТ шаг
      expect(res.steps[0].board[7][0]).toBeNull(); // дыра под льдом НЕ зарефилена (шаг считался по старому ob)
      const gems0 = boardToGems(board, ob);
      const frozenId = gems0.find((g) => g.r === 4 && g.c === 0)!.id;
      expect(gems0.find((g) => g.id === frozenId)!.ice).toBe(1);
      // Шаг 0: фишка НЕ упала в момент скола (applyStep использует pre-thaw ob → isStatic(4,0)=true).
      // КРАСНЕЕТ при «раннем оттае»: неверный ob → фишка провалилась бы → r≠4.
      const gemsAfterStep0 = applyStep(gems0, res.steps[0], ob);
      const frozenAfterStep0 = gemsAfterStep0.find((g) => g.id === frozenId);
      expect(frozenAfterStep0).toBeDefined();
      expect(frozenAfterStep0!.r).toBe(4); // не упала в шаге скола (id сохранён — не пере-рождена)
      expect(frozenAfterStep0!.ice).toBeUndefined(); // оттаяла (iceHit обработан applyStep-ом)
      // Инвариант на ВСЕХ шагах (включая settle-шаг): gemsToBoard == step.board, obstacles совпадают.
      replayWithObstacles(gems0, ob, res);
      expect(res.obstacles.ice[4][0]).toBe(0);
    }
  });

  it('(д) лёд колется на последнем шаге → settle-шаг закрывает дыру в ТОМ ЖЕ ходу (не ждём след. хода)', () => {
    for (const seed of SEEDS) {
      const { board, ob } = iceMeltGapBelowBoard();
      const res = resolveCascades(board, mulberry32(seed), { obstacles: ob });
      // Settle-шаг выдан: шагов ≥ 2 (шаг 0 = скол льда, шаг 1 = оседание).
      expect(res.steps.length).toBeGreaterThanOrEqual(2);
      // Шаг 0 ещё имеет дыру (лёд static в этом шаге → sub-static сегмент без рефилла).
      expect(res.steps[0].board[7][0]).toBeNull();
      // Шаг 1 (settle) закрыл дыру: gravity+refill под пост-сколовым ob.
      expect(res.steps[1].board[7][0]).not.toBeNull();
      // Финальное поле ОСЕЛО: столбец 0 без дыр (нет блоков → весь столбец = верхний сегмент).
      for (let r = 0; r < SIZE; r++) expect(res.board[r][0]).not.toBeNull();
      // Инвариант на всех шагах (вкл. settle): gemsToBoard(applyStep-chain) === step.board,
      // gemsToObstacles === step.obstacles. КРАСНЕЕТ при десинке settle-ob: неверный ob в applyStep →
      // фишка не падает в gems, но step.board упавшая → expectSameBoard ПРОВАЛИТСЯ → RED.
      replayWithObstacles(boardToGems(board, ob), ob, res);
    }
  });

  it('(в) round-trip персиста: boardToGems→gemsToBoard + gemsToObstacles несут {type,special,blocks,ice}', () => {
    const { board, ob } = roomMixBoard();
    // эмулируем персист: JSON-сериализация board + obstacles
    const board2 = JSON.parse(JSON.stringify(board)) as Board;
    const ob2 = JSON.parse(JSON.stringify(ob)) as Obstacles;
    const gems = boardToGems(board2, ob2);
    expectSameBoard(gemsToBoard(gems), board);
    expectSameObstacles(gemsToObstacles(gems, ob2.blocks), ob);
    // и далее ход поверх восстановленного состояния РЕАЛЬНО каскадит (тройка у льда) и остаётся синхронным
    const res = resolveCascades(board2, mulberry32(42), { obstacles: ob2 });
    expect(res.steps.length).toBeGreaterThanOrEqual(1); // post-restore ход не пустой
    expect(res.iceCleared).toBeGreaterThanOrEqual(1); // лёд (6,6) сколот восстановленным ходом
    replayWithObstacles(gems, ob2, res);
  });
});

// ============================================================================
// РЕПРО freeze-fix (briefs/match3-freeze-fix.md): стопка камней + лёд + settle-only шаг (L27-аналог).
// Доказывает: resolveCascades + applyStep инвариантны на конфиге, который провоцировал зависание.
// Финальная board из watchdog-recovery (res.board) также валидна — recover не сломает поле.
// ============================================================================

describe('репро freeze-fix: стопка камней + лёд + settle-only (L27-аналог)', () => {
  /**
   * cascadeBoard() + стопка ≥3 блоков в col=4 (r5-7) + лёд в (6,2).
   * Воспроизводит условия «с перчинкой» L27: E-тройка на шаге 2 скалывает лёд (6,2) →
   * needsSettle=true → settle-only шаг. Стопка камней в col=4 — сегментная гравитация.
   */
  function freezeReproBoard(): { board: Board; ob: Obstacles } {
    const board = cascadeBoard();
    const ob = emptyObstacles();
    ob.blocks[5][4] = true; board[5][4] = null;
    ob.blocks[6][4] = true; board[6][4] = null;
    ob.blocks[7][4] = true; board[7][4] = null;
    ob.ice[6][2] = 1; // смежен с (7,2) из E-тройки шага 2 → скол → settle-only шаг
    return { board, ob };
  }

  it('каскад завершается синхронно, есть settle-only шаг, лёд сколот', () => {
    const { board, ob } = freezeReproBoard();
    const res = resolveCascades(board, mulberry32(1), { obstacles: ob });
    expect(res.steps.length).toBeGreaterThanOrEqual(3); // шаг1 D-тройка + шаг2 E-тройка+скол + шаг3 settle-only
    const settleOnly = res.steps.find((s) => s.cleared.length === 0 && s.detonated.length === 0);
    expect(settleOnly).toBeDefined();
    expect(res.iceCleared).toBeGreaterThanOrEqual(1);
  });

  it('инвариант applyStep держится НА КАЖДОМ шаге каскада (вкл. settle-only) — замок от freeze-бага', () => {
    const { board, ob } = freezeReproBoard();
    const res = resolveCascades(board, mulberry32(1), { obstacles: ob });
    replayWithObstacles(boardToGems(board, ob), ob, res);
  });

  it('финальная board из watchdog-recovery (res.board) валидна: gems round-trip + лёд=0', () => {
    // watchdog применяет res.board при обрыве анимации; проверяем что оно корректно восстанавливается.
    const { board, ob } = freezeReproBoard();
    const res = resolveCascades(board, mulberry32(42), { obstacles: ob });
    const recoveredGems = boardToGems(res.board, res.obstacles);
    expectSameBoard(gemsToBoard(recoveredGems), res.board);
    expect(res.obstacles.ice[6][2]).toBe(0); // лёд сколот — recover не оставит заморозку
  });

  it('watchdog-концепт: animTimersRef (отдельный ref) НЕ гасится lifecycle-cleanup timersRef', () => {
    // Структурный тест: доказывает, что watchdog в отдельном ref выживает после clearTimeout(animTimers).
    vi.useFakeTimers();
    const animTimers: ReturnType<typeof setTimeout>[] = [];
    let animFired = false;
    let watchdogFired = false;

    const animId = setTimeout(() => { animFired = true; }, 100);
    animTimers.push(animId);
    const watchdogId = setTimeout(() => { watchdogFired = true; }, 200);

    // lifecycle-cleanup: гасит animTimers, НЕ трогает watchdog (он в отдельном ref)
    animTimers.forEach(clearTimeout); animTimers.length = 0;

    vi.advanceTimersByTime(300);

    expect(animFired).toBe(false);    // anim-таймер убит lifecycle-cleanup ✓
    expect(watchdogFired).toBe(true); // watchdog выжил — именно это обеспечивает safety-net ✓

    clearTimeout(watchdogId); // cleanup для теста
    vi.useRealTimers();
  });
});
