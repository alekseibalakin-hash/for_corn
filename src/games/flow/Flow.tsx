import { useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Cat, Cherry, Cloud, Droplet, Flower2, Gift, Heart, Key,
  Leaf, Moon, RotateCcw, Snowflake, Star, Sun,
  type LucideProps,
} from 'lucide-react';
import { useRewards } from '../../rewards';
import { haptics } from '../../telegram';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { ExpiryBanner } from '../../ui/components/ExpiryBanner';
import { LoadingSplash } from '../../ui/components/LoadingSplash';
import { BUILD_TAG } from '../../ui/constants';
import { adjacent, isSolvedByPlayer, sameCoord, type Coord } from './logic';
import { useFlow } from './useFlow';

// Маппинг figure-id → lucide-компонент (DESIGN-FLOW §7 + briefs/flow-phase2.md §4).
const FIGURE_ICONS: Record<string, React.FC<LucideProps>> = {
  heart: Heart,
  star: Star,
  flower: Flower2,
  moon: Moon,
  sun: Sun,
  leaf: Leaf,
  droplet: Droplet,
  cat: Cat,
  cherry: Cherry,
  cloud: Cloud,
  snowflake: Snowflake,
  key: Key,
};

/** Оверлей победы со звёздами (Фаза 2.5 §1). Отдельный компонент — не зависит от ConfirmDialog. */
function FlowWinOverlay({
  level,
  stars,
  parK,
  onNext,
  onMenu,
}: {
  level: number;
  stars: number;
  parK: number;
  onNext: () => void;
  onMenu: () => void;
}) {
  const filledColor = '#f4b13d'; // amber-400
  const emptyColor = 'rgba(0,0,0,0.12)';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-6 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.9, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="w-full max-w-xs rounded-card bg-cream p-5 text-center shadow-lift"
        >
          <h3 className="text-lg font-extrabold text-ink">Уровень {level} пройден! 🌈</h3>

          {/* Звёзды — крупно и празднично */}
          <div className="mt-2 flex justify-center gap-1">
            {[1, 2, 3].map((n) => (
              <Star
                key={n}
                className="h-9 w-9"
                style={{ color: n <= stars ? filledColor : emptyColor, fill: n <= stars ? filledColor : emptyColor }}
                strokeWidth={0}
              />
            ))}
          </div>

          {stars === 3 && (
            <p className="mt-1 text-sm font-bold" style={{ color: filledColor }}>
              Идеально! ✨ Все {parK} пар одним штрихом!
            </p>
          )}
          {stars === 2 && (
            <p className="mt-1 text-xs font-semibold text-muted">
              Хорошо! Попробуй уложиться в {parK} штрихов для ★★★
            </p>
          )}
          {stars === 1 && (
            <p className="mt-1 text-xs font-semibold text-muted">
              Пройдено! Цель на 3★ — всего {parK} штрихов
            </p>
          )}

          <p className="mt-2 text-sm font-semibold text-muted">
            Все пары соединены и поле заполнено 💛
          </p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={onMenu}
              className="flex-1 rounded-card bg-board py-2.5 font-bold text-ink active:scale-95 transition"
            >
              В меню
            </button>
            <button
              onClick={onNext}
              className="flex-1 rounded-card bg-primary py-2.5 font-bold text-white active:scale-95 transition"
            >
              Дальше ▶
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

interface FlowProps {
  onBack: () => void;
  onOpenWallet: () => void;
}

function FlowGame({ onBack, onOpenWallet }: FlowProps) {
  const rewards = useRewards();
  const fl = useFlow();
  const now = Date.now();

  // ref на внутренний грид-контейнер для cellFromPoint (пропорциональный маппинг без gap-поправки).
  const gridRef = useRef<HTMLDivElement>(null);
  // Активная пара при рисовании (-1 = нет). Синхронный ref: читается/пишется в pointer-обработчиках.
  const activePairRef = useRef<number>(-1);

  // Telegram: пока рисуем — глушим вертикальный жест WebView (иначе мини-аппа сворачивается).
  // Пассивный=false + preventDefault только во время активного рисования (как Blocks.tsx/Match3.tsx).
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (activePairRef.current !== -1) e.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, []);

  // Координата клетки поля под точкой (по rect грида; пропорция устойчива к gap, как Blocks).
  // Читает sizeRef.current — нет проблем с закрытием (ref всегда актуален).
  const cellFromPoint = useCallback((x: number, y: number): Coord | null => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const sz = fl.sizeRef.current;
    const r = Math.floor(((y - rect.top) / rect.height) * sz);
    const c = Math.floor(((x - rect.left) / rect.width) * sz);
    if (r < 0 || r >= sz || c < 0 || c >= sz) return null;
    return { r, c };
  }, [fl.sizeRef]);

  // ---- Pointer down: начать рисование. ----
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (fl.statusRef.current !== 'playing' || fl.loading || !!fl.resumeChoiceRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId); // получаем move/up даже вне элемента

    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;

    const paths = fl.pathsRef.current;
    const pairs = fl.pairsRef.current;

    // Конец пары → сброс пути и старт с этого конца.
    for (let i = 0; i < pairs.length; i++) {
      if (sameCoord(cell, pairs[i].a) || sameCoord(cell, pairs[i].b)) {
        activePairRef.current = i;
        const newPaths = paths.map((p, j) => (j === i ? [{ ...cell }] : [...p]));
        fl.updatePaths(newPaths, 1); // +1 штрих = 1 ход
        return;
      }
    }

    // Клетка пути пары i → усечь путь до неё и продолжать.
    for (let i = 0; i < paths.length; i++) {
      const pos = paths[i].findIndex((c) => sameCoord(c, cell));
      if (pos !== -1) {
        activePairRef.current = i;
        const newPaths = paths.map((p, j) => (j === i ? p.slice(0, pos + 1) : [...p]));
        fl.updatePaths(newPaths, 1);
        return;
      }
    }
    // Пустая клетка вне путей — игнор.
  }, [fl, cellFromPoint]);

  // ---- Pointer move: расширить/усечь путь. ----
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const active = activePairRef.current;
    if (active === -1) return;

    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;

    const paths = fl.pathsRef.current;
    const pairs = fl.pairsRef.current;
    const path = paths[active] ?? [];
    if (path.length === 0) return;

    const last = path[path.length - 1];
    if (sameCoord(last, cell)) return; // та же клетка
    if (!adjacent(last, cell)) return; // не смежна (быстрый свайп)

    // Возврат: клетка = предпоследняя в пути → поп.
    if (path.length >= 2 && sameCoord(path[path.length - 2], cell)) {
      const newPaths = paths.map((p, i) => (i === active ? p.slice(0, -1) : [...p]));
      fl.updatePaths(newPaths, 0);
      return;
    }

    // Петля в своём пути → игнор.
    if (path.some((c) => sameCoord(c, cell))) return;

    // Парный конец → замкнуть путь + хаптик.
    const pair = pairs[active];
    const startCell = path[0];
    const partnerEnd = sameCoord(startCell, pair.a) ? pair.b : pair.a;
    if (sameCoord(cell, partnerEnd)) {
      const newPaths = paths.map((p, i) => (i === active ? [...p, { ...cell }] : [...p]));
      fl.updatePaths(newPaths, 0);
      haptics.impact('light'); // хаптик на замыкании пары (бриф §4)
      return;
    }

    // Чужой конец → блок.
    for (let i = 0; i < pairs.length; i++) {
      if (i === active) continue;
      if (sameCoord(cell, pairs[i].a) || sameCoord(cell, pairs[i].b)) return;
    }

    // Пусто или чужой путь → расширить текущий, усечь чужой (стандартная Flow-перезапись).
    const newPaths = paths.map((p, i) => {
      if (i === active) return [...p, { ...cell }];
      const pos = p.findIndex((c) => sameCoord(c, cell));
      if (pos !== -1) return p.slice(0, pos); // обрезаем чужой хвост
      return [...p];
    });
    fl.updatePaths(newPaths, 0);
  }, [fl, cellFromPoint]);

  // ---- Pointer up: завершить штрих, проверить победу. ----
  const onPointerUp = useCallback(() => {
    const active = activePairRef.current;
    activePairRef.current = -1;
    if (active === -1) return;

    const paths = fl.pathsRef.current;
    const pairs = fl.pairsRef.current;
    const size = fl.sizeRef.current;

    if (isSolvedByPlayer(size, pairs, paths)) {
      fl.handleWin();
    } else {
      fl.persistBoard();
    }
  }, [fl]);

  if (fl.loading) return <LoadingSplash />;

  const { size, pairs, paths } = fl;

  // Карта занятых клеток: occMap[r][c] = индекс пары (или -1).
  const occMap: number[][] = Array.from({ length: size }, () => new Array(size).fill(-1));
  for (let i = 0; i < paths.length; i++) {
    for (const cell of paths[i]) {
      if (cell.r >= 0 && cell.r < size && cell.c >= 0 && cell.c < size) {
        occMap[cell.r][cell.c] = i;
      }
    }
  }

  // Число соединённых пар (для HUD «соединено K/всего»).
  const connectedCount = pairs.filter((pair, i) => {
    const p = paths[i] ?? [];
    if (p.length < 2) return false;
    const start = p[0], end = p[p.length - 1];
    return (
      (sameCoord(start, pair.a) && sameCoord(end, pair.b)) ||
      (sameCoord(start, pair.b) && sameCoord(end, pair.a))
    );
  }).length;

  // Победа Flow = ВСЕ пары соединены И ВСЁ поле заполнено (isSolvedByPlayer). Раньше HUD показывал
  // только «соединено K/K» — игрок соединял все фигурки, видел K/K и думал что прошёл, но оставались
  // пустые клетки ⇒ уровень не засчитывался и «не давал следующий». Теперь показываем ЗАПОЛНЕНИЕ поля
  // (бинд-условие победы) + подсказку, когда все пары соединены, но поле не заполнено.
  const totalCells = size * size;
  const filledCount = occMap.reduce((s, row) => s + row.filter((x) => x >= 0).length, 0);
  const allConnected = pairs.length > 0 && connectedCount === pairs.length;
  const boardFull = filledCount === totalCells;

  const overlayBlocked = fl.status !== 'playing' || !!fl.resumeChoice || fl.confirmRestart;

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-3 px-4 py-4">
      {/* Шапка: назад + кошелёк (как Blocks/Match3). */}
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

      {/* HUD: уровень / соединено K/всего / par K / «Заново». */}
      <div className="flex items-center justify-between gap-2">
        <div className="rounded-card bg-board px-4 py-1.5 text-center">
          <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">Уровень</div>
          <div className="text-lg font-extrabold leading-tight text-ink">{fl.level}</div>
        </div>
        <div className="flex items-center gap-2">
          {/* ЗАПОЛНЕНИЕ поля — бинд-условие победы. 25/25 = поле заполнено ⇒ уровень пройден. */}
          <div
            className="flex items-center gap-1.5 rounded-card bg-board px-3 py-1.5"
            style={boardFull ? { backgroundColor: 'rgba(95,184,111,0.35)' } : undefined}
          >
            <span className="text-base leading-none">🌈</span>
            <div className="text-center leading-none">
              <div className="text-[0.5rem] font-bold uppercase tracking-wide text-muted">поле</div>
              <div className="text-lg font-extrabold leading-tight text-ink">{filledCount}/{totalCells}</div>
            </div>
          </div>
          {/* par K — подсказка-цель: 3★ = ровно K штрихов (Фаза 2.5 §1). */}
          <div className="rounded-card bg-board px-2.5 py-1.5 text-center">
            <div className="text-[0.55rem] font-bold uppercase tracking-wide text-muted">par</div>
            <div className="text-sm font-extrabold leading-tight text-ink">{pairs.length}</div>
          </div>
          <button
            onClick={fl.requestRestart}
            disabled={overlayBlocked}
            aria-label="Начать уровень заново"
            className="flex items-center justify-center rounded-card bg-white/70 p-2.5 text-ink shadow-soft active:scale-95 transition disabled:opacity-50"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Подсказка: все пары соединены, но поле НЕ заполнено — главный источник путаницы «не даёт
          следующий уровень». Победа требует ЗАПОЛНИТЬ ВСЁ поле, а не только соединить фигурки. */}
      {fl.status === 'playing' && allConnected && !boardFull && (
        <div
          className="rounded-card px-3 py-2 text-center text-sm font-bold"
          style={{ backgroundColor: 'rgba(244,177,61,0.20)', color: '#9a6a14' }}
        >
          Все фигурки соединены ✓ — теперь заполни ВСЁ поле! Осталось {totalCells - filledCount} 🌈
        </div>
      )}

      {/* Поле: фоновый грид + SVG трассы + концы с иконками.
          Ref на внутренний грид → cellFromPoint правильно меряет rect (без padding контейнера).
          touch-action:none + pointer-обработчики на гриде (у SVG/кружков pointer-events:none). */}
      <div className="mt-1 aspect-square w-full rounded-card bg-board p-2 shadow-soft">
        <div
          ref={gridRef}
          className="relative h-full w-full"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Фоновые клетки + лёгкий тинт цвета пути. */}
          <div
            className="grid h-full w-full"
            style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, gap: '2px' }}
          >
            {Array.from({ length: size * size }).map((_, idx) => {
              const r = Math.floor(idx / size);
              const c = idx % size;
              const pIdx = occMap[r][c];
              return (
                <div
                  key={idx}
                  className="rounded-sm bg-cell"
                  style={
                    pIdx >= 0
                      ? { backgroundColor: pairs[pIdx].color + '30' }
                      : undefined
                  }
                />
              );
            })}
          </div>

          {/* SVG трассы путей (поверх фона, pointer-events:none). viewBox N×N → ячейка = 1×1 ед.
              Центр ячейки (r,c) = (c+0.5, r+0.5) в ед. viewBox. strokeWidth 0.5 ≈ полширины ячейки. */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${size} ${size}`}
            preserveAspectRatio="none"
          >
            {paths.map((path, i) => {
              if (path.length < 2) return null;
              const pts = path.map((cell) => `${cell.c + 0.5},${cell.r + 0.5}`).join(' ');
              return (
                <polyline
                  key={i}
                  points={pts}
                  stroke={pairs[i].color}
                  strokeWidth={0.52}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.88}
                />
              );
            })}
          </svg>

          {/* Кружки-концы: позиция через % от грида → масштабируется с полем.
              WYSIWYG (БЕЗ лифта) — как в Blocks.tsx (урок d58c3fa). */}
          {pairs.flatMap((pair, i) =>
            ([pair.a, pair.b] as const).map((coord, j) => {
              const Icon = FIGURE_ICONS[pair.figure];
              if (!Icon) return null;
              const pct = (n: number) => `${((n + 0.5) / size) * 100}%`;
              return (
                <div
                  key={`ep-${i}-${j}`}
                  className="pointer-events-none absolute flex items-center justify-center rounded-full"
                  style={{
                    left: pct(coord.c),
                    top: pct(coord.r),
                    transform: 'translate(-50%, -50%)',
                    width: `${68 / size}%`,
                    aspectRatio: '1 / 1',
                    backgroundColor: pair.color,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.28)',
                  }}
                >
                  <Icon
                    style={{ width: '58%', height: '58%', color: 'white' }}
                    strokeWidth={2.5}
                  />
                </div>
              );
            }),
          )}
        </div>
      </div>

      <p className="mt-1 text-center text-xs font-semibold text-muted">
        Соединяй пары фигурок цветными путями, заполни всё поле ❤️
      </p>
      <p className="text-center text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>

      {/* ОВЕРЛЕИ.
          Победа: кастомный FlowWinOverlay со звёздами (Фаза 2.5 §1). Меню ДОСТУПНО сразу
          (победа→grant синхронна: нет busy/прожига — гонки нет; §2.6 бриф).
          Резюм: «Продолжить / Заново». Перезапуск: подтверждение из HUD. */}
      {fl.status === 'won' && (
        <FlowWinOverlay
          level={fl.level}
          stars={fl.lastWinStars}
          parK={fl.pairs.length}
          onNext={fl.nextLevel}
          onMenu={onBack}
        />
      )}
      <ConfirmDialog
        show={!!fl.resumeChoice}
        title={`Продолжить уровень ${fl.resumeChoice?.level ?? ''}?`}
        message="Ты остановилась на середине. Продолжить с того же места или начать этот уровень заново?"
        confirmLabel="Продолжить"
        cancelLabel="Начать заново"
        onConfirm={fl.resumeLevel}
        onCancel={fl.restartLevel}
      />
      <ConfirmDialog
        show={fl.confirmRestart}
        title="Начать уровень заново?"
        message="Текущий прогресс путей сбросится. Глубина и награды останутся при тебе."
        confirmLabel="Заново"
        cancelLabel="Продолжить"
        onConfirm={fl.confirmRestartLevel}
        onCancel={fl.cancelRestart}
      />
    </div>
  );
}

/**
 * Экран «Соедини фигурки» — грузится лениво (отдельный чанк), как Blocks/Match3/Wordle.
 * Поуровневый Flow без таймера/проигрыша (только playing/won). Кошелёк/раскрытия — из наградного слоя.
 */
export default function Flow({ onBack, onOpenWallet }: FlowProps) {
  return <FlowGame onBack={onBack} onOpenWallet={onOpenWallet} />;
}
