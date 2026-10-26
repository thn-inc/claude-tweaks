'use strict';
// Conformance suite for record #1802: when a bundle member lacks auto:merge,
// `dispatch/settle-and-merge.md`'s Auto-merge gate Layer 1 falls through before Layer 2's
// merge-check ever runs, so no `needs-human` verdict exists for the #1179 carve-out
// (`console-autoresolve-needs-human-carveout.test.js`) or the #1294 reconciler-side carve-out
// (`console-execution-mergecheck-carveout.test.js`) to key on. Without its own trigger, the
// console's default-merge silently overrides the withheld grant. This suite pins the second,
// independent carve-out added to close that gap: any group member's live labels lacking
// auto:merge/matured auto:merge-pending resolves the merge half to leave-open, with no
// merge-check verdict required.
//
// Live-corpus reads are correct here (skill-prose-conformance-tests decision table: "a
// documented convention this project wants enforced"). Go-red proof [IL-105]: each pattern is
// also run against a frozen pre-change excerpt that carries the anchor but lacks the new
// carve-out, so a green result proves the pattern can fail for the attributable reason.
// Whitespace is collapsed on both haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');

const read = (rel) => collapse(readText(path.join(ROOT, rel)));
const WRAPUP_FLAT = read('plugin/skills/wrap-up/review-console.md');
const MULTISPEC_FLAT = read('plugin/skills/flow/multispec-review-console.md');
const EXECUTION_FLAT = read('plugin/skills/_shared/console-execution.md');

// Frozen pre-change excerpts — the bytes #1802's fix replaced/appended after. Each carries the
// #1179/#1294 carve-out's own closing sentence WITHOUT the new #1802 carve-out, so a
// doesNotMatch result is attributable to the new carve-out's absence, not the old one's.
const PRE_CHANGE_WRAPUP = collapse(
  '`consoleAutoResolve`\'s default-merge never overrides the more specific gate\'s routing to a '
  + 'human. Every non-merge item still auto-resolves exactly as this section states.',
);
const PRE_CHANGE_MULTISPEC = collapse(
  '`consoleAutoResolve`\'s default-merge never overrides the more specific gate\'s routing to a '
  + 'human; mirrors the single-spec carve-out in `wrap-up/review-console.md`. Every non-merge '
  + 'item still auto-resolves exactly as this section states.',
);
const PRE_CHANGE_EXECUTION = collapse(
  'This single named exception is not the general per-item floor predicate #347 '
  + '(autonomy-tiered console resolution) is expected to add later — it exists solely to close '
  + 'the specific correctness gap #1294 found; do not generalize it into a broader test or '
  + 'pre-implement #347\'s predicate here (Related, not merged scope, same as '
  + '`_shared/console-on-pr.md`\'s own note on #347).',
);

const CARVEOUT_HEADING = /Ungranted-member carve-out \(#1802\):/;
const CARVEOUT_TRIGGER = /lack(?:ing|s)? both `auto:merge`[\s\S]{0,60}?auto:merge-pending/;
const CARVEOUT_NO_VERDICT_NEEDED = /no verdict exists[\s\S]{0,120}?carry the precedence/;
const EXECUTION_SECOND_EXCEPTION = /Second narrower exception \(#1802\):/;
const EXECUTION_LIVE_REFETCH = /live re-fetch[\s\S]{0,900}?gh issue view/;

function assertPinned(liveCollapsed, pattern, control, label) {
  assert.match(liveCollapsed, pattern, `${label}: carve-out claim missing from live prose`);
  assert.doesNotMatch(control, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

test('single-spec console: ungranted-member carve-out present and go-red-proven', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_HEADING, PRE_CHANGE_WRAPUP, 'wrap-up/review-console.md');
});

test('single-spec console: carve-out triggers on a member lacking auto:merge/auto:merge-pending', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_TRIGGER, PRE_CHANGE_WRAPUP, 'wrap-up/review-console.md');
});

test('single-spec console: carve-out states no merge-check verdict is required', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_NO_VERDICT_NEEDED, PRE_CHANGE_WRAPUP, 'wrap-up/review-console.md');
});

test('multi-spec console: ungranted-member carve-out present and go-red-proven', () => {
  assertPinned(MULTISPEC_FLAT, CARVEOUT_HEADING, PRE_CHANGE_MULTISPEC, 'flow/multispec-review-console.md');
});

test('multi-spec console: carve-out triggers on a member lacking auto:merge/auto:merge-pending', () => {
  assertPinned(MULTISPEC_FLAT, CARVEOUT_TRIGGER, PRE_CHANGE_MULTISPEC, 'flow/multispec-review-console.md');
});

test('console-execution.md: second narrower exception present and go-red-proven', () => {
  assertPinned(EXECUTION_FLAT, EXECUTION_SECOND_EXCEPTION, PRE_CHANGE_EXECUTION, 'console-execution.md');
});

test('console-execution.md: second exception uses a live re-fetch, not a persisted field', () => {
  assertPinned(EXECUTION_FLAT, EXECUTION_LIVE_REFETCH, PRE_CHANGE_EXECUTION, 'console-execution.md');
});

test('console-execution.md: second exception cites #1802 and the mergeCheckVerdict omission gap', () => {
  assert.match(EXECUTION_FLAT, /Second narrower exception \(#1802\)[\s\S]{0,1300}?mergeCheckVerdict[\s\S]{0,20}?is omitted/,
    'console-execution.md must explain why the #1294 exception alone cannot cover this case');
});

test('console-execution.md: a foreign session derives group membership from PR "Fixes #n" lines, not session-scoped state', () => {
  assertPinned(
    EXECUTION_FLAT,
    /Fixes #\{n\}[\s\S]{0,60}?PR's own body/,
    PRE_CHANGE_EXECUTION,
    'console-execution.md',
  );
  assert.match(EXECUTION_FLAT, /dispatch-groups\.json[\s\S]{0,80}?session-scoped[\s\S]{0,80}?gone once that session ends/,
    'console-execution.md must state why the session-scoped group file is unavailable to a foreign session');
});
