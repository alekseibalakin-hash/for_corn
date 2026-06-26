import { useCallback, useEffect, useRef, useState } from 'react';
import { useRewards } from '../../rewards';
import { haptics } from '../../telegram';
import { celebrate } from '../../ui/confetti';
import { type Coord, type FlowCurrentGame, type FlowPair } from './logic';
import {
  flowStateFromLevel,
  generateLevel,
  isResumableFlowSlot,
  normalizeFlow,
  type FlowLevelState,
} from './levels';
import { flowDepthMirror } from '../match3/depthMirror';
import {
  buildFLSnapshot,
  commitFLGame,
  defaultFLGame,
  defaultFLStats,
  normalizeFLStats,
  recoverFlowDepth,
  type FLCumulativeStats,
} from './stats';

const GAME_ID = 'fl';

const freshSeed = (): number => (Math.random() * 0x7fffffff) >>> 0;

/** Score за уровень: size² × 10 (больше поле → больше очков; глубже → totalScore растёт монотонно). */
const levelScore = (size: number): number => size * size * 10;

type Status = 'playing' | 'won';

/**
 * Хук Flow «Соедини фигурки» (Фаза 2) — зеркало useBlocks, но проще: нет lost/потока/прожига.
 * Статус только playing/won (НЕТ проигрыша — доброта). Победа = isSolvedByPlayer на pointerup.
 * Durable глубина через flowDepthMirror (max(cloud, mirror) на загрузке, синхронная запись на победе).
 * Награды через наградный слой: rewards.grant('fl', снапшот, prevSnapshot) — edge-гейт §2.1.
 */
export function useFlow() {
  const rewards = useRewards();
  const repo = rewards.repo;

  const [loading, setLoading] = useState(true);
  const [level, setLevelState] = useState(0);
  const [size, setSizeState] = useState(5);
  const [pairs, setPairsState] = useState<FlowPair[]>([]);
  const [paths, setPathsState] = useState<Coord[][]>([]);
  const [status, setStatusState] = useState<Status>('playing');
  const [stats, setStatsState] = useState<FLCumulativeStats>(defaultFLStats());
  const [game, setGameState] = useState<FlowCurrentGame>(defaultFLGame());
  // Незаконченный уровень при входе → диалог «Продолжить / Заново».
  const [resumeChoice, setResumeChoiceState] = useState<FlowLevelState | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  // Зеркала для синхронного чтения в обработчиках pointer events (как в useBlocks).
  const levelRef = useRef(level);
  const sizeRef = useRef(size);
  const pairsRef = useRef(pairs);
  const pathsRef = useRef(paths);
  const statusRef = useRef(status);
  const statsRef = useRef(stats);
  const gameRef = useRef(game);
  const resumeChoiceRef = useRef(resumeChoice);
  const seedRef = useRef(0);

  const setLevel = (v: number) => ((levelRef.current = v), setLevelState(v));
  const setSize = (v: number) => ((sizeRef.current = v), setSizeState(v));
  const setPairs = (v: FlowPair[]) => ((pairsRef.current = v), setPairsState(v));
  const setPaths = (v: Coord[][]) => ((pathsRef.current = v), setPathsState(v));
  const setStatus = (v: Status) => ((statusRef.current = v), setStatusState(v));
  const setStats = (v: FLCumulativeStats) => ((statsRef.current = v), setStatsState(v));
  const setGame = (v: FlowCurrentGame) => ((gameRef.current = v), setGameState(v));
  const setResumeChoice = (v: FlowLevelState | null) => ((resumeChoiceRef.current = v), setResumeChoiceState(v));

  // mount-load упал — НЕ пишем (риск стереть реальные данные дефолтом).
  const persistOkRef = useRef(true);
  const aliveRef = useRef(true);

  // ---- Текущий снимок незаконченного уровня (null на победе или при загрузке). ----
  const currentFlowState = useCallback((): FlowLevelState | null => {
    if (statusRef.current === 'won') return null;
    return {
      level: levelRef.current,
      seed: seedRef.current,
      size: sizeRef.current,
      pairs: pairsRef.current,
      paths: pathsRef.current,
      game: gameRef.current,
    };
  }, []);

  const persistBoard = useCallback(() => {
    if (!persistOkRef.current) return;
    void repo
      .saveFlowBoard({ level: currentFlowState() })
      .catch((err) => console.warn('[fl] не удалось сохранить «flow_board»:', err));
  }, [repo, currentFlowState]);

  const persistStats = useCallback(() => {
    if (!persistOkRef.current) return;
    void repo
      .saveFlowStats(statsRef.current)
      .catch((err) => console.warn('[fl] не удалось сохранить «flow_stats»:', err));
  }, [repo]);

  // ---- Применить состояние уровня (старт/резюм). Восстанавливает game (урок Блоков #1). ----
  const applyState = useCallback((st: FlowLevelState) => {
    seedRef.current = st.seed;
    setLevel(st.level);
    setSize(st.size);
    setPairs(st.pairs);
    // Нормализуем paths: paths[i] = путь i-й пары (пустой = ещё не начат). Контракт §2.5 бриф.
    const normalizedPaths = Array.from({ length: st.pairs.length }, (_, i) => st.paths[i] ?? []);
    setPaths(normalizedPaths);
    setGame(st.game); // резюм восстанавливает per-game (счёт/ходы) — иначе HUD-счёт обнулялся бы
    setStatus('playing');
  }, []);

  /** Свежий уровень: gamesPlayed++ (для будущих челленджей «сыграй N уровней»). */
  const beginFresh = useCallback(
    (lvl: ReturnType<typeof generateLevel>) => {
      const nextStats = { ...statsRef.current, gamesPlayed: statsRef.current.gamesPlayed + 1 };
      setStats(nextStats);
      setGame(defaultFLGame());
      applyState(flowStateFromLevel(lvl));
    },
    [applyState],
  );

  const startLevel = useCallback(
    (levelNum: number) => {
      beginFresh(generateLevel(Math.max(1, levelNum), freshSeed()));
    },
    [beginFresh],
  );

  // Истинный unmount: гасим aliveRef ТОЛЬКО здесь.
  useEffect(() => {
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Загрузка уровня + статов (после boot наградного слоя). ----
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [boardP, statsP] = await Promise.all([repo.loadFlowBoard(), repo.loadFlowStats()]);
        if (cancelled) return;
        const loaded = normalizeFLStats(statsP);
        // §2.2 read-repair: зеркало пережило быстрое закрытие, CloudStorage отстал → берём max.
        const recovered = recoverFlowDepth(loaded, flowDepthMirror.read());
        setStats(recovered);
        persistOkRef.current = true;
        if (recovered.maxLevel > loaded.maxLevel) {
          void repo.saveFlowStats(recovered).catch((err) => console.warn('[fl] не удалось сохранить восстановленную глубину:', err));
        }
        const saved = normalizeFlow(boardP?.level);
        // Резюмим слот ТОЛЬКО если level === глубина+1 (§2.3 бриф, урок L25).
        if (saved && isResumableFlowSlot(saved, recovered.maxLevel)) {
          applyState(saved); // рендерим сохранённый уровень ПОД диалогом резюма
          setResumeChoice(saved);
          setLoading(false);
        } else {
          setLoading(false);
          startLevel(recovered.maxLevel + 1);
          persistBoard(); // self-heal: затереть устаревший слот свежим
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('[fl] загрузка не удалась, старт с чистого листа:', err);
        persistOkRef.current = false;
        // §2.2: при сбое CloudStorage — всё равно читаем зеркало (оно в localStorage, доступно).
        const mirror = flowDepthMirror.read();
        const fallback = mirror > 0 ? { ...defaultFLStats(), maxLevel: mirror } : defaultFLStats();
        setStats(fallback);
        setLoading(false);
        startLevel(fallback.maxLevel + 1);
      }
    })();
    return () => {
      cancelled = true;
      if (persistOkRef.current) {
        void repo.saveFlowStats(statsRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  // ---- Обработчик победы (вызывается из Flow.tsx по pointerup). ----
  // Единственный grant-сайт. Победа→grant СИНХРОННА (нет прожига) ⇒ окна гонки нет.
  // Но "Меню" в оверлее победы уже disable через status==='won', поэтому размонтировать до grant нельзя.
  const handleWin = useCallback(() => {
    if (statusRef.current !== 'playing') return;

    const prevSnapshot = buildFLSnapshot(statsRef.current, gameRef.current);

    // Монотонный бамп maxLevel ПЕРЕД grant (§2.1 бриф, edge-гейт несёт новое значение).
    const nextStats = { ...statsRef.current, maxLevel: Math.max(statsRef.current.maxLevel, levelRef.current) };
    // §2.2 бриф: синхронная запись зеркала — переживает мгновенное закрытие.
    flowDepthMirror.write(nextStats.maxLevel);

    const nextGame: FlowCurrentGame = {
      score: levelScore(sizeRef.current),
      moves: gameRef.current.moves,
    };
    const finalStats = commitFLGame(nextStats, nextGame);
    setStats(finalStats);
    setGame(nextGame);
    setStatus('won');

    rewards.grant(GAME_ID, buildFLSnapshot(nextStats, nextGame), prevSnapshot);
    rewards.notifyGameEnded();
    persistStats();
    persistBoard(); // null на победе (status==='won' → currentFlowState()===null)

    haptics.notify('success');
    celebrate();
  }, [rewards, persistBoard, persistStats]);

  // ---- Обновление путей (вызывается из Flow.tsx по pointermove/pointerdown). ----
  const updatePaths = useCallback((newPaths: Coord[][], moveIncrement: number) => {
    setPaths(newPaths);
    if (moveIncrement > 0) {
      const nextGame = { ...gameRef.current, moves: gameRef.current.moves + moveIncrement };
      setGame(nextGame);
    }
  }, []);

  // ---- Жизненный цикл уровня. ----
  const nextLevel = useCallback(() => {
    startLevel(levelRef.current + 1);
    persistBoard();
  }, [startLevel, persistBoard]);

  const resumeLevel = useCallback(() => {
    setResumeChoice(null);
  }, []);

  const restartLevel = useCallback(() => {
    const lvl = resumeChoiceRef.current?.level ?? statsRef.current.maxLevel + 1;
    setResumeChoice(null);
    startLevel(lvl);
    persistBoard();
  }, [startLevel, persistBoard]);

  const requestRestart = useCallback(() => {
    if (gameRef.current.moves > 0) setConfirmRestart(true);
    else {
      startLevel(levelRef.current);
      persistBoard();
    }
  }, [startLevel, persistBoard]);

  const confirmRestartLevel = useCallback(() => {
    setConfirmRestart(false);
    startLevel(levelRef.current);
    persistBoard();
  }, [startLevel, persistBoard]);

  const cancelRestart = useCallback(() => setConfirmRestart(false), []);

  return {
    loading,
    level,
    size,
    pairs,
    paths,
    status,
    maxLevel: stats.maxLevel,
    game,
    resumeChoice,
    confirmRestart,
    // Для Flow.tsx: нужны ref'ы для синхронного чтения в pointer-обработчиках.
    sizeRef,
    pairsRef,
    pathsRef,
    statusRef,
    resumeChoiceRef,
    handleWin,
    updatePaths,
    persistBoard,
    nextLevel,
    resumeLevel,
    restartLevel,
    requestRestart,
    confirmRestartLevel,
    cancelRestart,
  };
}

export type FlowApi = ReturnType<typeof useFlow>;
