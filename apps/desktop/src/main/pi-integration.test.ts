import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PiLifecycleDescriptorSchema } from '@pi-deepseek-pet/protocol';
import { PiIntegrationManager } from './pi-integration.js';

const directories: string[] = [];

function createFixture() {
  const directory = resolve(process.cwd(), 'temp', `pi-integration-${randomUUID()}`);
  directories.push(directory);
  const piSettingsFile = resolve(directory, 'pi-agent', 'settings.json');
  const lifecycleFile = resolve(directory, 'pet', 'pi-lifecycle-v1.json');
  const extensionFile = resolve(directory, 'app', 'resources', 'pi-extension', 'index.js');
  const desktopCommand = resolve(directory, 'app', 'Pi DeepSeek Pet.exe');
  const manager = new PiIntegrationManager({
    piSettingsFile,
    lifecycleFile,
    extensionFile,
    desktopCommand,
  });
  return { directory, piSettingsFile, lifecycleFile, extensionFile, desktopCommand, manager };
}

async function prepareFiles(fixture: ReturnType<typeof createFixture>): Promise<void> {
  await mkdir(resolve(fixture.extensionFile, '..'), { recursive: true });
  await writeFile(fixture.extensionFile, 'export default function () {}\n', 'utf8');
  await writeFile(fixture.desktopCommand, '', 'utf8');
}

async function writeDevPackage(fixture: ReturnType<typeof createFixture>): Promise<string> {
  const packageDir = resolve(fixture.directory, 'dev-package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    resolve(packageDir, 'package.json'),
    JSON.stringify({ name: 'pi-deepseek-pet-extension', version: '0.0.0-dev' }),
    'utf8',
  );
  return packageDir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('PiIntegrationManager', () => {
  it('registers the bundled extension while preserving unrelated Pi settings', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    await mkdir(resolve(fixture.piSettingsFile, '..'), { recursive: true });
    await writeFile(fixture.piSettingsFile, JSON.stringify({ theme: 'light', extensions: ['./keep.ts'] }), 'utf8');

    expect(await fixture.manager.sync(true)).toEqual({ state: 'enabled', extensionSource: 'bundled' });
    const settings = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as {
      theme: string;
      extensions: string[];
    };
    expect(settings.theme).toBe('light');
    expect(settings.extensions).toContain('./keep.ts');
    expect(settings.extensions).toContain(fixture.extensionFile.replaceAll('\\', '/'));

    const descriptor = PiLifecycleDescriptorSchema.parse(
      JSON.parse(await readFile(fixture.lifecycleFile, 'utf8')) as unknown,
    );
    expect(descriptor.command).toBe(fixture.desktopCommand);
    expect(descriptor.extensionPath).toBe(fixture.extensionFile);
  });

  it('uses an installed Pi package without loading a duplicate bundled extension', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    await mkdir(resolve(fixture.piSettingsFile, '..'), { recursive: true });
    await writeFile(
      fixture.piSettingsFile,
      JSON.stringify({ packages: ['npm:pi-deepseek-pet-extension@0.2.2'] }),
      'utf8',
    );

    expect(await fixture.manager.sync(true)).toEqual({ state: 'enabled', extensionSource: 'package' });
    const settings = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as { extensions?: string[] };
    expect(settings.extensions).toBeUndefined();
  });

  it('removes only the extension path previously managed by the desktop app', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    await fixture.manager.sync(true);
    const settings = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as { extensions: string[] };
    settings.extensions.unshift('/keep/another-extension.ts');
    await writeFile(fixture.piSettingsFile, JSON.stringify(settings), 'utf8');

    expect(await fixture.manager.sync(false)).toEqual({ state: 'disabled' });
    const disabled = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as { extensions: string[] };
    expect(disabled.extensions).toEqual(['/keep/another-extension.ts']);
    await expect(readFile(fixture.lifecycleFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite an invalid Pi settings file', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    await mkdir(resolve(fixture.piSettingsFile, '..'), { recursive: true });
    await writeFile(fixture.piSettingsFile, '{ invalid json', 'utf8');

    const status = await fixture.manager.sync(true);
    expect(status.state).toBe('error');
    expect(await readFile(fixture.piSettingsFile, 'utf8')).toBe('{ invalid json');
  });

  it('recognizes an absolute local development package without loading a duplicate bundled extension', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    const packageDir = await writeDevPackage(fixture);
    await mkdir(resolve(fixture.piSettingsFile, '..'), { recursive: true });
    await writeFile(fixture.piSettingsFile, JSON.stringify({ packages: [packageDir] }), 'utf8');

    expect(await fixture.manager.sync(true)).toEqual({ state: 'enabled', extensionSource: 'package' });
    const settings = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as { extensions?: string[] };
    expect(settings.extensions).toBeUndefined();
  });

  it('recognizes a relative local development package path', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    await writeDevPackage(fixture);
    await mkdir(resolve(fixture.piSettingsFile, '..'), { recursive: true });
    await writeFile(fixture.piSettingsFile, JSON.stringify({ packages: ['../dev-package'] }), 'utf8');

    expect(await fixture.manager.sync(true)).toEqual({ state: 'enabled', extensionSource: 'package' });
    const settings = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as { extensions?: string[] };
    expect(settings.extensions).toBeUndefined();
  });

  it('removes stale bundled extension entries when a local package is installed', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    await writeDevPackage(fixture);
    const staleFile = resolve(fixture.directory, 'stale-pet-extension', 'index.js');
    await mkdir(resolve(staleFile, '..'), { recursive: true });
    await writeFile(staleFile, '// pi-deepseek-pet stale bundled extension\n', 'utf8');
    await mkdir(resolve(fixture.piSettingsFile, '..'), { recursive: true });
    await writeFile(
      fixture.piSettingsFile,
      JSON.stringify({ packages: [resolve(fixture.directory, 'dev-package')], extensions: [staleFile] }),
      'utf8',
    );

    expect(await fixture.manager.sync(true)).toEqual({ state: 'enabled', extensionSource: 'package' });
    const settings = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as { extensions?: string[] };
    expect(settings.extensions).toEqual([]);
  });

  it('falls back to the bundled extension when the local package path does not exist', async () => {
    const fixture = createFixture();
    await prepareFiles(fixture);
    await mkdir(resolve(fixture.piSettingsFile, '..'), { recursive: true });
    await writeFile(
      fixture.piSettingsFile,
      JSON.stringify({ packages: [resolve(fixture.directory, 'missing-extension')] }),
      'utf8',
    );

    expect(await fixture.manager.sync(true)).toEqual({ state: 'enabled', extensionSource: 'bundled' });
    const settings = JSON.parse(await readFile(fixture.piSettingsFile, 'utf8')) as { extensions: string[] };
    expect(settings.extensions).toContain(fixture.extensionFile.replaceAll('\\', '/'));
  });
});
