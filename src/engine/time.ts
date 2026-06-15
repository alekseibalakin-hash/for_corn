import { DAY_MS } from './types';

/**
 * Локальная дата YYYY-MM-DD по часам устройства (DESIGN §6: доверяем устройству).
 * Используется для дневного потолка и серии (сброс в локальную полночь).
 */
export function localYMD(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Предыдущий календарный день для строки YYYY-MM-DD (DST-безопасно через UTC). */
export function previousYMD(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - DAY_MS;
  const prev = new Date(t);
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(prev.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
