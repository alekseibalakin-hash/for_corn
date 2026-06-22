// §п.0: localStorage-зеркало максимальной глубины (баг «48→22»).
// CloudStorage асинхронен + 400мс троттл + флаш на закрытии → при быстрой игре/сворачивании
// запись может не долететь. Зеркало: только число глубины (НЕ снимок доски), синхронный
// localStorage.setItem на каждой победе — переживает мгновенное закрытие.
// На загрузке берём max(CloudStorage, зеркало). Ключ привязан к Telegram user-id (безопасно).
// Потолок 500 отсекает порченые «999» из старого A2.
//
// makeDepthMirror(keyPrefix, maxDepth): фабрика инстансов для разных игр (§4 briefs/blocks-phase1.md).
// spicyDepthMirror = makeDepthMirror('spicy_depth_', MAX_DEPTH)  — байт-в-байт то же поведение.
// blocksDepthMirror = makeDepthMirror('bb_depth_', MAX_DEPTH)    — новая игра, ключи без точек.

import { getWebApp } from '../../telegram';

// Sanity-потолок. Держим ВЫСОКИМ (не понижаем): она доходила до ~48 и растёт — низкий cap клипнул бы
// её реальную глубину (хуже, чем теоретический over-grant). Отсекает мусор (NaN/Infinity/«999...»).
// Экспортируется, чтобы normalizeM3Stats клампил так же (порченый CloudStorage-blob не пройдёт глубже).
export const MAX_DEPTH = 500;

/** Фабрика localStorage-зеркала для числа глубины игры.
 *  keyPrefix: e.g. 'spicy_depth_' → ключ = 'spicy_depth_<userId>' (без точек, §5 DESIGN-BLOCKS.md).
 *  maxDepth: sanity-потолок (клампинг на записи и чтении).
 */
export function makeDepthMirror(keyPrefix: string, maxDepth: number) {
  function storageKey(): string {
    try {
      const id = getWebApp().initDataUnsafe?.user?.id;
      return `${keyPrefix}${id ?? 'local'}`;
    } catch {
      return `${keyPrefix}local`;
    }
  }

  return {
    read(): number {
      try {
        const raw = localStorage.getItem(storageKey());
        if (raw === null) return 0;
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(n, maxDepth);
      } catch {
        return 0;
      }
    },
    write(depth: number): void {
      try {
        const safe = Math.min(Math.max(0, Math.floor(depth)), maxDepth);
        localStorage.setItem(storageKey(), String(safe));
      } catch {
        /* localStorage недоступен — тихо игнорируем */
      }
    },
    clear(): void {
      try {
        localStorage.removeItem(storageKey());
      } catch {
        /* no-op */
      }
    },
  };
}

/** Зеркало глубины «с перчинкой» (spicy_depth_<userId>). Сохраняет байт-в-байт поведение. */
export const depthMirror = makeDepthMirror('spicy_depth_', MAX_DEPTH);

/** Зеркало глубины «блоков-фигур» (bb_depth_<userId>). Ключи без точек (§5 DESIGN-BLOCKS.md). */
export const blocksDepthMirror = makeDepthMirror('bb_depth_', MAX_DEPTH);
