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
  /**
   * К какой игре относится задание (ХАБ, DESIGN-HUB §3). Необязательное:
   * untagged трактуется движком как '2048' (нулевой churn к 25 существующим ачивкам).
   * `'any'` — кросс-игровое задание (засчитывается в любой игре). Будущий match3 → `'m3'`.
   */
  game?: string;
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
  /** @deprecated Заменён двухуровневым лимитом лёгких купонов (maxEasyPerGamePerDay/Total). Хранится для обратной совместимости. */
  maxChallengeCouponsPerDay: number;
  /** Анти-грайнд: лёгкие купоны (small/medium без rewardId) — потолок на игру в сутки. */
  maxEasyPerGamePerDay: number;
  /** Анти-грайнд: лёгкие купоны — потолок по всему хабу в сутки. */
  maxEasyPerDayTotal: number;
}

export interface AchievementsConfig {
  limits: AchievementLimits;
  achievements: Achievement[];
}

// --- Match-3 «с перчинкой»: кривая сложности (бриф match3-spicy §3) ---

/** Один бэнд сложности по диапазону уровней. Применяется к уровням `level <= maxLevel`. */
export interface SpicyBand {
  /** Верхняя граница уровня бэнда (последний бэнд — большой sentinel). */
  maxLevel: number;
  /** Сколько льдин минимум/максимум (цель clearIce = столько разморозить). */
  iceMin: number;
  iceMax: number;
  /** Сколько камней-разделителей минимум/максимум. */
  blocksMin: number;
  blocksMax: number;
  /** 0..1 — насколько лёд может кучковаться (выше → плотнее кластеры). */
  clusterChance: number;
  /** Generosity: бюджет ходов = ceil(свидетель × multiplier). Всегда > 1, по бэндам убывает. */
  budgetMultiplier: number;
  /** Аддитивный пол: movesBudget = max(worst + budgetFloor, ceil(worst × multiplier)). По умолчанию 4. */
  budgetFloor?: number;
  /** Абсолютный потолок: movesBudget ≤ target × budgetK. По умолчанию 8. Бьёт раздутый worst. */
  budgetK?: number;
}

export interface SpicyConfig {
  bands: SpicyBand[];
}

// --- «Блоки-фигуры»: кривая сложности (DESIGN-BLOCKS.md §3) ---

/** Один бэнд сложности «блоков-фигур» по диапазону уровней. */
export interface BlocksBand {
  maxLevel: number;
  /** Сколько особых блоков-целей минимум/максимум на старте. */
  blocksMin: number;
  blocksMax: number;
  /** 0..1 — насколько блоки могут кучковаться. */
  clusterChance: number;
  /** Generosity: setsBudget ≥ ceil(worst × multiplier). Всегда > 1, убывает. */
  budgetMultiplier: number;
  /** Аддитивный пол: setsBudget = max(worst + floor, ceil(worst × multiplier)). По умолчанию 3. */
  budgetFloor?: number;
  /** Абсолютный потолок: setsBudget ≤ target × budgetK. По умолчанию 6. */
  budgetK?: number;
}

export interface BlocksConfig {
  bands: BlocksBand[];
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
