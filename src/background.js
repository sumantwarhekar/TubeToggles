importScripts('settings.js');

// Fill in any setting with no valid stored value. New installs get the
// defaults; on an update, values the user already chose are left untouched.
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  const missing = {};
  for (const [key, value] of Object.entries(TubeToggles.DEFAULTS)) {
    if (!(key in stored) || !TubeToggles.isValid(key, stored[key])) missing[key] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
});
