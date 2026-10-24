'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const fleet = readText(path.join(ROOT, 'plugin', 'skills', 'routine', 'fleet.md'));
const skill = readText(path.join(ROOT, 'plugin', 'skills', 'routine', 'SKILL.md'));

test('fleet.md carries the status and off sections', () => {
  assert.ok(fleet.includes('## Fleet status (aggregation)'));
  assert.ok(fleet.includes('## Fleet off (pause-based shutdown)'));
});

test('fleet off pins never-delete and non-fleet scope (AC3/AC6)', () => {
  assert.ok(/never\s+deletes anything/i.test(fleet));
  assert.ok(fleet.includes('no delete API to call in the first place'));
  assert.ok(fleet.includes('never touches a routine that is not fleet-marked'));
});

test('fleet status pins posture taxonomy and counter honesty (AC2)', () => {
  assert.ok(fleet.includes('Posture taxonomy'));
  assert.ok(fleet.includes('a **supervised** fleet has no'));
  assert.ok(fleet.includes('an **unattended** fleet has the grant'));
  assert.ok(fleet.includes('Blind spot'));
  assert.ok(fleet.includes('grant-mode-audit'));
});

test('SKILL.md wires fleet status and fleet off modes', () => {
  assert.ok(/\|\s*`fleet status`\s*\|/.test(skill));
  assert.ok(/\|\s*`fleet off`\s*\|/.test(skill));
  assert.ok(!skill.includes('are a companion sub-issue, not implemented here'));
});

test('README.md and context-flow.md surface fleet status (AC5)', () => {
  const readme = readText(path.join(ROOT, 'README.md'));
  const contextFlow = readText(path.join(ROOT, 'plugin', 'skills', 'help', 'context-flow.md'));
  assert.ok(readme.includes('fleet status'));
  assert.ok(contextFlow.includes('fleet status'));
});
