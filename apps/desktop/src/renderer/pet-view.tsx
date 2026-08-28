import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DRAG_THRESHOLD, PetController, type PlaybackInstruction } from '@pi-deepseek-pet/core';
import type { PetSettings, VisualPhase } from '@pi-deepseek-pet/protocol';
import type { RendererBootstrap, RendererEvent } from '../shared.js';
import { VideoStage } from './video-stage.js';

interface PointerState {
  pointerId: number;
  startX: number;
  startY: number;
  startScreenX: number;
  startScreenY: number;
  dragging: boolean;
}

export function PetView(): React.JSX.Element | null {
  const [bootstrap, setBootstrap] = useState<RendererBootstrap>();
  useEffect(() => {
    void window.piPet.getBootstrap().then(setBootstrap);
  }, []);
  return bootstrap ? <ActivePet initial={bootstrap} /> : null;
}

function ActivePet({ initial }: { initial: RendererBootstrap }): React.JSX.Element {
  const controller = useMemo(
    () =>
      new PetController(initial.manifest, {
        initialPhase: initial.presentation.phase,
        ambientActions: initial.settings.ambientActions,
        availableAnimations: initial.availableAnimations,
        onDiagnostic: (message) => console.warn('[pi-deepseek-pet]', message),
      }),
    [initial],
  );
  const [, render] = useState(0);
  const [settings, setSettings] = useState(initial.settings);
  const [presentation, setPresentation] = useState(initial.presentation);
  const [bubble, setBubble] = useState<string>();
  const bubbleTimer = useRef<number | undefined>(undefined);
  const pointer = useRef<PointerState | undefined>(undefined);
  const phaseRef = useRef<VisualPhase>(initial.presentation.phase);

  const refresh = useCallback(() => render((value) => value + 1), []);
  const showBubble = useCallback(
    (text: string | undefined, durationMs = 5_000) => {
      if (!settings.bubblesEnabled || !text) return;
      if (bubbleTimer.current !== undefined) window.clearTimeout(bubbleTimer.current);
      setBubble(text);
      bubbleTimer.current = window.setTimeout(() => setBubble(undefined), durationMs);
    },
    [settings.bubblesEnabled],
  );

  useEffect(() => {
    window.piPet.setMousePassthrough(true);
    showBubble(initial.manifest.bubbles.phases[initial.presentation.phase]);
    const unsubscribe = window.piPet.subscribe((event: RendererEvent) => {
      if (event.type === 'presentation') {
        const previousPhase = phaseRef.current;
        phaseRef.current = event.presentation.phase;
        setPresentation(event.presentation);
        controller.setPersistentPhase(event.presentation.phase);
        if (event.presentation.phase !== previousPhase) {
          if (event.presentation.phase === 'tool' && event.presentation.toolName) {
            showBubble(`工具：${event.presentation.toolName}`);
          } else {
            showBubble(initial.manifest.bubbles.phases[event.presentation.phase]);
          }
        }
        refresh();
      } else if (event.type === 'transient') {
        controller.triggerEvent(event.event.type);
        const configured = initial.manifest.bubbles.events[event.event.type];
        const toolName = event.event.metadata?.toolName;
        showBubble(toolName && event.event.type === 'tool_failed' ? `工具 ${toolName} 执行失败` : configured);
        refresh();
      } else if (event.type === 'action') {
        if (event.action.type === 'play') {
          controller.playManual(event.action.animation);
          refresh();
        } else {
          showBubble(event.action.text, event.action.durationMs);
        }
      } else if (event.type === 'settings') {
        setSettings(event.settings);
        controller.setAmbientActions(event.settings.ambientActions);
        refresh();
      }
    });
    return () => {
      unsubscribe();
      if (bubbleTimer.current !== undefined) window.clearTimeout(bubbleTimer.current);
      window.piPet.stopRoam();
      window.piPet.setMousePassthrough(false);
    };
  }, [controller, initial.manifest.bubbles, initial.presentation.phase, refresh, showBubble]);

  const onEnded = useCallback(
    (generation: number) => {
      if (controller.animationEnded(generation)) refresh();
    },
    [controller, refresh],
  );
  const onFailed = useCallback(
    (generation: number) => {
      if (controller.animationFailed(generation)) refresh();
    },
    [controller, refresh],
  );
  const onReady = useCallback(
    (playback: PlaybackInstruction, durationMs: number) => {
      if (playback.move) {
        void window.piPet.requestRoam({ facing: controller.snapshot.facing, params: playback.move, durationMs });
      } else {
        window.piPet.stopRoam();
      }
    },
    [controller],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      dragging: false,
    };
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = pointer.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.dragging && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= DRAG_THRESHOLD) {
      state.dragging = true;
      controller.beginDrag();
      window.piPet.beginWindowDrag(state.startScreenX, state.startScreenY);
      refresh();
    }
    if (state.dragging) window.piPet.dragWindow(event.screenX, event.screenY);
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = pointer.current;
    if (!state || state.pointerId !== event.pointerId) return;
    pointer.current = undefined;
    if (state.dragging) {
      window.piPet.endWindowDrag();
      controller.endDrag();
    } else {
      controller.click();
    }
    refresh();
  };
  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = pointer.current;
    if (!state || state.pointerId !== event.pointerId) return;
    pointer.current = undefined;
    if (state.dragging) {
      window.piPet.endWindowDrag();
      controller.endDrag();
      refresh();
    }
  };

  const hitBox = initial.manifest.canvas.hitBox;
  const hitStyle = {
    left: `${(hitBox.x0 / initial.manifest.canvas.width) * 100}%`,
    top: `${(hitBox.y0 / initial.manifest.canvas.height) * 100}%`,
    width: `${((hitBox.x1 - hitBox.x0) / initial.manifest.canvas.width) * 100}%`,
    height: `${((hitBox.y1 - hitBox.y0) / initial.manifest.canvas.height) * 100}%`,
  };
  const snapshot = controller.snapshot;

  return (
    <main className="pet-root" data-testid="pet-root">
      {bubble ? <div className="pet-bubble">{bubble}</div> : null}
      {presentation.otherBusyCount > 0 ? (
        <div className="session-count">另有 {presentation.otherBusyCount} 个 Pi 会话运行中</div>
      ) : null}
      <VideoStage
        assetBaseUrl={initial.assetBaseUrl}
        playback={snapshot.playback}
        facing={snapshot.facing}
        onEnded={onEnded}
        onFailed={onFailed}
        onReady={onReady}
      />
      <div
        className={`pet-hitbox${snapshot.dragging ? ' is-dragging' : ''}`}
        style={hitStyle}
        onPointerEnter={() => window.piPet.setMousePassthrough(false)}
        onPointerLeave={() => {
          if (!pointer.current?.dragging) window.piPet.setMousePassthrough(true);
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        aria-label="Pi DeepSeek Pet 交互区域"
      />
    </main>
  );
}

export function settingsSummary(settings: PetSettings): string {
  return `${settings.size}px / ${settings.alwaysOnTop ? '置顶' : '普通'}`;
}
