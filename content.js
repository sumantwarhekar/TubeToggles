// Current preferences
let currentSettings = {
  stableVolume: true,
  voiceBoost: false,
  ambientMode: true,
  annotations: true,
  extensionEnabled: true // Master switch
};

// Map extension keys to YouTube menu labels (case-insensitive parts)
const menuMapping = {
  stableVolume: 'Stable volume',
  voiceBoost: 'Voice boost',
  ambientMode: 'Ambient mode',
  annotations: 'Annotations'
};

// Initialize
chrome.storage.sync.get(['stableVolume', 'voiceBoost', 'ambientMode', 'annotations', 'extensionEnabled'], (result) => {
  currentSettings = { ...currentSettings, ...result };
  if (currentSettings.extensionEnabled) {
    attemptPlayerSettingsToggle();
  }
});

// Listen for real-time updates from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleChanged') {
    currentSettings[request.setting] = request.value;
    if (currentSettings.extensionEnabled) {
      attemptPlayerSettingsToggle();
    }
  }
});

// Listen for YouTube SPA navigation
document.addEventListener('yt-navigate-finish', () => {
  if (currentSettings.extensionEnabled) {
    attemptPlayerSettingsToggle();
  }
});

// ---------------------------------------------------------
// Aggressive Enforcement
// ---------------------------------------------------------
let isProgrammaticInteraction = false;

document.addEventListener('click', (e) => {
  if (!currentSettings.extensionEnabled) return;
  if (isProgrammaticInteraction) return;

  const menu = document.querySelector('.ytp-settings-menu');
  const clickedSettingsBtn = e.target.closest('.ytp-settings-button');
  const clickedInsideMenu = menu && menu.contains(e.target);

  if (clickedSettingsBtn || clickedInsideMenu) {
    // User interacted with the settings menu manually.
    // Re-verify our enforced settings shortly after they finish.
    setTimeout(() => {
      attemptPlayerSettingsToggle();
    }, 1500); // 1.5s delay gives them time to see their change before it reverts
  }
}, true); // use capture phase


// ---------------------------------------------------------
// Unified Player Menu Interaction
// ---------------------------------------------------------

let settingsMenuTimeout = null;

function attemptPlayerSettingsToggle() {
  if (!currentSettings.extensionEnabled) return;
  if (settingsMenuTimeout) clearTimeout(settingsMenuTimeout);
  if (!window.location.pathname.startsWith('/watch')) return;

  // Give the player a moment to initialize after navigation
  settingsMenuTimeout = setTimeout(() => {
    isProgrammaticInteraction = true;
    processToggles(Object.keys(menuMapping), 0);
  }, 2000);
}

function processToggles(keys, index) {
  if (index >= keys.length) {
    // Done processing all toggles
    setTimeout(() => {
      isProgrammaticInteraction = false;
    }, 500);
    return; 
  }

  const key = keys[index];
  const menuText = menuMapping[key];
  const desiredState = currentSettings[key];

  checkAndToggleMenuSetting(menuText, desiredState, () => {
    // Process next toggle after a small delay
    setTimeout(() => {
      processToggles(keys, index + 1);
    }, 300);
  });
}

function checkAndToggleMenuSetting(menuText, desiredState, callback) {
  const settingsButton = document.querySelector('.ytp-settings-button');
  if (!settingsButton) {
    callback();
    return;
  }

  // 1. Open Menu
  settingsButton.click();

  setTimeout(() => {
    // 2. Find the menu item
    const menuItems = document.querySelectorAll('.ytp-menuitem');
    let targetItem = null;
    
    for (let item of menuItems) {
      const label = item.querySelector('.ytp-menuitem-label');
      if (label && label.textContent.toLowerCase().includes(menuText.toLowerCase())) {
        targetItem = item;
        break;
      }
    }

    if (targetItem) {
      // Check its current state (YouTube uses aria-checked)
      const isCurrentlyOn = targetItem.getAttribute('aria-checked') === 'true';
      
      if (isCurrentlyOn !== desiredState) {
        // Toggle it
        targetItem.click();
      }
    }

    // 3. Close the menu
    setTimeout(() => {
      const menu = document.querySelector('.ytp-settings-menu');
      if (menu && menu.style.display !== 'none') {
        settingsButton.click();
      }
      callback();
    }, 100);

  }, 100); // wait for menu to open
}

// ---------------------------------------------------------
// Theme Syncing Observer
// ---------------------------------------------------------
function syncTheme() {
  const isDarkMode = document.documentElement.hasAttribute('dark') || 
                     document.documentElement.classList.contains('dark') ||
                     (document.body && document.body.classList.contains('dark'));
                     
  chrome.storage.local.set({ tubeTheme: isDarkMode ? 'dark' : 'light' });
}

// Initial sync
syncTheme();

// Observe YouTube theme changes
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.attributeName === 'dark' || mutation.attributeName === 'class') {
      syncTheme();
    }
  });
});

observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'dark']
});
