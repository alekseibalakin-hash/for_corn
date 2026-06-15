import { AnimatePresence, motion } from 'framer-motion';
import { PET_NAME } from '../constants';

// Онбординг при первом запуске (DESIGN §15): короткий текст с интригой, без спойлеров,
// показывается один раз. Порядок: онбординг → поле → первый ход → welcome.
export function Onboarding({ show, onStart }: { show: boolean; onStart: () => void }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-cream/95 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.85, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 20 }}
            className="w-full max-w-sm rounded-card bg-white/80 p-7 text-center shadow-lift"
          >
            <div className="text-6xl">🌽</div>
            <h1 className="mt-4 text-2xl font-extrabold leading-snug text-ink">
              Это не просто 2048, {PET_NAME} 🌽
            </h1>
            <p className="mt-3 text-base font-semibold leading-relaxed text-muted">
              Играй, набирай очки, бей рекорды — а за достижения тебя будут ждать настоящие сюрпризы.
              Какие? Узнаешь сама 😉
            </p>
            <button
              onClick={onStart}
              className="mt-6 w-full rounded-card bg-primary py-3.5 text-lg font-bold text-white shadow-soft active:scale-95 transition"
            >
              Поехали ❤️
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
