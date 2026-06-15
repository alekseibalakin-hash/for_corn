import { useEffect, useRef } from 'react';
import { BOARD_SIZE, type Direction } from '../../game/types';
import type { Tile as TileModel } from '../tiles';
import { Tile } from './Tile';

const SWIPE_THRESHOLD = 36; // px по ДОМИНИРУЮЩЕЙ оси
const SWIPE_RATIO = 1.6; // ось срабатывает, только если её смещение ≥1.6× другой (диагонали — игнор)

function resolveDir(dx: number, dy: number): Direction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay * SWIPE_RATIO && ax >= SWIPE_THRESHOLD) return dx > 0 ? 'right' : 'left';
  if (ay >= ax * SWIPE_RATIO && ay >= SWIPE_THRESHOLD) return dy > 0 ? 'down' : 'up';
  return null;
}

interface BoardProps {
  tiles: TileModel[];
  onMove: (dir: Direction) => void;
}

export function Board({ tiles, onMove }: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cells = Array.from({ length: BOARD_SIZE * BOARD_SIZE });

  // Стрелки — для удобной игры/теста на десктопе (DESIGN §3). Не трогаем.
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

  // Нативные тач-слушатели с { passive: false }: только так touchmove.preventDefault()
  // глушит остаточный нативный вертикальный жест Telegram. React onTouch* — passive.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        start.current = null; // мультитач — не свайп
        return;
      }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (start.current) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      start.current = null;
      const dir = resolveDir(dx, dy);
      if (dir) onMove(dir);
    };
    const onTouchCancel = () => {
      start.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [onMove]);

  return (
    <div ref={boardRef} className="no-touch-pan relative aspect-square w-full rounded-card bg-board p-2 shadow-soft">
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
