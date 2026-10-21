// Research probe: records what YouTube's player exposes today, so the engine
// can be built on what actually exists. Re-run it when YouTube changes things.
//
//   node tests/research/probe-player.mjs [videoId] [hl] [browserLocale] [waitMs]
//
// Runs WITHOUT the extension so nothing interferes. Writes JSON to stdout.

import { launchWithExtension, openYouTube } from '../helpers/launch.mjs';

const videoId = process.argv[2] || '0e3GPea1Tyg'; // MrBeast: many dubbed audio tracks
const hl = process.argv[3] || 'en';
const locale = process.argv[4] || 'en-US';
const waitMs = Number(process.argv[5] || 3000);

const { context, close } = await launchWithExtension({ extension: false, colorScheme: 'dark', locale });

try {
  const page = await openYouTube(context, `https://www.youtube.com/watch?v=${videoId}&hl=${hl}`);
  await page.waitForTimeout(waitMs);

  const api = await page.evaluate(() => {
    const p = document.getElementById('movie_player');
    const plain = document.createElement('div');

    // Methods the player adds on top of a normal element.
    const methods = [];
    for (const k in p) {
      try { if (typeof p[k] === 'function' && !(k in plain)) methods.push(k); } catch {}
    }

    // Shallow, cycle-safe snapshot of an object.
    const snap = (o, depth = 2) => {
      if (o === null || typeof o !== 'object') return o;
      if (depth === 0) return '[object]';
      const out = {};
      for (const k of Object.keys(o).slice(0, 40)) {
        const v = o[k];
        if (typeof v === 'function') continue;
        out[k] = snap(v, depth - 1);
      }
      return out;
    };
    const call = (name, ...args) => {
      try { return typeof p[name] === 'function' ? snap(p[name](...args)) : '(missing)'; }
      catch (e) { return `(threw: ${e.message})`; }
    };

    const response = p.getPlayerResponse?.();
    const audioTracksFromFormats = [];
    const seen = new Set();
    for (const f of response?.streamingData?.adaptiveFormats ?? []) {
      if (f.audioTrack && !seen.has(f.audioTrack.id)) {
        seen.add(f.audioTrack.id);
        audioTracksFromFormats.push(f.audioTrack);
      }
    }

    const flexy = document.querySelector('ytd-watch-flexy');
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/yt-player|cinematic|ambient|volume|quality/i.test(k)) ls[k] = localStorage.getItem(k).slice(0, 300);
    }

    return {
      methods: methods.sort(),
      interestingMethods: methods.filter((m) =>
        /quality|audio|track|stable|voice|loud|cinematic|ambient|annotation|size|theat|option|drc/i.test(m)).sort(),
      quality: {
        available: call('getAvailableQualityLevels'),
        current: call('getPlaybackQuality'),
        label: call('getPlaybackQualityLabel'),
        data: call('getAvailableQualityData'),
      },
      audio: {
        available: call('getAvailableAudioTracks'),
        current: call('getAudioTrack'),
        fromFormats: audioTracksFromFormats,
      },
      options: call('getOptions'),
      watchFlexyAttrs: flexy ? [...flexy.attributes].map((a) => `${a.name}=${a.value.slice(0, 40)}`) : null,
      cookies: document.cookie.split('; ').filter((c) => /^(PREF|wide)=/.test(c)),
      localStorage: ls,
    };
  });

  // Open the gear menu and record every row: text, state, and icon shape.
  await page.hover('#movie_player');
  await page.click('.ytp-settings-button');
  await page.waitForTimeout(800);
  const menu = await page.evaluate(() =>
    [...document.querySelectorAll('.ytp-settings-menu .ytp-panel-menu > .ytp-menuitem')].map((item) => ({
      label: item.querySelector('.ytp-menuitem-label')?.textContent.trim(),
      content: item.querySelector('.ytp-menuitem-content')?.textContent.trim(),
      role: item.getAttribute('role'),
      ariaChecked: item.getAttribute('aria-checked'),
      hasPopup: item.getAttribute('aria-haspopup'),
      className: item.className,
      attrs: [...item.attributes].map((a) => a.name),
      iconPath: item.querySelector('.ytp-menuitem-icon path')?.getAttribute('d')?.slice(0, 120) ?? null,
    })));
  await page.keyboard.press('Escape');

  console.log(JSON.stringify({ videoId, hl, menu, ...api }, null, 2));
} finally {
  await close();
}
