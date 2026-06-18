/** Тип функции случайности: возвращает число в [0, 1). */
export type Rng = () => number;

/**
 * Детерминированный ГПСЧ mulberry32.
 * Одинаковый seed → одинаковая последовательность чисел на всех устройствах.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Детерминированный Fisher-Yates shuffle.
 * Возвращает новый массив — входной не мутируется.
 */
export function seededShuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
