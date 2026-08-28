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

export function clampWindowBounds(bounds: Rectangle, workArea: Rectangle, visiblePixels = 32): Rectangle {
  const minX = workArea.x - Math.max(0, bounds.width - visiblePixels);
  const maxX = workArea.x + workArea.width - Math.min(visiblePixels, bounds.width);
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - Math.min(visiblePixels, bounds.height);
  return {
    ...bounds,
    x: Math.round(Math.min(maxX, Math.max(minX, bounds.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, bounds.y))),
  };
}

export function normalizePosition(bounds: Rectangle, workArea: Rectangle): NormalizedPosition {
  const spanX = Math.max(1, workArea.width - bounds.width);
  const spanY = Math.max(1, workArea.height - bounds.height);
  return {
    xRatio: Math.min(1, Math.max(0, (bounds.x - workArea.x) / spanX)),
    yRatio: Math.min(1, Math.max(0, (bounds.y - workArea.y) / spanY)),
  };
}

export function restorePosition(
  position: NormalizedPosition,
  windowSize: Pick<Rectangle, 'width' | 'height'>,
  workArea: Rectangle,
): Rectangle {
  const spanX = Math.max(0, workArea.width - windowSize.width);
  const spanY = Math.max(0, workArea.height - windowSize.height);
  return clampWindowBounds(
    {
      x: workArea.x + spanX * Math.min(1, Math.max(0, position.xRatio)),
      y: workArea.y + spanY * Math.min(1, Math.max(0, position.yRatio)),
      ...windowSize,
    },
    workArea,
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
