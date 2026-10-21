// Research probe: checks that the player API setters actually change each
// setting, in dark theme (ambient mode can appear late), and which menu rows
// show up on different videos. Runs WITHOUT the extension.
//
//   node tests/research/probe-actions.mjs

import { launchWithExtension, openYouTube } from '../helpers/launch.mjs';

const VIDEOS = ['0e3GPea1Tyg', 'dQw4w9WgXcQ', 'jNQXAC9IVRw'];
const log = (label, value) => console.log(`${label}:`, typeof value === 'string' ? value : JSON.stringify(value));

const { context, close } = await launchWithExtension({ extension: false, colorScheme: 'dark' });

async function menuRows(page) {
  await page.hover('#movie_player');
  await page.click('.ytp-settings-button');
  await page.waitForTimeout(700);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.ytp-settings-menu .ytp-panel-menu > .ytp-menuitem')].map((i) => ({
      label: i.querySelector('.ytp-menuitem-label')?.textContent.trim(),
      checked: i.getAttribute('aria-checked'),
      content: i.querySelector('.ytp-menuitem-content')?.textContent.trim() || undefined,
      cls: i.className.replace('ytp-menuitem', '').trim() || undefined,
    })));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return rows;
}

const state = (page) => page.evaluate(() => {
  const p = document.getElementById('movie_player');
  const flexy = document.querySelector('ytd-watch-flexy');
  const track = p.getAudioTrack?.();
  const info = track && Object.values(track).find((v) => v && typeof v === 'object' && 'isAutoDubbed' in v);
  return {
    drcPref: p.getDrcUserPreference?.(), drcState: p.getDrcState?.(), hasDrc: p.hasDrcAudioTrack?.(),
    voicePref: p.getVoiceBoostUserPreference?.(), voiceState: p.getVoiceBoostState?.(),
    quality: p.getPlaybackQuality?.(), qualityPref: p.getUserPlaybackQualityPreference?.(),
    audio: info?.name, theater: flexy?.hasAttribute('theater'),
    cinematics: !!document.querySelector('#cinematics canvas, #cinematics-container canvas'),
    wideCookie: document.cookie.includes('wide=1'),
  };
});

try {
  const page = await openYouTube(context, `https://www.youtube.com/watch?v=${VIDEOS[0]}`);
  await page.waitForTimeout(3000);

  log('dark-theme menu', await menuRows(page));
  log('initial', await state(page));

  // Stable volume (DRC) and voice boost through their setters.
  await page.evaluate(() => {
    const p = document.getElementById('movie_player');
    p.setDrcUserPreference(!p.getDrcUserPreference());
    p.setVoiceBoostUserPreference(!p.getVoiceBoostUserPreference());
  });
  await page.waitForTimeout(1000);
  log('after flipping drc + voice via API', await state(page));
  log('menu after flip', (await menuRows(page)).filter((r) => r.checked !== null));

  // Audio track: switch to a dub, then back to the original.
  const audio = await page.evaluate(async () => {
    const p = document.getElementById('movie_player');
    const infoOf = (t) => Object.values(t).find((v) => v && typeof v === 'object' && 'isAutoDubbed' in v);
    const tracks = p.getAvailableAudioTracks();
    const original = tracks.find((t) => infoOf(t)?.isDefault);
    const dub = tracks.find((t) => !infoOf(t)?.isDefault);
    const r1 = p.setAudioTrack(dub);
    await new Promise((r) => setTimeout(r, 2500));
    const afterDub = infoOf(p.getAudioTrack())?.name;
    const r2 = p.setAudioTrack(original);
    await new Promise((r) => setTimeout(r, 2500));
    return { count: tracks.length, sample: tracks.slice(0, 3).map((t) => infoOf(t)), r1, afterDub, r2, afterOriginal: infoOf(p.getAudioTrack())?.name };
  });
  log('audio track switching', audio);

  // Quality: pin to 720p.
  await page.evaluate(() => document.getElementById('movie_player').setPlaybackQualityRange('hd720', 'hd720'));
  await page.waitForTimeout(5000);
  log('after setPlaybackQualityRange(hd720)', await state(page));

  // Theater mode: what the size button changes.
  await page.hover('#movie_player');
  await page.click('.ytp-size-button');
  await page.waitForTimeout(1500);
  log('after size-button click', await state(page));

  // Ambient mode: find its row's class, toggle it, and see what changes.
  const before = await page.evaluate(() => Object.keys(localStorage));
  const rows = await menuRows(page);
  const ambient = rows.find((r) => /ambient/i.test(r.label ?? ''));
  log('ambient row', ambient ?? '(not in menu)');
  if (ambient) {
    await page.hover('#movie_player');
    await page.click('.ytp-settings-button');
    await page.waitForTimeout(600);
    await page.locator('.ytp-settings-menu .ytp-menuitem', { hasText: ambient.label }).click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => Object.keys(localStorage));
    log('ambient toggled; new localStorage keys', after.filter((k) => !before.includes(k)));
    log('state after ambient toggle', await state(page));
  }
  log('updateCinematicSettings source', await page.evaluate(() =>
    document.getElementById('movie_player').updateCinematicSettings?.toString().slice(0, 400)));

  // Do settings survive a full load of a different video?
  const page2 = await openYouTube(context, `https://www.youtube.com/watch?v=${VIDEOS[1]}`);
  await page2.waitForTimeout(3000);
  log('next video (persistence)', await state(page2));
  log(`menu on ${VIDEOS[1]}`, await menuRows(page2));

  const page3 = await openYouTube(context, `https://www.youtube.com/watch?v=${VIDEOS[2]}`);
  await page3.waitForTimeout(3000);
  log(`menu on ${VIDEOS[2]}`, await menuRows(page3));
} finally {
  await close();
}
