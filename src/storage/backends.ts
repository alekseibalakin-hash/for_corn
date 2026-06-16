import { getWebApp, supportsCloudStorage } from '../telegram';
import type { CloudStorage } from '../telegram/types';
import type { KVStore } from './types';

// Защита от «заглушечного» CloudStorage, который не вызывает колбэк: промис не
// должен висеть вечно (DESIGN §8 — «fall back, not hang»). По таймауту отклоняем,
// и вызывающий код (init/persist) корректно деградирует.
const CLOUD_TIMEOUT_MS = 4000;

function withTimeout<T>(executor: (resolve: (v: T) => void, reject: (e: Error) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error('CloudStorage timeout'));
      }
    }, CLOUD_TIMEOUT_MS);
    const settle =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(...args);
      };
    executor(settle(resolve), settle(reject));
  });
}

/** Telegram CloudStorage → промисифицированный KVStore (с таймаутом). */
export function cloudStorageBackend(cs: CloudStorage): KVStore {
  return {
    getItem(key) {
      return withTimeout<string | null>((resolve, reject) =>
        cs.getItem(key, (error, value) => (error ? reject(new Error(error)) : resolve(value ?? null))),
      );
    },
    setItem(key, value) {
      return withTimeout<void>((resolve, reject) =>
        cs.setItem(key, value, (error) => (error ? reject(new Error(error)) : resolve())),
      );
    },
    removeItem(key) {
      return withTimeout<void>((resolve, reject) =>
        cs.removeItem(key, (error) => (error ? reject(new Error(error)) : resolve())),
      );
    },
  };
}

const LOCAL_PREFIX = 'love2048:';

/** Прямой localStorage-fallback (на случай, если CloudStorage недоступен). */
export function localStorageBackend(): KVStore {
  return {
    async getItem(key) {
      return window.localStorage.getItem(LOCAL_PREFIX + key);
    },
    async setItem(key, value) {
      window.localStorage.setItem(LOCAL_PREFIX + key, value);
    },
    async removeItem(key) {
      window.localStorage.removeItem(LOCAL_PREFIX + key);
    },
  };
}

/** In-memory backend для тестов/SSR. */
export function memoryBackend(seed: Record<string, string> = {}): KVStore {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

/**
 * Координатор записи поверх async-бэкенда (CloudStorage). Чинит баг потери прогресса: за сессию
 * 2048 пишет в Telegram CloudStorage на КАЖДОМ ходу (board/stats) + на наградах (wallet/progress) —
 * десятки несериализованных записей. Реальный CloudStorage под таким потоком троттлит/теряет/
 * переставляет записи → состояние сессии не закрепляется, при перезаходе откат к последнему
 * «дошедшему» (вчерашнему). Решение:
 *  - коалесинг по ключу: держим только ПОСЛЕДНЕЕ значение, промежуточные не пишем;
 *  - сериализация: записи по очереди (без гонок) → last-write-wins, без клоббера старым;
 *  - троттл: пачка ходов схлопывается в ~одну запись на ключ за окно;
 *  - flush при сворачивании/закрытии аппы (visibilitychange/pagehide) — финальное состояние
 *    гарантированно уходит, когда она выходит;
 *  - read-your-writes: getItem отдаёт ещё не сброшенное значение (UI/boot видят свежее).
 */
export function coalescingStore(inner: KVStore, throttleMs = 400): KVStore {
  const pending = new Map<string, string | null>(); // последнее значение ключа; null = удалить
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const doFlush = async (): Promise<void> => {
    for (const key of [...pending.keys()]) {
      const value = pending.get(key)!;
      try {
        if (value === null) await inner.removeItem(key);
        else await inner.setItem(key, value);
        // Не затираем запись из очереди, если её перезаписали НОВЫМ значением во время await.
        if (pending.get(key) === value) pending.delete(key);
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[storage] запись отложена (повтор позже):', key, err);
        break; // оставить остаток в pending — повторим на следующем schedule/flush
      }
    }
  };
  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    chain = chain.then(doFlush); // сериализуем: никаких конкурентных записей в один ключ
    return chain;
  };
  const schedule = () => {
    if (timer) return; // троттл (не дебаунс): не сдвигаем уже запланированный сброс
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, throttleMs);
  };

  if (typeof window !== 'undefined') {
    const flushNow = () => void flush();
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow(); // Telegram свернул/закрыл аппу
      });
      window.addEventListener('pagehide', flushNow);
    } catch {
      /* no-op */
    }
  }

  return {
    async getItem(key) {
      const v = pending.get(key);
      return v === undefined ? inner.getItem(key) : v;
    },
    async setItem(key, value) {
      pending.set(key, value);
      schedule();
    },
    async removeItem(key) {
      pending.set(key, null);
      schedule();
    },
  };
}

/**
 * Боевой store (DESIGN §7):
 *  - настоящий Telegram с поддержкой CloudStorage (≥6.9) или mock → CloudStorage;
 *  - старый Telegram (CloudStorage не работает) → прямой localStorage;
 *  - совсем без браузерного хранилища → память.
 */
export function createStore(): KVStore {
  const tg = getWebApp();
  if (supportsCloudStorage(tg)) {
    // В реальном Telegram (≥6.9) основной путь — CloudStorage (webview-localStorage
    // в Telegram может чиститься, DESIGN §15). Лог помогает подтвердить это на устройстве.
    if (import.meta.env.DEV) {
      console.info(`[storage] backend: CloudStorage${tg.isMock ? ' (mock → localStorage)' : ` (Telegram ${tg.version ?? '?'})`}`);
    }
    // Координатор записи поверх CloudStorage: коалесинг/сериализация/троттл/flush-на-выходе —
    // иначе частые записи (каждый ход) троттлятся CloudStorage и теряются (баг с откатом прогресса).
    return coalescingStore(cloudStorageBackend(tg.CloudStorage));
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (import.meta.env.DEV) console.info('[storage] backend: localStorage (CloudStorage недоступен)');
      return localStorageBackend();
    }
  } catch {
    /* no-op */
  }
  if (import.meta.env.DEV) console.info('[storage] backend: memory (хранилище недоступно)');
  return memoryBackend();
}
