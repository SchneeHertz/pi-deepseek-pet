import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BridgeDescriptorSchema, type BridgeDescriptor } from '@pi-deepseek-pet/protocol';

export function createBridgeDescriptor(baseUrl: string): BridgeDescriptor {
  return BridgeDescriptorSchema.parse({
    schemaVersion: 1,
    baseUrl,
    token: randomBytes(32).toString('hex'),
    appInstanceId: randomUUID(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
  });
}

export async function writeBridgeFile(filePath: string, descriptor: BridgeDescriptor): Promise<void> {
  const clean = BridgeDescriptorSchema.parse(descriptor);
  const directory = dirname(filePath);
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, JSON.stringify(clean, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function removeOwnedBridgeFile(filePath: string, appInstanceId: string): Promise<void> {
  try {
    const current = BridgeDescriptorSchema.parse(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
    if (current.appInstanceId === appInstanceId) await rm(filePath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[pi-deepseek-pet] Could not safely remove bridge file:', String(error));
    }
  }
}
