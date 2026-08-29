import { randomBetween, type RandomSource } from './pickers.js';

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedPosition {
  xRatio: number;
  yRatio: number;
}

export interface PetClampRegion {
  /** 工作区（已扣除任务栏等系统区域）。桌宠只允许停留在工作区顶部以下。 */
  workArea: Rectangle;
  /** 物理屏幕边界（含任务栏区域）。桌宠的脚底线允许一路压到物理屏幕底边。 */
  displayBounds: Rectangle;
  /** 脚底线在窗口高度中的相对位置（画布 feetY / 画布高度，0~1，从窗口顶部算起）。 */
  feetRatio: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 窗口顶点的最低允许值：脚底线恰好压到物理屏幕底边时对应的窗顶位置。 */
function petYBottom(region: PetClampRegion, height: number): number {
  return region.displayBounds.y + region.displayBounds.height - height * region.feetRatio;
}

/**
 * 以脚底为锚点钳制桌宠窗口：横向完全留在工作区内；
 * 纵向允许窗口底部越过工作区下边界，使脚底线可以从工作区顶部一直压到
 * 物理屏幕底边——桌宠因此可以站上任务栏边框，甚至可以压进任务栏区域。
 */
export function clampPetWindowBounds(bounds: Rectangle, region: PetClampRegion): Rectangle {
  const { workArea } = region;
  const maxX = workArea.x + workArea.width - Math.min(bounds.width, workArea.width);
  const maxY = petYBottom(region, bounds.height);
  return {
    ...bounds,
    x: Math.round(Math.min(maxX, Math.max(workArea.x, bounds.x))),
    y: Math.round(Math.min(maxY, Math.max(workArea.y, bounds.y))),
  };
}

export function normalizePetPosition(bounds: Rectangle, region: PetClampRegion): NormalizedPosition {
  const { workArea } = region;
  const spanX = Math.max(1, workArea.width - bounds.width);
  const spanY = Math.max(1, petYBottom(region, bounds.height) - workArea.y);
  return {
    xRatio: clamp01((bounds.x - workArea.x) / spanX),
    yRatio: clamp01((bounds.y - workArea.y) / spanY),
  };
}

export function restorePetPosition(
  position: NormalizedPosition,
  windowSize: Pick<Rectangle, 'width' | 'height'>,
  region: PetClampRegion,
): Rectangle {
  const { workArea } = region;
  const spanX = Math.max(0, workArea.width - windowSize.width);
  const spanY = Math.max(0, petYBottom(region, windowSize.height) - workArea.y);
  return clampPetWindowBounds(
    {
      ...windowSize,
      x: workArea.x + spanX * clamp01(position.xRatio),
      y: workArea.y + spanY * clamp01(position.yRatio),
    },
    region,
  );
}

export interface HorizontalMovePlan {
  startX: number;
  targetX: number;
  distance: number;
  direction: 1 | -1;
}

export function planHorizontalMove(options: {
  bounds: Rectangle;
  workArea: Rectangle;
  direction: 1 | -1;
  minDistance: number;
  maxDistance: number;
  margin: number;
  scale?: number;
  rng?: RandomSource;
}): HorizontalMovePlan | null {
  const scale = options.scale ?? 1;
  const distance = randomBetween(options.minDistance * scale, options.maxDistance * scale, options.rng);
  const targetX = options.bounds.x + options.direction * distance;
  const minX = options.workArea.x + options.margin;
  const maxX = options.workArea.x + options.workArea.width - options.bounds.width - options.margin;
  if (targetX < minX || targetX > maxX) return null;
  return {
    startX: options.bounds.x,
    targetX,
    distance: Math.abs(targetX - options.bounds.x),
    direction: options.direction,
  };
}
