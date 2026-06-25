// Диагностический журнал событий кошелька (вариант A инструментации «пропадающих наград»).
//
// СИНХРОННЫЙ localStorage (НЕ CloudStorage) — переживает мгновенное закрытие аппы, как depthMirror.
// Это ключевое: если CloudStorage-запись кошелька не долетела при быстром закрытии, журнал ВСЁ РАВНО
// зафиксирует «выдан купон X» синхронно → при следующем заходе видно расхождение (журнал помнит выдачу,
// а кошелёк пуст ⇒ потеря записи, а не сгорание).
//
// ЖЕЛЕЗНЫЕ свойства (это её живые данные):
//  • пишет в СВОЙ ключ — НИКОГДА не трогает wallet/history/stats;
//  • НИКОГДА не кидает (любой сбой localStorage проглатывается — диагностика не критична);
//  • кольцевой буфер фикс. размера (не растёт бесконечно);
//  • только запись/чтение, поведение игры не меняет.

const DIAG_KEY = 'love2048:diag_events';
export const MAX_ENTRIES = 250;

export interface DiagEntry {
  /** Date.now() момента события. */
  t: number;
  /** Тип: 'boot' | 'grant' | 'redeem' | 'spend' | 'sweep' | 'save' | ... */
  ev: string;
  [k: string]: unknown;
}

function safeRead(): DiagEntry[] {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DiagEntry[]) : [];
  } catch {
    return [];
  }
}

export const diagLog = {
  /** Дописать событие (с меткой времени). Кольцо: держим последние MAX_ENTRIES. Никогда не кидает. */
  push(ev: string, data?: Record<string, unknown>): void {
    try {
      const entries = safeRead();
      entries.push({ t: Date.now(), ev, ...data });
      const trimmed =
        entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
      localStorage.setItem(DIAG_KEY, JSON.stringify(trimmed));
    } catch {
      /* localStorage недоступен/переполнен — молча игнорируем (диагностика не должна влиять на игру) */
    }
  },
  /** Прочитать весь буфер (старые→новые). Никогда не кидает. */
  read(): DiagEntry[] {
    return safeRead();
  },
  /** Очистить журнал (кнопка в диаг-панели после снятия дампа). */
  clear(): void {
    try {
      localStorage.removeItem(DIAG_KEY);
    } catch {
      /* no-op */
    }
  },
};
