import { useCallback, useEffect, useRef, useState } from 'react';
import { useRewards } from '../../rewards';
import { haptics } from '../../telegram';
import { celebrate } from '../../ui/confetti';
import {
  anyPlacement,
  canPlace,
  cloneGrid,
  clearLines,
  countBlocks,
  place,
  score,
  type Coord,
  type Grid,
  type Piece,
} from './logic';
import {
  blocksStateFromLevel,
  generateLevel,
  isResumableBlocksSlot,
  makePieceStream,
  normalizeBlocks,
  type BlockGoal,
  type BlockLevel,
  type BlockLevelState,
  type PieceStream,
} from './levels';
import { blocksDepthMirror } from '../match3/depthMirror';
import {
  buildBBSnapshot,
  commitBBGame,
  defaultBBGame,
  defaultBBStats,
  normalizeBBStats,
  recoverBBDepth,
  type BBCumulativeStats,
  type BBCurrentGame,
} from './stats';

const GAME_ID = 'bb';

/** Случайный seed генерации уровня (сам уровень детерминирован своим seed — задача №0 спайси). */
const freshSeed = (): number => (Math.random() * 0x7fffffff) >>> 0;

// Окно «прожига» линий: показываем поставленную фигуру, затем линии сгорают. Один таймер на ход +
// watchdog (урок §6 — busy НИКОГДА не залипает). Размещения БЕЗ клира финализируются синхронно (без
// таймера и без busy вовсе) — самый частый случай.
const CLEAR_MS = 200;
// Праздник: столько линий за одно размещение → конфетти (редкий «сочный» момент, не на каждом клире).
const BIG_LINES = 3;

type Status = 'playing' | 'won' | 'lost';

/** Текущий набор: 3 слота, null = фигура уже поставлена (стабильные ключи в трее). */
type Tray = (Piece | null)[];

/** Финал хода, посчитанный синхронно ДО анимации прожига (watchdog применит его, если таймер оборвётся). */
interface PendingResolve {
  nextGrid: Grid;
  nextTray: Tray;
  nextSetsLeft: number;
  nextStreamPos: number;
  newProgress: number;
  nextGame: BBCurrentGame;
  nextStats: BBCumulativeStats; // с уже поднятой maxLevel на победе (ПЕРЕД grant — иначе веха отстанет)
  prevSnapshot: ReturnType<typeof buildBBSnapshot>;
  won: boolean;
  lost: boolean;
}

/** Активный визуальный эффект клира (подсветка сожжённых клеток в Blocks.tsx). */
export interface BBFx {
  cleared: Coord[];
}

/**
 * Хук «Блоков-фигур» (Фаза 2) — зеркало useMatch3 спайси, но проще: один поуровневый режим, ходы
 * СИНХРОННЫ (нет каскадов/гравитации). Держит ТОЛЬКО bb-состояние и персистит СВОИ ключи bb_board/
 * bb_stats (без точек, §2.4). Durable глубина через blocksDepthMirror (max(cloud, mirror) на загрузке,
 * синхронная запись на победе — §2.2). Награды через игро-независимый слой: rewards.grant('bb', снапшот,
 * prevSnapshot) — edge-гейт глубины и per-game вех (§2.1). Добрый бесконечный ретрай, глубина не теряется.
 */
export function useBlocks() {
  const rewards = useRewards();
  const repo = rewards.repo;

  const [loading, setLoading] = useState(true);
  const [grid, setGridState] = useState<Grid>([]);
  const [tray, setTrayState] = useState<Tray>([null, null, null]);
  const [level, setLevelState] = useState(0);
  const [setsLeft, setSetsLeftState] = useState(0);
  const [goal, setGoalState] = useState<BlockGoal | null>(null);
  const [progress, setProgressState] = useState(0);
  const [status, setStatusState] = useState<Status>('playing');
  const [busy, setBusyState] = useState(false); // идёт прожиг линий — вход заблокирован
  const [fx, setFx] = useState<BBFx | null>(null);
  const [flash, setFlash] = useState(0); // ++ на крупном клире/победе → UI проигрывает вспышку поля
  const [stats, setStatsState] = useState<BBCumulativeStats>(defaultBBStats);
  const [game, setGameState] = useState<BBCurrentGame>(defaultBBGame);
  // Незаконченный уровень при входе → диалог «Продолжить / Заново» (null = выбора нет).
  const [resumeChoice, setResumeChoiceState] = useState<BlockLevelState | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  // Зеркала для синхронного чтения в обработчиках (как в useMatch3/useGame2048).
  const gridRef = useRef(grid);
  const trayRef = useRef(tray);
  const levelRef = useRef(level);
  const setsLeftRef = useRef(setsLeft);
  const goalRef = useRef(goal);
  const progressRef = useRef(progress);
  const statusRef = useRef(status);
  const busyRef = useRef(busy);
  const statsRef = useRef(stats);
  const gameRef = useRef(game);
  const resumeChoiceRef = useRef(resumeChoice);
  const setGrid = (v: Grid) => ((gridRef.current = v), setGridState(v));
  const setTray = (v: Tray) => ((trayRef.current = v), setTrayState(v));
  const setLevel = (v: number) => ((levelRef.current = v), setLevelState(v));
  const setSetsLeft = (v: number) => ((setsLeftRef.current = v), setSetsLeftState(v));
  const setGoal = (v: BlockGoal | null) => ((goalRef.current = v), setGoalState(v));
  const setProgress = (v: number) => ((progressRef.current = v), setProgressState(v));
  const setStatus = (v: Status) => ((statusRef.current = v), setStatusState(v));
  const setBusy = (v: boolean) => ((busyRef.current = v), setBusyState(v));
  const setStats = (v: BBCumulativeStats) => ((statsRef.current = v), setStatsState(v));
  const setGame = (v: BBCurrentGame) => ((gameRef.current = v), setGameState(v));
  const setResumeChoice = (v: BlockLevelState | null) => ((resumeChoiceRef.current = v), setResumeChoiceState(v));

  // Play-поток уровня: резюм продолжает ТОТ ЖЕ поток (§2.5). streamPos — сколько фигур вытянуто.
  const seedRef = useRef(0);
  const streamRef = useRef<PieceStream | null>(null);
  const streamPosRef = useRef(0);
  // Подготовленный ретрай при проигрыше (тот же level, новый seed, полный бюджет).
  const pendingRetryRef = useRef<BlockLevel | null>(null);
  // Если mount-загрузка bb_board/bb_stats упала — НЕ пишем (риск стереть реальные данные дефолтом).
  const persistOkRef = useRef(true);
  const aliveRef = useRef(true);
  // Анимационные таймеры (прожиг). Lifecycle-cleanup [repo] НЕ трогает их — только истинный unmount и
  // явный старт уровня. Это корневой фикс зависания (урок §6): ре-ран [repo] не обрывает финал хода.
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResolveRef = useRef<PendingResolve | null>(null);

  /** Вход заблокирован: грузимся, идёт прожиг, показан оверлей победы/поражения/резюма. */
  const inputBlocked = useCallback(
    (): boolean =>
      loading || busyRef.current || statusRef.current !== 'playing' || !!resumeChoiceRef.current,
    [loading],
  );

  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      animTimersRef.current = animTimersRef.current.filter((t) => t !== id);
      if (aliveRef.current) fn();
    }, ms);
    animTimersRef.current.push(id);
  }, []);

  /** Сбросить все in-flight таймеры/watchdog/pending прошлого хода (на старте нового уровня/unmount). */
  const clearAnims = useCallback(() => {
    animTimersRef.current.forEach(clearTimeout);
    animTimersRef.current = [];
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    pendingResolveRef.current = null;
  }, []);

  // ---- Текущий снимок незаконченного уровня (или null = «нет незаконченного»: победа/нет цели). На
  // проигрыше — снимок ПОДГОТОВЛЕННОГО ретрая (тот же level, новый seed), а не проигранной доски (§2.3:
  // проигрыш не оставлять как «продолжить»). ----
  const currentBlocksState = useCallback((): BlockLevelState | null => {
    const st = statusRef.current;
    if (st === 'won') return null;
    if (st === 'lost') return pendingRetryRef.current ? blocksStateFromLevel(pendingRetryRef.current) : null;
    const g = goalRef.current;
    if (!g) return null;
    const pieces = trayRef.current.filter((p): p is Piece => !!p);
    return {
      level: levelRef.current,
      seed: seedRef.current,
      setsLeft: setsLeftRef.current,
      goal: g,
      progress: progressRef.current,
      streamPos: streamPosRef.current,
      grid: gridRef.current,
      currentPieces: pieces,
    };
  }, []);

  const persistBoard = useCallback(() => {
    if (!persistOkRef.current) return; // mount-load упал — не рискуем затереть реальные данные
    void repo
      .saveBlocksBoard({ level: currentBlocksState() })
      .catch((err) => console.warn('[bb] не удалось сохранить «bb_board»:', err));
  }, [repo, currentBlocksState]);

  const persistStats = useCallback(() => {
    if (!persistOkRef.current) return;
    void repo
      .saveBlocksStats(statsRef.current)
      .catch((err) => console.warn('[bb] не удалось сохранить «bb_stats»:', err));
  }, [repo]);

  // ---- Применить состояние уровня к полю (старт/резюм). Восстанавливает play-поток на нужной позиции
  // (резюм продолжает ТОТ ЖЕ поток — §2.5). НЕ трогает cumulative stats (gamesPlayed считается отдельно). ----
  const applyState = useCallback((st: BlockLevelState) => {
    clearAnims();
    seedRef.current = st.seed;
    streamRef.current = makePieceStream(st.seed, st.streamPos);
    streamPosRef.current = st.streamPos;
    setLevel(st.level);
    setSetsLeft(st.setsLeft);
    setGoal(st.goal);
    setProgress(st.progress);
    setGrid(cloneGrid(st.grid));
    // Восстанавливаем трей: фигуры в первые слоты, добиваем null до 3 (стабильные ключи).
    const pieces = st.currentPieces.slice(0, 3);
    setTray([pieces[0] ?? null, pieces[1] ?? null, pieces[2] ?? null]);
    setStatus('playing');
    setBusy(false);
    setFx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearAnims]);

  /** Свежий уровень = новая попытка: считаем gamesPlayed++ (для вехи «сыграй N уровней»). */
  const beginFresh = useCallback(
    (lvl: BlockLevel) => {
      pendingRetryRef.current = null;
      const nextStats = { ...statsRef.current, gamesPlayed: statsRef.current.gamesPlayed + 1 };
      setStats(nextStats);
      setGame(defaultBBGame());
      applyState(blocksStateFromLevel(lvl));
      persistStats();
    },
    [applyState, persistStats],
  );

  /** Сгенерировать и запустить свежий уровень N (гасит in-flight таймеры прошлого уровня). */
  const startLevel = useCallback(
    (levelNum: number) => {
      beginFresh(generateLevel(Math.max(1, levelNum), freshSeed()));
    },
    [beginFresh],
  );

  // Истинный unmount: гасим aliveRef + anim-таймеры ТОЛЬКО здесь (empty deps). Lifecycle-cleanup [repo]
  // ниже НЕ трогает их — ре-ран при смене репо не обрывает финал хода (корневой фикс зависания, §6).
  useEffect(() => {
    return () => {
      aliveRef.current = false;
      clearAnims();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Загрузка уровня + статов. После boot наградного слоя (Shell гейтит на rewards.loading). ----
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [boardP, statsP] = await Promise.all([repo.loadBlocksBoard(), repo.loadBlocksStats()]);
        if (cancelled) return;
        const loaded = normalizeBBStats(statsP);
        // §2.2 read-repair: зеркало пережило быстрое закрытие, CloudStorage отстал → берём max.
        const recovered = recoverBBDepth(loaded, blocksDepthMirror.read());
        setStats(recovered);
        persistOkRef.current = true;
        if (recovered.maxLevel > loaded.maxLevel) {
          void repo.saveBlocksStats(recovered).catch((err) => console.warn('[bb] не удалось сохранить восстановленную глубину:', err));
        }
        const saved = normalizeBlocks(boardP?.level);
        // Резюмим слот ТОЛЬКО если он не устарел (level === глубина+1). Иначе игнорируем + self-heal
        // (затираем устаревший слот свежим), чтобы не предлагать «продолжить» пройденный уровень (§2.3).
        if (saved && isResumableBlocksSlot(saved, recovered.maxLevel)) {
          applyState(saved); // рендерим сохранённый уровень ПОД диалогом резюма
          setResumeChoice(saved); // «Продолжить уровень N / Начать заново»
          setLoading(false);
        } else {
          setLoading(false);
          startLevel(recovered.maxLevel + 1); // следующий непройденный (слот устарел/нет)
          persistBoard(); // самоисцеление: затереть устаревший слот свежим
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('[bb] загрузка не удалась, старт с чистого листа:', err);
        persistOkRef.current = false; // mount-load упал ⇒ НЕ пишем (не затираем реальные данные дефолтом)
        // §2.2: при сбое CloudStorage — всё равно читаем зеркало (оно в localStorage, доступно).
        const mirror = blocksDepthMirror.read();
        const fallback = mirror > 0 ? { ...defaultBBStats(), maxLevel: mirror } : defaultBBStats();
        setStats(fallback);
        setLoading(false);
        startLevel(fallback.maxLevel + 1);
      }
    })();
    return () => {
      cancelled = true;
      if (persistOkRef.current) {
        void repo.saveBlocksStats(statsRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  // ---- Применить финал хода (после прожига линий ИЛИ синхронно, если линий не было). Победа → maxLevel
  // уже поднят в pending ПЕРЕД grant. Поражение → подготовить ретрай. Награды edge через prevSnapshot. ----
  const finalizeMove = useCallback(() => {
    const p = pendingResolveRef.current;
    if (!p) return;
    pendingResolveRef.current = null;
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }

    setGrid(p.nextGrid);
    setTray(p.nextTray);
    setSetsLeft(p.nextSetsLeft);
    streamPosRef.current = p.nextStreamPos;
    setProgress(p.newProgress);
    setGame(p.nextGame);
    setFx(null);
    setBusy(false);

    // На завершении уровня (победа/поражение) вкатываем очки уровня в cumulative (totalScore/bestScore).
    // На победе nextStats уже несёт поднятую maxLevel ⇒ commit её сохраняет.
    const ended = p.won || p.lost;
    const endStats = ended ? commitBBGame(p.nextStats, p.nextGame) : p.nextStats;
    setStats(endStats);

    if (p.won) {
      setStatus('won');
    } else if (p.lost) {
      // Подготовить ретрай (тот же level, новый seed, полный бюджет) — персист запишет ЕГО, а не
      // проигранную доску (§2.3: проигрыш не оставлять как «продолжить»).
      pendingRetryRef.current = generateLevel(levelRef.current, freshSeed());
      setStatus('lost');
    } else {
      setStatus('playing');
    }

    // Выдача наград (edge через prevSnapshot). На победе nextStats несёт повышенный maxLevel ⇒ веха
    // глубины срабатывает РОВНО на ходе пересечения порога (и не перевыдаётся на резюме — edge-гейт §2.1).
    rewards.grant(GAME_ID, buildBBSnapshot(p.nextStats, p.nextGame), p.prevSnapshot);
    if (ended) {
      rewards.notifyGameEnded(); // §B2: посчитать конец партии (hub-wide)
      persistStats(); // глубина/очки durable
    }
    persistBoard(); // снимок уровня / null на победе / ретрай на проигрыше
  }, [rewards, persistBoard, persistStats]);

  // ---- Ход: поставить фигуру tray[pieceIndex] с якорем (r, c). Невалид — тихий no-op (UI не даёт
  // отпустить на невалидной клетке). Размещение + клир СИНХРОННЫ; прожиг линий — короткая визуальная
  // анимация, финал гарантирован watchdog'ом (busy не залипает, §6). ----
  const placePiece = useCallback(
    (pieceIndex: number, r: number, c: number) => {
      if (inputBlocked()) return;
      const piece = trayRef.current[pieceIndex];
      if (!piece) return;
      const curGrid = gridRef.current;
      if (!canPlace(curGrid, piece, r, c)) return;
      const g = goalRef.current;
      if (!g) return;

      const prevStats = statsRef.current;
      const prevGame = gameRef.current;
      const prevSnapshot = buildBBSnapshot(prevStats, prevGame);

      const placed = place(curGrid, piece, r, c);
      const res = clearLines(placed); // { grid, clearedRows, clearedCols, clearedBlocks }
      const lines = res.clearedRows + res.clearedCols;
      const gained = score(piece.cells.length, res.clearedRows, res.clearedCols);
      const nextGrid = res.grid;
      const blocksLeft = countBlocks(nextGrid);
      const newProgress = g.target - blocksLeft; // единый источник правды — сетка (а не накопитель)
      const won = blocksLeft === 0;

      // Трей: убрать поставленную фигуру; если набор кончился — вытянуть новый из ТОГО ЖЕ потока.
      const trayAfter: Tray = [...trayRef.current];
      trayAfter[pieceIndex] = null;
      let nextTray = trayAfter;
      let nextSetsLeft = setsLeftRef.current;
      let nextStreamPos = streamPosRef.current;
      let lost = false;

      if (!won) {
        const remaining = trayAfter.some((p) => !!p);
        if (!remaining) {
          // Набор полностью поставлен → списать набор.
          nextSetsLeft = setsLeftRef.current - 1;
          if (nextSetsLeft <= 0) {
            lost = true; // лимит наборов исчерпан
          } else if (streamRef.current) {
            const set = streamRef.current.nextSet();
            nextTray = [set[0], set[1], set[2]];
            nextStreamPos = streamRef.current.pos();
          }
        }
        // Тупик: ни одна из оставшихся (текущих или только что выданных) фигур никуда не влезает.
        if (!lost) {
          const live = nextTray.filter((p): p is Piece => !!p);
          if (live.length > 0 && !live.some((p) => anyPlacement(nextGrid, p))) lost = true;
        }
      }

      const nextGame: BBCurrentGame = {
        sessionScore: prevGame.sessionScore + gained,
        moves: prevGame.moves + 1,
        bestLines: Math.max(prevGame.bestLines, lines),
      };
      // maxLevel БАМП на победе СТРОГО ПЕРЕД grant (снапшот несёт повышенное значение — иначе веха
      // отстанет на уровень). Монотонен ⇒ ретрай/перепрохождение не растят (§2.1).
      let nextStats = prevStats;
      if (won) {
        nextStats = { ...prevStats, maxLevel: Math.max(prevStats.maxLevel, levelRef.current) };
        // §2.2: синхронная запись зеркала — переживает мгновенное закрытие (в отличие от async CloudStorage).
        blocksDepthMirror.write(nextStats.maxLevel);
      }

      // Тактильная отдача + праздник (сразу, для отзывчивости).
      if (won) {
        haptics.notify('success');
        celebrate();
        setFlash((f) => f + 1);
      } else if (lines >= 2) {
        haptics.impact('heavy');
        setFlash((f) => f + 1);
        if (lines >= BIG_LINES) celebrate();
      } else if (lines === 1) {
        haptics.impact('medium');
      } else {
        haptics.impact('light');
      }

      const pending: PendingResolve = {
        nextGrid, nextTray, nextSetsLeft, nextStreamPos, newProgress, nextGame, nextStats, prevSnapshot, won, lost,
      };

      if (lines === 0) {
        // Нет клира — финал синхронен, никакой анимации/busy (самый частый случай).
        pendingResolveRef.current = pending;
        finalizeMove();
        return;
      }

      // Есть клир: показываем поставленную фигуру + искры, затем прожиг (grid → nextGrid) в finalizeMove.
      setBusy(true);
      setGrid(placed); // фигура видна целиком до прожига
      setTray(trayAfter); // поставленная фигура ушла из трея сразу
      const cleared: Coord[] = [];
      for (let rr = 0; rr < placed.length; rr++)
        for (let cc = 0; cc < placed[rr].length; cc++)
          if (placed[rr][cc] !== 'empty' && nextGrid[rr][cc] === 'empty') cleared.push({ r: rr, c: cc });
      setFx({ cleared });
      pendingResolveRef.current = pending;
      // watchdog: если after()-цепочка оборвётся — busy не залипнет (применим финал принудительно, §6).
      watchdogRef.current = setTimeout(() => {
        if (!aliveRef.current || !pendingResolveRef.current) return;
        watchdogRef.current = null;
        animTimersRef.current.forEach(clearTimeout);
        animTimersRef.current = [];
        console.warn('[bb] stuck move recovered', { level: levelRef.current });
        finalizeMove();
      }, CLEAR_MS + 4000);
      after(CLEAR_MS, finalizeMove);
    },
    [inputBlocked, after, finalizeMove],
  );

  // ---- Жизненный цикл уровня (бриф §4). ----
  /** Победа → следующий уровень (level+1, свежая раскладка). */
  const nextLevel = useCallback(() => {
    startLevel(levelRef.current + 1);
    persistBoard();
  }, [startLevel, persistBoard]);

  /** Поражение → «ещё разок»: тот же уровень, новый seed, полный бюджет (подготовлен в finalizeMove). */
  const retryLevel = useCallback(() => {
    const retry = pendingRetryRef.current;
    beginFresh(retry ?? generateLevel(levelRef.current, freshSeed()));
    persistBoard();
  }, [beginFresh, persistBoard]);

  /** Вход с незаконченным уровнем → «Продолжить»: доска уже применена (applyState), просто играем. */
  const resumeLevel = useCallback(() => {
    setResumeChoice(null);
  }, []);

  /** Вход с незаконченным уровнем → «Начать заново»: тот же уровень с нуля (новый seed). */
  const restartLevel = useCallback(() => {
    const lvl = resumeChoiceRef.current?.level ?? statsRef.current.maxLevel + 1;
    setResumeChoice(null);
    startLevel(lvl);
    persistBoard();
  }, [startLevel, persistBoard]);

  /** Кнопка «Заново» в HUD: подтверждение, если уже были ходы (иначе сразу). */
  const requestRestart = useCallback(() => {
    if (busyRef.current) return;
    if (gameRef.current.moves > 0) setConfirmRestart(true);
    else startLevel(levelRef.current);
  }, [startLevel]);

  const confirmRestartLevel = useCallback(() => {
    setConfirmRestart(false);
    startLevel(levelRef.current);
    persistBoard();
  }, [startLevel, persistBoard]);

  const cancelRestart = useCallback(() => setConfirmRestart(false), []);

  const blocksLeft = goal ? Math.max(0, goal.target - progress) : 0;

  return {
    loading,
    grid,
    tray,
    level,
    setsLeft,
    goal,
    progress,
    blocksLeft,
    status,
    busy,
    fx,
    flash,
    maxLevel: stats.maxLevel,
    score: game.sessionScore,
    resumeChoice,
    confirmRestart,
    placePiece,
    canPlaceAt: (pieceIndex: number, r: number, c: number) => {
      const piece = trayRef.current[pieceIndex];
      return !!piece && canPlace(gridRef.current, piece, r, c);
    },
    nextLevel,
    retryLevel,
    resumeLevel,
    restartLevel,
    requestRestart,
    confirmRestartLevel,
    cancelRestart,
  };
}

export type BlocksApi = ReturnType<typeof useBlocks>;
