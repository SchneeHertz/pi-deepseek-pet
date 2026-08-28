export type RandomSource = () => number;

const unitRandom = (rng: RandomSource): number => Math.min(1 - Number.EPSILON, Math.max(0, rng()));

export function pick<T>(pool: readonly T[], rng: RandomSource = Math.random, exclude?: T): T {
  if (pool.length === 0) throw new Error('Cannot pick from an empty pool');
  const eligible = exclude === undefined ? pool : pool.filter((entry) => entry !== exclude);
  const source = eligible.length > 0 ? eligible : pool;
  return source[Math.floor(unitRandom(rng) * source.length)]!;
}

export function randomBetween(min: number, max: number, rng: RandomSource = Math.random): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error('Invalid random range');
  if (max === min) return min;
  return min + unitRandom(rng) * (max - min);
}

export interface WeightedEntry {
  weight: number;
}

export function pickWeighted<T extends WeightedEntry>(
  entries: readonly T[],
  rng: RandomSource = Math.random,
): T | null {
  const eligible = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  if (eligible.length === 0) return null;
  const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = unitRandom(rng) * total;
  for (const entry of eligible) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry;
  }
  return eligible.at(-1) ?? null;
}

export type AmbientRollKind = 'idle' | 'turn' | 'move' | 'category';

export function rollAmbientKind(roll: number, weights: { idle: number; turn: number; move: number }): AmbientRollKind {
  const value = Math.min(1 - Number.EPSILON, Math.max(0, roll));
  if (value < weights.idle / 100) return 'idle';
  if (value < (weights.idle + weights.turn) / 100) return 'turn';
  if (value < (weights.idle + weights.turn + weights.move) / 100) return 'move';
  return 'category';
}
