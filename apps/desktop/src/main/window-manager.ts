import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  clampWindowBounds,
  normalizePosition,
  planHorizontalMove,
  restorePosition,
  PET_REFERENCE_WIDTH,
} from '@pi-deepseek-pet/core';
import type { PetSettings, PetSettingsPatch } from '@pi-deepseek-pet/protocol';
import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { RoamRequest } from '../shared.js';
import type { SettingsStore } from './settings-store.js';

interface DragState {
  screenX: number;
  screenY: number;
  bounds: Rectangle;
}

export class PetWindowManager {
  readonly #settingsStore: SettingsStore;
  readonly #preloadPath: string;
  readonly #rendererHtml: string;
  readonly #iconPath: string;
  readonly #developmentUrl?: string;
  readonly #onContextMenu: () => void;
  #window?: BrowserWindow;
  #drag?: DragState;
  #roamTimer?: ReturnType<typeof setInterval>;

  constructor(options: {
    settingsStore: SettingsStore;
    preloadPath: string;
    rendererHtml: string;
    iconPath: string;
    developmentUrl?: string;
    onContextMenu: () => void;
  }) {
    this.#settingsStore = options.settingsStore;
    this.#preloadPath = options.preloadPath;
    this.#rendererHtml = options.rendererHtml;
    this.#iconPath = options.iconPath;
    this.#developmentUrl = options.developmentUrl;
    this.#onContextMenu = options.onContextMenu;
  }

  get window(): BrowserWindow | undefined {
    return this.#window;
  }

  async create(): Promise<BrowserWindow> {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const settings = this.#settingsStore.value;
    const bounds = this.#initialBounds(settings);
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      alwaysOnTop: settings.alwaysOnTop,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      icon: this.#iconPath,
      webPreferences: {
        preload: this.#preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('closed', () => {
      this.stopRoam();
      this.#window = undefined;
    });
    window.webContents.on('context-menu', (event) => {
      event.preventDefault();
      this.#onContextMenu();
    });
    if (this.#developmentUrl) await window.loadURL(`${this.#developmentUrl}?view=pet`);
    else await window.loadFile(this.#rendererHtml, { query: { view: 'pet' } });
    window.showInactive();
    this.#window = window;
    return window;
  }

  async applySettings(settings: PetSettings): Promise<void> {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    const height = Math.round((settings.size * 9) / 16);
    this.stopRoam();
    window.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
    window.setSize(settings.size, height, true);
    this.ensureVisible(false);
  }

  applySavedPosition(settings: PetSettings): void {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    if (!settings.position) {
      window.setBounds(this.#defaultBounds(settings.size));
      return;
    }
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === settings.position?.displayId);
    if (!display) {
      this.ensureVisible();
      return;
    }
    window.setBounds(
      restorePosition(
        settings.position,
        { width: settings.size, height: Math.round((settings.size * 9) / 16) },
        display.workArea,
      ),
    );
  }

  beginDrag(screenX: number, screenY: number): void {
    const window = this.#window;
    if (!window || window.isDestroyed() || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    this.stopRoam();
    this.#drag = { screenX, screenY, bounds: window.getBounds() };
  }

  dragTo(screenX: number, screenY: number): void {
    const window = this.#window;
    if (!window || window.isDestroyed() || !this.#drag || !Number.isFinite(screenX) || !Number.isFinite(screenY))
      return;
    const desired = {
      ...this.#drag.bounds,
      x: this.#drag.bounds.x + (screenX - this.#drag.screenX),
      y: this.#drag.bounds.y + (screenY - this.#drag.screenY),
    };
    const display = screen.getDisplayMatching(desired);
    const clamped = clampWindowBounds(desired, display.workArea, Math.max(desired.width, desired.height));
    window.setPosition(clamped.x, clamped.y, false);
  }

  endDrag(): void {
    if (!this.#drag) return;
    this.#drag = undefined;
    void this.persistPosition();
  }

  setMousePassthrough(ignore: boolean): void {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    window.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
  }

  async requestRoam(request: RoamRequest): Promise<boolean> {
    const window = this.#window;
    const params = request.params;
    if (!window || window.isDestroyed() || !params) return false;
    const values = [params.minDist, params.maxDist, params.margin, params.leadSec, params.tailSec, request.durationMs];
    if (values.some((value) => !Number.isFinite(value)) || request.durationMs < 500 || request.durationMs > 30_000)
      return false;

    this.stopRoam();
    const bounds = window.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const plan = planHorizontalMove({
      bounds,
      workArea,
      direction: request.facing === 'right' ? 1 : -1,
      minDistance: Math.min(params.minDist, 500),
      maxDistance: Math.min(params.maxDist, 600),
      margin: Math.min(params.margin, 100),
      scale: this.#settingsStore.value.size / PET_REFERENCE_WIDTH,
    });
    if (!plan) return false;

    const startedAt = Date.now();
    const leadMs = params.leadSec * 1_000;
    const tailMs = params.tailSec * 1_000;
    const travelMs = Math.max(100, request.durationMs - leadMs - tailMs);
    this.#roamTimer = setInterval(() => {
      if (!this.#window || this.#window.isDestroyed()) {
        this.stopRoam();
        return;
      }
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(1, Math.max(0, (elapsed - leadMs) / travelMs));
      const x = Math.round(plan.startX + (plan.targetX - plan.startX) * progress);
      this.#window.setPosition(x, bounds.y, false);
      if (elapsed >= request.durationMs - tailMs || progress >= 1) {
        this.stopRoam();
        void this.persistPosition();
      }
    }, 16);
    return true;
  }

  stopRoam(): void {
    if (this.#roamTimer) clearInterval(this.#roamTimer);
    this.#roamTimer = undefined;
  }

  show(): void {
    this.#window?.showInactive();
  }

  hide(): void {
    this.stopRoam();
    this.#window?.hide();
  }

  toggleVisibility(): void {
    if (this.#window?.isVisible()) this.hide();
    else this.show();
  }

  resetPosition(): void {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    const settings = this.#settingsStore.value;
    window.setBounds(this.#defaultBounds(settings.size));
    void this.#settingsStore.update({ position: null });
  }

  ensureVisible(persist = true): void {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const visible = clampWindowBounds(bounds, display.workArea);
    if (visible.x !== bounds.x || visible.y !== bounds.y) window.setBounds(visible);
    if (persist) void this.persistPosition();
  }

  async persistPosition(): Promise<void> {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const position = normalizePosition(bounds, display.workArea);
    await this.#settingsStore.update({
      position: { displayId: String(display.id), xRatio: position.xRatio, yRatio: position.yRatio },
    });
  }

  #initialBounds(settings: PetSettings): Rectangle {
    if (settings.position) {
      const display = screen
        .getAllDisplays()
        .find((candidate) => String(candidate.id) === settings.position?.displayId);
      if (display) {
        return restorePosition(
          settings.position,
          { width: settings.size, height: Math.round((settings.size * 9) / 16) },
          display.workArea,
        );
      }
    }
    return this.#defaultBounds(settings.size);
  }

  #defaultBounds(size: number): Rectangle {
    const display = screen.getPrimaryDisplay();
    const height = Math.round((size * 9) / 16);
    return {
      x: display.workArea.x + display.workArea.width - size - 24,
      y: display.workArea.y + Math.min(100, Math.max(0, display.workArea.height - height)),
      width: size,
      height,
    };
  }
}

export function rendererPathsFromMain(importMetaUrl: string): { preloadPath: string; rendererHtml: string } {
  const mainDirectory = fileURLToPath(new URL('.', importMetaUrl));
  return {
    preloadPath: join(mainDirectory, '..', 'preload', 'index.cjs'),
    rendererHtml: join(mainDirectory, '..', 'renderer', 'index.html'),
  };
}

export function isSettingsPatch(value: unknown): value is PetSettingsPatch {
  return Boolean(value && typeof value === 'object');
}
