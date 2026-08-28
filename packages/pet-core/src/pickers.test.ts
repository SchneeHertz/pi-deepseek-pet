import { describe, expect, it } from 'vitest';
import { pick, pickWeighted, rollAmbientKind } from './pickers.js';

describe('pickers', () => {
  it('uses injected randomness and excludes the current action', () => {
    expect(pick(['a', 'b', 'c'], () => 0, 'a')).toBe('b');
    expect(pick(['a'], () => 0.9, 'a')).toBe('a');
  });

  it('selects weighted entries deterministically', () => {
    const entries = [
      { id: 'first', weight: 1 },
      { id: 'second', weight: 3 },
    ];
    expect(pickWeighted(entries, () => 0)?.id).toBe('first');
    expect(pickWeighted(entries, () => 0.99)?.id).toBe('second');
  });

  it('maps ambient roll boundaries', () => {
    const weights = { idle: 10, turn: 5, move: 5 };
    expect(rollAmbientKind(0.09, weights)).toBe('idle');
    expect(rollAmbientKind(0.12, weights)).toBe('turn');
    expect(rollAmbientKind(0.18, weights)).toBe('move');
    expect(rollAmbientKind(0.5, weights)).toBe('category');
  });
});
