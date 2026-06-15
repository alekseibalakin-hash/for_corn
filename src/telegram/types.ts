// Минимальная типизация window.Telegram.WebApp — только то, что используем (DESIGN §8).

export type HapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type HapticNotificationType = 'error' | 'success' | 'warning';

export interface CloudStorage {
  getItem(key: string, callback: (error: string | null, value: string | null) => void): void;
  setItem(key: string, value: string, callback?: (error: string | null, stored: boolean) => void): void;
  removeItem(key: string, callback?: (error: string | null, removed: boolean) => void): void;
  getKeys?(callback: (error: string | null, keys: string[]) => void): void;
}

export interface HapticFeedback {
  impactOccurred(style: HapticImpactStyle): void;
  notificationOccurred(type: HapticNotificationType): void;
  selectionChanged(): void;
}

export interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface WebApp {
  initDataUnsafe: { user?: TelegramUser };
  initData?: string;
  CloudStorage: CloudStorage;
  HapticFeedback: HapticFeedback;
  /** Платформа: 'ios'|'android'|'tdesktop'|'web'… или 'unknown' для заглушки вне Telegram. */
  platform?: string;
  version?: string;
  isVersionAtLeast?(version: string): boolean;
  ready(): void;
  expand(): void;
  isExpanded?: boolean;
  // Управление нативным вертикальным свайп-жестом (Bot API 7.7). Опциональны:
  // на клиентах <7.7 и в mock их нет.
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  isVerticalSwipesEnabled?: boolean;
  colorScheme?: 'light' | 'dark';
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  /** true, если это наш mock (браузер/дев/ревью), а не настоящий Telegram. */
  isMock?: boolean;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}
