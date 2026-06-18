import type { CumulativeStats, CurrentGameStats, GlobalStats, Progress, StatSnapshot } from './types';
import { previousYMD } from './time';

export function defaultStats(): CumulativeStats {
  return {
    totalScore: 0,
    bestScore: 0,
    bestTile: 0,
    gamesPlayed: 0,
    totalMoves: 0,
    dailyStreak: 0,
    lastPlayedDate: null,
    firstPlayedDate: null,
    rewardsRedeemed: 0,
  };
}

/** Хаб-глобальные показатели по умолчанию (владелец — наградный слой, DESIGN-HUB §3). */
export function defaultGlobalStats(): GlobalStats {
  return { rewardsRedeemed: 0, dailyStreak: 0, lastPlayedDate: null, firstPlayedDate: null };
}

/** Достаёт хаб-глобальные показатели из `progress` (после миграции они всегда заданы). */
export function readGlobalStats(progress: Progress): GlobalStats {
  return {
    rewardsRedeemed: progress.rewardsRedeemed ?? 0,
    dailyStreak: progress.dailyStreak ?? 0,
    lastPlayedDate: progress.lastPlayedDate ?? null,
    firstPlayedDate: progress.firstPlayedDate ?? null,
  };
}

/**
 * Одноразовая АДДИТИВНАЯ миграция (DESIGN-HUB §4): переносит хаб-глобальные показатели
 * из старого 2048-`stats` в `progress`. Сентинел — `progress.rewardsRedeemed === undefined`
 * («ещё не мигрировано»): сидим ВСЕ четыре поля из legacy-stats (или дефолты), включая
 * dailyStreak/lastPlayedDate, чтобы СЕРИЯ жены не оборвалась. После первого сохранения
 * `rewardsRedeemed` — число, и повторного сидинга уже не будет (лосслесс, без сброса).
 */
export function seedGlobals(progress: Progress, legacy: Partial<GlobalStats> | null | undefined): Progress {
  if (progress.rewardsRedeemed !== undefined) return progress; // уже мигрировано
  return {
    ...progress,
    rewardsRedeemed: legacy?.rewardsRedeemed ?? 0,
    dailyStreak: legacy?.dailyStreak ?? 0,
    lastPlayedDate: legacy?.lastPlayedDate ?? null,
    firstPlayedDate: legacy?.firstPlayedDate ?? null,
  };
}

export function defaultCurrentGame(now: number): CurrentGameStats {
  return {
    sessionScore: 0,
    maxTileThisGame: 0,
    movesThisGame: 0,
    gameStartTs: now,
    timeToCurrentMaxTileSec: 0,
  };
}

export function defaultProgress(today: string): Progress {
  return {
    completed: [],
    challengeCooldowns: {},
    challengeCouponsToday: 0,
    easyCouponsTotalToday: 0,
    easyCouponsByGameToday: {},
    couponDayDate: today,
    onboardingSeen: false,
    victorySeenForCount: undefined,
  };
}

/**
 * Мягкое чтение сохранённого progress: заполняет недостающие поля дефолтами и
 * игнорирует старую форму (`unlockedMilestones` из v1). Миграция до релиза не нужна
 * (DESIGN §15) — отсутствие поля просто означает «с нуля по этому полю».
 */
export function normalizeProgress(raw: Partial<Progress> | null | undefined, today: string): Progress {
  const base = defaultProgress(today);
  if (!raw || typeof raw !== 'object') return base;
  return {
    completed: Array.isArray(raw.completed) ? raw.completed : [],
    challengeCooldowns:
      raw.challengeCooldowns && typeof raw.challengeCooldowns === 'object' ? raw.challengeCooldowns : {},
    challengeCouponsToday: typeof raw.challengeCouponsToday === 'number' ? raw.challengeCouponsToday : 0,
    easyCouponsTotalToday: typeof raw.easyCouponsTotalToday === 'number' ? raw.easyCouponsTotalToday : 0,
    easyCouponsByGameToday:
      raw.easyCouponsByGameToday && typeof raw.easyCouponsByGameToday === 'object' && !Array.isArray(raw.easyCouponsByGameToday)
        ? (raw.easyCouponsByGameToday as Record<string, number>)
        : {},
    couponDayDate: typeof raw.couponDayDate === 'string' ? raw.couponDayDate : today,
    onboardingSeen: raw.onboardingSeen === true,
    victorySeenForCount: typeof raw.victorySeenForCount === 'number' ? raw.victorySeenForCount : undefined,
    // Хаб-глобальные поля: НЕ выдумываем значения, если их нет — оставляем undefined,
    // чтобы seedGlobals понял «ещё не мигрировано». null (сохранённый) ≠ undefined (нет ключа).
    rewardsRedeemed: typeof raw.rewardsRedeemed === 'number' ? raw.rewardsRedeemed : undefined,
    dailyStreak: typeof raw.dailyStreak === 'number' ? raw.dailyStreak : undefined,
    lastPlayedDate:
      typeof raw.lastPlayedDate === 'string' ? raw.lastPlayedDate : raw.lastPlayedDate === null ? null : undefined,
    firstPlayedDate:
      typeof raw.firstPlayedDate === 'string' ? raw.firstPlayedDate : raw.firstPlayedDate === null ? null : undefined,
  };
}

/**
 * Мягкое чтение 2048-`stats`: оставляет только живые 2048-поля. Legacy хаб-глобальные
 * поля (dailyStreak/rewardsRedeemed/даты) ЗАНУЛЯЮТСЯ — их владелец теперь наградный слой
 * (Progress). Безопасно: к моменту вызова rewards уже засеял globals из старого blob
 * (boot читает stats раньше, чем игра монтируется), поэтому миграция не теряет данные.
 */
export function normalizeStats(raw: Partial<CumulativeStats> | null | undefined): CumulativeStats {
  const base = defaultStats();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base, // legacy global-поля → дефолты (инертны для 2048)
    totalScore: typeof raw.totalScore === 'number' ? raw.totalScore : 0,
    bestScore: typeof raw.bestScore === 'number' ? raw.bestScore : 0,
    bestTile: typeof raw.bestTile === 'number' ? raw.bestTile : 0,
    gamesPlayed: typeof raw.gamesPlayed === 'number' ? raw.gamesPlayed : 0,
    totalMoves: typeof raw.totalMoves === 'number' ? raw.totalMoves : 0,
  };
}

/**
 * Плоский snapshot для движка. Cumulative-показатели берутся «вживую»:
 * текущая партия прибавляется к итогам, иначе вехи totalScore/bestScore не
 * срабатывали бы до конца игры (DESIGN §4-5: считаем после каждого хода).
 */
export function buildSnapshot(stats: CumulativeStats, game: CurrentGameStats): StatSnapshot {
  return {
    sessionScore: game.sessionScore,
    maxTileThisGame: game.maxTileThisGame,
    movesThisGame: game.movesThisGame,
    timeToCurrentMaxTileSec: game.timeToCurrentMaxTileSec,
    totalScore: stats.totalScore + game.sessionScore,
    bestScore: Math.max(stats.bestScore, game.sessionScore),
    bestTile: Math.max(stats.bestTile, game.maxTileThisGame),
    gamesPlayed: stats.gamesPlayed,
    totalMoves: stats.totalMoves + game.movesThisGame,
    // dailyStreak/rewardsRedeemed НЕ кладём: это хаб-глобальные статы, их подмешивает
    // наградный слой через mergeSnapshot(globalSnapshot, gameSnapshot) (DESIGN-HUB §3).
  };
}

/** Снапшот хаб-глобальных статов для движка (нужен ачивкам streak-N и redeemed-N). */
export function buildGlobalSnapshot(globals: GlobalStats): StatSnapshot {
  return {
    dailyStreak: globals.dailyStreak,
    rewardsRedeemed: globals.rewardsRedeemed,
  };
}

/**
 * Снапшот для оценки = global ⊕ снапшот активной игры (DESIGN-HUB §3). Игровые поля
 * имеют приоритет (на случай совпадения имён), но в норме множества ключей не пересекаются.
 */
export function mergeSnapshot(global: StatSnapshot, game: StatSnapshot): StatSnapshot {
  return { ...global, ...game };
}

/**
 * Закрытие партии: вкатываем её показатели в cumulative. gamesPlayed уже
 * посчитан при старте партии, поэтому здесь его не трогаем.
 */
export function commitGame(stats: CumulativeStats, game: CurrentGameStats): CumulativeStats {
  return {
    ...stats,
    totalScore: stats.totalScore + game.sessionScore,
    bestScore: Math.max(stats.bestScore, game.sessionScore),
    bestTile: Math.max(stats.bestTile, game.maxTileThisGame),
    totalMoves: stats.totalMoves + game.movesThisGame,
  };
}

/**
 * Ежедневная отметка «играла сегодня»: ведёт ХАБ-серию и даты (DESIGN-HUB §4 — играла в
 * любую игру). Идемпотентна в пределах дня. Работает над GlobalStats (владелец — rewards);
 * CumulativeStats структурно подходит (надмножество полей), поэтому старые тесты целы.
 */
export function dailyCheckIn(stats: GlobalStats, today: string): GlobalStats {
  const firstPlayedDate = stats.firstPlayedDate ?? today;
  if (stats.lastPlayedDate === today) {
    return { ...stats, firstPlayedDate };
  }
  const continued = stats.lastPlayedDate === previousYMD(today);
  return {
    ...stats,
    firstPlayedDate,
    lastPlayedDate: today,
    dailyStreak: continued ? stats.dailyStreak + 1 : 1,
  };
}
