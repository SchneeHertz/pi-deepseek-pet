import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeDescriptor, SourceState, TransientEvent } from '@pi-deepseek-pet/protocol';
import { PiPetTransport } from './transport.js';

const bridge: BridgeDescriptor = {
  schemaVersion: 1,
  baseUrl: 'http://127.0.0.1:17340',
  token: 'a'.repeat(64),
  appInstanceId: '194c3884-26fb-453f-a66c-a0209b5f0880',
  pid: 42,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const state = (sequence: number, phase: SourceState['phase'] = 'thinking'): SourceState => ({
  protocolVersion: 1,
  sequence,
  sentAt: '2026-01-01T00:00:00.000Z',
  phase,
  source: { kind: 'pi', label: 'Pi', projectName: 'test' },
});
const event = (sequence: number): TransientEvent => ({
  protocolVersion: 1,
  eventId: `194c3884-26fb-453f-a66c-${String(sequence).padStart(12, '0')}`,
  sequence,
  occurredAt: '2026-01-01T00:00:00.000Z',
  type: 'completed',
});

describe('PiPetTransport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces snapshots and recovers in snapshot-before-events order', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body as string | undefined });
      return new Response('{}', { status: 200 });
    });
    const transport = new PiPetTransport({
      sourceId: 'source-a',
      fetch: fetchMock as typeof fetch,
      readBridge: async () => bridge,
    });
    transport.start();
    transport.publishState(state(1));
    transport.publishEvent(event(2));
    transport.publishState(state(3, 'idle'));
    await vi.advanceTimersByTimeAsync(0);

    expect(calls[0]?.url).toContain('/state');
    expect(JSON.parse(calls[0]?.body ?? '{}').sequence).toBe(3);
    expect(calls[1]?.url).toContain('/events');
    expect(transport.diagnostics.stateQueued).toBe(false);
    expect(transport.diagnostics.eventQueueLength).toBe(0);
    await transport.stop();
  });

  it('backs off without blocking publishers and retries the newest state', async () => {
    let attempts = 0;
    const bodies: SourceState[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as SourceState);
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return new Response('{}', { status: 200 });
    });
    const transport = new PiPetTransport({
      sourceId: 'source-a',
      fetch: fetchMock as typeof fetch,
      readBridge: async () => bridge,
    });
    transport.start();
    transport.publishState(state(1));
    transport.publishState(state(2, 'responding'));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.diagnostics.connected).toBe(false);
    expect(bodies[0]?.sequence).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.diagnostics.connected).toBe(true);
    expect(bodies[1]?.sequence).toBe(2);
    await transport.stop();
  });

  it('bounds the transient queue at twenty entries', () => {
    const transport = new PiPetTransport({ sourceId: 'source-a', readBridge: async () => undefined });
    for (let sequence = 1; sequence <= 25; sequence += 1) transport.publishEvent(event(sequence));
    expect(transport.diagnostics.eventQueueLength).toBe(20);
  });

  it('resends the complete current snapshot when the desktop instance changes', async () => {
    let currentBridge = bridge;
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    });
    const transport = new PiPetTransport({
      sourceId: 'source-a',
      fetch: fetchMock as typeof fetch,
      readBridge: async () => currentBridge,
    });
    transport.start();
    transport.publishState(state(1));
    await vi.advanceTimersByTimeAsync(0);
    currentBridge = { ...bridge, appInstanceId: '294c3884-26fb-453f-a66c-a0209b5f0880', token: 'b'.repeat(64) };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.at(-1)).toContain('/state');
    await transport.stop();
  });

  it('re-reads the bridge descriptor on reconnect', async () => {
    let reads = 0;
    const tokens: string[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      tokens.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response('{}', { status: reads === 1 ? 503 : 200 });
    });
    const transport = new PiPetTransport({
      sourceId: 'source-a',
      fetch: fetchMock as typeof fetch,
      readBridge: async () => {
        reads += 1;
        return { ...bridge, token: (reads === 1 ? 'a' : 'b').repeat(64) };
      },
    });
    transport.start();
    transport.publishState(state(1));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(tokens).toContain(`Bearer ${'b'.repeat(64)}`);
    await transport.stop();
  });
});
