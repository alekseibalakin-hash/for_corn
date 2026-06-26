import { describe, expect, it } from 'vitest';
import {
  boustrophedonPath,
  countFlowSolutions,
  cutIntoSegments,
  flowStateFromLevel,
  generateLevel,
  isLevelPassable,
  isResumableFlowSlot,
  normalizeFlow,
  randomHamiltonian,
  SOLVE_CAP_EXCEEDED,
  type FlowLevelState,
} from './levels';
import { isSimplePath, isValidFlowSolution, sameCoord, type Coord, type FlowPair } from './logic';
import { flowBandForLevel } from '../../content';
import { mulberry32 } from '../../engine/rng';

const C = (r: number, c: number): Coord => ({ r, c });

// ============================================================================
// ПРАВИЛО №1 (главный тест Фазы 1, брифа §7): каждый уровень доказуемо проходим ПО ПОСТРОЕНИЮ.
// Проходимость — через isValidFlowSolution (ПРЯМАЯ проверка покрытия), НЕ через солвер (нециркулярно).
// ============================================================================

describe('generateLevel — ПРАВИЛО №1: всегда проходим (конструкция + isValidFlowSolution)', () => {
  const SEEDS = [1, 2, 7, 42, 99, 777, 31337];

  it('уровни 1..30 × seeds: построен/покрыт/решаем + диапазон пар + потолки', () => {
    for (let level = 1; level <= 30; level++) {
      const band = flowBandForLevel(level);
      for (const seed of SEEDS) {
        const lvl = generateLevel(level, seed);

        // Базовая форма уровня.
        expect(lvl.level).toBe(level);
        expect(lvl.size).toBe(band.size);
        expect(lvl.size).toBeLessThanOrEqual(8); // потолок честности/скорости
        expect(lvl.pairs.length).toBe(lvl.solution.length);

        // ПРЯМОЕ доказательство проходимости (покрытие всех клеток + валидные непересекающиеся пути).
        expect(isValidFlowSolution(lvl.size, lvl.pairs, lvl.solution)).toBe(true);
        expect(isLevelPassable(lvl)).toBe(true);

        // Диапазон пар бэнда (parachute тоже укладывается: K = max(pairsMin,2) ≥ pairsMin).
        expect(lvl.pairs.length).toBeGreaterThanOrEqual(band.pairsMin);
        expect(lvl.pairs.length).toBeLessThanOrEqual(band.pairsMax);

        // Все концы различны и в пределах поля (пути дизъюнктны ⇒ концы тоже).
        const seen = new Set<string>();
        for (const p of lvl.pairs) {
          for (const end of [p.a, p.b]) {
            expect(end.r).toBeGreaterThanOrEqual(0);
            expect(end.r).toBeLessThan(lvl.size);
            expect(end.c).toBeGreaterThanOrEqual(0);
            expect(end.c).toBeLessThan(lvl.size);
            const key = `${end.r},${end.c}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
          expect(sameCoord(p.a, p.b)).toBe(false); // концы пары различны
        }

        // Солвер-sanity (НЕ доказательство — обычно = конструкция): находит ≥1 решение или capped.
        const n = countFlowSolutions(lvl.size, lvl.pairs, 1, 80_000);
        expect(n === SOLVE_CAP_EXCEEDED || n >= 1).toBe(true);
      }
    }
  }, 60_000);
});

// ============================================================================
// Детерминизм.
// ============================================================================

describe('детерминизм generateLevel', () => {
  it('одни и те же (level, seed) → идентичный уровень', () => {
    for (const seed of [1, 42, 9999]) {
      for (const level of [1, 5, 13, 20, 30]) {
        expect(generateLevel(level, seed)).toEqual(generateLevel(level, seed));
      }
    }
  });
});

// ============================================================================
// Кривая сложности — бэнды нарастают.
// ============================================================================

describe('кривая сложности — бэнды монотонны', () => {
  it('size не убывает с глубиной', () => {
    expect(flowBandForLevel(1).size).toBeLessThanOrEqual(flowBandForLevel(25).size);
    for (let level = 2; level <= 50; level++) {
      expect(flowBandForLevel(level).size).toBeGreaterThanOrEqual(flowBandForLevel(level - 1).size);
    }
  });

  it('minBendRatio не убывает с глубиной', () => {
    for (let level = 2; level <= 50; level++) {
      expect(flowBandForLevel(level).minBendRatio).toBeGreaterThanOrEqual(
        flowBandForLevel(level - 1).minBendRatio,
      );
    }
  });

  it('size ≤ 8 и pairsMax ≤ size+2 для 1..50 (потолок честности)', () => {
    for (let level = 1; level <= 50; level++) {
      const band = flowBandForLevel(level);
      expect(band.size).toBeLessThanOrEqual(8);
      expect(band.pairsMax).toBeLessThanOrEqual(band.size + 2);
      expect(band.pairsMin).toBeGreaterThanOrEqual(2);
    }
  });
});

// ============================================================================
// randomHamiltonian / boustrophedonPath / cutIntoSegments.
// ============================================================================

describe('randomHamiltonian — покрывает все клетки простым путём', () => {
  it('size 5..8 × seeds: непустой простой путь через все N² клеток', () => {
    for (let size = 5; size <= 8; size++) {
      for (const seed of [1, 2, 7, 42, 777]) {
        const path = randomHamiltonian(size, mulberry32(seed));
        expect(path).not.toBeNull();
        expect(path!.length).toBe(size * size);
        expect(isSimplePath(path!)).toBe(true);
        // Покрытие: все клетки уникальны и в границах.
        const seen = new Set<string>();
        for (const cell of path!) {
          expect(cell.r).toBeGreaterThanOrEqual(0);
          expect(cell.r).toBeLessThan(size);
          expect(cell.c).toBeGreaterThanOrEqual(0);
          expect(cell.c).toBeLessThan(size);
          seen.add(`${cell.r},${cell.c}`);
        }
        expect(seen.size).toBe(size * size);
      }
    }
  });

  it('детерминирован: тот же seed → тот же путь', () => {
    expect(randomHamiltonian(6, mulberry32(123))).toEqual(randomHamiltonian(6, mulberry32(123)));
  });
});

describe('boustrophedonPath — змейка всегда гамильтонова', () => {
  it('size 2..8: простой путь, покрывает все клетки', () => {
    for (let size = 2; size <= 8; size++) {
      const path = boustrophedonPath(size);
      expect(path.length).toBe(size * size);
      expect(isSimplePath(path)).toBe(true);
      const seen = new Set(path.map(c => `${c.r},${c.c}`));
      expect(seen.size).toBe(size * size);
    }
  });
});

describe('cutIntoSegments', () => {
  it('режет путь на ≤k смежных сегментов ≥ minSeg, объединение = путь', () => {
    const path = boustrophedonPath(6); // 36 клеток
    const rng = mulberry32(42);
    const segs = cutIntoSegments(path, 5, rng, 3);
    expect(segs.length).toBeLessThanOrEqual(5);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    for (const seg of segs) {
      expect(seg.length).toBeGreaterThanOrEqual(3);
      expect(isSimplePath(seg)).toBe(true);
    }
    // Объединение по порядку = весь путь.
    const flat = segs.flat();
    expect(flat).toEqual(path);
  });

  it('уменьшает k, если k·minSeg > длины (фактический m учитывается caller-ом)', () => {
    const path = boustrophedonPath(5); // 25 клеток
    const segs = cutIntoSegments(path, 100, mulberry32(1), 3);
    expect(segs.length).toBeLessThanOrEqual(Math.floor(25 / 3)); // ≤ 8
    expect(segs.flat()).toEqual(path);
  });
});

// ============================================================================
// Солвер countFlowSolutions — качество (уникальность), nodeCap, sanity.
// ============================================================================

describe('countFlowSolutions — независимый witness качества', () => {
  it('уникальный кейс (2×2, две колонки) → ровно 1', () => {
    const pairs: FlowPair[] = [
      { figure: 'a', color: '#1', a: C(0, 0), b: C(1, 0) },
      { figure: 'b', color: '#2', a: C(0, 1), b: C(1, 1) },
    ];
    expect(countFlowSolutions(2, pairs, 2, 10_000)).toBe(1);
  });

  it('многорешённый кейс (3×3, одна пара угол-угол) → ≥2 (возвращает 2 = лимит)', () => {
    const pairs: FlowPair[] = [{ figure: 'a', color: '#1', a: C(0, 0), b: C(2, 2) }];
    expect(countFlowSolutions(3, pairs, 2, 50_000)).toBe(2);
  });

  it('сконструированный уровень → ≥1 решение', () => {
    const lvl = generateLevel(3, 42);
    const n = countFlowSolutions(lvl.size, lvl.pairs, 1, 80_000);
    expect(n === SOLVE_CAP_EXCEEDED || n >= 1).toBe(true);
  });

  it('уважает nodeCap (не виснет): крошечный cap → сентинел', () => {
    const lvl = generateLevel(25, 7); // 8×8
    const n = countFlowSolutions(lvl.size, lvl.pairs, 2, 1);
    expect(n).toBe(SOLVE_CAP_EXCEEDED);
  });

  it('битые пары (a===b / наложение концов / вне поля) → 0, не кидает', () => {
    expect(countFlowSolutions(3, [{ figure: 'a', color: '#1', a: C(0, 0), b: C(0, 0) }], 2, 100)).toBe(0);
    const overlap: FlowPair[] = [
      { figure: 'a', color: '#1', a: C(0, 0), b: C(1, 1) },
      { figure: 'b', color: '#2', a: C(0, 0), b: C(2, 2) }, // конец (0,0) уже занят
    ];
    expect(countFlowSolutions(3, overlap, 2, 100)).toBe(0);
    expect(countFlowSolutions(3, [{ figure: 'a', color: '#1', a: C(0, 0), b: C(9, 9) }], 2, 100)).toBe(0);
  });

  it('пустые pairs → 0', () => {
    expect(countFlowSolutions(5, [], 2, 100)).toBe(0);
  });

  it('пара без a/b (или нечисловые/NaN концы) → 0, НЕ кидает (публичный контракт)', () => {
    for (const bad of [
      [{}],
      [{ a: { r: 0, c: 0 } }],
      [{ figure: 'h', color: '#1', a: { r: NaN, c: 0 }, b: { r: 1, c: 1 } }],
      [{ figure: 'h', color: '#1', a: { r: 0, c: 0 }, b: { r: 1.5, c: 1 } }],
    ]) {
      expect(() => countFlowSolutions(5, bad as never, 2, 1000)).not.toThrow();
      expect(countFlowSolutions(5, bad as never, 2, 1000)).toBe(0);
    }
  });
});

// ============================================================================
// normalizeFlow — мягкое чтение слота.
// ============================================================================

describe('normalizeFlow', () => {
  const valid: FlowLevelState = {
    level: 4,
    seed: 42,
    size: 5,
    pairs: [{ figure: 'heart', color: '#ef6f8e', a: C(0, 0), b: C(0, 4) }],
    paths: [[C(0, 0), C(0, 1)]],
    game: { score: 120, moves: 8 },
  };

  it('валидный слот → парсится', () => {
    const res = normalizeFlow(valid);
    expect(res).not.toBeNull();
    expect(res!.level).toBe(4);
    expect(res!.size).toBe(5);
    expect(res!.pairs).toHaveLength(1);
    expect(res!.game).toEqual({ score: 120, moves: 8 });
  });

  it('не кидает на любом мусоре → null', () => {
    for (const bad of [null, undefined, 42, '', {}, [], { level: -1 }, { level: 1 }]) {
      expect(() => normalizeFlow(bad)).not.toThrow();
      expect(normalizeFlow(bad)).toBeNull();
    }
  });

  it('level < 1 → null', () => {
    expect(normalizeFlow({ ...valid, level: 0 })).toBeNull();
  });

  it('битый size → null', () => {
    expect(normalizeFlow({ ...valid, size: 0 })).toBeNull();
    expect(normalizeFlow({ ...valid, size: 2.5 })).toBeNull();
  });

  it('пустой/битый pairs → null', () => {
    expect(normalizeFlow({ ...valid, pairs: [] })).toBeNull();
    expect(normalizeFlow({ ...valid, pairs: 'x' })).toBeNull();
    expect(normalizeFlow({ ...valid, pairs: [{ figure: 'h', color: '#1', a: C(0, 0) }] })).toBeNull();
  });

  it('координата пары вне поля → null', () => {
    expect(normalizeFlow({ ...valid, pairs: [{ figure: 'h', color: '#1', a: C(0, 0), b: C(0, 9) }] })).toBeNull();
  });

  it('вырожденная пара (a===b) в слоте → null (битый слот)', () => {
    expect(normalizeFlow({ ...valid, pairs: [{ figure: 'h', color: '#1', a: C(1, 1), b: C(1, 1) }] })).toBeNull();
  });

  it('paths с клеткой вне поля → null; пустой paths валиден', () => {
    expect(normalizeFlow({ ...valid, paths: [[C(0, 0), C(9, 9)]] })).toBeNull();
    expect(normalizeFlow({ ...valid, paths: [] })).not.toBeNull();
  });

  it('старый/битый game → дефолт {0,0} (аддитивная миграция, НЕ роняет)', () => {
    const { game: _omit, ...legacy } = valid;
    expect(normalizeFlow(legacy)!.game).toEqual({ score: 0, moves: 0 });
    expect(normalizeFlow({ ...valid, game: 'oops' })!.game).toEqual({ score: 0, moves: 0 });
  });

  it('дробные level/seed/game округляются/коэрсятся', () => {
    const res = normalizeFlow({ ...valid, level: 3.9, game: { score: 5.7, moves: 2.1 } });
    expect(res!.level).toBe(3);
    expect(res!.game).toEqual({ score: 5, moves: 2 });
  });
});

// ============================================================================
// flowStateFromLevel + isResumableFlowSlot (зеркало Блоков).
// ============================================================================

describe('flowStateFromLevel — свежий старт', () => {
  it('pairs из уровня, пустой прогресс, нулевой счёт', () => {
    const lvl = generateLevel(5, 4242);
    const st = flowStateFromLevel(lvl);
    expect(st.level).toBe(lvl.level);
    expect(st.seed).toBe(lvl.seed);
    expect(st.size).toBe(lvl.size);
    expect(st.pairs).toEqual(lvl.pairs);
    expect(st.paths).toEqual([]);
    expect(st.game).toEqual({ score: 0, moves: 0 });
  });

  it('round-trip через normalizeFlow стабилен', () => {
    const st = flowStateFromLevel(generateLevel(8, 777));
    expect(normalizeFlow(st)).toEqual(st);
  });

  it('детерминизм: тот же level/seed → тот же снимок', () => {
    expect(flowStateFromLevel(generateLevel(3, 5))).toEqual(flowStateFromLevel(generateLevel(3, 5)));
  });

  it('снимок резюмим как следующий уровень (level === max+1)', () => {
    const lvl = generateLevel(7, 123);
    expect(isResumableFlowSlot(flowStateFromLevel(lvl), lvl.level - 1)).toBe(true);
  });
});

describe('isResumableFlowSlot — резюмим ТОЛЬКО если level === flMaxLevel + 1', () => {
  const slot = (level: number): FlowLevelState => ({
    level,
    seed: 1,
    size: 5,
    pairs: [{ figure: 'heart', color: '#1', a: C(0, 0), b: C(0, 4) }],
    paths: [],
    game: { score: 0, moves: 0 },
  });

  it('следующий непройденный → true', () => {
    expect(isResumableFlowSlot(slot(6), 5)).toBe(true);
  });

  it('устаревший (≤ глубины) → false (фикс «всегда L25»)', () => {
    expect(isResumableFlowSlot(slot(5), 5)).toBe(false);
    expect(isResumableFlowSlot(slot(3), 5)).toBe(false);
  });

  it('из будущего (> max+1) → false', () => {
    expect(isResumableFlowSlot(slot(8), 5)).toBe(false);
  });

  it('null → false', () => {
    expect(isResumableFlowSlot(null, 0)).toBe(false);
  });

  it('новый игрок (глубина 0) резюмит только уровень 1', () => {
    expect(isResumableFlowSlot(slot(1), 0)).toBe(true);
    expect(isResumableFlowSlot(slot(2), 0)).toBe(false);
  });
});
