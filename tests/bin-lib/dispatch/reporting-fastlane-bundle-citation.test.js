// tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js — pins #2066: the
// dispatch-fastlane-bundles.json cache file (#1910) must actually be read somewhere, not just
// written. reporting.md documents the per-group block's fast-lane-bundle header rule, keyed on
// set-equality against that file, and SKILL.md's Step 4 selection log line names a bundle inline.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'plugin');
const REPORTING = path.join(PLUGIN, 'skills', 'dispatch', 'reporting.md');
const SKILL = path.join(PLUGIN, 'skills', 'dispatch', 'SKILL.md');
const { SESSION_FILES } = require('../../../plugin/bin/lib/dispatch/queue-pull');

test('reporting.md names dispatch-fastlane-bundles.json as a read, keyed on set-equality', () => {
  const text = readText(REPORTING);
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
  const text = readText(SKILL);
  assert.ok(
    /minted \{\$GROUP_RUN_DIR\} for group/.test(text),
    'setup: expected the existing Step 4 selection log line to still be present',
  );
  assert.ok(
    text.includes('fast-lane bundle'),
    'SKILL.md Step 4 selection log line must name a fast-lane bundle when applicable',
  );
});

// #5230: the writer is the queue-pull module, which names the file among its session files (the
// write itself is pinned in queue-pull.test.js's AC2.2 oversized test).
test('the queue pull writes dispatch-fastlane-bundles.json and reporting.md reads it', () => {
  assert.ok(SESSION_FILES.includes('dispatch-fastlane-bundles.json'), 'the queue pull must name dispatch-fastlane-bundles.json among its session files');
  assert.ok(readText(REPORTING).includes('dispatch-fastlane-bundles.json'), 'reporting.md must reference dispatch-fastlane-bundles.json');
});
