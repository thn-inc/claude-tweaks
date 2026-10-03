'use strict';
// tests/specify-auto-continue-conformance.test.js — pins #1137: the
// specify-auto-continue opt-in is documented at both its policy-schema.md
// definition site and its actual handoff point (CLAUDE.md's Superpowers
// overrides line + specify/SKILL.md's Auto-continue subsection), and the
// resolve-policy.js invocation shown omits --run (this check runs before any
// pipeline run directory exists).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

test('CLAUDE.md names specify-auto-continue in the Superpowers overrides line', () => {
  const text = read('CLAUDE.md');
  const line = text.split('\n').find((l) => l.includes('Superpowers overrides'));
  assert.ok(line, 'CLAUDE.md must still carry a Superpowers overrides line');
  assert.ok(line.includes('specify-auto-continue'), 'the overrides line must name the new policy key');
  assert.ok(line.includes('default `false`') || line.includes('default false'), 'the overrides line must state the default');
});

test('specify/SKILL.md documents the Auto-continue subsection with the no-run-flag resolution', () => {
  const text = read('plugin', 'skills', 'specify', 'SKILL.md');
  assert.match(text, /### Auto-continue from an approved brainstorming design doc \(opt-in\)/);
  const start = text.indexOf('### Auto-continue from an approved brainstorming design doc');
  const end = text.indexOf('## Shaping mode', start);
  const region = text.slice(start, end === -1 ? text.length : end);
  assert.match(region, /specify-auto-continue/);
  assert.match(region, /resolve-policy\.js" specify-auto-continue/, 'must show the exact no-key-args-only invocation, no --run flag');
  assert.doesNotMatch(region, /resolve-policy\.js" --run/, 'must not show a --run flag for this key — no run dir exists at the check point');
  assert.match(region, /every downstream gate/i, 'must state that /specify\'s existing gates still run — AC3');
});

test('_shared/policy-schema.md carries the specify-auto-continue lever row', () => {
  const text = read('plugin', 'skills', '_shared', 'policy-schema.md');
  assert.match(text, /`specify-auto-continue`/);
  assert.match(text, /specify-auto-continue.*`false`/);
});
