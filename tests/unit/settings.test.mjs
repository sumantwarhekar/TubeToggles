// Unit checks of src/settings.js: stored values, upgrades from 1.0.0 and the
// voice boost / stable volume rule. No browser needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/settings.js', import.meta.url), 'utf8');
const context = {};
vm.runInNewContext(`${source}; this.TubeToggles = TubeToggles;`, context);
const { TubeToggles } = context;

test('settings saved by 1.0.0 are kept after the update', () => {
  const v1 = { stableVolume: true, voiceBoost: false, ambientMode: true, annotations: true, extensionEnabled: true };
  assert.deepEqual({ ...TubeToggles.normalize(v1) }, {
    extensionEnabled: true, stableVolume: true, voiceBoost: false, audioTrack: 'original',
    quality: null, ambientMode: true, theaterMode: null, annotations: true,
  });
});

test('invalid or unknown stored values fall back to the defaults', () => {
  const normalized = TubeToggles.normalize({ quality: '9000p', audioTrack: 42, theaterMode: 'yes', bogus: 1 });
  assert.equal(normalized.quality, null);
  assert.equal(normalized.audioTrack, 'original');
  assert.equal(normalized.theaterMode, null);
  assert.equal('bogus' in normalized, false);
});

test('values are validated per kind of setting', () => {
  assert.equal(TubeToggles.isValid('quality', 'hd1080'), true);
  assert.equal(TubeToggles.isValid('quality', 'highest'), true);
  assert.equal(TubeToggles.isValid('quality', 'hd9999'), false);
  assert.equal(TubeToggles.isValid('audioTrack', 'original'), true);
  assert.equal(TubeToggles.isValid('audioTrack', 'pt-BR'), true);
  assert.equal(TubeToggles.isValid('audioTrack', '<script>'), false);
  assert.equal(TubeToggles.isValid('theaterMode', null), true);
  assert.equal(TubeToggles.isValid('extensionEnabled', null), false);
  assert.equal(TubeToggles.isValid('notASetting', true), false);
});

test('turning voice boost or stable volume on turns the other off', () => {
  const both = { stableVolume: true, voiceBoost: true };
  assert.deepEqual({ ...TubeToggles.changesFor(both, 'voiceBoost', true) }, { voiceBoost: true, stableVolume: false });
  assert.deepEqual({ ...TubeToggles.changesFor(both, 'stableVolume', true) }, { stableVolume: true, voiceBoost: false });
  assert.deepEqual({ ...TubeToggles.changesFor({ stableVolume: null }, 'voiceBoost', true) }, { voiceBoost: true });
  assert.deepEqual({ ...TubeToggles.changesFor(both, 'voiceBoost', false) }, { voiceBoost: false });
});

test('labels for the popup and the in-player notice', () => {
  assert.equal(TubeToggles.qualityLabel('hd720'), '720p');
  assert.equal(TubeToggles.qualityLabel('highest'), 'Highest available');
  assert.equal(TubeToggles.languageLabel('hi'), 'Hindi');
});
