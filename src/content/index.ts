import achievementsJson from '../../content/achievements.json';
import rewardsJson from '../../content/rewards.json';
import {
  isAllOf,
  isAnyOf,
  isCondition,
  type Achievement,
  type AchievementsConfig,
  type Reward,
  type RewardsConfig,
  type Tier,
  type Trigger,
} from './types';

export * from './types';

const TIERS: Tier[] = ['small', 'medium', 'large'];
const OPERATORS = new Set(['>=', '<=', '>', '<', '==']);

// JSON-импорт даёт «широкие» типы (tier: string и т.п.) + служебное поле _comment,
// поэтому приводим к нашим типам и валидируем целостность в рантайме.
export const rewardsConfig = rewardsJson as unknown as RewardsConfig;
export const achievementsConfig = achievementsJson as unknown as AchievementsConfig;

const rewardsById = new Map<string, Reward>();
const rewardsByTierMap = new Map<Tier, Reward[]>(TIERS.map((t) => [t, []]));

for (const reward of rewardsConfig.rewards) {
  rewardsById.set(reward.id, reward);
  rewardsByTierMap.get(reward.tier)?.push(reward);
}

export function rewardById(id: string): Reward | undefined {
  return rewardsById.get(id);
}

export function rewardsByTier(tier: Tier): Reward[] {
  return rewardsByTierMap.get(tier) ?? [];
}

export function tierEmoji(tier: Tier): string {
  return rewardsConfig.tierDefaults[tier].emoji;
}

/** Срок годности награды: переопределение на награде, иначе дефолт тира (DESIGN §6). */
export function shelfLifeDaysFor(reward: Reward): number {
  return reward.shelfLifeDays ?? rewardsConfig.tierDefaults[reward.tier].shelfLifeDays;
}

export const achievements: Achievement[] = achievementsConfig.achievements;
export const maxChallengeCouponsPerDay = achievementsConfig.limits.maxChallengeCouponsPerDay;

/**
 * Валидация целостности контента. Вызывается на старте приложения и в тестах:
 * ловит опечатки в JSON (несуществующий rewardId, пустой тир, кривой оператор)
 * до того, как они станут багом «ачивка сработала, а купон не дали».
 */
export function validateContent(): string[] {
  const problems: string[] = [];

  for (const tier of TIERS) {
    if (!rewardsConfig.tierDefaults[tier]) {
      problems.push(`tierDefaults: нет тира ${tier}`);
    }
    if (rewardsByTier(tier).length === 0) {
      problems.push(`в тире ${tier} нет ни одной награды (rewardTier некому отдать)`);
    }
  }

  const seenReward = new Set<string>();
  for (const reward of rewardsConfig.rewards) {
    if (seenReward.has(reward.id)) problems.push(`дубль rewardId: ${reward.id}`);
    seenReward.add(reward.id);
    if (!TIERS.includes(reward.tier)) problems.push(`reward ${reward.id}: неизвестный тир ${reward.tier}`);
  }

  const seenAch = new Set<string>();
  for (const ach of achievements) {
    if (seenAch.has(ach.id)) problems.push(`дубль achievementId: ${ach.id}`);
    seenAch.add(ach.id);

    if (!ach.rewardTier && !ach.rewardId) {
      problems.push(`achievement ${ach.id}: нет ни rewardTier, ни rewardId`);
    }
    if (ach.rewardId && !rewardsById.has(ach.rewardId)) {
      problems.push(`achievement ${ach.id}: rewardId «${ach.rewardId}» не найден`);
    }
    if (ach.rewardTier && !TIERS.includes(ach.rewardTier)) {
      problems.push(`achievement ${ach.id}: неизвестный rewardTier ${ach.rewardTier}`);
    }
    if (ach.type === 'challenge' && (ach.cooldownDays === undefined || ach.cooldownDays < 0)) {
      problems.push(`challenge ${ach.id}: нужен неотрицательный cooldownDays`);
    }
    problems.push(...validateTrigger(ach.trigger, ach.id));
  }

  return problems;
}

function validateTrigger(trigger: Trigger, achId: string): string[] {
  if (isAllOf(trigger)) return trigger.allOf.flatMap((t) => validateTrigger(t, achId));
  if (isAnyOf(trigger)) return trigger.anyOf.flatMap((t) => validateTrigger(t, achId));
  if (isCondition(trigger)) {
    if (!OPERATORS.has(trigger.op)) return [`achievement ${achId}: неизвестный оператор ${trigger.op}`];
    if (typeof trigger.value !== 'number') return [`achievement ${achId}: value должно быть числом`];
    return [];
  }
  return [`achievement ${achId}: непонятный trigger`];
}
