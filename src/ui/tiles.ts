import { BOARD_SIZE, type Direction, type Grid, type Rng } from '../game/types';
import { createEmptyGrid } from '../game/grid';

/**
 * Слой анимации: плитки со стабильными id, чтобы Framer Motion анимировал
 * перемещение, а не перерисовывал поле. Числовое поле (src/game) остаётся
 * источником правды — tilesToGrid даёт его обратно, а тест сверяет slideTiles с move().
 */
export interface Tile {
  id: number;
  value: number;
  r: number;
  c: number;
  /** Эта плитка только что выросла в слиянии (для pop-анимации). */
  merged: boolean;
  /** Эта плитка только что заспавнилась. */
  isNew: boolean;
}

let idCounter = 1;
function nextId(): number {
  return idCounter++;
}

export function gridToTiles(grid: Grid): Tile[] {
  const tiles: Tile[] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== 0) tiles.push({ id: nextId(), value: grid[r][c], r, c, merged: false, isNew: false });
    }
  }
  return tiles;
}

export function tilesToGrid(tiles: Tile[], size: number = BOARD_SIZE): Grid {
  const grid = createEmptyGrid(size);
  for (const t of tiles) grid[t.r][t.c] = t.value;
  return grid;
}

/** Координаты ячейки по индексу линии и слоту (от стенки наружу) для направления. */
function place(dir: Direction, line: number, slot: number, size: number): { r: number; c: number } {
  switch (dir) {
    case 'left':
      return { r: line, c: slot };
    case 'right':
      return { r: line, c: size - 1 - slot };
    case 'up':
      return { r: slot, c: line };
    case 'down':
      return { r: size - 1 - slot, c: line };
  }
}

/** Индекс линии (строка/колонка) и позиция вдоль движения для плитки. */
function lineOf(dir: Direction, t: Tile, size: number): { line: number; order: number } {
  switch (dir) {
    case 'left':
      return { line: t.r, order: t.c };
    case 'right':
      return { line: t.r, order: size - 1 - t.c };
    case 'up':
      return { line: t.c, order: t.r };
    case 'down':
      return { line: t.c, order: size - 1 - t.r };
  }
}

export interface SlideTilesResult {
  tiles: Tile[];
  moved: boolean;
  scoreGained: number;
  mergedValues: number[];
}

/**
 * Сдвиг плиток в направлении с сохранением id у выживших. Логика слияния —
 * классическая 2048 (одно слияние на ход, слева направо/от стенки). «Проигравшая»
 * плитка слияния отбрасывается; выживший наследует id первой в порядке движения.
 */
export function slideTiles(tiles: Tile[], dir: Direction, size: number = BOARD_SIZE): SlideTilesResult {
  const lines = new Map<number, Tile[]>();
  for (const t of tiles) {
    const { line } = lineOf(dir, t, size);
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line)!.push(t);
  }

  const result: Tile[] = [];
  let scoreGained = 0;
  const mergedValues: number[] = [];
  let moved = false;

  for (const [line, lineTiles] of lines) {
    lineTiles.sort((a, b) => lineOf(dir, a, size).order - lineOf(dir, b, size).order);

    let slot = 0;
    for (let i = 0; i < lineTiles.length; i++) {
      const current = lineTiles[i];
      const next = lineTiles[i + 1];
      if (next && current.value === next.value) {
        const value = current.value * 2;
        const pos = place(dir, line, slot, size);
        result.push({ id: current.id, value, r: pos.r, c: pos.c, merged: true, isNew: false });
        scoreGained += value;
        mergedValues.push(value);
        moved = true;
        i++; // проигравшую плитку (next) отбрасываем
      } else {
        const pos = place(dir, line, slot, size);
        if (pos.r !== current.r || pos.c !== current.c) moved = true;
        result.push({ id: current.id, value: current.value, r: pos.r, c: pos.c, merged: false, isNew: false });
      }
      slot++;
    }
  }

  return { tiles: result, moved, scoreGained, mergedValues };
}

export interface SpawnTilesResult {
  tiles: Tile[];
  spawned: Tile | null;
}

/** Спавн новой плитки на свободную ячейку. Порядок rng: 1) ячейка, 2) значение. */
export function spawnInTiles(tiles: Tile[], rng: Rng = Math.random, size: number = BOARD_SIZE): SpawnTilesResult {
  const occupied = new Set(tiles.map((t) => t.r * size + t.c));
  const empties: { r: number; c: number }[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!occupied.has(r * size + c)) empties.push({ r, c });
    }
  }
  if (empties.length === 0) return { tiles, spawned: null };

  const idx = Math.min(Math.floor(rng() * empties.length), empties.length - 1);
  const cell = empties[idx];
  const value = rng() < 0.1 ? 4 : 2;
  const tile: Tile = { id: nextId(), value, r: cell.r, c: cell.c, merged: false, isNew: true };
  return { tiles: [...tiles, tile], spawned: tile };
}

/** Сброс флагов анимации (после того как pop/spawn отыграли). */
export function settleTiles(tiles: Tile[]): Tile[] {
  return tiles.map((t) => (t.merged || t.isNew ? { ...t, merged: false, isNew: false } : t));
}
