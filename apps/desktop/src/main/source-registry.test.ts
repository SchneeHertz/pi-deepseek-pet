import { describe, expect, it, vi } from 'vitest';
import type { SourceState, TransientEvent } from '@pi-deepseek-pet/protocol';
import { SourceRegistry } from './source-registry.js';

const state = (sequence: number, phase: SourceState['phase'], projectName = 'project'): SourceState => ({
  protocolVersion: 1,
  sequence,
  sentAt: '2026-01-01T00:00:00.000Z',
  phase,
  source: { kind: 'pi', label: 'Pi', projectName },
});

const event = (sequence: number, eventId = '194c3884-26fb-453f-a66c-a0209b5f0880'): TransientEvent => ({
  protocolVersion: 1,
  eventId,
  sequence,
  occurredAt: '2026-01-01T00:00:00.000Z',
  type: 'completed',
});

describe('SourceRegistry', () => {
  it('rejects old sequences and accepts exact retries idempotently', () => {
    const registry = new SourceRegistry({ settings: { pinnedSourceId: null } });
    expect(registry.putState('source-a', state(2, 'thinking'))).toEqual({ ok: true, duplicate: false });
    expect(registry.putState('source-a', state(2, 'thinking'))).toEqual({ ok: true, duplicate: true });
    expect(registry.putState('source-a', state(1, 'idle'))).toEqual({ ok: false, currentSequence: 2 });
    expect(registry.putState('source-a', state(2, 'idle'))).toEqual({ ok: false, currentSequence: 2 });
  });

  it('deduplicates transient events and keeps event sequences monotonic', () => {
    const onEvent = vi.fn();
    const registry = new SourceRegistry({ settings: { pinnedSourceId: null }, onEvent });
    // Recovery sends the newest state first, then still-live events. Event ordering is
    // monotonic independently so a state snapshot cannot suppress a queued event.
    registry.putState('source-a', state(3, 'idle'));
    expect(registry.postEvent('source-a', event(2))).toEqual({ ok: true, duplicate: false });
    expect(registry.postEvent('source-a', event(2))).toEqual({ ok: true, duplicate: true });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('arbitrates busy sources and honors a pin', () => {
    let now = 1_000;
    const registry = new SourceRegistry({ settings: { pinnedSourceId: null }, now: () => now });
    registry.putState('source-a', state(1, 'thinking', 'a'));
    now += 3_000;
    registry.putState('source-b', state(1, 'tool', 'b'));
    expect(registry.presentation.selectedSourceId).toBe('source-b');
    registry.setPinnedSource('source-a');
    expect(registry.presentation.selectedSourceId).toBe('source-a');
  });

  it('does not let an event from another source override an online pin', () => {
    const onEvent = vi.fn();
    const registry = new SourceRegistry({ settings: { pinnedSourceId: 'source-a' }, onEvent });
    registry.putState('source-a', state(1, 'thinking', 'a'));
    registry.putState('source-b', state(1, 'idle', 'b'));

    registry.postEvent('source-b', event(2, '294c3884-26fb-453f-a66c-a0209b5f0880'));
    expect(registry.presentation.selectedSourceId).toBe('source-a');
    expect(onEvent).not.toHaveBeenCalled();

    registry.postEvent('source-a', event(2, '394c3884-26fb-453f-a66c-a0209b5f0880'));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('marks a source offline at 30 seconds and removes it at 60 seconds', () => {
    let now = 1_000;
    const registry = new SourceRegistry({ settings: { pinnedSourceId: null }, now: () => now });
    registry.putState('source-a', state(1, 'thinking'));
    now += 30_000;
    registry.sweep();
    expect(registry.presentation.phase).toBe('offline');
    expect(registry.diagnostics().sources).toHaveLength(1);
    now += 30_000;
    registry.sweep();
    expect(registry.diagnostics().sources).toHaveLength(0);
  });
});
