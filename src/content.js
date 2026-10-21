// Bridge between extension storage and page.js, which runs in YouTube's own
// page context so it can use the player API. Settings flow to the page; manual
// changes the user makes in the player flow back into storage.

const FROM_EXTENSION = 'tubetoggles-ext';
const FROM_PAGE = 'tubetoggles-page';

let settings = TubeToggles.normalize({});

// After the extension is reloaded or updated, this old copy loses access to
// chrome.* APIs; stop quietly instead of throwing on every message.
const extensionAlive = () => Boolean(chrome.runtime?.id);

// page.js can't load settings.js itself (Chrome injects a file into a page
// only once, here), so the setting definitions travel with the values.
const catalog = { settings: TubeToggles.SETTINGS, qualityLevels: TubeToggles.QUALITY_LEVELS };

function sendSettings() {
  window.postMessage({ source: FROM_EXTENSION, type: 'settings', settings, catalog }, location.origin);
}

chrome.storage.sync.get(null).then((stored) => {
  settings = TubeToggles.normalize(stored);
  sendSettings();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const stored = { ...settings };
  for (const [key, { newValue }] of Object.entries(changes)) stored[key] = newValue;
  settings = TubeToggles.normalize(stored);
  sendSettings();
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== FROM_PAGE) return;
  if (!extensionAlive()) return;

  if (event.data.type === 'ready') {
    sendSettings();
  } else if (event.data.type === 'userChange') {
    // The page context is not trusted: accept only known settings with valid values.
    const { key, value } = event.data;
    if (key !== 'extensionEnabled' && TubeToggles.isValid(key, value)) {
      chrome.storage.sync.set(TubeToggles.changesFor(settings, key, value));
    }
  }
});

// ---------------------------------------------------------
// Theme: the popup follows YouTube's light or dark theme
// ---------------------------------------------------------

// Read from the page's own background colour: YouTube doesn't set its "dark"
// attribute when it follows the device theme.
function youTubeTheme() {
  const app = document.querySelector('ytd-app');
  const channels = app ? getComputedStyle(app).backgroundColor.match(/[\d.]+/g)?.map(Number) : null;
  if (channels?.length >= 3 && (channels[3] ?? 1) > 0) {
    const [r, g, b] = channels;
    return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 'dark' : 'light';
  }
  return document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
}

let lastTheme = null;
function syncTheme() {
  if (!extensionAlive()) return;
  const theme = youTubeTheme();
  if (theme === lastTheme) return;
  lastTheme = theme;
  chrome.storage.local.set({ tubeTheme: theme });
}

syncTheme();
new MutationObserver(syncTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'dark', 'style'],
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(syncTheme, 300));
