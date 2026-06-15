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
    return cloudStorageBackend(tg.CloudStorage);
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
