'use strict';
// tests/build-pre-verify-catchup-conformance.test.js — #4343: pins the prose that moves build's
// catch-up merge with the integration branch ahead of Common Step 5's verification run — the
// `### Pre-verification catch-up` subsection of _shared/git-discipline.md (the single home of
// the procedure), its residual note in the Post-push merge-state check, and the
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

const GD = read('plugin/skills/_shared/git-discipline.md');
const IM = read('plugin/skills/_shared/integration-model.md');

const HEADING = '### Pre-verification catch-up';
const NEXT_HEADING = '## Catching a branch up with `main`';
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

// The subsection, collapsed: from its heading to the next top-level heading, both asserted.
function subsection(text) {
  const from = text.indexOf(HEADING);
  assert.notStrictEqual(from, -1, `marker missing: ${HEADING}`);
  const to = text.indexOf(NEXT_HEADING, from);
  assert.notStrictEqual(to, -1, `marker missing: ${NEXT_HEADING}`);
  return collapse(text.slice(from, to));
}

const GD_FACTS = [
  { name: 'runs last before Common Step 5', needle: "runs this last before Common Step 5's verification run" },
  { name: 'verified tree carries the base', needle: '`VERIFICATION_SHA` is the post-merge HEAD' },
  { name: 'not overlap-gated', needle: 'it is not overlap-gated' },
  { name: 'once, not after a fix', needle: 'a re-run after a fix does not repeat it' },
  { name: 'pr-first worktree only', needle: 'Only a `pr-first` worktree run catches up' },
  { name: "resolves the run's model", needle: '--values integration-model --run "$PIPELINE_RUN_DIR"' },
  { name: 'local-merge SKIP names the model', needle: 'condition: integration-model local-merge → fallback: no pre-verification catch-up' },
  { name: 'current-branch SKIP', needle: 'condition: current-branch strategy → fallback: no pre-verification catch-up' },
  { name: 'wave member catches up', needle: 'a `MULTISPEC_PARALLEL_WAVE=1` member in its own worktree included' },
  { name: 'every mode, no stop', needle: 'in every mode — `auto`, `confirm`, `interactive` and `hybrid` alike, and a standalone `/claude-tweaks:build` — and adds no stop' },
  { name: 'cites Catch-up steps 1-4', needle: 'Run the Catch-up (`auto`) steps 1-4 above' },
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
  { name: 'no run dir reports in handoff', needle: "each `SKIP` goes to the Step 7 handoff's Skipped steps section instead" },
  { name: 'post-push check stays', needle: 'The Post-push merge-state check above stays' },
];

function assertPreVerifySubsection(text) {
  requireOrder(text, [POST_PUSH, CATCH_UP, HEADING, NEXT_HEADING]);
  // The log-decision flags (read by the gate SKIPs) open the subsection, and the model gate
  // precedes the fetch: the gate paragraph comes before the paragraph citing the steps.
  requireOrder(subsection(text), ['--step "Pre-verification catch-up"', 'Only a `pr-first` worktree run catches up', 'Run the Catch-up (`auto`) steps 1-4 above']);
  assert.deepEqual(missingFacts(GD_FACTS, subsection(text)), [], 'Pre-verification catch-up facts');
}

const RESIDUAL = 'already merged the integration branch in before its final verification (Pre-verification catch-up below)';

function assertPostPushResidual(text) {
  const from = text.indexOf(POST_PUSH);
  assert.notStrictEqual(from, -1, `marker missing: ${POST_PUSH}`);
  const to = text.indexOf(CATCH_UP, from);
  assert.notStrictEqual(to, -1, `marker missing: ${CATCH_UP}`);
  assert.ok(collapse(text.slice(from, to)).includes(RESIDUAL), 'post-push residual sentence missing');
}

const CONSUMER_ROW = "`_shared/git-discipline.md`'s Pre-verification catch-up";

function assertConsumerRow(text) {
  const from = text.indexOf('## Consumer table');
  assert.notStrictEqual(from, -1, 'marker missing: ## Consumer table');
  const next = text.indexOf('\n## ', from + 1);
  const table = next === -1 ? text.slice(from) : text.slice(from, next);
  const hit = table.split('\n').some((l) => l.startsWith('| ') && l.includes(CONSUMER_ROW));
  assert.ok(hit, 'integration-model.md Consumer table lacks the Pre-verification catch-up row');
}

// The raw block from the heading through the line before the next top-level heading.
function rawBlock(text) {
  const from = text.indexOf(HEADING);
  const to = text.indexOf(NEXT_HEADING, from);
  assert.ok(from !== -1 && to !== -1, 'subsection markers missing from the live text');
  return { from, to, block: text.slice(from, to) };
}

test('AC1.1/AC2.1/AC4.1/AC5.1: git-discipline.md states the Pre-verification catch-up', () => {
  assertPreVerifySubsection(GD);
});

test('AC1.1 go-red: each Pre-verification catch-up fact goes red alone', () => {
  const s = subsection(GD);
  for (const f of GD_FACTS) {
    assert.equal(s.split(f.needle).length, 2, `needle must occur exactly once in the subsection: ${f.name}`);
    const m = s.replace(f.needle, '');
    assert.notEqual(m, s, f.name);
    assert.deepEqual(missingFacts(GD_FACTS, m), [f.name], f.name);
  }
});

test('AC1.1 go-red: the subsection placed above the Catch-up steps it cites fails the order check', () => {
  const { from, to, block } = rawBlock(GD);
  const withoutBlock = GD.slice(0, from) + GD.slice(to);
  const at = withoutBlock.indexOf(CATCH_UP);
  assert.notStrictEqual(at, -1, 'Catch-up marker missing from the live text');
  const swapped = withoutBlock.slice(0, at) + block + withoutBlock.slice(at);
  assert.notEqual(swapped, GD);
  assert.throws(() => assertPreVerifySubsection(swapped), /### Pre-verification catch-up must come after the previous marker/);
  // Deletion control: the existence half has its own message.
  const absent = GD.replace(`${HEADING}\n`, '');
  assert.notEqual(absent, GD);
  assert.throws(() => assertPreVerifySubsection(absent), /marker missing: ### Pre-verification catch-up/);
});

test('AC2.1 go-red: the model gate placed after the Catch-up steps fails the order check', () => {
  const { from, to, block } = rawBlock(GD);
  const paras = block.split('\n\n');
  const gate = paras.findIndex((p) => p.startsWith('Only a `pr-first` worktree run catches up'));
  const steps = paras.findIndex((p) => p.startsWith('A `pr-first` worktree run catches up in every mode'));
  assert.ok(gate !== -1 && steps !== -1 && gate < steps, 'gate and steps paragraphs not found in order');
  const swappedParas = paras.slice();
  [swappedParas[gate], swappedParas[steps]] = [paras[steps], paras[gate]];
  const swapped = GD.slice(0, from) + swappedParas.join('\n\n') + GD.slice(to);
  assert.notEqual(swapped, GD);
  assert.throws(() => assertPreVerifySubsection(swapped), /Run the Catch-up \(`auto`\) steps 1-4 above must come after the previous marker/);
  // Deletion control: the existence half of the second order check has its own message.
  const GATE = 'Only a `pr-first` worktree run catches up';
  const absent = GD.replace(GATE, 'Only a pr-first worktree run catching up');
  assert.notEqual(absent, GD);
  assert.throws(() => assertPreVerifySubsection(absent), /marker missing: Only a `pr-first` worktree run catches up/);
});

test('AC1.1 go-red: the log-decision flags placed after the gate SKIPs fail the order check', () => {
  const STEP = '--step "Pre-verification catch-up"';
  const moved = GD.replace(STEP, '--step "elsewhere"').replace(NEXT_HEADING, `${STEP}\n\n${NEXT_HEADING}`);
  assert.notEqual(moved, GD);
  assert.throws(() => assertPreVerifySubsection(moved), /Only a `pr-first` worktree run catches up must come after the previous marker/);
});

test('Deliverable 3: the Post-push merge-state check names the residual case', () => {
  assertPostPushResidual(GD);
  const mutated = GD.replace(RESIDUAL, '');
  assert.notEqual(mutated, GD);
  assert.throws(() => assertPostPushResidual(mutated), /post-push residual sentence missing/);
});

test('AC2.1: integration-model.md lists the Pre-verification catch-up as a consumer', () => {
  assertConsumerRow(IM);
  const mutated = IM.replace(CONSUMER_ROW, '');
  assert.notEqual(mutated, IM);
  assert.throws(() => assertConsumerRow(mutated), /Consumer table lacks the Pre-verification catch-up row/);
});
