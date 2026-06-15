import type { CloudStorage, HapticFeedback, WebApp } from './types';

// Mock-SDK: чтобы подарок открывался и в обычном браузере (разработка/ревью, DESIGN §8).
// CloudStorage эмулируем поверх localStorage с тем же async-контрактом.

const MOCK_PREFIX = 'love2048:mock:';

function mockCloudStorage(): CloudStorage {
  const safeLocal = (): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    getItem(key, callback) {
      const ls = safeLocal();
      // async-семантика как у настоящего CloudStorage
      Promise.resolve().then(() => callback(null, ls ? ls.getItem(MOCK_PREFIX + key) : null));
    },
    setItem(key, value, callback) {
      const ls = safeLocal();
      Promise.resolve().then(() => {
        try {
          ls?.setItem(MOCK_PREFIX + key, value);
          callback?.(null, true);
        } catch (e) {
          callback?.(String(e), false);
        }
      });
    },
    removeItem(key, callback) {
      const ls = safeLocal();
      Promise.resolve().then(() => {
        ls?.removeItem(MOCK_PREFIX + key);
        callback?.(null, true);
      });
    },
    getKeys(callback) {
      const ls = safeLocal();
      Promise.resolve().then(() => {
        const keys: string[] = [];
        if (ls) {
          for (let i = 0; i < ls.length; i++) {
            const k = ls.key(i);
            if (k && k.startsWith(MOCK_PREFIX)) keys.push(k.slice(MOCK_PREFIX.length));
          }
        }
        callback(null, keys);
      });
    },
  };
}

function mockHaptics(): HapticFeedback {
  // В браузере хаптики нет — пробуем navigator.vibrate, иначе тихо.
  const buzz = (ms: number) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* no-op */
    }
  };
  return {
    impactOccurred: (style) => buzz(style === 'heavy' ? 30 : style === 'medium' ? 18 : 10),
    notificationOccurred: () => buzz([12, 40, 12] as unknown as number),
    selectionChanged: () => buzz(8),
  };
}

/** Имя для приветствия: ?name=... в URL, иначе тёплый дефолт. */
function mockFirstName(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('name');
    if (fromUrl) return fromUrl;
  } catch {
    /* no-op */
  }
  return 'Кукурузка';
}

export function createMockWebApp(): WebApp {
  return {
    isMock: true,
    platform: 'browser-mock',
    version: '7.0',
    initData: '',
    initDataUnsafe: { user: { first_name: mockFirstName() } },
    CloudStorage: mockCloudStorage(),
    HapticFeedback: mockHaptics(),
    colorScheme: 'light',
    isExpanded: true,
    isVersionAtLeast: () => true,
    ready: () => void 0,
    expand: () => void 0,
    setHeaderColor: () => void 0,
    setBackgroundColor: () => void 0,
  };
}
