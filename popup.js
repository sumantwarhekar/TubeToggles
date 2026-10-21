document.addEventListener('DOMContentLoaded', () => {
  const toggles = {
    stableVolume: document.getElementById('stableVolume'),
    voiceBoost: document.getElementById('voiceBoost'),
    ambientMode: document.getElementById('ambientMode'),
    annotations: document.getElementById('annotations')
  };

  const extensionEnabled = document.getElementById('extensionEnabled');
  const themeToggleBtn = document.getElementById('themeToggle');
  const contentDiv = document.querySelector('.content');

  function updateDimming(isEnabled) {
    if (isEnabled) {
      contentDiv.style.opacity = '1';
      contentDiv.style.pointerEvents = 'auto';
    } else {
      contentDiv.style.opacity = '0.5';
      contentDiv.style.pointerEvents = 'none';
    }
  }

  // Load saved settings
  chrome.storage.sync.get(['stableVolume', 'voiceBoost', 'ambientMode', 'annotations', 'extensionEnabled'], (result) => {
    Object.keys(toggles).forEach(key => {
      if (result[key] !== undefined) {
        toggles[key].checked = result[key];
      }
    });

    if (result.extensionEnabled !== undefined) {
      extensionEnabled.checked = result.extensionEnabled;
      updateDimming(result.extensionEnabled);
    } else {
      extensionEnabled.checked = true; // default
      updateDimming(true);
      chrome.storage.sync.set({ extensionEnabled: true });
    }
  });

  // Load theme
  chrome.storage.local.get(['tubeTheme'], (result) => {
    applyTheme(result.tubeTheme || 'dark');
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.tubeTheme) {
      applyTheme(changes.tubeTheme.newValue);
    }
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

  function notifyContentScript(key, value) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url.includes('youtube.com')) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'toggleChanged',
          setting: key,
          value: value
        }).catch(() => {});
      }
    });
  }

  // Master Toggle listener
  extensionEnabled.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    updateDimming(isEnabled);
    chrome.storage.sync.set({ extensionEnabled: isEnabled });
    notifyContentScript('extensionEnabled', isEnabled);
  });

  // Save settings when toggled and notify content script
  Object.keys(toggles).forEach(key => {
    toggles[key].addEventListener('change', (e) => {
      const newValue = e.target.checked;
      chrome.storage.sync.set({ [key]: newValue });
      notifyContentScript(key, newValue);
    });
  });

  // Theme toggle button click listener
  themeToggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    chrome.storage.local.set({ tubeTheme: newTheme });
  });
});
