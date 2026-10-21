document.addEventListener('DOMContentLoaded', () => {
  const settingsEl = document.getElementById('settings');
  const masterSwitch = document.getElementById('extensionEnabled');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const resetButton = document.getElementById('reset');
  const controls = {};     // setting key -> its switch or dropdown
  const rows = {};         // setting key -> { row, desc }
  let current = TubeToggles.normalize({});
  let tabKind = 'other';   // the active tab: 'video', 'youtube' or 'other'

  const save = (key, value) => chrome.storage.sync.set(TubeToggles.changesFor(current, key, value));

  // ---------------------------------------------------------
  // Rows, grouped into sections, built from settings.js
  // ---------------------------------------------------------

  function dropdownOptions(key) {
    if (TubeToggles.SETTINGS[key].kind === 'quality') {
      return [['auto', 'Auto'], ['highest', 'Highest available'],
        ...TubeToggles.QUALITY_LEVELS.map((q) => [q.value, q.label])];
    }
    const options = [['original', 'Original']];
    // A language saved from the player gets its own entry.
    if (current.audioTrack !== 'original') {
      options.push([current.audioTrack, TubeToggles.languageLabel(current.audioTrack)]);
    }
    return options;
  }

  const sections = {};
  for (const [key, setting] of Object.entries(TubeToggles.SETTINGS)) {
    if (!sections[setting.group]) {
      const section = document.createElement('section');
      section.className = 'group';
      const heading = document.createElement('h2');
      heading.id = `group-${setting.group.toLowerCase()}`;
      heading.textContent = setting.group;
      section.setAttribute('aria-labelledby', heading.id);
      section.appendChild(heading);
      settingsEl.appendChild(section);
      sections[setting.group] = section;
    }

    const row = document.createElement('label');
    row.className = 'row';
    row.htmlFor = `setting-${key}`;

    const text = document.createElement('span');
    text.className = 'row-text';
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = setting.label;
    const desc = document.createElement('span');
    desc.className = 'row-desc';
    desc.id = `desc-${key}`;
    text.append(title, desc);

    let control;
    let controlWrap;
    if (setting.kind === 'toggle') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.setAttribute('role', 'switch');
      control.addEventListener('change', () => save(key, control.checked));
      controlWrap = document.createElement('span');
      controlWrap.className = 'switch';
      const track = document.createElement('span');
      track.className = 'track';
      controlWrap.append(control, track);
    } else {
      control = document.createElement('select');
      control.addEventListener('change', () => save(key, control.value));
      controlWrap = control;
    }
    control.id = `setting-${key}`;
    control.setAttribute('aria-describedby', desc.id);

    row.append(text, controlWrap);
    sections[setting.group].appendChild(row);
    controls[key] = control;
    rows[key] = { row, desc };
  }

  // ---------------------------------------------------------
  // Showing the current state
  // ---------------------------------------------------------

  function renderStatus() {
    let text = 'Open a YouTube video to apply your settings';
    let active = false;
    if (!current.extensionEnabled) {
      text = 'TubeToggles is off. YouTube is left as it is.';
    } else if (tabKind === 'video') {
      text = 'Active on this video';
      active = true;
    } else if (tabKind === 'youtube') {
      text = 'Open a video to apply your settings';
    }
    statusText.textContent = text;
    statusEl.classList.toggle('active', active);
  }

  function render() {
    masterSwitch.checked = current.extensionEnabled;
    document.body.classList.toggle('is-off', !current.extensionEnabled);

    for (const [key, setting] of Object.entries(TubeToggles.SETTINGS)) {
      const control = controls[key];
      if (setting.kind === 'toggle') {
        control.checked = current[key];
      } else {
        control.replaceChildren(...dropdownOptions(key).map(([value, label]) => new Option(label, value)));
        control.value = current[key];
      }

      // As in YouTube, stable volume is unavailable while voice boost is on.
      const blocked = key === 'stableVolume' && current.voiceBoost;
      if (blocked) control.checked = false;
      control.disabled = !current.extensionEnabled || blocked;
      rows[key].row.classList.toggle('disabled', control.disabled);
      rows[key].desc.textContent = blocked ? 'Off while voice boost is on' : setting.description;
    }
    renderStatus();
  }

  chrome.storage.sync.get(null, (stored) => {
    current = TubeToggles.normalize(stored);
    render();
  });

  // Stay in sync with changes saved from the player while the popup is open.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      const stored = { ...current };
      for (const [key, { newValue }] of Object.entries(changes)) stored[key] = newValue;
      current = TubeToggles.normalize(stored);
      render();
    }
    if (areaName === 'local' && changes.tubeTheme) applyTheme(changes.tubeTheme.newValue);
  });

  masterSwitch.addEventListener('change', () => {
    chrome.storage.sync.set({ extensionEnabled: masterSwitch.checked });
  });

  // The URL is only visible for YouTube tabs (the extension's host access);
  // any other tab reads as 'other', which is all the status line needs.
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    try {
      const url = new URL(tab?.url ?? '');
      if (url.hostname === 'www.youtube.com') tabKind = url.pathname === '/watch' ? 'video' : 'youtube';
    } catch {
      tabKind = 'other';
    }
    renderStatus();
  });

  // ---------------------------------------------------------
  // Theme: the same as YouTube's, as last seen by content.js
  // ---------------------------------------------------------

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  // Before any visit to YouTube, follow the system theme.
  applyTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  chrome.storage.local.get('tubeTheme', ({ tubeTheme }) => {
    if (tubeTheme) applyTheme(tubeTheme);
  });

  // ---------------------------------------------------------
  // Footer
  // ---------------------------------------------------------

  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

  // Reset takes a second click within a few seconds, so a stray click can't
  // wipe the settings.
  let resetTimer = null;
  resetButton.addEventListener('click', () => {
    if (!resetButton.classList.contains('confirming')) {
      resetButton.classList.add('confirming');
      resetButton.textContent = 'Reset all 7? Click again';
      resetTimer = setTimeout(() => {
        resetButton.classList.remove('confirming');
        resetButton.textContent = 'Reset';
      }, 4000);
      return;
    }
    clearTimeout(resetTimer);
    const { extensionEnabled, ...defaults } = TubeToggles.DEFAULTS;
    chrome.storage.sync.set(defaults);
    resetButton.classList.remove('confirming');
    resetButton.textContent = 'Reset done';
    setTimeout(() => { resetButton.textContent = 'Reset'; }, 2000);
  });
});
