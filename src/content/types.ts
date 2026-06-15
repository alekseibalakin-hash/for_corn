// Типы контент-конфигов. Контент отделён от кода (DESIGN §1): награды/ачивки/тексты
// живут в content/*.json. Здесь — только их типизация, по смыслу не правим (бриф).

export type Tier = 'small' | 'medium' | 'large';

export interface TierDefault {
  emoji: string;
  shelfLifeDays: number;
}

export interface Reward {
  id: string;
  tier: Tier;
  title: string;
  text: string;
  /** Необязательное переопределение срока годности (иначе — из tierDefaults). */
  shelfLifeDays?: number;
  /** Личное слово на раскрытии (если у ачивки нет своего note). */
  note?: string;
}

export interface RewardsConfig {
  tierDefaults: Record<Tier, TierDefault>;
  rewards: Reward[];
}

// --- Ачивки ---

export type Operator = '>=' | '<=' | '>' | '<' | '==';

export interface Condition {
  stat: string;
  op: Operator;
  value: number;
}

export interface AllOf {
  allOf: Trigger[];
}

export interface AnyOf {
  anyOf: Trigger[];
}

/** Декларативное условие над stats: лист-условие или составное allOf/anyOf. */
export type Trigger = Condition | AllOf | AnyOf;

export type AchievementType = 'milestone' | 'challenge';

export interface Achievement {
  id: string;
  type: AchievementType;
  title: string;
  description: string;
  trigger: Trigger;
  /** Случайный купон из тира (основной путь). */
  rewardTier?: Tier;
  /** Либо фиксированная награда по id. */
  rewardId?: string;
  /** Личное слово на раскрытии (приоритетнее note у самой награды). */
  note?: string;
  /** Кулдаун для challenge (в днях). */
  cooldownDays?: number;
}

export interface AchievementLimits {
  /** Анти-грайнд: максимум купонов-от-challenge в сутки (DESIGN §5). */
  maxChallengeCouponsPerDay: number;
}

export interface AchievementsConfig {
  limits: AchievementLimits;
  achievements: Achievement[];
}

export function isCondition(t: Trigger): t is Condition {
  return 'stat' in t;
}

export function isAllOf(t: Trigger): t is AllOf {
  return 'allOf' in t;
}

export function isAnyOf(t: Trigger): t is AnyOf {
  return 'anyOf' in t;
}
