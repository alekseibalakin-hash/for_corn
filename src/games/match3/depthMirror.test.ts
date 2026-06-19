import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { depthMirror, MAX_DEPTH } from './depthMirror';

// Тест-окружение vite — node (vite.config.ts), без DOM. Подменяем localStorage Map-фейком
// (как fakeInner в backends.test). getWebApp() без Telegram → storageKey() фолбэк 'spicy_depth_local'.
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

// Узнать ключ, которым пользуется зеркало (не завязываемся на внутреннее имя).
function mirrorKey(): string {
  depthMirror.write(1);
  const k = localStorage.key(0);
  if (!k) throw new Error('зеркало не записало ключ');
  return k;
}

describe('depthMirror (§п.0 — durability глубины, #11 адверс-ревью)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', makeLocalStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('round-trip: write → read', () => {
    depthMirror.write(27);
    expect(depthMirror.read()).toBe(27);
  });

  it('нет ключа → 0', () => {
    expect(depthMirror.read()).toBe(0);
  });

  it('cap MAX_DEPTH на ЗАПИСИ: write(999) → read() === MAX_DEPTH', () => {
    depthMirror.write(999);
    expect(depthMirror.read()).toBe(MAX_DEPTH);
  });

  it('cap MAX_DEPTH на ЧТЕНИИ: порченый высокий blob тоже клампится (защита от «999...»)', () => {
    const k = mirrorKey();
    localStorage.setItem(k, '99999');
    expect(depthMirror.read()).toBe(MAX_DEPTH);
  });

  it('порченые значения → 0 (не роняют игру, не выдают мусор как глубину)', () => {
    const k = mirrorKey();
    for (const bad of ['abc', '', 'NaN', '-5', 'Infinity']) {
      localStorage.setItem(k, bad);
      expect(depthMirror.read()).toBe(0);
    }
  });

  it('отрицательное на записи → 0', () => {
    depthMirror.write(-5);
    expect(depthMirror.read()).toBe(0);
  });

  it('дробное на записи → floor', () => {
    depthMirror.write(12.9);
    expect(depthMirror.read()).toBe(12);
  });

  it('clear() убирает зеркало (для resetState/?reset=1)', () => {
    depthMirror.write(40);
    depthMirror.clear();
    expect(depthMirror.read()).toBe(0);
  });
});
