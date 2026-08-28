import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests/e2e',
  timeout: 30_000,
  outputDir: '../../temp/playwright-results',
  reporter: [['list'], ['html', { outputFolder: '../../temp/playwright-report', open: 'never' }]],
  workers: 1,
});
