import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../engine/types';
import { memoryBackend } from './backends';
import { byteLength, createRepository, trimHistory } from './repository';
import { STORAGE_KEYS } from './types';
import type { KVStore } from './types';
import { defaultStats } from '../engine/stats';
import { defaultM3Game, defaultM3Stats } from '../games/match3/stats';
import { emptyObstacles, normalizeObstacles, type Board as Match3Board } from '../games/match3/logic';
import { generateLevel, normalizeSpicy, type SpicyLevelState } from '../games/match3/levels';
import { blocksStateFromLevel, generateLevel as generateBlocksLevel } from '../games/blocks/levels';
import { defaultBBStats } from '../games/blocks/stats';

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

/** Бэкенд-заглушка, чей getItem всегда реджектит (имитирует таймаут CloudStorage). */
function rejectingReadBackend(): KVStore {
  return {
    getItem: (_key) => Promise.reject(new Error('CloudStorage timeout')),
    setItem: async () => {},
    removeItem: async () => {},
  };
}

describe('loadJSON — стойкость к сбою getItem (фикс A)', () => {
  it('reject от getItem пробрасывается (НЕ трактуется как «нет данных»)', async () => {
    const repo = createRepository(rejectingReadBackend());
    // Каждый loadXxx должен rejected, а не возвращать null
    await expect(repo.loadStats()).rejects.toThrow('CloudStorage timeout');
    await expect(repo.loadBoard()).rejects.toThrow('CloudStorage timeout');
    await expect(repo.loadMatch3Board()).rejects.toThrow('CloudStorage timeout');
    await expect(repo.loadMatch3Stats()).rejects.toThrow('CloudStorage timeout');
    await expect(repo.loadWallet()).rejects.toThrow('CloudStorage timeout');
    await expect(repo.loadHistory()).rejects.toThrow('CloudStorage timeout');
    await expect(repo.loadProgress()).rejects.toThrow('CloudStorage timeout');
  });

  it('реальные данные в store целы после reject — saveXxx с дефолтом не вызывался', async () => {
    const inner = memoryBackend({
      stats: JSON.stringify({ ...defaultStats(), totalScore: 9999 }),
      match3_stats: JSON.stringify({ ...defaultM3Stats(), totalScore: 777 }),
    });
    // Backend реджектит чтение, но write проксируется на inner (чтобы убедиться: ничего не написано)
    const failRead: KVStore = {
      getItem: (_key) => Promise.reject(new Error('timeout')),
      setItem: (k, v) => inner.setItem(k, v),
      removeItem: (k) => inner.removeItem(k),
    };
    const repo = createRepository(failRead);
    // Попытки читать — бросают
    await expect(repo.loadStats()).rejects.toThrow();
    await expect(repo.loadMatch3Stats()).rejects.toThrow();
    // Исходные данные в inner НЕ затёрты (saveXxx не вызван с дефолтом)
    expect(JSON.parse((await inner.getItem('stats'))!)?.totalScore).toBe(9999);
    expect(JSON.parse((await inner.getItem('match3_stats'))!)?.totalScore).toBe(777);
  });

  it('подлинное отсутствие ключа (getItem → null) даёт null без броска', async () => {
    const repo = createRepository(memoryBackend());
    expect(await repo.loadStats()).toBeNull();
    expect(await repo.loadBoard()).toBeNull();
    expect(await repo.loadMatch3Board()).toBeNull();
    expect(await repo.loadMatch3Stats()).toBeNull();
    expect(await repo.loadWallet()).toBeNull();
    expect(await repo.loadHistory()).toBeNull();
    expect(await repo.loadProgress()).toBeNull();
  });

  it('битый JSON → null без краша (только parse-ошибка перехватывается)', async () => {
    const repo = createRepository(memoryBackend({
      stats: '{не json',
      'match3.board': 'garbage',
      wallet: '[[broken',
    }));
    expect(await repo.loadStats()).toBeNull();
    expect(await repo.loadMatch3Board()).toBeNull();
    expect(await repo.loadWallet()).toBeNull();
  });
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
    await repo1.saveProgress({ completed: ['welcome'], challengeCooldowns: {}, challengeCouponsToday: 1, easyCouponsTotalToday: 0, easyCouponsByGameToday: {}, couponDayDate: '2026-06-15' });
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
    expect(loadedBoard?.game?.sessionScore).toBe(777);
    expect((await repo.loadMatch3Stats())?.totalScore).toBe(555);

    await repo.resetState();
    expect(await repo.loadMatch3Board()).toBeNull();
    expect(await repo.loadMatch3Stats()).toBeNull();
  });

  it('blocks: board/stats round-trip и чистятся в resetState (Фаза 2)', async () => {
    const repo = createRepository(memoryBackend());
    const slot = blocksStateFromLevel(generateBlocksLevel(3, 4242));
    await repo.saveBlocksBoard({ level: slot });
    await repo.saveBlocksStats({ ...defaultBBStats(), totalScore: 1234, maxLevel: 7 });

    const loadedBoard = await repo.loadBlocksBoard();
    expect(loadedBoard?.level?.level).toBe(slot.level);
    expect(loadedBoard?.level?.setsLeft).toBe(slot.setsLeft);
    const loadedStats = await repo.loadBlocksStats();
    expect(loadedStats?.totalScore).toBe(1234);
    expect(loadedStats?.maxLevel).toBe(7);

    await repo.resetState();
    expect(await repo.loadBlocksBoard()).toBeNull();
    expect(await repo.loadBlocksStats()).toBeNull();
  });

  it('blocks: bb_board может хранить null (победа/чистый старт) — грузится без падения', async () => {
    const repo = createRepository(memoryBackend());
    await repo.saveBlocksBoard({ level: null });
    expect((await repo.loadBlocksBoard())?.level ?? null).toBeNull();
  });

  it('match3: obstacles round-trip (Комнаты, Фаза 1) — аддитивно, на существующем ключе', async () => {
    const repo = createRepository(memoryBackend());
    const board: Match3Board = [[{ type: 0 }, null]];
    const obstacles = emptyObstacles();
    obstacles.blocks[0][1] = true;
    obstacles.ice[0][0] = 1;
    await repo.saveMatch3Board({ board, game: defaultM3Game(), obstacles });
    const loaded = await repo.loadMatch3Board();
    expect(normalizeObstacles(loaded?.obstacles).blocks[0][1]).toBe(true);
    expect(normalizeObstacles(loaded?.obstacles).ice[0][0]).toBe(1);
    // obstacles живут на том же ключе match3.board ⇒ чистятся resetState
    await repo.resetState();
    expect(await repo.loadMatch3Board()).toBeNull();
  });

  it('match3: СТАРЫЙ board жены без obstacles грузится — поле через дефолт пустое (миграция)', async () => {
    // Эмулируем ровно blob предыдущей версии: только {board, game}, без поля obstacles.
    // (A1: ключ match3_board — точки невалидны для Telegram CloudStorage, данных под старым match3.board там нет.)
    const legacy = JSON.stringify({ board: [[{ type: 2 }, { type: 3 }]], game: { ...defaultM3Game(), sessionScore: 42 } });
    const repo = createRepository(memoryBackend({ match3_board: legacy }));
    const loaded = await repo.loadMatch3Board();
    expect(loaded?.game?.sessionScore).toBe(42); // партия читается
    expect(loaded?.obstacles).toBeUndefined(); // нового поля нет
    const ob = normalizeObstacles(loaded?.obstacles); // читаем через дефолт
    expect(ob.blocks.flat().some(Boolean)).toBe(false); // блоков нет
    expect(ob.ice.flat().some((n) => n > 0)).toBe(false); // льда нет
  });

  it('match3: эндлесс пишет blob БЕЗ obstacles (байт-в-байт прежний формат)', async () => {
    const backend = memoryBackend();
    const repo = createRepository(backend);
    await repo.saveMatch3Board({ board: [[{ type: 1 }]], game: defaultM3Game() });
    const raw = await backend.getItem('match3_board');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).obstacles).toBeUndefined(); // поля obstacles в эндлесс-blob нет
  });

  it('match3: spicy-слот round-trip + dual-slot (лайт top + spicy не затирают друг друга) + reset', async () => {
    const repo = createRepository(memoryBackend());
    const lvl = generateLevel(2, 5);
    const spicy: SpicyLevelState = {
      level: lvl.level,
      seed: lvl.seed,
      movesLeft: lvl.movesBudget,
      goal: lvl.goal,
      progress: 0,
      streamPos: 0,
      board: lvl.board,
      obstacles: lvl.obstacles,
    };
    // ПОЛНЫЙ объект: лайт-слот {board, game} + spicy-слот — оба должны пережить round-trip.
    const lightBoard: Match3Board = [[{ type: 1 }, { type: 2 }]];
    await repo.saveMatch3Board({ board: lightBoard, game: { ...defaultM3Game(), sessionScore: 99 }, spicy });
    const loaded = await repo.loadMatch3Board();
    expect(loaded?.board).toEqual(lightBoard); // лайт-слот цел
    expect(loaded?.game?.sessionScore).toBe(99);
    expect(normalizeSpicy(loaded?.spicy)?.level).toBe(lvl.level); // spicy-слот цел
    expect(normalizeSpicy(loaded?.spicy)?.movesLeft).toBe(lvl.movesBudget);
    await repo.resetState(); // оба слота на одном ключе → чистятся целиком
    expect(await repo.loadMatch3Board()).toBeNull();
  });

  it('match3: лайт-сейв БЕЗ перчинки не несёт ключей spicy/mode (байт-в-байт прежний формат жены)', async () => {
    const backend = memoryBackend();
    const repo = createRepository(backend);
    await repo.saveMatch3Board({ board: [[{ type: 1 }]], game: defaultM3Game() });
    const raw = JSON.parse((await backend.getItem('match3_board'))!);
    expect(raw.spicy).toBeUndefined();
    expect(raw.mode).toBeUndefined();
    expect(raw.obstacles).toBeUndefined();
  });

  it('match3: spicy-only blob (игрок зашёл сразу в перчинку) — board лайта undefined, грузится без краша', async () => {
    const repo = createRepository(memoryBackend());
    const lvl = generateLevel(1, 3);
    const spicy: SpicyLevelState = {
      level: lvl.level, seed: lvl.seed, movesLeft: lvl.movesBudget, goal: lvl.goal,
      progress: 0, streamPos: 0, board: lvl.board, obstacles: lvl.obstacles,
    };
    await repo.saveMatch3Board({ spicy }); // нет лайт-слота
    const loaded = await repo.loadMatch3Board();
    expect(loaded?.board).toBeUndefined(); // лайт-загрузка по Array.isArray(board) уйдёт в «нет партии»
    expect(normalizeSpicy(loaded?.spicy)?.level).toBe(lvl.level);
  });
});

describe('STORAGE_KEYS — Telegram CloudStorage совместимость (A1)', () => {
  it('все значения ключей содержат только символы A-Za-z0-9_- (без точек)', () => {
    const validKey = /^[A-Za-z0-9_-]+$/;
    for (const [name, key] of Object.entries(STORAGE_KEYS)) {
      expect(key, `STORAGE_KEYS.${name} = "${key}" содержит недопустимые символы`).toMatch(validKey);
    }
  });
});
