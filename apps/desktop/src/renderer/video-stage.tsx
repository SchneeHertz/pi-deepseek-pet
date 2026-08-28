import { useEffect, useRef } from 'react';
import type { Facing, PlaybackInstruction } from '@pi-deepseek-pet/core';

export function VideoStage(props: {
  assetBaseUrl: string;
  playback: PlaybackInstruction;
  facing: Facing;
  onEnded: (generation: number) => void;
  onFailed: (generation: number) => void;
  onReady: (playback: PlaybackInstruction, durationMs: number) => void;
}): React.JSX.Element {
  const { assetBaseUrl, playback, facing, onEnded, onFailed, onReady } = props;
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const front = useRef<0 | 1>(0);
  const latestGeneration = useRef(playback.generation);
  const readyGeneration = useRef<number | undefined>(undefined);

  useEffect(() => {
    latestGeneration.current = playback.generation;
    const targetIndex: 0 | 1 = front.current === 0 ? 1 : 0;
    const target = targetIndex === 0 ? videoA.current : videoB.current;
    const previous = front.current === 0 ? videoA.current : videoB.current;
    if (!target) return;

    const generation = playback.generation;
    let handled = false;
    const ready = (): void => {
      if (handled || latestGeneration.current !== generation) return;
      handled = true;
      target.classList.add('is-front');
      previous?.classList.remove('is-front');
      if (previous && previous !== target) {
        previous.onended = null;
        previous.onerror = null;
        previous.pause();
      }
      front.current = targetIndex;
      target.style.transform = facing === 'right' ? 'scaleX(-1)' : '';
      target.onended = () => {
        if (latestGeneration.current === generation) onEnded(generation);
      };
      target.onerror = () => {
        if (latestGeneration.current === generation) onFailed(generation);
      };
      void target.play().catch(() => undefined);
      if (readyGeneration.current !== generation) {
        readyGeneration.current = generation;
        const durationMs = Number.isFinite(target.duration) && target.duration > 0 ? target.duration * 1_000 : 10_000;
        onReady(playback, durationMs);
      }
    };

    target.onerror = () => {
      if (latestGeneration.current === generation) onFailed(generation);
    };
    target.onended = null;
    target.src = `${assetBaseUrl}${encodeURIComponent(playback.animation)}.webm`;
    target.loop = false;
    target.muted = true;
    target.autoplay = true;
    target.playsInline = true;
    target.addEventListener('loadeddata', ready, { once: true });
    target.load();
    if (target.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) ready();
    return () => target.removeEventListener('loadeddata', ready);
  }, [assetBaseUrl, playback, facing, onEnded, onFailed, onReady]);

  useEffect(() => {
    const transform = facing === 'right' ? 'scaleX(-1)' : '';
    if (videoA.current) videoA.current.style.transform = transform;
    if (videoB.current) videoB.current.style.transform = transform;
  }, [facing]);

  return (
    <div className="video-stage" aria-label={`Pi DeepSeek Pet 动画：${playback.animation}`}>
      <video ref={videoA} className="pet-video" muted playsInline autoPlay />
      <video ref={videoB} className="pet-video" muted playsInline autoPlay />
    </div>
  );
}
