/** Async key-value контракт (как у Telegram CloudStorage). */
export interface KVStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Ключи персистентности (DESIGN §7). Несколько ключей, а не один мега-объект.
 *
 * ХАБ (DESIGN-HUB §4): ОБЩИЕ ключи наградного слоя — `wallet`/`history`/`progress`
 * (данные жены, не трогаем). 2048 остаётся на `board`/`stats`. Под будущий match3
 * заведены неймспейс-ключи `match3.*` — в фазе A объявлены, но НЕ используются.
 */
export const STORAGE_KEYS = {
  board: 'board', // текущая партия 2048 для resume
  stats: 'stats', // cumulative-показатели 2048
  wallet: 'wallet', // ОБЩИЙ: активные купоны
  history: 'history', // ОБЩИЙ: использованные + сгоревшие
  progress: 'progress', // ОБЩИЙ: completed, cooldowns, дневной счётчик + хаб-глобальные статы
  version: 'schemaVersion', // версия данных — для разового сброса (см. STORAGE_VERSION)
  match3Board: 'match3.board', // ФАЗА B: партия match3 (зарезервировано, не используется)
  match3Stats: 'match3.stats', // ФАЗА B: статы match3 с префиксом m3_ (зарезервировано)
  w5Daily: 'w5.daily', // «5 букв»: ежедневная партия (dateKey + guesses + status)
  w5Stats: 'w5.stats', // «5 букв»: накопленная статистика (w5_ неймспейс)
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Версия сохранённого состояния. Если в хранилище лежит другая (или её нет) — данные
 * обнуляются один раз при загрузке. Поднимай это число, когда нужно «сбросить всем в ноль».
 */
export const STORAGE_VERSION = '3';
