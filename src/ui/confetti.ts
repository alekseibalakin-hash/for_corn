import confetti from 'canvas-confetti';

// Тёплая палитра конфетти под наши 💎-награды (DESIGN §9).
const WARM_COLORS = ['#D4537E', '#ED93B1', '#FAC775', '#F0997B', '#FBEAF0'];

/** Праздничный залп для крупных наград и использования купона. */
export function celebrate(): void {
  const base = { colors: WARM_COLORS, disableForReducedMotion: true };
  confetti({ ...base, particleCount: 90, spread: 70, origin: { y: 0.6 } });
  setTimeout(() => {
    confetti({ ...base, particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.65 } });
    confetti({ ...base, particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.65 } });
  }, 180);
}
