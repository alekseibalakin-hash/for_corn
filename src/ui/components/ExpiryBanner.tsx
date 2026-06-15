import { AnimatePresence, motion } from 'framer-motion';
import { Clock, X } from 'lucide-react';
import type { Coupon } from '../../engine';
import { couponEmoji, expiryLabel, pluralRu, rewardTitle } from '../format';

interface ExpiryBannerProps {
  reminder: Coupon[];
  now: number;
  onDismiss: () => void;
}

export function ExpiryBanner({ reminder, now, onDismiss }: ExpiryBannerProps) {
  const show = reminder.length > 0;
  const first = reminder[0];
  const message =
    reminder.length === 1 && first
      ? `купон «${rewardTitle(first)}» ${expiryLabel(first.expiresAt, now)} ${couponEmoji(first)}`
      : `${reminder.length} ${pluralRu(reminder.length, ['купон', 'купона', 'купонов'])} скоро ${pluralRu(
          reminder.length,
          ['сгорит', 'сгорят', 'сгорят'],
        )} 💝`;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          className="flex items-center gap-2 rounded-card bg-primary/10 px-3 py-2 text-sm font-semibold text-ink"
        >
          <Clock className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{message}</span>
          <button onClick={onDismiss} aria-label="Скрыть" className="shrink-0 text-muted active:scale-90">
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
