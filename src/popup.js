document.addEventListener('DOMContentLoaded', () => {
  const settingsDiv = document.getElementById('settings');
  const extensionEnabled = document.getElementById('extensionEnabled');
  const themeToggleBtn = document.getElementById('themeToggle');
  const selects = {};
  let current = TubeToggles.normalize({});

  // Select values are strings; '' means "don't change" (stored as null).
  const toOption = (value) => (value === null ? '' : value === true ? 'on' : value === false ? 'off' : value);
  const fromOption = (option) => (option === '' ? null : option === 'on' ? true : option === 'off' ? false : option);

  function optionsFor(key) {
    const kind = TubeToggles.SETTINGS[key].kind;
    if (kind === 'toggle') return [['on', 'On'], ['off', 'Off']];
    if (kind === 'quality') {
      return [['auto', 'Auto'], ['highest', 'Highest available'],
        ...TubeToggles.QUALITY_LEVELS.map((q) => [q.value, q.label])];
    }
    const options = [['original', 'Original']];
    // A language saved from the player gets its own entry.
    if (current.audioTrack && current.audioTrack !== 'original') {
      options.push([current.audioTrack, TubeToggles.languageLabel(current.audioTrack)]);
    }
    return options;
  }

  function fillSelect(key) {
    const select = selects[key];
    select.replaceChildren(
      new Option("Don't change", ''),
      ...optionsFor(key).map(([value, label]) => new Option(label, value)),
    );
    select.value = toOption(current[key]);
  }

  for (const [key, setting] of Object.entries(TubeToggles.SETTINGS)) {
    const row = document.createElement('label');
    row.className = 'toggle-row';
    row.htmlFor = `setting-${key}`;

    const info = document.createElement('div');
    info.className = 'toggle-info';
    const title = document.createElement('span');
    title.className = 'toggle-title';
    title.textContent = setting.label;
    const desc = document.createElement('span');
    desc.className = 'toggle-desc';
    desc.textContent = setting.description;
    info.append(title, desc);

    const select = document.createElement('select');
    select.id = `setting-${key}`;
    select.addEventListener('change', () => {
      chrome.storage.sync.set(TubeToggles.changesFor(current, key, fromOption(select.value)));
    });
    selects[key] = select;

    row.append(info, select);
    settingsDiv.appendChild(row);
  }

  function updateDimming(isEnabled) {
    settingsDiv.classList.toggle('disabled', !isEnabled);
    Object.values(selects).forEach((select) => { select.disabled = !isEnabled; });
  }

  function render() {
    Object.keys(selects).forEach(fillSelect);
    extensionEnabled.checked = current.extensionEnabled;
    updateDimming(current.extensionEnabled);
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
    if (areaName === 'local' && changes.tubeTheme) {
      applyTheme(changes.tubeTheme.newValue);
    }
  });

  extensionEnabled.addEventListener('change', (e) => {
    chrome.storage.sync.set({ extensionEnabled: e.target.checked });
  });

  // Load theme
  chrome.storage.local.get(['tubeTheme'], (result) => {
    applyTheme(result.tubeTheme || 'dark');
  });

  function applyTheme(theme) {
    if (theme === 'light') {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
    } else {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
    }
  }

  // Theme toggle button click listener
  themeToggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    chrome.storage.local.set({ tubeTheme: newTheme });
  });
});
