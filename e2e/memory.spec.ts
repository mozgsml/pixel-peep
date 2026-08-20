import { expect, test } from '@playwright/test';

/**
 * Memory regression: a big photo plus many format switches must not leave the
 * heap growing. Two 24 Mpx results and their buffers already sit near the
 * ceiling of mobile Safari, so a leak here is not a slow degradation — it is a
 * crash on the device that matters most.
 */

const MEGAPIXEL_IMAGE = { width: 4000, height: 3000 };
const SWITCHES = 30;
/** Generous: a real leak from 30 rounds of 12 Mpx buffers is hundreds of MB. */
const MAX_GROWTH_MB = 150;

declare global {
  interface Window {
    pixelPeep: { app: { openFiles(files: File[]): Promise<void> } };
  }
}

test('30 format switches on a 12 Mpx photo do not grow the heap', async ({ page }) => {
  test.slow();
  await page.goto('/');

  const cdp = await page.context().newCDPSession(page);
  const heapMb = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'performance.memory.usedJSHeapSize',
      returnByValue: true,
    });
    return Number(result.value) / (1024 * 1024);
  };

  await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#204080');
    gradient.addColorStop(1, '#e0b070');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 40)}%)`;
      ctx.fillRect((i * 97) % width, (i * 61) % height, 40, 40);
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    await window.pixelPeep.app.openFiles([new File([blob], 'big.png', { type: 'image/png' })]);
  }, MEGAPIXEL_IMAGE);

  const panel = page.locator('[data-testid="panel"]').nth(1);
  await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });

  const before = await heapMb();

  for (let i = 0; i < SWITCHES; i++) {
    // Alternate formats and vary quality so nothing is served from the cache.
    const format = i % 2 === 0 ? 'jpeg' : 'webp';
    await panel.locator('.format-select').selectOption(format);
    const quality = panel.locator('input.param-slider').first();
    await quality.fill(String(40 + (i % 45)));
    await quality.dispatchEvent('change');
    await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
  }

  const after = await heapMb();
  const growth = after - before;
  // eslint-disable-next-line no-console
  console.log(`heap: ${before.toFixed(1)} MB → ${after.toFixed(1)} MB (+${growth.toFixed(1)})`);
  expect(growth, `heap выросла на ${growth.toFixed(1)} МБ за ${SWITCHES} переключений`).toBeLessThan(
    MAX_GROWTH_MB,
  );
});
