'use strict';
// Conformance suite for record #1294: the reconciler-side consoleAutoResolve executor
// (`_shared/console-execution.md`) must not auto-tick the branch-finish/merge row when a
// persisted `mergeCheckVerdict: "needs-human"` exists for the run — mirroring the render-time
// carve-out #1179 already added to `wrap-up/review-console.md` and
// `flow/multispec-review-console.md`'s own Auto-resolution short-circuits, but for the SEPARATE
// reconciler-side trigger point #1179's own spec did not scope (console-execution.md runs later,
// in a foreign session with no access to the original session's merge-check verdict, so it needs
// its OWN persisted copy to read).
//
// Live-corpus reads are correct here (skill-prose-conformance-tests decision table: "a
// documented convention this project wants enforced"). Go-red proof [IL-105]: each pattern is
// also run against a frozen pre-change excerpt that carries the anchor but lacks the carve-out,
// so a green result proves the pattern can fail for the attributable reason. Whitespace is
// collapsed on both haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');

const read = (rel) => collapse(readText(path.join(ROOT, rel)));
const EXECUTION_FLAT = read('plugin/skills/_shared/console-execution.md');
const ON_PR_FLAT = read('plugin/skills/_shared/console-on-pr.md');

// Frozen pre-change excerpt — the bytes #1294's fix replaced in console-execution.md's
// "consoleAutoResolve wiring" section. Carries the "no narrower per-item test today" anchor
// WITHOUT the carve-out, so a doesNotMatch result is attributable to the carve-out's absence.
const PRE_CHANGE_EXECUTION_PARAGRAPH = collapse(
  '**Per item, not a blanket flag:** loop over every item and ask, individually, whether it is '
  + 'floor-clearing. Today, every item the console\'s own sections cover (batch, `Q#`, `M#`, `U#`) is '
  + 'floor-clearing whenever `consoleAutoResolve` is granted — `_shared/autonomy-ceiling.md` defines the '
  + 'capability as unlocking every section uniformly, with no narrower per-item test today. Writing it '
  + 'as a per-item loop rather than one blanket "resolve everything" call is deliberate and forward '
  + 'only: #347 (autonomy-tiered console resolution) is expected to replace today\'s always-true per-item '
  + 'check with a real floor predicate later — do not pre-implement that predicate here (Related, not '
  + 'merged scope, same as `_shared/console-on-pr.md`\'s own note on #347).',
);

// Frozen pre-change excerpt for console-on-pr.md's console.json field table (before
// mergeCheckVerdict/isMergeRow existed) — carries the schema anchor without either field.
const PRE_CHANGE_ON_PR_SCHEMA = collapse(
  '`commentIds[0]` is the primary comment — the one carrying the Resolve checkbox and legend, and the '
  + 'one this file\'s find-by-marker lookup (`<!-- claude-tweaks-console: {run-id} -->` as its first '
  + 'line) always locates first. Any further entries are overflow comments (below), linked from the '
  + 'primary. `stagedHash` is each item\'s staged-file content hash at render time — `console-execution`\'s '
  + 'own drift check (not this file\'s concern) compares it against the file\'s hash at act-time to '
  + 'detect a staged proposal that changed underneath an already-rendered tick.\n\n'
  + 'Two optional fields arrive only after execution, never at render time: `executedAt` (ISO '
  + 'timestamp) and `resolved: true`, both written by `console-execution.md`\'s Write order — see that '
  + 'file for the write order and what reads them.',
);

const CARVEOUT_FIELD = /isMergeRow[\s\S]{0,80}?true/;
const CARVEOUT_CONDITION = /mergeCheckVerdict[\s\S]{0,200}?needs-human/;
const CARVEOUT_NOT_FLOOR = /isMergeRow[\s\S]{0,400}?not[\s\S]{0,40}?floor-clearing/;

function assertPinned(liveCollapsed, pattern, control, label) {
  assert.match(liveCollapsed, pattern, `${label}: carve-out claim missing from live prose`);
  assert.doesNotMatch(control, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

test('console-execution.md: isMergeRow item is singled out (go-red-proven)', () => {
  assertPinned(EXECUTION_FLAT, CARVEOUT_FIELD, PRE_CHANGE_EXECUTION_PARAGRAPH, 'console-execution.md');
});

test('console-execution.md: needs-human verdict makes the merge row not floor-clearing', () => {
  assertPinned(EXECUTION_FLAT, CARVEOUT_NOT_FLOOR, PRE_CHANGE_EXECUTION_PARAGRAPH, 'console-execution.md');
});

test('console-execution.md: the carve-out is keyed on mergeCheckVerdict: needs-human', () => {
  assertPinned(EXECUTION_FLAT, CARVEOUT_CONDITION, PRE_CHANGE_EXECUTION_PARAGRAPH, 'console-execution.md');
});

test('console-execution.md: carve-out cites #1179 as the render-time precedent it mirrors', () => {
  assert.match(EXECUTION_FLAT, /isMergeRow[\s\S]{0,600}?#1179/,
    'console-execution.md must cite #1179 (the render-time carve-out this mirrors)');
});

test('console-on-pr.md: console.json schema documents mergeCheckVerdict (go-red-proven)', () => {
  assertPinned(ON_PR_FLAT, CARVEOUT_CONDITION, PRE_CHANGE_ON_PR_SCHEMA, 'console-on-pr.md');
});

test('console-on-pr.md: console.json schema documents isMergeRow (go-red-proven)', () => {
  assertPinned(ON_PR_FLAT, CARVEOUT_FIELD, PRE_CHANGE_ON_PR_SCHEMA, 'console-on-pr.md');
});

test('console-on-pr.md: mergeCheckVerdict is written at first-render time, not re-derived later', () => {
  assert.match(ON_PR_FLAT, /mergeCheckVerdict[\s\S]{0,300}?first-render/,
    'console-on-pr.md must state mergeCheckVerdict is a render-time write');
});
