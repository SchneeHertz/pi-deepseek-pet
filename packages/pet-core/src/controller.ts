import type { TransientEventType, VisualPhase } from '@pi-deepseek-pet/protocol';
import type { AnimationManifest, MoveParams } from './manifest.js';
import { pick, pickWeighted, rollAmbientKind, type AmbientRollKind, type RandomSource } from './pickers.js';

export type Facing = 'left' | 'right';
export type PlaybackKind = 'ambient' | 'state' | 'event' | 'click' | 'manual' | 'drag' | 'buffer';

export interface PlaybackInstruction {
  animation: string;
  generation: number;
  kind: PlaybackKind;
  once: true;
  startedAt: number;
  phase?: VisualPhase;
  event?: TransientEventType;
  move?: MoveParams;
  turnAfter?: boolean;
}

export interface PetControllerSnapshot {
  playback: PlaybackInstruction;
  persistentPhase: VisualPhase;
  facing: Facing;
  dragging: boolean;
  pendingEventCount: number;
  ambientActions: boolean;
}

export interface Clock {
  now(): number;
}

export interface PetControllerOptions {
  rng?: RandomSource;
  clock?: Clock;
  availableAnimations?: Iterable<string>;
  initialPhase?: VisualPhase;
  ambientActions?: boolean;
  onDiagnostic?: (message: string) => void;
}

const PRIORITY: Record<PlaybackKind, number> = {
  ambient: 10,
  state: 20,
  buffer: 25,
  event: 30,
  click: 40,
  manual: 50,
  drag: 60,
};

const systemClock: Clock = { now: () => Date.now() };

export class PetController {
  readonly #manifest: AnimationManifest;
  readonly #rng: RandomSource;
  readonly #clock: Clock;
  readonly #onDiagnostic: (message: string) => void;
  readonly #available: Set<string>;
  readonly #noMirrorAssets: Set<string>;
  #persistentPhase: VisualPhase;
  #facing: Facing = 'left';
  #dragging = false;
  #ambientActions: boolean;
  #generation = 0;
  #pendingEvents: TransientEventType[] = [];
  #playback: PlaybackInstruction;
  #ambientKind?: AmbientRollKind;
  #idleBreakPending = false;

  constructor(manifest: AnimationManifest, options: PetControllerOptions = {}) {
    this.#manifest = manifest;
    this.#rng = options.rng ?? Math.random;
    this.#clock = options.clock ?? systemClock;
    this.#onDiagnostic = options.onDiagnostic ?? (() => undefined);
    this.#available = new Set(options.availableAnimations ?? manifest.assets);
    this.#noMirrorAssets = new Set([
      ...manifest.noMirror,
      ...manifest.categories.filter((category) => category.noMirror).flatMap((category) => category.actions),
    ]);
    this.#persistentPhase = options.initialPhase ?? 'offline';
    this.#ambientActions = options.ambientActions ?? true;
    const initial = this.#pickFromPool(manifest.phasePools[this.#persistentPhase]);
    this.#playback = this.#makePlayback('state', initial, { phase: this.#persistentPhase });
  }

  get snapshot(): PetControllerSnapshot {
    return {
      playback: this.#playback,
      persistentPhase: this.#persistentPhase,
      facing: this.#facing,
      dragging: this.#dragging,
      pendingEventCount: this.#pendingEvents.length,
      ambientActions: this.#ambientActions,
    };
  }

  setPersistentPhase(phase: VisualPhase): PetControllerSnapshot {
    const changed = phase !== this.#persistentPhase;
    this.#persistentPhase = phase;
    if (changed && PRIORITY[this.#playback.kind] <= PRIORITY.state) this.#resumePersistent();
    return this.snapshot;
  }

  setAmbientActions(enabled: boolean): PetControllerSnapshot {
    this.#ambientActions = enabled;
    if (!enabled && this.#playback.kind === 'ambient') this.#resumePersistent();
    return this.snapshot;
  }

  triggerEvent(event: TransientEventType): PetControllerSnapshot {
    if (this.#playback.kind === 'event' || PRIORITY[this.#playback.kind] > PRIORITY.event) {
      this.#enqueueEvent(event);
      return this.snapshot;
    }
    this.#startEvent(event);
    return this.snapshot;
  }

  click(): PetControllerSnapshot {
    if (this.#dragging || PRIORITY[this.#playback.kind] > PRIORITY.click) return this.snapshot;
    this.#preserveInterruptedEvent();
    this.#setPlayback('click', this.#pickFromPool(this.#manifest.clicks));
    return this.snapshot;
  }

  playManual(animation: string): boolean {
    if (this.#dragging || !this.#available.has(animation) || !this.#manifest.assets.includes(animation)) return false;
    this.#preserveInterruptedEvent();
    this.#setPlayback('manual', animation);
    return true;
  }

  beginDrag(): PetControllerSnapshot {
    if (this.#dragging) return this.snapshot;
    this.#preserveInterruptedEvent();
    this.#dragging = true;
    this.#setPlayback('drag', this.#pickFromPool(this.#manifest.drag));
    return this.snapshot;
  }

  endDrag(): PetControllerSnapshot {
    if (!this.#dragging) return this.snapshot;
    this.#dragging = false;
    this.#setPlayback('buffer', this.#pickFromPool(this.#manifest.idle, this.#playback.animation));
    return this.snapshot;
  }

  animationEnded(generation: number): boolean {
    if (generation !== this.#playback.generation) return false;
    if (this.#playback.turnAfter) this.#facing = this.#facing === 'left' ? 'right' : 'left';

    if (this.#playback.kind === 'drag' && this.#dragging) {
      this.#setPlayback('drag', this.#pickFromPool(this.#manifest.drag, this.#playback.animation));
      return true;
    }

    if (
      this.#playback.kind === 'state' &&
      this.#playback.phase === this.#persistentPhase &&
      !this.#shouldRunAmbient()
    ) {
      this.#setPlayback(
        'state',
        this.#pickFromPool(this.#manifest.phasePools[this.#persistentPhase], this.#playback.animation),
        { phase: this.#persistentPhase },
      );
      return true;
    }

    if (this.#playback.kind === 'ambient' && this.#shouldRunAmbient()) {
      if (this.#ambientKind === 'category') this.#idleBreakPending = true;
      this.#startAmbient();
      return true;
    }

    this.#resumeAfterOneShot();
    return true;
  }

  animationFailed(generation: number, reason = 'resource failed to load'): boolean {
    if (generation !== this.#playback.generation) return false;
    const failed = this.#playback.animation;
    this.#available.delete(failed);
    this.#onDiagnostic(`${reason}: ${failed}; falling back to an available idle animation`);
    this.#resumeAfterOneShot();
    return true;
  }

  #resumeAfterOneShot(): void {
    const event = this.#pendingEvents.shift();
    if (event) {
      this.#startEvent(event);
      return;
    }
    this.#resumePersistent();
  }

  #resumePersistent(): void {
    if (this.#shouldRunAmbient()) {
      this.#startAmbient();
      return;
    }
    this.#setPlayback('state', this.#pickFromPool(this.#manifest.phasePools[this.#persistentPhase]), {
      phase: this.#persistentPhase,
    });
  }

  #shouldRunAmbient(): boolean {
    return this.#ambientActions && (this.#persistentPhase === 'idle' || this.#persistentPhase === 'offline');
  }

  #startEvent(event: TransientEventType): void {
    this.#setPlayback('event', this.#pickFromPool(this.#manifest.eventPools[event]), { event });
  }

  #startAmbient(): void {
    const phase = this.#persistentPhase;
    if (this.#idleBreakPending) {
      this.#idleBreakPending = false;
      this.#ambientKind = 'idle';
      this.#setPlayback('ambient', this.#pickFromPool(this.#manifest.idle, this.#playback.animation), { phase });
      return;
    }
    const previousWasIdle = this.#manifest.idle.includes(this.#playback.animation);
    const kind = rollAmbientKind(this.#rng(), this.#manifest.weights, previousWasIdle);
    this.#ambientKind = kind;
    if (kind === 'idle') {
      this.#setPlayback('ambient', this.#pickFromPool(this.#manifest.idle, this.#playback.animation), { phase });
      return;
    }
    if (kind === 'turn') {
      this.#setPlayback('ambient', this.#pickFromPool(this.#manifest.turn, this.#playback.animation), { phase });
      return;
    }
    if (kind === 'move') {
      const availableMoves = this.#manifest.moves.actions.filter(
        (move) => this.#available.has(move.name) && !this.#isMirrored(move.name),
      );
      if (availableMoves.length > 0) {
        const selected = pick(availableMoves, this.#rng);
        this.#setPlayback('ambient', selected.name, {
          phase,
          move: { ...this.#manifest.moves.default, ...selected.params },
        });
        return;
      }
    }

    const categories = this.#manifest.categories.filter(
      (category) =>
        category.actions.some((animation) => this.#available.has(animation) && !this.#isMirrored(animation)) &&
        !(category.noMirror && this.#facing === 'right'),
    );
    const category = pickWeighted(categories, this.#rng);
    if (category) {
      this.#setPlayback('ambient', this.#pickFromPool(category.actions, this.#playback.animation), { phase });
      return;
    }
    this.#setPlayback('ambient', this.#pickFromPool(this.#manifest.idle, this.#playback.animation), { phase });
  }

  #pickFromPool(pool: readonly string[], exclude?: string): string {
    const available = pool.filter((animation) => this.#available.has(animation) && !this.#isMirrored(animation));
    if (available.length > 0) return pick(available, this.#rng, exclude);
    const idle = this.#manifest.idle.filter(
      (animation) => this.#available.has(animation) && !this.#isMirrored(animation),
    );
    if (idle.length > 0) return pick(idle, this.#rng, exclude);
    const any = this.#manifest.assets.find(
      (animation) => this.#available.has(animation) && !this.#isMirrored(animation),
    );
    if (any) return any;
    throw new Error('Pi DeepSeek Pet has no available animation resources');
  }

  #isMirrored(animation: string): boolean {
    return this.#facing === 'right' && this.#noMirrorAssets.has(animation);
  }

  #setPlayback(
    kind: PlaybackKind,
    animation: string,
    metadata: Pick<PlaybackInstruction, 'phase' | 'event' | 'move'> = {},
  ): void {
    this.#playback = this.#makePlayback(kind, animation, metadata);
  }

  #makePlayback(
    kind: PlaybackKind,
    animation: string,
    metadata: Pick<PlaybackInstruction, 'phase' | 'event' | 'move'> = {},
  ): PlaybackInstruction {
    return {
      animation,
      generation: ++this.#generation,
      kind,
      once: true,
      startedAt: this.#clock.now(),
      turnAfter: this.#manifest.turn.includes(animation),
      ...metadata,
    };
  }

  #preserveInterruptedEvent(): void {
    if (this.#playback.kind === 'event' && this.#playback.event) this.#pendingEvents.unshift(this.#playback.event);
  }

  #enqueueEvent(event: TransientEventType): void {
    if (this.#pendingEvents.length >= 20) this.#pendingEvents.shift();
    this.#pendingEvents.push(event);
  }
}
