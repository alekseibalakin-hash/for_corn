import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksDepthMirror, depthMirror, makeDepthMirror, MAX_DEPTH } from './depthMirror';

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

// ============================================================================
// makeDepthMirror фабрика: изоляция инстансов, свой keyPrefix (briefs/blocks-phase1.md §4).
// ============================================================================

describe('makeDepthMirror фабрика (§4 briefs — обобщение для bb_depth_*)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', makeLocalStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('два инстанса с разными prefix изолированы', () => {
    const a = makeDepthMirror('test_a_', MAX_DEPTH);
    const b = makeDepthMirror('test_b_', MAX_DEPTH);
    a.write(10);
    b.write(20);
    expect(a.read()).toBe(10);
    expect(b.read()).toBe(20);
  });

  it('инстанс с собственным maxDepth клампит корректно', () => {
    const m = makeDepthMirror('test_c_', 100);
    m.write(999);
    expect(m.read()).toBe(100); // клампится к 100, не к MAX_DEPTH(500)
  });

  it('clear одного не затрагивает другой', () => {
    const a = makeDepthMirror('test_d_', MAX_DEPTH);
    const b = makeDepthMirror('test_e_', MAX_DEPTH);
    a.write(5);
    b.write(7);
    a.clear();
    expect(a.read()).toBe(0);
    expect(b.read()).toBe(7); // b нетронут
  });

  it('round-trip с кастомным prefix', () => {
    const m = makeDepthMirror('custom_', MAX_DEPTH);
    m.write(33);
    expect(m.read()).toBe(33);
  });
});

// ============================================================================
// spicy-инстанс неизменён (§4 briefs — тест неизменности, байт-в-байт).
// ============================================================================

describe('spicy depthMirror — неизменность после рефактора в фабрику', () => {
  beforeEach(() => vi.stubGlobal('localStorage', makeLocalStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('ключ начинается с spicy_depth_', () => {
    depthMirror.write(1);
    const k = localStorage.key(0);
    expect(k).toMatch(/^spicy_depth_/);
  });

  it('round-trip, cap, clear идентичны предыдущему поведению', () => {
    depthMirror.write(42);
    expect(depthMirror.read()).toBe(42);
    depthMirror.write(999);
    expect(depthMirror.read()).toBe(MAX_DEPTH);
    depthMirror.clear();
    expect(depthMirror.read()).toBe(0);
  });
});

// ============================================================================
// blocksDepthMirror — новый инстанс (bb_depth_*).
// ============================================================================

describe('blocksDepthMirror (bb_depth_* для «Блоков-фигур»)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', makeLocalStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('ключ начинается с bb_depth_', () => {
    blocksDepthMirror.write(1);
    const k = localStorage.key(0);
    expect(k).toMatch(/^bb_depth_/);
  });

  it('ключи bb_depth_ и spicy_depth_ не конфликтуют', () => {
    depthMirror.write(10);
    blocksDepthMirror.write(20);
    expect(depthMirror.read()).toBe(10);
    expect(blocksDepthMirror.read()).toBe(20);
  });

  it('ключи без точек (§5 DESIGN-BLOCKS.md)', () => {
    blocksDepthMirror.write(1);
    const k = localStorage.key(0);
    expect(k).not.toContain('.');
  });

  it('round-trip / cap / clear', () => {
    blocksDepthMirror.write(15);
    expect(blocksDepthMirror.read()).toBe(15);
    blocksDepthMirror.write(600);
    expect(blocksDepthMirror.read()).toBe(MAX_DEPTH);
    blocksDepthMirror.clear();
    expect(blocksDepthMirror.read()).toBe(0);
  });
});
