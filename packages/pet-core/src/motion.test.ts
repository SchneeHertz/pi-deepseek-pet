import { describe, expect, it } from 'vitest';
import {
  clampPetWindowBounds,
  normalizePetPosition,
  planHorizontalMove,
  restorePetPosition,
  type PetClampRegion,
} from './motion.js';

describe('pet-aware window movement geometry', () => {
  // 工作区 1000x700，任务栏高 60（物理屏幕 1000x760），画布 640x360，脚底线 feetY=330
  const region: PetClampRegion = {
    workArea: { x: 100, y: 50, width: 1_000, height: 700 },
    displayBounds: { x: 100, y: 50, width: 1_000, height: 760 },
    feetRatio: 330 / 360,
  };
  const size = { width: 400, height: 225 };

  it('clamps horizontally into the work area', () => {
    expect(clampPetWindowBounds({ x: 2_000, y: -100, ...size }, region)).toEqual({
      x: 700,
      y: 50,
      ...size,
    });
  });

  it('lets the feet line go below the work area down to the physical display bottom', () => {
    // 脚底线 = y + height * feetRatio = 604 + 206.25 ≈ 810 = 物理屏幕底边（工作区底边 750 以下 60px，即任务栏区域）
    expect(clampPetWindowBounds({ x: 500, y: 900, ...size }, region)).toEqual({
      x: 500,
      y: 604,
      ...size,
    });
    // 窗顶不低于工作区顶部
    expect(clampPetWindowBounds({ x: 500, y: -500, ...size }, region)).toEqual({ x: 500, y: 50, ...size });
  });

  it('round-trips normalized display positions including the taskbar band', () => {
    const bounds = { x: 400, y: 400, ...size };
    const normalized = normalizePetPosition(bounds, region);
    expect(restorePetPosition(normalized, bounds, region)).toEqual(bounds);
    // 最低点（脚底压到屏幕底边）归一化为 1，可完整往返
    const bottom = clampPetWindowBounds({ x: 400, y: 10_000, ...size }, region);
    expect(normalizePetPosition(bottom, region).yRatio).toBe(1);
    expect(restorePetPosition(normalizePetPosition(bottom, region), bounds, region)).toEqual(bottom);
  });

  it('scales movement distance and refuses out-of-bounds plans', () => {
    const bounds = { x: 300, y: 200, ...size };
    expect(
      planHorizontalMove({
        bounds,
        workArea: region.workArea,
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
        workArea: region.workArea,
        direction: 1,
        minDistance: 100,
        maxDistance: 100,
        margin: 20,
        rng: () => 0,
      }),
    ).toBeNull();
  });
});
