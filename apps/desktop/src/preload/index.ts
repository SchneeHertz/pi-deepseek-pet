import { contextBridge, ipcRenderer } from 'electron';
import type { PetSettingsPatch } from '@pi-deepseek-pet/protocol';
import type { PiPetRendererBridge, RendererBootstrap, RendererEvent, RoamRequest } from '../shared.js';

const bridge: PiPetRendererBridge = {
  getBootstrap: () => ipcRenderer.invoke('pet:get-bootstrap') as Promise<RendererBootstrap>,
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: RendererEvent): void => listener(value);
    ipcRenderer.on('pet:event', handler);
    return () => ipcRenderer.off('pet:event', handler);
  },
  beginWindowDrag: (screenX, screenY) => ipcRenderer.send('pet:drag-start', { screenX, screenY }),
  dragWindow: (screenX, screenY) => ipcRenderer.send('pet:drag-move', { screenX, screenY }),
  endWindowDrag: () => ipcRenderer.send('pet:drag-end'),
  setMousePassthrough: (ignore) => ipcRenderer.send('pet:mouse-passthrough', ignore),
  requestRoam: (request: RoamRequest) => ipcRenderer.invoke('pet:roam', request) as Promise<boolean>,
  stopRoam: () => ipcRenderer.send('pet:roam-stop'),
  updateSettings: (patch: PetSettingsPatch) => ipcRenderer.invoke('pet:update-settings', patch),
  closeSettings: () => ipcRenderer.send('pet:close-settings'),
};

contextBridge.exposeInMainWorld('piPet', bridge);
