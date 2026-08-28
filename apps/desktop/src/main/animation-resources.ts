import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { compareManifestAssets, parseAnimationManifestText, type AnimationManifest } from '@pi-deepseek-pet/core';
import type { Protocol } from 'electron';

export interface AnimationResources {
  manifest: AnimationManifest;
  availableAnimations: string[];
  animationFiles: Map<string, string>;
}

export async function loadAnimationResources(
  manifestFile: string,
  animationDirectory: string,
): Promise<AnimationResources> {
  const manifest = parseAnimationManifestText(await readFile(manifestFile, 'utf8'));
  const fileNames = (await readdir(animationDirectory)).filter((file) => file.toLowerCase().endsWith('.webm'));
  const availableFileNames = fileNames.map((file) => file.slice(0, -'.webm'.length));
  const diagnostic = compareManifestAssets(manifest, availableFileNames);
  if (diagnostic.missing.length > 0) {
    console.error(
      `[pi-deepseek-pet] Missing ${diagnostic.missing.length} manifest animation(s): ${diagnostic.missing.join(', ')}`,
    );
  }
  if (diagnostic.unexpected.length > 0) {
    console.warn(
      `[pi-deepseek-pet] Ignoring ${diagnostic.unexpected.length} unlisted animation(s): ${diagnostic.unexpected.join(', ')}`,
    );
  }

  const expected = new Set(manifest.assets);
  const availableAnimations = availableFileNames.filter((name) => expected.has(name)).sort();
  if (!manifest.idle.some((name) => availableAnimations.includes(name))) {
    throw new Error('No packaged idle animation is available');
  }
  return {
    manifest,
    availableAnimations,
    animationFiles: new Map(availableAnimations.map((name) => [name, join(animationDirectory, `${name}.webm`)])),
  };
}

export function registerAnimationScheme(protocol: Protocol, animationFiles: ReadonlyMap<string, string>): void {
  protocol.handle('pet-asset', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'animation') return new Response('Not found', { status: 404 });
      const encodedFile = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      const decodedFile = decodeURIComponent(encodedFile);
      if (!decodedFile.endsWith('.webm')) return new Response('Not found', { status: 404 });
      const animationName = decodedFile.slice(0, -'.webm'.length);
      const file = animationFiles.get(animationName);
      if (!file) return new Response('Not found', { status: 404 });

      const { size } = await stat(file);
      const range = parseRange(request.headers.get('range'), size);
      if (range === 'invalid') {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      }
      if (range) {
        const length = range.end - range.start + 1;
        return new Response(fileStream(file, range.start, range.end), {
          status: 206,
          headers: {
            'accept-ranges': 'bytes',
            'cache-control': 'public, max-age=31536000, immutable',
            'content-length': String(length),
            'content-range': `bytes ${range.start}-${range.end}/${size}`,
            'content-type': 'video/webm',
          },
        });
      }
      return new Response(fileStream(file), {
        status: 200,
        headers: {
          'accept-ranges': 'bytes',
          'cache-control': 'public, max-age=31536000, immutable',
          'content-length': String(size),
          'content-type': 'video/webm',
        },
      });
    } catch (error) {
      console.error('[pi-deepseek-pet] Asset protocol failure:', String(error));
      return new Response('Asset error', { status: 500 });
    }
  });
}

function fileStream(file: string, start?: number, end?: number): BodyInit {
  return Readable.toWeb(createReadStream(file, { start, end })) as unknown as BodyInit;
}

function parseRange(value: string | null, size: number): { start: number; end: number } | 'invalid' | undefined {
  if (!value) return undefined;
  const match = value.match(/^bytes=(\d*)-(\d*)$/u);
  if (!match) return 'invalid';
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) return 'invalid';

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}
