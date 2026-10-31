// tests/merge-verification-gate-conformance.test.js — pins #560's single-statement rule:
// the merge-verification gate procedure lives once in skills/_shared/pr-first-merge.md
// (Step 2.5) and every pr-first merge site cites it. Mirrors the regex-plus-allowlist
// shape of tests/integration-model.test.js's consumer conformance.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const GATE_FILE = path.join(SKILLS, '_shared', 'pr-first-merge.md');
const read = (...p) => readText(path.join(SKILLS, ...p));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

// Every conformance check below scans all skill files except the gate itself.
function* otherSkillFiles() {
  for (const file of walk(SKILLS)) {
    if (file !== GATE_FILE) yield file;
  }
}

test('the gate is stated once — Step 2.5 heading exists exactly once, only in pr-first-merge.md', () => {
  const gate = readText(GATE_FILE);
  assert.equal((gate.match(/^## Step 2\.5: Merge-verification gate$/gm) || []).length, 1);
  for (const file of otherSkillFiles()) {
    assert.ok(!/^## Step 2\.5: Merge-verification gate$/m.test(fs.readFileSync(file, 'utf8')), `${path.relative(SKILLS, file)} restates the gate heading`);
  }
});

test('checks-pending-timeout is defined only in the gate; other files at most cite it', () => {
  const offenders = [];
  for (const file of otherSkillFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('checks-pending-timeout') && !text.includes('pr-first-merge.md')) offenders.push(path.relative(SKILLS, file));
  }
  assert.deepEqual(offenders, []);
});

test('merge-when-green appears outside the gate only as a lever value (#559 files) or a citation', () => {
  // The #559 lever files name the value as a lever, never the procedure; anything else naming
  // the value must cite the gate's file.
  const LEVER_FILES = new Set(['_shared/policy-schema.md', '_shared/policy-schema-coverage.md', 'flow/manifesto.md']);
  const offenders = [];
  for (const file of otherSkillFiles()) {
    // Compared against a /-keyed allowlist, so it is a display ID (#4288).
    const rel = toPosix(path.relative(SKILLS, file));
    const text = fs.readFileSync(file, 'utf8');
    if (!/merge-when-green/i.test(text)) continue;
    if (LEVER_FILES.has(rel)) continue;
    if (!text.includes('pr-first-merge.md')) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('the gate reads state before any merge attempt and names the red-path pieces', () => {
  const gate = readText(GATE_FILE);
  const step25 = gate.indexOf('## Step 2.5: Merge-verification gate');
  const step3 = gate.indexOf('## Step 3:');
  assert.ok(step25 !== -1 && step3 !== -1 && step25 < step3, 'Step 2.5 must precede Step 3');
  const section = gate.slice(step25, step3);
  // Every park/report reason the gate defines is pinned, not just the timeout one — a future edit
  // that drops one silently changes an outcome vocabulary other files cite.
  for (const needle of ['statusCheckRollup', 'mergeStateStatus', 'bot:parked', 'checks-pending-timeout', 'checks-read-failed', 'state-read-failed', 'pr-not-open', 'moving-target', 'AUTO ', '15 minutes', 'never merge', '--auto', '--body-file']) {
    assert.ok(section.includes(needle), `gate section missing "${needle}"`);
  }
  assert.ok(!/AskUserQuestion/.test(section), 'the gate is park-and-surface — no mid-pipeline prompt');
});

test('the gate cross-checks head-sha workflow runs before reading green (#3405)', () => {
  const gate = readText(GATE_FILE);
  const step25 = gate.indexOf('## Step 2.5: Merge-verification gate');
  const step3 = gate.indexOf('## Step 3:');
  const section = gate.slice(step25, step3);
  for (const needle of ['gh run list', '--commit {headRefOid}', '--limit 100']) {
    assert.ok(section.includes(needle), `gate section missing "${needle}"`);
  }
  // The bounded watch re-counts head runs on its 0) (all-green) branch — a rollup that is green
  // while a head run is still in progress must keep waiting, not break out as green.
  const watch = section.slice(section.indexOf('DEADLINE='), section.indexOf('\n```', section.indexOf('DEADLINE=')));
  const zeroBranch = watch.slice(watch.indexOf('0)'), watch.indexOf('1)'));
  assert.ok(zeroBranch.includes('gh run list'), 'bounded-watch 0) branch must count head runs');
  // Signature (e): PR #3390 is the captured partial-rollup incident. The Signatures list moved to
  // the appendix (#4199, composed-bundle byte rail); the gate section must still point at it.
  assert.ok(section.includes("`pr-first-merge-appendix.md`'s Signatures section"), 'gate section must point at the appendix Signatures');
  const appendix = read('_shared', 'pr-first-merge-appendix.md');
  const signatures = appendix.slice(appendix.indexOf('## Signatures'), appendix.indexOf('\n## ', appendix.indexOf('## Signatures') + 1));
  assert.ok(signatures.includes('#3390') && signatures.includes('39042323352'), 'Signatures list missing the #3390 capture (run 39042323352)');
  // The resume confirmation's one read-then-decide classifies from both reads, not the rollup alone.
  const resume = section.slice(section.indexOf('**Resume-to-merge is one-shot.**'));
  assert.ok(resume.includes('gh run list') && resume.includes('not-yet-completed head run reads pending'), 'resume paragraph must classify from the head-run read too');
  // The RC=0 re-read names the not-yet-completed head run case and resumes the watch, never a blind merge.
  const rc0 = section.slice(section.indexOf('`RC=0` → **green**'), section.indexOf('`RC=1` (a check failed'));
  assert.ok(rc0.includes('not yet `completed`') && rc0.includes('DEADLINE'), 'RC=0 bullet must resume the bounded watch on a not-yet-completed head run');
  // The three classification bullets each carry their head-run clause (the code twin is classifyRollup's headRuns).
  for (const clause of ['any head run whose `status` is `completed` and whose `conclusion`', 'or any head run whose `status` is not `completed`', 'every head run `completed` without a failing conclusion']) {
    assert.ok(section.includes(clause), `Step 2.5 classification missing head-run clause "${clause}"`);
  }
  // The 0) branch breaks only at zero pending head runs, and a failed runs read stops the watch rather than breaking green.
  assert.ok(zeroBranch.includes('"${PENDING_RUNS:-x}" = 0 ] && break') && zeroBranch.includes('RC=2; break'), 'bounded-watch 0) branch must gate its break on zero pending head runs and stop on a failed read');
});

// #4550: `gh pr checks` on a PR whose checks have not registered yet prints "no checks reported on
// the '<branch>' branch" and exits 1 — the watch must read that as pending (RC=8), not a failed check.
const NO_CHECKS_MAPPING = "grep -q '^no checks reported'";

function assertWatchReadsNoChecksAsPending(gateText) {
  const step25 = gateText.indexOf('## Step 2.5: Merge-verification gate');
  const section = gateText.slice(step25, gateText.indexOf('## Step 3:'));
  const start = section.indexOf('DEADLINE=');
  const watch = section.slice(start, section.indexOf('\n```', start));
  const mapping = watch.indexOf(NO_CHECKS_MAPPING);
  assert.ok(mapping !== -1, 'the watch loop must map "no checks reported" output');
  assert.ok(/RC=8/.test(watch.slice(mapping, watch.indexOf('\n', mapping))), 'the mapping must set RC=8 (pending)');
  assert.ok(mapping < watch.indexOf('case "$RC"'), 'the mapping must run before the case on RC');
}

test('the bounded watch reads "no checks reported" as pending, not failed (#4550)', () => {
  const gate = readText(GATE_FILE);
  assertWatchReadsNoChecksAsPending(gate);
  const line = gate.split('\n').find((l) => l.includes(NO_CHECKS_MAPPING));
  assert.ok(line, 'live text carries the mapping line');
  assert.throws(() => assertWatchReadsNoChecksAsPending(gate.replace(line + '\n', '')), 'removing the mapping must fail the pin');
  assert.throws(() => assertWatchReadsNoChecksAsPending(gate.replace('&& RC=8', '&& RC=1')), 'a mapping to the wrong code must fail the pin');
});

test('every consumer that restates the Step 2.5 CI read also reads the head-sha runs (#3405)', () => {
  for (const rel of ['release/execute.md', 'dispatch/resume-confirmation.md', 'dispatch/close-out.md', 'tidy/actions-github-issues.md']) {
    assert.ok(read(...rel.split('/')).includes('gh run list'), `${rel} restates the rollup read without the head-run read`);
  }
  // The tidy arm-ready-PR action's re-verify list itself names the read its green-by-construction claim relies on.
  const tidy = read('tidy', 'actions-github-issues.md');
  const reverify = tidy.slice(tidy.indexOf('**Re-verify before writing'), tidy.indexOf('When judging `statusCheckRollup`'));
  assert.ok(reverify.includes('gh run list'), 'tidy Arm ready PR re-verify must fetch the head-sha runs');
});

test('every pr-first merge site and the resume confirmation cite the gate', () => {
  // #852 extracted dispatch's "Confirm before resuming" procedure (including
  // this citation) out of SKILL.md into its own sub-file to stay under the
  // former 40 KB ceiling — the resume confirmation's own citation of the gate
  // now lives there instead.
  for (const rel of ['dispatch/settle-and-merge.md', 'dispatch/resume-confirmation.md', 'flow/worktree-merge.md', 'release/execute.md']) {
    assert.ok(read(...rel.split('/')).includes('Merge-verification gate'), `${rel} does not cite the gate`);
  }
});

test('pr-checklist-refresh.md carries the gh-absent-at-merge degrade row (proceed as off, warn tier)', () => {
  // #2002 moved this row out of pr-early-run-lifecycle.md — it's merge-time-only content, so it
  // now lives with the other merge-time content the `merge` compose bundle actually needs.
  const t = read('_shared', 'pr-checklist-refresh.md');
  assert.ok(/gh.*absent at merge time/i.test(t) && /proceed as `off`/.test(t) && /\*\*warn\*\*/.test(t));
});

// #4550: the derived-off rule is stated once (Step 2.5); the coverage block, the release path and
// the PR-check gate point at it. Each pin is factored so its go-red control runs the same code.
const COVERAGE_CITE = "`_shared/pr-first-merge.md` Step 2.5's derived-`off` rule — so branches 2 and 4 skip the wait only for a PR whose checks have not reported at merge time";
const RELEASE_PROJECT_READ = 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification\n';
const RELEASE_DELTA_2 = 'an explicit `off` still merges anyway; a derived `off` (Step 2.5) red is `failed`';
const RELEASE_DELTA_3 = 'a derived `off` (Step 2.5) takes the bounded watch, an explicit one does not wait';
const CHECK_GATE_RED = 'When it prints `off` and Step 2.5 reads it as explicit';

function assertCoverageCitesDerivedOff(text) {
  const end = text.indexOf('<!-- merge-verification-derivation:end -->');
  assert.ok(end !== -1, 'derivation end marker present');
  const after = text.slice(end, text.indexOf('\n## ', end));
  assert.ok(after.includes(COVERAGE_CITE), 'sentence after the block cites Step 2.5 and names branches 2 and 4');
  const block = text.slice(text.indexOf('<!-- merge-verification-derivation:start -->'), end);
  assert.ok(!block.includes('derived-`off` rule'), 'the sentence sits outside the markers');
}

function assertReleaseCitesDerivedOff(text) {
  const gate = text.slice(text.indexOf('**The PR-check gate'), text.indexOf('**Reviewed-tip comparison'));
  for (const needle of [RELEASE_PROJECT_READ, RELEASE_DELTA_2, RELEASE_DELTA_3]) {
    assert.ok(gate.includes(needle), `release PR-check gate missing: ${needle}`);
  }
  assert.ok(!gate.includes('{"value":"off","source":"default"}'), 'release cites the rule, never restates its condition');
}

function assertCheckGateCitesDerivedOff(text) {
  const red = text.slice(text.indexOf('- **`red`**'), text.indexOf('\n- **', text.indexOf('- **`red`**') + 1));
  assert.ok(red.includes(CHECK_GATE_RED), 'pr-check-gate passes red with a caveat only under an explicit off');
  assert.ok(red.includes('a derived `off`'), 'pr-check-gate names a derived off among the gate-failure values');
  assert.ok(!red.includes('{"value":"off","source":"default"}'), 'pr-check-gate cites the rule, never restates its condition');
}

test('AC5.1: the coverage block\'s follow-on sentence cites Step 2.5\'s derived-off rule', () => {
  const text = read('_shared', 'policy-schema-coverage.md');
  assertCoverageCitesDerivedOff(text);
  assert.throws(() => assertCoverageCitesDerivedOff(text.replace(COVERAGE_CITE, '')));
});

test('AC6.1: the release PR-check gate carries the project-level read and cites the derived-off rule', () => {
  const text = read('release', 'execute.md');
  assertReleaseCitesDerivedOff(text);
  for (const needle of [RELEASE_PROJECT_READ, RELEASE_DELTA_2, RELEASE_DELTA_3]) {
    assert.throws(() => assertReleaseCitesDerivedOff(text.replace(needle, '')), `removing ${needle} must fail the pin`);
  }
});

test('plan-review clarification: the PR-check gate fails a derived-off red and passes only an explicit one', () => {
  const text = read('_shared', 'pr-check-gate.md');
  assertCheckGateCitesDerivedOff(text);
  assert.throws(() => assertCheckGateCitesDerivedOff(text.replace(CHECK_GATE_RED, 'When it prints `off`')));
});
