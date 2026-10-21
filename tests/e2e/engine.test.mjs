// End-to-end checks of the engine against live YouTube, with the extension
// from src/ loaded in Playwright's Chromium.
//
//   npm test
//
// Needs a network connection. Each group launches its own browser profile.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithExtension, openYouTube } from '../helpers/launch.mjs';

const MULTI_AUDIO = '0e3GPea1Tyg'; // MrBeast: original English plus many dubs; no annotations row
const CLASSIC = 'dQw4w9WgXcQ';     // Rick Astley: has the Annotations row, up to 4K, no 8K

const watch = (id) => `https://www.youtube.com/watch?v=${id}`;
const setSettings = (worker, values) => worker.evaluate((v) => chrome.storage.sync.set(v), values);
const getSettings = (worker) => worker.evaluate(() => chrome.storage.sync.get(null));

// The install step writes defaults asynchronously; a test that saves settings
// before it finishes would have them overwritten.
async function launchReady(options) {
  const browser = await launchWithExtension(options);
  for (let i = 0; i < 50 && !('audioTrack' in await getSettings(browser.worker)); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return browser;
}

const playerState = (page) => page.evaluate(() => {
  const p = document.getElementById('movie_player');
  const track = p.getAudioTrack?.();
  const info = track && Object.values(track).find((v) => v && typeof v === 'object' && 'isAutoDubbed' in v);
  // The id's "acont" marker says original or dubbed in any language.
  const content = (() => { try { return atob(track.id.split(';')[1].replace(/-/g, '+').replace(/_/g, '/')).match(/acont..([a-z-]+)/s)?.[1]; } catch { return null; } })();
  const menu = p.querySelector('.ytp-settings-menu');
  return {
    drc: Number(p.getDrcUserPreference?.()) === 1,
    voiceBoost: Number(p.getVoiceBoostUserPreference?.()) === 2,
    qualityPref: p.getUserPlaybackQualityPreference?.(),
    available: p.getAvailableQualityLevels?.(),
    audioIsOriginal: content ? content === 'original' : null,
    audioName: info?.name ?? null,
    theater: document.querySelector('ytd-watch-flexy')?.hasAttribute('theater') ?? false,
    // Open and visible: the engine's own passes keep the menu invisible.
    menuOpen: Boolean(menu) && getComputedStyle(menu).display !== 'none' && !p.classList.contains('tubetoggles-hidden-menu'),
  };
});

// Opens the gear menu as the user would, reads the checkbox rows, closes it.
async function readMenuRows(page) {
  await page.hover('#movie_player');
  await page.click('.ytp-settings-button');
  await page.waitForTimeout(600);
  const rows = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.ytp-settings-menu .ytp-panel-menu > .ytp-menuitem[role="menuitemcheckbox"]')].map((row) => [
      row.querySelector('.ytp-menuitem-icon path')?.getAttribute('d').slice(0, 12),
      row.getAttribute('aria-checked') === 'true',
    ])));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return rows;
}

const ICON = { annotations: 'M9.65 6.00L9', ambient: 'M12 .5C11.73', stableVolume: 'M12 .99C5.92', voiceBoost: 'M11.48 2.14 ' };

async function eventually(check, { timeoutMs = 20_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

describe('English browser, dark theme', () => {
  let browser;
  before(async () => { browser = await launchReady({ colorScheme: 'dark' }); });
  after(async () => { await browser?.close(); });

  test('a fresh install stores the defaults', async () => {
    const stored = await eventually(async () => {
      const s = await getSettings(browser.worker);
      return { ok: 'audioTrack' in s, s };
    });
    assert.deepEqual(stored.s, {
      extensionEnabled: true, stableVolume: true, voiceBoost: false, audioTrack: 'original',
      quality: 'auto', ambientMode: true, theaterMode: false, annotations: true,
    });
  });

  test('stable volume, voice boost, quality and theater mode are applied through the API', async () => {
    await setSettings(browser.worker, { stableVolume: false, voiceBoost: true, quality: 'hd720', theaterMode: true });
    const page = await openYouTube(browser.context, watch(MULTI_AUDIO));
    const result = await eventually(async () => {
      const s = await playerState(page);
      return { ok: s.voiceBoost && s.qualityPref === 'hd720' && s.theater, s };
    });
    assert.ok(result.ok, JSON.stringify(result.s));
    // The menu shows what the player actually does, not just the stored
    // preference. With voice boost on, YouTube shows stable volume as off.
    const rows = await readMenuRows(page);
    assert.equal(rows[ICON.stableVolume], false, JSON.stringify(rows));
    assert.equal(rows[ICON.voiceBoost], true, JSON.stringify(rows));
    await page.close();
  });

  test('an unavailable quality falls back to the next lower one', async () => {
    await setSettings(browser.worker, { quality: 'highres' });
    const page = await openYouTube(browser.context, watch(CLASSIC));
    const result = await eventually(async () => {
      const s = await playerState(page);
      const top = (s.available ?? []).find((q) => q !== 'auto');
      return { ok: Boolean(top) && !(s.available ?? []).includes('highres') && s.qualityPref === top, s };
    });
    assert.ok(result.ok, JSON.stringify(result.s));
    await page.close();
  });

  test('annotations and ambient mode are set through the hidden menu, which ends closed', async () => {
    await setSettings(browser.worker, { quality: 'auto', annotations: false, ambientMode: false, theaterMode: true });
    const page = await openYouTube(browser.context, watch(CLASSIC));
    await page.waitForTimeout(9000); // ambient mode's row can appear a few seconds in
    assert.equal((await playerState(page)).menuOpen, false, 'menu left open');
    const rows = await readMenuRows(page);
    assert.equal(rows[ICON.annotations], false, `annotations row: ${JSON.stringify(rows)}`);
    assert.equal(rows[ICON.ambient], false, `ambient row: ${JSON.stringify(rows)}`);
    await page.close();
  });

  test("the user's open menu is never closed by the extension", async () => {
    await setSettings(browser.worker, { annotations: true });
    const page = await openYouTube(browser.context, watch(CLASSIC));
    await page.waitForTimeout(2000);
    await page.hover('#movie_player');
    await page.click('.ytp-settings-button');
    await page.waitForTimeout(5000);
    assert.equal((await playerState(page)).menuOpen, true);
    await page.keyboard.press('Escape');
    await page.close();
  });

  test("the user's change in the menu is saved and not reverted", async () => {
    await setSettings(browser.worker, { stableVolume: true, voiceBoost: false });
    const page = await openYouTube(browser.context, watch(MULTI_AUDIO));
    await eventually(async () => ({ ok: (await playerState(page)).drc === true }));
    // Turned back on after the previous test turned it off: once the engine's
    // check has run, the menu must agree.
    await page.waitForTimeout(6000);
    assert.equal((await readMenuRows(page))[ICON.stableVolume], true, 'stable volume row not on');

    await page.hover('#movie_player');
    await page.click('.ytp-settings-button');
    await page.waitForTimeout(600);
    await page.click('.ytp-settings-menu .ytp-drc-menu-item');
    await page.keyboard.press('Escape');

    const saved = await eventually(async () => {
      const s = await getSettings(browser.worker);
      return { ok: s.stableVolume === false, s };
    });
    assert.ok(saved.ok, JSON.stringify(saved.s));
    await page.waitForTimeout(4000);
    assert.equal((await playerState(page)).drc, false, 'reverted after saving');
    assert.match(await page.textContent('.tubetoggles-toast'), /Stable volume off/);
    await page.close();
  });

  test("the user's quality and audio track picks are saved and kept", async () => {
    await setSettings(browser.worker, { quality: 'hd720', audioTrack: 'original' });
    const page = await openYouTube(browser.context, watch(MULTI_AUDIO));
    await eventually(async () => ({ ok: (await playerState(page)).qualityPref === 'hd720' }));
    await page.waitForTimeout(3000);

    const pick = async (rowText, optionText) => {
      await page.hover('#movie_player');
      await page.click('.ytp-settings-button');
      await page.waitForTimeout(500);
      await page.locator('.ytp-settings-menu .ytp-menuitem', { hasText: rowText }).first().click();
      await page.waitForTimeout(500);
      await page.locator('.ytp-settings-menu .ytp-menuitem', { hasText: optionText }).first().click();
      await page.waitForTimeout(800);
      if ((await playerState(page)).menuOpen) await page.keyboard.press('Escape');
    };
    await pick('Quality', '480p');
    await pick('Audio track', 'Spanish');

    const saved = await eventually(async () => {
      const s = await getSettings(browser.worker);
      return { ok: s.quality === 'large' && s.audioTrack === 'es', s };
    });
    assert.ok(saved.ok, JSON.stringify(saved.s));
    await page.waitForTimeout(4000);
    const state = await playerState(page);
    assert.equal(state.qualityPref, 'large', 'quality reverted');
    assert.match(state.audioName ?? '', /Spanish/, 'audio track reverted');
    await page.close();
  });

  test('Auto quality hands quality back to YouTube', async () => {
    await setSettings(browser.worker, { quality: 'hd720', audioTrack: 'original' });
    const page = await openYouTube(browser.context, watch(CLASSIC));
    await eventually(async () => ({ ok: (await playerState(page)).qualityPref === 'hd720' }));
    await setSettings(browser.worker, { quality: 'auto' });
    const result = await eventually(async () => {
      const s = await playerState(page);
      return { ok: s.qualityPref === 'auto', s };
    });
    assert.ok(result.ok, JSON.stringify(result.s));
    await page.close();
  });

  test('pressing T to leave theater mode is saved', async () => {
    await setSettings(browser.worker, { theaterMode: true });
    const page = await openYouTube(browser.context, watch(CLASSIC));
    await eventually(async () => ({ ok: (await playerState(page)).theater === true }));
    await page.click('#movie_player video');
    await page.keyboard.press('t');
    const saved = await eventually(async () => {
      const s = await getSettings(browser.worker);
      return { ok: s.theaterMode === false, s };
    });
    assert.ok(saved.ok, JSON.stringify(saved.s));
    await page.waitForTimeout(3000);
    assert.equal((await playerState(page)).theater, false, 'reverted after saving');
    await page.close();
  });

  test('turning the extension off stops all changes', async () => {
    await setSettings(browser.worker, { extensionEnabled: false, theaterMode: true });
    const page = await openYouTube(browser.context, watch(CLASSIC));
    await page.waitForTimeout(5000);
    assert.equal((await playerState(page)).theater, false);
    await setSettings(browser.worker, { extensionEnabled: true });
    await page.close();
  });

  test('the popup lists every setting and saves a choice', async () => {
    await setSettings(browser.worker, { stableVolume: true, voiceBoost: false });
    const page = await browser.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${browser.extensionId}/popup.html`);
    assert.equal(await page.locator('select').count(), 7);
    // Every setting always has a value: no "leave it to YouTube" choice.
    assert.equal(await page.locator('option', { hasText: /change/i }).count(), 0);
    await page.selectOption('#setting-quality', 'hd1080');
    // Like YouTube, voice boost on means stable volume off.
    await page.selectOption('#setting-voiceBoost', 'on');
    const saved = await eventually(async () => {
      const s = await getSettings(browser.worker);
      return { ok: s.quality === 'hd1080' && s.voiceBoost === true && s.stableVolume === false, s };
    });
    assert.ok(saved.ok, JSON.stringify(saved.s));
    assert.equal(await page.inputValue('#setting-stableVolume'), 'off');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('with voice boost on, stable volume is left alone instead of fought over', async () => {
    await setSettings(browser.worker, { voiceBoost: true, stableVolume: false, quality: 'auto' });
    const page = await openYouTube(browser.context, watch(MULTI_AUDIO));
    await eventually(async () => ({ ok: (await playerState(page)).voiceBoost }));
    // Stored directly, bypassing the popup's rule, to check the engine copes.
    await setSettings(browser.worker, { stableVolume: true });
    await page.waitForTimeout(6000);
    // An earlier test picked Spanish, which YouTube remembers and marks as the
    // default track; Original must still mean the original.
    assert.equal((await playerState(page)).audioIsOriginal, true, 'not the original audio');
    const rows = await readMenuRows(page);
    assert.equal(rows[ICON.voiceBoost], true, JSON.stringify(rows));
    assert.equal(rows[ICON.stableVolume], false, JSON.stringify(rows));
    await page.close();
  });
});

describe('Hindi browser', () => {
  let browser;
  before(async () => { browser = await launchReady({ locale: 'hi-IN' }); });
  after(async () => { await browser?.close(); });

  test('the original audio track replaces the Hindi dub YouTube picks', async () => {
    const page = await openYouTube(browser.context, watch(MULTI_AUDIO));
    const result = await eventually(async () => {
      const s = await playerState(page);
      return { ok: s.audioIsOriginal === true, s };
    });
    assert.ok(result.ok, JSON.stringify(result.s));
    await page.close();
  });
});

describe('German browser', () => {
  let browser;
  before(async () => { browser = await launchReady({ locale: 'de-DE' }); });
  after(async () => { await browser?.close(); });

  test('annotations are found and turned off despite the translated label', async () => {
    await setSettings(browser.worker, { annotations: false });
    const page = await openYouTube(browser.context, watch(CLASSIC));
    await page.waitForTimeout(6000);
    const rows = await readMenuRows(page);
    assert.equal(rows[ICON.annotations], false, JSON.stringify(rows));
    await page.close();
  });
});
