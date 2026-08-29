import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  BridgeDescriptorSchema,
  PiLifecycleDescriptorSchema,
  type BridgeDescriptor,
  type PiLifecycleDescriptor,
} from '@pi-deepseek-pet/protocol';
import { defaultBridgeFile } from './transport.js';

const HEALTH_TIMEOUT_MS = 250;

export interface PiDesktopLifecycleOptions {
  lifecycleFile?: string;
  bridgeFile?: string;
  debug?: boolean;
  readDescriptor?: () => Promise<PiLifecycleDescriptor | undefined>;
  isDesktopRunning?: () => Promise<boolean>;
  launch?: (command: string, args: string[]) => ChildProcess | undefined;
}

export class PiDesktopLifecycle {
  readonly #lifecycleFile: string;
  readonly #bridgeFile: string;
  readonly #debug: boolean;
  readonly #readDescriptorOverride?: () => Promise<PiLifecycleDescriptor | undefined>;
  readonly #isDesktopRunningOverride?: () => Promise<boolean>;
  readonly #launchOverride?: (command: string, args: string[]) => ChildProcess | undefined;

  constructor(options: PiDesktopLifecycleOptions = {}) {
    this.#lifecycleFile = options.lifecycleFile ?? defaultLifecycleFile();
    this.#bridgeFile = options.bridgeFile ?? defaultBridgeFile();
    this.#debug = options.debug ?? false;
    this.#readDescriptorOverride = options.readDescriptor;
    this.#isDesktopRunningOverride = options.isDesktopRunning;
    this.#launchOverride = options.launch;
  }

  async ensureStarted(): Promise<boolean> {
    if (process.env.PI_DEEPSEEK_PET_DISABLED === '1') return false;
    const descriptor = await this.#readDescriptor();
    if (!descriptor) return false;

    try {
      if (!isAbsolute(descriptor.command)) throw new Error('desktop command must be an absolute path');
      const running = this.#isDesktopRunningOverride
        ? await this.#isDesktopRunningOverride()
        : await isDesktopHealthy(this.#bridgeFile);
      if (running) return true;
      const args = descriptor.args.includes('--pi-managed')
        ? [...descriptor.args]
        : [...descriptor.args, '--pi-managed'];
      const child = this.#launchOverride
        ? this.#launchOverride(descriptor.command, args)
        : spawn(descriptor.command, args, {
            cwd: dirname(descriptor.command),
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
      child?.once('error', (error) => this.#debugError(`desktop launch failed: ${error.message}`));
      child?.unref();
      return true;
    } catch (error) {
      this.#debugError(`desktop lifecycle unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async isEnabled(): Promise<boolean> {
    if (process.env.PI_DEEPSEEK_PET_DISABLED === '1') return false;
    return (await this.#readDescriptor()) !== undefined;
  }

  async #readDescriptor(): Promise<PiLifecycleDescriptor | undefined> {
    if (this.#readDescriptorOverride) return this.#readDescriptorOverride();
    try {
      return PiLifecycleDescriptorSchema.parse(JSON.parse(await readFile(this.#lifecycleFile, 'utf8')) as unknown);
    } catch {
      return undefined;
    }
  }

  #debugError(message: string): void {
    if (this.#debug) console.debug(`[pi-deepseek-pet] ${message}`);
  }
}

async function isDesktopHealthy(bridgeFile: string): Promise<boolean> {
  let bridge: BridgeDescriptor;
  try {
    bridge = BridgeDescriptorSchema.parse(JSON.parse(await readFile(bridgeFile, 'utf8')) as unknown);
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  timer.unref?.();
  try {
    return (await requestHealth(`${bridge.baseUrl}/api/v1/health`, controller.signal)) === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function requestHealth(url: string, signal: AbortSignal): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const target = new URL(url);
    if (
      target.protocol !== 'http:' ||
      target.hostname !== '127.0.0.1' ||
      target.username !== '' ||
      target.password !== ''
    ) {
      reject(new Error('desktop health URL must use direct HTTP on 127.0.0.1'));
      return;
    }
    const request = httpRequest(target, { method: 'GET', signal, agent: false }, (response) => {
      const status = response.statusCode ?? 0;
      response.once('error', reject);
      response.once('end', () => resolvePromise(status));
      response.resume();
    });
    request.once('error', reject);
    request.end();
  });
}

export function defaultLifecycleFile(): string {
  if (process.env.PI_DEEPSEEK_PET_LIFECYCLE_FILE) return resolve(process.env.PI_DEEPSEEK_PET_LIFECYCLE_FILE);
  const dataDirectory = process.env.PI_DEEPSEEK_PET_DATA_DIR
    ? resolve(process.env.PI_DEEPSEEK_PET_DATA_DIR)
    : join(homedir(), '.pi-deepseek-pet');
  return join(dataDirectory, 'pi-lifecycle-v1.json');
}
