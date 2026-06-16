import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../engine/types';
import { memoryBackend } from './backends';
import { byteLength, createRepository, trimHistory } from './repository';
import { defaultStats } from '../engine/stats';
import { defaultM3Game, defaultM3Stats } from '../games/match3/stats';
import type { Board as Match3Board } from '../games/match3/logic';

const entry = (i: number): HistoryEntry => ({
  id: `cpn-${i}`,
  rewardId: 'tea-in-bed',
  tier: 'small',
  unlockedAt: i,
  expiresAt: i + 1000,
  achievementId: 'welcome',
  resolvedAt: i + 500,
  reason: i % 2 ? 'redeemed' : 'expired',
});

describe('trimHistory', () => {
  it('режет по длине', () => {
    const many = Array.from({ length: 300 }, (_, i) => entry(i));
    expect(trimHistory(many, 1_000_000, 120)).toHaveLength(120);
  });

  it('держит размер под лимитом байтов CloudStorage', () => {
    const many = Array.from({ length: 300 }, (_, i) => entry(i));
    const trimmed = trimHistory(many, 3500, 120);
    expect(byteLength(JSON.stringify(trimmed))).toBeLessThanOrEqual(3500);
    // сохраняет именно самые новые (первые в массиве)
    expect(trimmed[0].id).toBe('cpn-0');
  });
});

describe('repository round-trip', () => {
  it('пишет и читает stats через backend', async () => {
    const repo = createRepository(memoryBackend());
    expect(await repo.loadStats()).toBeNull();
    const stats = { ...defaultStats(), totalScore: 1234, rewardsRedeemed: 2 };
    await repo.saveStats(stats);
    expect(await repo.loadStats()).toEqual(stats);
  });

  it('переживает «перезагрузку»: новый repo поверх того же backend видит данные', async () => {
    const backend = memoryBackend();
    const repo1 = createRepository(backend);
    await repo1.saveProgress({ completed: ['welcome'], challengeCooldowns: {}, challengeCouponsToday: 1, couponDayDate: '2026-06-15' });
    const repo2 = createRepository(backend);
    const loaded = await repo2.loadProgress();
    expect(loaded?.completed).toEqual(['welcome']);
  });

  it('битый JSON не роняет загрузку — возвращает null', async () => {
    const repo = createRepository(memoryBackend({ stats: '{не json' }));
    expect(await repo.loadStats()).toBeNull();
  });

  it('saveHistory применяет обрезку', async () => {
    const repo = createRepository(memoryBackend());
    const many = Array.from({ length: 300 }, (_, i) => entry(i));
    await repo.saveHistory(many);
    const loaded = await repo.loadHistory();
    expect(loaded!.length).toBeLessThanOrEqual(120);
  });

  it('version round-trip и resetState чистят игровое состояние', async () => {
    const repo = createRepository(memoryBackend());
    await repo.saveStats({ ...defaultStats(), totalScore: 999 });
    await repo.saveHistory([entry(1)]);
    await repo.setVersion('3');
    expect(await repo.getVersion()).toBe('3');

    await repo.resetState();
    expect(await repo.loadStats()).toBeNull();
    expect(await repo.loadHistory()).toBeNull();
    expect(await repo.getVersion()).toBe('3'); // версию resetState НЕ трогает
  });

  it('match3: board/stats round-trip и чистятся в resetState (Фаза B)', async () => {
    const repo = createRepository(memoryBackend());
    const board: Match3Board = [[{ type: 0 }, { type: 1, special: 'line' }]];
    await repo.saveMatch3Board({ board, game: { ...defaultM3Game(), sessionScore: 777 } });
    await repo.saveMatch3Stats({ ...defaultM3Stats(), totalScore: 555, gamesPlayed: 3 });

    const loadedBoard = await repo.loadMatch3Board();
    expect(loadedBoard?.board).toEqual(board);
    expect(loadedBoard?.game.sessionScore).toBe(777);
    expect((await repo.loadMatch3Stats())?.totalScore).toBe(555);

    await repo.resetState();
    expect(await repo.loadMatch3Board()).toBeNull();
    expect(await repo.loadMatch3Stats()).toBeNull();
  });
});
