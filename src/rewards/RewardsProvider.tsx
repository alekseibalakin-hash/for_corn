import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { achievements as allAchievements, rewardById, tierEmoji } from '../content';
import {
  buildGlobalSnapshot,
  defaultProgress,
  evaluateAchievements,
  expiringSoon,
  localYMD,
  mergeSnapshot,
  presentationForTier,
  readGlobalStats,
  redeemCoupon,
  sweepExpired,
  type Coupon,
  type GlobalStats,
  type Grant,
  type HistoryEntry,
  type Progress,
  type StatSnapshot,
} from '../engine';
import { haptics, initTelegram } from '../telegram';
import { createRepository, createStore, STORAGE_VERSION, type GameRepository } from '../storage';
import type { RedeemCelebration, Reveal } from '../ui/uiTypes';
import { bootRewards } from './boot';

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

/**
 * Игро-НЕЗАВИСИМЫЙ наградный слой хаба (DESIGN-HUB §2). Владеет ОБЩИМИ ключами
 * (wallet/history/progress) и всем жизненным циклом приятностей: оценка ачивок,
 * выдача купонов, очередь раскрытий, использование→completed, сгорание, victory.
 * Игра кормит его плоским снапшотом через `grant(gameId, gameSnapshot)`.
 */
export interface RewardsApi {
  /** Идёт загрузка/миграция общего слоя. */
  loading: boolean;
  /** Общий репозиторий — игры грузят/пишут СВОИ ключи (board/stats) через него. */
  repo: GameRepository;

  // --- общее состояние (по всему хабу) ---
  wallet: Coupon[];
  history: HistoryEntry[];
  rewardsRedeemed: number;
  dailyStreak: number;
  completedCount: number;
  totalAchievements: number;

  // --- оверлеи ---
  activeReveal: Reveal | null;
  redeemCelebration: RedeemCelebration | null;
  reminder: Coupon[];
  showVictory: boolean;
  showOnboarding: boolean;

  // --- действия ---
  /**
   * Оценить ачивки активной игры по её снапшоту и выдать купоны (мержит global).
   * prevGameSnapshot — снапшот ДО хода: per-game вехи выдаются только при ПЕРЕСЕЧЕНИИ порога
   * этим ходом (резюм партии с высокой плиткой не выдаёт веху на первом свайпе).
   */
  grant: (gameId: string, gameSnapshot: StatSnapshot, prevGameSnapshot?: StatSnapshot) => void;
  /** Использовать купон: в историю, +1 «подарено», задание → completed навсегда. */
  redeem: (couponId: string) => void;
  /** Перенести просроченные купоны в историю (зовётся на game-over/новой партии). */
  sweep: (opts?: { refreshReminder?: boolean }) => void;
  collectReveal: () => void;
  closeRedeem: () => void;
  dismissReminder: () => void;
  dismissOnboarding: () => void;
  dismissVictory: () => void;
}

const RewardsContext = createContext<RewardsApi | null>(null);

export function useRewards(): RewardsApi {
  const ctx = useContext(RewardsContext);
  if (!ctx) throw new Error('useRewards используется вне <RewardsProvider>');
  return ctx;
}

function useRewardsState(): RewardsApi {
  const repoRef = useRef<GameRepository>();
  if (!repoRef.current) repoRef.current = createRepository(createStore());

  const [loading, setLoading] = useState(true);
  const [wallet, setWalletState] = useState<Coupon[]>([]);
  const [history, setHistoryState] = useState<HistoryEntry[]>([]);
  const [progress, setProgressState] = useState<Progress>(() => defaultProgress(localYMD(0)));
  const [revealQueue, setRevealQueue] = useState<Reveal[]>([]);
  const [redeemCelebration, setRedeemCelebration] = useState<RedeemCelebration | null>(null);
  const [reminder, setReminder] = useState<Coupon[]>([]);

  // Зеркала для синхронного чтения внутри обработчиков (как в исходном useGame).
  const walletRef = useRef(wallet);
  const historyRef = useRef(history);
  const progressRef = useRef(progress);
  const setWallet = (v: Coupon[]) => ((walletRef.current = v), setWalletState(v));
  const setHistory = (v: HistoryEntry[]) => ((historyRef.current = v), setHistoryState(v));
  const setProgress = (v: Progress) => ((progressRef.current = v), setProgressState(v));

  // Защита данных жены: если boot-загрузка ОБЩЕГО слоя упала (транзиентный сбой чтения CloudStorage →
  // loadJSON бросает), НЕ перезаписываем реальные wallet/history/progress дефолтом. Гейтим ВСЕ persist
  // до следующего удачного запуска — её купоны и «выполнено X из N» восстановятся при перезаходе.
  // По умолчанию true ⇒ нормальный путь не задет; false ставится только в catch загрузки.
  const bootOkRef = useRef(true);

  const persist = useCallback(
    (keys: Partial<{ wallet: boolean; history: boolean; progress: boolean }>) => {
      if (!bootOkRef.current) return; // boot-load упал — не затираем её реальные данные дефолтом
      const repo = repoRef.current!;
      const guard = (key: string, p: Promise<unknown>) =>
        void p.catch((err) => console.warn(`[rewards] не удалось сохранить «${key}»:`, err));
      if (keys.wallet) guard('wallet', repo.saveWallet(walletRef.current));
      if (keys.history) guard('history', repo.saveHistory(historyRef.current));
      if (keys.progress) guard('progress', repo.saveProgress(progressRef.current));
    },
    [],
  );

  // ---- Загрузка + аддитивная миграция (DESIGN-HUB §4). Игры монтируются только после
  // booted (Shell гейтит на loading), поэтому сброс ?reset/версии завершается до их старта.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      initTelegram();
      const repo = repoRef.current!;
      const now = Date.now();
      const today = localYMD(now);
      const applyBoot = (input: Parameters<typeof bootRewards>[0]) => {
        const boot = bootRewards(input);
        setWallet(boot.wallet);
        setHistory(boot.history);
        setProgress(boot.progress);
        setReminder(boot.reminder);
        setLoading(false);
      };
      try {
        // Разовый сброс ВСЕХ ключей: по смене STORAGE_VERSION ИЛИ по ?reset=1 (механику не ломаем).
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const forceReset = !!params && params.has('reset');
        const ver = await repo.getVersion();
        if (forceReset || ver !== STORAGE_VERSION) {
          await repo.resetState();
          await repo.setVersion(STORAGE_VERSION);
          if (import.meta.env.DEV) {
            console.info('[storage] состояние сброшено →', STORAGE_VERSION, forceReset ? '(ручной ?reset)' : '(смена версии)');
          }
        }
        // legacyStats — старый 2048-stats blob: нужен РОВНО для сидинга хаб-глобальных статов.
        const [walletP, historyP, progressP, legacyStats] = await Promise.all([
          repo.loadWallet(),
          repo.loadHistory(),
          repo.loadProgress(),
          repo.loadStats() as Promise<Partial<GlobalStats> | null>,
        ]);
        if (cancelled) return;
        applyBoot({ wallet: walletP, history: historyP, progress: progressP, legacyStats, now, today });
        // Сохраняем результат миграции/стрика/сгорания, чтобы он был durable даже при немедленном закрытии.
        persist({ wallet: true, history: true, progress: true });
      } catch (err) {
        console.warn('[rewards] загрузка не удалась, общий слой с чистого листа:', err);
        if (cancelled) return;
        bootOkRef.current = false; // сбой чтения ≠ «новый игрок» → блокируем persist (см. выше), не теряем её данные
        applyBoot({ wallet: null, history: null, progress: null, legacyStats: null, now, today });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Выдача наград активной игры (мерж global ⊕ снапшот игры, DESIGN-HUB §3) ----
  const grant = useCallback(
    (gameId: string, gameSnapshot: StatSnapshot, prevGameSnapshot?: StatSnapshot) => {
      const now = Date.now();
      const today = localYMD(now);
      const globalSnap = buildGlobalSnapshot(readGlobalStats(progressRef.current));
      const snapshot = mergeSnapshot(globalSnap, gameSnapshot);
      const prevSnapshot = prevGameSnapshot ? mergeSnapshot(globalSnap, prevGameSnapshot) : undefined;
      const evalRes = evaluateAchievements({
        snapshot,
        prevSnapshot,
        progress: progressRef.current,
        wallet: walletRef.current,
        now,
        today,
        gameId,
      });
      setProgress(evalRes.progress); // progress меняется всегда (couponDayDate/cooldowns)
      if (evalRes.grants.length) {
        setWallet([...walletRef.current, ...evalRes.grants.map((g) => g.coupon)]);
        setRevealQueue((q) => [...q, ...evalRes.grants.map(buildReveal)]);
        haptics.notify('success');
        persist({ wallet: true, progress: true });
      } else {
        persist({ progress: true });
      }
    },
    [persist],
  );

  // ---- Использование купона: задание пройдено НАВСЕГДА (completed), +1 «подарено» ----
  const redeem = useCallback(
    (couponId: string) => {
      const coupon = walletRef.current.find((c) => c.id === couponId);
      if (!coupon) return;
      const now = Date.now();
      const { wallet: nextWallet, entry } = redeemCoupon(walletRef.current, couponId, now);
      const cur = progressRef.current;
      const nextProgress: Progress = {
        ...cur,
        rewardsRedeemed: (cur.rewardsRedeemed ?? 0) + 1,
        completed: cur.completed.includes(coupon.achievementId)
          ? cur.completed
          : [...cur.completed, coupon.achievementId],
      };
      setWallet(nextWallet);
      setHistory([entry, ...historyRef.current]);
      setProgress(nextProgress);
      setReminder(expiringSoon(nextWallet, now));
      haptics.notify('success');

      const reward = rewardById(coupon.rewardId);
      setRedeemCelebration({
        tier: coupon.tier,
        emoji: tierEmoji(coupon.tier),
        rewardTitle: reward?.title ?? 'Сюрприз',
        rewardText: reward?.text ?? '',
        note: coupon.note,
      });
      persist({ wallet: true, history: true, progress: true });
    },
    [persist],
  );

  // ---- Сгорание по чекпойнтам игры (game-over / новая партия), как в исходнике ----
  const sweep = useCallback(
    (opts?: { refreshReminder?: boolean }) => {
      const now = Date.now();
      const swept = sweepExpired(walletRef.current, now);
      if (swept.expired.length) {
        setWallet(swept.wallet);
        setHistory([...swept.expired, ...historyRef.current]);
        persist({ wallet: true, history: true });
      }
      if (opts?.refreshReminder) setReminder(expiringSoon(walletRef.current, now));
    },
    [persist],
  );

  const collectReveal = useCallback(() => setRevealQueue((q) => q.slice(1)), []);
  const closeRedeem = useCallback(() => setRedeemCelebration(null), []);
  const dismissReminder = useCallback(() => setReminder([]), []);

  const dismissOnboarding = useCallback(() => {
    setProgress({ ...progressRef.current, onboardingSeen: true });
    persist({ progress: true });
  }, [persist]);

  const dismissVictory = useCallback(() => {
    setProgress({ ...progressRef.current, victorySeenForCount: TOTAL_ACHIEVEMENTS });
    persist({ progress: true });
  }, [persist]);

  const completedCount = progress.completed.length;
  const allCompleted = TOTAL_ACHIEVEMENTS > 0 && allAchievements.every((a) => progress.completed.includes(a.id));

  return {
    loading,
    repo: repoRef.current,
    wallet,
    history,
    rewardsRedeemed: progress.rewardsRedeemed ?? 0,
    dailyStreak: progress.dailyStreak ?? 0,
    completedCount,
    totalAchievements: TOTAL_ACHIEVEMENTS,
    activeReveal: revealQueue[0] ?? null,
    redeemCelebration,
    reminder,
    showVictory: allCompleted && progress.victorySeenForCount !== TOTAL_ACHIEVEMENTS,
    showOnboarding: !loading && !progress.onboardingSeen,
    grant,
    redeem,
    sweep,
    collectReveal,
    closeRedeem,
    dismissReminder,
    dismissOnboarding,
    dismissVictory,
  };
}

export function RewardsProvider({ children }: { children: ReactNode }) {
  const value = useRewardsState();
  return <RewardsContext.Provider value={value}>{children}</RewardsContext.Provider>;
}
