import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, expect, test } from '@playwright/test';

interface BridgeDescriptor {
  baseUrl: string;
  token: string;
}

test('transparent desktop window loads assets and accepts authenticated API actions', async () => {
  const projectRoot = resolve(process.cwd(), '../..');
  const temporaryDirectory = resolve(projectRoot, 'temp', `e2e-${randomUUID()}`);
  const bridgeFile = resolve(temporaryDirectory, 'bridge-v1.json');
  await mkdir(temporaryDirectory, { recursive: true });

  const electronApp = await electron.launch({
    args: [process.cwd()],
    env: {
      ...process.env,
      PI_DEEPSEEK_PET_ASSETS_DIR: resolve(projectRoot, 'assets'),
      PI_DEEPSEEK_PET_DATA_DIR: temporaryDirectory,
      PI_DEEPSEEK_PET_BRIDGE_FILE: bridgeFile,
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId('pet-root')).toBeVisible();
    await expect(page.locator('video.is-front')).toHaveCount(1, { timeout: 15_000 });

    const windowOptions = await electronApp.evaluate(({ BrowserWindow }) => {
      const petWindow = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Pi DeepSeek Pet');
      return petWindow ? { bounds: petWindow.getBounds(), alwaysOnTop: petWindow.isAlwaysOnTop() } : undefined;
    });
    expect(windowOptions?.alwaysOnTop).toBe(true);
    expect(windowOptions?.bounds.width).toBeGreaterThanOrEqual(460);
    expect(windowOptions?.bounds.width).toBeLessThanOrEqual(466);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

    await expect
      .poll(async () =>
        readFile(bridgeFile, 'utf8')
          .then(() => true)
          .catch(() => false),
      )
      .toBe(true);
    const descriptor = JSON.parse(await readFile(bridgeFile, 'utf8')) as BridgeDescriptor;
    const response = await fetch(`${descriptor.baseUrl}/api/v1/pet/actions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'bubble', text: 'E2E 测试', durationMs: 2_000 }),
    });
    expect(response.status).toBe(202);
    await expect(page.getByText('E2E 测试')).toBeVisible();

    await page.evaluate(() => {
      window.piPet.beginWindowDrag(200, 200);
      window.piPet.dragWindow(160, 230);
      window.piPet.endWindowDrag();
    });
    const settingsFile = resolve(temporaryDirectory, 'config.json');
    await expect
      .poll(async () => {
        try {
          const settings = JSON.parse(await readFile(settingsFile, 'utf8')) as { position: unknown };
          return settings.position !== null;
        } catch {
          return false;
        }
      })
      .toBe(true);
    const movedBounds = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle() === 'Pi DeepSeek Pet')
        ?.getBounds(),
    );
    expect(movedBounds?.x).not.toBe(windowOptions?.bounds.x);

    // 回归：斜向拖动不得改变窗口尺寸（Windows 150% 缩放下 setPosition 曾导致高度逐次 +1px 变大）
    await page.evaluate(() => {
      window.piPet.beginWindowDrag(400, 400);
      for (let i = 1; i <= 30; i++) window.piPet.dragWindow(400 - i * 8, 400 - i * 3);
      window.piPet.endWindowDrag();
    });
    const draggedBounds = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle() === 'Pi DeepSeek Pet')
        ?.getBounds(),
    );
    expect(draggedBounds?.width).toBe(movedBounds?.width);
    expect(draggedBounds?.height).toBe(movedBounds?.height);

    // 回归：尺寸调整必须双向生效（resizable:false 下 setSize 曾被 Windows 最小尺寸钤制拒绝）
    await page.evaluate(() => window.piPet.updateSettings({ size: 320 }));
    await expect
      .poll(async () => {
        const bounds = await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.getTitle() === 'Pi DeepSeek Pet')
            ?.getBounds(),
        );
        return bounds?.width;
      })
      .toBe(320);
    await page.evaluate(() => window.piPet.updateSettings({ size: 462 }));
    await expect
      .poll(async () => {
        const bounds = await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.getTitle() === 'Pi DeepSeek Pet')
            ?.getBounds(),
        );
        return bounds?.width;
      })
      .toBe(462);

    const resetResponse = await fetch(`${descriptor.baseUrl}/api/v1/pet/actions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'reset-position' }),
    });
    expect(resetResponse.status).toBe(202);
    await expect
      .poll(async () => {
        const settings = JSON.parse(await readFile(settingsFile, 'utf8')) as { position: unknown };
        return settings.position;
      })
      .toBeNull();
    const resetBounds = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle() === 'Pi DeepSeek Pet')
        ?.getBounds(),
    );
    expect(resetBounds?.x).toBe(windowOptions?.bounds.x);
    expect(resetBounds?.y).toBe(windowOptions?.bounds.y);
    expect(resetBounds?.width).toBe(462);
    expect(resetBounds?.height).toBe(260);
  } finally {
    await electronApp.close();
    await expect
      .poll(async () =>
        readFile(bridgeFile, 'utf8')
          .then(() => true)
          .catch(() => false),
      )
      .toBe(false);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
