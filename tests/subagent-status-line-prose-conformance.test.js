// tests/subagent-status-line-prose-conformance.test.js
//
// Conformance test for the review skill family's status-line migration (#2267, part of the
// 5-unit status-line decomposition, parent #2264, keystone #2265). #2265 moved the canonical
// Subagent Contract status signal from a bare first-line word to a labeled trailing
// `STATUS: {WORD}` line as the reply's last non-empty line; this unit migrates the review
// family's four inline dispatch-prompt copies of the same rule to match. Pins both the
// canonical contract file (subagent-output-contract.md, #2265's own edit) and this unit's
// fullest rewrite target (step3-lens-dispatch.md) against frozen pre-migration excerpts,
// proving the go-red discrimination [IL-105] before trusting the live-text assertions.
//
// The two frozen fixtures below are hardcoded string literals captured from the actual
// pre-migration commits (subagent-output-contract.md: 546d451827, "Migrate Subagent Contract
// status line to a labeled trailing STATUS: line"; step3-lens-dispatch.md: 6bad852d68,
// "Pre-release whole-branch review fixes" — the whole-branch review pass that migrated this
// file ahead of this record's own dispatch) — never a live git read of a prior commit, so this
// test's go-red proof never depends on git history availability or edit ordering.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

function read(rel) {
  return fs.readFileSync(path.join(SKILLS_DIR, rel), 'utf8');
}

// Frozen, hardcoded pre-migration excerpt of subagent-output-contract.md's canonical
// Implementer Status Protocol framing sentence (pre-#2265, commit 546d451827~1).
const PRE_MIGRATION_CONTRACT_EXCERPT =
  'Every dispatched agent reports one of four statuses as the first line of its reply (before the output template):';

// Frozen, hardcoded pre-migration excerpt of step3-lens-dispatch.md's OUTPUT FORMAT block —
// the fullest WRONG:-example shape (pre-migration, commit 6bad852d68~1) — captured verbatim.
const PRE_MIGRATION_LENS_DISPATCH_EXCERPT = [
  'First line of your reply must be exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED — nothing before it, not even a lead-in sentence.',
  'WRONG: "Based on my review, DONE" — narration before the status word still violates this.',
  'WRONG: "I reviewed the diff and found two issues worth flagging. DONE_WITH_CONCERNS" — same violation even when the narration states real content instead of filler; the rule is about position, not about whether the lead-in is empty.',
  'Self-check before sending: is the very first token of your reply literally one of the four status words? If you were about to write a summary, transition, or acknowledgment first, delete it and start the reply with the status word instead.',
].join('\n');

// Canonical trailing-line convention pattern: "the ... last non-empty line ... STATUS: {WORD}"
// (or the literal `STATUS: {WORD}`/`STATUS: DONE` form), tolerant of the exact wording each
// site uses around it. Matches only when both the trailing-position framing AND the labeled
// STATUS: form are present together — a file that mentions "last line" without the STATUS:
// label, or STATUS: without a trailing-position claim, does not count as migrated.
const TRAILING_STATUS_LINE_RE = /last non-empty line[\s\S]{0,200}STATUS: (\{WORD\}|DONE)/;

// The retired first-line convention this migration replaces — used both as the AC4 sweep
// pattern (should return zero hits against every live producer instruction in the four review
// files) and to prove the go-red controls above actually carry the old shape.
const RETIRED_FIRST_LINE_RE = /First line: one of DONE|First line: DONE|First line of your reply must be exactly one of/;

test('subagent-output-contract.md: live text carries the canonical trailing STATUS: line convention', () => {
  const contract = read('_shared/subagent-output-contract.md');
  assert.match(
    contract,
    TRAILING_STATUS_LINE_RE,
    'subagent-output-contract.md must state the trailing STATUS: {WORD} convention'
  );
});

test('subagent-output-contract.md: go-red control — the frozen pre-#2265 excerpt does not match the trailing-line pattern', () => {
  assert.doesNotMatch(
    PRE_MIGRATION_CONTRACT_EXCERPT,
    TRAILING_STATUS_LINE_RE,
    'pre-migration excerpt must NOT match the new trailing-line pattern (proves the pattern can go red)'
  );
  assert.match(
    PRE_MIGRATION_CONTRACT_EXCERPT,
    /first line of its reply/,
    'sanity: the frozen excerpt really is the old first-line convention'
  );
});

test('step3-lens-dispatch.md: live text carries the canonical trailing STATUS: line convention', () => {
  const lensDispatch = read('review/step3-lens-dispatch.md');
  assert.match(
    lensDispatch,
    TRAILING_STATUS_LINE_RE,
    'step3-lens-dispatch.md must state the trailing STATUS: {WORD} convention'
  );
});

test('step3-lens-dispatch.md: go-red control — the frozen pre-migration WRONG:-example excerpt does not match the trailing-line pattern', () => {
  assert.doesNotMatch(
    PRE_MIGRATION_LENS_DISPATCH_EXCERPT,
    TRAILING_STATUS_LINE_RE,
    'pre-migration excerpt must NOT match the new trailing-line pattern (proves the pattern can go red)'
  );
  assert.match(
    PRE_MIGRATION_LENS_DISPATCH_EXCERPT,
    RETIRED_FIRST_LINE_RE,
    'sanity: the frozen excerpt really carries the retired first-line convention'
  );
});

test('review family: no live producer instruction still asserts the retired first-line convention', () => {
  const files = [
    'review/step3-lens-dispatch.md',
    'review/step3-routing.md',
    'review/ux-analysis.md',
    'review/step3-debate-and-refutation.md',
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(
      text,
      RETIRED_FIRST_LINE_RE,
      `${rel} still asserts the retired first-line status convention`
    );
  }
});

test('step3-debate-and-refutation.md: the consumer read of a prior agent\'s status word is untouched', () => {
  const text = read('review/step3-debate-and-refutation.md');
  assert.match(
    text,
    /Check the agent's status line first, per the Subagent Contract/,
    'the consumer-read sentence (reads a prior agent\'s already-emitted status) must remain — it is out of this migration\'s scope'
  );
});

test('step3-debate-and-refutation.md: both producer instances carry the new trailing-line instruction', () => {
  const text = read('review/step3-debate-and-refutation.md');
  const matches = text.match(/Produce your response first; the last non-empty line of your reply must then read exactly one of: DONE \/ DONE_WITH_CONCERNS \/ NEEDS_CONTEXT \/ BLOCKED, labeled `STATUS: \{WORD\}`\./g) || [];
  assert.strictEqual(matches.length, 2, 'expected exactly two producer instances (Cross-Lens Debate + Per-Candidate Refutation) carrying the new trailing-line instruction');
});
