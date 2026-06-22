import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateLevel,
  makePieceStream,
  normalizeBlocks,
  parachute,
  simulateCasualBlocks,
  simulateCarelessBlocks,
  simulateSolveBlocks,
  validBlocksLayout,
  type BlockGoal,
  type BlockLevel,
  type BlockLevelState,
} from './levels';
import { blocksBandForLevel } from '../../content';
import { cloneGrid, countBlocks, emptyGrid, GRID_SIZE } from './logic';
import { mulberry32 } from '../../engine/rng';

// ============================================================================
// ПРАВИЛО №1: каждый уровень проходим за setsBudget (главный тест Фазы 1).
// ============================================================================

describe('generateLevel — ПРАВИЛО №1: всегда проходим за бюджет (солвер-гейт + k-fork + parachute)', () => {
  const SEEDS = [1, 2, 7, 13, 42, 99, 777, 31337];

  it('уровни 1..30 × seeds: проходим в бюджет + конструктивные инварианты + потолок честности', () => {
    for (let level = 1; level <= 30; level++) {
      for (const seed of SEEDS) {
        const lvl = generateLevel(level, seed);

        // Цель корректна
        expect(lvl.goal.kind).toBe('clearBlocks');
        expect(lvl.goal.target).toBeGreaterThanOrEqual(1);
        expect(countBlocks(lvl.grid)).toBe(lvl.goal.target);
        expect(lvl.setsBudget).toBeGreaterThanOrEqual(1);

        // Потолок честности
        expect(countBlocks(lvl.grid)).toBeLessThanOrEqual(16);

        // КОНСТРУКТИВНОЕ доказательство: свидетель проходит в setsBudget на play-seed уровня
        const stream = makePieceStream(lvl.seed);
        const proof = simulateSolveBlocks(cloneGrid(lvl.grid), lvl.goal, lvl.setsBudget, stream);
        expect(proof.solved).toBe(true);
        expect(proof.sets).toBeLessThanOrEqual(lvl.setsBudget);
      }
    }
  }, 60_000); // timeout 60s на все 240 уровней

  it('бюджет ≥ worst (witness укладывается) и ≥ budgetFloor', () => {
    for (const seed of [1, 42, 777]) {
      for (let level = 1; level <= 10; level++) {
        const lvl = generateLevel(level, seed);
        const band = blocksBandForLevel(level);
        const floor = band.budgetFloor ?? 3;

        // setsBudget ≥ floor (аддитивный минимум контентной ручки)
        expect(lvl.setsBudget).toBeGreaterThanOrEqual(floor);

        // Свидетель укладывается в setsBudget
        const proof = simulateSolveBlocks(cloneGrid(lvl.grid), lvl.goal, lvl.setsBudget, makePieceStream(lvl.seed));
        expect(proof.solved).toBe(true);
      }
    }
  });
});

// ============================================================================
// Детерминизм.
// ============================================================================

describe('детерминизм generateLevel', () => {
  it('одни и те же (level, seed) → тот же уровень', () => {
    for (const seed of [1, 42, 9999]) {
      for (const level of [1, 5, 15, 25]) {
        const a = generateLevel(level, seed);
        const b = generateLevel(level, seed);
        expect(a.seed).toBe(b.seed);
        expect(a.goal).toEqual(b.goal);
        expect(a.setsBudget).toBe(b.setsBudget);
        expect(a.grid).toEqual(b.grid);
      }
    }
  });
});

// ============================================================================
// parachute — total-функция.
// ============================================================================

describe('parachute — тотальность', () => {
  it('возвращает проходимый уровень для 1..30 × seeds', () => {
    const SEEDS = [1, 7, 42, 777];
    for (const seed of SEEDS) {
      for (let level = 1; level <= 30; level += 5) {
        const lvl = parachute(level, seed);
        expect(lvl.goal.kind).toBe('clearBlocks');
        expect(lvl.goal.target).toBeGreaterThanOrEqual(1);
        const proof = simulateSolveBlocks(cloneGrid(lvl.grid), lvl.goal, lvl.setsBudget, makePieceStream(lvl.seed));
        expect(proof.solved).toBe(true);
      }
    }
  }, 30_000);

  it('никогда не кидает исключение', () => {
    expect(() => parachute(1, 12345)).not.toThrow();
    expect(() => parachute(30, 99999)).not.toThrow();
  });
});

// ============================================================================
// validBlocksLayout.
// ============================================================================

describe('validBlocksLayout', () => {
  it('пустое поле → false (нет блоков)', () => {
    expect(validBlocksLayout(emptyGrid())).toBe(false);
  });

  it('1 блок → true', () => {
    const g = emptyGrid();
    g[3][3] = 'block';
    expect(validBlocksLayout(g)).toBe(true);
  });

  it('>16 блоков → false (потолок честности)', () => {
    const g = emptyGrid();
    let placed = 0;
    for (let r = 0; r < GRID_SIZE && placed < 17; r++)
      for (let c = 0; c < GRID_SIZE && placed < 17; c++) {
        g[r][c] = 'block';
        placed++;
      }
    expect(validBlocksLayout(g)).toBe(false);
  });

  it('строка с >5 блоками → false', () => {
    const g = emptyGrid();
    for (let c = 0; c < 6; c++) g[0][c] = 'block';
    expect(validBlocksLayout(g)).toBe(false);
  });

  it('полная строка (немедленно очистится) → false', () => {
    const g = emptyGrid();
    for (let c = 0; c < GRID_SIZE; c++) g[0][c] = 'fill';
    g[0][0] = 'block'; // один block, остальные fill → строка полная
    expect(validBlocksLayout(g)).toBe(false);
  });
});

// ============================================================================
// makePieceStream.
// ============================================================================

describe('makePieceStream', () => {
  it('nextSet возвращает 3 фигуры', () => {
    const s = makePieceStream(42);
    const set = s.nextSet();
    expect(set.length).toBe(3);
    for (const p of set) expect(p.cells.length).toBeGreaterThanOrEqual(1);
  });

  it('pos() растёт на 3 за каждый nextSet', () => {
    const s = makePieceStream(1);
    expect(s.pos()).toBe(0);
    s.nextSet();
    expect(s.pos()).toBe(3);
    s.nextSet();
    expect(s.pos()).toBe(6);
  });

  it('детерминированный: одинаковый seed → одинаковая последовательность', () => {
    const a = makePieceStream(99);
    const b = makePieceStream(99);
    for (let i = 0; i < 5; i++) {
      expect(a.nextSet()).toEqual(b.nextSet());
    }
  });

  it('разные seeds → разные последовательности', () => {
    const a = makePieceStream(1);
    const b = makePieceStream(2);
    const setA = a.nextSet();
    const setB = b.nextSet();
    // Вероятность полного совпадения пренебрежимо мала
    expect(setA).not.toEqual(setB);
  });
});

// ============================================================================
// normalizeBlocks.
// ============================================================================

describe('normalizeBlocks', () => {
  const validGrid = emptyGrid();
  validGrid[3][3] = 'block';

  const validState: BlockLevelState = {
    level: 5,
    seed: 42,
    setsLeft: 10,
    goal: { kind: 'clearBlocks', target: 1 },
    progress: 0,
    streamPos: 3,
    grid: validGrid,
    currentPieces: [{ cells: [{ r: 0, c: 0 }] }],
  };

  it('корректный снимок → парсится', () => {
    const res = normalizeBlocks(validState);
    expect(res).not.toBeNull();
    expect(res!.level).toBe(5);
    expect(res!.goal.kind).toBe('clearBlocks');
    expect(res!.goal.target).toBe(1);
    expect(res!.setsLeft).toBe(10);
  });

  it('null → null', () => {
    expect(normalizeBlocks(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(normalizeBlocks(undefined)).toBeNull();
  });

  it('не кидает при любом мусоре', () => {
    for (const bad of [null, undefined, 42, 'hello', {}, [], { level: -1 }]) {
      expect(() => normalizeBlocks(bad)).not.toThrow();
      expect(normalizeBlocks(bad)).toBeNull();
    }
  });

  it('level < 1 → null', () => {
    expect(normalizeBlocks({ ...validState, level: 0 })).toBeNull();
  });

  it('setsLeft < 0 → null', () => {
    expect(normalizeBlocks({ ...validState, setsLeft: -1 })).toBeNull();
  });

  it('goal.kind неверный → null', () => {
    expect(normalizeBlocks({ ...validState, goal: { kind: 'clearIce', target: 1 } })).toBeNull();
  });

  it('grid неверного размера → null', () => {
    const badGrid = [[...Array(7)].map(() => 'empty' as const)];
    expect(normalizeBlocks({ ...validState, grid: badGrid })).toBeNull();
  });

  it('grid с невалидным Cell-значением → null', () => {
    const badGrid = validGrid.map(r => [...r]);
    (badGrid[0][0] as unknown) = 'ice'; // не 'empty'|'fill'|'block'
    expect(normalizeBlocks({ ...validState, grid: badGrid })).toBeNull();
  });

  it('currentPieces не массив → null', () => {
    expect(normalizeBlocks({ ...validState, currentPieces: null })).toBeNull();
  });

  it('дробные числа округляются', () => {
    const res = normalizeBlocks({ ...validState, level: 3.9, setsLeft: 7.8, progress: 1.5, streamPos: 2.1 });
    expect(res).not.toBeNull();
    expect(res!.level).toBe(3);
    expect(res!.setsLeft).toBe(7);
    expect(res!.progress).toBe(1);
    expect(res!.streamPos).toBe(2);
  });
});

// ============================================================================
// simulateSolveBlocks — базовые свойства.
// ============================================================================

describe('simulateSolveBlocks', () => {
  it('пустой grid (нет блоков) → solved сразу', () => {
    const g = emptyGrid();
    const goal: BlockGoal = { kind: 'clearBlocks', target: 0 };
    const stream = makePieceStream(1);
    const res = simulateSolveBlocks(g, goal, 10, stream);
    expect(res.solved).toBe(true);
    expect(res.sets).toBe(0);
  });

  it('1 блок в легкодоступной позиции → решается за разумное число наборов', () => {
    const g = emptyGrid();
    g[0][4] = 'block'; // блок в строке 0, позиция 4
    const goal: BlockGoal = { kind: 'clearBlocks', target: 1 };
    const stream = makePieceStream(42);
    const res = simulateSolveBlocks(g, goal, 50, stream);
    expect(res.solved).toBe(true);
    expect(res.sets).toBeLessThanOrEqual(50);
  });

  it('не мутирует входной grid', () => {
    const g = emptyGrid();
    g[3][3] = 'block';
    const original = g.map(r => [...r]);
    const goal: BlockGoal = { kind: 'clearBlocks', target: 1 };
    simulateSolveBlocks(g, goal, 20, makePieceStream(1));
    expect(g).toEqual(original);
  });
});

// ============================================================================
// Кривая сложности через бэнды.
// ============================================================================

describe('кривая сложности — бэнды нарастают', () => {
  it('band L1 имеет меньше blocksMax, чем band L25', () => {
    const early = blocksBandForLevel(1);
    const late = blocksBandForLevel(25);
    expect(early.blocksMax).toBeLessThanOrEqual(late.blocksMax);
  });

  it('budgetMultiplier убывает (или равен) с ростом уровня', () => {
    const early = blocksBandForLevel(1);
    const late = blocksBandForLevel(25);
    expect(late.budgetMultiplier).toBeLessThanOrEqual(early.budgetMultiplier);
  });

  it('все бэнды: budgetMultiplier > 1 (честность)', () => {
    for (let level = 1; level <= 50; level++) {
      const band = blocksBandForLevel(level);
      expect(band.budgetMultiplier).toBeGreaterThan(1);
    }
  });
});

// ============================================================================
// A3 Casual + Careless witness тесты (де-циркуляризация, Раунд 3).
//
// Competent (Раунд 2): 6-perm shuffle + density-heuristic — верхняя граница human-play.
// Careless  (Раунд 3): фиксированный порядок 0→1→2 + density-heuristic — нижняя граница.
//   Нет перебора порядков: тупик в середине набора = проигрыш для набора.
//   Лучше near-random (density vs случайная позиция), но хуже competent.
//   Если careless проходит — нормальный игрок точно справится.
//
// De-циркуляризация:
//   playStream   = makePieceStream(lvl.seed)             (тот же поток, что у игрока)
//   competentRng = mulberry32(trialSeed ^ 0xdeadbeef)
//   carelessRng  = mulberry32(trialSeed ^ 0xc0ffee42)    (отдельная соль)
//
// Мемоизация (Раунд 3): ВСЕ winrate считаются ОДИН РАЗ в beforeAll.
//   АНТИ-ИНВЕРСИЯ-тест использует те же данные, не пересчитывает.
// ============================================================================

function runCasualTrial(lvl: BlockLevel, trialSeed: number): boolean {
  const stream = makePieceStream(lvl.seed);
  const pickRng = mulberry32((trialSeed ^ 0xdeadbeef) >>> 0);
  return simulateCasualBlocks(lvl.grid, lvl.goal, lvl.setsBudget, stream, pickRng);
}

function runCarelessTrial(lvl: BlockLevel, trialSeed: number): boolean {
  const stream = makePieceStream(lvl.seed);
  const pickRng = mulberry32((trialSeed ^ 0xc0ffee42) >>> 0);
  return simulateCarelessBlocks(lvl.grid, lvl.goal, lvl.setsBudget, stream, pickRng);
}

describe('A3 casual + careless winrate по бэндам (Раунд 3, де-циркуляризация, мемо)', () => {
  // 30 трайлов/уровень × 3-4 уровня/бэнд → 90-120 трайлов/бэнд; σ ≤ 4pp при p=70%.
  const TRIALS_PER_LEVEL = 30;

  // minCompetent = наблюдаемый WR − 15pp (Раунд 2 + Раунд 3 калибровка).
  // minCareless  = нижняя граница: если даже без перебора порядков — уровень точно проходим.
  // Пороги фиксированы — если тест падает, чини генератор, а не порог.
  const BAND_SPECS = [
    { levels: [1, 2, 3],        minCompetent: 0.70, minCareless: 0.48, label: 'L1-3' },
    { levels: [4, 5, 6, 7],     minCompetent: 0.65, minCareless: 0.42, label: 'L4-7' },
    { levels: [8, 9, 10, 11],   minCompetent: 0.55, minCareless: 0.30, label: 'L8-11' },
    { levels: [14, 15, 16, 17], minCompetent: 0.48, minCareless: 0.22, label: 'L14-17' },
    { levels: [20, 22, 25],     minCompetent: 0.45, minCareless: 0.18, label: 'L20-25' },
    { levels: [27, 29, 30],     minCompetent: 0.40, minCareless: 0.15, label: 'L27-30' },
  ];

  // Мемо: competent + careless считаются на одних и тех же уровнях за один проход в beforeAll.
  interface BandResult { competent: number; careless: number }
  const bandResults: BandResult[] = [];

  beforeAll(() => {
    for (const { levels } of BAND_SPECS) {
      let competentWins = 0;
      let carelessWins = 0;
      let total = 0;
      for (const level of levels) {
        for (let trial = 0; trial < TRIALS_PER_LEVEL; trial++) {
          const seed = ((trial * 997 + level * 31337) >>> 0);
          const lvl = generateLevel(level, seed);
          if (runCasualTrial(lvl, seed)) competentWins++;
          if (runCarelessTrial(lvl, seed)) carelessWins++;
          total++;
        }
      }
      bandResults.push({ competent: competentWins / total, careless: carelessWins / total });
    }
  }, 360_000);

  BAND_SPECS.forEach(({ minCompetent, minCareless, label }, bi) => {
    it(`${label}: competent winrate ≥ ${(minCompetent * 100).toFixed(0)}%`, () => {
      expect(bandResults[bi].competent).toBeGreaterThanOrEqual(minCompetent);
    });
    it(`${label}: careless winrate ≥ ${(minCareless * 100).toFixed(0)}%`, () => {
      expect(bandResults[bi].careless).toBeGreaterThanOrEqual(minCareless);
    });
  });

  // АНТИ-ИНВЕРСИЯ (не «монотонность»): каждый бэнд не превышает предыдущий более чем на TOLERANCE.
  // TOLERANCE=15pp покрывает статистический шум (σ≈4pp при n=120); ловит крупные структурные инверсии.
  it('АНТИ-ИНВЕРСИЯ: competent winrate не растёт с глубиной (±15pp допустимо)', () => {
    const TOLERANCE = 0.15;
    for (let i = 1; i < bandResults.length; i++) {
      expect(bandResults[i].competent).toBeLessThanOrEqual(bandResults[i - 1].competent + TOLERANCE);
    }
  });
});
