import { describe, expect, it } from 'vitest';
import { clampWindowBounds, normalizePosition, planHorizontalMove, restorePosition } from './motion.js';

describe('window movement geometry', () => {
  const workArea = { x: 100, y: 50, width: 1_000, height: 700 };

  it('clamps windows back into a visible work area', () => {
    expect(clampWindowBounds({ x: 2_000, y: -100, width: 400, height: 225 }, workArea)).toEqual({
      x: 1_068,
      y: 50,
      width: 400,
      height: 225,
    });
  });

  it('round-trips normalized display positions', () => {
    const bounds = { x: 400, y: 250, width: 400, height: 225 };
    const normalized = normalizePosition(bounds, workArea);
    expect(restorePosition(normalized, bounds, workArea)).toEqual(bounds);
  });

  it('scales movement distance and refuses out-of-bounds plans', () => {
    const bounds = { x: 300, y: 200, width: 400, height: 225 };
    expect(
      planHorizontalMove({
        bounds,
        workArea,
        direction: 1,
        minDistance: 100,
        maxDistance: 100,
        margin: 20,
        scale: 0.5,
        rng: () => 0,
      }),
    ).toMatchObject({ targetX: 350, distance: 50 });
    expect(
      planHorizontalMove({
        bounds: { ...bounds, x: 680 },
        workArea,
        direction: 1,
        minDistance: 100,
        maxDistance: 100,
        margin: 20,
        rng: () => 0,
      }),
    ).toBeNull();
  });
});
