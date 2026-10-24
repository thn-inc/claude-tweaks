'use strict';
// Pins the policy-key naming convention documented in
// skills/_shared/policy-key-naming.md (stubbed as policy-schema.md's
// "## Key naming" section — that file sits at the sub-file size ceiling) (#332): keys are
// flat kebab-case identifiers — never dotted (a dotted key reads as a
// nested-YAML path in a flat-line parser and silently defaults when a user
// writes it nested), grouping lives in the `category` metadata, not the key.
// Also pins that every POLICY_KEYS key has a documented row in that file, so
// a rename that touches the schema but not the doc fails here.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { POLICY_KEYS, RENAMED_KEYS } = require('../plugin/bin/lib/policy-schema');
const { readText } = require('./helpers/read-skill');

const KEY_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MD_PATH = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema.md');

test('every POLICY_KEYS key is flat kebab-case — no dots, no uppercase, no underscores', () => {
  const offenders = POLICY_KEYS.map((row) => row.key).filter((key) => !KEY_NAME.test(key));
  assert.deepStrictEqual(offenders, [], `non-conforming key names (see policy-schema.md "## Key naming"): ${offenders.join(', ')}`);
});

test('every RENAMED_KEYS replacement name is flat kebab-case (the retired names may be anything — they are what is being migrated away from)', () => {
  const offenders = RENAMED_KEYS.map((entry) => entry.replacedBy)
    .filter((name) => name !== null)
    .filter((name) => !KEY_NAME.test(name));
  assert.deepStrictEqual(offenders, [], `non-conforming replacement names: ${offenders.join(', ')}`);
});

test('policy-schema.md documents a "## Key naming" section and every POLICY_KEYS key has a table row there', () => {
  const md = readText(MD_PATH);
  assert.ok(md.includes('\n## Key naming\n'), 'policy-schema.md has no "## Key naming" section');
  assert.ok(md.includes('_shared/policy-key-naming.md'), 'policy-schema.md\'s "## Key naming" stub must point at the full rule in _shared/policy-key-naming.md');
  const missing = POLICY_KEYS.map((row) => row.key).filter((key) => !md.includes(`| \`${key}\` |`));
  assert.deepStrictEqual(missing, [], `POLICY_KEYS keys with no documented row in policy-schema.md: ${missing.join(', ')}`);
});

test('policy-key-naming.md states the kebab-case rule the test enforces, so prose and pin cannot drift apart', () => {
  const rule = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-key-naming.md'));
  assert.ok(rule.includes(KEY_NAME.source), `policy-key-naming.md must state the exact regex ${KEY_NAME.source}`);
  assert.ok(rule.includes('No dots'), 'policy-key-naming.md must carry the "No dots" rule');
  assert.ok(rule.includes('`auto-mode`'), 'policy-key-naming.md must record the deliberate auto-mode keep verdict');
});
