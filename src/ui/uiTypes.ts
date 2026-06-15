import type { Presentation } from '../engine';
import type { Tier } from '../content';

/** Готовая к показу карточка раскрытия (DESIGN §6). */
export interface Reveal {
  key: string;
  couponId: string;
  tier: Tier;
  emoji: string;
  achievementTitle: string;
  rewardTitle: string;
  rewardText: string;
  note?: string;
  presentation: Presentation;
}

/** Праздничный экран использования купона (его она показывает мужу). */
export interface RedeemCelebration {
  tier: Tier;
  emoji: string;
  rewardTitle: string;
  rewardText: string;
  note?: string;
}
