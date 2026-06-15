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
  version: 'schemaVersion', // версия данных — для разового сброса (см. STORAGE_VERSION)
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Версия сохранённого состояния. Если в хранилище лежит другая (или её нет) — данные
 * обнуляются один раз при загрузке. Поднимай это число, когда нужно «сбросить всем в ноль».
 */
export const STORAGE_VERSION = '3';
