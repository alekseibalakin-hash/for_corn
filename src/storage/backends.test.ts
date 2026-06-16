import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coalescingStore } from './backends';
import type { KVStore } from './types';

function fakeInner() {
  const data = new Map<string, string>();
  const sets: { key: string; value: string }[] = [];
  const store: KVStore = {
    async getItem(k) {
      return data.has(k) ? data.get(k)! : null;
    },
    async setItem(k, v) {
      sets.push({ key: k, value: v });
      data.set(k, v);
    },
    async removeItem(k) {
      data.delete(k);
    },
  };
  return { store, data, sets };
}

describe('coalescingStore — фикс потери прогресса (CloudStorage троттлинг)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('коалесинг + last-write-wins: пачка записей одного ключа → во внутренний уходит ТОЛЬКО последнее', async () => {
    const inner = fakeInner();
    const s = coalescingStore(inner.store, 400);
    await s.setItem('wallet', '8');
    await s.setItem('wallet', '9');
    await s.setItem('wallet', '13');
    await vi.advanceTimersByTimeAsync(400);
    const walletSets = inner.sets.filter((c) => c.key === 'wallet');
    expect(walletSets).toHaveLength(1); // не 3 записи — схлопнули
    expect(walletSets[0].value).toBe('13'); // последнее значение, без клоббера старым
    expect(inner.data.get('wallet')).toBe('13');
  });

  it('read-your-writes: getItem отдаёт ещё не сброшенное значение', async () => {
    const inner = fakeInner();
    const s = coalescingStore(inner.store, 400);
    await s.setItem('progress', 'NEW');
    expect(await s.getItem('progress')).toBe('NEW'); // до flush — из очереди
    expect(inner.data.has('progress')).toBe(false); // во внутренний ещё не ушло
    await vi.advanceTimersByTimeAsync(400);
    expect(inner.data.get('progress')).toBe('NEW'); // после flush — durable
  });

  it('несколько ключей пишутся, и getItem без записи читает из внутреннего', async () => {
    const inner = fakeInner();
    inner.data.set('history', 'OLD');
    const s = coalescingStore(inner.store, 400);
    await s.setItem('wallet', 'W');
    await s.setItem('stats', 'S');
    expect(await s.getItem('history')).toBe('OLD'); // нет в очереди → из внутреннего
    await vi.advanceTimersByTimeAsync(400);
    expect(inner.data.get('wallet')).toBe('W');
    expect(inner.data.get('stats')).toBe('S');
  });

  it('removeItem коалесится и применяется (getItem сразу видит null)', async () => {
    const inner = fakeInner();
    inner.data.set('k', 'v');
    const s = coalescingStore(inner.store, 400);
    await s.removeItem('k');
    expect(await s.getItem('k')).toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    expect(inner.data.has('k')).toBe(false);
  });
});
