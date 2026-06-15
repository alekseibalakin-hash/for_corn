import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { celebrate } from '../confetti';
import type { RedeemCelebration as RedeemInfo } from '../uiTypes';

// Праздничный экран использования купона — его она показывает мужу (DESIGN §6, шаг 5).
export function RedeemCelebration({ info, onClose }: { info: RedeemInfo | null; onClose: () => void }) {
  useEffect(() => {
    if (info) celebrate();
  }, [info]);

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/30 p-6 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.7, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-card bg-cream p-6 text-center shadow-lift"
          >
            <div className="text-xs font-bold uppercase tracking-widest text-primary">Покажи мужу 💌</div>
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 220, damping: 12 }}
              className="mt-2 text-7xl"
            >
              {info.emoji}
            </motion.div>
            <h2 className="mt-3 text-2xl font-extrabold text-ink">{info.rewardTitle}</h2>
            <p className="mt-1.5 text-sm font-semibold text-muted">{info.rewardText}</p>
            {info.note && (
              <p className="mt-4 rounded-card bg-primary/10 px-4 py-3 text-sm font-semibold italic text-ink">
                {info.note}
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-card bg-primary py-3 font-bold text-white shadow-soft active:scale-95 transition"
            >
              Готово ✨
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
