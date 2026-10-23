'use strict';
// Conformance suite for record #939: the Auto-merge short-circuit
// (`wrap-up/auto-merge-short-circuit.md`, cited from `wrap-up/review-console.md`'s "Auto-merge
// short-circuit" heading) bypasses Phase 4's execution step and re-implements only acceptance
// labeling and Section E's claim/grant release — leaving `cleanup-procedures.md` item 2 (Open
// items ledger deletion) unrun, so a record merged via this fast lane leaves its fully-resolved
// ledger file stranded on the integration branch. This suite pins that the short-circuit's
// procedure text now includes the ledger-deletion step, and that it runs (and is pushed, under
// `pr-first`) BEFORE the merge call, per the record's own ordering requirement.
//
// Live-corpus read is correct here (skill-prose-conformance-tests decision table: "a documented
// convention this project wants enforced"). Go-red proof [IL-105]: each pattern is also run
// against a frozen pre-change excerpt that carries the record-mode-precondition anchor but lacks
// the ledger-deletion step, so a green result proves the pattern can fail for the attributable
// reason. Whitespace is collapsed on both haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => collapse(readText(path.join(ROOT, rel)));

const SHORT_CIRCUIT_FLAT = read('plugin/skills/wrap-up/auto-merge-short-circuit.md');

// Frozen pre-change excerpt — the bytes #939's fix inserted after. Carries the record-mode
// precondition anchor and the very next heading WITHOUT the ledger-deletion step between them.
const PRE_CHANGE_EXCERPT = collapse(
  'The record-mode precondition is satisfied by construction — this short-circuit already requires a '
  + 'materialized header with a `record:` field. `auto:merge` governs merge timing only and has no '
  + 'bearing on whether the record gets `demo:pending`; `_shared/work-record.md` states that an '
  + '`auto:merge`\'d record still gets it on its now-closed issue, enabling retrospective sign-off, and '
  + 'this branch is the only place that can honor it.\n\n'
  + '**Dispatch-claim branch — check this before merging anything.**',
);

function assertPinned(pattern, label) {
  assert.match(SHORT_CIRCUIT_FLAT, pattern, `${label}: missing from live prose`);
  assert.doesNotMatch(PRE_CHANGE_EXCERPT, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

test('auto-merge-short-circuit.md: re-implements cleanup-procedures.md item 2 (ledger deletion)', () => {
  assertPinned(/cleanup-procedures\.md[\s\S]{0,40}?item 2/, 'item-2 citation');
});

test('auto-merge-short-circuit.md: deletes the ledger file via git rm + commit', () => {
  assertPinned(/git -C "\$WORKTREE_PATH" rm "\$LEDGER_FILE"/, 'git rm of the ledger file');
});

test('auto-merge-short-circuit.md: the ledger-deletion commit is stated to land before the merge', () => {
  assertPinned(/delete that deletion \*\*before\*\* the merge|commit that deletion \*\*before\*\* the merge/, 'before-merge ordering claim');
});

test('auto-merge-short-circuit.md: pr-first pushes the ledger-deletion commit before gh pr merge runs', () => {
  assertPinned(/pr-first.{0,60}push this commit now/s, 'pr-first push-before-merge step');
});

test('auto-merge-short-circuit.md: local-merge explicitly skips the push (local refs suffice)', () => {
  assertPinned(/local-merge.{0,40}skip the push above/s, 'local-merge push-skip note');
});

test('auto-merge-short-circuit.md: no ledger file is a silent no-op, not an error', () => {
  assertPinned(/is not an\s*error[\s\S]{0,60}skip silently/, 'no-ledger no-op clause');
});

test('auto-merge-short-circuit.md: cites #939', () => {
  assert.match(SHORT_CIRCUIT_FLAT, /#939/, 'must cite #939 (the record this fix closes)');
});
