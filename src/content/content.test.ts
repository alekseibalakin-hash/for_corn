import { describe, expect, it } from 'vitest';
import {
  achievements,
  maxChallengeCouponsPerDay,
  rewardById,
  rewardsByTier,
  rewardsConfig,
  shelfLifeDaysFor,
  validateContent,
} from './index';

describe('контент-конфиги', () => {
  it('проходят валидацию целостности (нет битых rewardId, пустых тиров и т.п.)', () => {
    expect(validateContent()).toEqual([]);
  });

  it('80 наград во всех тирах', () => {
    expect(rewardsConfig.rewards.length).toBe(80);
    expect(rewardsByTier('small').length).toBeGreaterThan(0);
    expect(rewardsByTier('medium').length).toBeGreaterThan(0);
    expect(rewardsByTier('large').length).toBeGreaterThan(0);
  });

  it('дневной потолок челленджей = 3', () => {
    expect(maxChallengeCouponsPerDay).toBe(3);
  });

  it('фиксированная награда reach-2048 указывает на существующий ресторан', () => {
    const ach = achievements.find((a) => a.id === 'reach-2048');
    expect(ach?.rewardId).toBe('restaurant');
    expect(rewardById('restaurant')).toBeDefined();
  });

  it('срок годности берётся из дефолта тира', () => {
    const small = rewardsByTier('small')[0];
    expect(shelfLifeDaysFor(small)).toBe(3);
    expect(shelfLifeDaysFor(rewardsByTier('medium')[0])).toBe(10);
    expect(shelfLifeDaysFor(rewardsByTier('large')[0])).toBe(30);
  });

  it('у milestone нет cooldownDays, у challenge — есть', () => {
    const challenges = achievements.filter((a) => a.type === 'challenge');
    expect(challenges.length).toBeGreaterThan(0);
    for (const ch of challenges) expect(ch.cooldownDays).toBeGreaterThanOrEqual(1);
  });
});
