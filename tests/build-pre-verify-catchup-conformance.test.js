'use strict';
// tests/build-pre-verify-catchup-conformance.test.js — #4343: pins the prose that moves build's
// catch-up merge with the integration branch ahead of Common Step 5's verification run —
// _shared/pre-verification-catchup.md (the single home of the procedure), the residual note in
// _shared/git-discipline.md's Post-push merge-state check, and the
// _shared/integration-model.md Consumer-table row.
//
// Live prose is read here legitimately: the prose is the contract, so updating these sentences
// is the intended response to a change in the contract they state (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const PVC = read('plugin/skills/_shared/pre-verification-catchup.md');
const GD = read('plugin/skills/_shared/git-discipline.md');
const IM = read('plugin/skills/_shared/integration-model.md');

const TITLE = '# Pre-verification Catch-up';
const OLD_HEADING = '### Pre-verification catch-up';
const POST_PUSH = '### Post-push merge-state check';
const CATCH_UP = '**Catch-up (`auto`).**';

// Every marker must exist before positions are compared: indexOf's -1 is below every
// real position, so a reworded marker would otherwise leave the pin green.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

const collapse = (s) => s.replace(/\s+/g, ' ');

// The facts of one region are checked over its whitespace-collapsed text, so a line wrap
// inside a needle is fine; the result names the facts whose needle is absent.
const missingFacts = (facts, region) => {
  const s = collapse(region);
  return facts.filter((f) => !s.includes(f.needle)).map((f) => f.name);
};

// The whole procedure file, collapsed, its title asserted.
function procedure(text) {
  assert.ok(text.startsWith(`${TITLE}\n`), `marker missing: ${TITLE}`);
  return collapse(text);
}

const PVC_FACTS = [
  { name: 'runs last before Common Step 5', needle: "run by `/claude-tweaks:build` last before Common Step 5's verification run" },
  { name: 'verified tree carries the base', needle: '`VERIFICATION_SHA` is the post-merge HEAD' },
  { name: 'not overlap-gated', needle: 'it is not overlap-gated' },
  { name: 'once, not after a fix', needle: 'a re-run after a fix does not repeat it' },
  { name: 'pr-first worktree only', needle: 'Only a `pr-first` worktree run catches up' },
  { name: 'never inside a multi-spec run', needle: 'and never inside a multi-spec run' },
  { name: "resolves the run's model", needle: '--values integration-model --run "$PIPELINE_RUN_DIR"' },
  { name: 'unresolved model merges nothing', needle: 'When it exits non-zero or prints nothing, merge nothing and log one `SKIP`' },
  { name: 'unresolved model SKIP', needle: 'condition: integration-model unresolved → fallback: no pre-verification catch-up' },
  { name: 'local-merge SKIP names the model', needle: 'condition: integration-model local-merge → fallback: no pre-verification catch-up' },
  { name: 'current-branch SKIP', needle: 'condition: current-branch strategy → fallback: no pre-verification catch-up' },
  { name: 'multi-spec SKIP', needle: "condition: multi-spec shared branch (MULTISPEC_SHARED_WORKTREE=1 or MULTISPEC_PARALLEL_WAVE=1) → fallback: no pre-verification catch-up; flow/multispec-freshness.md's boundary check owns upstream merges" },
  { name: 'multi-spec: the HARD-GATE must see the drift', needle: 'boundary-freshness escalation is a registered HARD-GATE (`_shared/auto-mode-contract.md`) that must still see the drift' },
  { name: 'every mode, no stop', needle: 'in every mode — `auto`, `confirm`, `interactive` and `hybrid` alike, and a standalone `/claude-tweaks:build` — and adds no stop' },
  { name: 'cites Catch-up steps 1-4', needle: "Run `_shared/git-discipline.md`'s Catch-up (`auto`) steps 1-4" },
  { name: 'merge never rebase', needle: 'merge, never rebase' },
  { name: 'logs under its own step', needle: '--step "Pre-verification catch-up"' },
  { name: 'no push', needle: 'Nothing is pushed: the build phase exit pushes the merged branch' },
  { name: 'no conflict line', needle: 'There is no PR conflict line to surface' },
  { name: 'dirty tree SKIP', needle: 'condition: uncommitted changes in the worktree → fallback: catch-up not run; verifying the un-merged tree' },
  { name: 'fetch failure fails open', needle: 'condition: fetch failed → fallback: catch-up not run; verifying the un-merged tree' },
  { name: 'no comparison after a SKIP exit', needle: 'Either way the comparison in difference 5 does not run' },
  { name: 'never asks', needle: '"ask the user" fallback never applies, in any mode' },
  { name: 'abort verifies un-merged', needle: 'aborted on a conflict it could not resolve confidently — verifying the un-merged tree' },
  { name: 'no comparison after an abort', needle: 'skip the comparison in difference 5, and run the verification on the un-merged tree' },
  { name: 'non-conflict merge failure', needle: 'condition: merge with origin/{integration-branch} failed ({reason}) → fallback: catch-up not run; verifying the un-merged tree' },
  { name: 'no comparison after a merge failure', needle: 'skip the comparison in difference 5 as well' },
  { name: 'resolved conflict committed first', needle: 'A resolved conflict is committed before HEAD is compared' },
  { name: 'already current is a SKIP', needle: 'condition: branch already contains origin/{integration-branch} → fallback: nothing merged' },
  { name: 'advanced logs before and after', needle: 'merged origin/{integration-branch} before the verification run ({before short} → {after short})' },
  { name: 'rev-parse failure fails open', needle: 'condition: rev-parse failed → fallback: catch-up outcome not compared; verifying the tree as it stands' },
  { name: 'step-3 rev-parse failure: no merge', needle: 'A failed Catch-up step 3 `rev-parse` (no `{before short}`) logs that same `SKIP` and the merge is not attempted' },
  { name: 'no run dir reports in handoff', needle: "each `SKIP` goes to the Step 7 handoff's Skipped steps section instead" },
  { name: 'post-push check stays', needle: "`_shared/git-discipline.md`'s Post-push merge-state check stays" },
  // The abort path and its data-safety rule carry their own pins: the log-text needles above
  // would stay green if the `merge --abort` instruction or the untracked-files rule were dropped.
  { name: 'abort is its own Bash call', needle: 'run `merge --abort` (its own Bash call), log `--status AUTO' },
  { name: 'abort entry replaces the step-4 one', needle: "in place of Catch-up step 4's own abort entry" },
  { name: 'never move untracked files', needle: 'Never move or delete the untracked files to get past it' },
  { name: 'failed commit of a resolved conflict aborts', needle: 'A failed `add` or `commit` (a pre-commit hook rejecting the merge commit, a path left unmerged) is handled as in difference 4' },
  { name: 'failed commit SKIP', needle: 'condition: commit of the resolved merge with origin/{integration-branch} failed ({reason}) → fallback: catch-up not run; verifying the un-merged tree' },
  { name: 'merge in progress SKIP', needle: 'condition: merge already in progress (MERGE_HEAD set) → fallback: catch-up not run; verifying the tree as it stands' },
  { name: 'SKIP step carries (skipped)', needle: 'with ` (skipped)` appended to the step on a `SKIP` call' },
  { name: 'once: the fix is re-verified on a stable tree', needle: 'so the tree a fix is re-verified on does not move again' },
  { name: 'multi-spec: pre-review catch-up is overlap-gated', needle: 'it merges only upstream commits that touch files the branch changed' },
];

const STEP_FLAGS = '--step "Pre-verification catch-up"';
const GATE = 'Only a `pr-first` worktree run catches up';
const STEPS = "Run `_shared/git-discipline.md`'s Catch-up (`auto`) steps 1-4";
// The Scope guards sit between the gate and the Procedure: the unresolved-model SKIP, then the
// multi-spec SKIP and the reason sentence that follows it.
const UNRESOLVED_SKIP = 'condition: integration-model unresolved → fallback: no pre-verification catch-up';
const MULTI_SKIP = 'condition: multi-spec shared branch';
const MULTI_REASON = 'A multi-spec run skips even under `pr-first` because';

function assertPreVerifyProcedure(text) {
  const s = procedure(text);
  // The log-decision flags (read by the gate SKIPs) open the file, and the model gate precedes
  // the fetch: the gate paragraph comes before the Scope guards and the paragraph citing the steps.
  requireOrder(s, [STEP_FLAGS, GATE, UNRESOLVED_SKIP, MULTI_SKIP, MULTI_REASON, STEPS]);
  assert.deepEqual(missingFacts(PVC_FACTS, s), [], 'Pre-verification catch-up facts');
}

const RESIDUAL_STATE = 'this read normally prints `no-conflict`';
const RESIDUAL = 'already merged the integration branch in before its final verification (`_shared/pre-verification-catchup.md`)';

// git-discipline.md no longer carries the procedure; its Post-push merge-state check names the
// residual case and cites the procedure's own file.
function assertGitDisciplineResidual(text) {
  assert.ok(!text.includes(OLD_HEADING), 'git-discipline.md still carries the Pre-verification catch-up subsection');
  const from = text.indexOf(POST_PUSH);
  assert.notStrictEqual(from, -1, `marker missing: ${POST_PUSH}`);
  const to = text.indexOf(CATCH_UP, from);
  assert.notStrictEqual(to, -1, `marker missing: ${CATCH_UP}`);
  const s = collapse(text.slice(from, to));
  assert.ok(s.includes(RESIDUAL_STATE), 'post-push residual sentence does not name the no-conflict read');
  assert.ok(s.includes(RESIDUAL), 'post-push residual sentence missing');
}

const CONSUMER_ROW = 'Common Step 5, `_shared/pre-verification-catchup.md`';

function assertConsumerRow(text) {
  const from = text.indexOf('## Consumer table');
  assert.notStrictEqual(from, -1, 'marker missing: ## Consumer table');
  const next = text.indexOf('\n## ', from + 1);
  const table = next === -1 ? text.slice(from) : text.slice(from, next);
  const hit = table.split('\n').some((l) => l.startsWith('| ') && l.includes(CONSUMER_ROW));
  assert.ok(hit, 'integration-model.md Consumer table lacks the Pre-verification catch-up row');
}

test('AC1.1/AC2.1/AC4.1/AC5.1: _shared/pre-verification-catchup.md states the procedure', () => {
  assertPreVerifyProcedure(PVC);
});

test('AC1.1 go-red: each Pre-verification catch-up fact goes red alone', () => {
  const s = procedure(PVC);
  for (const f of PVC_FACTS) {
    assert.equal(s.split(f.needle).length, 2, `needle must occur exactly once in the file: ${f.name}`);
    const m = s.replace(f.needle, '');
    assert.notEqual(m, s, f.name);
    assert.deepEqual(missingFacts(PVC_FACTS, m), [f.name], f.name);
  }
});

test('AC1.1 go-red: the file without its title fails the heading check', () => {
  const absent = PVC.replace(`${TITLE}\n`, '');
  assert.notEqual(absent, PVC);
  assert.throws(() => assertPreVerifyProcedure(absent), /marker missing: # Pre-verification Catch-up/);
});

test('AC2.1 go-red: the model gate placed after the Catch-up steps fails the order check', () => {
  const paras = PVC.split('\n\n');
  const gate = paras.findIndex((p) => p.startsWith(GATE));
  const steps = paras.findIndex((p) => p.startsWith('A `pr-first` worktree run catches up in every mode'));
  assert.ok(gate !== -1 && steps !== -1 && gate < steps, 'gate and steps paragraphs not found in order');
  const swappedParas = paras.slice();
  [swappedParas[gate], swappedParas[steps]] = [paras[steps], paras[gate]];
  const swapped = swappedParas.join('\n\n');
  assert.notEqual(swapped, PVC);
  assert.throws(() => assertPreVerifyProcedure(swapped), /Run `_shared\/git-discipline\.md`'s Catch-up \(`auto`\) steps 1-4 must come after the previous marker/);
  // Deletion control: the existence half of the gate marker has its own message.
  const absent = PVC.replace(GATE, 'Only a pr-first worktree run catching up');
  assert.notEqual(absent, PVC);
  assert.throws(() => assertPreVerifyProcedure(absent), /marker missing: Only a `pr-first` worktree run catches up/);
});

test('AC2.1 go-red: the multi-spec SKIP and reason moved after the Procedure paragraph fail the order check', () => {
  const from = PVC.indexOf('`--text "' + MULTI_SKIP);
  const reasonAt = PVC.indexOf(MULTI_REASON);
  const end = PVC.indexOf('\n\n## Procedure');
  assert.ok(from !== -1 && reasonAt > from && end > reasonAt, 'multi-spec SKIP and reason not found in order');
  const STEPS_MSG = /Run `_shared\/git-discipline\.md`'s Catch-up \(`auto`\) steps 1-4 must come after the previous marker/;
  // Both the SKIP and the reason sentence move to the end of the file, behind the Procedure paragraph.
  const both = `${PVC.slice(0, from).trimEnd()}\n${PVC.slice(end)}\n\n${PVC.slice(from, end)}\n`;
  assert.notEqual(both, PVC);
  assert.throws(() => assertPreVerifyProcedure(both), STEPS_MSG);
  // The reason sentence alone moves: it has its own marker, so the order check still goes red.
  const reasonEnd = PVC.indexOf('\n', reasonAt);
  const alone = `${PVC.slice(0, reasonAt)}${PVC.slice(reasonEnd + 1)}\n${PVC.slice(reasonAt, reasonEnd)}\n`;
  assert.notEqual(alone, PVC);
  assert.throws(() => assertPreVerifyProcedure(alone), STEPS_MSG);
});

// Each guard marker carries its own permutation control: both controls above move the reason
// sentence, so dropping UNRESOLVED_SKIP or MULTI_SKIP from the marker list would keep them green.
// Moves the whole line carrying `needle` to the end of the file, behind the Procedure paragraph.
function moveLineBehindProcedure(text, needle) {
  const at = text.indexOf(needle);
  assert.notStrictEqual(at, -1, `line not found: ${needle}`);
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  assert.ok(end > at && end < text.indexOf('\n\n## Procedure'), 'line not found before the Procedure heading');
  return `${text.slice(0, start)}${text.slice(end + 1)}\n${text.slice(start, end)}\n`;
}

test('AC2.1 go-red: the unresolved-model SKIP alone moved after the Procedure paragraph fails the order check', () => {
  const mutated = moveLineBehindProcedure(PVC, UNRESOLVED_SKIP);
  assert.notEqual(mutated, PVC);
  assert.throws(() => assertPreVerifyProcedure(mutated), /condition: multi-spec shared branch must come after the previous marker/);
});

test('AC2.1 go-red: the multi-spec SKIP alone moved after the Procedure paragraph fails the order check', () => {
  const mutated = moveLineBehindProcedure(PVC, '`--text "' + MULTI_SKIP);
  assert.notEqual(mutated, PVC);
  assert.throws(() => assertPreVerifyProcedure(mutated), /A multi-spec run skips even under `pr-first` because must come after the previous marker/);
});

test('AC1.1 go-red: the log-decision flags placed after the gate SKIPs fail the order check', () => {
  const moved = `${PVC.replace(STEP_FLAGS, '--step "elsewhere"')}\n${STEP_FLAGS}\n`;
  assert.notEqual(moved, PVC);
  assert.throws(() => assertPreVerifyProcedure(moved), /Only a `pr-first` worktree run catches up must come after the previous marker/);
  // Deletion control: the existence half of the flags marker has its own message.
  const absent = PVC.replace(STEP_FLAGS, '--step "elsewhere"');
  assert.notEqual(absent, PVC);
  assert.throws(() => assertPreVerifyProcedure(absent), /marker missing: --step "Pre-verification catch-up"/);
});

test('Deliverable 3: git-discipline.md drops the subsection and its Post-push check cites the procedure', () => {
  assertGitDisciplineResidual(GD);
  const restored = GD.replace('## Catching a branch up with `main`', `${OLD_HEADING}\n\n## Catching a branch up with \`main\``);
  assert.notEqual(restored, GD);
  assert.throws(() => assertGitDisciplineResidual(restored), /git-discipline\.md still carries the Pre-verification catch-up subsection/);
  const noState = collapse(GD).replace(RESIDUAL_STATE, '');
  assert.notEqual(noState, collapse(GD));
  assert.throws(() => assertGitDisciplineResidual(noState), /post-push residual sentence does not name the no-conflict read/);
  const noResidual = collapse(GD).replace(RESIDUAL, '');
  assert.notEqual(noResidual, collapse(GD));
  assert.throws(() => assertGitDisciplineResidual(noResidual), /post-push residual sentence missing/);
});

// The procedure cites git-discipline.md's Catch-up (`auto`) steps 1-4 by number and compares
// HEAD against step 3's `{before short}`: pin that list's order so a renumbering there cannot
// silently re-point this file.
const CATCH_UP_STEPS = [
  '1. `git -C "{worktree-path}" status --porcelain`',
  '2. `git -C "{worktree-path}" fetch origin "{integration-branch}"`',
  '3. `git -C "{worktree-path}" rev-parse --short HEAD`',
  '4. `git -C "{worktree-path}" merge --no-edit "origin/{integration-branch}"`',
  '5. `git -C "{worktree-path}" rev-parse --short HEAD`',
];

function assertCatchUpStepOrder(text) {
  const from = text.indexOf(CATCH_UP);
  assert.notStrictEqual(from, -1, `marker missing: ${CATCH_UP}`);
  const to = text.indexOf('## Catching a branch up with `main`', from);
  assert.notStrictEqual(to, -1, 'marker missing: ## Catching a branch up with `main`');
  requireOrder(text.slice(from, to), CATCH_UP_STEPS);
}

test('AC5.1: git-discipline.md\'s Catch-up (auto) steps 1-4 are still status, fetch, rev-parse, merge', () => {
  assertCatchUpStepOrder(GD);
  // Swapping the fetch and the pre-merge rev-parse renumbers what "Catch-up step 3" means here.
  const [fetch, before] = [CATCH_UP_STEPS[1], CATCH_UP_STEPS[2]];
  const swapped = GD.replace(fetch, '@@FETCH@@').replace(before, fetch).replace('@@FETCH@@', before);
  assert.notEqual(swapped, GD);
  assert.throws(() => assertCatchUpStepOrder(swapped), /must come after the previous marker/);
  const dropped = GD.replace(CATCH_UP_STEPS[3], '4. `git merge`');
  assert.notEqual(dropped, GD);
  assert.throws(() => assertCatchUpStepOrder(dropped), /marker missing: 4\. /);
});

test('AC2.1: integration-model.md lists the Pre-verification catch-up as a consumer', () => {
  assertConsumerRow(IM);
  const mutated = IM.replace(CONSUMER_ROW, '');
  assert.notEqual(mutated, IM);
  assert.throws(() => assertConsumerRow(mutated), /Consumer table lacks the Pre-verification catch-up row/);
});

// ---- The call site (build Common Step 5), the handoff line, and /test's Match branch.

const BUILD = read('plugin/skills/build/SKILL.md');
const HANDOFF = read('plugin/skills/build/handoff-template.md');
const VERIFICATION = read('plugin/skills/test/verification.md');

const STEP5 = '### Common Step 5: Final Verification';
const CATCHUP = '**Catch up before verifying (#4343).**';

// Common Step 5: from its heading to the next step heading, the heading asserted.
function step5(text) {
  const from = text.indexOf(STEP5);
  assert.notStrictEqual(from, -1, `marker missing: ${STEP5}`);
  const to = text.indexOf('\n### ', from + 1);
  return to === -1 ? text.slice(from) : text.slice(from, to);
}

const BUILD_FACTS = [
  { name: 'after Category A fixes', needle: 'Immediately before that run and after any Category A fix commit' },
  { name: 'cites the shared procedure', needle: 'run `_shared/pre-verification-catchup.md`' },
  { name: 'single-spec pr-first worktree, every mode', needle: 'a single-spec `pr-first` worktree run, in every mode, merges in a moved base' },
  { name: 'VERIFICATION_SHA is post-merge', needle: '`VERIFICATION_SHA` is then the post-merge HEAD' },
  { name: 'others log a SKIP', needle: 'any other run logs its `SKIP`' },
  { name: 'not repeated after a fix', needle: 'It is not repeated before a re-run after a fix' },
  { name: 'abort verifies un-merged', needle: 'aborts the merge, and the run verifies the un-merged tree' },
];

function assertCatchupBeforeVerify(text) {
  const s = step5(text);
  requireOrder(s, ['run the shared verification procedure', '**Operational fixes first (#3489).**', CATCHUP, '**Note:**']);
  assert.deepEqual(missingFacts(BUILD_FACTS, collapse(s)), [], 'Common Step 5 catch-up facts');
}

const HANDOFF_LINE = '- Pre-verification catch-up: {merged origin/{integration-branch} ({before short} → {after short}) | already current | aborted on a conflict — verified the un-merged tree | skipped — {condition}}';

function assertHandoffLine(text) {
  const from = text.indexOf('### Verification');
  assert.notStrictEqual(from, -1, 'marker missing: ### Verification');
  const to = text.indexOf('### What was built', from);
  assert.notStrictEqual(to, -1, 'marker missing: ### What was built');
  assert.ok(text.slice(from, to).includes(HANDOFF_LINE), 'handoff Verification list lacks the pre-verification catch-up line');
}

const MATCH_NOTE = "build's Pre-verification catch-up (`_shared/pre-verification-catchup.md`) merges the integration branch in before its own run";
const MATCH_SHA_NOTE = '`VERIFICATION_SHA` already names the merged HEAD';
const MISMATCH_NOTE = 'a later bookkeeping-only commit takes the Mismatch branch below, which runs no suite either';

function assertMatchBullet(text) {
  const from = text.indexOf('### Skip-if-recent (for /flow pipelines)');
  assert.notStrictEqual(from, -1, 'marker missing: ### Skip-if-recent (for /flow pipelines)');
  const next = text.indexOf('\n### ', from + 1);
  const region = next === -1 ? text.slice(from) : text.slice(from, next);
  const line = region.split('\n').find((l) => l.startsWith('- **Match**'));
  assert.ok(line, 'marker missing: - **Match**');
  const s = collapse(line);
  assert.ok(s.includes(MATCH_NOTE), 'Match bullet does not name the pre-verification catch-up');
  assert.ok(s.includes(MATCH_SHA_NOTE), 'Match bullet does not say VERIFICATION_SHA names the merged HEAD');
  assert.ok(s.includes(MISMATCH_NOTE), 'Match bullet does not name the bookkeeping-only Mismatch path');
}

test('AC1.1/AC6.1: Common Step 5 places the catch-up before the verification run', () => {
  assertCatchupBeforeVerify(BUILD);
});

// BUILD split around the catch-up paragraph: the paragraph (with its trailing blank line) and the
// text without it.
function splitOutCatchupParagraph() {
  const from = BUILD.indexOf(CATCHUP);
  assert.notStrictEqual(from, -1, 'catch-up paragraph missing from the live text');
  const end = BUILD.indexOf('\n\n', from);
  assert.notStrictEqual(end, -1);
  return { paragraph: BUILD.slice(from, end + 2), without: BUILD.slice(0, from) + BUILD.slice(end + 2) };
}

test('AC6.1 go-red: Common Step 5 without the catch-up paragraph fails', () => {
  const { without } = splitOutCatchupParagraph();
  assert.notEqual(without, BUILD);
  assert.throws(() => assertCatchupBeforeVerify(without), /marker missing: \*\*Catch up before verifying \(#4343\)\.\*\*/);
});

test('AC6.1 go-red: the catch-up paragraph spliced above the verification sentence fails the order check', () => {
  const { paragraph, without } = splitOutCatchupParagraph();
  const at = without.indexOf('After Common Steps 6 and 6.5, so the verified tree');
  assert.notStrictEqual(at, -1, 'verification sentence missing from the live text');
  const spliced = without.slice(0, at) + paragraph + without.slice(at);
  assert.notEqual(spliced, BUILD);
  assert.throws(() => assertCatchupBeforeVerify(spliced), /\*\*Catch up before verifying \(#4343\)\.\*\* must come after the previous marker/);
});

test('AC6.1 go-red: the catch-up paragraph drifted after the Note paragraph fails the order check', () => {
  const { paragraph, without } = splitOutCatchupParagraph();
  const note = without.indexOf('**Note:**');
  assert.notStrictEqual(note, -1, 'Note paragraph missing from the live text');
  const noteEnd = without.indexOf('\n\n', note);
  assert.notStrictEqual(noteEnd, -1, 'Note paragraph end missing from the live text');
  const drifted = without.slice(0, noteEnd + 2) + paragraph + without.slice(noteEnd + 2);
  assert.notEqual(drifted, BUILD);
  // The drifted paragraph must still sit inside Common Step 5, so the failure is the order check.
  assert.ok(step5(drifted).includes(CATCHUP), 'drifted paragraph left Common Step 5');
  assert.throws(() => assertCatchupBeforeVerify(drifted), /\*\*Note:\*\* must come after the previous marker/);
});

test('AC1.1 go-red: each Common Step 5 fact goes red alone', () => {
  const s = collapse(step5(BUILD));
  for (const f of BUILD_FACTS) {
    assert.equal(s.split(f.needle).length, 2, `needle must occur exactly once in Common Step 5: ${f.name}`);
    const m = s.replace(f.needle, '');
    assert.notEqual(m, s, f.name);
    assert.deepEqual(missingFacts(BUILD_FACTS, m), [f.name], f.name);
  }
});

test('AC1.1: the build handoff names the catch-up outcome (standalone builds report it there)', () => {
  assertHandoffLine(HANDOFF);
  const mutated = HANDOFF.replace(HANDOFF_LINE, '');
  assert.notEqual(mutated, HANDOFF);
  assert.throws(() => assertHandoffLine(mutated), /handoff Verification list lacks the pre-verification catch-up line/);
});

test("AC3.1: /test's Skip-if-recent Match branch is the expected path after the catch-up", () => {
  assertMatchBullet(VERIFICATION);
  const noMatch = VERIFICATION.replace(MATCH_NOTE, '');
  assert.notEqual(noMatch, VERIFICATION);
  assert.throws(() => assertMatchBullet(noMatch), /Match bullet does not name the pre-verification catch-up/);
  const noSha = VERIFICATION.replace(MATCH_SHA_NOTE, '');
  assert.notEqual(noSha, VERIFICATION);
  assert.throws(() => assertMatchBullet(noSha), /Match bullet does not say VERIFICATION_SHA names the merged HEAD/);
  const noMismatch = VERIFICATION.replace(MISMATCH_NOTE, '');
  assert.notEqual(noMismatch, VERIFICATION);
  assert.throws(() => assertMatchBullet(noMismatch), /Match bullet does not name the bookkeeping-only Mismatch path/);
});
