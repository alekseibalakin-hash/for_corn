// Чистые типы игрового ядра 2048. Никакого UI здесь нет (DESIGN §10).

/** Значение ячейки: 0 — пустая, иначе степень двойки. */
export type Cell = number;

/** Поле size×size (по умолчанию 4×4). Строки сверху вниз, колонки слева направо. */
export type Grid = Cell[][];

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Источник случайности — инъектируется ради детерминированных тестов. */
export type Rng = () => number;

/** Результат хода (без спавна новой плитки — спавн отдельным шагом). */
export interface MoveResult {
  grid: Grid;
  /** Изменилось ли поле (был ли реальный ход). */
  moved: boolean;
  /** Очки, набранные слияниями на этом ходу. */
  scoreGained: number;
  /** Значения плиток, родившихся в слияниях (для хаптики и подсветки). */
  mergedValues: number[];
}

export const BOARD_SIZE = 4;
export const WIN_TILE = 2048;
