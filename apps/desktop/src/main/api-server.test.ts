import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimationCatalog, PetSettings, SourceState } from '@pi-deepseek-pet/protocol';
import { DEFAULT_SETTINGS } from './settings-store.js';
import { SourceRegistry } from './source-registry.js';
import { PetApiServer } from './api-server.js';

const token = 'a'.repeat(64);
const sourceState = (sequence: number): SourceState => ({
  protocolVersion: 1,
  sequence,
  sentAt: '2026-01-01T00:00:00.000Z',
  phase: 'thinking',
  source: { kind: 'pi', label: 'Pi', projectName: 'test' },
});

const catalog: AnimationCatalog = {
  protocolVersion: 1,
  animations: ['idle'],
  phasePools: {
    offline: ['idle'],
    idle: ['idle'],
    thinking: ['idle'],
    responding: ['idle'],
    tool: ['idle'],
    waiting: ['idle'],
    compacting: ['idle'],
  },
  eventPools: {
    completed: ['idle'],
    failed: ['idle'],
    cancelled: ['idle'],
    truncated: ['idle'],
    tool_failed: ['idle'],
    attention: ['idle'],
  },
};

describe('loopback HTTP API', () => {
  let server: PetApiServer;
  let baseUrl: string;
  let settings: PetSettings;
  const handleAction = vi.fn();

  beforeEach(async () => {
    settings = structuredClone(DEFAULT_SETTINGS);
    const registry = new SourceRegistry({ settings });
    server = new PetApiServer({
      token,
      appInstanceId: '194c3884-26fb-453f-a66c-a0209b5f0880',
      appVersion: 'test',
      registry,
      animations: catalog,
      getSettings: () => settings,
      updateSettings: async (patch) => (settings = { ...settings, ...patch }),
      handleAction,
      preferredPort: 0,
    });
    baseUrl = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    handleAction.mockReset();
  });

  const authenticated = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  it('exposes secret-free health and rejects missing authentication', async () => {
    const health = await fetch(`${baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(JSON.stringify(await health.json())).not.toContain(token);
    expect((await fetch(`${baseUrl}/api/v1/state`)).status).toBe(401);
  });

  it('rejects browser origins even with a valid token', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/state`,
      authenticated({ headers: { origin: 'https://attacker.example' } }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('validates state schemas and protects monotonic sequences', async () => {
    const put = (body: unknown) =>
      fetch(`${baseUrl}/api/v1/sources/source-a/state`, authenticated({ method: 'PUT', body: JSON.stringify(body) }));
    expect((await put(sourceState(2))).status).toBe(200);
    expect((await put(sourceState(2))).status).toBe(200);
    expect((await put(sourceState(1))).status).toBe(409);
    expect((await put({ ...sourceState(3), prompt: 'must not pass' })).status).toBe(400);
  });

  it('enforces the body limit and animation allowlist', async () => {
    const oversized = await fetch(
      `${baseUrl}/api/v1/pet/actions`,
      authenticated({ method: 'POST', body: JSON.stringify({ type: 'bubble', text: 'x'.repeat(17_000) }) }),
    );
    expect(oversized.status).toBe(413);

    const unknownAnimation = await fetch(
      `${baseUrl}/api/v1/pet/actions`,
      authenticated({ method: 'POST', body: JSON.stringify({ type: 'play', animation: 'unknown' }) }),
    );
    expect(unknownAnimation.status).toBe(404);
    expect(handleAction).not.toHaveBeenCalled();
  });

  it('updates only allowed settings', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/pet/settings`,
      authenticated({ method: 'PATCH', body: JSON.stringify({ size: 320 }) }),
    );
    expect(response.status).toBe(200);
    expect(settings.size).toBe(320);
  });
});
