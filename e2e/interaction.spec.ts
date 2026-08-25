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

test('a panel stays visibly busy until the full-size result lands', async ({ page }) => {
  // Reported: move the quality slider, no loader, and the size only settles
  // seconds later. The proxy pass was publishing itself as `ready`, so the
  // spinner went out and a preview byte count — three times off on a large
  // photo — sat there looking like the answer.
  await loadLargePhoto(page);

  const panel = page.locator('[data-testid="panel"]').nth(1);
  await expect(panel).toHaveAttribute('data-quality', 'full', { timeout: 120_000 });

  // Record every state the panel passes through, so nothing depends on catching
  // a moment.
  await panel.evaluate((el) => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const note = () => {
      const busy = el.querySelector('.panel-busy')!.classList.contains('is-visible');
      const state = `${el.getAttribute('data-status')}|${el.getAttribute('data-quality')}|${busy ? 'busy' : 'idle'}`;
      if (seen.at(-1) !== state) seen.push(state);
    };
    note();
    new MutationObserver(note).observe(el, { attributes: true, subtree: true, attributeFilter: ['data-status', 'data-quality', 'class'] });
  });

  await panel.locator('.format-select').selectOption('webp');
  await waitForFullResult(page, 1);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);

  // The preview must arrive while the panel still says it is working.
  expect(seen.some((s) => s.startsWith('encoding|proxy')), `states seen: ${seen.join(' → ')}`).toBe(true);
  // And it must never claim to be finished while showing one.
  expect(seen.filter((s) => s.startsWith('ready|proxy')), `states seen: ${seen.join(' → ')}`).toEqual([]);
  // Whenever it is working, the indicator is up.
  expect(seen.filter((s) => s.startsWith('encoding') && s.endsWith('idle')), `states seen: ${seen.join(' → ')}`).toEqual([]);
});

/**
 * A photo comfortably over `PROXY_MAX_PIXELS`, so the pipeline really runs a
 * proxy pass and then a full one, and the encode takes long enough to observe.
 */
async function loadLargePhoto(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2800;
    canvas.height = 1800;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#204080');
    gradient.addColorStop(1, '#e0b070');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 40)}%)`;
      ctx.fillRect((i * 97) % canvas.width, (i * 61) % canvas.height, 40, 40);
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    await window.pixelPeep.app.openFiles([new File([blob], 'big.png', { type: 'image/png' })]);
  });
}

/** Watches for the encoding card over the picture, however briefly it is up. */
async function watchForBusyCard(page: Page): Promise<void> {
  await page.locator('[data-testid="panel"]').nth(1).evaluate((el) => {
    const w = window as unknown as { sawCard: boolean };
    w.sawCard = false;
    const note = () => {
      const overlay = el.querySelector('.panel-overlay');
      if (overlay?.classList.contains('is-visible') && overlay.querySelector('.overlay-busy')) w.sawCard = true;
    };
    note();
    new MutationObserver(note).observe(el, { attributes: true, childList: true, subtree: true });
  });
}

test('the picture says it is encoding whether the format or a parameter changed', async ({ page }) => {
  // These two paths reported differently: changing the format cleared the
  // result and so raised the card, changing a parameter kept the result and
  // raised nothing over the picture at all.
  await loadLargePhoto(page);
  const panel = page.locator('[data-testid="panel"]').nth(1);
  await expect(panel).toHaveAttribute('data-quality', 'full', { timeout: 120_000 });

  await watchForBusyCard(page);
  await panel.locator('.format-select').selectOption('webp');
  await waitForFullResult(page, 1);
  expect(await page.evaluate(() => (window as unknown as { sawCard: boolean }).sawCard), 'format change').toBe(true);

  await watchForBusyCard(page);
  const quality = panel.locator('input.param-slider').first();
  await quality.fill('35');
  await quality.dispatchEvent('change');
  await waitForFullResult(page, 1);
  expect(await page.evaluate(() => (window as unknown as { sawCard: boolean }).sawCard), 'parameter change').toBe(true);
});

test('the encoding card keeps off the middle of the frame', async ({ page }) => {
  // Dragging a quality slider keeps a panel encoding continuously; a card in
  // the centre would sit on exactly the detail being judged.
  await loadLargePhoto(page);
  const panel = page.locator('[data-testid="panel"]').nth(1);
  await expect(panel).toHaveAttribute('data-quality', 'full', { timeout: 120_000 });

  const quality = panel.locator('input.param-slider').first();
  await quality.fill('35');
  await quality.dispatchEvent('change');

  const box = await panel.evaluate((el) => {
    const card = el.querySelector('.overlay-busy');
    if (!card) return null;
    const view = el.querySelector('.panel-view')!.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return { bottom: rect.bottom - view.top, height: view.height };
  });
  expect(box, 'the card was not up').not.toBeNull();
  expect(box!.bottom).toBeLessThan(box!.height / 3);
});

test('the PSNR hint actually appears, by pointer and by keyboard', async ({ page }) => {
  // The dotted underline and help cursor promised a hint that never arrived:
  // it was a native `title`, whose target was the 28 px word alone, which waits
  // about a second of motionless hover, is cancelled by any re-render of the
  // element, and does not exist on a touchscreen.
  await loadFixture(page);
  const panel = page.locator('[data-testid="panel"]').nth(1);
  const cell = panel.locator('.metric.has-tooltip');
  const tip = page.locator('#tooltip');

  await expect(tip).toBeHidden();
  await cell.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('correlates poorly');

  // The number is part of the target too, not just the label.
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  await panel.locator('[data-metric="psnr"]').hover();
  await expect(tip).toBeVisible();

  // Reachable without a pointer at all, and dismissable.
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  await cell.focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();

  // It stays on screen rather than hanging off the edge.
  await cell.hover();
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  // And it follows the language, being read at the moment it is shown.
  await page.mouse.move(0, 0);
  await page.locator('.segmented[aria-label="Language"] button', { hasText: 'RU' }).click();
  await cell.hover();
  await expect(tip).toContainText('плохо коррелирует');
});

test('a magnified preview says its pixels are interpolated', async ({ page }) => {
  // Reported: at 7:1 the original showed hard pixels and a lossless WebP beside
  // it looked smeared, with PSNR reading ∞. Both were true — the panel was
  // showing a proxy-resolution preview, magnified and therefore interpolated —
  // but nothing on screen said so, and it read as a codec artefact.
  await loadLargePhoto(page);
  const panel = page.locator('[data-testid="panel"]').nth(1);
  await expect(panel).toHaveAttribute('data-quality', 'full', { timeout: 120_000 });

  await page.locator('.zoom-presets .button', { hasText: '1:1' }).click();

  // Record what the panel showed throughout, so nothing depends on timing.
  await panel.evaluate((el) => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const note = () => {
      const shown = el.querySelector('.panel-interpolated')!.classList.contains('is-visible');
      const state = `${el.getAttribute('data-quality')}|${shown ? 'note' : 'no-note'}`;
      if (seen.at(-1) !== state) seen.push(state);
    };
    note();
    new MutationObserver(note).observe(el, { attributes: true, subtree: true, attributeFilter: ['data-quality', 'class'] });
  });

  await panel.locator('.format-select').selectOption('webp');
  await panel.locator('input[type="checkbox"]').first().check();
  await waitForFullResult(page, 1);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);

  expect(seen.some((s) => s === 'proxy|note'), `states: ${seen.join(' → ')}`).toBe(true);
  // Once the real pixels arrive the note has nothing to say.
  expect(seen.at(-1), `states: ${seen.join(' → ')}`).toBe('full|no-note');
  // And a panel drawing the real frame never claims to be interpolating.
  await expect(page.locator('[data-testid="panel"]').nth(0).locator('.panel-interpolated')).toBeHidden();
});
