import { useEffect, useRef, useState } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { ArrowLeft, Gift, RotateCcw } from 'lucide-react';
import { useRewards } from '../../rewards';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { ExpiryBanner } from '../../ui/components/ExpiryBanner';
import { LoadingSplash } from '../../ui/components/LoadingSplash';
import { BUILD_TAG } from '../../ui/constants';
import { GRID_SIZE, type Cell, type Piece } from './logic';
import { useBlocks } from './useBlocks';

interface BlocksProps {
  onBack: () => void;
  onOpenWallet: () => void;
}

const SIZE = GRID_SIZE;
// Размер клетки фигуры в трее (px). Грид-клетка поля — динамическая (меряем rect); grab считаем В
// КЛЕТКАХ фигуры (floor(offset / TRAY_CELL)), что не зависит от масштаба поля. gap=0 в фигуре ⇒ шаг
// ровно TRAY_CELL (точная привязка хвата). Разделение клеток — внутренним отступом, не grid-gap.
const TRAY_CELL = 26;

// Тёплая палитра под подарок: блоки-цели — «карамель» (золото), обычные заполнения — «ягода».
const FILL_STYLE: React.CSSProperties = {
  background: 'linear-gradient(150deg, #FBC2D6 0%, #F48FB6 52%, #E86F9E 100%)',
  boxShadow: 'inset 0 2px 2px rgba(255,255,255,0.5), inset 0 -3px 5px rgba(180,70,110,0.35)',
};
const BLOCK_STYLE: React.CSSProperties = {
  background: 'radial-gradient(125% 125% at 32% 26%, #FDE7B0 0%, #F6C667 38%, #E8A23D 70%, #C9822B 100%)',
  boxShadow:
    'inset 0 2px 2px rgba(255,255,255,0.55), inset 0 -4px 6px rgba(150,95,30,0.45), inset 0 0 0 1px rgba(150,110,50,0.3), 0 2px 4px rgba(120,80,30,0.25)',
};

/** Проекция перетаскиваемой фигуры на поле: где она встанет + валидно ли. */
interface Projection {
  index: number;
  piece: Piece;
  anchorR: number;
  anchorC: number;
  valid: boolean;
}

/** Заполненная клетка поля (ягода/карамель), с лёгким появлением. Пустая — просто bg-cell. */
function BoardCell({ cell }: { cell: Cell }) {
  if (cell === 'empty') return <div className="rounded-tile bg-cell" />;
  return (
    <motion.div
      initial={{ scale: 0.7, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      className="rounded-tile"
      style={cell === 'block' ? BLOCK_STYLE : FILL_STYLE}
    >
      <div className="h-full w-full" />
    </motion.div>
  );
}

/** Фигура-полимино для трея/перетаскивания. gap:0, разделение — внутренним отступом (точная привязка хвата). */
function PieceShape({ piece, cell }: { piece: Piece; cell: number }) {
  const maxR = Math.max(...piece.cells.map((p) => p.r));
  const maxC = Math.max(...piece.cells.map((p) => p.c));
  const filled = new Set(piece.cells.map((p) => `${p.r}-${p.c}`));
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${maxC + 1}, ${cell}px)`,
        gridTemplateRows: `repeat(${maxR + 1}, ${cell}px)`,
      }}
    >
      {Array.from({ length: (maxR + 1) * (maxC + 1) }).map((_, i) => {
        const r = Math.floor(i / (maxC + 1));
        const c = i % (maxC + 1);
        return filled.has(`${r}-${c}`) ? (
          <div key={i} className="p-[1.5px]">
            <div className="h-full w-full rounded-[6px]" style={FILL_STYLE} />
          </div>
        ) : (
          <div key={i} />
        );
      })}
    </div>
  );
}

function BlocksGame({ onBack, onOpenWallet }: BlocksProps) {
  const rewards = useRewards();
  const bb = useBlocks();
  const now = Date.now();

  const gridRef = useRef<HTMLDivElement>(null);
  const pieceRefs = useRef<(HTMLDivElement | null)[]>([]);
  const grabRef = useRef<{ r: number; c: number }>({ r: 0, c: 0 });
  const draggingRef = useRef(false);
  const projectionRef = useRef<Projection | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Telegram: пока тащим — глушим вертикальный жест WebView (иначе мини-аппа сворачивается, как в
  // Board.tsx 2048 / Match3.tsx). Пассивный=false + preventDefault только во время перетаскивания.
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current) e.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, []);

  // Координата клетки поля под точкой (по rect базового грида; пропорция устойчива к gap, как в match3).
  const cellFromPoint = (x: number, y: number): { r: number; c: number } | null => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      r: Math.floor(((y - rect.top) / rect.height) * SIZE),
      c: Math.floor(((x - rect.left) / rect.width) * SIZE),
    };
  };

  const onPieceDragStart = (i: number, info: PanInfo) => {
    const piece = bb.tray[i];
    const el = pieceRefs.current[i];
    if (!piece || !el) return;
    const rect = el.getBoundingClientRect();
    const maxR = Math.max(...piece.cells.map((p) => p.r));
    const maxC = Math.max(...piece.cells.map((p) => p.c));
    const gr = Math.min(maxR, Math.max(0, Math.floor((info.point.y - rect.top) / TRAY_CELL)));
    const gc = Math.min(maxC, Math.max(0, Math.floor((info.point.x - rect.left) / TRAY_CELL)));
    grabRef.current = { r: gr, c: gc };
    draggingRef.current = true;
    setDraggingIndex(i);
  };

  const onPieceDrag = (i: number, info: PanInfo) => {
    const piece = bb.tray[i];
    if (!piece) return;
    const pointer = cellFromPoint(info.point.x, info.point.y);
    if (!pointer) return;
    const anchorR = pointer.r - grabRef.current.r;
    const anchorC = pointer.c - grabRef.current.c;
    const valid = bb.canPlaceAt(i, anchorR, anchorC);
    const proj: Projection = { index: i, piece, anchorR, anchorC, valid };
    projectionRef.current = proj;
    setProjection(proj);
  };

  const onPieceDragEnd = (i: number) => {
    const proj = projectionRef.current;
    draggingRef.current = false;
    projectionRef.current = null;
    setDraggingIndex(null);
    setProjection(null);
    // Валидная клетка → ставим (фигура уйдёт из трея). Иначе dragSnapToOrigin вернёт её на место.
    if (proj && proj.index === i && proj.valid) bb.placePiece(i, proj.anchorR, proj.anchorC);
  };

  if (bb.loading) return <LoadingSplash />;

  const fxCleared = bb.fx?.cleared ?? [];
  const overlayBlocked = bb.status !== 'playing' || !!bb.resumeChoice || bb.confirmRestart;
  const pct = bb.goal && bb.goal.target > 0 ? Math.min(100, (bb.progress / bb.goal.target) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-3 px-4 py-4">
      {/* Шапка: назад + кошелёк (как в match3). */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          aria-label="В меню хаба"
          className="flex items-center gap-1.5 rounded-card bg-white/70 px-3 py-2 text-sm font-bold text-ink shadow-soft active:scale-95 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Меню
        </button>
        <button
          onClick={onOpenWallet}
          aria-label="Кошелёк наград"
          className="relative shrink-0 rounded-card bg-white/70 p-2.5 text-primary shadow-soft active:scale-95 transition"
        >
          <Gift className="h-6 w-6" />
          {rewards.wallet.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-white">
              {rewards.wallet.length}
            </span>
          )}
        </button>
      </div>

      <ExpiryBanner reminder={rewards.reminder} now={now} onDismiss={rewards.dismissReminder} />

      {/* HUD: уровень / блоков осталось / наборов осталось + растущая шкала прогресса + «Заново». */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="rounded-card bg-board px-4 py-1.5 text-center">
            <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">Уровень</div>
            <div className="text-lg font-extrabold leading-tight text-ink">{bb.level}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-card bg-board px-3 py-1.5">
              <span className="text-base leading-none">🧩</span>
              <span className="text-lg font-extrabold leading-tight text-ink">{bb.blocksLeft}</span>
            </div>
            <div className="rounded-card bg-primary/10 px-3 py-1.5 text-center text-primary">
              <div className="text-[0.65rem] font-bold uppercase tracking-wide">Наборов</div>
              <div className="text-lg font-extrabold leading-tight">{bb.setsLeft}</div>
            </div>
            <button
              onClick={bb.requestRestart}
              disabled={bb.busy}
              aria-label="Начать уровень заново"
              className="flex items-center justify-center rounded-card bg-white/70 p-2.5 text-ink shadow-soft active:scale-95 transition disabled:opacity-50"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
          </div>
        </div>
        {/* Растущая шкала расчистки (без обратного отсчёта/таймера — без давления). */}
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-board">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', stiffness: 220, damping: 30 }}
          />
        </div>
      </div>

      {/* Поле 8×8: базовый грид (геометрия/арт) + слой проекции + слой искр + вспышка. */}
      <div className="relative mt-1 aspect-square w-full rounded-card bg-board p-2 shadow-soft">
        <div ref={gridRef} className="grid h-full w-full grid-cols-8 grid-rows-8 gap-1">
          {bb.grid.map((row, r) =>
            row.map((cell, c) => <BoardCell key={`${r}-${c}`} cell={cell} />),
          )}
        </div>

        {/* ПРОЕКЦИЯ: куда встанет фигура (зелёная — валидно, красноватая — нет). Источник правды при drag. */}
        {projection && (
          <div className="pointer-events-none absolute inset-2 grid grid-cols-8 grid-rows-8 gap-1">
            {projection.piece.cells.map((cellOff, k) => {
              const r = projection.anchorR + cellOff.r;
              const c = projection.anchorC + cellOff.c;
              if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
              return (
                <div
                  key={k}
                  style={{ gridColumnStart: c + 1, gridRowStart: r + 1 }}
                  className={`rounded-tile ring-2 ${
                    projection.valid ? 'bg-primary/40 ring-primary' : 'bg-rose-300/25 ring-rose-300/60'
                  }`}
                />
              );
            })}
          </div>
        )}

        {/* ИСКРЫ на сожжённых клетках (поверх; не подмена движения). */}
        <div className="pointer-events-none absolute inset-2 grid grid-cols-8 grid-rows-8 gap-1">
          {fxCleared.map((cell) => (
            <motion.div
              key={`fx-${cell.r}-${cell.c}`}
              style={{ gridColumnStart: cell.c + 1, gridRowStart: cell.r + 1 }}
              initial={{ scale: 0.6, opacity: 0.9 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 0.32, ease: 'easeOut' }}
              className="flex items-center justify-center"
            >
              <span className="h-2/3 w-2/3 rounded-full bg-white/80" />
            </motion.div>
          ))}
        </div>

        {/* ВСПЫШКА на крупном клире/победе: разовый белый «бумц», keyed по flash → ремоунт = реплей. */}
        {bb.flash > 0 && (
          <motion.div
            key={bb.flash}
            className="pointer-events-none absolute inset-0 rounded-card bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.5, 0] }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </div>

      {/* ТРЕЙ: 3 фигуры. Перетаскиваем на поле (Framer drag); невалид — dragSnapToOrigin вернёт назад. */}
      <div className="mt-1 flex items-stretch justify-around gap-2 rounded-card bg-board/60 px-2 py-3" style={{ minHeight: TRAY_CELL * 3 }}>
        {bb.tray.map((piece, i) => (
          <div key={i} className="flex flex-1 items-center justify-center">
            {piece && !overlayBlocked && (
              <motion.div
                ref={(el) => (pieceRefs.current[i] = el)}
                drag
                dragSnapToOrigin
                dragMomentum={false}
                dragElastic={0.12}
                whileDrag={{ scale: 1.06 }}
                onDragStart={(_e, info) => onPieceDragStart(i, info)}
                onDrag={(_e, info) => onPieceDrag(i, info)}
                onDragEnd={() => onPieceDragEnd(i)}
                className="cursor-grab touch-none active:cursor-grabbing"
                style={{ touchAction: 'none', position: 'relative', zIndex: draggingIndex === i ? 50 : 1 }}
              >
                <PieceShape piece={piece} cell={TRAY_CELL} />
              </motion.div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-1 text-center text-xs font-semibold text-muted">
        Перетаскивай фигуры на поле — заполняй ряды и столбцы, чтобы расчистить блоки ❤️
      </p>
      <p className="text-center text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>

      {/* ОВЕРЛЕИ. Доброта: победа → дальше; проигрыш → мягкое «ещё разок» (глубина не теряется); вход
          → продолжить/заново; «Заново» из HUD → подтверждение. */}
      <ConfirmDialog
        show={bb.status === 'won'}
        title={`Уровень ${bb.level} пройден! 🎉`}
        message="Все блоки расчищены 💛 Глубина растёт — впереди уровень посложнее. Продолжим?"
        confirmLabel="Дальше ▶"
        cancelLabel="В меню"
        onConfirm={bb.nextLevel}
        onCancel={onBack}
      />
      <ConfirmDialog
        show={bb.status === 'lost'}
        title="Почти получилось 💛"
        message="Наборы фигур закончились совсем чуть-чуть не дотянув. Ничего страшного — давай ещё разок 🧩"
        confirmLabel="Ещё разок"
        cancelLabel="В меню"
        onConfirm={bb.retryLevel}
        onCancel={onBack}
      />
      <ConfirmDialog
        show={!!bb.resumeChoice}
        title={`Продолжить уровень ${bb.resumeChoice?.level ?? ''}?`}
        message="Ты остановилась на середине. Продолжить с того же места или начать этот уровень заново?"
        confirmLabel="Продолжить"
        cancelLabel="Начать заново"
        onConfirm={bb.resumeLevel}
        onCancel={bb.restartLevel}
      />
      <ConfirmDialog
        show={bb.confirmRestart}
        title="Начать уровень заново?"
        message="Текущая раскладка сбросится. Глубина и награды останутся при тебе."
        confirmLabel="Заново"
        cancelLabel="Продолжить"
        onConfirm={bb.confirmRestartLevel}
        onCancel={bb.cancelRestart}
      />
    </div>
  );
}

/**
 * Экран «Блоки-фигуры» — грузится ЛЕНИВО (отдельный чанк), как Match3/Game2048. Один поуровневый
 * режим (без релакса в MVP, DESIGN-BLOCKS §0). Кошелёк/раскрытия/победный баннер — из общего
 * наградного слоя (живут в App). key стабилен ⇒ один маунт хука на весь экран.
 */
export default function Blocks({ onBack, onOpenWallet }: BlocksProps) {
  return <BlocksGame onBack={onBack} onOpenWallet={onOpenWallet} />;
}
