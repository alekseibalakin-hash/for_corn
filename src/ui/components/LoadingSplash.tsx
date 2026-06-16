import { motion } from 'framer-motion';

// Тёплая заставка загрузки — общая для хаба, ленивого чанка игры и резюма партии.
export function LoadingSplash() {
  return (
    <div className="flex h-full items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.15, 1] }}
        transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
        className="text-5xl"
      >
        ❤️
      </motion.div>
    </div>
  );
}
