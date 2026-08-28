import { randomUUID } from 'node:crypto';
import {
  SourceStateSchema,
  TransientEventSchema,
  type ModelMetadata,
  type PersistentPhase,
  type SourceMetadata,
  type SourceState,
  type TransientEvent,
  type TransientEventType,
} from '@pi-deepseek-pet/protocol';

export type PiStopReason = 'pending' | 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'deferred';

export interface StatusSink {
  publishState(state: SourceState): void;
  publishEvent(event: TransientEvent): void;
}

export interface MapperClock {
  now(): Date;
}

const WAITING_TOOL_NAMES = new Set(['ask', 'question', 'ask_question', 'user_input', 'confirm']);
const replaceControlCharacters = (value: string): string =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    })
    .join('');
const safeDisplayText = (value: string, max: number): string =>
  replaceControlCharacters(value).replace(/[\\/]/gu, '-').trim().slice(0, max) || 'unknown';

export class PiStatusMapper {
  readonly #sink: StatusSink;
  readonly #clock: MapperClock;
  readonly #eventId: () => string;
  readonly #activeTools = new Map<string, string>();
  #source: SourceMetadata;
  #model?: ModelMetadata;
  #phase: PersistentPhase = 'idle';
  #phaseBeforeCompaction: PersistentPhase = 'idle';
  #agentActive = false;
  #lastStopReason: PiStopReason = 'stop';
  #sequence = 0;

  constructor(options: {
    sink: StatusSink;
    source: SourceMetadata;
    model?: ModelMetadata;
    clock?: MapperClock;
    eventId?: () => string;
  }) {
    this.#sink = options.sink;
    this.#source = options.source;
    this.#model = options.model;
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#eventId = options.eventId ?? randomUUID;
  }

  get phase(): PersistentPhase {
    return this.#phase;
  }

  get sequence(): number {
    return this.#sequence;
  }

  start(): void {
    this.#agentActive = false;
    this.#activeTools.clear();
    this.#phase = 'idle';
    this.#emitState();
  }

  resend(): void {
    this.#emitState();
  }

  setSessionName(name: string | undefined): void {
    this.#source = { ...this.#source, sessionName: name ? safeDisplayText(name, 100) : undefined };
    this.#emitState();
  }

  setModel(provider: string, id: string, thinkingLevel?: ModelMetadata['thinkingLevel']): void {
    this.#model = {
      provider: safeDisplayText(provider, 64),
      id: replaceControlCharacters(id).trim().slice(0, 128) || 'unknown',
      thinkingLevel,
    };
    this.#emitState();
  }

  setThinkingLevel(thinkingLevel: ModelMetadata['thinkingLevel']): void {
    if (this.#model) this.#model = { ...this.#model, thinkingLevel };
    this.#emitState();
  }

  agentStart(): void {
    this.#agentActive = true;
    this.#lastStopReason = 'pending';
    this.#setPhase('thinking');
  }

  messageUpdate(type: string): void {
    if (type === 'thinking_start' || type === 'thinking_delta') this.#setPhase('thinking');
    if (type === 'text_start' || type === 'text_delta') this.#setPhase('responding');
  }

  toolStart(toolCallId: string, toolName: string): void {
    this.#activeTools.set(toolCallId, safeDisplayText(toolName, 64));
    const nextPhase = this.#toolPhase();
    if (nextPhase === this.#phase) this.#emitState();
    else this.#setPhase(nextPhase);
  }

  toolEnd(toolCallId: string, toolName: string, isError: boolean): void {
    this.#activeTools.delete(toolCallId);
    if (isError) this.emitEvent('tool_failed', { toolName: safeDisplayText(toolName, 64) });
    const nextPhase = this.#activeTools.size > 0 ? this.#toolPhase() : this.#agentActive ? 'thinking' : 'idle';
    if (nextPhase === this.#phase) this.#emitState();
    else this.#setPhase(nextPhase);
  }

  beforeCompact(): void {
    this.#phaseBeforeCompaction = this.#phase;
    this.#setPhase('compacting');
  }

  compacted(): void {
    if (this.#activeTools.size > 0) this.#setPhase(this.#toolPhase());
    else this.#setPhase(this.#agentActive ? 'thinking' : 'idle');
  }

  compactFailed(aborted: boolean): void {
    this.emitEvent(aborted ? 'attention' : 'failed', { code: aborted ? 'compact_aborted' : 'compact_failed' });
    this.#setPhase(this.#phaseBeforeCompaction);
  }

  agentEnd(stopReason: PiStopReason | undefined): void {
    if (stopReason) this.#lastStopReason = stopReason;
  }

  agentSettled(): void {
    this.#agentActive = false;
    this.#activeTools.clear();
    const event = this.#settledEvent(this.#lastStopReason);
    this.emitEvent(event);
    this.#setPhase('idle');
  }

  emitEvent(type: TransientEventType, metadata?: TransientEvent['metadata']): void {
    this.#sink.publishEvent(
      TransientEventSchema.parse({
        protocolVersion: 1,
        eventId: this.#eventId(),
        sequence: ++this.#sequence,
        occurredAt: this.#clock.now().toISOString(),
        type,
        metadata,
      }),
    );
  }

  #setPhase(phase: PersistentPhase): void {
    if (phase === this.#phase) return;
    this.#phase = phase;
    this.#emitState();
  }

  #emitState(): void {
    const activeToolNames = [...this.#activeTools.values()];
    const activity = activeToolNames.length
      ? { toolName: activeToolNames.at(-1), activeToolCount: activeToolNames.length }
      : undefined;
    this.#sink.publishState(
      SourceStateSchema.parse({
        protocolVersion: 1,
        sequence: ++this.#sequence,
        sentAt: this.#clock.now().toISOString(),
        phase: this.#phase,
        source: this.#source,
        model: this.#model,
        activity,
      }),
    );
  }

  #toolPhase(): PersistentPhase {
    return [...this.#activeTools.values()].some((name) => WAITING_TOOL_NAMES.has(name.toLowerCase()))
      ? 'waiting'
      : 'tool';
  }

  #settledEvent(reason: PiStopReason): TransientEventType {
    switch (reason) {
      case 'length':
        return 'truncated';
      case 'error':
      case 'pending':
        return 'failed';
      case 'aborted':
        return 'cancelled';
      case 'deferred':
        return 'attention';
      case 'stop':
      case 'toolUse':
        return 'completed';
    }
  }
}

export function createSafeSource(projectName: string, sessionName?: string): SourceMetadata {
  return {
    kind: 'pi',
    label: 'Pi',
    projectName: safeDisplayText(projectName, 100),
    sessionName: sessionName ? safeDisplayText(sessionName, 100) : undefined,
  };
}
