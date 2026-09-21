'use strict';
// tests/policy-schema-metadata.test.js — pins the human-facing metadata
// contract on POLICY_KEYS (summary/category/tier) and its prose twin in
// skills/_shared/policy-schema.md (and, for the 40 KB ceiling, its
// policy-schema-coverage.md sibling — #635). Same prose<->constant pattern as
// tests/hooks-gate-coverage.test.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { POLICY_KEYS, POLICY_CATEGORIES } = require('../plugin/bin/lib/policy-schema');

const MD_PATH = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema.md');
const md = fs.readFileSync(MD_PATH, 'utf8');

test('every POLICY_KEYS row carries summary, category, and tier', () => {
  for (const row of POLICY_KEYS) {
    assert.strictEqual(typeof row.summary, 'string', `${row.key}: summary missing`);
    assert.ok(row.summary.trim().length > 0, `${row.key}: summary empty`);
    assert.ok(row.summary.length <= 140, `${row.key}: summary is ${row.summary.length} chars (> 140 ceiling)`);
    assert.ok(!row.summary.includes(row.key), `${row.key}: summary contains its own key verbatim`);
    assert.ok(POLICY_CATEGORIES.includes(row.category), `${row.key}: category "${row.category}" not in POLICY_CATEGORIES`);
    assert.ok(['core', 'advanced'].includes(row.tier), `${row.key}: tier "${row.tier}" invalid`);
  }
});

test('core tier count stays at or under the enforced cap of 12', () => {
  const core = POLICY_KEYS.filter((row) => row.tier === 'core').map((row) => row.key);
  assert.ok(core.length <= 12, `core tier has ${core.length} keys (cap 12): ${core.join(', ')}`);
});

test('POLICY_CATEGORIES matches the mapping table in policy-schema.md', () => {
  const start = md.indexOf('## Metadata fields');
  assert.notStrictEqual(start, -1, 'policy-schema.md has no "## Metadata fields" section');
  const next = md.indexOf('\n## ', start + 1);
  const section = md.slice(start, next === -1 ? md.length : next);
  const tableCategories = new Set();
  for (const match of section.matchAll(/^\|[^|]+\|\s*`([a-z-]+)`\s*\|$/gm)) {
    tableCategories.add(match[1]);
  }
  assert.ok(tableCategories.size > 0, 'no section-to-category mapping rows found under "## Metadata fields"');
  assert.deepStrictEqual([...tableCategories].sort(), [...POLICY_CATEGORIES].sort(),
    'mapping-table category set diverges from POLICY_CATEGORIES');
});

test('no summary string is duplicated verbatim into policy-schema.md', () => {
  for (const row of POLICY_KEYS) {
    assert.ok(!md.includes(row.summary), `${row.key}: summary text appears verbatim in policy-schema.md`);
  }
});

// --- 40 KB ceiling — policy-schema.md and its coverage sibling (#635) ---
// Per-file 40 KB pins on policy-schema.md and policy-schema-coverage.md
// retired by #1997 — the per-file tier is a warning since #1990 and these
// files have no compose call site; removal condition in
// docs/incident-log.md [IL-153].

// #2253 (unit 3 of #2250): release-hook / release-train are schema
// scaffolding — consumed by the local engine (unit 4) and /claude-tweaks:release
// (unit 6). Both non-core by design; AC 4's check is RELATIVE to the schema's
// existing core set, never a hardcoded absolute count.
test('release-hook and release-train are registered as non-core scaffolding keys with the spec shape', () => {
  const byKey = new Map(POLICY_KEYS.map((row) => [row.key, row]));
  const hook = byKey.get('release-hook');
  const train = byKey.get('release-train');
  assert.ok(hook, 'release-hook missing from POLICY_KEYS');
  assert.ok(train, 'release-train missing from POLICY_KEYS');
  assert.strictEqual(hook.type, 'string');
  assert.strictEqual(hook.default, undefined);
  assert.strictEqual(train.type, 'boolean');
  assert.strictEqual(train.default, false);
  for (const row of [hook, train]) {
    assert.strictEqual(row.tier, 'advanced', `${row.key} must be non-core`);
    assert.strictEqual(row.category, 'housekeeping');
    assert.ok(row.summary.trim().length > 0, `${row.key}: summary empty`);
  }
  const core = POLICY_KEYS.filter((row) => row.tier === 'core').map((row) => row.key);
  const coreWithoutRelease = core.filter((key) => key !== 'release-hook' && key !== 'release-train');
  assert.deepStrictEqual(core, coreWithoutRelease, 'this unit adds no core-tier key');
});
