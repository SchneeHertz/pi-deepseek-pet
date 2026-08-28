import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { App } from 'electron';

export interface AppPaths {
  dataDirectory: string;
  settingsFile: string;
  bridgeFile: string;
  assetsDirectory: string;
  animationDirectory: string;
  manifestFile: string;
  iconFile: string;
}

export function resolveAppPaths(app: App): AppPaths {
  const dataDirectory = process.env.PI_DEEPSEEK_PET_DATA_DIR
    ? resolve(process.env.PI_DEEPSEEK_PET_DATA_DIR)
    : join(homedir(), '.pi-deepseek-pet');
  const assetsDirectory = process.env.PI_DEEPSEEK_PET_ASSETS_DIR
    ? resolve(process.env.PI_DEEPSEEK_PET_ASSETS_DIR)
    : app.isPackaged
      ? join(process.resourcesPath, 'assets')
      : resolve(app.getAppPath(), '../../assets');
  const resourcesDirectory = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : resolve(app.getAppPath(), 'resources');
  return {
    dataDirectory,
    settingsFile: join(dataDirectory, 'config.json'),
    bridgeFile: process.env.PI_DEEPSEEK_PET_BRIDGE_FILE
      ? resolve(process.env.PI_DEEPSEEK_PET_BRIDGE_FILE)
      : join(dataDirectory, 'bridge-v1.json'),
    assetsDirectory,
    animationDirectory: join(assetsDirectory, 'animations', 'webm'),
    manifestFile: join(assetsDirectory, 'animation-manifest.jsonc'),
    iconFile: join(resourcesDirectory, 'icon.png'),
  };
}
