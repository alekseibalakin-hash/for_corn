import type { Coupon, CumulativeStats, CurrentGameStats, HistoryEntry, Progress } from '../engine/types';
import type { Grid } from '../game/types';
import type { Board as Match3Board, Obstacles } from '../games/match3/logic';
import type { SpicyLevelState } from '../games/match3/levels';
import type { M3CumulativeStats, M3CurrentGame } from '../games/match3/stats';
import { STORAGE_KEYS, type KVStore } from './types';

/** Сохранённая текущая партия для resume (DESIGN §3, ключ `board`). */
export interface PersistedBoard {
  grid: Grid;
  game: CurrentGameStats;
  /** Показывали ли уже праздник «2048» — чтобы не дёргать его повторно. */
  won: boolean;
}

/**
 * Сохранённая партия Match-3 для resume (Фаза B, ключ `match3.board`): поле + per-game статы.
 * `obstacles` (Match-3 «Комнаты», Фаза 1) — аддитивно и ОПЦИОНАЛЬНО: эндлесс его НЕ пишет (старый
 * blob жены без поля грузится через дефолт `emptyObstacles`), новый storage-ключ НЕ заводим (бриф §5).
 *
 * Match-3 «с перчинкой» (бриф spicy §5) — ещё два аддитивных опц. поля на ТОМ ЖЕ ключе:
 *  - `spicy` — снимок незаконченного спайси-уровня (board+obstacles+поток), ОТДЕЛЬНО от лайт-слота
 *    `{board,game}` ⇒ лайт и перчинка резюмятся НЕЗАВИСИМО, не затирая друг друга. `persistBoard`
 *    пишет ПОЛНЫЙ объект (склейка top+spicy), иначе coalescingStore last-write-wins сотрёт чужой слот;
 *  - `mode` — форвард-совместимость (в v1 «последний режим» НЕ помним, §9 Q4).
 * Старый blob жены без этих полей грузится без ошибок (normalizeSpicy/normalizeMode дают дефолты).
 */
export interface PersistedMatch3 {
  // board/game ОПЦИОНАЛЬНЫ: blob может нести только spicy-слот (игрок зашёл сразу в «перчинку»),
  // только лайт-слот (как у жены сейчас) или оба. Лайт-загрузка гейтит по `Array.isArray(board)`.
  board?: Match3Board;
  game?: M3CurrentGame;
  obstacles?: Obstacles;
  mode?: 'light' | 'spicy';
  spicy?: SpicyLevelState | null;
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
  // Ошибка getItem (таймаут, транзиентный сбой CloudStorage) — пробрасываем, не глотаем.
  // Звонящий увидит reject и не станет затирать реальные данные дефолтом.
  // null возвращаем только при ПОДЛИННОМ отсутствии ключа или битом JSON.
  const raw = await store.getItem(key);
  if (raw == null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
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
  // --- Match-3 (Фаза B): свои ключи match3.board / match3.stats (зеркало board/stats 2048). ---
  loadMatch3Board(): Promise<PersistedMatch3 | null>;
  saveMatch3Board(board: PersistedMatch3): Promise<void>;
  clearMatch3Board(): Promise<void>;
  loadMatch3Stats(): Promise<M3CumulativeStats | null>;
  saveMatch3Stats(stats: M3CumulativeStats): Promise<void>;
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
    loadMatch3Board: () => loadJSON<PersistedMatch3>(store, STORAGE_KEYS.match3Board),
    saveMatch3Board: (board) => saveJSON(store, STORAGE_KEYS.match3Board, board),
    clearMatch3Board: () => store.removeItem(STORAGE_KEYS.match3Board),
    loadMatch3Stats: () => loadJSON<M3CumulativeStats>(store, STORAGE_KEYS.match3Stats),
    saveMatch3Stats: (stats) => saveJSON(store, STORAGE_KEYS.match3Stats, stats),
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
