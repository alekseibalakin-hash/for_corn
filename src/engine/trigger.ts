import { isAllOf, isAnyOf, isCondition, type Operator, type Trigger } from '../content/types';
import type { StatSnapshot } from './types';

export function compare(actual: number, op: Operator, expected: number): boolean {
  switch (op) {
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '==':
      return actual === expected;
  }
}

/**
 * Рекурсивно вычисляет декларативный trigger над snapshot.
 * Неизвестный stat трактуем как «не выполнено» (false), не как 0 — чтобы опечатка
 * в конфиге не выдавала купоны случайно.
 */
export function evalTrigger(trigger: Trigger, snapshot: StatSnapshot): boolean {
  if (isAllOf(trigger)) return trigger.allOf.every((t) => evalTrigger(t, snapshot));
  if (isAnyOf(trigger)) return trigger.anyOf.some((t) => evalTrigger(t, snapshot));
  if (isCondition(trigger)) {
    const actual = snapshot[trigger.stat];
    if (actual === undefined) return false;
    return compare(actual, trigger.op, trigger.value);
  }
  return false;
}
