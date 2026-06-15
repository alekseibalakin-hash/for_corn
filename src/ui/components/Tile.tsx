import { motion } from 'framer-motion';
import type { Tile as TileModel } from '../tiles';

// Веер плиток строго по DESIGN §9. Инлайн-стили — чтобы Tailwind JIT не вырезал
// динамические классы по значению плитки.
const TILE_BG: Record<number, string> = {
  2: '#FAEEDA',
  4: '#FAC775',
  8: '#F5C4B3',
  16: '#F0997B',
  32: '#E8895E',
  64: '#D85A30',
  128: '#ED93B1',
  256: '#D4537E',
  512: '#993556',
};
const GOLD = '#854F0B'; // 1024+

function bgFor(value: number): string {
  return TILE_BG[value] ?? GOLD;
}
function colorFor(value: number): string {
  return value <= 8 ? '#5B4A42' : '#FBEAF0';
}
function fontClass(value: number): string {
  const len = String(value).length;
  if (len <= 2) return 'text-3xl sm:text-4xl';
  if (len === 3) return 'text-2xl sm:text-3xl';
  return 'text-xl sm:text-2xl';
}

export function Tile({ tile }: { tile: TileModel }) {
  return (
    <motion.div
      layout
      // Расстановка по сетке — позиция меняется → layout-анимация «проезда».
      style={{
        gridColumnStart: tile.c + 1,
        gridRowStart: tile.r + 1,
        backgroundColor: bgFor(tile.value),
        color: colorFor(tile.value),
      }}
      initial={tile.isNew ? { scale: 0, opacity: 0 } : false}
      animate={{ scale: tile.merged ? [1, 1.16, 1] : 1, opacity: 1 }}
      transition={{
        layout: { type: 'spring', stiffness: 700, damping: 42 },
        scale: { duration: 0.18, ease: 'easeOut' },
        opacity: { duration: 0.14 },
      }}
      className={`flex items-center justify-center rounded-tile font-extrabold shadow-tile select-none ${fontClass(
        tile.value,
      )}`}
    >
      {tile.value}
    </motion.div>
  );
}
