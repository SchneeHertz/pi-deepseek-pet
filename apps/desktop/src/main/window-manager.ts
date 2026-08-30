import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  clampPetWindowBounds,
  normalizePetPosition,
  planHorizontalMove,
  restorePetPosition,
  PET_REFERENCE_WIDTH,
  type PetClampRegion,
} from '@pi-deepseek-pet/core';
import type { PetSettings, PetSettingsPatch } from '@pi-deepseek-pet/protocol';
import { BrowserWindow, screen, type Display, type Rectangle } from 'electron';
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
  readonly #feetRatio: number;
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
    /** 脚底线在窗口高度中的相对位置（画布 feetY / 画布高度）。 */
    feetRatio: number;
  }) {
    this.#settingsStore = options.settingsStore;
    this.#preloadPath = options.preloadPath;
    this.#rendererHtml = options.rendererHtml;
    this.#iconPath = options.iconPath;
    this.#developmentUrl = options.developmentUrl;
    this.#onContextMenu = options.onContextMenu;
    this.#feetRatio = options.feetRatio;
  }

  get window(): BrowserWindow | undefined {
    return this.#window;
  }

  #regionFor(display: Display): PetClampRegion {
    return { workArea: display.workArea, displayBounds: display.bounds, feetRatio: this.#feetRatio };
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
    // 用 setBounds 而非 setSize：Windows 上 resizable:false 窗口的 setSize 会被最小尺寸钳制拒绝
    window.setBounds({ width: settings.size, height });
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
      restorePetPosition(
        settings.position,
        { width: settings.size, height: Math.round((settings.size * 9) / 16) },
        this.#regionFor(display),
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
    // 以脚底为锚点钳制：桌宠可沿纵向一路压到物理屏幕底边，站上任务栏边框，
    // 而不再被限制在工作区（任务栏上方）之内。
    const clamped = clampPetWindowBounds(desired, this.#regionFor(display));
    // 用 setBounds 显式携带尺寸而非 setPosition：Windows 小数缩放（如 150%）下
    // 逐次 setPosition 会让窗口高度每次 +1px 逐渐变大（Electron DPI 转换缺陷）
    const size = this.#settingsStore.value.size;
    window.setBounds({
      x: clamped.x,
      y: clamped.y,
      width: size,
      height: Math.round((size * 9) / 16),
    });
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

    const startedAt = performance.now();
    const leadMs = params.leadSec * 1_000;
    const tailMs = params.tailSec * 1_000;
    const travelMs = Math.max(100, request.durationMs - leadMs - tailMs);
    let lastX = bounds.x;
    this.#roamTimer = setInterval(() => {
      if (!this.#window || this.#window.isDestroyed()) {
        this.stopRoam();
        return;
      }
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(1, Math.max(0, (elapsed - leadMs) / travelMs));
      const x = Math.round(plan.startX + (plan.targetX - plan.startX) * progress);
      if (x !== lastX) {
        lastX = x;
        // 与 dragTo 一致：用 setBounds 显式携带尺寸而非 setPosition，避免 Windows 小数缩放
        // （如 150%）下逐次 setPosition 触发 DPI 转换缺陷导致窗口尺寸逐渐变大。
        const size = this.#settingsStore.value.size;
        this.#window.setBounds({
          x,
          y: bounds.y,
          width: size,
          height: Math.round((size * 9) / 16),
        });
      }
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
    const visible = clampPetWindowBounds(bounds, this.#regionFor(display));
    if (visible.x !== bounds.x || visible.y !== bounds.y) window.setBounds(visible);
    if (persist) void this.persistPosition();
  }

  async persistPosition(): Promise<void> {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const position = normalizePetPosition(bounds, this.#regionFor(display));
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
        return restorePetPosition(
          settings.position,
          { width: settings.size, height: Math.round((settings.size * 9) / 16) },
          this.#regionFor(display),
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
