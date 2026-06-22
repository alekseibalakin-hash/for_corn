import achievementsJson from '../../content/achievements.json';
import blocksJson from '../../content/blocks.json';
import rewardsJson from '../../content/rewards.json';
import spicyJson from '../../content/spicy.json';
import {
  isAllOf,
  isAnyOf,
  isCondition,
  type Achievement,
  type AchievementsConfig,
  type BlocksBand,
  type BlocksConfig,
  type Reward,
  type RewardsConfig,
  type SpicyBand,
  type SpicyConfig,
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
export const spicyConfig = spicyJson as unknown as SpicyConfig;
export const blocksConfig = blocksJson as unknown as BlocksConfig;

/** Бэнд сложности «перчинки» для уровня: первый бэнд, чей `maxLevel >= level` (бэнды отсортированы). */
export function spicyBandForLevel(level: number): SpicyBand {
  const bands = spicyConfig.bands;
  for (const band of bands) if (level <= band.maxLevel) return band;
  return bands[bands.length - 1];
}

/** Бэнд сложности «блоков-фигур» для уровня. */
export function blocksBandForLevel(level: number): BlocksBand {
  const bands = blocksConfig.bands;
  for (const band of bands) if (level <= band.maxLevel) return band;
  return bands[bands.length - 1];
}

const rewardsById = new Map<string, Reward>();
const rewardsByTierMap = new Map<Tier, Reward[]>(TIERS.map((t) => [t, []]));

// Именные награды (ach.rewardId) исключаются из случайного тир-пула: иначе 12+ large-ачивок
// могут случайно выкатить «restaurant»/«fine-dining», и дедуп тихо подавит эмоциональную
// именную веху (DESIGN §15 + adversarial review A4).
const reservedRewardIds = new Set<string>(
  achievementsConfig.achievements.filter((a) => a.rewardId).map((a) => a.rewardId!),
);

for (const reward of rewardsConfig.rewards) {
  rewardsById.set(reward.id, reward);
  if (!reservedRewardIds.has(reward.id)) {
    rewardsByTierMap.get(reward.tier)?.push(reward);
  }
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
export const maxEasyPerGamePerDay = achievementsConfig.limits.maxEasyPerGamePerDay;
export const maxEasyPerDayTotal = achievementsConfig.limits.maxEasyPerDayTotal;

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
  const rewardIdFirstUser = new Map<string, string>(); // rewardId → первая ачивка
  for (const ach of achievements) {
    if (seenAch.has(ach.id)) problems.push(`дубль achievementId: ${ach.id}`);
    seenAch.add(ach.id);

    if (ach.rewardId) {
      const first = rewardIdFirstUser.get(ach.rewardId);
      if (first) {
        // НЕ throw — подарок не должен падать. Но это значит: пока live-купон одной ачивки,
        // другая с тем же rewardId не выдастся (движок achievements.ts это гейтит).
        problems.push(`[warn] ачивки ${first} и ${ach.id} используют один rewardId «${ach.rewardId}» — при живом купоне второй купон не выдастся`);
      } else {
        rewardIdFirstUser.set(ach.rewardId, ach.id);
      }
    }

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

  // Belt-and-suspenders: именная награда не должна быть в случайном тир-пуле (A4).
  for (const ach of achievements) {
    if (ach.rewardId) {
      const reward = rewardsById.get(ach.rewardId);
      if (reward && rewardsByTier(reward.tier).some((r) => r.id === ach.rewardId)) {
        problems.push(`[warn] именная награда «${ach.rewardId}» (ачивка ${ach.id}) попала в случайный пул тира ${reward.tier} — баг в reservedRewardIds`);
      }
    }
  }

  problems.push(...validateSpicyBands());
  problems.push(...validateBlocksBands());

  return problems;
}

/**
 * §A4-тесты: параметрическая версия validateContent для негативных юнит-тестов.
 * Принимает произвольный набор наград и ачивок; не использует глобальный контент.
 */
export function validateContentWith(rewards: Reward[], achs: Achievement[]): string[] {
  const problems: string[] = [];

  const byId = new Map<string, Reward>();
  const byTier = new Map<Tier, Reward[]>(TIERS.map((t) => [t, []]));
  const reserved = new Set<string>(achs.filter((a) => a.rewardId).map((a) => a.rewardId!));

  for (const reward of rewards) {
    byId.set(reward.id, reward);
    if (!reserved.has(reward.id)) byTier.get(reward.tier)?.push(reward);
  }

  for (const tier of TIERS) {
    if ((byTier.get(tier)?.length ?? 0) === 0 && achs.some((a) => a.rewardTier === tier)) {
      problems.push(`в тире ${tier} нет ни одной награды (rewardTier некому отдать)`);
    }
  }

  const rewardIdFirstUser = new Map<string, string>();
  for (const ach of achs) {
    if (ach.rewardId && !byId.has(ach.rewardId)) {
      problems.push(`achievement ${ach.id}: rewardId «${ach.rewardId}» не найден`);
    }
    if (ach.rewardId) {
      const first = rewardIdFirstUser.get(ach.rewardId);
      if (first) {
        problems.push(`[warn] ачивки ${first} и ${ach.id} используют один rewardId «${ach.rewardId}»`);
      } else {
        rewardIdFirstUser.set(ach.rewardId, ach.id);
      }
    }
    // Belt-and-suspenders: именная награда не должна быть в случайном тир-пуле (A4).
    if (ach.rewardId) {
      const reward = byId.get(ach.rewardId);
      if (reward && (byTier.get(reward.tier) ?? []).some((r) => r.id === ach.rewardId)) {
        problems.push(`[warn] именная награда «${ach.rewardId}» (ачивка ${ach.id}) попала в случайный пул тира ${reward.tier} — баг в reservedRewardIds`);
      }
    }
  }

  return problems;
}

// ПОТОЛОК ЧЕСТНОСТИ (бриф §2.4): глубже не плотнее обстаклами, а туже generosity.
const SPICY_ICE_CEILING = 28;
const SPICY_BLOCK_CEILING = 6;

/**
 * Инварианты кривой «перчинки» (бриф §3): бэнды монотонны (диапазоны уровней растут, лёд/блоки не
 * убывают, generosity не растёт и всегда > 1), и соблюдён потолок честности (iceMax ≤ 28, blocksMax ≤ 6,
 * иначе солвер-гейт может не находить решение). Ловит кривой JSON до того, как он даст непроходимый уровень.
 */
function validateSpicyBands(): string[] {
  const problems: string[] = [];
  const bands = spicyConfig.bands;
  if (!Array.isArray(bands) || bands.length === 0) return ['spicy: нет ни одного бэнда сложности'];
  let prev: SpicyBand | null = null;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.iceMin < 1 || b.iceMax < b.iceMin) problems.push(`spicy band ${i}: некорректный диапазон льда`);
    if (b.blocksMin < 0 || b.blocksMax < b.blocksMin) problems.push(`spicy band ${i}: некорректный диапазон блоков`);
    if (b.budgetMultiplier <= 1) problems.push(`spicy band ${i}: budgetMultiplier должен быть > 1`);
    if (b.budgetK !== undefined && b.budgetK <= 0) problems.push(`spicy band ${i}: budgetK должен быть > 0`);
    if (b.clusterChance < 0 || b.clusterChance > 1) problems.push(`spicy band ${i}: clusterChance вне [0,1]`);
    if (b.iceMax > SPICY_ICE_CEILING) problems.push(`spicy band ${i}: iceMax > потолка честности ${SPICY_ICE_CEILING}`);
    if (b.blocksMax > SPICY_BLOCK_CEILING) problems.push(`spicy band ${i}: blocksMax > потолка честности ${SPICY_BLOCK_CEILING}`);
    if (prev) {
      if (b.maxLevel <= prev.maxLevel) problems.push(`spicy band ${i}: maxLevel не возрастает`);
      if (b.iceMin < prev.iceMin || b.iceMax < prev.iceMax) problems.push(`spicy band ${i}: лёд убывает (не монотонно)`);
      if (b.blocksMax < prev.blocksMax) problems.push(`spicy band ${i}: блоки убывают (не монотонно)`);
      if (b.budgetMultiplier > prev.budgetMultiplier) problems.push(`spicy band ${i}: generosity растёт (должна туже)`);
    }
    prev = b;
  }
  return problems;
}

// ПОТОЛОК ЧЕСТНОСТИ блоков: больше 16 особых блоков — солвер-гейт резко дорожает.
const BLOCKS_CEILING = 16;

function validateBlocksBands(): string[] {
  const problems: string[] = [];
  const bands = blocksConfig.bands;
  if (!Array.isArray(bands) || bands.length === 0) return ['blocks: нет ни одного бэнда сложности'];
  let prev: BlocksBand | null = null;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.blocksMin < 1 || b.blocksMax < b.blocksMin) problems.push(`blocks band ${i}: некорректный диапазон блоков`);
    if (b.budgetMultiplier <= 1) problems.push(`blocks band ${i}: budgetMultiplier должен быть > 1`);
    if (b.budgetK !== undefined && b.budgetK <= 0) problems.push(`blocks band ${i}: budgetK должен быть > 0`);
    if (b.clusterChance < 0 || b.clusterChance > 1) problems.push(`blocks band ${i}: clusterChance вне [0,1]`);
    if (b.blocksMax > BLOCKS_CEILING) problems.push(`blocks band ${i}: blocksMax > потолка честности ${BLOCKS_CEILING}`);
    if (prev) {
      if (b.maxLevel <= prev.maxLevel) problems.push(`blocks band ${i}: maxLevel не возрастает`);
      if (b.blocksMin < prev.blocksMin || b.blocksMax < prev.blocksMax) problems.push(`blocks band ${i}: блоки убывают (не монотонно)`);
      if (b.budgetMultiplier > prev.budgetMultiplier) problems.push(`blocks band ${i}: generosity растёт (должна убывать)`);
    }
    prev = b;
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
