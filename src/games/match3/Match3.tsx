import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { ArrowLeft, Gift, RotateCcw, Trophy } from 'lucide-react';
import { useRewards } from '../../rewards';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { ExpiryBanner } from '../../ui/components/ExpiryBanner';
import { LoadingSplash } from '../../ui/components/LoadingSplash';
import { BUILD_TAG } from '../../ui/constants';
import { isStatic, SIZE, type Coord, type Special } from './logic';
import { type VisualGem } from './gems';
import { normalizeM3Stats } from './stats';
import { useMatch3, type Match3Mode } from './useMatch3';

interface Match3Props {
  onBack: () => void;
  onOpenWallet: () => void;
}

interface Match3GameProps extends Match3Props {
  mode: Match3Mode;
  /** Выход к экрану выбора режима (setMode(null) во внешнем Match3). */
  onExitToModes: () => void;
}

function getRoomParam(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('room');
  } catch {
    return null;
  }
}

/** Эмодзи-арт фишек (DESIGN-HUB §6 — «эмодзи», без спрайтов). Индекс = тип фишки. */
const GEM_EMOJI = ['🍓', '🫐', '🍋', '🍇', '🌸', '💗'];

// Порог/коэффициент свайпа фишки к соседу (мельче, чем доска 2048 — клетки меньше).
const SWIPE_THRESHOLD = 16;
const SWIPE_RATIO = 1.3;

type Dir = 'up' | 'down' | 'left' | 'right';
function resolveDir(dx: number, dy: number): Dir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay * SWIPE_RATIO && ax >= SWIPE_THRESHOLD) return dx > 0 ? 'right' : 'left';
  if (ay >= ax * SWIPE_RATIO && ay >= SWIPE_THRESHOLD) return dy > 0 ? 'down' : 'up';
  return null;
}

/** Декор спецфишки поверх эмодзи (свечение/рамка/значок) — отличает её от обычной. */
function specialClasses(special: Special | undefined): string {
  switch (special) {
    case 'line':
      return 'ring-2 ring-white shadow-[0_0_12px_2px_rgba(255,255,255,0.9)]';
    case 'bomb':
      return 'ring-2 ring-ink/70 shadow-[0_0_12px_2px_rgba(91,74,66,0.6)]';
    case 'colorBomb':
      return 'ring-2 ring-primary shadow-[0_0_14px_3px_rgba(212,83,126,0.8)]';
    default:
      return '';
  }
}
function specialBadge(special: Special | undefined): string | null {
  switch (special) {
    case 'line':
      return '✦';
    case 'bomb':
      return '💣';
    case 'colorBomb':
      return '✨';
    default:
      return null;
  }
}

/**
 * Фишка как падающий элемент (зеркало Tile.tsx 2048): анимируем ТОЛЬКО transform/opacity.
 *  - `layout` + позиция через gridColumn/Row-Start → смена (r,c) при гравитации = плавный слайд;
 *  - isNew (рефилл) влетает сверху (y:-110% → 0); justMade (создан спец) — РАЗОВЫЙ pop (без вечного пульса);
 *  - спецфишку отличает СТАТИЧНЫЙ glow/значок (specialClasses), не анимация.
 * Ключ в списке — ТОЛЬКО g.id (никаких value-key): иначе смена типа ремоунтила бы и падение не сыграло.
 * БЕЗ AnimatePresence/exit (как Board.tsx/Tile.tsx 2048): очищенные гемы просто демонтируются
 * (искру даёт FX-слой). Exit+layout в гриде оставлял «призраков» в DOM → джиттер/рост узлов.
 */
function GemCell({ gem, selected }: { gem: VisualGem; selected: boolean }) {
  const badge = specialBadge(gem.special);
  // Лёд (Комнаты, Фаза 1): фишка заморожена — статичный морозный слой ПОВЕРХ (без пульса), при
  // оттаивании просто исчезает и фишка оживает (id сохранён ⇒ layout-падение плавное).
  const frozen = !!gem.ice && gem.ice > 0;
  return (
    <motion.div
      layout
      style={{ gridColumnStart: gem.c + 1, gridRowStart: gem.r + 1 }}
      initial={gem.isNew ? { y: '-110%', opacity: 0 } : false}
      animate={{ y: 0, opacity: 1, scale: gem.justMade ? [1, 1.18, 1] : 1 }}
      transition={{
        layout: { type: 'spring', stiffness: 700, damping: 42 },
        default: { duration: 0.16 },
        scale: { duration: 0.18, ease: 'easeOut' },
      }}
      className={`relative flex items-center justify-center rounded-tile bg-cell text-[1.45rem] leading-none ${
        selected && !frozen ? 'ring-2 ring-primary bg-primary/15' : ''
      } ${specialClasses(gem.special)}`}
    >
      <span
        className="select-none"
        style={frozen ? { filter: 'blur(0.6px) saturate(0.8) brightness(1.04)' } : undefined}
      >
        {GEM_EMOJI[gem.type] ?? '❔'}
      </span>
      {badge && !frozen && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 text-[0.65rem] drop-shadow">{badge}</span>
      )}
      {frozen && <IceOverlay />}
    </motion.div>
  );
}

/**
 * Лёд (Комнаты, Фаза 1): фишка ВМОРОЖЕНА в матовое стекло на всю ячейку — гем виден сквозь иней
 * (размыт+подсинён), а не «снежинка-символ». Лёгкое 3D-залезание за край ячейки (inset -2px в зазор)
 * + глянцевые блики и морозная кромка. При оттаивании слой просто исчезает, гем оживает (id сохранён).
 */
function IceOverlay() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-[-2px] overflow-hidden rounded-tile"
      style={{
        background:
          'linear-gradient(150deg, rgba(233,247,255,0.66) 0%, rgba(189,227,248,0.42) 44%, rgba(151,201,235,0.56) 100%)',
        boxShadow:
          'inset 0 0 0 1.5px rgba(255,255,255,0.82), inset 0 4px 7px rgba(255,255,255,0.5), inset 0 -5px 9px rgba(86,150,198,0.4), 0 2px 4px rgba(80,140,190,0.28)',
        backdropFilter: 'blur(1px)',
        WebkitBackdropFilter: 'blur(1px)',
      }}
    >
      {/* диагональный глянцевый блик */}
      <span className="absolute -left-[8%] top-[6%] h-[44%] w-[34%] -rotate-[28deg] rounded-full bg-white/60 blur-[3px]" />
      {/* мелкий нижний блик-кристалл */}
      <span className="absolute bottom-[12%] right-[14%] h-[16%] w-[16%] rounded-full bg-white/45 blur-[2px]" />
    </span>
  );
}

/**
 * Блок (Комнаты, Фаза 1): неподвижный КАМЕНЬ на всю ячейку (тёплый серо-коричневый под палитру
 * подарка), куполообразный (радиальный градиент + бевел-тени), с лёгким 3D-залезанием за край.
 * Не фишка → рендерится отдельным статичным слоем (без id, не падает).
 */
function BlockCell({ r, c }: { r: number; c: number }) {
  return (
    <div style={{ gridColumnStart: c + 1, gridRowStart: r + 1 }} className="relative">
      <div
        aria-hidden
        className="absolute inset-[-2px] overflow-hidden rounded-tile"
        style={{
          background:
            'radial-gradient(125% 125% at 32% 26%, #cabfb3 0%, #ab9e90 38%, #897c6e 68%, #6b5f54 100%)',
          boxShadow:
            'inset 0 2px 2px rgba(255,255,255,0.42), inset 0 -4px 6px rgba(58,48,40,0.45), inset 0 0 0 1px rgba(80,68,58,0.3), 0 3px 5px rgba(60,48,38,0.3)',
        }}
      >
        {/* мягкая фактура камня: верхний блик (свет) + нижне-правое затенение — без резких точек */}
        <span className="absolute left-[14%] top-[12%] h-[32%] w-[40%] rounded-full bg-white/22 blur-[4px]" />
        <span className="absolute bottom-[14%] right-[16%] h-[36%] w-[42%] rounded-full bg-black/10 blur-[5px]" />
      </div>
    </div>
  );
}

/**
 * Экран Match-3 (Фаза B) — грузится ЛЕНИВО (отдельный чанк), как Game2048. Управление: СВАЙП
 * фишки к соседу (нативные тач-слушатели {passive:false} + preventDefault — наследует фикс 2048,
 * чтобы окно Telegram не сворачивалось) ИЛИ тап-выбор → тап-сосед. Кошелёк/раскрытия/стрик —
 * из общего наградного слоя. Общие оверлеи (Wallet/Reveal/Victory/Onboarding) живут в App.
 */
function Match3Game({ mode, onBack, onOpenWallet, onExitToModes }: Match3GameProps) {
  const rewards = useRewards();
  const m3 = useMatch3(mode);
  const now = Date.now();

  const gridRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number; cell: Coord } | null>(null);
  const mouseStart = useRef<{ x: number; y: number; cell: Coord } | null>(null);
  const suppressClick = useRef(false);
  const [selected, setSelected] = useState<Coord | null>(null);
  const boardControls = useAnimationControls();

  // Сброс выбора, когда идёт анимация хода (или партия сменилась).
  useEffect(() => {
    if (m3.busy) setSelected(null);
  }, [m3.busy]);

  // «Бумц» поля на крупном клире (≥20 фишек за шаг): короткий scale-пульс (transform-only),
  // запускается по смене счётчика m3.flash. Вспышка-белая — отдельным keyed-оверлеем ниже.
  useEffect(() => {
    if (m3.flash > 0) {
      void boardControls.start({ scale: [1, 1.04, 1], transition: { duration: 0.45, ease: 'easeOut' } });
    }
  }, [m3.flash, boardControls]);

  // Координаты ячейки из точки экрана (по rect слоя фишек).
  const cellFromPoint = (clientX: number, clientY: number): Coord | null => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const c = Math.floor(((clientX - rect.left) / rect.width) * SIZE);
    const r = Math.floor(((clientY - rect.top) / rect.height) * SIZE);
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
    return { r, c };
  };

  // Нативные тач-слушатели с {passive:false}: preventDefault на touchmove глушит остаточный
  // вертикальный жест Telegram (как в Board.tsx 2048 — иначе мини-аппа сворачивается).
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      m3.notifyActivity(); // любой контакт — сбрасываем подсказку и таймер простоя
      if (e.touches.length > 1) {
        touchStart.current = null;
        return;
      }
      const t = e.touches[0];
      const cell = cellFromPoint(t.clientX, t.clientY);
      touchStart.current = cell ? { x: t.clientX, y: t.clientY, cell } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (touchStart.current) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      // Гасим синтезированный mouse/click после тача: иначе тап-выбор сработал бы дважды
      // (touchend → handleTap И эмулированный click → onClick ячейки). Слушатель passive:false.
      e.preventDefault();
      const t = e.changedTouches[0];
      const dir = resolveDir(t.clientX - start.x, t.clientY - start.y);
      if (dir) {
        setSelected(null);
        m3.swapDir(start.cell, dir);
      } else {
        // Тап без свайпа — выбор/своп по выбору.
        handleTap(start.cell);
      }
    };
    const onCancel = () => {
      touchStart.current = null;
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onCancel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m3.swapDir, selected, m3.busy]);

  // Тап-выбор: тап по СПЕЦфишке → детонация на месте (Candy Crush); тап обычной → выделить;
  // тап соседа → своп; тап той же → снять выбор.
  const handleTap = (cell: Coord) => {
    if (m3.busy) return;
    // Обстакл (блок/замороженная фишка) не выбирается и не детонирует (Комнаты, Фаза 1).
    if (isStatic(cell.r, cell.c, m3.obstacles)) return;
    // Тап по спецфишке = активация на месте (даже когда что-то уже выделено: спец «главнее»).
    if (m3.board[cell.r]?.[cell.c]?.special) {
      setSelected(null);
      m3.activateAt(cell);
      return;
    }
    const sel = selected;
    if (!sel) {
      setSelected(cell);
      return;
    }
    if (sel.r === cell.r && sel.c === cell.c) {
      setSelected(null);
      return;
    }
    const adjacent = Math.abs(sel.r - cell.r) + Math.abs(sel.c - cell.c) === 1;
    if (adjacent) {
      setSelected(null);
      m3.swap(sel, cell);
    } else {
      setSelected(cell);
    }
  };

  // Мышь (десктоп): drag-свайп; короткий клик → тап-выбор (через onClick ячейки).
  const onMouseDown = (e: React.MouseEvent) => {
    m3.notifyActivity(); // любое действие мышью — сбрасываем подсказку и таймер простоя
    // Сбрасываем флаг в начале каждого взаимодействия: drag, завершившийся click'ом по общему
    // предку (а не по кнопке-ячейке), мог не сбросить его → следующий тап «проглотился» бы.
    suppressClick.current = false;
    const cell = cellFromPoint(e.clientX, e.clientY);
    mouseStart.current = cell ? { x: e.clientX, y: e.clientY, cell } : null;
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const start = mouseStart.current;
    mouseStart.current = null;
    if (!start) return;
    const dir = resolveDir(e.clientX - start.x, e.clientY - start.y);
    if (dir) {
      suppressClick.current = true;
      setSelected(null);
      m3.swapDir(start.cell, dir);
    }
  };
  // Клик по контейнеру (гемы pointer-events-none → ввод идёт сюда): тап-выбор/тап-детонация по rect.
  const onContainerClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell) handleTap(cell);
  };

  if (m3.loading) return <LoadingSplash />;

  const fxCleared = m3.fx?.cleared ?? [];
  const fxDetonated = m3.fx?.detonated ?? [];
  // Координаты блок-клеток (статичный слой). В эндлессе матрица пустая ⇒ список пуст.
  const blockCells: Coord[] = [];
  m3.obstacles.blocks.forEach((row, r) => row.forEach((b, c) => b && blockCells.push({ r, c })));

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-3 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={mode === 'spicy' ? onExitToModes : onBack}
          aria-label={mode === 'spicy' ? 'К выбору режима' : 'В меню хаба'}
          className="flex items-center gap-1.5 rounded-card bg-white/70 px-3 py-2 text-sm font-bold text-ink shadow-soft active:scale-95 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          {mode === 'spicy' ? 'Режимы' : 'Меню'}
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

      {/* Счёт/лучший/новая игра (лайт) ИЛИ HUD уровня (перчинка). Лайт-ветка — без изменений. */}
      {m3.mode === 'spicy' ? (
        <SpicyHud level={m3.level} movesLeft={m3.movesLeft} progress={m3.goalProgress} target={m3.goal?.target ?? 0} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-card bg-board px-4 py-1.5 text-center">
              <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">Очки</div>
              <div className="text-lg font-extrabold leading-tight text-ink">{m3.score}</div>
            </div>
            <div className="rounded-card bg-board px-4 py-1.5 text-center">
              <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">Лучший</div>
              <div className="text-lg font-extrabold leading-tight text-ink">{m3.bestScore}</div>
            </div>
            {rewards.dailyStreak > 1 && (
              <div className="flex items-center gap-1 rounded-card bg-primary/10 px-3 py-1.5 text-primary">
                <Trophy className="h-4 w-4" />
                <span className="text-sm font-extrabold">{rewards.dailyStreak} дн</span>
              </div>
            )}
          </div>
          <button
            onClick={m3.requestNewGame}
            disabled={m3.busy}
            className="flex items-center gap-1.5 rounded-card bg-primary px-3.5 py-2 text-sm font-bold text-white shadow-soft active:scale-95 transition disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Новая
          </button>
        </div>
      )}

      {/* Поле 8×8 — двухслойный рендер (как Board.tsx 2048): статичная подложка + падающие гемы.
          motion.div + boardControls — «бумц» поля (scale) на крупном клире, transform-only. */}
      <motion.div
        animate={boardControls}
        className="no-touch-pan relative mt-1 aspect-square w-full rounded-card bg-board p-2 shadow-soft"
      >
        {/* ПОДЛОЖКА: 64 пустых ячейки («дыры» при падении) + геометрия/ввод (gridRef → cellFromPoint). */}
        <div
          ref={gridRef}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onClick={onContainerClick}
          className="grid h-full w-full grid-cols-8 grid-rows-8 gap-1"
        >
          {Array.from({ length: SIZE * SIZE }).map((_, i) => (
            <div key={i} className="rounded-tile bg-cell" />
          ))}
        </div>

        {/* СЛОЙ БЛОКОВ: неподвижные клетки-разделители (Комнаты, Фаза 1) — статичны, pointer-events-none.
            В эндлессе блоков нет ⇒ слой пуст и невидим (нулевая регрессия). */}
        {blockCells.length > 0 && (
          <div className="pointer-events-none absolute inset-2 grid grid-cols-8 grid-rows-8 gap-1">
            {blockCells.map(({ r, c }) => (
              <BlockCell key={`blk-${r}-${c}`} r={r} c={c} />
            ))}
          </div>
        )}

        {/* СЛОЙ ГЕМОВ: настоящее падение (layout по стабильному id). pointer-events-none → ввод в подложку. */}
        <div className="pointer-events-none absolute inset-2 grid grid-cols-8 grid-rows-8 gap-1">
          {m3.gems.map((g) => (
            <GemCell key={g.id} gem={g} selected={!!selected && selected.r === g.r && selected.c === g.c} />
          ))}
        </div>

        {/* ПОДСКАЗКА: при простое мягко пульсируем ОДНУ валидную пару (без давления). Только !busy
            и не во время диалога «Новая игра»/оверлеев перчинки (иначе пульс мигал бы под модалкой). */}
        {!m3.busy && !m3.confirmNewGame && m3.hint && !(m3.mode === 'spicy' && (m3.status !== 'playing' || m3.resumeChoice)) && (
          <div className="pointer-events-none absolute inset-2 grid grid-cols-8 grid-rows-8 gap-1">
            {m3.hint.map((cell, i) => (
              <motion.div
                key={`hint-${i}`}
                style={{ gridColumnStart: cell.c + 1, gridRowStart: cell.r + 1 }}
                initial={{ opacity: 0.3 }}
                animate={{ opacity: [0.3, 0.75, 0.3], scale: [1, 1.06, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                className="rounded-tile ring-2 ring-primary/70"
              />
            ))}
          </div>
        )}

        {/* FX-слой: искры/💥 ПОВЕРХ настоящего падения (не подмена движения). */}
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
          {fxDetonated.map((cell) => (
            <motion.div
              key={`burst-${cell.r}-${cell.c}`}
              style={{ gridColumnStart: cell.c + 1, gridRowStart: cell.r + 1 }}
              initial={{ scale: 0.5, opacity: 1 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="flex items-center justify-center text-lg"
            >
              💥
            </motion.div>
          ))}
        </div>

        {/* ВСПЫШКА на крупном клире: разовый белый «бумц» (opacity), keyed по m3.flash → ремоунт = реплей. */}
        {m3.flash > 0 && (
          <motion.div
            key={m3.flash}
            className="pointer-events-none absolute inset-0 rounded-card bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.55, 0] }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </motion.div>

      <p className="mt-1 text-center text-xs font-semibold text-muted">
        Свайпай фишку к соседу (или тапни две) — собирай тройки и спецфишки ❤️
      </p>
      <p className="text-center text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>

      <ConfirmDialog
        show={m3.confirmNewGame}
        title="Начать новую игру?"
        message="Текущая партия завершится, очки уйдут в общий счёт."
        confirmLabel="Поехали"
        cancelLabel="Продолжить"
        onConfirm={m3.startNewGame}
        onCancel={m3.cancelNewGame}
      />

      {/* ОВЕРЛЕИ «С ПЕРЧИНКОЙ» (реюз ConfirmDialog). Доброта: победа → дальше; проигрыш → мягкое
          «ещё разок» (глубина не теряется, бесконечные ретраи); вход → продолжить/заново. */}
      <ConfirmDialog
        show={m3.mode === 'spicy' && m3.status === 'won'}
        title={`Уровень ${m3.level} пройден! 🎉`}
        message="Весь лёд растаял 💛 Глубина растёт — впереди новый ледок. Продолжим?"
        confirmLabel="Дальше ▶"
        cancelLabel="В меню"
        onConfirm={m3.nextLevel}
        onCancel={onExitToModes}
      />
      <ConfirmDialog
        show={m3.mode === 'spicy' && m3.status === 'lost'}
        title="Почти получилось 💛"
        message="Ходы кончились совсем чуть-чуть не дотянув. Ничего страшного — давай ещё разок 🌶️"
        confirmLabel="Ещё разок"
        cancelLabel="В меню"
        onConfirm={m3.retryLevel}
        onCancel={onExitToModes}
      />
      <ConfirmDialog
        show={m3.mode === 'spicy' && !!m3.resumeChoice}
        title={`Продолжить уровень ${m3.resumeChoice?.level ?? ''}?`}
        message="Ты остановилась на середине. Продолжить с того же места или начать этот уровень заново?"
        confirmLabel="Продолжить"
        cancelLabel="Начать заново"
        onConfirm={m3.resumeLevel}
        onCancel={m3.restartLevel}
      />
    </div>
  );
}

/**
 * HUD режима «с перчинкой» (бриф §4): «Уровень N», РАСТУЩИЙ прогресс-бар цели (без обратного отсчёта),
 * счётчик оставшихся ходов (без таймера). Никакого давления — только мягкая обратная связь.
 */
function SpicyHud({ level, movesLeft, progress, target }: { level: number; movesLeft: number; progress: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (progress / target) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="rounded-card bg-board px-4 py-1.5 text-center">
          <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">Уровень</div>
          <div className="text-lg font-extrabold leading-tight text-ink">{level}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-card bg-board px-3 py-1.5">
            <span className="text-base leading-none">🧊</span>
            <span className="text-lg font-extrabold leading-tight text-ink">
              {progress}
              <span className="text-sm text-muted">/{target}</span>
            </span>
          </div>
          <div className="rounded-card bg-primary/10 px-3 py-1.5 text-center text-primary">
            <div className="text-[0.65rem] font-bold uppercase tracking-wide">Ходов</div>
            <div className="text-lg font-extrabold leading-tight">{movesLeft}</div>
          </div>
        </div>
      </div>
      {/* Растущая шкала разморозки (без «осталось N», без таймера). */}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-board">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 220, damping: 30 }}
        />
      </div>
    </div>
  );
}

/**
 * Экран выбора режима Match-3 (бриф §1): 🌿 «Спокойно» (как было) / 🌶️ «С перчинкой» (поуровневый,
 * с подписью «Глубина: N»). Глубину читаем из match3.stats напрямую (без монтирования игры).
 */
function ModeSelect({ onPickLight, onPickSpicy, onBack, onOpenWallet }: { onPickLight: () => void; onPickSpicy: () => void; onBack: () => void; onOpenWallet: () => void }) {
  const rewards = useRewards();
  const [depth, setDepth] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    rewards.repo
      .loadMatch3Stats()
      .then((s) => !cancelled && setDepth(normalizeM3Stats(s).maxSpicyLevel))
      .catch(() => !cancelled && setDepth(0));
    return () => {
      cancelled = true;
    };
  }, [rewards.repo]);

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-4 px-4 py-4">
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

      <div className="mt-2 text-center">
        <div className="text-2xl font-extrabold text-ink">Match-3 🍓</div>
        <p className="mt-1 text-sm font-semibold text-muted">Выбери, как сегодня отдыхаем ❤️</p>
      </div>

      <button
        onClick={onPickLight}
        className="flex items-center gap-4 rounded-card bg-white/80 p-5 text-left shadow-soft active:scale-[0.98] transition"
      >
        <span className="text-4xl leading-none">🌿</span>
        <span className="flex flex-col">
          <span className="text-lg font-extrabold text-ink">Спокойно</span>
          <span className="text-sm font-semibold text-muted">Бесконечно, без лимитов и проигрыша — чистый релакс</span>
        </span>
      </button>

      <button
        onClick={onPickSpicy}
        className="flex items-center gap-4 rounded-card bg-white/80 p-5 text-left shadow-soft active:scale-[0.98] transition"
      >
        <span className="text-4xl leading-none">🌶️</span>
        <span className="flex flex-col">
          <span className="text-lg font-extrabold text-ink">С перчинкой</span>
          <span className="text-sm font-semibold text-muted">Уровни со льдом, лимит ходов, добрый ретрай</span>
          <span className="mt-0.5 text-sm font-extrabold text-primary">Глубина: {depth ?? '…'}</span>
        </span>
      </button>

      <p className="mt-auto text-center text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>
    </div>
  );
}

/**
 * Внешний Match-3: держит выбор режима ('light'|'spicy'|null). null → ModeSelect; иначе монтирует
 * <Match3Game> с key по режиму (перемонтаж = чистый сброс таймеров/обстаклов при смене режима, бриф §1).
 * Демо (?room=demo) минует селектор и идёт сразу в лайт (эфемерная демо-комната).
 */
export default function Match3({ onBack, onOpenWallet }: Match3Props) {
  const demo = useRef(getRoomParam() === 'demo').current;
  const [mode, setMode] = useState<Match3Mode | null>(demo ? 'light' : null);

  if (mode === null) {
    return <ModeSelect onPickLight={() => setMode('light')} onPickSpicy={() => setMode('spicy')} onBack={onBack} onOpenWallet={onOpenWallet} />;
  }
  return (
    <Match3Game
      key={`m3-${mode}`}
      mode={mode}
      onBack={onBack}
      onOpenWallet={onOpenWallet}
      onExitToModes={() => setMode(null)}
    />
  );
}
