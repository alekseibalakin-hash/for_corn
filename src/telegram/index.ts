import { createMockWebApp } from './mock';
import type { HapticImpactStyle, HapticNotificationType, WebApp } from './types';

export type { WebApp } from './types';

let cached: WebApp | null = null;

/**
 * Настоящий Telegram WebApp, если мы реально внутри Telegram; иначе mock (DESIGN §8).
 * Важно: telegram-web-app.js подсовывает заглушку и в обычном браузере
 * (platform === 'unknown'), у которой CloudStorage есть, но не работает. Поэтому
 * «настоящесть» определяем по платформе, а не по наличию CloudStorage.
 */
export function getWebApp(): WebApp {
  if (cached) return cached;
  const real = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  const genuine = !!real && !!real.platform && real.platform !== 'unknown';
  cached = genuine ? (real as WebApp) : createMockWebApp();
  return cached;
}

/** Поддерживается ли Telegram CloudStorage (добавлен в Bot API 6.9). */
export function supportsCloudStorage(tg: WebApp): boolean {
  if (tg.isMock) return true; // mock-CloudStorage поверх localStorage — рабочий
  return typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast('6.9');
}

export function isTelegram(): boolean {
  return !getWebApp().isMock;
}

/** Инициализация при входе: ready/expand + наша тёплая шапка (палитра — не из темы). */
export function initTelegram(): void {
  const tg = getWebApp();
  try {
    tg.ready();
    if (!tg.isExpanded) tg.expand();
    // Отключаем нативный вертикальный свайп-жест Telegram (Bot API 7.7), чтобы
    // горизонтальные свайпы по доске не сворачивали мини-аппу вниз.
    // Двойной гейт обязателен: mock отдаёт isVersionAtLeast:()=>true, но метода не
    // определяет — проверка typeof не даёт упасть в браузере/на старых клиентах.
    if (tg.isVersionAtLeast?.('7.7') && typeof tg.disableVerticalSwipes === 'function') {
      tg.disableVerticalSwipes();
    }
    tg.setHeaderColor?.('#FBF3EC');
    tg.setBackgroundColor?.('#FBF3EC');
  } catch {
    /* no-op в браузере */
  }
}

export function getUserFirstName(): string | null {
  return getWebApp().initDataUnsafe.user?.first_name ?? null;
}

export const haptics = {
  impact(style: HapticImpactStyle = 'light'): void {
    try {
      getWebApp().HapticFeedback.impactOccurred(style);
    } catch {
      /* no-op */
    }
  },
  notify(type: HapticNotificationType = 'success'): void {
    try {
      getWebApp().HapticFeedback.notificationOccurred(type);
    } catch {
      /* no-op */
    }
  },
  select(): void {
    try {
      getWebApp().HapticFeedback.selectionChanged();
    } catch {
      /* no-op */
    }
  },
};
