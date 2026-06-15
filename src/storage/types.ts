/** Async key-value контракт (как у Telegram CloudStorage). */
export interface KVStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Ключи персистентности (DESIGN §7). Несколько ключей, а не один мега-объект. */
export const STORAGE_KEYS = {
  board: 'board', // текущая партия для resume
  stats: 'stats', // cumulative-показатели
  wallet: 'wallet', // активные купоны
  history: 'history', // использованные + сгоревшие
  progress: 'progress', // unlocked, cooldowns, дневной счётчик
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
