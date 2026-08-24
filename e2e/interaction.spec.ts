import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';

/**
 * Behaviour that only exists once a pointer is involved. Every case here is a
 * bug that shipped: a divider that ran away from the cursor, a frame that
 * could not be nudged, a slider that re-encoded with nothing on screen saying
 * so.
 */

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample.png', import.meta.url));

async function loadFixture(page: Page): Promise<void> {
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.locator('.empty-state')).not.toHaveClass(/is-visible/, { timeout: 60_000 });
}

async function waitForFullResult(page: Page, panel: number): Promise<void> {
  const node = page.locator('[data-testid="panel"]').nth(panel);
  await expect(node).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
  await expect(node).toHaveAttribute('data-quality', 'full', { timeout: 120_000 });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw new Error(`Page error: ${error.message}`);
  });
  await page.goto('/');
});

test('the divider lands where the pointer left it', async ({ page }) => {
  await loadFixture(page);
  const splitter = page.locator('.splitter');
  const before = (await splitter.boundingBox())!;

  const target = before.x + 160;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  // Several steps: the runaway only showed up once more than one move landed.
  await page.mouse.move(before.x + 60, before.y + before.height / 2, { steps: 5 });
  await page.mouse.move(target, before.y + before.height / 2, { steps: 5 });
  await page.mouse.up();

  const after = (await splitter.boundingBox())!;
  // Within a couple of pixels of the pointer, not three times the distance.
  expect(Math.abs(after.x + after.width / 2 - target)).toBeLessThan(4);
});

test('double clicking the divider restores an even split', async ({ page }) => {
  await loadFixture(page);
  const splitter = page.locator('.splitter');
  const start = (await splitter.boundingBox())!;

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y + start.height / 2, { steps: 5 });
  await page.mouse.up();
  await splitter.dblclick();

  const after = (await splitter.boundingBox())!;
  expect(Math.abs(after.x - start.x)).toBeLessThan(4);
});

test('a frame smaller than the panel can still be dragged', async ({ page }) => {
  await loadFixture(page);
  await waitForFullResult(page, 0);
  // Zoom out until the image is smaller than its panel.
  await page.keyboard.press('0');

  const centre = async () =>
    page.evaluate(
      () => (window as unknown as { pixelPeep: { app: { viewport: { view: { u: number } } } } }).pixelPeep.app.viewport.view.u,
    );
  const view = page.locator('.panel-view').first();
  const box = (await view.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  expect(await centre()).not.toBe(0.5);
});

test('dragging a slider says that it is re-encoding', async ({ page }) => {
  await loadFixture(page);
  const panel = page.locator('[data-testid="panel"]').nth(1);
  await panel.locator('.format-select').selectOption('jpeg');
  await waitForFullResult(page, 1);

  const quality = panel.locator('input.param-slider').first();
  await quality.fill('35');
  // The indicator has to be up during the debounce, not only once work starts.
  await expect(panel.locator('.panel-busy')).toHaveClass(/is-visible/, { timeout: 5_000 });
  await quality.dispatchEvent('change');
  await waitForFullResult(page, 1);
  await expect(panel.locator('.panel-busy')).not.toHaveClass(/is-visible/);
});

test('the encoded result can be saved', async ({ page }) => {
  await loadFixture(page);
  const panel = page.locator('[data-testid="panel"]').nth(1);
  await panel.locator('.format-select').selectOption('webp');
  await waitForFullResult(page, 1);

  const download = page.waitForEvent('download');
  await panel.locator('.panel-download').click();
  expect((await download).suggestedFilename()).toMatch(/\.webp$/);
});

test('switching language rewrites the interface and survives a reload', async ({ page }) => {
  const fit = page.locator('.zoom-presets .button').first();
  await expect(fit).toHaveText('Fit');

  await page.locator('.segmented[aria-label="Language"] button', { hasText: 'RU' }).click();
  await expect(fit).toHaveText('Вписать');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');

  await page.reload();
  await expect(page.locator('.zoom-presets .button').first()).toHaveText('Вписать');
});

test('alignment only appears when the frames differ in size', async ({ page }) => {
  await loadFixture(page);
  const align = page.locator('.toolbar-group', { has: page.locator('.segmented[aria-label*="lignment"]') });
  await expect(align).toHaveClass(/is-hidden/);
});

test('a codec chunk lost to the network recovers without a reload', async ({ page }) => {
  // Reported from production: choosing PNG died with "Failed to fetch
  // dynamically imported module". The request had simply been dropped — but
  // the panel then stayed broken for good, because a rejected dynamic import
  // is cached in the worker's module map and "Retry" issued no request at all.
  let dropped = 0;
  const attempts: string[] = [];
  await page.route(/optimise-.*\.js/, (route) => {
    attempts.push(dropped === 0 ? 'dropped' : 'served');
    if (dropped === 0) {
      dropped++;
      return route.abort('failed');
    }
    return route.continue();
  });

  await loadFixture(page);
  await page.locator('[data-testid="panel"]').nth(1).locator('.format-select').selectOption('png');
  await waitForFullResult(page, 1);

  expect(attempts, 'the chunk should have been fetched a second time').toEqual(['dropped', 'served']);
  await expect(page.locator('[data-testid="panel"]').nth(1).locator('[data-metric="psnr"]')).toHaveText('∞');
});

test('a codec that never arrives blames the network, not the file', async ({ page }) => {
  await page.route(/optimise-.*\.js/, (route) => route.abort('failed'));
  await loadFixture(page);
  const panel = page.locator('[data-testid="panel"]').nth(1);
  await panel.locator('.format-select').selectOption('png');

  const overlay = panel.locator('.overlay-error');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('did not download');
  // The generic advice is wrong here: no parameter change would ever help.
  await expect(overlay).not.toContainText('Try different parameters');
});

test('switching to Continue lands on a view that shows something', async ({ page }) => {
  // Reported after the pan range was widened: the mode could now be dragged
  // into a useful position, but switching into it still landed on "whole frame
  // in panel 0, empty background in panel 1" — the one arrangement of the mode
  // that shows nothing at all.
  await loadFixture(page);
  await page.locator('.segment', { hasText: /^Continue$/ }).click();
  await page.waitForTimeout(300);

  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="panel"]')].map((panel) => {
      const canvas = panel.querySelector('canvas') as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      // Anything that is not the surround grey counts as picture.
      let painted = 0;
      for (let i = 0; i < pixels.length; i += 4 * 16) {
        if (Math.abs(pixels[i]! - 0x2e) > 6 || Math.abs(pixels[i + 2]! - 0x2e) > 6) painted++;
      }
      return painted;
    }),
  );

  for (const painted of drawn) expect(painted, 'a panel was left on empty background').toBeGreaterThan(0);
});
