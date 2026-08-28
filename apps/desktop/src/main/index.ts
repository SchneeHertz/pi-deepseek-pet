import { readFile } from 'node:fs/promises';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  AnimationCatalogSchema,
  BridgeDescriptorSchema,
  PetSettingsPatchSchema,
  PROTOCOL_VERSION,
  type AnimationCatalog,
  type PetAction,
  type PetSettings,
  type PetSettingsPatch,
} from '@pi-deepseek-pet/protocol';
import { z } from 'zod';
import type { RendererBootstrap, RendererEvent, RoamRequest } from '../shared.js';
import { loadAnimationResources, registerAnimationScheme } from './animation-resources.js';
import { PetApiServer } from './api-server.js';
import { createBridgeDescriptor, removeOwnedBridgeFile, writeBridgeFile } from './bridge-file.js';
import { resolveAppPaths } from './paths.js';
import { SettingsStore } from './settings-store.js';
import { SourceRegistry } from './source-registry.js';
import { PetWindowManager, rendererPathsFromMain } from './window-manager.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pet-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.exit(0);

let tray: Tray | undefined;
let settingsWindow: BrowserWindow | undefined;
let windowManager: PetWindowManager | undefined;
let settingsStore: SettingsStore | undefined;
let registry: SourceRegistry | undefined;
let apiServer: PetApiServer | undefined;
let bridgeDescriptor: ReturnType<typeof createBridgeDescriptor> | undefined;
let bridgeFile = '';
let sweepTimer: ReturnType<typeof setInterval> | undefined;
let bootstrapData: RendererBootstrap | undefined;
let cleanupStarted = false;
let cleanupComplete = false;

const pointSchema = z.object({ screenX: z.number().finite(), screenY: z.number().finite() }).strict();
const roamSchema = z
  .object({
    facing: z.enum(['left', 'right']),
    durationMs: z.number().finite().min(500).max(30_000),
    params: z
      .object({
        minDist: z.number().finite().nonnegative(),
        maxDist: z.number().finite().positive(),
        margin: z.number().finite().nonnegative(),
        leadSec: z.number().finite().nonnegative(),
        tailSec: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

if (hasSingleInstanceLock) {
  app.on('second-instance', () => windowManager?.show());
  void app
    .whenReady()
    .then(startApplication)
    .catch((error) => {
      console.error('[pi-deepseek-pet] Startup failed:', error);
      app.exit(1);
    });
}

async function startApplication(): Promise<void> {
  const paths = resolveAppPaths(app);
  bridgeFile = paths.bridgeFile;
  settingsStore = new SettingsStore(paths.settingsFile);
  const settings = await settingsStore.load();
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });

  const resources = await loadAnimationResources(paths.manifestFile, paths.animationDirectory);
  registerAnimationScheme(protocol, resources.animationFiles);
  const catalog = buildCatalog(resources.manifest, resources.availableAnimations);

  const sendRendererEvent = (event: RendererEvent): void => {
    for (const window of [windowManager?.window, settingsWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('pet:event', event);
    }
  };

  registry = new SourceRegistry({
    settings,
    onPresentation: (presentation) => {
      if (bootstrapData) bootstrapData.presentation = presentation;
      sendRendererEvent({ type: 'presentation', presentation });
    },
    onEvent: (_sourceId, event, source) =>
      sendRendererEvent({ type: 'transient', event, sourceLabel: source.source.label }),
  });

  const rendererPaths = rendererPathsFromMain(import.meta.url);
  windowManager = new PetWindowManager({
    settingsStore,
    ...rendererPaths,
    iconPath: paths.iconFile,
    developmentUrl: process.env.VITE_DEV_SERVER_URL,
    onContextMenu: showContextMenu,
  });

  bootstrapData = {
    appVersion: app.getVersion(),
    manifest: resources.manifest,
    availableAnimations: resources.availableAnimations,
    settings,
    presentation: registry.presentation,
    assetBaseUrl: 'pet-asset://animation/',
  };

  registerIpcHandlers(sendRendererEvent, rendererPaths, paths.iconFile);
  await windowManager.create();
  createTray(paths.iconFile);

  const seed = createBridgeDescriptor('http://127.0.0.1:1');
  apiServer = new PetApiServer({
    token: seed.token,
    appInstanceId: seed.appInstanceId,
    appVersion: app.getVersion(),
    registry,
    animations: catalog,
    getSettings: () => settingsStore!.value,
    updateSettings: (patch) => updateSettings(patch, sendRendererEvent),
    handleAction: (action) => handleApiAction(action, sendRendererEvent),
    audit:
      process.env.PI_DEEPSEEK_PET_DEBUG === '1' ? (entry) => console.debug('[pi-deepseek-pet] API', entry) : undefined,
  });
  const baseUrl = await apiServer.start();
  bridgeDescriptor = BridgeDescriptorSchema.parse({ ...seed, baseUrl });
  await writeBridgeFile(paths.bridgeFile, bridgeDescriptor);

  sweepTimer = setInterval(() => registry?.sweep(), 5_000);
  screen.on('display-added', ensureWindowVisible);
  screen.on('display-removed', ensureWindowVisible);
  screen.on('display-metrics-changed', ensureWindowVisible);
  console.info(`[pi-deepseek-pet] Desktop ready on ${baseUrl} (protocol v${PROTOCOL_VERSION})`);
}

function buildCatalog(
  manifest: RendererBootstrap['manifest'],
  availableAnimations: readonly string[],
): AnimationCatalog {
  const available = new Set(availableAnimations);
  const fallback = manifest.idle.find((name) => available.has(name))!;
  const filterPool = (pool: readonly string[]): string[] => {
    const filtered = pool.filter((name) => available.has(name));
    return filtered.length > 0 ? filtered : [fallback];
  };
  return AnimationCatalogSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    animations: [...availableAnimations],
    phasePools: Object.fromEntries(Object.entries(manifest.phasePools).map(([key, pool]) => [key, filterPool(pool)])),
    eventPools: Object.fromEntries(Object.entries(manifest.eventPools).map(([key, pool]) => [key, filterPool(pool)])),
  });
}

function registerIpcHandlers(
  sendRendererEvent: (event: RendererEvent) => void,
  rendererPaths: { preloadPath: string; rendererHtml: string },
  iconPath: string,
): void {
  ipcMain.handle('pet:get-bootstrap', (event) => {
    assertTrustedSender(event);
    if (!bootstrapData) throw new Error('Application is not ready');
    if (settingsStore) bootstrapData.settings = settingsStore.value;
    return structuredClone(bootstrapData);
  });
  ipcMain.on('pet:drag-start', (event, value: unknown) => {
    if (!isTrustedSender(event)) return;
    const point = pointSchema.safeParse(value);
    if (point.success) windowManager?.beginDrag(point.data.screenX, point.data.screenY);
  });
  ipcMain.on('pet:drag-move', (event, value: unknown) => {
    if (!isTrustedSender(event)) return;
    const point = pointSchema.safeParse(value);
    if (point.success) windowManager?.dragTo(point.data.screenX, point.data.screenY);
  });
  ipcMain.on('pet:drag-end', (event) => {
    if (isTrustedSender(event)) windowManager?.endDrag();
  });
  ipcMain.on('pet:mouse-passthrough', (event, ignore: unknown) => {
    if (isTrustedSender(event) && typeof ignore === 'boolean') windowManager?.setMousePassthrough(ignore);
  });
  ipcMain.handle('pet:roam', (event, value: unknown) => {
    assertTrustedSender(event);
    const parsed = roamSchema.safeParse(value);
    return parsed.success ? (windowManager?.requestRoam(parsed.data as RoamRequest) ?? false) : false;
  });
  ipcMain.on('pet:roam-stop', (event) => {
    if (isTrustedSender(event)) windowManager?.stopRoam();
  });
  ipcMain.handle('pet:update-settings', async (event, value: unknown) => {
    assertTrustedSender(event);
    return updateSettings(PetSettingsPatchSchema.parse(value), sendRendererEvent);
  });
  ipcMain.on('pet:close-settings', (event) => {
    if (isTrustedSender(event)) settingsWindow?.close();
  });

  const createSettingsWindow = async (): Promise<void> => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }
    settingsWindow = new BrowserWindow({
      width: 440,
      height: 620,
      minWidth: 400,
      minHeight: 500,
      title: 'Pi DeepSeek Pet 设置',
      icon: iconPath,
      backgroundColor: '#f5f6fb',
      webPreferences: {
        preload: rendererPaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    settingsWindow.webContents.on('will-navigate', (navigationEvent) => navigationEvent.preventDefault());
    settingsWindow.on('closed', () => (settingsWindow = undefined));
    if (process.env.VITE_DEV_SERVER_URL)
      await settingsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=settings`);
    else await settingsWindow.loadFile(rendererPaths.rendererHtml, { query: { view: 'settings' } });
  };
  openSettingsWindow = createSettingsWindow;
}

let openSettingsWindow: () => Promise<void> = async () => undefined;

async function updateSettings(
  patch: PetSettingsPatch,
  sendRendererEvent: (event: RendererEvent) => void,
): Promise<PetSettings> {
  if (!settingsStore) throw new Error('Settings store is unavailable');
  const settings = await settingsStore.update(patch);
  if ('pinnedSourceId' in patch) registry?.setPinnedSource(settings.pinnedSourceId);
  if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  await windowManager?.applySettings(settings);
  if ('position' in patch) windowManager?.applySavedPosition(settings);
  else if ('size' in patch) await windowManager?.persistPosition();
  if (bootstrapData) bootstrapData.settings = settings;
  sendRendererEvent({ type: 'settings', settings });
  refreshTrayMenu();
  return settings;
}

async function handleApiAction(action: PetAction, sendRendererEvent: (event: RendererEvent) => void): Promise<void> {
  switch (action.type) {
    case 'play':
    case 'bubble':
      sendRendererEvent({ type: 'action', action });
      break;
    case 'set-visibility':
      if (action.visible) windowManager?.show();
      else windowManager?.hide();
      break;
    case 'reset-position':
      await updateSettings({ position: null }, sendRendererEvent);
      break;
    case 'pin-source':
      await updateSettings({ pinnedSourceId: action.sourceId }, sendRendererEvent);
      break;
  }
}

function createTray(iconPath: string): void {
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Pi DeepSeek Pet');
  tray.on('click', () => windowManager?.toggleVisibility());
  refreshTrayMenu();
}

function showContextMenu(): void {
  buildContextMenu().popup({ window: windowManager?.window });
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(buildContextMenu());
}

function buildContextMenu(): Menu {
  const settings = settingsStore?.value;
  const visible = windowManager?.window?.isVisible() ?? false;
  const sizes = [320, 462, 600];
  const template: MenuItemConstructorOptions[] = [
    {
      label: visible ? '隐藏桌宠' : '显示桌宠',
      click: () => windowManager?.toggleVisibility(),
    },
    {
      label: '大小',
      submenu: sizes.map((size) => ({
        label: `${size}px`,
        type: 'radio',
        checked: settings?.size === size,
        click: () => void updateSettingsFromMenu({ size }),
      })),
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: settings?.alwaysOnTop ?? true,
      click: (item) => void updateSettingsFromMenu({ alwaysOnTop: item.checked }),
    },
    {
      label: '环境动作',
      type: 'checkbox',
      checked: settings?.ambientActions ?? true,
      click: (item) => void updateSettingsFromMenu({ ambientActions: item.checked }),
    },
    { label: '恢复默认位置', click: () => void updateSettingsFromMenu({ position: null }) },
    { type: 'separator' },
    { label: '设置…', click: () => void openSettingsWindow() },
    { type: 'separator' },
    { label: '退出 Pi DeepSeek Pet', click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

async function updateSettingsFromMenu(patch: PetSettingsPatch): Promise<void> {
  await updateSettings(patch, (event) => {
    for (const window of [windowManager?.window, settingsWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('pet:event', event);
    }
  });
}

function ensureWindowVisible(): void {
  windowManager?.ensureVisible();
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const senderId = event.sender.id;
  return senderId === windowManager?.window?.webContents.id || senderId === settingsWindow?.webContents.id;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
}

app.on('window-all-closed', () => {
  // The tray owns the application lifetime.
});

app.on('before-quit', (event) => {
  if (cleanupComplete) return;
  event.preventDefault();
  if (cleanupStarted) return;
  cleanupStarted = true;
  void cleanup().finally(() => {
    cleanupComplete = true;
    app.quit();
  });
});

async function cleanup(): Promise<void> {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = undefined;
  screen.removeListener('display-added', ensureWindowVisible);
  screen.removeListener('display-removed', ensureWindowVisible);
  screen.removeListener('display-metrics-changed', ensureWindowVisible);
  windowManager?.stopRoam();
  await apiServer?.stop().catch((error) => console.warn('[pi-deepseek-pet] API shutdown failed:', String(error)));
  if (bridgeDescriptor && bridgeFile) await removeOwnedBridgeFile(bridgeFile, bridgeDescriptor.appInstanceId);
}

// Force inclusion of the license in source distributions and surface a clear diagnostic if packaging omitted it.
if (app.isPackaged) void readFile(process.resourcesPath + '/LICENSE', 'utf8').catch(() => undefined);
