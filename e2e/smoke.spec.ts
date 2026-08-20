import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';

/**
 * The post-deploy smoke test.
 *
 * The first assertion is the important one. If `_headers` does not reach the
 * publish directory the site still looks perfectly fine — it just encodes
 * several times slower, silently, and nobody notices. Everything else here
 * checks that the pipeline end to end is intact.
 */

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample.png', import.meta.url));

async function loadFixture(page: Page): Promise<void> {
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.locator('.empty-state')).not.toHaveClass(/is-visible/, { timeout: 60_000 });
}

async function selectFormat(page: Page, panel: number, format: string): Promise<void> {
  await page.locator('[data-testid="panel"]').nth(panel).locator('.format-select').selectOption(format);
}

/** Waits until the panel holds a full-resolution result, not just a preview. */
async function waitForFullResult(page: Page, panel: number): Promise<void> {
  const node = page.locator('[data-testid="panel"]').nth(panel);
  await expect(node).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
  await expect(node).toHaveAttribute('data-quality', 'full', { timeout: 120_000 });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw new Error(`Ошибка на странице: ${error.message}`);
  });
  await page.goto('/');
});

test('the page is cross-origin isolated', async ({ page }) => {
  await expect(page.locator('.brand-name')).toHaveText('Pixel Peep');
  const isolated = await page.evaluate(() => self.crossOriginIsolated);
  expect(isolated, 'COOP/COEP не доехали: кодирование будет в разы медленнее').toBe(true);
});

test('a fixture image loads and both panels appear', async ({ page }) => {
  await loadFixture(page);
  await expect(page.locator('[data-testid="panel"]')).toHaveCount(2);
  await waitForFullResult(page, 0);
  await expect(page.locator('[data-testid="panel"]').first().locator('[data-metric="size"]')).not.toHaveText('—');
});

test('the shell gives the stage the space that is left over', async ({ page }) => {
  // The panels are the whole product. A shell that hands the spare height to
  // the status bar instead still passes every metric assertion, so the shape of
  // the layout is checked explicitly.
  await loadFixture(page);
  const box = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return {
      viewport: window.innerHeight,
      stage: rect('.stage').height,
      panel: rect('.panel-view').height,
      status: rect('.statusbar').height,
    };
  });

  expect(box.stage).toBeGreaterThan(box.viewport * 0.6);
  expect(box.panel).toBeGreaterThan(box.viewport * 0.4);
  expect(box.status).toBeLessThan(60);
});

test('png gives PSNR = infinity, proving the pipeline is intact', async ({ page }) => {
  await loadFixture(page);
  await selectFormat(page, 1, 'png');
  await waitForFullResult(page, 1);
  await expect(page.locator('[data-testid="panel"]').nth(1).locator('[data-metric="psnr"]')).toHaveText('∞', {
    timeout: 120_000,
  });
});

test('webp and jxl encode to a real file with real metrics', async ({ page }) => {
  await loadFixture(page);

  for (const format of ['webp', 'jxl']) {
    await selectFormat(page, 1, format);
    await waitForFullResult(page, 1);

    const panel = page.locator('[data-testid="panel"]').nth(1);
    await expect(panel.locator('[data-metric="size"]')).toHaveText(/\d/, { timeout: 120_000 });
    await expect(panel.locator('[data-metric="ratio"]')).toHaveText(/%/, { timeout: 120_000 });

    const psnr = await panel.locator('[data-metric="psnr"]').innerText();
    expect(psnr, `${format}: PSNR не посчитан`).toMatch(/[\d∞]/);
  }
});

test('changing a parameter re-encodes without breaking the interface', async ({ page }) => {
  await loadFixture(page);
  await selectFormat(page, 1, 'jpeg');
  await waitForFullResult(page, 1);

  const panel = page.locator('[data-testid="panel"]').nth(1);
  const before = await panel.locator('[data-metric="size"]').innerText();

  const quality = panel.locator('input.param-slider').first();
  await quality.fill('20');
  await quality.dispatchEvent('change');
  await waitForFullResult(page, 1);

  const after = await panel.locator('[data-metric="size"]').innerText();
  expect(after).not.toBe(before);
});

test('1:1 really is one image pixel per device pixel', async ({ page }) => {
  // Without a backing store scaled by devicePixelRatio, "1:1" is a lie on a
  // retina screen — and it is the one claim this whole tool rests on.
  await loadFixture(page);
  await waitForFullResult(page, 0);
  await page.keyboard.press('1');

  const ratio = await page.evaluate(() => {
    const canvas = document.querySelector('.panel-canvas') as HTMLCanvasElement;
    return { backing: canvas.width, css: canvas.getBoundingClientRect().width, dpr: devicePixelRatio };
  });
  // One pixel of slack: the backing store is rounded to whole device pixels.
  expect(Math.abs(ratio.backing - ratio.css * ratio.dpr)).toBeLessThanOrEqual(1);
});

test('zoom to 1:1 and the flip test do not throw', async ({ page }) => {
  await loadFixture(page);
  await waitForFullResult(page, 0);

  await page.keyboard.press('1');
  await expect(page.locator('.zoom-value')).toHaveText('1:1');

  await page.keyboard.down('Space');
  await expect(page.locator('.app')).toHaveClass(/is-flipping/);
  await page.keyboard.up('Space');
  await expect(page.locator('.app')).not.toHaveClass(/is-flipping/);

  await page.keyboard.press('0');
  await expect(page.locator('.zoom-value')).not.toHaveText('1:1');
});
