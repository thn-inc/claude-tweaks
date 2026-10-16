'use strict';
// Pins #3019's fix: pre-build.md's reference-selection rules must name
// Impeccable 4.5's actual reference files, not the five retired topic files
// 4.5 no longer ships. Content-anchored greps against the prose section,
// not a parser.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { loadManifest } = require('../tools/upstream-drift/manifest');

const ROOT = path.join(__dirname, '..');
const PREBUILD = path.join(ROOT, 'plugin', 'skills', 'design-wrapper', 'modes', 'pre-build.md');

function getStep3Section(md) {
  const start = md.indexOf('### Step 3: Decide which Impeccable references to load');
  const end = md.indexOf('### Step 4: Load project design context');
  assert.ok(start !== -1 && end !== -1 && end > start, 'could not locate the Step 3 reference-selection section');
  return md.slice(start, end);
}

test('pre-build.md frontend reference-selection rules name Impeccable 4.5 files, not the retired topic files', () => {
  const md = readText(PREBUILD);
  const section = getStep3Section(md);

  const retired = [
    'typography.md',
    'color-and-contrast.md',
    'spatial-design.md',
    'motion-design.md',
    'interaction-design.md',
    'responsive-design.md',
    'ux-writing.md',
  ];
  for (const name of retired) {
    assert.ok(!section.includes(name), `reference-selection section still names retired Impeccable file ${name}`);
  }

  assert.match(section, /`new-work\.md`/, 'always-load set must still name new-work.md');
  assert.match(section, /`craft-floor\.md`/, 'always-load set must name craft-floor.md');
  assert.match(section, /`operate\.md`/, 'a conditional rule must name operate.md for Operate/Read surfaces');
  assert.match(section, /`adapt\.md`/, 'a conditional rule must name adapt.md (4.5 equivalent of responsive-design.md)');
  assert.match(section, /`clarify\.md`/, 'a conditional rule must name clarify.md (4.5 equivalent of ux-writing.md)');
});

test('pre-build.md terminal track always-load set is untouched by this change', () => {
  const md = readText(PREBUILD);
  assert.match(md, /`_shared\/terminal-ux\.md` plus `_shared\/design-craft\.md` only/);
});

test('every Impeccable reference file named in pre-build.md Step 3 is pinned in the upstream-drift manifest', () => {
  const md = readText(PREBUILD);
  const section = getStep3Section(md);

  const names = new Set([...section.matchAll(/`([a-z-]+\.md)`/g)].map((match) => match[1]));

  assert.ok(
    names.size >= 5,
    `expected at least 5 backticked reference-file names in Step 3, found ${names.size} (${[...names].join(', ')}) — ` +
      'a parse failure here must not silently pass as zero names, zero checks'
  );

  const manifest = loadManifest(path.join(ROOT, 'tools', 'upstream-drift', 'manifest.yml'));
  const entry = manifest.dependencies.find((d) => d.name === 'impeccable-plugin');
  assert.ok(entry, 'manifest.yml must have an impeccable-plugin dependency entry');

  for (const name of names) {
    const expected = `skills/impeccable/reference/${name}`;
    assert.ok(
      entry['contract-paths'].includes(expected),
      `pre-build.md Step 3 names \`${name}\` but ${expected} is not pinned in ` +
        'tools/upstream-drift/manifest.yml\'s impeccable-plugin contract-paths'
    );
  }
});
