import { useCallback, useEffect, useRef, useState } from 'react';
import { useRewards } from '../../rewards';
import { haptics } from '../../telegram';
import {
  activateInPlace,
  applySwap,
  createBoard,
  hasAnyMove,
  isValidSwap,
  reshuffle,
  resolveSwap,
  SIZE,
  type Board,
  type CascadeStep,
  type Coord,
  type ResolveResult,
  type Rng,
} from './logic';
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

const GAME_ID = 'm3';
const rng: Rng = Math.random;

// Тайминги анимации хода (мс): своп (слайд) → взрыв-искры → оседание (layout-spring), по каскаду.
// SETTLE ≈ время осёдки spring stiffness700/damping42 — короче → следующий шаг стартует посреди
// падения = джиттер. CLEAR — окно искр перед падением.
const SWAP_MS = 160;
const CLEAR_MS = 140;
const SETTLE_MS = 220;
const REVERT_MS = 160;

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
export function useMatch3() {
  const rewards = useRewards();
  const repo = rewards.repo;

  const [loading, setLoading] = useState(true);
  const [board, setBoardState] = useState<Board>([]);
  // Визуальный слой со стабильными id (gems.ts) — держим ПАРАЛЛЕЛЬНО plain-полю `board`:
  // gems рисуют падение (layout по id), а board остаётся для logic/тача/handleTap и персиста.
  const [gems, setGemsState] = useState<VisualGem[]>([]);
  const [game, setGameState] = useState<M3CurrentGame>(defaultM3Game);
  const [stats, setStatsState] = useState<M3CumulativeStats>(defaultM3Stats);
  const [busy, setBusyState] = useState(false); // идёт анимация хода — вход заблокирован
  const [fx, setFx] = useState<M3Fx | null>(null);
  const [confirmNewGame, setConfirmNewGame] = useState(false);

  // Зеркала для синхронного чтения в обработчиках (как в useGame2048).
  const boardRef = useRef(board);
  const gemsRef = useRef(gems);
  const gameRef = useRef(game);
  const statsRef = useRef(stats);
  const busyRef = useRef(busy);
  const aliveRef = useRef(true);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const setBoard = (v: Board) => ((boardRef.current = v), setBoardState(v));
  const setGems = (v: VisualGem[]) => ((gemsRef.current = v), setGemsState(v));
  const setGame = (v: M3CurrentGame) => ((gameRef.current = v), setGameState(v));
  const setStats = (v: M3CumulativeStats) => ((statsRef.current = v), setStatsState(v));
  const setBusy = (v: boolean) => ((busyRef.current = v), setBusyState(v));

  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      // Убираем отработавший таймер, чтобы массив не рос за длинную endless-партию.
      timersRef.current = timersRef.current.filter((t) => t !== id);
      if (aliveRef.current) fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  const persistBoard = useCallback(() => {
    void repo
      .saveMatch3Board({ board: boardRef.current, game: gameRef.current })
      .catch((err) => console.warn('[m3] не удалось сохранить «match3.board»:', err));
  }, [repo]);
  const persistStats = useCallback(() => {
    void repo
      .saveMatch3Stats(statsRef.current)
      .catch((err) => console.warn('[m3] не удалось сохранить «match3.stats»:', err));
  }, [repo]);

  // ---- Загрузка партии. После boot наградного слоя (Shell гейтит на rewards.loading).
  // Награды тут НЕ оцениваем (как 2048): вехи срабатывают на первом ходе. ----
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [boardP, statsP] = await Promise.all([repo.loadMatch3Board(), repo.loadMatch3Stats()]);
        if (cancelled) return;
        const loadedStats = normalizeM3Stats(statsP);
        if (boardP && Array.isArray(boardP.board) && boardP.board.length > 0) {
          setBoard(boardP.board);
          setGems(boardToGems(boardP.board));
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
      } catch (err) {
        if (cancelled) return;
        console.warn('[m3] загрузка партии не удалась, старт с чистого листа:', err);
        const fresh = createBoard(rng);
        setStats({ ...defaultM3Stats(), gamesPlayed: 1 });
        setGame(defaultM3Game());
        setBoard(fresh);
        setGems(boardToGems(fresh));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      aliveRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  // ---- Завершение хода: коммит per-game статов, выдача наград (edge через prevSnapshot),
  // reshuffle если ходов не осталось, персист. ----
  const finishMove = useCallback(
    (
      finalBoard: Board,
      agg: { scoreGained: number; gemsCleared: number; maxCascade: number; biggestClear: number },
      prevSnapshot: ReturnType<typeof buildM3Snapshot>,
    ) => {
      const prevGame = gameRef.current;
      const nextGame: M3CurrentGame = {
        sessionScore: prevGame.sessionScore + agg.scoreGained,
        maxCombo: Math.max(prevGame.maxCombo, agg.maxCascade),
        moves: prevGame.moves + 1,
        biggestClear: Math.max(prevGame.biggestClear, agg.biggestClear),
        gemsThisGame: prevGame.gemsThisGame + agg.gemsCleared,
      };

      // Расслабленный endless: проигрыша нет, но если ходов не осталось — переразложить.
      // Без reshuffle gems уже совпадают с finalBoard (последний applyStep в playResolve) —
      // НЕ пере-деривим (иначе ремоунт-вспышка); reshuffle меняет поле целиком → новые gems.
      let settled = finalBoard;
      if (!hasAnyMove(settled)) {
        settled = reshuffle(settled, rng);
        setGems(boardToGems(settled));
      }

      setBoard(settled);
      setGame(nextGame);
      setFx(null);
      setBusy(false);

      // prevSnapshot — ДО хода: per-game вехи выдаются только при пересечении порога этим ходом
      // (резюм партии с высоким счётом не уронит купон на первом свопе — edge в achievements.ts).
      rewards.grant(GAME_ID, buildM3Snapshot(statsRef.current, nextGame), prevSnapshot);
      persistBoard();
    },
    [rewards, persistBoard],
  );

  // ---- Проигрыш разрешённого хода по шагам каскада: взрыв (FX) → оседание → следующий шаг →
  // finishMove. Общий путь для свопа и тап-детонации спеца (форма ResolveResult одинакова). ----
  const playResolve = useCallback(
    (res: ResolveResult, prevSnapshot: ReturnType<typeof buildM3Snapshot>) => {
      const agg = {
        scoreGained: res.scoreGained,
        gemsCleared: res.gemsCleared,
        maxCascade: res.maxCascade,
        biggestClear: res.biggestClear,
      };
      const steps: CascadeStep[] = res.steps;
      const playStep = (i: number) => {
        if (i >= steps.length) {
          finishMove(res.board, agg, prevSnapshot);
          return;
        }
        const st = steps[i];
        setFx({ cleared: st.cleared, detonated: st.detonated });
        if (st.detonated.length) haptics.impact('heavy');
        after(CLEAR_MS, () => {
          // board (plain) — для logic/тача; gems (id) — настоящее падение: очищенные уходят
          // (exit), выжившие слайдятся, рефилл влетает сверху. applyStep синхронен с logic.
          setBoard(st.board);
          setGems(applyStep(gemsRef.current, st));
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
      const cur = boardRef.current;
      if (!isValidSwap(cur, a, b)) {
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
        });
        return;
      }

      setBusy(true);
      const prevSnapshot = buildM3Snapshot(statsRef.current, gameRef.current);
      const res = resolveSwap(cur, a, b, rng);

      // Слайд свопа (gems по id), затем каскады по шагам (искры → падение).
      setBoard(applySwap(cur, a, b));
      setGems(swapGems(gemsRef.current, a, b));
      haptics.impact('medium');
      playResolve(res, prevSnapshot);
    },
    [loading, after, playResolve],
  );

  // ---- Тап-детонация спеца «на месте» (Candy Crush): без свопа поле сразу детонирует спец в
  // cell и каскадит. Вызывается из Match3.tsx, когда тапнули по СПЕЦфишке. ----
  const activateAt = useCallback(
    (cell: Coord) => {
      if (loading || busyRef.current) return;
      const cur = boardRef.current;
      const gem = cur[cell.r]?.[cell.c];
      if (!gem?.special) return; // защита: детонировать можно только спец

      setBusy(true);
      const prevSnapshot = buildM3Snapshot(statsRef.current, gameRef.current);
      const res = activateInPlace(cur, cell, rng);

      // Свопа нет — поле не трогаем до первого шага; FX/оседание проигрывает playResolve.
      haptics.impact('medium');
      playResolve(res, prevSnapshot);
    },
    [loading, playResolve],
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
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    let nextStats = commitM3Game(statsRef.current, gameRef.current);
    nextStats = { ...nextStats, gamesPlayed: nextStats.gamesPlayed + 1 };

    const fresh = createBoard(rng);
    setStats(nextStats);
    setGame(defaultM3Game());
    setBoard(fresh);
    setGems(boardToGems(fresh));
    setFx(null);
    setBusy(false);
    setConfirmNewGame(false);

    rewards.sweep({ refreshReminder: true });
    rewards.grant(GAME_ID, buildM3Snapshot(nextStats, defaultM3Game()));

    persistBoard();
    persistStats();
  }, [rewards, persistBoard, persistStats]);

  const requestNewGame = useCallback(() => {
    // Не начинать новую игру, пока анимируется ход: иначе in-flight ход (счёт/комбо/награды)
    // потеряется, а поле сменится посреди анимации. У 2048 такого нет — там ход синхронный.
    if (busyRef.current) return;
    if (gameRef.current.moves > 0) setConfirmNewGame(true);
    else startNewGame();
  }, [startNewGame]);

  return {
    loading,
    board,
    gems,
    fx,
    busy,
    score: game.sessionScore,
    bestScore: Math.max(stats.bestScore, game.sessionScore),
    combo: game.maxCombo,
    confirmNewGame,
    swap,
    swapDir,
    activateAt,
    requestNewGame,
    startNewGame,
    cancelNewGame: () => setConfirmNewGame(false),
  };
}

export type Match3Api = ReturnType<typeof useMatch3>;
