'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

test('leftover-routing.md carries the runner-reported flakyEscalation row and wrap-up SKILL.md cites it within the byte ceiling (#1925)', () => {
  const routing = read('plugin/skills/wrap-up/leftover-routing.md');
  assert.ok(routing.includes('## Runner-reported leftovers (`flakyEscalation`)'));
  assert.ok(routing.includes('Flaky allowlist: {file} retried {n} times'));
  assert.ok(routing.includes('`Defer-reason: pre-existing-outside-diff`'));
  assert.ok(routing.includes('report.json'));
  const skill = read('plugin/skills/wrap-up/SKILL.md');
  assert.ok(skill.includes('`flakyEscalation`'));
  assert.ok(Buffer.byteLength(skill, 'utf8') <= CEILING_BYTES, `wrap-up/SKILL.md is ${Buffer.byteLength(skill, 'utf8')} bytes`);
});
