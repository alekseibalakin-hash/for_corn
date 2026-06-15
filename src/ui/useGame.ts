import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { achievements as allAchievements, tierEmoji } from '../content';
import {
  buildSnapshot,
  commitGame,
  dailyCheckIn,
  defaultCurrentGame,
  defaultProgress,
  defaultStats,
  evaluateAchievements,
  expiringSoon,
  localYMD,
  normalizeProgress,
  presentationForTier,
  redeemCoupon,
  sweepExpired,
  type Coupon,
  type CumulativeStats,
  type CurrentGameStats,
  type Grant,
  type HistoryEntry,
  type Progress,
} from '../engine';
import { createInitialGrid } from '../game/spawn';
import { isGameOver } from '../game/status';
import { maxTile } from '../game/grid';
import { WIN_TILE, type Direction } from '../game/types';
import { haptics, initTelegram } from '../telegram';
import { createRepository, createStore, type GameRepository } from '../storage';
import { rewardText, rewardTitle } from './format';
import { gridToTiles, slideTiles, spawnInTiles, tilesToGrid, type Tile } from './tiles';
import type { Reveal, RedeemCelebration } from './uiTypes';

const TOTAL_ACHIEVEMENTS = allAchievements.length;

function buildReveal(grant: Grant): Reveal {
  const tier = grant.reward.tier;
  return {
    key: grant.coupon.id,
    couponId: grant.coupon.id,
    tier,
    emoji: tierEmoji(tier),
    achievementTitle: grant.achievement.title,
    rewardTitle: grant.reward.title,
    rewardText: grant.reward.text,
    note: grant.coupon.note,
    presentation: presentationForTier(tier),
  };
}

export function useGame() {
  const repoRef = useRef<GameRepository>();
  if (!repoRef.current) repoRef.current = createRepository(createStore());

  const [loading, setLoading] = useState(true);

  const [tiles, setTilesState] = useState<Tile[]>([]);
  const [game, setGameState] = useState<CurrentGameStats>(() => defaultCurrentGame(0));
  const [stats, setStatsState] = useState<CumulativeStats>(defaultStats);
  const [progress, setProgressState] = useState<Progress>(() => defaultProgress(localYMD(0)));
  const [wallet, setWalletState] = useState<Coupon[]>([]);
  const [history, setHistoryState] = useState<HistoryEntry[]>([]);
  const [won, setWonState] = useState(false);

  const [revealQueue, setRevealQueue] = useState<Reveal[]>([]);
  const [redeemCelebration, setRedeemCelebration] = useState<RedeemCelebration | null>(null);
  const [reminder, setReminder] = useState<Coupon[]>([]);
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [showOnboarding, setShowOnboardingState] = useState(false);

  // Зеркала для синхронного чтения внутри обработчиков (без устаревших замыканий).
  const tilesRef = useRef(tiles);
  const gameRef = useRef(game);
  const statsRef = useRef(stats);
  const progressRef = useRef(progress);
  const walletRef = useRef(wallet);
  const historyRef = useRef(history);
  const wonRef = useRef(won);
  const onboardingRef = useRef(showOnboarding);

  const setTiles = (v: Tile[]) => ((tilesRef.current = v), setTilesState(v));
  const setGame = (v: CurrentGameStats) => ((gameRef.current = v), setGameState(v));
  const setStats = (v: CumulativeStats) => ((statsRef.current = v), setStatsState(v));
  const setProgress = (v: Progress) => ((progressRef.current = v), setProgressState(v));
  const setWallet = (v: Coupon[]) => ((walletRef.current = v), setWalletState(v));
  const setHistory = (v: HistoryEntry[]) => ((historyRef.current = v), setHistoryState(v));
  const setWon = (v: boolean) => ((wonRef.current = v), setWonState(v));
  const setShowOnboarding = (v: boolean) => ((onboardingRef.current = v), setShowOnboardingState(v));

  // Каждая награда показывается карточкой и собирается вручную (DESIGN §15) — единая
  // очередь, ни одна не теряется.
  const dispatchGrants = useCallback((grants: Grant[]) => {
    if (grants.length === 0) return;
    setRevealQueue((q) => [...q, ...grants.map(buildReveal)]);
  }, []);

  const persist = useCallback(
    (keys: Partial<{ board: boolean; stats: boolean; progress: boolean; wallet: boolean; history: boolean }>) => {
      const repo = repoRef.current!;
      const guard = (key: string, p: Promise<unknown>) =>
        void p.catch((err) => console.warn(`[persist] не удалось сохранить «${key}»:`, err));
      if (keys.board) guard('board', repo.saveBoard({ grid: tilesToGrid(tilesRef.current), game: gameRef.current, won: wonRef.current }));
      if (keys.stats) guard('stats', repo.saveStats(statsRef.current));
      if (keys.progress) guard('progress', repo.saveProgress(progressRef.current));
      if (keys.wallet) guard('wallet', repo.saveWallet(walletRef.current));
      if (keys.history) guard('history', repo.saveHistory(historyRef.current));
    },
    [],
  );

  // ---- Инициализация: загрузка, ежедневная отметка, сгорание, resume/новая игра ----
  // ВАЖНО: ачивки тут НЕ оцениваются (DESIGN §15) — никакой награды до первого хода;
  // welcome (gamesPlayed≥1) срабатывает на первом ходу.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      initTelegram();
      const repo = repoRef.current!;
      const now = Date.now();
      const today = localYMD(now);

      let boardP, statsP, walletP, historyP, progressP;
      try {
        [boardP, statsP, walletP, historyP, progressP] = await Promise.all([
          repo.loadBoard(),
          repo.loadStats(),
          repo.loadWallet(),
          repo.loadHistory(),
          repo.loadProgress(),
        ]);
      } catch (err) {
        console.warn('[init] загрузка не удалась, старт с чистого листа:', err);
        if (cancelled) return;
        setTiles(gridToTiles(createInitialGrid()));
        setGame(defaultCurrentGame(now));
        setStats({ ...defaultStats(), gamesPlayed: 1 });
        setProgress(defaultProgress(today));
        setWallet([]);
        setHistory([]);
        setWon(false);
        setShowOnboarding(true);
        setLoading(false);
        return;
      }
      if (cancelled) return;

      let nextStats = dailyCheckIn(statsP ?? defaultStats(), today);
      const nextProgress = normalizeProgress(progressP, today);
      let nextWallet = walletP ?? [];
      let nextHistory = historyP ?? [];

      // Сгорание при открытии (DESIGN §6).
      const swept = sweepExpired(nextWallet, now);
      if (swept.expired.length) {
        nextWallet = swept.wallet;
        nextHistory = [...swept.expired, ...nextHistory];
      }

      let nextTiles: Tile[];
      let nextGame: CurrentGameStats;
      let nextWon: boolean;

      if (boardP) {
        nextTiles = gridToTiles(boardP.grid);
        nextGame = boardP.game;
        nextWon = boardP.won;
      } else {
        // Первая партия (в т.ч. самый первый вход) — считаем её начатой, но БЕЗ выдачи.
        nextStats = { ...nextStats, gamesPlayed: nextStats.gamesPlayed + 1 };
        nextGame = defaultCurrentGame(now);
        nextTiles = gridToTiles(createInitialGrid());
        nextWon = false;
      }

      setTiles(nextTiles);
      setGame(nextGame);
      setStats(nextStats);
      setProgress(nextProgress);
      setWallet(nextWallet);
      setHistory(nextHistory);
      setWon(nextWon);
      setReminder(expiringSoon(nextWallet, now));
      setShowOnboarding(!nextProgress.onboardingSeen);
      setLoading(false);

      persist({ board: true, stats: true, progress: true, wallet: true, history: true });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gameOver = useMemo(() => !loading && tiles.length > 0 && isGameOver(tilesToGrid(tiles)), [loading, tiles]);

  // ---- Ход ----
  const doMove = useCallback(
    (dir: Direction) => {
      if (loading || onboardingRef.current) return; // онбординг блокирует игру
      const prevTiles = tilesRef.current;
      if (isGameOver(tilesToGrid(prevTiles))) return;

      const slid = slideTiles(prevTiles, dir);
      if (!slid.moved) return;

      const { tiles: newTiles } = spawnInTiles(slid.tiles);
      const grid = tilesToGrid(newTiles);
      const now = Date.now();
      const today = localYMD(now);

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

      // Движок ачивок: учитывает кошелёк (pending + разнообразие).
      const snapshot = buildSnapshot(statsRef.current, nextGame);
      const evalRes = evaluateAchievements({ snapshot, progress: progressRef.current, wallet: walletRef.current, now, today });

      let nextWallet = walletRef.current;
      if (evalRes.grants.length) {
        nextWallet = [...nextWallet, ...evalRes.grants.map((g) => g.coupon)];
        haptics.notify('success');
      }

      let nextWon = wonRef.current;
      if (!nextWon && newMax >= WIN_TILE) nextWon = true;

      let nextHistory = historyRef.current;
      const over = isGameOver(grid);
      if (over) {
        const swept = sweepExpired(nextWallet, now);
        if (swept.expired.length) {
          nextWallet = swept.wallet;
          nextHistory = [...swept.expired, ...nextHistory];
        }
        haptics.notify('warning');
      }

      setTiles(newTiles);
      setGame(nextGame);
      setProgress(evalRes.progress);
      if (nextWallet !== walletRef.current) setWallet(nextWallet);
      if (nextHistory !== historyRef.current) setHistory(nextHistory);
      if (nextWon !== wonRef.current) setWon(nextWon);

      persist({ board: true, progress: true, wallet: true, history: over });
      dispatchGrants(evalRes.grants);
    },
    [loading, dispatchGrants, persist],
  );

  // ---- Новая игра ----
  const startNewGame = useCallback(() => {
    const now = Date.now();
    const today = localYMD(now);

    let nextStats = commitGame(statsRef.current, gameRef.current);
    nextStats = { ...nextStats, gamesPlayed: nextStats.gamesPlayed + 1 };
    nextStats = dailyCheckIn(nextStats, today);

    const nextGame = defaultCurrentGame(now);
    const nextTiles = gridToTiles(createInitialGrid());

    // Сгорание «после партии»
    const swept = sweepExpired(walletRef.current, now);
    let nextWallet = swept.wallet;
    let nextHistory = historyRef.current;
    if (swept.expired.length) nextHistory = [...swept.expired, ...nextHistory];

    const snapshot = buildSnapshot(nextStats, nextGame);
    const evalRes = evaluateAchievements({ snapshot, progress: progressRef.current, wallet: nextWallet, now, today });
    if (evalRes.grants.length) nextWallet = [...nextWallet, ...evalRes.grants.map((g) => g.coupon)];

    setTiles(nextTiles);
    setGame(nextGame);
    setStats(nextStats);
    setProgress(evalRes.progress);
    setWallet(nextWallet);
    setHistory(nextHistory);
    setWon(false);
    setReminder(expiringSoon(nextWallet, now));
    setConfirmNewGame(false);

    persist({ board: true, stats: true, progress: true, wallet: true, history: true });
    dispatchGrants(evalRes.grants);
  }, [dispatchGrants, persist]);

  const requestNewGame = useCallback(() => {
    if (!gameOver && gameRef.current.movesThisGame > 0) setConfirmNewGame(true);
    else startNewGame();
  }, [gameOver, startNewGame]);

  // ---- Использование купона: задание пройдено НАВСЕГДА (completed) ----
  const redeem = useCallback(
    (couponId: string) => {
      const coupon = walletRef.current.find((c) => c.id === couponId);
      if (!coupon) return;
      const now = Date.now();
      const { wallet: nextWallet, entry } = redeemCoupon(walletRef.current, couponId, now);
      const nextStats: CumulativeStats = { ...statsRef.current, rewardsRedeemed: statsRef.current.rewardsRedeemed + 1 };
      const nextHistory = [entry, ...historyRef.current];

      // Задание этого купона — завершено навсегда (больше не выпадет).
      const cur = progressRef.current;
      const nextProgress: Progress = cur.completed.includes(coupon.achievementId)
        ? cur
        : { ...cur, completed: [...cur.completed, coupon.achievementId] };

      setWallet(nextWallet);
      setStats(nextStats);
      setHistory(nextHistory);
      setProgress(nextProgress);
      setReminder(expiringSoon(nextWallet, now));
      haptics.notify('success');

      setRedeemCelebration({
        tier: coupon.tier,
        emoji: tierEmoji(coupon.tier),
        rewardTitle: rewardTitle(coupon),
        rewardText: rewardText(coupon),
        note: coupon.note,
      });

      persist({ wallet: true, stats: true, history: true, progress: true });
    },
    [persist],
  );

  const collectReveal = useCallback(() => setRevealQueue((q) => q.slice(1)), []);
  const closeRedeem = useCallback(() => setRedeemCelebration(null), []);
  const dismissReminder = useCallback(() => setReminder([]), []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    setProgress({ ...progressRef.current, onboardingSeen: true });
    persist({ progress: true });
  }, [persist]);

  const dismissVictory = useCallback(() => {
    setProgress({ ...progressRef.current, victorySeenForCount: TOTAL_ACHIEVEMENTS });
    persist({ progress: true });
  }, [persist]);

  const grid = useMemo(() => tilesToGrid(tiles), [tiles]);
  const bestScore = Math.max(stats.bestScore, game.sessionScore);
  const boardMax = useMemo(() => maxTile(grid), [grid]);

  const completedCount = progress.completed.length;
  const allCompleted = TOTAL_ACHIEVEMENTS > 0 && allAchievements.every((a) => progress.completed.includes(a.id));
  const showVictory = allCompleted && progress.victorySeenForCount !== TOTAL_ACHIEVEMENTS;

  return {
    loading,
    tiles,
    grid,
    score: game.sessionScore,
    bestScore,
    boardMax,
    won,
    gameOver,
    wallet,
    history,
    rewardsRedeemed: stats.rewardsRedeemed,
    dailyStreak: stats.dailyStreak,
    completedCount,
    totalAchievements: TOTAL_ACHIEVEMENTS,
    // overlays
    activeReveal: revealQueue[0] ?? null,
    redeemCelebration,
    reminder,
    confirmNewGame,
    showOnboarding,
    showVictory,
    // actions
    move: doMove,
    requestNewGame,
    startNewGame,
    cancelNewGame: () => setConfirmNewGame(false),
    redeem,
    collectReveal,
    closeRedeem,
    dismissReminder,
    dismissOnboarding,
    dismissVictory,
  };
}

export type GameApi = ReturnType<typeof useGame>;
