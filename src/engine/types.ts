import type { Achievement, Reward, Tier } from '../content/types';

/** Cumulative-показатели — живут вечно (DESIGN §4). */
export interface CumulativeStats {
  /** Сумма очков по ЗАВЕРШЁННЫМ партиям (текущая прибавляется в snapshot). */
  totalScore: number;
  bestScore: number;
  bestTile: number;
  gamesPlayed: number;
  totalMoves: number;
  dailyStreak: number;
  lastPlayedDate: string | null; // YYYY-MM-DD
  firstPlayedDate: string | null;
  /** Сколько купонов использовано — для мета-счётчика «подарено N радостей» (§6). */
  rewardsRedeemed: number;
}

/** Per-game показатели — сбрасываются с новой партией (DESIGN §4). */
export interface CurrentGameStats {
  sessionScore: number;
  maxTileThisGame: number;
  movesThisGame: number;
  gameStartTs: number;
  timeToCurrentMaxTileSec: number;
}

/** Плоский snapshot для движка ачивок (объединяет cumulative + current). */
export type StatSnapshot = Record<string, number>;

/** Прогресс ачивок и анти-грайнд-счётчики (DESIGN §7, ключ `progress`). */
export interface Progress {
  /**
   * id заданий, чей купон ИСПОЛЬЗОВАН — пройдены НАВСЕГДА, больше не выпадают
   * (DESIGN §15). Сгорание купона сюда ничего не добавляет → задание снова доступно.
   */
  completed: string[];
  /** id challenge -> epoch ms, когда кулдаун истекает. */
  challengeCooldowns: Record<string, number>;
  /** Сколько купонов-от-challenge выдано сегодня. */
  challengeCouponsToday: number;
  /** Локальная дата (YYYY-MM-DD), к которой относится счётчик. Сброс в полночь. */
  couponDayDate: string;
  /** Онбординг показан (один раз при первом запуске). */
  onboardingSeen?: boolean;
  /** При каком числе заданий показан победный баннер (чтобы повторить, если конфиг вырос). */
  victorySeenForCount?: number;
}

/** Купон в кошельке (DESIGN §6). Детали награды резолвим из каталога по rewardId. */
export interface Coupon {
  id: string;
  rewardId: string;
  tier: Tier;
  unlockedAt: number;
  expiresAt: number;
  /** Личное слово (с ачивки или награды) — показываем на раскрытии/использовании. */
  note?: string;
  achievementId: string;
}

export type HistoryReason = 'redeemed' | 'expired';

/** Запись истории — без note (экономим байты CloudStorage, DESIGN §7). */
export interface HistoryEntry {
  id: string;
  rewardId: string;
  tier: Tier;
  unlockedAt: number;
  expiresAt: number;
  achievementId: string;
  resolvedAt: number;
  reason: HistoryReason;
}

/** Результат срабатывания ачивки. */
export interface Grant {
  achievement: Achievement;
  reward: Reward;
  coupon: Coupon;
}

export type SkipReason = 'notTriggered' | 'completed' | 'pending' | 'cooldown' | 'dailyCap';

export interface SkippedAchievement {
  id: string;
  reason: SkipReason;
}

export const DAY_MS = 86_400_000;
