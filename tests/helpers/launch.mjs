// Launches Playwright's Chromium with the extension in src/ loaded.
// Branded Chrome ignores --load-extension, so this must use the 'chromium' channel.

import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_DIR = fileURLToPath(new URL('../../src', import.meta.url));

export async function launchWithExtension({ headless = true, locale = 'en-US', colorScheme = 'light', extension = true } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'tubetoggles-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    locale,
    colorScheme,
    viewport: { width: 1280, height: 800 },
    args: [
      ...(extension ? [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`] : []),
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  let worker = null;
  let extensionId = null;
  if (extension) {
    [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    extensionId = new URL(worker.url()).host;
  }

  const close = async () => {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  };

  return { context, worker, extensionId, close };
}

// Opens a YouTube URL, gets past the cookie-consent page if one appears,
// and waits until the player exists and any pre-roll ad has finished.
export async function openYouTube(context, url, { adTimeoutMs = 90_000 } = {}) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (page.url().includes('consent.')) {
    await page.getByRole('button', { name: /reject all|accept all/i }).first().click();
    await page.waitForURL(/youtube\.com\/(watch|shorts)/);
  }

  await page.waitForSelector('#movie_player', { timeout: 30_000 });

  const deadline = Date.now() + adTimeoutMs;
  while (Date.now() < deadline) {
    const adShowing = await page.evaluate(() =>
      !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'));
    if (!adShowing) break;
    const skip = page.locator('.ytp-skip-ad-button, .ytp-ad-skip-button-modern');
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  return page;
}
