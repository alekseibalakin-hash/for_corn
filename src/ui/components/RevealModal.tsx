import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { celebrate } from '../confetti';
import type { Reveal } from '../uiTypes';

// Раскрытие награды (DESIGN §15): КАЖДУЮ награду надо «Забрать» — без авто-дисмисса и
// без закрытия тапом мимо, чтобы ни одна не потерялась. Несколько за раз — очередью.
// Сочность зависит от тира: 🌸 простая карточка · 💝 побогаче · 💎 полный экран + конфетти.
export function RevealModal({ reveal, onCollect }: { reveal: Reveal | null; onCollect: () => void }) {
  const isLarge = reveal?.tier === 'large';
  const isMedium = reveal?.tier === 'medium';

  useEffect(() => {
    if (reveal && isLarge) celebrate();
  }, [reveal, isLarge]);

  return (
    <AnimatePresence mode="wait">
      {reveal && (
        <motion.div
          key={reveal.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Тап мимо НЕ закрывает — забрать можно только кнопкой.
          className={`fixed inset-0 z-50 flex items-center justify-center p-6 ${
            isLarge ? 'bg-primary/30 backdrop-blur-md' : 'bg-ink/30 backdrop-blur-sm'
          }`}
        >
          <motion.div
            initial={{ scale: 0.7, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className={`w-full rounded-card bg-cream text-center shadow-lift ${
              isLarge
                ? 'max-w-sm p-7 ring-2 ring-primary/40'
                : isMedium
                  ? 'max-w-xs p-6 ring-1 ring-primary/25'
                  : 'max-w-[17rem] p-5'
            }`}
          >
            <motion.div
              initial={{ scale: 0.5, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 220, damping: 12 }}
              className={isLarge ? 'text-7xl' : isMedium ? 'text-6xl' : 'text-5xl'}
            >
              {reveal.emoji}
            </motion.div>

            <div className="mt-3 text-xs font-bold uppercase tracking-widest text-primary">
              {reveal.achievementTitle}
            </div>
            <h2 className={`mt-1 font-extrabold text-ink ${isLarge ? 'text-2xl' : 'text-xl'}`}>{reveal.rewardTitle}</h2>
            <p className="mt-1.5 text-sm font-semibold text-muted">{reveal.rewardText}</p>

            {reveal.note && (
              <p className="mt-4 rounded-card bg-primary/10 px-4 py-3 text-sm font-semibold italic text-ink">
                {reveal.note}
              </p>
            )}

            <button
              onClick={onCollect}
              className="mt-5 w-full rounded-card bg-primary py-3 font-bold text-white shadow-soft active:scale-95 transition"
            >
              Забрать ❤️
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
