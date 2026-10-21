chrome.runtime.onInstalled.addListener(() => {
  // Initialize default settings when the extension is first installed
  chrome.storage.sync.get(['stableVolume', 'voiceBoost', 'ambientMode', 'annotations'], (result) => {
    const defaultSettings = {
      stableVolume: result.stableVolume !== undefined ? result.stableVolume : true,
      voiceBoost: result.voiceBoost !== undefined ? result.voiceBoost : false,
      ambientMode: result.ambientMode !== undefined ? result.ambientMode : true,
      annotations: result.annotations !== undefined ? result.annotations : true
    };
    chrome.storage.sync.set(defaultSettings);
  });
});
