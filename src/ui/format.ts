import { rewardById, tierEmoji, type Tier } from '../content';
import { DAY_MS, localYMD, previousYMD, type Coupon } from '../engine';

/** Русская плюрализация: [одна, две-четыре, пять]. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const tail = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (tail > 1 && tail < 5) return forms[1];
  if (tail === 1) return forms[0];
  return forms[2];
}

export function joysWord(n: number): string {
  return pluralRu(n, ['радость', 'радости', 'радостей']);
}

export function daysWord(n: number): string {
  return pluralRu(n, ['день', 'дня', 'дней']);
}

export function rewardTitle(coupon: Pick<Coupon, 'rewardId'>): string {
  return rewardById(coupon.rewardId)?.title ?? 'Сюрприз';
}

export function rewardText(coupon: Pick<Coupon, 'rewardId'>): string {
  return rewardById(coupon.rewardId)?.text ?? '';
}

export function couponEmoji(coupon: Pick<Coupon, 'tier'>): string {
  return tierEmoji(coupon.tier);
}

export function emojiForTier(tier: Tier): string {
  return tierEmoji(tier);
}

/** Тёплая подпись срока годности (DESIGN §6). */
export function expiryLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'сгорел';

  const today = localYMD(now);
  const expDay = localYMD(expiresAt);
  if (expDay === today) return 'сгорает сегодня';
  if (previousYMD(expDay) === today) return 'сгорает завтра';

  const days = Math.max(2, Math.ceil(ms / DAY_MS));
  return `сгорает через ${days} ${daysWord(days)}`;
}

/** Сгорает ли в ближайшие сутки (для подсветки карточки). */
export function isExpiringSoon(expiresAt: number, now: number): boolean {
  const ms = expiresAt - now;
  return ms > 0 && ms <= DAY_MS;
}
