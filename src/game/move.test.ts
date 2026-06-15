import { describe, expect, it } from 'vitest';
import { move, slideRowLeft } from './move';
import type { Grid } from './types';

describe('slideRowLeft', () => {
  it('сдвигает плитки к левому краю', () => {
    expect(slideRowLeft([0, 2, 0, 4]).row).toEqual([2, 4, 0, 0]);
  });

  it('сливает две равные в одну и начисляет очки', () => {
    const r = slideRowLeft([2, 2, 0, 0]);
    expect(r.row).toEqual([4, 0, 0, 0]);
    expect(r.scoreGained).toBe(4);
    expect(r.merged).toEqual([4]);
  });

  it('не делает цепную реакцию: 2 2 2 2 → 4 4, а не 8', () => {
    const r = slideRowLeft([2, 2, 2, 2]);
    expect(r.row).toEqual([4, 4, 0, 0]);
    expect(r.scoreGained).toBe(8);
    expect(r.merged).toEqual([4, 4]);
  });

  it('сливает только крайнюю слева пару: 4 4 2 → 8 2', () => {
    const r = slideRowLeft([4, 4, 2, 0]);
    expect(r.row).toEqual([8, 2, 0, 0]);
    expect(r.scoreGained).toBe(8);
  });

  it('не сливает разные плитки: 2 4 2 → 2 4 2', () => {
    const r = slideRowLeft([2, 4, 2, 0]);
    expect(r.row).toEqual([2, 4, 2, 0]);
    expect(r.scoreGained).toBe(0);
    expect(r.merged).toEqual([]);
  });

  it('сохраняет тройку как пара+одиночка: 2 2 2 → 4 2', () => {
    expect(slideRowLeft([2, 2, 2, 0]).row).toEqual([4, 2, 0, 0]);
  });
});

describe('move', () => {
  it('влево — сдвигает и сливает по строкам', () => {
    const grid: Grid = [
      [2, 2, 0, 0],
      [0, 4, 4, 0],
      [0, 0, 0, 2],
      [8, 0, 8, 0],
    ];
    const res = move(grid, 'left');
    expect(res.grid).toEqual([
      [4, 0, 0, 0],
      [8, 0, 0, 0],
      [2, 0, 0, 0],
      [16, 0, 0, 0],
    ]);
    expect(res.scoreGained).toBe(4 + 8 + 16);
    expect(res.moved).toBe(true);
  });

  it('вправо — сдвигает к правому краю', () => {
    const grid: Grid = [
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const res = move(grid, 'right');
    expect(res.grid[0]).toEqual([0, 0, 0, 4]);
  });

  it('вверх — сливает по колонкам', () => {
    const grid: Grid = [
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [4, 0, 0, 0],
      [4, 0, 0, 0],
    ];
    const res = move(grid, 'up');
    expect(res.grid.map((row) => row[0])).toEqual([4, 8, 0, 0]);
  });

  it('вниз — сливает по колонкам к низу', () => {
    const grid: Grid = [
      [4, 0, 0, 0],
      [4, 0, 0, 0],
      [2, 0, 0, 0],
      [2, 0, 0, 0],
    ];
    const res = move(grid, 'down');
    expect(res.grid.map((row) => row[0])).toEqual([0, 0, 8, 4]);
  });

  it('moved=false, когда ход ничего не меняет', () => {
    const grid: Grid = [
      [2, 4, 8, 16],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const res = move(grid, 'left');
    expect(res.moved).toBe(false);
    expect(res.scoreGained).toBe(0);
  });

  it('не мутирует исходное поле', () => {
    const grid: Grid = [
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const snapshot = JSON.stringify(grid);
    move(grid, 'left');
    expect(JSON.stringify(grid)).toBe(snapshot);
  });
});
