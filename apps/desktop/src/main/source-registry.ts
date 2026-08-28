import {
  SOURCE_OFFLINE_TTL_MS,
  SOURCE_REMOVE_TTL_MS,
  type PetSettings,
  type SourceState,
  type TransientEvent,
} from '@pi-deepseek-pet/protocol';
import type { DesktopPresentation } from '../shared.js';

interface SourceEntry {
  sourceId: string;
  state: SourceState;
  stateFingerprint: string;
  lastStateSequence: number;
  lastEventSequence: number;
  lastHeartbeatAt: number;
  busySince?: number;
}

export interface SourceDiagnostic {
  sourceId: string;
  phase: SourceState['phase'];
  sequence: number;
  lastHeartbeatAt: string;
  online: boolean;
  selected: boolean;
  projectName: string;
}

export type SequenceResult = { ok: true; duplicate: boolean } | { ok: false; currentSequence: number };

const isBusy = (phase: SourceState['phase']): boolean => phase !== 'idle';

export class SourceRegistry {
  readonly #sources = new Map<string, SourceEntry>();
  readonly #seenEvents = new Map<string, number>();
  readonly #onPresentation: (presentation: DesktopPresentation) => void;
  readonly #onEvent: (sourceId: string, event: TransientEvent, source: SourceState) => void;
  readonly #now: () => number;
  #pinnedSourceId: string | null;
  #selectedSourceId?: string;
  #lastSelectionAt = 0;
  #lastPresentation = '';

  constructor(options: {
    settings: Pick<PetSettings, 'pinnedSourceId'>;
    now?: () => number;
    onPresentation?: (presentation: DesktopPresentation) => void;
    onEvent?: (sourceId: string, event: TransientEvent, source: SourceState) => void;
  }) {
    this.#pinnedSourceId = options.settings.pinnedSourceId;
    this.#now = options.now ?? Date.now;
    this.#onPresentation = options.onPresentation ?? (() => undefined);
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  putState(sourceId: string, state: SourceState): SequenceResult {
    const now = this.#now();
    const existing = this.#sources.get(sourceId);
    const fingerprint = JSON.stringify(state);
    if (existing && state.sequence < existing.lastStateSequence) {
      return { ok: false, currentSequence: existing.lastStateSequence };
    }
    if (existing && state.sequence === existing.lastStateSequence) {
      if (existing.stateFingerprint !== fingerprint) {
        return { ok: false, currentSequence: existing.lastStateSequence };
      }
      existing.lastHeartbeatAt = now;
      this.#publish();
      return { ok: true, duplicate: true };
    }

    const becameBusy = isBusy(state.phase) && (!existing || !isBusy(existing.state.phase));
    const entry: SourceEntry = {
      sourceId,
      state,
      stateFingerprint: fingerprint,
      lastStateSequence: state.sequence,
      lastEventSequence: existing?.lastEventSequence ?? -1,
      lastHeartbeatAt: now,
      busySince: becameBusy ? now : isBusy(state.phase) ? (existing?.busySince ?? now) : undefined,
    };
    this.#sources.set(sourceId, entry);
    this.#chooseSource(now);
    this.#publish();
    return { ok: true, duplicate: false };
  }

  heartbeat(sourceId: string): boolean {
    const source = this.#sources.get(sourceId);
    if (!source) return false;
    source.lastHeartbeatAt = this.#now();
    this.#chooseSource(source.lastHeartbeatAt);
    this.#publish();
    return true;
  }

  postEvent(sourceId: string, event: TransientEvent): SequenceResult | undefined {
    const source = this.#sources.get(sourceId);
    if (!source) return undefined;
    const now = this.#now();
    this.#pruneEvents(now);
    if (this.#seenEvents.has(event.eventId)) return { ok: true, duplicate: true };
    if (event.sequence <= source.lastEventSequence) {
      return { ok: false, currentSequence: source.lastEventSequence };
    }
    source.lastEventSequence = event.sequence;
    source.lastHeartbeatAt = now;
    this.#seenEvents.set(event.eventId, now);

    const onlinePinned = this.#pinnedSourceId ? this.#sources.get(this.#pinnedSourceId) : undefined;
    if (onlinePinned && this.#isOnline(onlinePinned, now)) {
      this.#chooseSource(now, true);
    } else {
      this.#selectedSourceId = sourceId;
      this.#lastSelectionAt = now;
    }
    if (this.#selectedSourceId === sourceId) this.#onEvent(sourceId, event, source.state);
    this.#publish();
    return { ok: true, duplicate: false };
  }

  delete(sourceId: string): boolean {
    const deleted = this.#sources.delete(sourceId);
    if (this.#selectedSourceId === sourceId) this.#selectedSourceId = undefined;
    this.#chooseSource(this.#now(), true);
    this.#publish();
    return deleted;
  }

  setPinnedSource(sourceId: string | null): void {
    this.#pinnedSourceId = sourceId;
    this.#chooseSource(this.#now(), true);
    this.#publish();
  }

  sweep(): void {
    const now = this.#now();
    for (const [sourceId, source] of this.#sources) {
      if (now - source.lastHeartbeatAt >= SOURCE_REMOVE_TTL_MS) this.#sources.delete(sourceId);
    }
    this.#pruneEvents(now);
    this.#chooseSource(now, true);
    this.#publish();
  }

  get presentation(): DesktopPresentation {
    const now = this.#now();
    const online = [...this.#sources.values()].filter((source) => this.#isOnline(source, now));
    const selected = this.#selectedSourceId ? this.#sources.get(this.#selectedSourceId) : undefined;
    const selectedOnline = selected && this.#isOnline(selected, now) ? selected : undefined;
    const busyCount = online.filter((source) => isBusy(source.state.phase)).length;
    return {
      phase: selectedOnline?.state.phase ?? 'offline',
      selectedSourceId: selectedOnline?.sourceId,
      sourceLabel: selectedOnline?.state.source.label,
      projectName: selectedOnline?.state.source.projectName,
      toolName: selectedOnline?.state.activity?.toolName,
      otherBusyCount: Math.max(0, busyCount - (selectedOnline && isBusy(selectedOnline.state.phase) ? 1 : 0)),
      onlineSourceCount: online.length,
    };
  }

  diagnostics(): { selectedSourceId?: string; pinnedSourceId: string | null; sources: SourceDiagnostic[] } {
    const now = this.#now();
    return {
      selectedSourceId: this.presentation.selectedSourceId,
      pinnedSourceId: this.#pinnedSourceId,
      sources: [...this.#sources.values()].map((source) => ({
        sourceId: source.sourceId,
        phase: source.state.phase,
        sequence: Math.max(source.lastStateSequence, source.lastEventSequence),
        lastHeartbeatAt: new Date(source.lastHeartbeatAt).toISOString(),
        online: this.#isOnline(source, now),
        selected: source.sourceId === this.presentation.selectedSourceId,
        projectName: source.state.source.projectName,
      })),
    };
  }

  #isOnline(source: SourceEntry, now: number): boolean {
    return now - source.lastHeartbeatAt < SOURCE_OFFLINE_TTL_MS;
  }

  #chooseSource(now: number, force = false): void {
    const online = [...this.#sources.values()].filter((source) => this.#isOnline(source, now));
    const pinned = this.#pinnedSourceId ? online.find((source) => source.sourceId === this.#pinnedSourceId) : undefined;
    if (pinned) {
      this.#selectedSourceId = pinned.sourceId;
      return;
    }

    const busy = online
      .filter((source) => isBusy(source.state.phase))
      .sort((a, b) => (b.busySince ?? 0) - (a.busySince ?? 0));
    const current = this.#selectedSourceId
      ? online.find((source) => source.sourceId === this.#selectedSourceId)
      : undefined;
    const candidate = busy[0] ?? [...online].sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt)[0];
    if (!candidate) {
      this.#selectedSourceId = undefined;
      return;
    }
    if (!force && current && isBusy(current.state.phase) && now - this.#lastSelectionAt < 2_000) return;
    if (candidate.sourceId !== this.#selectedSourceId) this.#lastSelectionAt = now;
    this.#selectedSourceId = candidate.sourceId;
  }

  #publish(): void {
    const presentation = this.presentation;
    const serialized = JSON.stringify(presentation);
    if (serialized === this.#lastPresentation) return;
    this.#lastPresentation = serialized;
    this.#onPresentation(presentation);
  }

  #pruneEvents(now: number): void {
    for (const [eventId, seenAt] of this.#seenEvents) {
      if (now - seenAt > 5 * 60_000) this.#seenEvents.delete(eventId);
    }
  }
}
