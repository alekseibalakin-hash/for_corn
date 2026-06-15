import { describe, expect, it } from 'vitest';
import { createEmptyGrid } from './grid';
import { createInitialGrid, pickSpawnValue, spawnTile } from './spawn';
import { countTiles } from './grid';

/** rng, выдающий значения по списку (с зацикливанием) — детерминизм для тестов. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('pickSpawnValue', () => {
  it('rng < 0.1 → 4 (10% случай)', () => {
    expect(pickSpawnValue(() => 0.05)).toBe(4);
    expect(pickSpawnValue(() => 0.0)).toBe(4);
  });

  it('rng >= 0.1 → 2 (90% случай)', () => {
    expect(pickSpawnValue(() => 0.1)).toBe(2);
    expect(pickSpawnValue(() => 0.9)).toBe(2);
  });

  it('распределение ~ 90/10 на большой выборке', () => {
    let fours = 0;
    const N = 10000;
    // псевдо-rng: равномерная развёртка [0,1)
    for (let i = 0; i < N; i++) {
      if (pickSpawnValue(() => i / N) === 4) fours++;
    }
    expect(fours).toBe(Math.ceil(N * 0.1)); // ровно значения < 0.1
  });
});

describe('spawnTile', () => {
  it('ставит плитку в единственную пустую ячейку', () => {
    const grid = [
      [2, 4, 8, 16],
      [16, 8, 4, 2],
      [2, 4, 8, 16],
      [16, 8, 4, 0],
    ];
    // cell-pick rng=0 → единственная ячейка; value-pick rng=0.5 → значение 2
    const { grid: next, spawned } = spawnTile(grid, seqRng([0, 0.5]));
    expect(spawned).toEqual({ r: 3, c: 3, value: 2 });
    expect(next[3][3]).toBe(2);
  });

  it('первый rng выбирает ячейку, второй — значение', () => {
    const grid = createEmptyGrid();
    // 16 пустых: idx = floor(0.0 * 16) = 0 → (0,0); затем значение: 0.05 → 4
    const { spawned } = spawnTile(grid, seqRng([0.0, 0.05]));
    expect(spawned).toEqual({ r: 0, c: 0, value: 4 });
  });

  it('возвращает поле без изменений, если пустых ячеек нет', () => {
    const full = [
      [2, 4, 8, 16],
      [16, 8, 4, 2],
      [2, 4, 8, 16],
      [16, 8, 4, 2],
    ];
    const { spawned } = spawnTile(full, () => 0);
    expect(spawned).toBeNull();
  });

  it('не мутирует исходное поле', () => {
    const grid = createEmptyGrid();
    const snapshot = JSON.stringify(grid);
    spawnTile(grid, () => 0);
    expect(JSON.stringify(grid)).toBe(snapshot);
  });
});

describe('createInitialGrid', () => {
  it('стартует ровно с двумя плитками', () => {
    const grid = createInitialGrid(seqRng([0.2, 0.5, 0.3, 0.5]));
    expect(countTiles(grid, (v) => v !== 0)).toBe(2);
  });
});
