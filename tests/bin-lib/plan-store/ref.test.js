'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { planRefName, parsePlanRefName, isPlanBasename, PLAN_REF_PREFIX, PLAN_DIR, DEFAULT_REMOTE } = require('../../../plugin/bin/lib/plan-store/ref');

test('planRefName composes the one ref name', () => {
  assert.strictEqual(planRefName(7), 'refs/claude-tweaks/plans/7');
  for (const bad of [0, -1, 1.5, '7', NaN, 2 ** 53]) assert.throws(() => planRefName(bad), TypeError);
});

test('parsePlanRefName reads only the exact namespace', () => {
  assert.strictEqual(parsePlanRefName('refs/claude-tweaks/plans/17'), 17);
  for (const bad of ['refs/claude-tweaks/plans/07', 'refs/claude-tweaks/plans/7/x', 'refs/archive/refs/claude-tweaks/plans/7',
    'refs/claude-tweaks/plans/', 'refs/heads/7', '', 'refs/claude-tweaks/plans/9007199254740993']) {
    assert.strictEqual(parsePlanRefName(bad), null);
  }
});

test('constants are the contract values', () => {
  assert.strictEqual(PLAN_REF_PREFIX, 'refs/claude-tweaks/plans/');
  assert.strictEqual(PLAN_DIR, 'docs/superpowers/plans');
  assert.strictEqual(DEFAULT_REMOTE, 'origin');
});

test('isPlanBasename accepts a plain file name and refuses every path-escaping shape', () => {
  for (const ok of ['2026-11-22-plan-7.md', 'a.md', '.hidden', '...']) assert.strictEqual(isPlanBasename(ok), true, ok);
  for (const bad of ['', '.', '..', 'a/b.md', '..\\..\\evil.md', 'a\\b.md', 'a\0b.md', '-flag.md', 7, null, undefined]) {
    assert.strictEqual(isPlanBasename(bad), false, String(bad));
  }
});
