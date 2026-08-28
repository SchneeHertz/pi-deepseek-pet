import type { AnimationManifest, Facing, PlaybackInstruction } from '@pi-deepseek-pet/core';
import type { PetAction, PetSettings, PetSettingsPatch, TransientEvent, VisualPhase } from '@pi-deepseek-pet/protocol';

export interface DesktopPresentation {
  phase: VisualPhase;
  selectedSourceId?: string;
  sourceLabel?: string;
  projectName?: string;
  toolName?: string;
  otherBusyCount: number;
  onlineSourceCount: number;
}

export interface RendererBootstrap {
  appVersion: string;
  manifest: AnimationManifest;
  availableAnimations: string[];
  settings: PetSettings;
  presentation: DesktopPresentation;
  assetBaseUrl: 'pet-asset://animation/';
}

export type RendererEvent =
  | { type: 'presentation'; presentation: DesktopPresentation }
  | { type: 'transient'; event: TransientEvent; sourceLabel?: string }
  | { type: 'action'; action: Extract<PetAction, { type: 'play' | 'bubble' }> }
  | { type: 'settings'; settings: PetSettings };

export interface RoamRequest {
  facing: Facing;
  params: PlaybackInstruction['move'];
  durationMs: number;
}

export interface PiPetRendererBridge {
  getBootstrap(): Promise<RendererBootstrap>;
  subscribe(listener: (event: RendererEvent) => void): () => void;
  beginWindowDrag(screenX: number, screenY: number): void;
  dragWindow(screenX: number, screenY: number): void;
  endWindowDrag(): void;
  setMousePassthrough(ignore: boolean): void;
  requestRoam(request: RoamRequest): Promise<boolean>;
  stopRoam(): void;
  updateSettings(patch: PetSettingsPatch): Promise<PetSettings>;
  closeSettings(): void;
}
