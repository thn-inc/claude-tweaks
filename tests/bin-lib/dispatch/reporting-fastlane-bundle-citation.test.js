// tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js — pins #2066: the
// dispatch-fastlane-bundles.json cache file (#1910) must actually be read somewhere, not just
// written. reporting.md documents the per-group block's fast-lane-bundle header rule, keyed on
// set-equality against that file, and SKILL.md's Step 4 selection log line names a bundle inline.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'plugin');
const REPORTING = path.join(PLUGIN, 'skills', 'dispatch', 'reporting.md');
const SKILL = path.join(PLUGIN, 'skills', 'dispatch', 'SKILL.md');
const QUEUE_PULL = path.join(PLUGIN, 'skills', 'dispatch', 'queue-pull-script.md');

test('reporting.md names dispatch-fastlane-bundles.json as a read, keyed on set-equality', () => {
  const text = fs.readFileSync(REPORTING, 'utf8');
  assert.ok(
    text.includes('dispatch-fastlane-bundles.json'),
    'reporting.md must reference dispatch-fastlane-bundles.json',
  );
  assert.ok(
    /set-equality|member set equals/.test(text),
    'reporting.md must key the bundle header on set-equality with a bundle entry',
  );
});

test("SKILL.md Step 4 selection log line carries the fast-lane bundle phrase", () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.ok(
    /minted \{\$GROUP_RUN_DIR\} for group/.test(text),
    'setup: expected the existing Step 4 selection log line to still be present',
  );
  assert.ok(
    text.includes('fast-lane bundle'),
    'SKILL.md Step 4 selection log line must name a fast-lane bundle when applicable',
  );
});

test('both queue-pull-script.md and reporting.md mention dispatch-fastlane-bundles.json (grep -rln equivalent)', () => {
  for (const file of [QUEUE_PULL, REPORTING]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(
      text.includes('dispatch-fastlane-bundles.json'),
      `${file} must reference dispatch-fastlane-bundles.json`,
    );
  }
});
