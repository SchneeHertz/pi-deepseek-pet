import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore } from './settings-store.js';

const directories: string[] = [];
const testDirectory = (): string => {
  const directory = resolve(process.cwd(), 'temp', `settings-${randomUUID()}`);
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SettingsStore', () => {
  it('loads defaults and writes validated changes atomically', async () => {
    const directory = testDirectory();
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, 'config.json');
    const store = new SettingsStore(file);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(await store.update({ size: 320, alwaysOnTop: false })).toMatchObject({ size: 320, alwaysOnTop: false });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ size: 320, alwaysOnTop: false });
  });

  it('migrates settings written before Pi lifecycle management existed', async () => {
    const directory = testDirectory();
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, 'config.json');
    const legacy = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete legacy.manageWithPi;
    delete legacy.configurePiExtension;
    await writeFile(file, JSON.stringify(legacy), 'utf8');

    const store = new SettingsStore(file);
    expect(await store.load()).toMatchObject({
      manageWithPi: false,
      configurePiExtension: false,
      size: DEFAULT_SETTINGS.size,
    });
  });

  it('preserves both behaviors from the legacy combined Pi integration setting', async () => {
    const directory = testDirectory();
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, 'config.json');
    const legacy = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    legacy.manageWithPi = true;
    delete legacy.configurePiExtension;
    await writeFile(file, JSON.stringify(legacy), 'utf8');

    const store = new SettingsStore(file);
    expect(await store.load()).toMatchObject({ manageWithPi: true, configurePiExtension: true });
  });

  it('rejects unknown settings', async () => {
    const store = new SettingsStore(resolve(testDirectory(), 'config.json'));
    await store.load();
    await expect(store.update({ arbitrary: true } as never)).rejects.toThrow();
  });
});
