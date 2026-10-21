// TubeToggles engine. Runs in YouTube's own page context (world: MAIN) so it
// can call the player API. Settings arrive from content.js; changes the user
// makes in the player are reported back so they become the new settings.
//
// Every second, on /watch pages, the engine compares each managed setting
// with the player and corrects drift:
//   - stable volume, voice boost, audio track, quality: player API
//   - theater mode: the player's size button
//   - ambient mode, annotations: the gear menu, opened invisibly, rows
//     recognised by icon (the same in every language)
// The same invisible menu pass also checks stable volume and voice boost: the
// API can store a preference without switching the audio that is playing.
// YouTube greys out stable volume while voice boost is on; voice boost wins.

(() => {
  const FROM_EXTENSION = 'tubetoggles-ext';
  const FROM_PAGE = 'tubetoggles-page';

  const TICK_MS = 1000;
  const SETTLE_MS = 1500;      // let a new video's player finish building first
  const USER_GRACE_MS = 2000;  // hold off right after the user touches the player
  const RETRY_MS = 5000;       // minimum gap between repeated attempts at one fix
  const API_SETTLE_MS = 2000;  // let an API change show in the menu before checking it there
  const AMBIENT_RETRIES = 8;   // extra menu passes per video while ambient mode's row is missing
  const AMBIENT_RETRY_MS = 2000;

  // Rows without a stable class are recognised by the start of their icon's
  // path, which YouTube draws the same way in every UI language. English
  // labels are a fallback in case an icon changes.
  const MENU_ROWS = {
    stableVolume: { className: 'ytp-drc-menu-item', icon: 'M12 .99C5.92 .99 1 5.92 1 11.99', label: /^stable volume$/i },
    voiceBoost: { icon: 'M11.48 2.14 3.91 6.68', label: /^voice boost$/i },
    ambientMode: { icon: 'M12 .5C11.73 .5 11.48 .60 11.29 .79', label: /^ambient mode$/i },
    annotations: { icon: 'M9.65 6.00L9.5 6H2.5', label: /^annotations$/i },
  };
  // Voice boost before stable volume: it decides whether stable volume can apply.
  const MENU_SETTINGS = ['voiceBoost', 'stableVolume', 'ambientMode', 'annotations'];

  // The player stores these as numbers, and only these values switch the
  // audio for the current video (true/false is stored but not applied).
  const DRC_ON = 1, DRC_OFF = 0;
  const VOICE_BOOST_ON = 2, VOICE_BOOST_OFF = 1;

  let settings = null;
  let catalog = null;           // setting definitions from settings.js, sent by content.js
  let videoId = null;
  let videoSince = 0;
  let userActiveUntil = 0;
  let menuBusy = false;
  let userTookOverMenu = false; // the user clicked the gear while a pass was running
  let menuPassDoneFor = null;   // video id the hidden-menu pass last completed for
  let lastMenuPass = 0;
  let ambientRowMissing = false;
  let ambientRetries = 0;
  const lastAttempt = new Map(); // fix key -> time of last attempt
  let lastApiFix = 0;

  const now = () => Date.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function player() {
    const p = document.getElementById('movie_player');
    return p && typeof p.getVideoData === 'function' ? p : null;
  }

  function settingsMenu(p) {
    return p.querySelector('.ytp-settings-menu');
  }

  function menuOpen(p) {
    const menu = settingsMenu(p);
    return Boolean(menu) && getComputedStyle(menu).display !== 'none';
  }

  // Runs a fix at most once per RETRY_MS for the same key, so a player that
  // ignores us is not hammered every second.
  function attempt(key, fix) {
    if (now() - (lastAttempt.get(key) ?? 0) < RETRY_MS) return;
    lastAttempt.set(key, now());
    lastApiFix = now();
    fix();
  }

  async function waitFor(check, timeoutMs) {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const result = check();
      if (result) return result;
      await sleep(50);
    }
    return null;
  }

  // ---------------------------------------------------------
  // Reading the player
  // ---------------------------------------------------------

  // Audio track objects keep their details under a minified property name that
  // changes between YouTube releases, so find it by shape instead.
  function trackInfo(track) {
    if (!track) return null;
    return Object.values(track).find((v) => v && typeof v === 'object' && 'isDefault' in v && 'isAutoDubbed' in v) ?? null;
  }

  const trackLanguage = (info) => String(info?.id ?? '').split('.')[0];

  // The part after ';' in a track id is a base64 protobuf that includes an
  // "acont" field: "original", "dubbed", ... Returns that value, or null.
  function audioContent(track) {
    try {
      let encoded = String(track?.id ?? '').split(';')[1];
      if (!encoded) return null;
      encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (encoded.length % 4) encoded += '=';
      const bytes = atob(encoded);
      const at = bytes.indexOf('acont');
      if (at < 0) return null;
      const length = bytes.charCodeAt(at + 6); // after the field tag byte
      return bytes.slice(at + 7, at + 7 + length) || null;
    } catch {
      return null;
    }
  }

  // Whether a track is the video's original audio. The "acont" marker is
  // reliable in every language; isDefault is only a fallback, because YouTube
  // moves it to whichever track the viewer last picked.
  function isOriginalTrack(track, info = trackInfo(track)) {
    const content = audioContent(track);
    return content ? content === 'original' : Boolean(info?.isDefault);
  }

  function currentAudioValue(p) {
    const track = p.getAudioTrack?.();
    const info = trackInfo(track);
    if (!info) return null;
    return isOriginalTrack(track, info) ? 'original' : trackLanguage(info) || null;
  }

  function theaterOn() {
    return document.querySelector('ytd-watch-flexy')?.hasAttribute('theater') ?? false;
  }

  function identifyRow(row) {
    const icon = row.querySelector('.ytp-menuitem-icon path')?.getAttribute('d') ?? '';
    const label = row.querySelector('.ytp-menuitem-label')?.textContent.trim() ?? '';
    for (const [key, match] of Object.entries(MENU_ROWS)) {
      if ((match.className && row.classList.contains(match.className)) || icon.startsWith(match.icon) || match.label.test(label)) {
        return key;
      }
    }
    return null;
  }

  // ---------------------------------------------------------
  // Applying settings through the API
  // ---------------------------------------------------------

  const stableVolumeOn = (p) => Number(p.getDrcUserPreference?.()) === DRC_ON;
  const voiceBoostOn = (p) => Number(p.getVoiceBoostUserPreference?.()) === VOICE_BOOST_ON;

  function applyStableVolume(p) {
    const wanted = settings.stableVolume;
    if (wanted === null || typeof p.setDrcUserPreference !== 'function') return;
    if (voiceBoostOn(p)) return; // unavailable while voice boost is on
    if (stableVolumeOn(p) !== wanted) attempt('drc', () => p.setDrcUserPreference(wanted ? DRC_ON : DRC_OFF));
  }

  function applyVoiceBoost(p) {
    const wanted = settings.voiceBoost;
    if (wanted === null || typeof p.setVoiceBoostUserPreference !== 'function') return;
    if (voiceBoostOn(p) !== wanted) {
      attempt('voice', () => p.setVoiceBoostUserPreference(wanted ? VOICE_BOOST_ON : VOICE_BOOST_OFF));
    }
  }

  function applyAudioTrack(p) {
    const wanted = settings.audioTrack;
    if (wanted === null || typeof p.getAvailableAudioTracks !== 'function') return;
    const tracks = (p.getAvailableAudioTracks() ?? []).map((track) => ({ track, info: trackInfo(track) })).filter((t) => t.info);
    if (tracks.length < 2) return;

    const original = tracks.find((t) => isOriginalTrack(t.track, t.info));
    let target = original;
    if (wanted !== 'original') {
      const base = wanted.split('-')[0];
      target = tracks.find((t) => trackLanguage(t.info) === wanted)
        ?? tracks.find((t) => trackLanguage(t.info).split('-')[0] === base)
        ?? original;
    }
    if (!target) return;

    const current = trackInfo(p.getAudioTrack());
    if (current?.id !== target.info.id) attempt(`audio:${videoId}`, () => p.setAudioTrack(target.track));
  }

  // The level to play for the wanted quality: the wanted one if this video has
  // it, otherwise the next lower one (or the lowest there is).
  function qualityTarget(p, wanted) {
    if (wanted === 'auto') return 'auto';
    const order = catalog.qualityLevels.map((q) => q.value);
    const available = (p.getAvailableQualityLevels?.() ?? [])
      .filter((q) => order.includes(q))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!available.length) return null;
    if (wanted === 'highest') return available[0];
    const rank = order.indexOf(wanted);
    return available.find((q) => order.indexOf(q) >= rank) ?? available[available.length - 1];
  }

  function applyQuality(p) {
    const wanted = settings.quality;
    if (wanted === null || typeof p.setPlaybackQualityRange !== 'function') return;
    const target = qualityTarget(p, wanted);
    if (!target) return;
    if (p.getUserPlaybackQualityPreference?.() !== target) {
      attempt(`quality:${videoId}:${target}`, () => p.setPlaybackQualityRange(target, target));
    }
  }

  function applyTheater(p) {
    const wanted = settings.theaterMode;
    if (wanted === null || document.fullscreenElement) return;
    if (!document.querySelector('ytd-watch-flexy')) return;
    if (theaterOn() !== wanted) {
      attempt('theater', () => {
        p.querySelector('.ytp-size-button')?.click();
        // Ambient mode's row can appear or vanish with the layout.
        if (ambientRowMissing) menuPassDoneFor = null;
      });
    }
  }

  // ---------------------------------------------------------
  // Applying settings through the gear menu, invisibly
  // ---------------------------------------------------------

  function needsMenuPass() {
    if (!MENU_SETTINGS.some((key) => settings[key] !== null)) return false;
    if (menuPassDoneFor !== videoId) return true;
    // Ambient mode's row shows up only once YouTube has set up the glow, which
    // can be several seconds into the video, so look again a few times.
    return ambientRowMissing && settings.ambientMode !== null &&
      ambientRetries < AMBIENT_RETRIES && now() - lastMenuPass > AMBIENT_RETRY_MS;
  }

  async function runMenuPass(p) {
    const button = p.querySelector('.ytp-settings-button');
    if (!button) return;
    const forVideo = videoId;

    if (menuPassDoneFor === forVideo) ambientRetries++;
    lastMenuPass = now();
    menuBusy = true;
    userTookOverMenu = false;
    // Opening the menu makes YouTube fade the control bar in; if it was hidden,
    // keep it hidden so the pass leaves nothing on screen.
    const controlsWereHidden = p.classList.contains('ytp-autohide');
    p.classList.add('tubetoggles-hidden-menu');
    if (controlsWereHidden) p.classList.add('tubetoggles-hidden-controls');
    try {
      button.click();
      const opened = await waitFor(() => p.querySelector('.ytp-settings-menu .ytp-panel-menu > .ytp-menuitem'), 1500);
      if (!opened) return;
      const checkboxRows = () => [...p.querySelectorAll('.ytp-settings-menu .ytp-panel-menu > .ytp-menuitem[role="menuitemcheckbox"]')];

      ambientRowMissing = false;
      for (const key of MENU_SETTINGS) {
        if (userTookOverMenu) return;
        const wanted = settings[key];
        if (wanted === null) continue;
        if (key === 'stableVolume' && voiceBoostOn(p)) continue;
        // Looked up fresh each time: one click can change other rows.
        const row = checkboxRows().find((r) => identifyRow(r) === key);
        if (!row) {
          if (key === 'ambientMode') ambientRowMissing = true;
          continue;
        }
        if (row.getAttribute('aria-disabled') === 'true') continue;
        if ((row.getAttribute('aria-checked') === 'true') !== wanted) {
          row.click();
          await sleep(100);
        }
      }
      menuPassDoneFor = forVideo;
    } finally {
      // If the user took over, the menu stays open and visible for them.
      if (!userTookOverMenu) {
        if (menuOpen(p)) button.click();
        await waitFor(() => !menuOpen(p), 500);
      }
      p.classList.remove('tubetoggles-hidden-menu');
      menuBusy = false;
      if (controlsWereHidden) {
        await waitFor(() => p.classList.contains('ytp-autohide'), 1500);
        p.classList.remove('tubetoggles-hidden-controls');
      }
    }
  }

  // The user clicked the gear while a hidden pass had the menu open: show them
  // that menu instead of letting their click close it.
  function revealMenuForUser(p) {
    userTookOverMenu = true;
    p.classList.remove('tubetoggles-hidden-menu', 'tubetoggles-hidden-controls');
  }

  // ---------------------------------------------------------
  // The loop
  // ---------------------------------------------------------

  function tick() {
    if (!settings?.extensionEnabled || location.pathname !== '/watch') return;
    const p = player();
    const id = p?.getVideoData()?.video_id;
    if (!id) return;

    if (id !== videoId) {
      videoId = id;
      videoSince = now();
      menuPassDoneFor = null;
      ambientRetries = 0;
    }

    if (now() - videoSince < SETTLE_MS || now() < userActiveUntil) return;
    if (menuBusy || menuOpen(p)) return; // never touch the menu while the user has it open
    if (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) return;
    // Changes made while the video is still loading can be stored without
    // taking effect, so wait until it is playing (1) or paused (2).
    const state = p.getPlayerState?.();
    if (state !== 1 && state !== 2) return;

    applyVoiceBoost(p);
    applyStableVolume(p);
    applyAudioTrack(p);
    applyQuality(p);
    applyTheater(p);
    if (now() - lastApiFix > API_SETTLE_MS && needsMenuPass()) runMenuPass(p);
  }

  setInterval(tick, TICK_MS);
  document.addEventListener('yt-navigate-finish', () => setTimeout(tick, SETTLE_MS));

  // A different window size or theme can make ambient mode's row appear.
  const recheckAmbient = () => { if (ambientRowMissing) menuPassDoneFor = null; };
  window.addEventListener('resize', recheckAmbient);
  new MutationObserver(recheckAmbient).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });

  // ---------------------------------------------------------
  // Saving the user's own changes back as the new settings
  // ---------------------------------------------------------

  function report(key, value) {
    if (!settings || settings[key] === null || value === null || settings[key] === value) return;
    settings = { ...settings, [key]: value };
    window.postMessage({ source: FROM_PAGE, type: 'userChange', key, value }, location.origin);
    showToast(key, value);
  }

  function readApiState(p) {
    return { quality: p.getUserPlaybackQualityPreference?.() ?? null, audio: currentAudioValue(p) };
  }

  // A checkbox row's state, looked up again by key: YouTube may rebuild the
  // row when it is clicked, so the pressed element can be stale.
  function rowState(p, key) {
    const row = [...p.querySelectorAll('.ytp-settings-menu .ytp-menuitem[role="menuitemcheckbox"]')]
      .find((r) => identifyRow(r) === key);
    if (row) return row.getAttribute('aria-checked') === 'true';
    if (key === 'stableVolume') return stableVolumeOn(p);
    if (key === 'voiceBoost') return voiceBoostOn(p);
    return null;
  }

  // A press (pointer, Enter or Space) inside the gear menu, made by the user.
  // What was pressed is captured now, while it is still in the menu; the result
  // is read once the player has applied the change.
  function onMenuPress(p, target) {
    userActiveUntil = now() + USER_GRACE_MS;
    const row = target.closest('.ytp-menuitem[role="menuitemcheckbox"]');
    const key = row ? identifyRow(row) : null;
    const before = readApiState(p);

    setTimeout(() => {
      if (key) {
        report(key, rowState(p, key));
        return;
      }
      const after = readApiState(p);
      if (after.quality !== before.quality && after.quality) report('quality', after.quality);
      if (after.audio !== before.audio && after.audio) report('audioTrack', after.audio);
    }, 500);
  }

  function onTheaterToggledByUser() {
    userActiveUntil = now() + USER_GRACE_MS;
    setTimeout(() => {
      report('theaterMode', theaterOn());
      if (ambientRowMissing) menuPassDoneFor = null;
    }, 600);
  }

  const isTyping = (el) => el instanceof Element && Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

  // The user reaching for the player always gets its controls.
  document.addEventListener('pointermove', (event) => {
    if (event.isTrusted && event.target instanceof Element && event.target.closest('#movie_player')) {
      player()?.classList.remove('tubetoggles-hidden-controls');
    }
  }, true);

  // Programmatic clicks (including our own) are untrusted, so only real user
  // input passes the isTrusted checks below.
  document.addEventListener('pointerdown', (event) => {
    const p = player();
    if (!event.isTrusted || !p || !settings?.extensionEnabled || !(event.target instanceof Element)) return;
    if (menuBusy && event.target.closest('#movie_player .ytp-settings-button')) {
      revealMenuForUser(p);
    } else if (settingsMenu(p)?.contains(event.target)) {
      onMenuPress(p, event.target);
    }
  }, true);

  document.addEventListener('click', (event) => {
    const p = player();
    if (!event.isTrusted || !p || !settings?.extensionEnabled || !(event.target instanceof Element)) return;
    if (userTookOverMenu && menuOpen(p) && event.target.closest('#movie_player .ytp-settings-button')) {
      // The menu is already open for them; this click would only close it.
      event.stopImmediatePropagation();
      event.preventDefault();
      userTookOverMenu = false;
      userActiveUntil = now() + USER_GRACE_MS;
    } else if (event.target.closest('#movie_player .ytp-size-button')) {
      onTheaterToggledByUser();
    } else if (event.target.closest('#movie_player .ytp-settings-button')) {
      userActiveUntil = now() + USER_GRACE_MS;
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    const p = player();
    if (!event.isTrusted || !p || !settings?.extensionEnabled || isTyping(event.target)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (event.key === 't' || event.key === 'T') {
      if (location.pathname === '/watch') onTheaterToggledByUser();
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && settingsMenu(p)?.contains(event.target)) {
      onMenuPress(p, event.target);
    }
  }, true);

  // ---------------------------------------------------------
  // Toast: a short note in the player when a change is saved
  // ---------------------------------------------------------

  function describe(key, value) {
    const setting = catalog.settings[key];
    if (setting.kind === 'toggle') return `${setting.label} ${value ? 'on' : 'off'}`;
    if (setting.kind === 'quality') {
      const level = catalog.qualityLevels.find((q) => q.value === value);
      return `Quality ${level?.label ?? (value === 'auto' ? 'Auto' : value)}`;
    }
    if (value === 'original') return 'Audio track original';
    let language = value;
    try { language = new Intl.DisplayNames(['en'], { type: 'language' }).of(value) ?? value; } catch {}
    return `Audio track ${language}`;
  }

  let toastTimer = null;
  function showToast(key, value) {
    const p = player();
    if (!p) return;
    let toast = p.querySelector('.tubetoggles-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'tubetoggles-toast';
      toast.setAttribute('role', 'status');
      p.appendChild(toast);
    }
    toast.textContent = `TubeToggles saved: ${describe(key, value)}`;
    toast.classList.add('tubetoggles-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('tubetoggles-toast-visible'), 2500);
  }

  const style = document.createElement('style');
  style.textContent = `
    #movie_player.tubetoggles-hidden-menu .ytp-settings-menu { opacity: 0 !important; pointer-events: none !important; }
    #movie_player.tubetoggles-hidden-controls :is(.ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom) {
      opacity: 0 !important; transition: none !important;
    }
    .tubetoggles-toast {
      position: absolute; top: 16px; left: 50%; transform: translate(-50%, -8px);
      z-index: 70; padding: 8px 14px; border-radius: 8px;
      background: rgba(28, 28, 28, 0.9); color: #fff;
      font: 500 13px/1.4 Roboto, Arial, sans-serif;
      opacity: 0; pointer-events: none; transition: opacity 0.2s, transform 0.2s;
    }
    .tubetoggles-toast.tubetoggles-toast-visible { opacity: 1; transform: translate(-50%, 0); }
  `;
  document.documentElement.appendChild(style);

  // ---------------------------------------------------------
  // Settings from the extension
  // ---------------------------------------------------------

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== FROM_EXTENSION || event.data.type !== 'settings') return;
    const previous = settings;
    settings = event.data.settings;
    catalog = event.data.catalog;
    // A changed setting should apply right away, not after the retry gap.
    lastAttempt.clear();
    if (!previous || MENU_SETTINGS.some((key) => previous[key] !== settings[key])) menuPassDoneFor = null;
    tick();
  });

  window.postMessage({ source: FROM_PAGE, type: 'ready' }, location.origin);
})();
