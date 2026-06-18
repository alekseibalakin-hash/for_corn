import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSnapshot,
  commitGame,
  defaultCurrentGame,
  defaultStats,
  normalizeStats,
  type CumulativeStats,
  type CurrentGameStats,
} from '../../engine';
import { createInitialGrid } from '../../game/spawn';
import { isGameOver } from '../../game/status';
import { maxTile } from '../../game/grid';
import { WIN_TILE, type Direction } from '../../game/types';
import { haptics } from '../../telegram';
import { useRewards } from '../../rewards';
import { gridToTiles, slideTiles, spawnInTiles, tilesToGrid, type Tile } from '../../ui/tiles';

const GAME_ID = '2048';

/**
 * Хук 2048: держит ТОЛЬКО 2048-состояние (доска, партия, 2048-статы, won) и персистит
 * СВОИ ключи (board/stats). Наградный слой игро-независим: на каждом ходе/смене партии
 * зовём `rewards.grant('2048', snapshot2048)` — оценку, купоны, раскрытия и кошелёк ведёт
 * RewardsProvider (DESIGN-HUB §2). Стрик/«подарено N»/victory — тоже из rewards.
 */
export function useGame2048() {
  const rewards = useRewards();
  const repo = rewards.repo;

  const [loading, setLoading] = useState(true);
  const [tiles, setTilesState] = useState<Tile[]>([]);
  const [game, setGameState] = useState<CurrentGameStats>(() => defaultCurrentGame(0));
  const [stats, setStatsState] = useState<CumulativeStats>(defaultStats);
  const [won, setWonState] = useState(false);
  const [confirmNewGame, setConfirmNewGame] = useState(false);

  // Зеркала для синхронного чтения внутри обработчиков (без устаревших замыканий).
  const tilesRef = useRef(tiles);
  const gameRef = useRef(game);
  const statsRef = useRef(stats);
  const wonRef = useRef(won);
  const setTiles = (v: Tile[]) => ((tilesRef.current = v), setTilesState(v));
  const setGame = (v: CurrentGameStats) => ((gameRef.current = v), setGameState(v));
  const setStats = (v: CumulativeStats) => ((statsRef.current = v), setStatsState(v));
  const setWon = (v: boolean) => ((wonRef.current = v), setWonState(v));

  // Защита данных: если mount-загрузка упала (транзиентный сбой чтения CloudStorage → loadJSON
  // бросает), НЕ перезаписываем реальные board/stats дефолтом. Гейтим запись до следующего удачного
  // запуска (её партия восстановится при перезаходе). По умолчанию true — нормальный путь не задет.
  const loadOkRef = useRef(true);

  const persistBoard = useCallback(() => {
    if (!loadOkRef.current) return; // mount-load упал — не рискуем затереть реальную партию
    void repo
      .saveBoard({ grid: tilesToGrid(tilesRef.current), game: gameRef.current, won: wonRef.current })
      .catch((err) => console.warn('[2048] не удалось сохранить «board»:', err));
  }, [repo]);
  const persistStats = useCallback(() => {
    if (!loadOkRef.current) return; // mount-load упал — не рискуем затереть реальные статы нулями
    void repo.saveStats(statsRef.current).catch((err) => console.warn('[2048] не удалось сохранить «stats»:', err));
  }, [repo]);

  // ---- Загрузка партии. Гарантированно после boot наградного слоя (Shell гейтит на
  // rewards.loading), поэтому сброс ?reset/версии уже завершён. Награды тут НЕ оцениваем
  // (DESIGN §15) — welcome срабатывает на первом ходу. ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = Date.now();
      try {
        const [boardP, statsP] = await Promise.all([repo.loadBoard(), repo.loadStats()]);
        if (cancelled) return;
        const loaded = normalizeStats(statsP);
        if (boardP) {
          setTiles(gridToTiles(boardP.grid));
          setGame(boardP.game);
          setStats(loaded);
          setWon(boardP.won);
        } else {
          // Первая партия (в т.ч. первый вход в игру) — считаем начатой, но БЕЗ выдачи.
          setStats({ ...loaded, gamesPlayed: loaded.gamesPlayed + 1 });
          setGame(defaultCurrentGame(now));
          setTiles(gridToTiles(createInitialGrid()));
          setWon(false);
        }
        setLoading(false);
        persistBoard();
        persistStats();
      } catch (err) {
        if (cancelled) return;
        console.warn('[2048] загрузка партии не удалась, старт с чистого листа:', err);
        loadOkRef.current = false; // сбой чтения ≠ «данных нет» → НЕ персистим дефолт поверх реальных
        setStats({ ...defaultStats(), gamesPlayed: 1 });
        setGame(defaultCurrentGame(now));
        setTiles(gridToTiles(createInitialGrid()));
        setWon(false);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const gameOver = useMemo(() => !loading && tiles.length > 0 && isGameOver(tilesToGrid(tiles)), [loading, tiles]);

  // ---- Ход ----
  const doMove = useCallback(
    (dir: Direction) => {
      if (loading) return;
      const prevTiles = tilesRef.current;
      if (isGameOver(tilesToGrid(prevTiles))) return;

      const slid = slideTiles(prevTiles, dir);
      if (!slid.moved) return;

      const { tiles: newTiles } = spawnInTiles(slid.tiles);
      const grid = tilesToGrid(newTiles);
      const now = Date.now();
      if (slid.mergedValues.length > 0) haptics.impact('light');

      const newMax = maxTile(grid);
      const prevGame = gameRef.current;
      const nextGame: CurrentGameStats = {
        ...prevGame,
        sessionScore: prevGame.sessionScore + slid.scoreGained,
        movesThisGame: prevGame.movesThisGame + 1,
        maxTileThisGame: Math.max(prevGame.maxTileThisGame, newMax),
        timeToCurrentMaxTileSec:
          newMax > prevGame.maxTileThisGame
            ? Math.round((now - prevGame.gameStartTs) / 1000)
            : prevGame.timeToCurrentMaxTileSec,
      };

      setTiles(newTiles);
      setGame(nextGame);
      if (!wonRef.current && newMax >= WIN_TILE) setWon(true);

      // Наградный слой: оценка ачивок 2048 по снапшоту (global подмешивает rewards).
      // prevGame — состояние ДО хода: per-game вехи выдаются только при пересечении порога
      // этим ходом, иначе резюм партии с высокой плиткой выдал бы их на первом свайпе.
      rewards.grant(GAME_ID, buildSnapshot(statsRef.current, nextGame), buildSnapshot(statsRef.current, prevGame));

      if (isGameOver(grid)) {
        rewards.sweep(); // сгорание просроченных купонов → история
        haptics.notify('warning');
      }
      persistBoard();
    },
    [loading, rewards, persistBoard],
  );

  // ---- Новая игра ----
  const startNewGame = useCallback(() => {
    const now = Date.now();
    let nextStats = commitGame(statsRef.current, gameRef.current);
    nextStats = { ...nextStats, gamesPlayed: nextStats.gamesPlayed + 1 };

    const nextGame = defaultCurrentGame(now);
    const nextTiles = gridToTiles(createInitialGrid());

    setTiles(nextTiles);
    setGame(nextGame);
    setStats(nextStats);
    setWon(false);
    setConfirmNewGame(false);

    rewards.sweep({ refreshReminder: true }); // сгорание «после партии» + обновить баннер
    rewards.grant(GAME_ID, buildSnapshot(nextStats, nextGame)); // вехи на gamesPlayed и т.п.

    persistBoard();
    persistStats();
  }, [rewards, persistBoard, persistStats]);

  const requestNewGame = useCallback(() => {
    if (!gameOver && gameRef.current.movesThisGame > 0) setConfirmNewGame(true);
    else startNewGame();
  }, [gameOver, startNewGame]);

  return {
    loading,
    tiles,
    score: game.sessionScore,
    bestScore: Math.max(stats.bestScore, game.sessionScore),
    won,
    gameOver,
    confirmNewGame,
    move: doMove,
    requestNewGame,
    startNewGame,
    cancelNewGame: () => setConfirmNewGame(false),
  };
}

export type Game2048Api = ReturnType<typeof useGame2048>;
