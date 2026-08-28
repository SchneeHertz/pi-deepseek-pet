import { describe, expect, it } from 'vitest';
import type { SourceState, TransientEvent } from '@pi-deepseek-pet/protocol';
import { PiStatusMapper, createSafeSource } from './status-mapper.js';

function harness() {
  const states: SourceState[] = [];
  const events: TransientEvent[] = [];
  let now = 0;
  let id = 0;
  const mapper = new PiStatusMapper({
    sink: { publishState: (state) => states.push(state), publishEvent: (event) => events.push(event) },
    source: createSafeSource('project'),
    model: { provider: 'openai', id: 'gpt-test', thinkingLevel: 'high' },
    clock: { now: () => new Date((now += 1_000)) },
    eventId: () => `194c3884-26fb-453f-a66c-${String(++id).padStart(12, '0')}`,
  });
  return { mapper, states, events };
}

describe('PiStatusMapper', () => {
  it('emits only phase transitions for streaming deltas', () => {
    const { mapper, states } = harness();
    mapper.start();
    mapper.agentStart();
    mapper.messageUpdate('thinking_start');
    mapper.messageUpdate('thinking_delta');
    mapper.messageUpdate('thinking_delta');
    mapper.messageUpdate('text_start');
    mapper.messageUpdate('text_delta');
    expect(states.map((state) => state.phase)).toEqual(['idle', 'thinking', 'responding']);
  });

  it('tracks parallel tools without returning early to thinking', () => {
    const { mapper, states } = harness();
    mapper.start();
    mapper.agentStart();
    mapper.toolStart('a', 'read');
    mapper.toolStart('b', 'edit');
    expect(states.at(-1)?.activity?.activeToolCount).toBe(2);
    mapper.toolEnd('a', 'read', false);
    expect(states.at(-1)?.phase).toBe('tool');
    expect(states.at(-1)?.activity?.activeToolCount).toBe(1);
    mapper.toolEnd('b', 'edit', false);
    expect(states.at(-1)?.phase).toBe('thinking');
  });

  it('maps question tools to waiting and reports only safe tool names', () => {
    const { mapper, states } = harness();
    mapper.start();
    mapper.agentStart();
    mapper.toolStart('a', 'ask');
    expect(states.at(-1)?.phase).toBe('waiting');
    expect(states.at(-1)?.activity).toEqual({ toolName: 'ask', activeToolCount: 1 });
  });

  it('does not complete on agent_end and completes only on agent_settled', () => {
    const { mapper, events, states } = harness();
    mapper.start();
    mapper.agentStart();
    mapper.agentEnd('stop');
    expect(events).toHaveLength(0);
    expect(states.at(-1)?.phase).toBe('thinking');
    mapper.agentSettled();
    expect(events.at(-1)?.type).toBe('completed');
    expect(states.at(-1)?.phase).toBe('idle');
  });

  it.each([
    ['length', 'truncated'],
    ['error', 'failed'],
    ['aborted', 'cancelled'],
    ['deferred', 'attention'],
  ] as const)('maps settled stop reason %s to %s', (reason, expected) => {
    const { mapper, events } = harness();
    mapper.start();
    mapper.agentStart();
    mapper.agentEnd(reason);
    mapper.agentSettled();
    expect(events.at(-1)?.type).toBe(expected);
  });

  it('restores the previous phase after compaction failure', () => {
    const { mapper, states, events } = harness();
    mapper.start();
    mapper.agentStart();
    mapper.messageUpdate('text_start');
    mapper.beforeCompact();
    expect(states.at(-1)?.phase).toBe('compacting');
    mapper.compactFailed(false);
    expect(events.at(-1)?.type).toBe('failed');
    expect(states.at(-1)?.phase).toBe('responding');
  });

  it('never includes prompts, paths, tool args, or results in snapshots', () => {
    const { mapper, states } = harness();
    mapper.start();
    mapper.toolStart('tool-id', 'edit');
    const serialized = JSON.stringify(states);
    expect(serialized).not.toContain('args');
    expect(serialized).not.toContain('result');
    expect(serialized).not.toContain('prompt');
  });
});
