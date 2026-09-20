// tests/release-recommendation-gate-conformance.test.js — #2257's own #680-gating
// conformance test, scoped to flow/wrap-up's rendering logic (distinct from unit
// 6's own conformance test, which pins the fully-qualified /claude-tweaks:release
// reference form inside the release skill's own files — see this record's Gotchas:
// "don't collapse them into one or assume either unit's test covers the other's
// scope"). Pins that the three render sites (flow/summary-template.md,
// flow/multispec-summary.md's Next Actions inheritance, wrap-up/SKILL.md) all
// route the release row through the same shared gate, and that the gate itself
// states all four branches AC1 requires: non-empty unreleased -> render, empty
// array -> omit, degraded (ok: false) -> omit, absent pack -> omit.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const GATE = read('plugin', 'skills', '_shared', 'release-recommendation-gate.md');
const FLOW_SUMMARY = read('plugin', 'skills', 'flow', 'summary-template.md');
const WRAP_UP = read('plugin', 'skills', 'wrap-up', 'SKILL.md');

// The gate's four-row table, keyed by finding the line starting with each
// row's distinguishing literal — string search rather than one complex
// regex, so a table-formatting tweak (spacing, column order) can't silently
// make a row-selector regex latch onto the wrong line.
function gateRowStartingWith(prefix) {
  const line = GATE.split('\n').find((l) => l.trim().startsWith(prefix));
  assert.ok(line, `no gate table row starts with ${JSON.stringify(prefix)}`);
  return line;
}

test('AC1 case 1: a non-empty unreleased.value.commits array renders the release row', () => {
  const line = gateRowStartingWith('| `{ok: true, value: {commits: [...]}}`');
  assert.match(line, /Render.*\/claude-tweaks:release/);
});

test('AC1 case 2: a wholly empty unreleased.value.commits array omits the row', () => {
  const line = gateRowStartingWith('| `{ok: true, value: {commits: []}}`');
  assert.match(line, /\|\s*Omit/);
});

test('AC1 case 3: a degraded ({ok: false, error}) unreleased field omits the row, distinct from an empty array', () => {
  const line = gateRowStartingWith('| `{ok: false, error: ...}`');
  assert.match(line, /\|\s*Omit/);
  assert.match(line, /never recommend from an unverified premise/);
});

test('AC1 case 4: no preflight pack produced at all (absent, not merely empty) omits the row', () => {
  assert.match(GATE, /The CLI call failed, or `release-preflight\.json` could not be read at all.*Omit/);
  assert.match(GATE, /no preflight pack was produced for this run/);
});

test('the gate is a per-render-site call, never a value threaded between flow and wrap-up', () => {
  assert.match(GATE, /Run once per render site/);
});

test('flow/summary-template.md routes its release row through the shared gate, not inline logic of its own', () => {
  assert.match(FLOW_SUMMARY, /_shared\/release-recommendation-gate\.md/);
  // No leftover inline enumeration of the old bump-commit-walk vocabulary in the
  // Next Actions section specifically (the Release status: field above it still
  // legitimately cites Step 4.1's own three-outcome vocabulary — a different,
  // per-merge check this test does not touch).
  const nextActions = FLOW_SUMMARY.slice(FLOW_SUMMARY.indexOf('### Next Actions'));
  assert.doesNotMatch(nextActions, /release-backfill/);
  assert.doesNotMatch(nextActions, /plugin\/bin\/release\.js \{minor\|patch\}/);
});

test('wrap-up/SKILL.md routes its own standalone-invocation release row through the same shared gate', () => {
  assert.match(WRAP_UP, /_shared\/release-recommendation-gate\.md/);
});

test('wrap-up/SKILL.md documents that a standalone invocation runs its own pack call, not a re-read of one flow produced', () => {
  const gateRow = WRAP_UP.match(/\|[^|]*release-recommendation-gate\.md[^|]*\|[^|]*\|/);
  assert.ok(gateRow, 'expected a Next Actions signal-table row citing the shared gate');
  assert.match(gateRow[0], /standalone runs its own pack/);
});
