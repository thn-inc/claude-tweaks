// tests/design-variant-exploration-availability-order.test.js — pins #2540's ordering
// contract: the exact-pin availability check must run BEFORE any tournament/live offer
// is presented, never discovered only after a "Recommended" pick returns {skipped}.
// Without this test, a future edit could silently move the availability check back
// after the AskUserQuestion offers (or after Scope resolution in explore.md) with
// nothing to catch the regression — the exact gap #2540's Current State described.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');

const requireOrder = (text, markers, label) => {
  let last = -1;
  let lastMarker = null;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `${label}: missing marker "${marker}"`);
    assert.ok(
      idx > last,
      `${label}: "${marker}" must appear after "${lastMarker}", but it does not (order regressed)`
    );
    last = idx;
    lastMarker = marker;
  }
};

test('explore.md: Availability check runs before Scope resolution', () => {
  const text = read('design-wrapper', 'modes', 'explore.md');
  requireOrder(
    text,
    ['## Availability (exact-pin, checked before any option is presented)', '## Scope resolution'],
    'explore.md'
  );
});

test('design-pre-steps.md Step 2.5b-ii: policy gate, then availability pre-check, then either offer branch', () => {
  const text = read('specify', 'design-pre-steps.md');
  requireOrder(
    text,
    [
      '## Step 2.5b-ii: Variant exploration',
      '**Policy gate.**',
      '**Exact-pin availability pre-check.**',
      '### No `DESIGN.md` — identity branch',
      '### `DESIGN.md` present — layout branch',
    ],
    'design-pre-steps.md'
  );
});

test('design-pre-steps.md: both AskUserQuestion offer branches read EXPLORE_AVAILABLE, never recommend an unavailable pin', () => {
  const text = read('specify', 'design-pre-steps.md');
  const occurrences = text.split('**Call `AskUserQuestion`** — Option 1 below renders per the Exact-pin availability pre-check above').length - 1;
  assert.strictEqual(occurrences, 2, 'both offer branches (identity, layout) must gate Option 1 on EXPLORE_AVAILABLE');
});

test('design-variant-exploration: off skips Step 2.5b-ii entirely before any offer renders', () => {
  const text = read('specify', 'design-pre-steps.md');
  const gateIdx = text.indexOf('**Policy gate.**');
  const skipIdx = text.indexOf('At the default `off`, skip this step entirely');
  assert.ok(gateIdx !== -1 && skipIdx !== -1 && skipIdx > gateIdx, 'the off-default skip clause must live inside the policy gate paragraph');
});

test('live.md: live-inject is scoped to --target, not the whole scaffold directory (#2540)', () => {
  const text = read('design-wrapper', 'modes', 'live.md');
  assert.ok(text.includes('Scope injection to `<target>` only'), 'live.md must document target-scoped injection');
  assert.ok(text.includes('--target <path>'), 'live.md must cite the upstream --target scoping mechanism');
});
