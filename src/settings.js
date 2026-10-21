// Every setting TubeToggles manages, defined once. Loaded by the popup, the
// background worker and both content-script worlds.
//
// Stored values: toggles are true / false, audioTrack is 'original' or a
// language code, quality is 'auto', 'highest' or a YouTube quality level.
// null means "don't change": TubeToggles leaves that setting to YouTube.

var TubeToggles = (() => {
  // Highest first, using the player API's own level names.
  const QUALITY_LEVELS = [
    { value: 'highres', label: '4320p (8K)' },
    { value: 'hd2880', label: '2880p (5K)' },
    { value: 'hd2160', label: '2160p (4K)' },
    { value: 'hd1440', label: '1440p' },
    { value: 'hd1080', label: '1080p' },
    { value: 'hd720', label: '720p' },
    { value: 'large', label: '480p' },
    { value: 'medium', label: '360p' },
    { value: 'small', label: '240p' },
    { value: 'tiny', label: '144p' },
  ];

  const SETTINGS = {
    stableVolume: { kind: 'toggle', label: 'Stable volume', description: 'Evens out loud and quiet sounds' },
    voiceBoost: { kind: 'toggle', label: 'Voice boost', description: 'Clearer speech; turns off stable volume' },
    audioTrack: { kind: 'audioTrack', label: 'Audio track', description: 'Skips AI dubbing on multi-language videos' },
    quality: { kind: 'quality', label: 'Quality', description: 'Falls back to the next lower quality' },
    ambientMode: { kind: 'toggle', label: 'Ambient mode', description: 'Soft glow around the player, in dark theme' },
    theaterMode: { kind: 'toggle', label: 'Theater mode', description: 'Wide player' },
    annotations: { kind: 'toggle', label: 'Annotations', description: 'End screens and cards, where YouTube offers it' },
  };

  const DEFAULTS = {
    extensionEnabled: true,
    stableVolume: null,
    voiceBoost: null,
    audioTrack: 'original',
    quality: null,
    ambientMode: null,
    theaterMode: null,
    annotations: null,
  };

  const QUALITY_VALUES = new Set(['auto', 'highest', ...QUALITY_LEVELS.map((q) => q.value)]);
  const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

  function isValid(key, value) {
    if (key === 'extensionEnabled') return typeof value === 'boolean';
    const setting = SETTINGS[key];
    if (!setting) return false;
    if (value === null) return true;
    switch (setting.kind) {
      case 'toggle': return typeof value === 'boolean';
      case 'audioTrack': return value === 'original' || (typeof value === 'string' && LANGUAGE_CODE.test(value));
      case 'quality': return QUALITY_VALUES.has(value);
      default: return false;
    }
  }

  // Stored values with defaults filled in and anything invalid replaced.
  function normalize(stored) {
    const result = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      result[key] = key in stored && isValid(key, stored[key]) ? stored[key] : fallback;
    }
    return result;
  }

  // YouTube greys out stable volume while voice boost is on, so the two are
  // never both on: turning one on turns the other off. Returns every change
  // to store for setting key to value.
  function changesFor(current, key, value) {
    const changes = { [key]: value };
    if (value === true && key === 'voiceBoost' && current.stableVolume === true) changes.stableVolume = false;
    if (value === true && key === 'stableVolume' && current.voiceBoost === true) changes.voiceBoost = false;
    return changes;
  }

  function qualityLabel(value) {
    if (value === 'auto') return 'Auto';
    if (value === 'highest') return 'Highest available';
    return QUALITY_LEVELS.find((q) => q.value === value)?.label ?? value;
  }

  function languageLabel(code) {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  }

  return Object.freeze({ SETTINGS, DEFAULTS, QUALITY_LEVELS, isValid, normalize, changesFor, qualityLabel, languageLabel });
})();
