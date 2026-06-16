import {
  dailyCheckIn,
  expiringSoon,
  normalizeProgress,
  readGlobalStats,
  seedGlobals,
  sweepExpired,
  type Coupon,
  type GlobalStats,
  type HistoryEntry,
  type Progress,
} from '../engine';

/**
 * Сырьё для загрузки наградного слоя. `legacyStats` — старый 2048-`stats` blob, нужен
 * РОВНО для одноразового сидинга хаб-глобальных статов (rewardsRedeemed/dailyStreak/даты),
 * см. seedGlobals. Все поля могут быть null (новый игрок / битое хранилище).
 */
export interface RewardsBootInput {
  wallet: Coupon[] | null;
  history: HistoryEntry[] | null;
  progress: Partial<Progress> | null;
  legacyStats: Partial<GlobalStats> | null;
  now: number;
  today: string; // локальная дата YYYY-MM-DD
}

export interface RewardsBootState {
  wallet: Coupon[];
  history: HistoryEntry[];
  progress: Progress; // нормализован + мигрирован + отмечен «играла сегодня»
  reminder: Coupon[]; // купоны, сгорающие в ближайшие сутки (баннер на входе)
}

/**
 * Чистая загрузка наградного слоя — БЕЗ React, поэтому полностью тестируема (это
 * доказательство аддитивной миграции, DESIGN-HUB §4). Делает строго:
 *  1) нормализует прогресс (мягкое чтение, старая форма не ломает);
 *  2) МИГРАЦИЯ: сеет хаб-глобальные статы из legacy 2048-stats, если ещё не мигрировано
 *     (лосслесс, одноразово, без сброса) — кошелёк/история/completed НЕ трогаются;
 *  3) ХАБ-стрик: отмечает «играла в любую игру сегодня» (идемпотентно за день);
 *  4) сгорание просроченных купонов на входе (в историю) + баннер «скоро сгорят».
 */
export function bootRewards(input: RewardsBootInput): RewardsBootState {
  // 1) нормализация + 2) миграция глобальных статов (сентинел: progress.rewardsRedeemed===undefined)
  let progress = normalizeProgress(input.progress, input.today);
  progress = seedGlobals(progress, input.legacyStats);

  // 3) хаб-стрик: «играла сегодня» (открытие хаба = открытие приложения = вход)
  const globals = dailyCheckIn(readGlobalStats(progress), input.today);
  progress = { ...progress, ...globals };

  // 4) сгорание на входе (DESIGN §6): просроченные купоны → история
  let wallet = input.wallet ?? [];
  let history = input.history ?? [];
  const swept = sweepExpired(wallet, input.now);
  if (swept.expired.length) {
    wallet = swept.wallet;
    history = [...swept.expired, ...history];
  }

  return { wallet, history, progress, reminder: expiringSoon(wallet, input.now) };
}
