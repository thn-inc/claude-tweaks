'use strict';

// bin/residue.js's readProjectManifest reads this repo's own plugin manifest
// — since #418 it lives at `plugin/.claude-plugin/plugin.json`; reading only
// the legacy repo-root spelling would make it miss the current one. #2257
// dropped probeRelease's `manifest.name === 'claude-tweaks'` gate entirely
// (it now anchors on `.release-please-manifest.json` instead — see
// tests/bin-lib/residue/probes/release-generalized.test.js), so this file
// now pins only readProjectManifest's own path-resolution behavior, which
// other callers may still need.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readProjectManifest } = require('../plugin/bin/residue');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'residue-manifest-'));
}

function writeManifest(root, relDir, body) {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(body), 'utf8');
}

test('reads the cutover manifest at plugin/.claude-plugin/plugin.json', () => {
  const root = tmpdir();
  writeManifest(root, 'plugin/.claude-plugin', { name: 'claude-tweaks', version: '7.0.0' });
  const manifest = readProjectManifest(root);
  assert.ok(manifest, 'manifest under plugin/ must resolve');
  assert.equal(manifest.name, 'claude-tweaks');
  assert.equal(manifest.version, '7.0.0');
});

test('still reads the legacy repo-root manifest', () => {
  const root = tmpdir();
  writeManifest(root, '.claude-plugin', { name: 'claude-tweaks', version: '6.99.0' });
  const manifest = readProjectManifest(root);
  assert.ok(manifest, 'legacy repo-root manifest must still resolve');
  assert.equal(manifest.version, '6.99.0');
});

test('prefers the plugin/ spelling when both exist', () => {
  const root = tmpdir();
  writeManifest(root, 'plugin/.claude-plugin', { name: 'claude-tweaks', version: '7.0.0' });
  writeManifest(root, '.claude-plugin', { name: 'claude-tweaks', version: '6.99.0' });
  assert.equal(readProjectManifest(root).version, '7.0.0');
});

test('an absent manifest stays normal — null, not a throw', () => {
  assert.equal(readProjectManifest(tmpdir()), null);
});

test('an unparseable manifest stays normal — null, not a throw', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'plugin', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), '{ not json', 'utf8');
  assert.equal(readProjectManifest(root), null);
});
