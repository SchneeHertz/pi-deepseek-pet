import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PetController } from './controller.js';
import { AnimationManifestSchema, compareManifestAssets, parseAnimationManifestText } from './manifest.js';

const manifest = parseAnimationManifestText(
  readFileSync(resolve(process.cwd(), 'assets/animation-manifest.jsonc'), 'utf8'),
);

describe('PetController', () => {
  it('honors interaction, event, state, and idle priorities', () => {
    const controller = new PetController(manifest, { rng: () => 0, initialPhase: 'idle' });
    controller.setPersistentPhase('thinking');
    expect(controller.snapshot.playback.kind).toBe('state');
    expect(controller.snapshot.playback.phase).toBe('thinking');

    controller.triggerEvent('completed');
    expect(controller.snapshot.playback.kind).toBe('event');
    controller.click();
    expect(controller.snapshot.playback.kind).toBe('click');
    controller.triggerEvent('failed');
    expect(controller.snapshot.pendingEventCount).toBe(2);

    const clickGeneration = controller.snapshot.playback.generation;
    controller.animationEnded(clickGeneration);
    expect(controller.snapshot.playback.kind).toBe('event');
    expect(controller.snapshot.playback.event).toBe('completed');
  });

  it('queues transient events instead of replacing an event already playing', () => {
    const controller = new PetController(manifest, { rng: () => 0, initialPhase: 'idle' });
    controller.triggerEvent('completed');
    const firstGeneration = controller.snapshot.playback.generation;
    controller.triggerEvent('failed');

    expect(controller.snapshot.playback.event).toBe('completed');
    expect(controller.snapshot.pendingEventCount).toBe(1);
    controller.animationEnded(firstGeneration);
    expect(controller.snapshot.playback.event).toBe('failed');
  });

  it('returns from transient events to the latest persistent phase', () => {
    const controller = new PetController(manifest, { rng: () => 0, initialPhase: 'thinking' });
    controller.triggerEvent('completed');
    controller.setPersistentPhase('tool');
    const generation = controller.snapshot.playback.generation;
    controller.animationEnded(generation);
    expect(controller.snapshot.playback.kind).toBe('state');
    expect(controller.snapshot.playback.phase).toBe('tool');
  });

  it('plays one idle buffer after drag and then restores the random chain', () => {
    const controller = new PetController(manifest, { rng: () => 0, initialPhase: 'idle' });
    controller.beginDrag();
    expect(controller.snapshot.playback.kind).toBe('drag');
    controller.endDrag();
    expect(controller.snapshot.playback.kind).toBe('buffer');
    const generation = controller.snapshot.playback.generation;
    controller.animationEnded(generation);
    expect(controller.snapshot.playback.kind).toBe('ambient');
    expect(controller.snapshot.playback.once).toBe(true);
  });

  it('ignores stale video callbacks using generations', () => {
    const controller = new PetController(manifest, { rng: () => 0 });
    const staleGeneration = controller.snapshot.playback.generation;
    controller.click();
    const currentGeneration = controller.snapshot.playback.generation;
    expect(controller.animationEnded(staleGeneration)).toBe(false);
    expect(controller.snapshot.playback.generation).toBe(currentGeneration);
  });

  it('filters noMirror categories while facing right', () => {
    const rolls = [0, 0.11, 0, 0.999, 0.999, 0];
    const controller = new PetController(manifest, {
      initialPhase: 'idle',
      rng: () => rolls.shift() ?? 0,
    });
    // First idle chain roll picks a turn; finishing it flips the pet to the right.
    const firstGeneration = controller.snapshot.playback.generation;
    controller.animationEnded(firstGeneration);
    const turnGeneration = controller.snapshot.playback.generation;
    controller.animationEnded(turnGeneration);
    expect(controller.snapshot.facing).toBe('right');
    expect(manifest.categories.find((category) => category.noMirror)?.actions).not.toContain(
      controller.snapshot.playback.animation,
    );
  });

  it('falls back when a runtime asset fails', () => {
    const diagnostics: string[] = [];
    const controller = new PetController(manifest, { onDiagnostic: (message) => diagnostics.push(message) });
    const failed = controller.snapshot.playback.animation;
    const generation = controller.snapshot.playback.generation;
    expect(controller.animationFailed(generation)).toBe(true);
    expect(controller.snapshot.playback.animation).not.toBe(failed);
    expect(diagnostics).toHaveLength(1);
  });
});

describe('animation manifest', () => {
  it('matches all packaged WebM assets', () => {
    const files = readFileSync(resolve(process.cwd(), 'assets/animation-manifest.jsonc'), 'utf8');
    expect(() => parseAnimationManifestText(files)).not.toThrow();
    expect(compareManifestAssets(manifest, manifest.assets)).toEqual({ missing: [], unexpected: [] });
  });

  it('rejects references to missing resources', () => {
    const broken = structuredClone(manifest);
    broken.phasePools.thinking = ['missing'];
    expect(AnimationManifestSchema.safeParse(broken).success).toBe(false);
  });
});
