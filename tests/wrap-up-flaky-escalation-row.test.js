'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

test('leftover-routing.md carries the runner-reported flakyEscalation row and wrap-up SKILL.md cites it (#1925)', () => {
  const routing = read('plugin/skills/wrap-up/leftover-routing.md');
  assert.ok(routing.includes('## Runner-reported leftovers (`flakyEscalation`)'));
  assert.ok(routing.includes('Flaky allowlist: {file} retried {n} times'));
  assert.ok(routing.includes('`Defer-reason: pre-existing-outside-diff`'));
  assert.ok(routing.includes('report.json'));
  const skill = read('plugin/skills/wrap-up/SKILL.md');
  assert.ok(skill.includes('`flakyEscalation`'));
});
