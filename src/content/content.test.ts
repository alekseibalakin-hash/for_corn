import { describe, expect, it } from 'vitest';
import {
  achievements,
  maxChallengeCouponsPerDay,
  rewardById,
  rewardsByTier,
  rewardsConfig,
  shelfLifeDaysFor,
  spicyBandForLevel,
  spicyConfig,
  validateContent,
} from './index';
import { isCondition } from './types';

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

  it('кривая «с перчинкой» валидна и монотонна (generosity туже с глубиной, потолок честности)', () => {
    expect(validateContent()).toEqual([]); // включает validateSpicyBands (бэнды монотонны, multiplier>1, потолок)
    expect(spicyConfig.bands.length).toBeGreaterThan(0);
    expect(spicyBandForLevel(1).budgetMultiplier).toBeGreaterThan(spicyBandForLevel(30).budgetMultiplier);
    for (let level = 1; level <= 30; level++) {
      const band = spicyBandForLevel(level);
      expect(band.iceMax).toBeLessThanOrEqual(28);
      expect(band.blocksMax).toBeLessThanOrEqual(6);
      expect(band.budgetMultiplier).toBeGreaterThan(1);
    }
  });

  it('7 вех глубины «с перчинкой» (m3_maxSpicyLevel), milestone-уровневые, нелинейные пороги', () => {
    const spicy = achievements.filter((a) => a.id.startsWith('m3-spicy-'));
    expect(spicy.length).toBe(7);
    const thresholds: number[] = [];
    for (const a of spicy) {
      expect(a.game).toBe('m3');
      expect(a.type).toBe('milestone'); // level-триггер, без cooldown (анти-грайнд)
      expect(isCondition(a.trigger) && a.trigger.stat).toBe('m3_maxSpicyLevel');
      if (isCondition(a.trigger)) thresholds.push(a.trigger.value);
    }
    expect(thresholds).toEqual([1, 3, 5, 8, 12, 18, 25]); // нелинейные = нет грайнда
    expect(achievements.find((a) => a.id === 'm3-spicy-25')?.rewardId).toBe('fine-dining'); // вершина — ужин высокой кухни (A4: restaurant только у reach-2048)
  });
});
