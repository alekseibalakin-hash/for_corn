import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';

interface GameOverProps {
  show: boolean;
  score: number;
  onNewGame: () => void;
}

// Тёплый game-over (DESIGN §1): не «Game Over», а «Ничего, ещё разок? ❤️».
export function GameOver({ show, score, onNewGame }: GameOverProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-card bg-cream/85 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.85, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="flex flex-col items-center gap-2 px-6 text-center"
          >
            <div className="text-4xl">🌷</div>
            <div className="text-xl font-extrabold text-ink">Ничего, ещё разок? ❤️</div>
            <div className="text-sm font-semibold text-muted">Ты набрала {score} очков</div>
            <button
              onClick={onNewGame}
              className="mt-2 flex items-center gap-2 rounded-card bg-primary px-5 py-2.5 font-bold text-white shadow-lift active:scale-95 transition"
            >
              <RotateCcw className="h-5 w-5" />
              Сыграть ещё
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
