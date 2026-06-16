import type { Coupon, CumulativeStats, CurrentGameStats, HistoryEntry, Progress } from '../engine/types';
import type { Grid } from '../game/types';
import { STORAGE_KEYS, type KVStore } from './types';

/** Сохранённая текущая партия для resume (DESIGN §3, ключ `board`). */
export interface PersistedBoard {
  grid: Grid;
  game: CurrentGameStats;
  /** Показывали ли уже праздник «2048» — чтобы не дёргать его повторно. */
  won: boolean;
}

export function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Обрезка истории под лимит CloudStorage (значение ≤ 4096 байт, DESIGN §7).
 * entries — от новых к старым; режем сначала по длине, затем по байтам с хвоста.
 *
 * maxBytes=3500 оставляет ~596 байт запаса под 4 КБ (на случай неточностей кодировки);
 * maxLen=120 с запасом покрывает реальный объём за долгое время. Записи истории
 * минимальны (без note), поэтому ~120 штук укладываются в лимит.
 *
 * Кошелёк (активные купоны) НЕ обрезаем — нельзя молча терять действующий купон.
 * Его размер естественно ограничен дневным потолком челленджей и сроками годности
 * (старые купоны сгорают), поэтому до 4 КБ он в норме не дотягивает.
 */
export function trimHistory(entries: HistoryEntry[], maxBytes = 3500, maxLen = 120): HistoryEntry[] {
  let trimmed = entries.slice(0, maxLen);
  while (trimmed.length > 0 && byteLength(JSON.stringify(trimmed)) > maxBytes) {
    trimmed = trimmed.slice(0, -1); // выкидываем самую старую запись
  }
  return trimmed;
}

async function loadJSON<T>(store: KVStore, key: string): Promise<T | null> {
  try {
    const raw = await store.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Битые данные не должны ронять подарок — начинаем с чистого листа по этому ключу.
    return null;
  }
}

async function saveJSON<T>(store: KVStore, key: string, value: T): Promise<void> {
  await store.setItem(key, JSON.stringify(value));
}

export interface GameRepository {
  loadBoard(): Promise<PersistedBoard | null>;
  saveBoard(board: PersistedBoard): Promise<void>;
  clearBoard(): Promise<void>;
  loadStats(): Promise<CumulativeStats | null>;
  saveStats(stats: CumulativeStats): Promise<void>;
  loadWallet(): Promise<Coupon[] | null>;
  saveWallet(wallet: Coupon[]): Promise<void>;
  loadHistory(): Promise<HistoryEntry[] | null>;
  saveHistory(history: HistoryEntry[]): Promise<void>;
  loadProgress(): Promise<Progress | null>;
  saveProgress(progress: Progress): Promise<void>;
  getVersion(): Promise<string | null>;
  setVersion(v: string): Promise<void>;
  /** Полный сброс игрового состояния (партия, статы, кошелёк, история, прогресс). */
  resetState(): Promise<void>;
}

export function createRepository(store: KVStore): GameRepository {
  return {
    loadBoard: () => loadJSON<PersistedBoard>(store, STORAGE_KEYS.board),
    saveBoard: (board) => saveJSON(store, STORAGE_KEYS.board, board),
    clearBoard: () => store.removeItem(STORAGE_KEYS.board),
    loadStats: () => loadJSON<CumulativeStats>(store, STORAGE_KEYS.stats),
    saveStats: (stats) => saveJSON(store, STORAGE_KEYS.stats, stats),
    loadWallet: () => loadJSON<Coupon[]>(store, STORAGE_KEYS.wallet),
    saveWallet: (wallet) => saveJSON(store, STORAGE_KEYS.wallet, wallet),
    loadHistory: () => loadJSON<HistoryEntry[]>(store, STORAGE_KEYS.history),
    saveHistory: (history) => saveJSON(store, STORAGE_KEYS.history, trimHistory(history)),
    loadProgress: () => loadJSON<Progress>(store, STORAGE_KEYS.progress),
    saveProgress: (progress) => saveJSON(store, STORAGE_KEYS.progress, progress),
    getVersion: () => store.getItem(STORAGE_KEYS.version),
    setVersion: (v) => store.setItem(STORAGE_KEYS.version, v),
    resetState: async () => {
      await Promise.all([
        store.removeItem(STORAGE_KEYS.board),
        store.removeItem(STORAGE_KEYS.stats),
        store.removeItem(STORAGE_KEYS.wallet),
        store.removeItem(STORAGE_KEYS.history),
        store.removeItem(STORAGE_KEYS.progress),
        // Зарезервированные ключи match3: чистим тоже, чтобы ?reset=1 был полным (фаза B).
        store.removeItem(STORAGE_KEYS.match3Board),
        store.removeItem(STORAGE_KEYS.match3Stats),
      ]);
    },
  };
}
