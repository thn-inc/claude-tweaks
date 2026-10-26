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
