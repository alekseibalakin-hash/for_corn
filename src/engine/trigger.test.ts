import { describe, expect, it } from 'vitest';
import type { Trigger } from '../content/types';
import { compare, evalTrigger } from './trigger';

describe('compare', () => {
  it('покрывает все операторы', () => {
    expect(compare(5, '>=', 5)).toBe(true);
    expect(compare(4, '>=', 5)).toBe(false);
    expect(compare(5, '<=', 5)).toBe(true);
    expect(compare(6, '<=', 5)).toBe(false);
    expect(compare(6, '>', 5)).toBe(true);
    expect(compare(5, '>', 5)).toBe(false);
    expect(compare(4, '<', 5)).toBe(true);
    expect(compare(5, '<', 5)).toBe(false);
    expect(compare(5, '==', 5)).toBe(true);
    expect(compare(5, '==', 6)).toBe(false);
  });
});

describe('evalTrigger', () => {
  const snap = { maxTileThisGame: 256, timeToCurrentMaxTileSec: 90, sessionScore: 3000 };

  it('лист-условие', () => {
    expect(evalTrigger({ stat: 'maxTileThisGame', op: '>=', value: 256 }, snap)).toBe(true);
    expect(evalTrigger({ stat: 'maxTileThisGame', op: '>=', value: 512 }, snap)).toBe(false);
  });

  it('allOf — все должны выполниться (как fast-256)', () => {
    const t: Trigger = {
      allOf: [
        { stat: 'maxTileThisGame', op: '>=', value: 256 },
        { stat: 'timeToCurrentMaxTileSec', op: '<=', value: 120 },
      ],
    };
    expect(evalTrigger(t, snap)).toBe(true);
    expect(evalTrigger(t, { ...snap, timeToCurrentMaxTileSec: 200 })).toBe(false);
  });

  it('anyOf — хотя бы одно', () => {
    const t: Trigger = {
      anyOf: [
        { stat: 'maxTileThisGame', op: '>=', value: 99999 },
        { stat: 'sessionScore', op: '>=', value: 3000 },
      ],
    };
    expect(evalTrigger(t, snap)).toBe(true);
  });

  it('вложенные составные', () => {
    const t: Trigger = {
      allOf: [
        { stat: 'maxTileThisGame', op: '>=', value: 128 },
        { anyOf: [{ stat: 'sessionScore', op: '>=', value: 99999 }, { stat: 'timeToCurrentMaxTileSec', op: '<', value: 100 }] },
      ],
    };
    expect(evalTrigger(t, snap)).toBe(true);
  });

  it('неизвестный stat → false (опечатка в конфиге не выдаёт купон)', () => {
    expect(evalTrigger({ stat: 'nope', op: '>=', value: 0 }, snap)).toBe(false);
  });
});
