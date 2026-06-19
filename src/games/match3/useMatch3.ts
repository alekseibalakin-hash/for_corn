import { useCallback, useEffect, useRef, useState } from 'react';
import { useRewards } from '../../rewards';
import { haptics } from '../../telegram';
import { celebrate } from '../../ui/confetti';
import {
  activateInPlace,
  applySwap,
  createBoard,
  createRoomBoard,
  emptyObstacles,
  findAnyMove,
  findIcePreferredMove,
  hasAnyMove,
  isEmptyObstacles,
  isStatic,
  isValidSwap,
  makeStream,
  mulberry32,
  normalizeObstacles,
  reshuffle,
  resolveSwap,
  SIZE,
  type Board,
  type CascadeStep,
  type Coord,
  type Obstacles,
  type ResolveResult,
  type Rng,
  type RoomLayout,
  type SeededStream,
} from './logic';
import {
  generateLevel,
  isResumableSlot,
  normalizeSpicy,
  type SpicyGoal,
  type SpicyLevel,
  type SpicyLevelState,
} from './levels';
import { depthMirror } from './depthMirror';
import {
  buildM3Snapshot,
  commitM3Game,
  defaultM3Game,
  defaultM3Stats,
  normalizeM3Game,
  normalizeM3Stats,
  type M3CumulativeStats,
  type M3CurrentGame,
} from './stats';
import { applyStep, boardToGems, swapGems, type VisualGem } from './gems';
import type { PersistedMatch3 } from '../../storage/repository';

const GAME_ID = 'm3';
const rng: Rng = Math.random;

/** Режим игры: 🌿 лайт (бесконечный relax, как было) | 🌶️ «с перчинкой» (поуровневый). */
export type Match3Mode = 'light' | 'spicy';

/** Снимок незаконченного уровня из сгенерированного уровня (полный бюджет, нулевой прогресс/поток). */
function spicyStateFromLevel(lvl: SpicyLevel): SpicyLevelState {
  return {
    level: lvl.level,
    seed: lvl.seed,
    movesLeft: lvl.movesBudget,
    goal: lvl.goal,
    progress: 0,
    streamPos: 0,
    board: lvl.board,
    obstacles: lvl.obstacles,
  };
}

/** Случайный seed генерации уровня (сам сгенерированный уровень детерминирован своим seed — задача №0). */
const freshSeed = (): number => (Math.random() * 0x7fffffff) >>> 0;

// Тайминги анимации хода (мс): своп (слайд) → взрыв-искры → оседание (layout-spring), по каскаду.
// SETTLE ≈ время осёдки spring stiffness700/damping42 — короче → следующий шаг стартует посреди
// падения = джиттер. CLEAR — окно искр перед падением.
const SWAP_MS = 160;
const CLEAR_MS = 140;
const SETTLE_MS = 220;
const REVERT_MS = 160;

// Релакс-подсказка: после стольких мс простоя подсветить одну валидную пару (без давления).
const HINT_IDLE_MS = 5000;
// Праздник: если за ОДИН шаг хода убрано столько фишек — конфетти + вспышка поля (не на каждом ходу).
const BIG_CLEAR = 20;

// ---- ДЕМО-КОМНАТА (Фаза 1, бриф §8): за ?room=demo показываем пару блоков + замороженные фишки,
// чтобы глазами увидеть сегментную гравитацию и оттаивание на боевом URL. Демо ЭФЕМЕРНО: НЕ грузит и
// НЕ перезаписывает партию жены/мужа (persist выключен), не выдаёт награды. Эндлесс (?-less) не тронут. ----
const DEMO_LAYOUT: RoomLayout = {
  blocks: [
    { r: 4, c: 3 },
    { r: 4, c: 4 },
  ],
  ice: [
    { r: 2, c: 2 },
    { r: 2, c: 5 },
    { r: 5, c: 3 },
    { r: 5, c: 4 },
    { r: 6, c: 1 },
  ],
};
const DEMO_SEED = 20260617;

function getRoomParam(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('room');
  } catch {
    return null;
  }
}

/** Активный визуальный эффект хода (для подсветки/взрывов в Match3.tsx). */
export interface M3Fx {
  cleared: Coord[];
  detonated: { r: number; c: number }[];
}

/**
 * Хук Match-3 (Фаза B), зеркало useGame2048: держит ТОЛЬКО m3-состояние (поле, per-game статы,
 * cumulative) и персистит СВОИ ключи (match3.board/match3.stats). Наградный слой игро-независим:
 * на каждом ходе/смене партии зовём `rewards.grant('m3', снапшот, prevСнапшот)`. РАССЛАБЛЕННЫЙ
 * endless: проигрыша нет; если ходов не осталось — reshuffle.
 */
export function useMatch3(mode: Match3Mode = 'light') {
  const rewards = useRewards();
  const repo = rewards.repo;

  // Демо-комната активна только при ?room=demo — стабильно на весь маунт.
  const demoMode = useRef(getRoomParam() === 'demo').current;

  const [loading, setLoading] = useState(true);
  const [board, setBoardState] = useState<Board>([]);
  // Визуальный слой со стабильными id (gems.ts) — держим ПАРАЛЛЕЛЬНО plain-полю `board`:
  // gems рисуют падение (layout по id), а board остаётся для logic/тача/handleTap и персиста.
  const [gems, setGemsState] = useState<VisualGem[]>([]);
  // Препятствия (overlay-слои; бриф §1). Эндлесс ⇒ всегда пусты ⇒ поведение байт-в-байт прежнее.
  const [obstacles, setObstaclesState] = useState<Obstacles>(emptyObstacles);
  const [game, setGameState] = useState<M3CurrentGame>(defaultM3Game);
  const [stats, setStatsState] = useState<M3CumulativeStats>(defaultM3Stats);
  const [busy, setBusyState] = useState(false); // идёт анимация хода — вход заблокирован
  const [fx, setFx] = useState<M3Fx | null>(null);
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  // Релакс-подсказка: пара клеток для мягкой подсветки (или null). Только при простое и !busy.
  const [hint, setHintState] = useState<[Coord, Coord] | null>(null);
  // Счётчик «праздников»: каждый крупный клир ++ — UI проигрывает вспышку поля по смене значения.
  const [flash, setFlash] = useState(0);

  // ---- Состояние режима «с перчинкой» (бриф spicy §1). Лайт держит константные дефолты ⇒ его
  // рендер/поведение не меняется. Вся спайси-логика — за ветками `if (mode === 'spicy')`. ----
  const [level, setLevelState] = useState(0);
  const [movesLeft, setMovesLeftState] = useState(0);
  const [goal, setGoalState] = useState<SpicyGoal | null>(null);
  const [goalProgress, setGoalProgressState] = useState(0);
  const [status, setStatusState] = useState<'playing' | 'won' | 'lost'>('playing');
  // Незаконченный уровень при входе → диалог «Продолжить / Заново» (null = выбора нет).
  const [resumeChoice, setResumeChoiceState] = useState<SpicyLevelState | null>(null);

  // Зеркала для синхронного чтения в обработчиках (как в useGame2048).
  const boardRef = useRef(board);
  const gemsRef = useRef(gems);
  const obstaclesRef = useRef(obstacles);
  const gameRef = useRef(game);
  const statsRef = useRef(stats);
  const busyRef = useRef(busy);
  const hintRef = useRef(hint);
  const aliveRef = useRef(true);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Анимационные таймеры (after()-цепочка): lifecycle-cleanup [repo] НЕ трогает их — только истинный
  // unmount (empty-deps effect ниже) и явный старт нового уровня/партии. Это корневой фикс зависания:
  // ре-ран [repo] при setObstacles mid-каскада больше НЕ обрывает after()-цепочку.
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Safety-net watchdog (уровень 1 бриф freeze-fix): финал хода посчитан синхронно ДО анимации.
  // Если after()-цепочка оборвётся — watchdog применит этот финал (busy не залипнет навсегда).
  const pendingResolveRef = useRef<{
    board: Board;
    obstacles: Obstacles;
    agg: { scoreGained: number; gemsCleared: number; maxCascade: number; biggestClear: number; iceCleared: number };
    prevSnapshot: ReturnType<typeof buildM3Snapshot>;
    isCombo: boolean;
  } | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setBoard = (v: Board) => ((boardRef.current = v), setBoardState(v));
  const setGems = (v: VisualGem[]) => ((gemsRef.current = v), setGemsState(v));
  // Обновляем obstacles только при реальной смене ref (эндлесс держит один пустой ref ⇒ без ре-рендеров).
  const setObstacles = (v: Obstacles) => {
    obstaclesRef.current = v;
    setObstaclesState(v);
  };
  const setGame = (v: M3CurrentGame) => ((gameRef.current = v), setGameState(v));
  const setStats = (v: M3CumulativeStats) => ((statsRef.current = v), setStatsState(v));
  const setBusy = (v: boolean) => ((busyRef.current = v), setBusyState(v));
  const setHint = (v: [Coord, Coord] | null) => ((hintRef.current = v), setHintState(v));

  // ---- Зеркала и рефы режима «с перчинкой» ----
  const levelRef = useRef(level);
  const movesLeftRef = useRef(movesLeft);
  const goalRef = useRef(goal);
  const goalProgressRef = useRef(goalProgress);
  const statusRef = useRef(status);
  const resumeChoiceRef = useRef(resumeChoice);
  const setLevel = (v: number) => ((levelRef.current = v), setLevelState(v));
  const setMovesLeft = (v: number) => ((movesLeftRef.current = v), setMovesLeftState(v));
  const setGoal = (v: SpicyGoal | null) => ((goalRef.current = v), setGoalState(v));
  const setGoalProgress = (v: number) => ((goalProgressRef.current = v), setGoalProgressState(v));
  const setStatus = (v: 'playing' | 'won' | 'lost') => ((statusRef.current = v), setStatusState(v));
  const setResumeChoice = (v: SpicyLevelState | null) => ((resumeChoiceRef.current = v), setResumeChoiceState(v));
  // Play-поток уровня (mulberry32 c курсором): резюм продолжает ТОТ ЖЕ поток (задача №0). seedRef — его seed.
  const seedRef = useRef(0);
  const streamRef = useRef<SeededStream | null>(null);
  // Подготовленный ретрай при проигрыше (тот же уровень, новый seed, полный бюджет) — для retryLevel/персиста.
  const pendingRetryRef = useRef<SpicyLevel | null>(null);
  // Dual-slot персист (бриф §5): эхо ЧУЖОГО слота, чтобы не затереть его (coalescingStore last-write-wins).
  // spicy-маунт эхрит лайт-слот {board,game,obstacles}; лайт-маунт эхрит spicy-слот.
  const echoLightRef = useRef<Pick<PersistedMatch3, 'board' | 'game' | 'obstacles'> | null>(null);
  const echoSpicyRef = useRef<SpicyLevelState | null>(null);
  // Если mount-загрузка board/stats упала — НЕ пишем ничего (риск стереть реальные данные дефолтом).
  // Общий флаг для обоих режимов: false при ЛЮБОМ mount-сбое чтения board или stats.
  const persistOkRef = useRef(true);
  // Текущий play-rng: спайси-поток (если есть) или Math.random (лайт — байт-в-байт прежнее поведение).
  const moveRng = (): Rng => (mode === 'spicy' ? streamRef.current?.rng ?? rng : rng);
  // Спайси-ввод заблокирован, пока показан оверлей победы/поражения/выбора резюма.
  const spicyInputBlocked = (): boolean => mode === 'spicy' && (statusRef.current !== 'playing' || !!resumeChoiceRef.current);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      animTimersRef.current = animTimersRef.current.filter((t) => t !== id);
      if (aliveRef.current) fn();
    }, ms);
    animTimersRef.current.push(id);
  }, []);

  // ---- Релакс-подсказка при простое. Таймер живёт ОТДЕЛЬНО от anim-таймеров (after): его
  // перезапускает любое действие игрока (notifyActivity) и завершение хода. Через ~5с простоя —
  // мягко подсветить одну валидную пару. Никакого видимого таймера/давления. ----
  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);
  const scheduleHint = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      if (!aliveRef.current || busyRef.current) return;
      if (spicyInputBlocked()) return; // не пульсируем подсказку под оверлеем победы/поражения/резюма
      // Спайси: подсказка предпочитает своп, смежный со льдом (прогресс цели), лайт — любой валидный.
      // Room-aware в обоих случаях (isValidSwap учитывает ob). Эндлесс: ob пуст ⇒ findAnyMove прежний.
      const move = mode === 'spicy'
        ? findIcePreferredMove(boardRef.current, obstaclesRef.current)
        : findAnyMove(boardRef.current, obstaclesRef.current);
      if (move) setHint(move);
    }, HINT_IDLE_MS);
  }, [clearIdleTimer]);
  /** Любое действие игрока: гасим текущую подсказку и (если поле свободно) перезапускаем таймер. */
  const notifyActivity = useCallback(() => {
    if (hintRef.current) setHint(null);
    if (busyRef.current) clearIdleTimer();
    else scheduleHint();
  }, [clearIdleTimer, scheduleHint]);

  // Текущий снимок незаконченного спайси-уровня (или null = «нет незаконченного»: победа/нет цели).
  // На проигрыше — снимок ПОДГОТОВЛЕННОГО ретрая (тот же level, новый seed, полный бюджет), а не
  // проигранной доски (бриф §5: проигрыш не оставлять как «продолжить»).
  const currentSpicyState = useCallback((): SpicyLevelState | null => {
    const st = statusRef.current;
    if (st === 'won') return null;
    if (st === 'lost') return pendingRetryRef.current ? spicyStateFromLevel(pendingRetryRef.current) : null;
    const g = goalRef.current;
    if (!g) return null;
    return {
      level: levelRef.current,
      seed: seedRef.current,
      movesLeft: movesLeftRef.current,
      goal: g,
      progress: goalProgressRef.current,
      streamPos: streamRef.current ? streamRef.current.pos() : 0,
      board: boardRef.current,
      obstacles: obstaclesRef.current,
    };
  }, []);

  const persistBoard = useCallback(() => {
    if (demoMode) return; // демо эфемерно — не перезаписываем реальную партию
    if (!persistOkRef.current) return; // mount-load упал — не рискуем затереть реальные данные
    if (mode === 'spicy') {
      // Склейка: лайт-слот (echo, неизменный за этот маунт) + наш spicy-слот. ПОЛНЫЙ объект —
      // иначе coalescingStore last-write-wins сотрёт лайт-резюм жены (бриф §5).
      const top = echoLightRef.current;
      const snap = currentSpicyState();
      const payload: PersistedMatch3 = { ...(top ?? {}), spicy: snap };
      void repo.saveMatch3Board(payload).catch((err) => console.warn('[m3] не удалось сохранить «match3.board» (перчинка):', err));
      return;
    }
    const ob = obstaclesRef.current;
    // obstacles пишем ТОЛЬКО когда они есть: эндлесс-blob жены остаётся байт-в-байт прежним (бриф §5).
    const base = isEmptyObstacles(ob)
      ? { board: boardRef.current, game: gameRef.current }
      : { board: boardRef.current, game: gameRef.current, obstacles: ob };
    // Эхо чужого (spicy) слота, если он был при загрузке — чтобы не потерять незаконченную перчинку.
    // Нет спайси-слота ⇒ payload === base (байт-в-байт прежний лайт-формат; ключа spicy нет).
    const payload: PersistedMatch3 = echoSpicyRef.current ? { ...base, spicy: echoSpicyRef.current } : base;
    void repo.saveMatch3Board(payload).catch((err) => console.warn('[m3] не удалось сохранить «match3.board»:', err));
  }, [repo, demoMode, mode, currentSpicyState]);
  const persistStats = useCallback(() => {
    if (demoMode) return;
    // mount-load упал (persistOkRef=false) — не перезаписываем реальные статы нулями ни в одном режиме.
    if (!persistOkRef.current) return;
    void repo
      .saveMatch3Stats(statsRef.current)
      .catch((err) => console.warn('[m3] не удалось сохранить «match3.stats»:', err));
  }, [repo, demoMode, mode]);

  // ---- Применить состояние уровня «с перчинкой» к полю (старт/резюм). Восстанавливает play-поток
  // на нужной позиции (резюм продолжает ТОТ ЖЕ поток — задача №0). ----
  const applyState = useCallback((st: SpicyLevelState) => {
    seedRef.current = st.seed;
    streamRef.current = makeStream(st.seed, st.streamPos);
    setLevel(st.level);
    setMovesLeft(st.movesLeft);
    setGoal(st.goal);
    setGoalProgress(st.progress);
    setObstacles(st.obstacles);
    setBoard(st.board);
    setGems(boardToGems(st.board, st.obstacles));
    setFx(null);
    setHint(null);
    setBusy(false);
    setStatus('playing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Сгенерировать и запустить свежий уровень N. Гасит in-flight таймеры прошлого уровня (бриф §4). */
  const startSpicyLevel = useCallback(
    (levelNum: number) => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      animTimersRef.current.forEach(clearTimeout);
      animTimersRef.current = [];
      if (watchdogRef.current !== null) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      pendingResolveRef.current = null;
      clearIdleTimer();
      pendingRetryRef.current = null;
      const lvl = generateLevel(Math.max(1, levelNum), freshSeed());
      applyState(spicyStateFromLevel(lvl));
    },
    [applyState, clearIdleTimer],
  );

  // Истинный unmount: гасим aliveRef + anim-таймеры + watchdog ТОЛЬКО здесь (empty deps).
  // Lifecycle-cleanup [repo] ниже НЕ трогает их — ре-ран при смене репо не обрывает after()-цепочку.
  useEffect(() => {
    return () => {
      aliveRef.current = false;
      animTimersRef.current.forEach(clearTimeout);
      animTimersRef.current = [];
      if (watchdogRef.current !== null) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      pendingResolveRef.current = null;
    };
  }, []);

  // ---- Загрузка партии. После boot наградного слоя (Shell гейтит на rewards.loading).
  // Награды тут НЕ оцениваем (как 2048): вехи срабатывают на первом ходе. ----
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    // ---- РЕЖИМ «С ПЕРЧИНКОЙ»: ранний выход (бриф §1). Грузим maxSpicyLevel (глубину) + незаконченный
    // уровень из .spicy; эхо лайт-слота — для безопасной склейки персиста. Лайт-ветка ниже НЕ выполняется. ----
    if (mode === 'spicy') {
      (async () => {
        try {
          const [boardP, statsP] = await Promise.all([repo.loadMatch3Board(), repo.loadMatch3Stats()]);
          if (cancelled) return;
          const loadedStats = normalizeM3Stats(statsP);
          // §п.0: read-repair — зеркало пережило быстрое закрытие, CloudStorage отстал → берём max.
          const mirrorDepth = depthMirror.read();
          const recoveredDepth = Math.max(loadedStats.maxSpicyLevel, mirrorDepth);
          const recoveredStats = recoveredDepth > loadedStats.maxSpicyLevel
            ? { ...loadedStats, maxSpicyLevel: recoveredDepth }
            : loadedStats;
          setStats(recoveredStats);
          if (recoveredDepth > loadedStats.maxSpicyLevel) {
            // Глубина восстановлена из зеркала — сразу персистируем в CloudStorage.
            void repo.saveMatch3Stats(recoveredStats).catch((err) => console.warn('[m3] не удалось сохранить восстановленную глубину:', err));
          }
          // Эхо лайт-слота (bytes как есть) для склейки при персисте; нет валидной board ⇒ лайт-слота нет.
          echoLightRef.current =
            boardP && Array.isArray(boardP.board) && boardP.board.length > 0
              ? { board: boardP.board, game: boardP.game, obstacles: boardP.obstacles }
              : null;
          persistOkRef.current = true;
          const saved = normalizeSpicy(boardP?.spicy);
          // Резюмим слот ТОЛЬКО если он не устарел (уровень = следующий непройденный). Иначе
          // (slot.level ≤ глубины — рассинхрон персиста: глубина ушла вперёд, слот завис) игнорируем,
          // чтобы не предлагать «продолжить» УЖЕ пройденный уровень (прод-баг «всегда L25»).
          if (saved && isResumableSlot(saved, recoveredStats.maxSpicyLevel)) {
            applyState(saved); // рендерим сохранённый уровень ПОД диалогом резюма
            setResumeChoice(saved); // «Продолжить уровень N / Начать заново»
          } else {
            startSpicyLevel(recoveredStats.maxSpicyLevel + 1); // следующий непройденный (слот устарел/нет)
            persistBoard(); // самоисцеление: затереть устаревший слот свежим (как nextLevel/retryLevel/restartLevel)
          }
          setLoading(false);
          scheduleHint();
        } catch (err) {
          if (cancelled) return;
          console.warn('[m3] загрузка «перчинки» не удалась, старт с чистого листа:', err);
          persistOkRef.current = false; // mount-load упал ⇒ НЕ пишем (не рискуем затереть лайт-данные)
          echoLightRef.current = null;
          // §п.0: при сбое CloudStorage — всё равно читаем зеркало (оно в localStorage, доступно).
          const mirrorDepth = depthMirror.read();
          const fallbackStats = mirrorDepth > 0 ? { ...defaultM3Stats(), maxSpicyLevel: mirrorDepth } : defaultM3Stats();
          setStats(fallbackStats);
          startSpicyLevel(fallbackStats.maxSpicyLevel + 1);
          setLoading(false);
          scheduleHint();
        }
      })();
      return () => {
        cancelled = true;
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        clearIdleTimer();
        if (!demoMode && persistOkRef.current) {
          void repo.saveMatch3Stats(statsRef.current).catch(() => {});
        }
      };
    }

    // ДЕМО (?room=demo): эфемерная комната с фикс-seed — НЕ грузим/НЕ перезаписываем реальную партию.
    if (demoMode) {
      const { board: demoBoard, obstacles: demoOb } = createRoomBoard(DEMO_LAYOUT, mulberry32(DEMO_SEED));
      setObstacles(demoOb);
      setBoard(demoBoard);
      setGems(boardToGems(demoBoard, demoOb));
      setGame(defaultM3Game());
      setStats(defaultM3Stats());
      setLoading(false);
      scheduleHint();
      return () => {
        cancelled = true;
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        clearIdleTimer();
      };
    }

    (async () => {
      try {
        const [boardP, statsP] = await Promise.all([repo.loadMatch3Board(), repo.loadMatch3Stats()]);
        if (cancelled) return;
        const loadedStats = normalizeM3Stats(statsP);
        // Эхо спайси-слота: лайт-персист его сохранит (не потеряем незаконченную перчинку). Нет/битый ⇒
        // null ⇒ payload без ключа spicy (байт-в-байт прежний лайт-формат для blob жены без перчинки).
        echoSpicyRef.current = normalizeSpicy(boardP?.spicy);
        if (boardP && Array.isArray(boardP.board) && boardP.board.length > 0) {
          // Новые поля читаем через дефолт: старый board жены без obstacles ⇒ пустые слои (бриф §5).
          const loadedOb = normalizeObstacles(boardP.obstacles);
          setObstacles(loadedOb);
          setBoard(boardP.board);
          setGems(boardToGems(boardP.board, loadedOb));
          setGame(normalizeM3Game(boardP.game));
          setStats(loadedStats);
        } else {
          // Первая партия (в т.ч. первый вход) — считаем начатой, но БЕЗ выдачи.
          const fresh = createBoard(rng);
          setStats({ ...loadedStats, gamesPlayed: loadedStats.gamesPlayed + 1 });
          setGame(defaultM3Game());
          setBoard(fresh);
          setGems(boardToGems(fresh));
        }
        setLoading(false);
        persistBoard();
        persistStats();
        scheduleHint();
      } catch (err) {
        if (cancelled) return;
        console.warn('[m3] загрузка партии не удалась, старт с чистого листа:', err);
        persistOkRef.current = false; // mount-load упал ⇒ НЕ пишем (не затираем реальные данные дефолтом)
        const fresh = createBoard(rng);
        setStats({ ...defaultM3Stats(), gamesPlayed: 1 });
        setGame(defaultM3Game());
        setBoard(fresh);
        setGems(boardToGems(fresh));
        setLoading(false);
        scheduleHint();
      }
    })();
    return () => {
      cancelled = true;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      clearIdleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  // ---- Завершение хода «с перчинкой» (бриф §4): movesLeft--, прогресс цели, evaluateLevel→status
  // (ПОСЛЕ busy=false). Победа → поднять maxSpicyLevel ПЕРЕД grant (иначе веха отстанет на уровень).
  // Поражение → подготовить ретрай (тот же level, новый seed, полный бюджет). Бесконечные ретраи,
  // глубина не теряется. Per-game вехи (m3_score/combo/…) выдаются как в лайте (edge через prevSnapshot). ----
  const finishSpicyMove = useCallback(
    (
      finalBoard: Board,
      agg: { scoreGained: number; gemsCleared: number; maxCascade: number; biggestClear: number; iceCleared: number },
      prevSnapshot: ReturnType<typeof buildM3Snapshot>,
      nextGame: M3CurrentGame,
      isCombo: boolean,
    ) => {
      const ob = obstaclesRef.current; // лёд уже сколот этим ходом (resolveSwap вернул новый ob)
      const g = goalRef.current;
      const newMovesLeft = movesLeftRef.current - 1;
      const newProgress = g ? Math.min(g.target, goalProgressRef.current + agg.iceCleared) : goalProgressRef.current;
      const won = !!g && newProgress >= g.target; // эквивалент countIce(ob)===0 (target = стартовый лёд)
      const lost = !won && newMovesLeft <= 0;

      // m3_combos (level, вживую) + maxSpicyLevel БАМП на победе СТРОГО ПЕРЕД grant (снапшот несёт
      // повышенное значение — иначе веха отстанет на уровень). Максимум монотонен ⇒ ретрай не растит.
      let nextStats = isCombo ? { ...statsRef.current, combos: statsRef.current.combos + 1 } : statsRef.current;
      if (won) {
        nextStats = { ...nextStats, maxSpicyLevel: Math.max(nextStats.maxSpicyLevel, levelRef.current) };
        // §п.0: синхронная запись зеркала — переживает мгновенное закрытие (в отличие от async CloudStorage).
        depthMirror.write(nextStats.maxSpicyLevel);
      }
      if (isCombo || won) setStats(nextStats);

      // Если уровень продолжается и ходов нет — room-aware reshuffle (не софт-локим; доброта).
      let settled = finalBoard;
      if (!won && !lost && !hasAnyMove(settled, ob)) {
        settled = reshuffle(settled, moveRng(), ob);
        setGems(boardToGems(settled, ob));
      }

      setBoard(settled);
      setGame(nextGame);
      setMovesLeft(newMovesLeft);
      setGoalProgress(newProgress);
      setFx(null);
      setBusy(false);

      // status — ПОСЛЕ busy=false (бриф §4).
      if (won) {
        setStatus('won');
      } else if (lost) {
        // Подготовить ретрай (тот же level, новый seed, полный бюджет) — персист запишет ЕГО, а не
        // проигранную доску (бриф §5: проигрыш не оставлять как «продолжить»).
        pendingRetryRef.current = generateLevel(levelRef.current, freshSeed());
        setStatus('lost');
      } else {
        setStatus('playing');
      }

      // Выдача наград (edge через prevSnapshot, как в лайте). На победе nextStats несёт повышенный
      // maxSpicyLevel ⇒ веха глубины срабатывает в момент прохождения порогового уровня.
      if (!demoMode) {
        rewards.grant(GAME_ID, buildM3Snapshot(nextStats, nextGame), prevSnapshot);
        if (won || lost) rewards.notifyGameEnded(); // §B2: посчитать конец партии
      }
      if (isCombo || won) persistStats(); // глубина/комбо durable (монотонно, не теряется)
      persistBoard(); // спайси-слот: снимок уровня / null на победе / ретрай на проигрыше
      if (!won && !lost) scheduleHint(); // под оверлеем победы/поражения подсказку НЕ считаем
    },
    [rewards, persistBoard, persistStats, scheduleHint, demoMode],
  );

  // ---- Завершение хода: коммит per-game статов, выдача наград (edge через prevSnapshot),
  // reshuffle если ходов не осталось, персист. ----
  const finishMove = useCallback(
    (
      finalBoard: Board,
      agg: { scoreGained: number; gemsCleared: number; maxCascade: number; biggestClear: number; iceCleared: number },
      prevSnapshot: ReturnType<typeof buildM3Snapshot>,
      isCombo: boolean,
    ) => {
      // Нормальный путь: гасим watchdog (finishMove прибыл раньше него; recover остаётся no-op).
      if (watchdogRef.current !== null) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      pendingResolveRef.current = null;
      const prevGame = gameRef.current;
      const nextGame: M3CurrentGame = {
        sessionScore: prevGame.sessionScore + agg.scoreGained,
        maxCombo: Math.max(prevGame.maxCombo, agg.maxCascade),
        moves: prevGame.moves + 1,
        biggestClear: Math.max(prevGame.biggestClear, agg.biggestClear),
        gemsThisGame: prevGame.gemsThisGame + agg.gemsCleared,
      };

      // ---- РЕЖИМ «С ПЕРЧИНКОЙ»: ранний выход ПЕРЕД endless-reshuffle (бриф §1/§4). Лайт-хвост ниже
      // (reshuffle/grant/persist) — текущий код буква-в-букву, выполняется только для лайта. ----
      if (mode === 'spicy') {
        finishSpicyMove(finalBoard, agg, prevSnapshot, nextGame, isCombo);
        return;
      }

      // Кумулятивный m3_combos (level): +1, если ход был комбо двух спецфишек (своп двух спецов).
      // Инкрементим прямо в cumulative stats (НЕ per-game) — снапшот ниже его и подхватит.
      const nextStats = isCombo ? { ...statsRef.current, combos: statsRef.current.combos + 1 } : statsRef.current;
      if (isCombo) setStats(nextStats);

      // Расслабленный endless: проигрыша нет, но если ходов не осталось — переразложить.
      // Без reshuffle gems уже совпадают с finalBoard (последний applyStep в playResolve) —
      // НЕ пере-деривим (иначе ремоунт-вспышка); reshuffle меняет поле целиком → новые gems.
      // Room-aware: hasAnyMove/reshuffle/boardToGems учитывают obstacles (обстаклы остаются на местах).
      const ob = obstaclesRef.current;
      let settled = finalBoard;
      if (!hasAnyMove(settled, ob)) {
        settled = reshuffle(settled, rng, ob);
        setGems(boardToGems(settled, ob));
      }

      setBoard(settled);
      setGame(nextGame);
      setFx(null);
      setBusy(false);

      // prevSnapshot — ДО хода: per-game вехи выдаются только при пересечении порога этим ходом
      // (резюм партии с высоким счётом не уронит купон на первом свопе — edge в achievements.ts).
      // В демо награды НЕ трогаем (эфемерный сэндбокс мужа).
      if (!demoMode) rewards.grant(GAME_ID, buildM3Snapshot(nextStats, nextGame), prevSnapshot);
      persistBoard();
      if (isCombo) persistStats();
      scheduleHint(); // поле успокоилось — снова считаем простой для подсказки
    },
    [rewards, persistBoard, persistStats, scheduleHint, demoMode, mode, finishSpicyMove],
  );

  // ---- Проигрыш разрешённого хода по шагам каскада: взрыв (FX) → оседание → следующий шаг →
  // finishMove. Общий путь для свопа и тап-детонации спеца (форма ResolveResult одинакова). ----
  const playResolve = useCallback(
    (res: ResolveResult, prevSnapshot: ReturnType<typeof buildM3Snapshot>, isCombo: boolean) => {
      const agg = {
        scoreGained: res.scoreGained,
        gemsCleared: res.gemsCleared,
        maxCascade: res.maxCascade,
        biggestClear: res.biggestClear,
        iceCleared: res.iceCleared, // спайси: разморожено льдин за ход (лайт игнорирует — обстаклов нет)
      };
      const steps: CascadeStep[] = res.steps;

      // Safety-net (бриф freeze-fix уровень 1): финал хода посчитан синхронно ДО анимации.
      // Если after()-цепочка оборвётся mid-каскада, watchdog применит этот финал — busy не залипнет.
      pendingResolveRef.current = { board: res.board, obstacles: res.obstacles, agg, prevSnapshot, isCombo };
      const watchdogMs = SWAP_MS + steps.length * (CLEAR_MS + SETTLE_MS) + 5000;
      watchdogRef.current = setTimeout(() => {
        const pending = pendingResolveRef.current;
        if (!pending || !aliveRef.current) return;
        pendingResolveRef.current = null;
        watchdogRef.current = null;
        animTimersRef.current.forEach(clearTimeout);
        animTimersRef.current = [];
        setObstacles(pending.obstacles);
        setBoard(pending.board);
        setGems(boardToGems(pending.board, pending.obstacles));
        setFx(null);
        console.warn('[m3] stuck move recovered', { level: levelRef.current, steps: steps.length });
        finishMove(pending.board, pending.agg, pending.prevSnapshot, pending.isCombo);
      }, watchdogMs);

      let celebrated = false; // один праздник на ход, даже если крупных шагов несколько
      const playStep = (i: number) => {
        if (i >= steps.length) {
          finishMove(res.board, agg, prevSnapshot, isCombo);
          return;
        }
        const st = steps[i];
        setFx({ cleared: st.cleared, detonated: st.detonated });
        if (st.detonated.length) haptics.impact('heavy');
        // Праздник на крупном клире (≥20 фишек за шаг): конфетти + вспышка поля — в момент взрыва,
        // а не в конце хода. Только один раз за ход (не на каждом шаге каскада).
        if (!celebrated && st.clearedCount >= BIG_CLEAR) {
          celebrated = true;
          celebrate();
          setFlash((f) => f + 1);
          haptics.notify('success');
        }
        after(CLEAR_MS, () => {
          // board (plain) — для logic/тача; gems (id) — настоящее падение: очищенные уходят
          // (exit), выжившие слайдятся, рефилл влетает сверху. applyStep синхронен с logic.
          // ob ДО шага (obstaclesRef) — для сегментной гравитации; затем продвигаем к ob ПОСЛЕ
          // (st.obstacles, с уже сколотым льдом). Эндлесс: st.obstacles === тот же пустой ref ⇒ без ре-рендера.
          const obBefore = obstaclesRef.current;
          setBoard(st.board);
          setGems(applyStep(gemsRef.current, st, obBefore));
          if (st.obstacles !== obBefore) setObstacles(st.obstacles);
          setFx(null);
          after(SETTLE_MS, () => playStep(i + 1));
        });
      };
      after(SWAP_MS, () => playStep(0));
    },
    [after, finishMove],
  );

  // ---- Ход: своп двух соседних фишек. Невалидный своп — откат. ----
  const swap = useCallback(
    (a: Coord, b: Coord) => {
      if (loading || busyRef.current) return;
      if (spicyInputBlocked()) return; // под оверлеем победы/поражения/резюма ввод заблокирован
      setHint(null); // действие игрока гасит подсказку
      clearIdleTimer();
      const cur = boardRef.current;
      const ob = obstaclesRef.current;
      // Обстакл (блок/лёд) не свопается: своп с ним/из него — тихий no-op (без отката-вэйгла; иначе
      // swapGems увёл бы фишку на блок-клетку). Эндлесс ⇒ static никогда не true ⇒ ветка не достигается.
      if (isStatic(a.r, a.c, ob) || isStatic(b.r, b.c, ob)) {
        scheduleHint();
        return;
      }
      if (!isValidSwap(cur, a, b, ob)) {
        // Откат: фишки слайдятся местами и возвращаются назад (как в матч-3 без совпадения).
        setBusy(true);
        const original = cur;
        setBoard(applySwap(cur, a, b));
        setGems(swapGems(gemsRef.current, a, b));
        haptics.impact('light');
        after(REVERT_MS, () => {
          setBoard(original);
          setGems(swapGems(gemsRef.current, a, b)); // слайд обратно
          setBusy(false);
          scheduleHint();
        });
        return;
      }

      setBusy(true);
      const prevSnapshot = buildM3Snapshot(statsRef.current, gameRef.current);
      // Комбо двух спецфишек (своп двух спецов) → кумулятивный m3_combos +1 (см. finishMove).
      const isCombo = !!(cur[a.r]?.[a.c]?.special && cur[b.r]?.[b.c]?.special);
      // Спайси: детерминированный play-поток (резюм/реплей воспроизводимы, задача №0). Лайт: rng=Math.random.
      const res = resolveSwap(cur, a, b, moveRng(), ob);

      // Слайд свопа (gems по id), затем каскады по шагам (искры → падение).
      setBoard(applySwap(cur, a, b));
      setGems(swapGems(gemsRef.current, a, b));
      haptics.impact('medium');
      playResolve(res, prevSnapshot, isCombo);
    },
    [loading, after, playResolve, clearIdleTimer, scheduleHint],
  );

  // ---- Тап-детонация спеца «на месте» (Candy Crush): без свопа поле сразу детонирует спец в
  // cell и каскадит. Вызывается из Match3.tsx, когда тапнули по СПЕЦфишке. ----
  const activateAt = useCallback(
    (cell: Coord) => {
      if (loading || busyRef.current) return;
      if (spicyInputBlocked()) return; // под оверлеем победы/поражения/резюма ввод заблокирован
      const cur = boardRef.current;
      const ob = obstaclesRef.current;
      const gem = cur[cell.r]?.[cell.c];
      if (!gem?.special) return; // защита: детонировать можно только спец
      if (isStatic(cell.r, cell.c, ob)) return; // замороженный/блок не детонирует (бриф §1)

      setHint(null); // действие игрока гасит подсказку
      clearIdleTimer();
      setBusy(true);
      const prevSnapshot = buildM3Snapshot(statsRef.current, gameRef.current);
      const res = activateInPlace(cur, cell, moveRng(), ob); // спайси: play-поток; лайт: Math.random

      // Тап-детонация одного спеца — это НЕ комбо двух спецов (isCombo=false).
      // Свопа нет — поле не трогаем до первого шага; FX/оседание проигрывает playResolve.
      haptics.impact('medium');
      playResolve(res, prevSnapshot, false);
    },
    [loading, playResolve, clearIdleTimer],
  );

  // ---- Свайп: своп фишки `from` к соседу в направлении dir (для тач-управления). ----
  const swapDir = useCallback(
    (from: Coord, dir: 'up' | 'down' | 'left' | 'right') => {
      const to: Coord = {
        r: from.r + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0),
        c: from.c + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0),
      };
      if (to.r < 0 || to.c < 0 || to.r >= SIZE || to.c >= SIZE) return;
      swap(from, to);
    },
    [swap],
  );

  // ---- Новая игра ----
  const startNewGame = useCallback(() => {
    // Перчинка: «новая игра» = свежий уровень на текущей глубине (бриф §1, startNewGame-развилка).
    if (mode === 'spicy') {
      startSpicyLevel(statsRef.current.maxSpicyLevel + 1);
      setConfirmNewGame(false);
      persistBoard();
      scheduleHint();
      return;
    }
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    animTimersRef.current.forEach(clearTimeout);
    animTimersRef.current = [];
    if (watchdogRef.current !== null) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    pendingResolveRef.current = null;
    clearIdleTimer();
    // prevSnapshot ДО коммита — чтобы edge-гейт глубины сработал и здесь (лайт «новая игра» НЕ меняет
    // maxSpicyLevel ⇒ prev==snapshot по глубине ⇒ alreadyCrossed ⇒ веха-ужин не перевыдаётся). Адверс-чек.
    const prevSnapshot = buildM3Snapshot(statsRef.current, gameRef.current);
    let nextStats = commitM3Game(statsRef.current, gameRef.current);
    nextStats = { ...nextStats, gamesPlayed: nextStats.gamesPlayed + 1 };

    // Демо пересоздаёт комнату (с обстаклами); эндлесс — обычное чистое поле (obstacles пусты).
    const { board: fresh, obstacles: freshOb } = demoMode
      ? createRoomBoard(DEMO_LAYOUT, rng)
      : { board: createBoard(rng), obstacles: emptyObstacles() };
    setStats(nextStats);
    setGame(defaultM3Game());
    setObstacles(freshOb);
    setBoard(fresh);
    setGems(boardToGems(fresh, freshOb));
    setFx(null);
    setHint(null);
    setBusy(false);
    setConfirmNewGame(false);

    if (!demoMode) {
      rewards.notifyGameEnded(); // §B2: посчитать конец партии (лайт)
      rewards.sweep({ refreshReminder: true });
      rewards.grant(GAME_ID, buildM3Snapshot(nextStats, defaultM3Game()), prevSnapshot);
    }

    persistBoard();
    persistStats();
    scheduleHint();
  }, [rewards, persistBoard, persistStats, clearIdleTimer, scheduleHint, demoMode, mode, startSpicyLevel]);

  // ---- Жизненный цикл уровня «с перчинкой»: следующий / ретрай / резюм / заново (бриф §4). ----
  /** Победа → следующий уровень (level+1, свежая раскладка). Гасит in-flight таймеры (внутри startSpicyLevel). */
  const nextLevel = useCallback(() => {
    if (mode !== 'spicy') return;
    startSpicyLevel(levelRef.current + 1);
    persistBoard();
    scheduleHint();
  }, [mode, startSpicyLevel, persistBoard, scheduleHint]);

  /** Поражение → «ещё разок»: тот же уровень, новый seed, полный бюджет (подготовлен в finishSpicyMove). */
  const retryLevel = useCallback(() => {
    if (mode !== 'spicy') return;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    animTimersRef.current.forEach(clearTimeout);
    animTimersRef.current = [];
    if (watchdogRef.current !== null) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    pendingResolveRef.current = null;
    clearIdleTimer();
    const retry = pendingRetryRef.current;
    if (retry) {
      pendingRetryRef.current = null;
      applyState(spicyStateFromLevel(retry));
    } else {
      startSpicyLevel(levelRef.current); // страховка: перегенерить тот же уровень
    }
    persistBoard();
    scheduleHint();
  }, [mode, applyState, startSpicyLevel, clearIdleTimer, persistBoard, scheduleHint]);

  /** Вход с незаконченным уровнем → «Продолжить»: доска уже применена (applyState), просто играем. */
  const resumeLevel = useCallback(() => {
    setResumeChoice(null);
    scheduleHint();
  }, [scheduleHint]);

  /** Вход с незаконченным уровнем → «Начать заново»: тот же уровень с нуля (новый seed). */
  const restartLevel = useCallback(() => {
    const lvl = resumeChoiceRef.current?.level ?? statsRef.current.maxSpicyLevel + 1;
    setResumeChoice(null);
    startSpicyLevel(lvl);
    persistBoard();
    scheduleHint();
  }, [startSpicyLevel, persistBoard, scheduleHint]);

  const requestNewGame = useCallback(() => {
    // Не начинать новую игру, пока анимируется ход: иначе in-flight ход (счёт/комбо/награды)
    // потеряется, а поле сменится посреди анимации. У 2048 такого нет — там ход синхронный.
    if (busyRef.current) return;
    if (gameRef.current.moves > 0) {
      // Гасим подсказку и таймер: иначе пульс мигал бы на поле ПОД диалогом подтверждения.
      setHint(null);
      clearIdleTimer();
      setConfirmNewGame(true);
    } else {
      startNewGame();
    }
  }, [startNewGame, clearIdleTimer]);

  // Отмена диалога — возвращаемся к партии: снова считаем простой для подсказки.
  const cancelNewGame = useCallback(() => {
    setConfirmNewGame(false);
    scheduleHint();
  }, [scheduleHint]);

  /** §B1: потратить купон-«желание» (small/medium) → +5 ходов и продолжить проигранный уровень. */
  const spendWishAndContinue = useCallback((): boolean => {
    // #2 (адверс-ревью): гард от ДВОЙНОЙ траты. statusRef синхронно флипается в 'playing' на первом
    // вызове ⇒ быстрый второй клик (overlay ещё в DOM на exit-анимации AnimatePresence) отвалится тут.
    if (mode !== 'spicy' || statusRef.current !== 'lost') return false;
    const ok = rewards.spendCouponForRetry();
    if (!ok) return false;
    setMovesLeft(movesLeftRef.current + 5);
    setStatus('playing');
    pendingRetryRef.current = null;
    // (перепрогон, MEDIUM): lost-ветка finishSpicyMove НЕ решафлит — проигранная доска могла остаться
    // без валидных свопов. Гарантируем ход, иначе купон сгорел бы на мёртвой доске (зеркало строк 531-534).
    const obWish = obstaclesRef.current;
    if (!hasAnyMove(boardRef.current, obWish)) {
      const settled = reshuffle(boardRef.current, moveRng(), obWish);
      setBoard(settled);
      setGems(boardToGems(settled, obWish));
    }
    persistBoard(); // #3 (адверс-ревью): статус='playing' ⇒ currentSpicyState() запишет ЖИВОЙ
    // продолженный раунд (board/progress/+5 ходов), а не свежий ретрай — иначе закрытие аппы откатит.
    scheduleHint();
    return true;
  }, [mode, rewards, scheduleHint, persistBoard]);

  return {
    loading,
    board,
    gems,
    obstacles,
    fx,
    busy,
    hint,
    flash,
    score: game.sessionScore,
    bestScore: Math.max(stats.bestScore, game.sessionScore),
    combo: game.maxCombo,
    confirmNewGame,
    swap,
    swapDir,
    activateAt,
    notifyActivity,
    requestNewGame,
    startNewGame,
    cancelNewGame,
    // ---- Режим «с перчинкой» (бриф §1). Лайт отдаёт константные дефолты ⇒ его UI не меняется. ----
    mode,
    level,
    movesLeft: mode === 'spicy' ? movesLeft : Infinity,
    goal,
    goalProgress,
    status,
    maxSpicyLevel: stats.maxSpicyLevel,
    resumeChoice,
    nextLevel,
    retryLevel,
    resumeLevel,
    restartLevel,
    spendWishAndContinue,
  };
}

export type Match3Api = ReturnType<typeof useMatch3>;
