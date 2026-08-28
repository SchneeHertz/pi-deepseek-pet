import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PetSettingsPatchSchema,
  PetSettingsSchema,
  type PetSettings,
  type PetSettingsPatch,
} from '@pi-deepseek-pet/protocol';

export const DEFAULT_SETTINGS: PetSettings = {
  size: 462,
  alwaysOnTop: true,
  ambientActions: true,
  bubblesEnabled: true,
  launchAtLogin: false,
  pinnedSourceId: null,
  position: null,
};

export class SettingsStore {
  readonly #filePath: string;
  #settings: PetSettings = structuredClone(DEFAULT_SETTINGS);
  #writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  get value(): PetSettings {
    return structuredClone(this.#settings);
  }

  async load(): Promise<PetSettings> {
    try {
      const value = JSON.parse(await readFile(this.#filePath, 'utf8')) as unknown;
      this.#settings = PetSettingsSchema.parse(value);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT')
        console.warn('[pi-deepseek-pet] Invalid settings file; using safe defaults:', String(error));
      this.#settings = structuredClone(DEFAULT_SETTINGS);
    }
    return this.value;
  }

  async update(patch: PetSettingsPatch): Promise<PetSettings> {
    const cleanPatch = PetSettingsPatchSchema.parse(patch);
    this.#settings = PetSettingsSchema.parse({ ...this.#settings, ...cleanPatch });
    await this.#enqueueWrite();
    return this.value;
  }

  async replace(settings: PetSettings): Promise<PetSettings> {
    this.#settings = PetSettingsSchema.parse(settings);
    await this.#enqueueWrite();
    return this.value;
  }

  #enqueueWrite(): Promise<void> {
    const snapshot = JSON.stringify(this.#settings, null, 2) + '\n';
    this.#writeChain = this.#writeChain.then(() => this.#atomicWrite(snapshot));
    return this.#writeChain;
  }

  async #atomicWrite(contents: string): Promise<void> {
    const directory = dirname(this.#filePath);
    const temporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporary, 0o600).catch(() => undefined);
      await rename(temporary, this.#filePath);
      await chmod(this.#filePath, 0o600).catch(() => undefined);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
