'use strict';
// tests/wrap-up-summary-template-standalone-conformance.test.js — pins #2550's
// two prose fixes to skills/wrap-up/summary-template.md: (1) the State
// block's snapshot-staleness reconciliation note, so a Phase 3 pack snapshot
// is never pasted verbatim beside a contradicting Verdict with no reconciling
// text, and (2) the Verdict section's narrow carve-out for a `worktree-removed`
// / `run-dir-archived` verify fail that a live, not-yet-exited standalone
// session can never mechanically clear.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'summary-template.md'),
  'utf8',
);

function section(heading, nextHeadingPrefix = '### ') {
  const start = TEMPLATE.indexOf(heading);
  assert.ok(start >= 0, `summary-template.md must keep its "${heading}" section`);
  const next = TEMPLATE.indexOf(nextHeadingPrefix, start + heading.length);
  return next === -1 ? TEMPLATE.slice(start) : TEMPLATE.slice(start, next);
}

test('the State section states the pasted block is a Phase 3 snapshot and names the reconciling-delta rule', () => {
  const state = section('### State');
  assert.match(state, /Snapshot staleness note/);
  assert.match(state, /Phase 3 snapshot/);
  assert.match(state, /reconciling delta line/);
});

test('the State section\'s delta rule fires specifically on a stale-commits-vs-merged-PR mismatch', () => {
  const state = section('### State');
  assert.match(state, /"N commits, UNPUSHED" sitting/);
  assert.match(state, /"PR merged"/);
});

test('the State section never tells the composer to silently juxtapose a stale snapshot against a contradicting Verdict', () => {
  const state = section('### State');
  assert.match(state, /Never juxtapose a stale snapshot\s+against a contradicting Verdict with no reconciling text/);
});

test('the Verdict section narrowly carves out worktree-removed/run-dir-archived, naming both checks by name', () => {
  const verdict = section('### Verdict');
  assert.match(verdict, /`worktree-removed`/);
  assert.match(verdict, /`run-dir-archived`/);
  // Whitespace-spanning: the phrase can wrap across a markdown line break.
  assert.match(verdict, /not\s+applicable — pending this session's own worktree exit/);
});

test('the Verdict carve-out does not silence an unrelated failing check', () => {
  const verdict = section('### Verdict');
  assert.match(verdict, /`carrier-commit`/);
  assert.match(verdict, /still blocks exactly as before/);
  assert.match(verdict, /never a general license to downgrade an unrelated failure/);
});

test('the Verdict carve-out defers to an existing multi-spec `skip` expectation rather than re-deciding it', () => {
  const verdict = section('### Verdict');
  assert.match(verdict, /a genuine multi-spec defer is unaffected — it already\s*\nreports `skip`/);
});
