export type LetterStatus = 'correct' | 'present' | 'absent';

export type W5Mode = 'daily' | 'endless';

export interface W5DailyState {
  dateKey: number;
  guesses: string[];
  status: 'playing' | 'won' | 'lost';
}

export interface W5Stats {
  dailyPlayed: number;
  dailyWins: number;
  endlessPlayed: number;
  endlessWins: number;
  bestGuess: number; // min guesses to win (0 = never won)
  w5_dailyStreak: number;
  w5_maxDailyStreak: number;
  lastDailyWonDate: string | null; // YYYY-MM-DD
}

export const WORD_LEN = 5;
export const MAX_GUESSES = 6;
export const REVEAL_PER_TILE_MS = 300;

/** Нормализация ввода: строчные + ё→е. */
export function normalizeW5(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

/**
 * Номер локального дня (DESIGN §3 — ежедневное слово по локальной дате).
 * Math.floor((Date.now() - getTimezoneOffset()*60000) / 86400000)
 */
export function getDateKey(): number {
  return Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
}

/**
 * Двухпроходная раскраска (бриф §7).
 * Проход 1: зелёные (точное совпадение), убираем из пула.
 * Проход 2: по не-зелёным: буква есть в пуле → жёлтый, иначе серый.
 * Корректно для дублей: ААААА vs КАША → одна А жёлтая, остальные серые.
 */
export function scoreGuess(guess: string, answer: string): LetterStatus[] {
  const result: LetterStatus[] = Array(WORD_LEN).fill('absent' as LetterStatus);
  const pool: (string | null)[] = answer.split('');
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
      pool[i] = null;
    }
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] === 'correct') continue;
    const idx = pool.indexOf(guess[i]);
    if (idx !== -1) {
      result[i] = 'present';
      pool[idx] = null;
    }
  }
  return result;
}

const STATUS_ORDER: Record<LetterStatus, number> = { correct: 2, present: 1, absent: 0 };

/** Возвращает true, если статус a лучше b (для клавиатуры: сохраняем лучший). */
export function betterStatus(a: LetterStatus, b: LetterStatus): boolean {
  return STATUS_ORDER[a] > STATUS_ORDER[b];
}

export function normalizeW5Daily(raw: unknown): W5DailyState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.dateKey !== 'number') return null;
  if (!Array.isArray(r.guesses)) return null;
  if (r.status !== 'playing' && r.status !== 'won' && r.status !== 'lost') return null;
  return {
    dateKey: r.dateKey as number,
    guesses: (r.guesses as unknown[]).filter((g): g is string => typeof g === 'string'),
    status: r.status as 'playing' | 'won' | 'lost',
  };
}

export function normalizeW5Stats(raw: unknown): W5Stats {
  const zero: W5Stats = {
    dailyPlayed: 0,
    dailyWins: 0,
    endlessPlayed: 0,
    endlessWins: 0,
    bestGuess: 0,
    w5_dailyStreak: 0,
    w5_maxDailyStreak: 0,
    lastDailyWonDate: null,
  };
  if (!raw || typeof raw !== 'object') return zero;
  const r = raw as Record<string, unknown>;
  const n = (k: string): number =>
    typeof r[k] === 'number' && (r[k] as number) >= 0 ? (r[k] as number) : 0;
  return {
    dailyPlayed: n('dailyPlayed'),
    dailyWins: n('dailyWins'),
    endlessPlayed: n('endlessPlayed'),
    endlessWins: n('endlessWins'),
    bestGuess: n('bestGuess'),
    w5_dailyStreak: n('w5_dailyStreak'),
    w5_maxDailyStreak: n('w5_maxDailyStreak'),
    lastDailyWonDate: typeof r.lastDailyWonDate === 'string' ? r.lastDailyWonDate : null,
  };
}
