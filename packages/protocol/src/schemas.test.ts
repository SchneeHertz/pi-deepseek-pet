import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BridgeDescriptorSchema,
  BubbleActionSchema,
  PetActionSchema,
  PetSettingsPatchSchema,
  PiLifecycleDescriptorSchema,
  SourceStateSchema,
  TransientEventSchema,
} from './schemas.js';

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/source-state.valid.json'), 'utf8'),
) as unknown;

describe('protocol v1 schemas', () => {
  it('parses a valid state fixture', () => {
    expect(SourceStateSchema.parse(fixture)).toMatchObject({ sequence: 42, phase: 'tool' });
  });

  it('rejects unknown fields and incompatible versions', () => {
    expect(SourceStateSchema.safeParse({ ...(fixture as object), prompt: 'secret' }).success).toBe(false);
    expect(SourceStateSchema.safeParse({ ...(fixture as object), protocolVersion: 2 }).success).toBe(false);
    expect(SourceStateSchema.safeParse({ ...(fixture as object), phase: 'streaming' }).success).toBe(false);
  });

  it('rejects unsafe and oversized bubble text', () => {
    expect(BubbleActionSchema.safeParse({ type: 'bubble', text: 'bad\ntext', durationMs: 1_000 }).success).toBe(false);
    expect(BubbleActionSchema.safeParse({ type: 'bubble', text: 'x'.repeat(241), durationMs: 1_000 }).success).toBe(
      false,
    );
  });

  it('requires non-empty strict settings patches', () => {
    expect(PetSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(PetSettingsPatchSchema.safeParse({ size: 462 }).success).toBe(true);
    expect(PetSettingsPatchSchema.safeParse({ manageWithPi: true }).success).toBe(true);
    expect(PetSettingsPatchSchema.safeParse({ configurePiExtension: true }).success).toBe(true);
    expect(PetSettingsPatchSchema.safeParse({ size: 462, arbitrary: true }).success).toBe(false);
  });

  it('accepts only strict managed lifecycle actions and descriptors', () => {
    expect(PetActionSchema.safeParse({ type: 'release-source', sourceId: 'source-a', quitIfIdle: true }).success).toBe(
      true,
    );
    expect(PetActionSchema.safeParse({ type: 'release-source', sourceId: '../source', quitIfIdle: true }).success).toBe(
      false,
    );
    expect(
      PiLifecycleDescriptorSchema.safeParse({
        schemaVersion: 1,
        managedBy: 'pi-deepseek-pet-desktop',
        enabled: true,
        command: 'C:/Program Files/Pi DeepSeek Pet/Pi DeepSeek Pet.exe',
        args: [],
        extensionPath: 'C:/Program Files/Pi DeepSeek Pet/resources/pi-extension/index.js',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('only accepts loopback bridge descriptors', () => {
    const base = {
      schemaVersion: 1,
      token: 'a'.repeat(64),
      appInstanceId: '194c3884-26fb-453f-a66c-a0209b5f0880',
      pid: 42,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(BridgeDescriptorSchema.safeParse({ ...base, baseUrl: 'http://127.0.0.1:17340' }).success).toBe(true);
    expect(BridgeDescriptorSchema.safeParse({ ...base, baseUrl: 'http://localhost:17340' }).success).toBe(false);
    expect(BridgeDescriptorSchema.safeParse({ ...base, baseUrl: 'https://example.com' }).success).toBe(false);
  });

  it('accepts only safe transient metadata', () => {
    const event = {
      protocolVersion: 1,
      eventId: '194c3884-26fb-453f-a66c-a0209b5f0880',
      sequence: 3,
      occurredAt: '2026-01-01T00:00:00.000Z',
      type: 'tool_failed',
      metadata: { toolName: 'edit' },
    };
    expect(TransientEventSchema.safeParse(event).success).toBe(true);
    expect(TransientEventSchema.safeParse({ ...event, metadata: { args: '/secret' } }).success).toBe(false);
  });
});
