import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeDescriptorSchema } from '@pi-deepseek-pet/protocol';
import { createBridgeDescriptor, removeOwnedBridgeFile, writeBridgeFile } from './bridge-file.js';

const directories: string[] = [];
const testDirectory = (): string => {
  const directory = resolve(process.cwd(), 'temp', `bridge-${randomUUID()}`);
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('bridge discovery file', () => {
  it('writes a strict descriptor and only removes its own instance', async () => {
    const directory = testDirectory();
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, 'bridge-v1.json');
    const descriptor = createBridgeDescriptor('http://127.0.0.1:17340');
    await writeBridgeFile(file, descriptor);
    expect(BridgeDescriptorSchema.parse(JSON.parse(await readFile(file, 'utf8')))).toEqual(descriptor);
    const replacement = { ...descriptor, baseUrl: 'http://127.0.0.1:17341' };
    await writeBridgeFile(file, replacement);
    expect(BridgeDescriptorSchema.parse(JSON.parse(await readFile(file, 'utf8')))).toEqual(replacement);

    await removeOwnedBridgeFile(file, randomUUID());
    expect(await readFile(file, 'utf8')).toContain(replacement.appInstanceId);
    await removeOwnedBridgeFile(file, descriptor.appInstanceId);
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not delete malformed files', async () => {
    const directory = testDirectory();
    const file = resolve(directory, 'bridge-v1.json');
    await mkdir(directory, { recursive: true });
    await writeFile(file, '{}');
    await removeOwnedBridgeFile(file, randomUUID());
    expect(await readFile(file, 'utf8')).toBe('{}');
  });
});
