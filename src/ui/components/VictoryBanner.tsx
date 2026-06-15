import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { celebrate } from '../confetti';

// Победный баннер (DESIGN §15): когда ВСЕ задания из конфига пройдены (использованы).
// Один раз; если позже добавят задания — станет снова актуальным (см. victorySeenForCount).
export function VictoryBanner({ show, onClose }: { show: boolean; onClose: () => void }) {
  useEffect(() => {
    if (show) celebrate();
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[55] flex items-center justify-center bg-primary/30 p-6 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.7, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-card bg-cream p-7 text-center shadow-lift"
          >
            <div className="text-7xl">🎉</div>
            <h2 className="mt-4 text-2xl font-extrabold leading-snug text-ink">Ты прошла всё! 🎉🌽</h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-muted">
              Если тебе понравилось — попроси мужа выпустить обновление 😉❤️
            </p>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-card bg-primary py-3.5 text-lg font-bold text-white shadow-soft active:scale-95 transition"
            >
              Ура ❤️
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
