import { describe, expect, it } from 'vitest';
import { hasMoves, hasReached, isGameOver } from './status';
import type { Grid } from './types';

describe('hasMoves', () => {
  it('true, если есть пустая ячейка', () => {
    const grid: Grid = [
      [2, 4, 8, 16],
      [16, 8, 4, 2],
      [2, 4, 8, 16],
      [16, 8, 4, 0],
    ];
    expect(hasMoves(grid)).toBe(true);
  });

  it('true, если есть соседи-близнецы по горизонтали', () => {
    const grid: Grid = [
      [2, 2, 8, 16],
      [16, 8, 4, 2],
      [2, 4, 8, 16],
      [16, 8, 4, 2],
    ];
    expect(hasMoves(grid)).toBe(true);
  });

  it('true, если есть соседи-близнецы по вертикали', () => {
    const grid: Grid = [
      [2, 4, 8, 16],
      [2, 8, 4, 2],
      [16, 4, 8, 16],
      [8, 2, 4, 2],
    ];
    expect(hasMoves(grid)).toBe(true);
  });

  it('false на полном поле без пар (тупик)', () => {
    const grid: Grid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ];
    expect(hasMoves(grid)).toBe(false);
    expect(isGameOver(grid)).toBe(true);
  });
});

describe('hasReached', () => {
  it('распознаёт достижение 2048', () => {
    const grid: Grid = [
      [2048, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(hasReached(grid)).toBe(true);
    expect(hasReached(grid, 4096)).toBe(false);
  });
});
