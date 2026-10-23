'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const OVERVIEW_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'overview-mode.md');
const REFINE_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'refine-mode.md');
const overviewProse = readText(OVERVIEW_PATH);
const refineProse = readText(REFINE_PATH);

// The pre-change overview-mode.md banner (#742) — the absolute clean-step-silence rule this
// change retires. Used below to prove each regex actually goes red on the text it replaces.
const PRE_CHANGE_BANNER =
  '**Failure-only narration:** interstitial status lines render only when a check fails or ' +
  'degrades (truncation warning hit, fetch fallback taken, trust fetch skipped) — never to ' +
  'announce that a step ran or passed. A clean step is silent; its output speaks through the ' +
  'report itself.\n\n## Step 1: Fetch\n';

// The window a step's one-clause reminder must appear in: the text immediately after its header.
// Shared by the shipped-prose assertions and their go-red controls so both exercise the same
// extraction [IL-105].
function textAfterHeader(prose, header) {
  const idx = prose.indexOf(header);
  assert.ok(idx >= 0, `step header not found: ${header}`);
  return prose.slice(idx + header.length, idx + header.length + 300);
}

// Whitespace-tolerant sweep for the retired absolute-rule phrasing — hard-wrapped markdown
// splits phrases across lines, so a naive single-line grep would miss a wrapped occurrence.
const RETIRED_PHRASES = [
  /render\s+only\s+when\s+a\s+check\s+fails\s+or\s+degrades/,
  /[Aa]\s+clean\s+step\s+is\s+silent/,
];

const BANNER = /\*\*Narration allowance:\*\* exactly one opening status line/;

test('overview-mode.md carries the bounded narration allowance, not the absolute rule', () => {
  assert.match(overviewProse, BANNER, 'bounded-allowance banner missing from overview-mode.md');
  assert.doesNotMatch(PRE_CHANGE_BANNER, BANNER, 'pattern must NOT match the pre-change text (proves it can go red)');
});

test('sweep: no retired clean-step-silence phrasing survives in overview-mode.md', () => {
  for (const pattern of RETIRED_PHRASES) {
    assert.doesNotMatch(overviewProse, pattern, `retired phrase ${pattern} still present in overview-mode.md`);
    // Prove the sweep itself is discriminating, not vacuous: it must catch the retired text.
    assert.match(PRE_CHANGE_BANNER, pattern, `sweep pattern ${pattern} failed to catch the pre-change banner — sweep is not discriminating`);
  }
});

test('sweep: no retired clean-step-silence phrasing survives in refine-mode.md', () => {
  for (const pattern of RETIRED_PHRASES) {
    assert.doesNotMatch(refineProse, pattern, `retired phrase ${pattern} still present in refine-mode.md`);
  }
});

const OVERVIEW_STEPS = [
  '## Step 1: Fetch',
  '## Step 1.5: Trust table (read-only)',
  '## Step 2: Route by lens',
  '## Step 3 (bare only): Recommend what to build next',
  '## Step 4: Batch emitter (bare mode)',
];

const REFINE_STEPS = [
  '## Step 1: Fetch',
  '## Step 2: Priority/Related synthesis (bounded)',
  '## Step 3: Grant-check (bounded, `work-backend: github-issues` only)',
  '## Step 3.5: Body-shape re-verification (before granting)',
  '## Step 3.6: Ceiling-authorized born-ready (`autonomy: trusted`+)',
  '## Step 4: Decision lanes',
  '## Step 5: Apply',
];

const REMINDER = /Narration allowance:/;

test('every output-emitting step in overview-mode.md carries the one-clause reminder', () => {
  // Pre-change text carries the same Step 1 header with no reminder under it — proves this can go red.
  assert.doesNotMatch(textAfterHeader(PRE_CHANGE_BANNER, '## Step 1: Fetch'), REMINDER, 'reminder must NOT be found in the pre-change text');
  for (const header of OVERVIEW_STEPS) {
    assert.match(textAfterHeader(overviewProse, header), REMINDER, `no one-clause reminder immediately after "${header}"`);
  }
});

test('every output-emitting step in refine-mode.md carries the one-clause reminder', () => {
  for (const header of REFINE_STEPS) {
    assert.match(textAfterHeader(refineProse, header), REMINDER, `no one-clause reminder immediately after "${header}"`);
  }
});

test('point-of-use failure/degradation-line conventions survive unchanged in both files', () => {
  // The Gotcha in #742's spec: "failure-only narration" legitimately survives where it names
  // the failure/degradation lines themselves — only the absolute banner was retired.
  assert.match(overviewProse, /one failure-only narration line noting the probe was unavailable/, 'overview-mode.md Step 2 native pre-attach failure-line convention was altered or removed');
  assert.match(overviewProse, /render one failure-only narration line naming exactly those ids/, 'overview-mode.md Step 3 per-node failure-line convention was altered or removed');
  assert.match(refineProse, /render one failure-only narration line naming exactly those ids/, 'refine-mode.md dependency-repair failure-line convention was altered or removed');
});
