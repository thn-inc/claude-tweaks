'use strict';
// #3595 D1: wrap-up's item 2 unlinks the run's open-items ledger but never
// commits it, so under pr-first the deletion reaches the branch only after
// item 4's gh pr merge has squashed the remote head. Item 2 must commit (and,
// under pr-first, push) its own path before item 4's merge runs.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const readRaw = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8');
const read = (rel) => readRaw(rel).replace(/\s+/g, ' ');

const ITEM2_PARA = "**Item 2 lands before item 4's merge (#3595).**";
const STEP6_LEDGER = "Item 2's ledger deletion is committed and, under `pr-first`, pushed before the worktree/branch-finish row runs";
const STEP6_MERGE = "runs `_shared/pr-first-merge.md`'s procedure";

function assertLedgerBeforeMerge(consoleText) {
  const step6 = consoleText.slice(consoleText.indexOf('6. Execute cleanup actions'), consoleText.indexOf('7. `Q#` queue writes'));
  const ledgerAt = step6.indexOf(STEP6_LEDGER);
  const mergeAt = step6.indexOf(STEP6_MERGE);
  assert.notStrictEqual(ledgerAt, -1, 'step 6 must carry the item 2 commit+push sentence');
  assert.notStrictEqual(mergeAt, -1, 'step 6 must carry the pr-first merge marker');
  assert.ok(ledgerAt < mergeAt, 'item 2 commit+push must precede the pr-first merge');
}

test('AC1.1: cleanup item 2 commits the ledger path alone and pushes before item 4\'s merge', () => {
  const raw = readRaw('wrap-up/cleanup-procedures.md');
  const text = read('wrap-up/cleanup-procedures.md');
  assert.ok(text.includes(ITEM2_PARA), 'item 2 paragraph must exist');
  assert.match(text, /commit the ledger path alone/);
  assert.match(text, /under `pr-first` push the branch as its own Bash call before item 4 runs/);
  assert.match(text, /`not found` report is a no-op/);
  assert.match(raw, /\| 2 \| Open items ledger \|[^\n]*?then commit only that path/);
});

test('AC1.1: review-console On approval step 6 orders the ledger commit+push before the merge', () => {
  assertLedgerBeforeMerge(read('wrap-up/review-console.md'));
});

test('go-red proof: the ledger sentence moved after the merge fails the AC1.1 order pin', () => {
  const live = read('wrap-up/review-console.md');
  assertLedgerBeforeMerge(live);
  const permuted = live.replace(STEP6_LEDGER, () => '').replace(STEP6_MERGE, (m) => `${m} ${STEP6_LEDGER}`);
  assert.notStrictEqual(permuted, live);
  assert.throws(() => assertLedgerBeforeMerge(permuted), /must precede the pr-first merge/);
});
