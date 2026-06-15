import { useEffect, useRef } from 'react';
import { BOARD_SIZE, type Direction } from '../../game/types';
import type { Tile as TileModel } from '../tiles';
import { Tile } from './Tile';

const SWIPE_THRESHOLD = 24; // px

interface BoardProps {
  tiles: TileModel[];
  onMove: (dir: Direction) => void;
}

export function Board({ tiles, onMove }: BoardProps) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const cells = Array.from({ length: BOARD_SIZE * BOARD_SIZE });

  // Стрелки — для удобной игры/теста на десктопе (DESIGN §3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        onMove(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMove]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!start.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    start.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) > Math.abs(dy)) onMove(dx > 0 ? 'right' : 'left');
    else onMove(dy > 0 ? 'down' : 'up');
  };

  return (
    <div
      className="no-touch-pan relative aspect-square w-full rounded-card bg-board p-2 shadow-soft"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Подложка из пустых ячеек */}
      <div className="grid h-full w-full grid-cols-4 grid-rows-4 gap-2">
        {cells.map((_, i) => (
          <div key={i} className="rounded-tile bg-cell" />
        ))}
      </div>
      {/* Слой плиток поверх подложки, та же сетка и зазоры */}
      <div className="absolute inset-2 grid grid-cols-4 grid-rows-4 gap-2">
        {tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}
