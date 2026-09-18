'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readFlat = (rel) => read(rel).replace(/\s+/g, ' ');

const STEP1_RECORDS = read('plugin/skills/tidy/step-1-records.md');
const STEP1_RECORDS_FLAT = readFlat('plugin/skills/tidy/step-1-records.md');

test('step-1-records.md states the worklist rule once, scoped to Shapes 1, 2, 3, 4, 5, 7, 8', () => {
  assert.ok(STEP1_RECORDS_FLAT.includes('Worklist rule (Shapes 1, 2, 3, 4, 5, 7, 8)'), 'worklist-rule heading/scope statement missing');
  assert.ok(STEP1_RECORDS_FLAT.includes("`_shared/work-record.md`'s worklist rule"), 'must cite the shared worklist rule rather than restate it');
  assert.ok(STEP1_RECORDS_FLAT.includes('Shapes 5.5 and 6 are exempt'), 'must state the two exempt shapes explicitly');
});

test('worklist-rule paragraph sits before Shape 1', () => {
  const ruleIdx = STEP1_RECORDS_FLAT.indexOf('Worklist rule (Shapes 1, 2, 3, 4, 5, 7, 8)');
  const shape1Idx = STEP1_RECORDS_FLAT.indexOf('### Shape 1');
  assert.ok(ruleIdx !== -1 && shape1Idx !== -1 && ruleIdx < shape1Idx, 'worklist rule must precede Shape 1');
});

test('Shape 7 node -e script filters out needsDefinition parents before the floor/gate-state checks', () => {
  assert.ok(STEP1_RECORDS.includes('needsDefinition: p.facets.needsDefinition === true,'), 'Shape 7 must compute a needsDefinition field per parent');
  assert.ok(STEP1_RECORDS.includes('.filter((f) => !f.needsDefinition)'), 'Shape 7 must filter out needsDefinition parents');
});

test('Shape 8 node -e script filters out needsDefinition closed records', () => {
  assert.ok(STEP1_RECORDS.includes('.filter((r) => r.facets.needsDefinition !== true)'), 'Shape 8 must filter out needsDefinition records');
});

// Go-red control: pre-change Shape 7/8 scripts had no needsDefinition-aware filter anywhere.
// Fixed to a specific pre-Task-11 base SHA, not HEAD — HEAD moves past Task 11's own commit once
// that commit lands, which would make this control read post-change content and defeat its
// purpose. The original pin (Task 10's final commit on its own feature branch, pre-squash) was
// never reachable from origin/main once that branch's PR (#1488/#1499) squash-merged — a fresh
// clone (CI's fetch-depth: 0 included; it only fetches what origin's refs reach) can't resolve
// it, so `git show {sha}:{path}` fails with "exists on disk, but not in {sha}" even though the
// path is real. Repinned to d111b1474 — the immediate parent, on origin/main's own history, of
// e2f499095 (the squash-merged commit that added the needsDefinition filter) — which is reachable
// and carries the file with no needsDefinition reference, same as the original pin intended.
const PRE_TASK11_BASE_SHA = 'd111b14742e935487e64a7afa7949cd24e71b8d8';
// #2436: a shallow/partial clone (a common sandbox-provisioning shape) does not have this
// historical commit's tree reachable, even though it is on origin/main's real history — the same
// "exists on disk, but not in {sha}" failure the comment above already documents for the ORIGINAL
// pin. That failure previously happened at module-load time with no try/catch, crashing the whole
// file (a whole-file `node --test` failure) instead of just this one go-red control. Guard the
// read so every other test in this file is unaffected by an unreachable historical commit; only
// the one test that actually needs it degrades, with a stated reason.
let PRE_CHANGE_STEP1_RECORDS = null;
let goRedControlSkip = false;
try {
  PRE_CHANGE_STEP1_RECORDS = execFileSync(
    'git',
    ['show', `${PRE_TASK11_BASE_SHA}:plugin/skills/tidy/step-1-records.md`],
    { cwd: ROOT, encoding: 'utf8' }
  );
} catch (err) {
  goRedControlSkip = `commit ${PRE_TASK11_BASE_SHA} is not reachable in this checkout's git history ` +
    `— the go-red control needs full history: ${String(err.message).split('\n')[0]}`;
}

test('go-red control: pre-change file carries no needsDefinition field anywhere', { skip: goRedControlSkip }, () => {
  assert.ok(!PRE_CHANGE_STEP1_RECORDS.includes('needsDefinition'), 'control must not already carry a needsDefinition reference (proves the assertions above can fail)');
});
