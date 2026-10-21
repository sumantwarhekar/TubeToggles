// Renders the Chrome Web Store images from the real extension:
// five 1280x800 screenshots and the 440x280 small promo tile.
//
//   node store/render.mjs
//
// Captures YouTube (in its dark theme, playing Big Buck Bunny, which is
// openly licensed) and the popup with the extension from src/ loaded, then
// lays each capture out with a headline. Output goes to store/assets/.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { launchWithExtension, openYouTube } from '../tests/helpers/launch.mjs';

const OUT = fileURLToPath(new URL('./assets', import.meta.url));
const BUILD = fileURLToPath(new URL('./.build', import.meta.url));
mkdirSync(OUT, { recursive: true });
mkdirSync(BUILD, { recursive: true });

const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // Big Buck Bunny, Blender Foundation
const CREDIT = 'Big Buck Bunny © Blender Foundation, CC BY 3.0';
const FRAME_AT = Number(process.env.FRAME_AT ?? 45); // seconds into the film: the green cave

const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

const browser = await launchWithExtension({ colorScheme: 'dark' });
const { context, worker, extensionId } = browser;
const setSettings = (values) => worker.evaluate((v) => chrome.storage.sync.set(v), values);

try {
  for (let i = 0; i < 50 && !('audioTrack' in await worker.evaluate(() => chrome.storage.sync.get(null))); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  // YouTube's dark theme for a signed-out viewer.
  await context.addCookies([{ name: 'PREF', value: 'f6=400', domain: '.youtube.com', path: '/' }]);
  await setSettings({ theaterMode: true, quality: 'hd1080', ambientMode: true });

  // ---------------------------------------------------------
  // Captures from YouTube
  // ---------------------------------------------------------
  const page = await openYouTube(context, VIDEO);
  // Recommendations show other people's thumbnails; keep them out of the images.
  await page.addStyleTag({ content: '#secondary { visibility: hidden !important; }' });
  await page.waitForTimeout(6000); // let the extension apply theater mode and quality
  await page.evaluate((t) => {
    const p = document.getElementById('movie_player');
    p.seekTo(t, true);
    p.playVideo();
    window.scrollTo(0, 0);
  }, FRAME_AT);
  // Wait until the new position is actually playing, so the frame is fresh.
  await page.waitForFunction((t) => {
    const p = document.getElementById('movie_player');
    return p.getPlayerState() === 1 && p.getCurrentTime() > t + 1;
  }, FRAME_AT, { timeout: 30_000 });
  await page.mouse.move(640, 790);
  await page.waitForTimeout(3500); // controls fade out while it plays
  await page.evaluate(() => document.getElementById('movie_player').pauseVideo());
  await page.mouse.move(1279, 799);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: join(BUILD, 'player.png') });

  // The gear menu, showing the quality TubeToggles applied.
  await page.hover('#movie_player');
  await page.click('.ytp-settings-button');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(BUILD, 'menu.png') });

  // A change made in the player: TubeToggles saves it and says so.
  await page.locator('.ytp-settings-menu .ytp-menuitem[role="menuitemcheckbox"]', { hasText: 'Ambient mode' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(BUILD, 'saved.png') });
  await page.keyboard.press('Escape');
  await page.close();
  await setSettings({ ambientMode: true });

  // ---------------------------------------------------------
  // Captures of the popup
  // ---------------------------------------------------------
  async function capturePopup(name, { theme = 'auto', hover = null } = {}) {
    await worker.evaluate((t) => chrome.storage.local.set({ popupTheme: t }), theme);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 320, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(400);
    // Opened on its own the popup can't see a video tab; show what it says on one.
    await popup.evaluate(() => {
      document.getElementById('statusText').textContent = 'Active on this video';
      document.getElementById('status').classList.add('active');
    });
    if (hover) await popup.hover(hover);
    else await popup.mouse.move(0, 0);
    await popup.waitForTimeout(200);
    const height = await popup.evaluate(() => document.body.scrollHeight);
    await popup.setViewportSize({ width: 320, height });
    await popup.screenshot({ path: join(BUILD, `${name}.png`) });
    await popup.close();
  }

  await capturePopup('popup-dark');
  await capturePopup('popup-dark-audio', { hover: 'label[for="setting-audioTrack"]' });
  await capturePopup('popup-dark-quality', { hover: 'label[for="setting-quality"]' });
  await capturePopup('popup-light', { theme: 'light' });
  await worker.evaluate(() => chrome.storage.local.set({ popupTheme: 'auto' }));

  // ---------------------------------------------------------
  // Layouts
  // ---------------------------------------------------------
  const style = `
    * { box-sizing: border-box; }
    body { margin: 0; width: 1280px; height: 800px; overflow: hidden; position: relative;
           background: #0f0f0f; font-family: Roboto, 'Segoe UI', Arial, sans-serif; color: #fff; }
    .bg { position: absolute; inset: 0; width: 1280px; height: 800px; }
    .shade { position: absolute; inset: 0;
             background: linear-gradient(90deg, rgba(8,8,8,.94) 0%, rgba(8,8,8,.86) 30%, rgba(8,8,8,.25) 58%, rgba(8,8,8,0) 72%); }
    .copy { position: absolute; left: 72px; top: 50%; transform: translateY(-50%); width: 520px; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 20px; font-weight: 600; margin-bottom: 28px; }
    .logo { width: 32px; height: 32px; border-radius: 8px; background: #ff0033; display: flex; align-items: center; justify-content: center; }
    .logo::after { content: ''; margin-left: 3px; border-top: 7px solid transparent; border-bottom: 7px solid transparent; border-left: 11px solid #fff; }
    h1 { margin: 0 0 18px; font-size: 52px; line-height: 1.08; font-weight: 700; letter-spacing: -1px; }
    p { margin: 0; font-size: 20px; line-height: 1.45; color: #c8c8c8; }
    .popup { position: absolute; border-radius: 12px; box-shadow: 0 30px 80px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.08); }
    .credit { position: absolute; right: 14px; bottom: 10px; font-size: 11px; color: rgba(255,255,255,.55); }
  `;
  const copy = (headline, line) => `
    <div class="copy">
      <div class="brand"><span class="logo"></span>TubeToggles</div>
      <h1>${headline}</h1>
      <p>${line}</p>
    </div>`;

  const shots = [
    {
      name: '1-every-video',
      body: `<img class="bg" src="${dataUri(join(BUILD, 'player.png'))}"><div class="shade"></div>
        ${copy('Your settings.<br>Every video.', 'Stable volume, voice boost, original audio, quality and more, applied to every video automatically.')}
        <img class="popup" style="right:64px; top:56px" src="${dataUri(join(BUILD, 'popup-dark.png'))}">
        <div class="credit">${CREDIT}</div>`,
    },
    {
      name: '2-original-audio',
      body: `<img class="bg" src="${dataUri(join(BUILD, 'player.png'))}"><div class="shade"></div>
        ${copy('Hear the original,<br>not the dub.', "TubeToggles picks a video's original audio track instead of a dubbed version.")}
        <img class="popup" style="right:64px; top:56px" src="${dataUri(join(BUILD, 'popup-dark-audio.png'))}">
        <div class="credit">${CREDIT}</div>`,
    },
    {
      name: '3-quality',
      body: `<img class="bg" src="${dataUri(join(BUILD, 'menu.png'))}"><div class="shade"></div>
        ${copy('Choose a quality<br>once.', "Set a resolution one time. When a video doesn't offer it, TubeToggles uses the next one down.")}
        <div class="credit">${CREDIT}</div>`,
    },
    {
      name: '4-saved-from-player',
      body: `<img class="bg" src="${dataUri(join(BUILD, 'saved.png'))}"><div class="shade"></div>
        ${copy("Change it anywhere.<br>It's saved.", "Change a setting in YouTube's own player and TubeToggles keeps it, on every video.")}
        <div class="credit">${CREDIT}</div>`,
    },
    {
      name: '5-light-or-dark',
      body: `<div class="bg" style="background: radial-gradient(circle at 78% 45%, #3a0a12 0%, #160709 45%, #0b0b0b 80%)"></div>
        ${copy('Light or dark.<br>Your call.', "The menu matches YouTube's theme, or you can set light or dark yourself.")}
        <img class="popup" style="left:600px; top:72px" src="${dataUri(join(BUILD, 'popup-light.png'))}">
        <img class="popup" style="left:880px; top:150px" src="${dataUri(join(BUILD, 'popup-dark.png'))}">`,
    },
  ];

  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: 1280, height: 800 });
  for (const shot of shots) {
    await canvas.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${shot.body}</body></html>`);
    await canvas.waitForTimeout(150);
    await canvas.screenshot({ path: join(OUT, `screenshot-${shot.name}.png`) });
  }

  // Small promo tile: shown in search results and category pages.
  await canvas.setViewportSize({ width: 440, height: 280 });
  await canvas.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 440px; height: 280px; overflow: hidden; font-family: Roboto, 'Segoe UI', Arial, sans-serif; color: #fff;
           background: radial-gradient(circle at 85% 15%, #ff3355 0%, #e6002e 38%, #a3001f 100%);
           display: flex; flex-direction: column; justify-content: center; padding: 0 40px; }
    .logo { width: 56px; height: 56px; border-radius: 14px; background: #fff; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;
            box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    .logo::after { content: ''; margin-left: 5px; border-top: 12px solid transparent; border-bottom: 12px solid transparent; border-left: 19px solid #e6002e; }
    h1 { margin: 0 0 8px; font-size: 38px; font-weight: 700; letter-spacing: -0.8px; }
    p { margin: 0; font-size: 19px; color: rgba(255,255,255,.92); }
  </style></head><body><div class="logo"></div><h1>TubeToggles</h1><p>Your settings. Every video.</p></body></html>`);
  await canvas.waitForTimeout(150);
  await canvas.screenshot({ path: join(OUT, 'promo-small-440x280.png') });
  await canvas.close();

  writeFileSync(join(OUT, 'README.md'), [
    '# Chrome Web Store images',
    '',
    'Generated by `node store/render.mjs` from the real extension. Do not edit by hand.',
    '',
    '- `screenshot-*.png`: 1280x800 screenshots, in upload order',
    '- `promo-small-440x280.png`: small promo tile',
    '',
    `Video frames: ${CREDIT}.`,
    '',
  ].join('\n'));
  console.log('Rendered to store/assets/');
} finally {
  await browser.close();
}
