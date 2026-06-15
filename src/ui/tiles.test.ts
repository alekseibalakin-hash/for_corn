import { describe, expect, it } from 'vitest';
import { move } from '../game/move';
import { spawnTile } from '../game/spawn';
import type { Direction, Grid } from '../game/types';
import { gridToTiles, slideTiles, spawnInTiles, tilesToGrid } from './tiles';

const DIRS: Direction[] = ['up', 'down', 'left', 'right'];

function randomGrid(rng: () => number): Grid {
  const values = [0, 0, 0, 2, 2, 4, 4, 8, 16, 32];
  return Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => values[Math.floor(rng() * values.length)]),
  );
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('slideTiles ↔ move (перекрёстная проверка с чистым ядром)', () => {
  it('итоговое поле и очки совпадают с move() на множестве случайных полей', () => {
    const rng = lcg(42);
    for (let iter = 0; iter < 400; iter++) {
      const grid = randomGrid(rng);
      for (const dir of DIRS) {
        const viaGrid = move(grid, dir);
        const viaTiles = slideTiles(gridToTiles(grid), dir);
        expect(tilesToGrid(viaTiles.tiles)).toEqual(viaGrid.grid);
        expect(viaTiles.scoreGained).toBe(viaGrid.scoreGained);
        expect(viaTiles.moved).toBe(viaGrid.moved);
      }
    }
  });
});

describe('slideTiles — идентичность плиток', () => {
  it('сохраняет id у поехавшей плитки', () => {
    const tiles = gridToTiles([
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const id = tiles[0].id;
    const res = slideTiles(tiles, 'right');
    expect(res.tiles[0].id).toBe(id);
    expect(res.tiles[0].c).toBe(3);
  });

  it('помечает выросшую плитку merged', () => {
    const res = slideTiles(
      gridToTiles([
        [2, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
    );
    expect(res.tiles).toHaveLength(1);
    expect(res.tiles[0]).toMatchObject({ value: 4, merged: true });
  });
});

describe('spawnInTiles', () => {
  it('согласован со спавном на числовом поле', () => {
    const grid: Grid = [
      [2, 4, 8, 16],
      [16, 8, 4, 2],
      [2, 4, 8, 16],
      [16, 8, 4, 0],
    ];
    const seq = [0, 0.5];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    const viaGrid = spawnTile(grid, rng);
    i = 0;
    const viaTiles = spawnInTiles(gridToTiles(grid), rng);
    expect(tilesToGrid(viaTiles.tiles)).toEqual(viaGrid.grid);
    expect(viaTiles.spawned).toMatchObject({ r: 3, c: 3, value: 2, isNew: true });
  });
});
