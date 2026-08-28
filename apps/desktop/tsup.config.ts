import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/main/index.ts'],
    format: ['esm'],
    target: 'node22',
    outDir: 'dist/main',
    clean: true,
    sourcemap: true,
    external: ['electron'],
    noExternal: [/@pi-deepseek-pet\//u, /^zod(?:\/|$)/u, /^jsonc-parser(?:\/|$)/u],
  },
  {
    entry: ['src/preload/index.ts'],
    format: ['cjs'],
    target: 'node22',
    outDir: 'dist/preload',
    clean: true,
    sourcemap: true,
    external: ['electron'],
    outExtension: () => ({ js: '.cjs' }),
  },
]);
