// tests/merge-verification-gate-conformance.test.js — pins #560's single-statement rule:
// the merge-verification gate procedure lives once in skills/_shared/pr-first-merge.md
// (Step 2.5) and every pr-first merge site cites it. Mirrors the regex-plus-allowlist
// shape of tests/integration-model.test.js's consumer conformance.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const GATE_FILE = path.join(SKILLS, '_shared', 'pr-first-merge.md');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');

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
  const gate = fs.readFileSync(GATE_FILE, 'utf8');
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
    const rel = path.relative(SKILLS, file);
    const text = fs.readFileSync(file, 'utf8');
    if (!/merge-when-green/i.test(text)) continue;
    if (LEVER_FILES.has(rel)) continue;
    if (!text.includes('pr-first-merge.md')) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('the gate reads state before any merge attempt and names the red-path pieces', () => {
  const gate = fs.readFileSync(GATE_FILE, 'utf8');
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

test('every pr-first merge site and the resume confirmation cite the gate', () => {
  // #852 extracted dispatch's "Confirm before resuming" procedure (including
  // this citation) out of SKILL.md into its own sub-file to stay under the
  // 40 KB ceiling — the resume confirmation's own citation of the gate now
  // lives there instead.
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
