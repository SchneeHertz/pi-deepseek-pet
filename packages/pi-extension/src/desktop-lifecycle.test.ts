import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PiLifecycleDescriptor } from '@pi-deepseek-pet/protocol';
import { PiDesktopLifecycle } from './desktop-lifecycle.js';

const descriptor: PiLifecycleDescriptor = {
  schemaVersion: 1,
  managedBy: 'pi-deepseek-pet-desktop',
  enabled: true,
  command: resolve('temp/fake-app/Pi DeepSeek Pet.exe'),
  args: [],
  extensionPath: resolve('temp/fake-app/resources/pi-extension/index.js'),
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PiDesktopLifecycle', () => {
  it('launches a configured desktop in managed mode when it is not running', async () => {
    const launch = vi.fn();
    const lifecycle = new PiDesktopLifecycle({
      readDescriptor: async () => descriptor,
      isDesktopRunning: async () => false,
      launch,
    });

    expect(await lifecycle.ensureStarted()).toBe(true);
    expect(launch).toHaveBeenCalledWith(descriptor.command, ['--pi-managed']);
  });

  it('does not launch a second desktop when health discovery succeeds', async () => {
    const launch = vi.fn();
    const lifecycle = new PiDesktopLifecycle({
      readDescriptor: async () => descriptor,
      isDesktopRunning: async () => true,
      launch,
    });

    expect(await lifecycle.ensureStarted()).toBe(true);
    expect(launch).not.toHaveBeenCalled();
  });

  it('stays disabled when no managed lifecycle descriptor exists', async () => {
    const launch = vi.fn();
    const lifecycle = new PiDesktopLifecycle({
      readDescriptor: async () => undefined,
      isDesktopRunning: async () => false,
      launch,
    });

    expect(await lifecycle.ensureStarted()).toBe(false);
    expect(await lifecycle.isEnabled()).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });
});
