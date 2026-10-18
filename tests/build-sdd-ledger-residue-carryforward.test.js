'use strict';
// tests/build-sdd-ledger-residue-carryforward.test.js — pins #1135: /build's subagent-strategy
// dispatch procedure (dispatch.md, read by SKILL.md Common Step 2's "subagent" branch) directs
// /superpowers:subagent-driven-development to copy surviving SDD deferred-minor / parked / Ruling ledger
// lines (`<workspace>/progress.md`) into the run's own open items ledger before its Finish step
// deletes the plan's SDD workspace — otherwise those lines are structurally lost, since
// /claude-tweaks:wrap-up reads only docs/plans/*-ledger.md, never the deleted SDD workspace.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');

test('dispatch.md: Common Step 2 subagent-strategy invocation directs the ledger-residue carry-forward before Finish deletes the workspace', () => {
  assert.match(
    DISPATCH,
    /Carry forward surviving SDD ledger residue before Finish/,
    'the SDD invocation instruction is missing the ledger-residue carry-forward directive'
  );
});

test('dispatch.md: the directive names the source lines (progress.md minor (deferred)/parked/Ruling markers)', () => {
  assert.match(DISPATCH, /<workspace>\/progress\.md` line matching `minor \(deferred\):`, `parked —`, or `Ruling:`/);
});

test('AC1.1 AC2.1: the directive maps deferred-minor → deferred, parked → observation, Ruling → open (three-way, first match wins)', () => {
  assert.match(
    DISPATCH,
    /this build's own open items ledger \(`\/claude-tweaks:ledger`'s Add Item operation\) — phase `build`, status `deferred` for a `minor \(deferred\):` line, `observation` for a `parked —` line, or `open` for a `Ruling:` line/
  );
  assert.doesNotMatch(DISPATCH, /or `observation` for a `parked —` or `Ruling:` line/, 'the pre-#3401 two-way mapping must be gone');
});

test('AC2.2: the classification rule — a first-match Ruling: line is load-bearing — is stated with its reason', () => {
  assert.match(DISPATCH, /whose first marker match is `Ruling:` is load-bearing — every pre-flight, mid-run, breaker, and residual final-review ruling/);
  assert.match(DISPATCH, /SDD writes the bare form only where it decided in lieu of a human, and the residual final-review shape has no pinned prefix to sniff/);
  assert.match(DISPATCH, /a `parked —` line's first match is `parked —`, so the match order already separates the two classes/);
});

test('AC2.3: the run-directory branch stages staged/sdd-ruling-{N}.md via stage-item.js --allocate, ledger first then the file, and logs STAGED', () => {
  assert.match(DISPATCH, /Item `SDD ruling — \{one-liner\}: ratify or reverse at the Review Console \(staged\/sdd-ruling-\{N\}\.md\)`/);
  assert.match(DISPATCH, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stage-item\.js" --run "\$PIPELINE_RUN_DIR" --id "sdd-ruling-\{N\}" --file \{tmp\}\.md --allocate/);
  assert.match(DISPATCH, /`Title:`.*?`Kind: sdd-ruling`.*?`Ruling:`.*?`Staged-at:`.*?`Ledger: \{ledger path\}#\{item-number\}`/);
  assert.match(DISPATCH, /STAGED \{time\} — SDD ruling carried forward: "\{one-liner\}"\. Stage path: staged\/sdd-ruling-\{N\}\.md\. Reversibility: high\./);
  const ledgerIdx = DISPATCH.indexOf('(1) append the ledger row — phase `build`, status `open`');
  const fileIdx = DISPATCH.indexOf('(2) write the staged file via');
  assert.ok(ledgerIdx > 0 && fileIdx > ledgerIdx, 'ledger row (1) must precede the staged-file write (2)');
  assert.match(DISPATCH, /ledger first, then the file/);
  assert.match(DISPATCH, /The path named by step \(3\)'s `STAGED` line and by the row's Item text is the path `stage-item\.js` actually wrote \(its first stdout line\)/);
  assert.match(DISPATCH, /`--id \{requested\} already exists in staged\/ — wrote \{actual\} instead`\), update the just-appended row's Item text to the actual path before writing the `STAGED` line/);
});

test('the no-run-directory branch keeps the row open, stages nothing, and hands the ruling to the Step 7 handoff', () => {
  assert.match(DISPATCH, /\*\*No run directory\*\* \(standalone `\/claude-tweaks:build`, no `\$PIPELINE_RUN_DIR`\): no console will read `staged\/`, so append the ledger row with status `open` and the same Item text minus the staged path, stage nothing, and list each ruling in the Step 7 handoff's `### SDD rulings` section \(`build\/handoff-template\.md`\)/);
  assert.match(DISPATCH, /`Accept` = ratify, `Keep`\/`Defer` = reverse as a follow-up, `Fix anyway` = reverse now/);
  assert.match(DISPATCH, /a ruling's text states a decision, not a defect, so it does not qualify on its own/);
});

test('dispatch.md: a line carrying two markers is copied once, under its first match', () => {
  assert.match(DISPATCH, /a line matching more than one marker is copied once, under its first match in that order/);
});

test('dispatch.md: the carry-forward states why Ruling: lines matter under SDD 6.3.0+', () => {
  assert.match(
    DISPATCH,
    /SDD 6\.3\.0\+ ledgers its pre-flight, fix-loop breaker and final-review decisions as `Ruling:` lines instead of stopping for the human/
  );
});

test('dispatch.md: the directive fires before workspace deletion, not after', () => {
  assert.match(DISPATCH, /before deleting the plan's workspace \(`rm -rf <workspace>`\), it must copy/);
});

const HANDOFF = read('plugin', 'skills', 'build', 'handoff-template.md');

test('handoff-template.md carries the standalone-build SDD rulings slot dispatch.md points at', () => {
  assert.match(HANDOFF, /### SDD rulings \(standalone build, if any\)/);
  assert.match(HANDOFF, /`Accept` = ratify, `Keep`\/`Defer` = reverse at a standalone `\/claude-tweaks:wrap-up`/);
});

test('SKILL.md Common Step 2 still points the subagent strategy at dispatch.md (the file that composes this directive)', () => {
  assert.match(
    BUILD_SKILL,
    /\*\*subagent\*\* \(default\): read `dispatch\.md` in this skill's directory and follow its full dispatch procedure/
  );
});

const APPENDIX = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');
const INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');
const CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');

test('AC5.1: the appendix maps apply on an sdd-ruling-* item to ratify (ledger accepted) and reverse to a born-ready reversal record (ledger deferred, reversed →)', () => {
  assert.ok((APPENDIX.match(/sdd-ruling/g) || []).length >= 2, 'prefix list plus the Resolution-to-step bullet');
  // Wrap-tolerant pins: `\s+` wherever the hard-wrapped bullet may break a line, so a reflow
  // with no wording change stays green (review #3401, lens 3f).
  const ws = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  assert.match(APPENDIX, ws('- `apply` on an `sdd-ruling-*` item — still step 1, but it executes no code change: it writes the item\'s `Ledger:` row back to `accepted`, Resolution `ratified at Review Console — {the ruling\'s own "— why" clause, or "no — why clause on the ruling line" when it carries none}`'));
  assert.match(APPENDIX, ws('never an empty clause: `finish-console` rejects an `accepted` entry with no resolution text before writing anything'));
  assert.match(APPENDIX, ws('through `finish-console`\'s existing `ledger` array'));
  assert.match(APPENDIX, ws('composes a born-ready record proposal exactly as `_shared/ledger-format.md`\'s Phase 3 `Keep` does (`specShapedBody`'));
  assert.match(APPENDIX, ws('`Origin: SDD ruling reversed at Review Console`; `Defer-reason: genuinely-larger`'));
  assert.match(APPENDIX, ws('stages it as `staged/ledger-record-sdd-ruling-{N}.md`, routes it through step 7 in the same pass, and — once step 7 has created the record — writes the row back to `deferred`, Resolution `reversed → #{new record}`'));
  assert.match(APPENDIX, ws('when step 7 declines or fails to create it (`refused-proposals.md`, a `gh` failure), the row stays `open` with the cause logged'));
  assert.match(APPENDIX, ws('never `deferred` without a record number'));
  assert.match(APPENDIX, ws('Outside Approve all, a ratify writes the row directly at step 1 per `_shared/staged-patch.md`\'s Write-back to the ledger'));
  assert.match(APPENDIX, ws('a `reverse` on any path writes it at step 7, as above, never at step 1'));
});

test('AC5.2: the interactive console names ratify/reverse as the Override vocabulary for a ruling row and refuses a bare skip', () => {
  assert.match(INTERACTIVE, /the Override vocabulary for one is `ratify \{#\}` \/ `reverse \{#\}`/);
  assert.match(INTERACTIVE, /A bare `skip \{#\}` on one is refused with a one-line notice naming the two/);
  assert.match(INTERACTIVE, /SDD already decided, so the human confirms or files the reversal, never leaves it undecided/);
});

test('review-console.md step 1 points an sdd-ruling-* write-back at the appendix bullet', () => {
  assert.match(CONSOLE, /an `sdd-ruling-\*` item's write-back follows `review-console-appendix\.md`'s `sdd-ruling-\*` bullet \(ratify → `accepted` here; reverse → `deferred` at step 7, once the reversal record exists\), not the patch table/);
});

test('review #3401: the carry-forward names the stage-item.js failure branch, the Item-cell rewrite rule, and the no-dedupe rule for ruling rows', () => {
  assert.match(DISPATCH, /If `stage-item\.js` exits non-zero, write no `STAGED` line: rewrite the row's Item text without its `\(staged\/…\)` suffix/);
  assert.match(DISPATCH, /SKIP \{time\} — SDD ruling carry-forward \(degraded\): condition: stage-item\.js exited \{code\} for sdd-ruling-\{N\} \(\{first stderr line\}\) → fallback: ledger row #\{item\} left open with no staged file/);
  assert.match(DISPATCH, /the same operation, not an Update Item/);
  assert.match(DISPATCH, /De-duplication on Append never skips a ruling row/);
  assert.match(DISPATCH, /takes the staged extension from the source; the file opens with a header block `Title:`/);
});
