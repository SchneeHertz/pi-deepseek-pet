import type { PiPetRendererBridge } from '../shared.js';

declare global {
  interface Window {
    piPet: PiPetRendererBridge;
  }
}

export {};
