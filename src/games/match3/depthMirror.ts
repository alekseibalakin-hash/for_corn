// §п.0: localStorage-зеркало максимальной глубины «с перчинкой» (баг «48→22»).
// CloudStorage асинхронен + 400мс троттл + флаш на закрытии → при быстрой игре/сворачивании
// запись может не долететь. Зеркало: только число глубины (НЕ снимок доски), синхронный
// localStorage.setItem на каждой победе — переживает мгновенное закрытие.
// На загрузке берём max(CloudStorage, зеркало). Ключ привязан к Telegram user-id (безопасно).
// Потолок 500 отсекает порченые «999» из старого A2.

import { getWebApp } from '../../telegram';

// Sanity-потолок. Держим ВЫСОКИМ (не понижаем): она доходила до ~48 и растёт — низкий cap клипнул бы
// её реальную глубину (хуже, чем теоретический over-grant). Отсекает мусор (NaN/Infinity/«999...»).
// Экспортируется, чтобы normalizeM3Stats клампил так же (порченый CloudStorage-blob не пройдёт глубже).
export const MAX_DEPTH = 500;

function storageKey(): string {
  try {
    const id = getWebApp().initDataUnsafe?.user?.id;
    return `spicy_depth_${id ?? 'local'}`;
  } catch {
    return 'spicy_depth_local';
  }
}

export const depthMirror = {
  read(): number {
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw === null) return 0;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(n, MAX_DEPTH);
    } catch {
      return 0;
    }
  },
  write(depth: number): void {
    try {
      const safe = Math.min(Math.max(0, Math.floor(depth)), MAX_DEPTH);
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
