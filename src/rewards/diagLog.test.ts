import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagLog, MAX_ENTRIES } from './diagLog';

// Окружение node (vite.config) — без DOM. Подменяем localStorage Map-фейком (как в depthMirror.test).
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

describe('diagLog — синхронный журнал событий кошелька', () => {
  beforeEach(() => vi.stubGlobal('localStorage', makeLocalStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('push → read: событие сохраняется с меткой времени и типом', () => {
    diagLog.push('grant', { added: 2, walletAfter: 5 });
    const log = diagLog.read();
    expect(log).toHaveLength(1);
    expect(log[0].ev).toBe('grant');
    expect(log[0].added).toBe(2);
    expect(log[0].walletAfter).toBe(5);
    expect(typeof log[0].t).toBe('number');
  });

  it('порядок сохраняется (старые→новые)', () => {
    diagLog.push('boot', { walletAfter: 3 });
    diagLog.push('grant', { added: 1 });
    diagLog.push('redeem', { id: 'x' });
    expect(diagLog.read().map((e) => e.ev)).toEqual(['boot', 'grant', 'redeem']);
  });

  it('кольцевой буфер: при переполнении держим последние MAX_ENTRIES, выкидываем старые', () => {
    for (let i = 0; i < MAX_ENTRIES + 50; i++) diagLog.push('save', { idx: i });
    const log = diagLog.read();
    expect(log).toHaveLength(MAX_ENTRIES);
    expect(log[0].idx).toBe(50); // первые 50 вытеснены
    expect(log[log.length - 1].idx).toBe(MAX_ENTRIES + 49); // новейшее на месте
  });

  it('clear очищает журнал', () => {
    diagLog.push('grant', {});
    diagLog.clear();
    expect(diagLog.read()).toEqual([]);
  });

  it('битый JSON в хранилище → read() = [] (не кидает)', () => {
    localStorage.setItem('love2048:diag_events', '{не json');
    expect(() => diagLog.read()).not.toThrow();
    expect(diagLog.read()).toEqual([]);
  });

  it('НИКОГДА не кидает, даже если localStorage недоступен', () => {
    vi.unstubAllGlobals(); // убираем localStorage целиком (как в реально сломанном окружении)
    expect(() => diagLog.push('grant', { x: 1 })).not.toThrow();
    expect(() => diagLog.read()).not.toThrow();
    expect(() => diagLog.clear()).not.toThrow();
    expect(diagLog.read()).toEqual([]);
  });
});
