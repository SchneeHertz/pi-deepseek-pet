import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { PiLifecycleDescriptorSchema, type PiLifecycleDescriptor } from '@pi-deepseek-pet/protocol';
import type { PiIntegrationStatus } from '../shared.js';

const PET_PACKAGE_NAME = 'pi-deepseek-pet-extension';

export interface PiIntegrationOptions {
  piSettingsFile: string;
  lifecycleFile: string;
  extensionFile: string;
  desktopCommand: string;
  desktopArgs?: string[];
}

export class PiIntegrationManager {
  readonly #options: PiIntegrationOptions;

  constructor(options: PiIntegrationOptions) {
    this.#options = {
      ...options,
      piSettingsFile: resolve(options.piSettingsFile),
      lifecycleFile: resolve(options.lifecycleFile),
      extensionFile: resolve(options.extensionFile),
      desktopCommand: resolve(options.desktopCommand),
      desktopArgs: [...(options.desktopArgs ?? [])],
    };
  }

  async sync(enabled: boolean): Promise<PiIntegrationStatus> {
    try {
      const previousDescriptor = await readLifecycleDescriptor(this.#options.lifecycleFile);
      if (enabled) return await this.#enable(previousDescriptor);
      await this.#disable(previousDescriptor);
      return { state: 'disabled' };
    } catch (error) {
      return {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #enable(previousDescriptor: PiLifecycleDescriptor | undefined): Promise<PiIntegrationStatus> {
    await access(this.#options.extensionFile);
    if (!isAbsolute(this.#options.desktopCommand)) throw new Error('桌面应用启动路径必须是绝对路径');

    const settings = await readPiSettings(this.#options.piSettingsFile);
    const packageInstalled = await hasEnabledPetPackage(settings.value.packages, settings.directory);
    const managedPaths = [previousDescriptor?.extensionPath, this.#options.extensionFile].filter(
      (value): value is string => Boolean(value),
    );
    const extensions = readExtensionEntries(settings.value.extensions);
    let nextExtensions = extensions.filter(
      (entry) => !managedPaths.some((managedPath) => extensionEntryMatches(entry, managedPath, settings.directory)),
    );
    if (packageInstalled) {
      const kept: string[] = [];
      for (const entry of nextExtensions) {
        if (await isPetExtensionEntry(entry, settings.directory)) continue;
        kept.push(entry);
      }
      nextExtensions = kept;
    }
    if (!packageInstalled) nextExtensions.push(toPortablePath(this.#options.extensionFile));
    applyExtensions(settings.value, nextExtensions, settings.hadExtensions);

    const descriptor = PiLifecycleDescriptorSchema.parse({
      schemaVersion: 1,
      managedBy: 'pi-deepseek-pet-desktop',
      enabled: true,
      command: this.#options.desktopCommand,
      args: this.#options.desktopArgs,
      extensionPath: this.#options.extensionFile,
      updatedAt: new Date().toISOString(),
    });

    await atomicWriteJson(this.#options.lifecycleFile, descriptor);
    if (settings.changed()) await atomicWriteJson(this.#options.piSettingsFile, settings.value);
    return { state: 'enabled', extensionSource: packageInstalled ? 'package' : 'bundled' };
  }

  async #disable(previousDescriptor: PiLifecycleDescriptor | undefined): Promise<void> {
    await rm(this.#options.lifecycleFile, { force: true });
    if (!previousDescriptor) return;

    const settings = await readPiSettings(this.#options.piSettingsFile, false);
    if (!settings.exists) return;
    const extensions = readExtensionEntries(settings.value.extensions);
    const nextExtensions = extensions.filter(
      (entry) => !extensionEntryMatches(entry, previousDescriptor.extensionPath, settings.directory),
    );
    applyExtensions(settings.value, nextExtensions, settings.hadExtensions);
    if (settings.changed()) await atomicWriteJson(this.#options.piSettingsFile, settings.value);
  }
}

interface PiSettingsDocument {
  value: Record<string, unknown>;
  directory: string;
  exists: boolean;
  hadExtensions: boolean;
  changed(): boolean;
}

async function readPiSettings(filePath: string, create = true): Promise<PiSettingsDocument> {
  let raw = '';
  let exists = true;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    exists = false;
    if (!create) {
      return {
        value: {},
        directory: dirname(filePath),
        exists: false,
        hadExtensions: false,
        changed: () => false,
      };
    }
  }

  let value: unknown = {};
  if (raw.trim()) {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`无法解析 Pi 设置文件：${filePath}`);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Pi 设置文件必须包含 JSON 对象：${filePath}`);
  }
  const document = value as Record<string, unknown>;
  const original = JSON.stringify(document);
  return {
    value: document,
    directory: dirname(filePath),
    exists,
    hadExtensions: Object.hasOwn(document, 'extensions'),
    changed: () => !exists || JSON.stringify(document) !== original,
  };
}

function readExtensionEntries(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('Pi 设置中的 extensions 必须是字符串数组');
  }
  return [...value] as string[];
}

function applyExtensions(settings: Record<string, unknown>, entries: string[], hadExtensions: boolean): void {
  const unique = [...new Set(entries)];
  if (unique.length > 0 || hadExtensions) settings.extensions = unique;
  else delete settings.extensions;
}

function extensionEntryMatches(entry: string, targetPath: string, settingsDirectory: string): boolean {
  const candidate = entry.startsWith('+') || entry.startsWith('-') ? entry.slice(1) : entry;
  if (['*', '?', '[', ']', '{', '}'].some((character) => candidate.includes(character))) return false;
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(settingsDirectory, candidate);
  return normalizePath(absolute) === normalizePath(resolve(targetPath));
}

function normalizePath(value: string): string {
  const normalized = resolve(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function toPortablePath(value: string): string {
  return resolve(value).replaceAll('\\', '/');
}

async function hasEnabledPetPackage(value: unknown, settingsDirectory: string): Promise<boolean> {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    const source =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && typeof (entry as { source?: unknown }).source === 'string'
          ? (entry as { source: string }).source
          : undefined;
    if (!source || !(await isPetPackageSource(source, settingsDirectory))) continue;
    if (entry && typeof entry === 'object') {
      const extensions = (entry as { extensions?: unknown }).extensions;
      if (Array.isArray(extensions) && extensions.length === 0) return false;
    }
    return true;
  }
  return false;
}

async function isPetPackageSource(source: string, settingsDirectory: string): Promise<boolean> {
  const normalized = source.trim();
  if (normalized === PET_PACKAGE_NAME || normalized === `npm:${PET_PACKAGE_NAME}`) return true;
  if (normalized.startsWith(`npm:${PET_PACKAGE_NAME}@`)) return true;
  // 本地路径(开发中的扩展):file: 前缀、相对路径、绝对路径
  const local = normalized.startsWith('file:') ? normalized.slice('file:'.length) : normalized;
  if (!local) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(local) && !/^[a-z]:[\\/]/i.test(local)) return false;
  const absolute = isAbsolute(local) ? resolve(local) : resolve(settingsDirectory, local);
  return isPetExtensionEntryAt(absolute);
}

async function isPetExtensionEntry(entry: string, settingsDirectory: string): Promise<boolean> {
  const candidate = entry.startsWith('+') || entry.startsWith('-') ? entry.slice(1) : entry;
  if (['*', '?', '[', ']', '{', '}'].some((character) => candidate.includes(character))) return false;
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(settingsDirectory, candidate);
  return isPetExtensionEntryAt(absolute);
}

async function isPetExtensionEntryAt(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      const manifest = JSON.parse(await readFile(resolve(target, 'package.json'), 'utf8')) as { name?: unknown };
      return manifest.name === PET_PACKAGE_NAME;
    }
    if (info.isFile()) {
      return (await readFile(target, 'utf8')).includes('pi-deepseek-pet');
    }
    return false;
  } catch {
    return false;
  }
}

async function readLifecycleDescriptor(filePath: string): Promise<PiLifecycleDescriptor | undefined> {
  try {
    return PiLifecycleDescriptorSchema.parse(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return undefined;
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const directory = dirname(filePath);
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
