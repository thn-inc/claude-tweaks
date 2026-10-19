'use strict';
// tests/build-review-finding-deferral-gate.test.js — pins #3004: /build routes every Minor-or-higher
// review finding through _shared/deferral-gate.md — fixed in the build, or carried to the ledger only
// with exactly one Defer-reason — at the SDD invocation (dispatch.md) and at Common Step 4's
// ledger-write step (SKILL.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');

function assertRule(text) {
  assert.match(
    text,
    /_shared\/deferral-gate\.md`'s fix-now check with exactly one `Defer-reason:`/,
    'the deferral-gate fix-now check with exactly one Defer-reason is not cited'
  );
  assert.match(
    text,
    /Severity alone \("minor", "fine to defer"\) is never a reason\./,
    'the severity-alone-is-never-a-reason sentence is missing'
  );
}

const step4Slice = () => {
  const start = BUILD_SKILL.indexOf('### Common Step 4: Handle Blocked Work');
  const end = BUILD_SKILL.indexOf('### Common Step 4.5');
  assert.ok(start !== -1 && end > start, 'Common Step 4 section not found');
  return BUILD_SKILL.slice(start, end);
};

test('AC1.1: dispatch.md SDD invocation cites the deferral gate for review findings', () => {
  const para = DISPATCH.split(/\n\s*\n/).find((p) => p.includes('/superpowers:subagent-driven-development'));
  assert.ok(para, 'no dispatch.md paragraph names /superpowers:subagent-driven-development');
  assertRule(para);
  assert.match(
    para,
    /every Minor \(or higher\) finding from a per-task reviewer or the whole-branch review is either fixed in this build, or carried to the ledger only after passing/
  );
  assert.match(para, /`minor \(deferred\):` line carries its `Defer-reason: \{value\}`/);
});

test('AC1.1: build/SKILL.md Common Step 4 cites the deferral gate at the ledger-write step', () => {
  const slice = step4Slice();
  assertRule(slice);
  assert.match(slice, /`Defer-reason: blocked-dependency` or `blocked-external`/);
});

test('AC1.2: go-red control — the shared assertion fails on text without the rule', () => {
  const slice = step4Slice();
  assert.throws(() => assertRule(slice.replace(/Severity alone[^.]*\./, '')));
});
