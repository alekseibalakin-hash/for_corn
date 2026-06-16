import { describe, expect, it } from 'vitest';
import { bootRewards } from './boot';
import { createRepository, memoryBackend, STORAGE_VERSION } from '../storage';
import { DAY_MS } from '../engine';

const NOW = Date.UTC(2026, 5, 16, 9, 0, 0); // 2026-06-16 (следующий день после last-played)
const TODAY = '2026-06-16';

/**
 * Старое (живое) состояние «жены» в форме schemaVersion='3':
 *  - stats.rewardsRedeemed > 0 (счётчик «подарено N» жил внутри 2048-stats);
 *  - купон в кошельке, использованный купон в истории;
 *  - id заданий в progress.completed; progress БЕЗ хаб-глобальных полей (их ещё нет).
 */
function seedOldState() {
  const legacyStats = {
    totalScore: 5000,
    bestScore: 3000,
    bestTile: 256,
    gamesPlayed: 4,
    totalMoves: 200,
    dailyStreak: 3,
    lastPlayedDate: '2026-06-15',
    firstPlayedDate: '2026-06-01',
    rewardsRedeemed: 2, // ← «подарено 2 радости»
  };
  const liveCoupon = {
    id: 'cpn-live-1',
    rewardId: 'tea-in-bed',
    tier: 'small' as const,
    unlockedAt: NOW - 1000,
    expiresAt: NOW + 2 * DAY_MS, // ещё живой
    achievementId: 'reach-256',
  };
  const historyEntry = {
    id: 'cpn-old-9',
    rewardId: 'restaurant',
    tier: 'large' as const,
    unlockedAt: NOW - 10 * DAY_MS,
    expiresAt: NOW - 5 * DAY_MS,
    achievementId: 'reach-2048',
    resolvedAt: NOW - 6 * DAY_MS,
    reason: 'redeemed' as const,
  };
  const oldProgress = {
    completed: ['welcome', 'reach-128', 'reach-2048'],
    challengeCooldowns: {},
    challengeCouponsToday: 1,
    couponDayDate: '2026-06-15',
    onboardingSeen: true,
    // ВАЖНО: ни rewardsRedeemed, ни dailyStreak — они жили в stats (форма v3).
  };
  const board = {
    grid: [
      [2, 4, 0, 0],
      [0, 16, 0, 0],
      [0, 0, 8, 0],
      [0, 0, 0, 2],
    ],
    game: { sessionScore: 480, maxTileThisGame: 16, movesThisGame: 12, gameStartTs: NOW - 60_000, timeToCurrentMaxTileSec: 30 },
    won: false,
  };

  const backend = memoryBackend({
    stats: JSON.stringify(legacyStats),
    wallet: JSON.stringify([liveCoupon]),
    history: JSON.stringify([historyEntry]),
    progress: JSON.stringify(oldProgress),
    board: JSON.stringify(board),
    schemaVersion: STORAGE_VERSION, // '3' — НЕ меняем, иначе ?reset обнулит
  });
  return { backend, legacyStats, liveCoupon, historyEntry, oldProgress, board };
}

describe('МИГРАЦИЯ Фаза A → хаб (DESIGN-HUB §4, DOD)', () => {
  it('кошелёк, история и completed НА МЕСТЕ; «подарено N» = старому rewardsRedeemed', async () => {
    const { backend, liveCoupon, historyEntry } = seedOldState();
    const repo = createRepository(backend);

    expect(await repo.getVersion()).toBe(STORAGE_VERSION); // версию не трогаем

    const [wallet, history, progress, legacyStats] = await Promise.all([
      repo.loadWallet(),
      repo.loadHistory(),
      repo.loadProgress(),
      repo.loadStats(),
    ]);

    const boot = bootRewards({ wallet, history, progress, legacyStats, now: NOW, today: TODAY });

    // Кошелёк цел — живой купон на месте.
    expect(boot.wallet.map((c) => c.id)).toEqual([liveCoupon.id]);
    // История цела — старая запись на месте.
    expect(boot.history.some((h) => h.id === historyEntry.id)).toBe(true);
    // completed цел — задания не потеряны.
    expect(boot.progress.completed).toEqual(['welcome', 'reach-128', 'reach-2048']);
    // «подарено N» перенесён из stats в progress без потерь.
    expect(boot.progress.rewardsRedeemed).toBe(2);
    // прочие флаги прогресса целы.
    expect(boot.progress.onboardingSeen).toBe(true);
    expect(boot.progress.challengeCouponsToday).toBe(1);
  });

  it('СЕРИЯ жены не оборвана: dailyStreak сидится из stats и продолжается на следующий день', async () => {
    const { backend } = seedOldState();
    const repo = createRepository(backend);
    const [wallet, history, progress, legacyStats] = await Promise.all([
      repo.loadWallet(),
      repo.loadHistory(),
      repo.loadProgress(),
      repo.loadStats(),
    ]);

    const boot = bootRewards({ wallet, history, progress, legacyStats, now: NOW, today: TODAY });

    // last-played '2026-06-15', сегодня '2026-06-16' → подряд: 3 (из stats) + 1 = 4.
    expect(boot.progress.dailyStreak).toBe(4);
    expect(boot.progress.lastPlayedDate).toBe(TODAY);
    expect(boot.progress.firstPlayedDate).toBe('2026-06-01'); // первый день сохранён
  });

  it('партия 2048 РЕЗЮМИТСЯ (board нетронут миграцией — резюм, не с нуля)', async () => {
    const { backend, board } = seedOldState();
    const repo = createRepository(backend);
    const loaded = await repo.loadBoard();
    expect(loaded).not.toBeNull();
    expect(loaded!.grid).toEqual(board.grid);
    expect(loaded!.game.sessionScore).toBe(480);
    expect(loaded!.won).toBe(false);
  });

  it('ИДЕМПОТЕНТНО: повторная загрузка после сохранения мигрированного progress не двигает счётчики', async () => {
    const { backend } = seedOldState();
    const repo = createRepository(backend);
    let [wallet, history, progress, legacyStats] = await Promise.all([
      repo.loadWallet(),
      repo.loadHistory(),
      repo.loadProgress(),
      repo.loadStats(),
    ]);
    const first = bootRewards({ wallet, history, progress, legacyStats, now: NOW, today: TODAY });
    await repo.saveProgress(first.progress);
    await repo.saveWallet(first.wallet);
    await repo.saveHistory(first.history);

    // Тот же день, повторный вход: rewardsRedeemed уже число → seedGlobals НЕ перезатирает,
    // dailyCheckIn идемпотентен (lastPlayed === today).
    [wallet, history, progress, legacyStats] = await Promise.all([
      repo.loadWallet(),
      repo.loadHistory(),
      repo.loadProgress(),
      repo.loadStats(),
    ]);
    const second = bootRewards({ wallet, history, progress, legacyStats, now: NOW, today: TODAY });

    expect(second.progress.rewardsRedeemed).toBe(2);
    expect(second.progress.dailyStreak).toBe(4); // не выросла повторно
    expect(second.progress.completed).toEqual(first.progress.completed);
  });

  it('сгорание на входе: просроченный купон уходит в историю, живой остаётся', async () => {
    const backend = memoryBackend({
      wallet: JSON.stringify([
        { id: 'dead', rewardId: 'tea-in-bed', tier: 'small', unlockedAt: NOW - 10 * DAY_MS, expiresAt: NOW - 1, achievementId: 'a' },
        { id: 'alive', rewardId: 'hug', tier: 'small', unlockedAt: NOW, expiresAt: NOW + 2 * DAY_MS, achievementId: 'b' },
      ]),
      schemaVersion: STORAGE_VERSION,
    });
    const repo = createRepository(backend);
    const [wallet, history, progress, legacyStats] = await Promise.all([
      repo.loadWallet(),
      repo.loadHistory(),
      repo.loadProgress(),
      repo.loadStats(),
    ]);
    const boot = bootRewards({ wallet, history, progress, legacyStats, now: NOW, today: TODAY });

    expect(boot.wallet.map((c) => c.id)).toEqual(['alive']);
    expect(boot.history.some((h) => h.id === 'dead' && h.reason === 'expired')).toBe(true);
  });
});
