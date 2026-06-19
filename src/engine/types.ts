import type { Achievement, Reward, Tier } from '../content/types';

/**
 * Cumulative-показатели 2048 — живут вечно (DESIGN §4).
 *
 * ХАБ-неймспейс (DESIGN-HUB §3): «хаб-глобальные» поля dailyStreak/lastPlayedDate/
 * firstPlayedDate/rewardsRedeemed теперь принадлежат наградному слою и хранятся в
 * `Progress`. Здесь они оставлены как LEGACY-форма старого ключа `stats` — читаются
 * ОДИН раз при миграции (seedGlobals), 2048 их больше не обновляет и НЕ кладёт в свой
 * снапшот (buildSnapshot их не отдаёт). Тип не урезаем, чтобы старый blob читался без
 * потерь и без правок существующих тестов.
 */
export interface CumulativeStats {
  /** Сумма очков по ЗАВЕРШЁННЫМ партиям (текущая прибавляется в snapshot). */
  totalScore: number;
  bestScore: number;
  bestTile: number;
  gamesPlayed: number;
  totalMoves: number;
  /** @deprecated legacy — владелец dailyStreak теперь rewards (GlobalStats в Progress). */
  dailyStreak: number;
  /** @deprecated legacy — см. GlobalStats. */
  lastPlayedDate: string | null; // YYYY-MM-DD
  /** @deprecated legacy — см. GlobalStats. */
  firstPlayedDate: string | null;
  /** @deprecated legacy — счётчик «подарено N» переехал в GlobalStats (Progress). */
  rewardsRedeemed: number;
}

/**
 * Хаб-глобальные показатели — игро-независимы, владелец наградный слой (DESIGN-HUB §3).
 * Хранятся внутри ключа `progress` (см. `Progress extends Partial<GlobalStats>`).
 *  - `rewardsRedeemed` — «подарено N радостей» по всему хабу.
 *  - `dailyStreak`/`lastPlayedDate`/`firstPlayedDate` — ХАБ-стрик: играла в любую игру.
 */
export interface GlobalStats {
  rewardsRedeemed: number;
  dailyStreak: number;
  lastPlayedDate: string | null; // YYYY-MM-DD
  firstPlayedDate: string | null;
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

/**
 * Прогресс ачивок и анти-грайнд-счётчики (DESIGN §7, ключ `progress`).
 *
 * Также НЕСЁТ хаб-глобальные показатели (`Partial<GlobalStats>`): наградный слой —
 * единственный владелец ключа `progress`, поэтому глобальные счётчики хаба переехали
 * сюда из 2048-`stats` (DESIGN-HUB §4, миграция через seedGlobals). Поля опциональны:
 * `undefined` = «ещё не мигрировано» (сентинел для одноразового сидинга из старого stats).
 */
export interface Progress extends Partial<GlobalStats> {
  /**
   * id заданий, чей купон ИСПОЛЬЗОВАН — пройдены НАВСЕГДА, больше не выпадают
   * (DESIGN §15). Сгорание купона сюда ничего не добавляет → задание снова доступно.
   */
  completed: string[];
  /** id challenge -> epoch ms, когда кулдаун истекает. */
  challengeCooldowns: Record<string, number>;
  /** @deprecated Больше не обновляется. Хранится для обратной совместимости сохранённых данных. */
  challengeCouponsToday: number;
  /** Лёгкие купоны (small/medium без rewardId) — суммарно выдано сегодня по всему хабу. */
  easyCouponsTotalToday: number;
  /** Лёгкие купоны — выдано сегодня по каждой игре. */
  easyCouponsByGameToday: Record<string, number>;
  /** Локальная дата (YYYY-MM-DD), к которой относятся счётчики. Сброс в полночь. */
  couponDayDate: string;
  /** Онбординг показан (один раз при первом запуске). */
  onboardingSeen?: boolean;
  /** При каком числе заданий показан победный баннер (чтобы повторить, если конфиг вырос). */
  victorySeenForCount?: number;
  /** §B2: сколько партий сыграно сегодня (сбрасывается в полночь вместе с couponDayDate). */
  gamesPlayedToday?: number;
  /** §B2: когда последний раз показывали реверс-подарок (YYYY-MM-DD), null = не показывали. */
  reverseGiftDate?: string | null;
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

/** 'redeemed' — использован; 'expired' — сгорел; 'spent' — потрачен на ретрай (§B1). */
export type HistoryReason = 'redeemed' | 'expired' | 'spent';

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

export type SkipReason = 'notTriggered' | 'alreadyCrossed' | 'completed' | 'pending' | 'cooldown' | 'dailyCap';

export interface SkippedAchievement {
  id: string;
  reason: SkipReason;
}

export const DAY_MS = 86_400_000;
