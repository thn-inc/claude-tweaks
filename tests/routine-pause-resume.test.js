'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const skill = readText(path.join(ROOT, 'plugin', 'skills', 'routine', 'SKILL.md'));
const createAndUpdate = readText(path.join(ROOT, 'plugin', 'skills', 'routine', 'create-and-update.md'));
const status = readText(path.join(ROOT, 'plugin', 'skills', 'routine', 'status.md'));
const fleet = readText(path.join(ROOT, 'plugin', 'skills', 'routine', 'fleet.md'));

test('SKILL.md wires pause and resume as modes', () => {
  assert.ok(/\|\s*`pause <skill>`\s*\|/.test(skill));
  assert.ok(/\|\s*`resume <skill>`\s*\|/.test(skill));
  assert.ok(skill.includes('pause|resume'));
  assert.ok(skill.includes('### PAUSE `<skill>`'));
  assert.ok(skill.includes('### RESUME `<skill>`'));
});

test('SKILL.md fleet off row no longer cites the unlanded-verb issue number', () => {
  assert.ok(!skill.includes('#213'));
  assert.ok(skill.includes('Pauses each fleet-marked routine via the `pause` action'));
});

test('create-and-update.md defines PAUSE and RESUME as single-field RemoteTrigger update calls', () => {
  assert.ok(createAndUpdate.includes('## PAUSE `<skill>`'));
  assert.ok(createAndUpdate.includes('## RESUME `<skill>`'));
  assert.ok(createAndUpdate.includes('body: {"enabled": false}'));
  assert.ok(createAndUpdate.includes('body: {"enabled": true}'));
  // Neither action reassembles the full body the way CREATE/UPDATE do.
  assert.ok(/touching only `enabled`/.test(createAndUpdate));
});

test('status.md Step 3.5 diffs the enabled field and folds it into Drifted, never a sixth verdict', () => {
  assert.ok(status.includes('top-level `enabled` boolean'));
  assert.ok(status.includes('routine is paused (`enabled: false`)'));
  assert.ok(status.includes('folds into the **Drifted** verdict, never a sixth value'));
});

test('fleet.md Fleet off calls the pause action instead of the old no-op report', () => {
  assert.ok(!fleet.includes('#213'));
  assert.ok(fleet.includes("Pause each fleet-marked routine via the `pause` action's `RemoteTrigger update"));
  // The old unconditional no-destructive-action fallback table is gone.
  assert.ok(!fleet.includes('Fallback path (no pause verb'));
});

test('fleet.md still pins never-delete and non-fleet scope after the pause-verb landing (AC3/AC6)', () => {
  assert.ok(fleet.includes('no delete API to call in the first place'));
  assert.ok(fleet.includes('never touches a routine that is not fleet-marked'));
});

test('fleet.md round-trip note reflects real RemoteTrigger update semantics (RECONCILE never touches enabled)', () => {
  assert.ok(fleet.includes('/claude-tweaks:routine resume <skill>'));
  assert.ok(/re-running\s+`fleet on`\s+alone does not resume a paused routine/.test(fleet));
});
