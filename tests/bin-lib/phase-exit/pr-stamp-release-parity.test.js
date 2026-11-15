'use strict';
// Parity between the two callers of pre-tool-use.js's prStampReleased: the
// PreToolUse bookkeeping-stamps gate (a Bash `git push`) and phase-exit.js's
// prPushReleased (the push phase-exit makes in its own process, #4026). Both
// sides get the same run state and the same real fixture, and must agree on
// whether a pr-first push with no recorded PR may go ahead (#4344).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo: makeGitRepo, linkedWorktreeOf: makeLinkedWorktree, fixtureGit } = require('../../helpers/git-fixtures');
const pre = require('../../../plugin/bin/lib/hooks/pre-tool-use');
const { prPushReleased } = require('../../../plugin/bin/lib/phase-exit/phase-exit');

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

const tmp = (prefix) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
};

// The shared git-fixtures helpers (bounded spawns), with each created dir tracked for the after-hook cleanup.
function gitRepo() {
  const dir = makeGitRepo();
  created.push(dir);
  return dir;
}

function linkedWorktreeOf(main) {
  const wt = makeLinkedWorktree(main);
  created.push(path.dirname(wt));
  return wt;
}

const RUN_ID = '2026-08-22T061958-record-991';

function commitMaterializedSpec(wt, tailPath, runId = RUN_ID) {
  const relPath = path.join('.claude-tweaks', 'pipelines', runId, tailPath);
  const abs = path.join(wt, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '---\nrecord: 1\n---\nbody\n');
  fixtureGit(['-C', wt, 'add', '-f', relPath]);
  fixtureGit(['-C', wt, 'commit', '-m', 'Materialize spec', '-q']);
}

function mkRunDir(project, state) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return run;
}

function readEvents(run) {
  return fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

const FAILED = (b) => `- AUTO 09:00:00 — PR-early run lifecycle: push of ${b} to origin FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.\n`;
const STEP1 = (b) => `- AUTO 09:00:00 — PR-early run lifecycle: no existing PR for ${b}; creating. Reversibility: n/a.\n`;
const SCENARIOS = [
  { name: 'recorded PR', state: { pr: { number: 42, url: 'u' } }, tracked: true, released: true },
  { name: 'malformed pr stamp', state: { pr: { number: 'x' } }, tracked: true, released: true },
  { name: 'prExempt', state: { prExempt: true }, tracked: true, released: true },
  { name: 'prExempt, first publish with only a FAILED line', state: { prExempt: true }, decisions: FAILED, tracked: false, released: false },
  { name: 'prExempt, first publish with FAILED and Step 1 lines', state: { prExempt: true }, decisions: (b) => FAILED(b) + STEP1(b), tracked: false, released: true },
  { name: 'closed run', state: { status: 'clean' }, tracked: true, released: true },
  { name: 'FAILED degrade line', state: {}, decisions: FAILED, tracked: true, released: true },
  { name: 'nothing logged, tracked', state: {}, tracked: true, released: false },
  { name: 'Step 1 line on a tracked branch', state: {}, decisions: STEP1, tracked: true, released: false },
  { name: 'first publish with its Step 1 line', state: {}, decisions: STEP1, tracked: false, released: true },
  { name: 'first publish without its Step 1 line', state: {}, tracked: false, released: false },
  { name: 'first publish with only a FAILED line', state: {}, decisions: FAILED, tracked: false, released: false },
  { name: 'per-spec, FAILED line on the parent', state: {}, parentDecisions: FAILED, perSpec: true, tracked: true, released: true },
  { name: 'per-spec, no FAILED line anywhere', state: {}, perSpec: true, tracked: true, released: false },
  { name: 'per-spec first publish, FAILED and Step 1 lines on the parent', state: {}, parentDecisions: (b) => FAILED(b) + STEP1(b), perSpec: true, tracked: false, released: true },
];

// One fresh fixture: a linked worktree carrying this run's materialize commit, an
// optional bare `origin` the branch is pushed to with -u (tracked), and a run dir
// (a spec-991 child of it for perSpec) under a separate project.
function scenarioFixture(s) {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, s.perSpec ? path.join('spec-991', 'work', '991-spec.md') : path.join('work', '991-spec.md'));
  const branch = fixtureGit(['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  if (s.tracked) {
    const bare = tmp('ct-prsr-bare-');
    fixtureGit(['init', '-q', '--bare', bare]);
    fixtureGit(['-C', wt, 'remote', 'add', 'origin', bare]);
    fixtureGit(['-C', wt, 'push', '-q', '-u', 'origin', branch], { stdio: 'ignore' });
  }
  const state = { status: 'active', worktree: wt, ...s.state };
  const parentRun = mkRunDir(tmp('ct-prsr-proj-'), state);
  let runDir = parentRun;
  if (s.perSpec) {
    runDir = path.join(parentRun, 'spec-991');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  }
  if (s.decisions) fs.writeFileSync(path.join(runDir, 'decisions.md'), `## /build\n${s.decisions(branch)}`);
  if (s.parentDecisions) fs.writeFileSync(path.join(parentRun, 'decisions.md'), `## /build\n${s.parentDecisions(branch)}`);
  return { wt, branch, runDir, state };
}

const gatePush = (wt, branch, runDir, state) => pre.run(
  { input: { tool_name: 'Bash', tool_input: { command: `git push origin ${branch}` }, cwd: wt }, runDir, runState: state, cwd: wt },
  { resolveIntegrationModel: () => 'pr-first' },
);
const isDenied = (out) => Boolean(out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision === 'deny');

for (const s of SCENARIOS) {
  test(`AC1.1: gate and prPushReleased agree — ${s.name}`, () => {
    const { wt, branch, runDir, state } = scenarioFixture(s);
    // prPushReleased first: the gate may write prExempt to the fixture's run dir.
    const push = prPushReleased({ hasNoUpstreamYet: pre.hasNoUpstreamYet }, runDir, wt, branch, state, { pr: state.pr && Number.isInteger(state.pr.number) ? 'present' : 'missing' });
    const denied = isDenied(gatePush(wt, branch, runDir, state));
    assert.equal(push, s.released, `prPushReleased: ${s.name}`);
    assert.equal(!denied, s.released, `gate: ${s.name}`);
    if (!s.released) {
      // Pin the deny to the PR branch: record-pr-step1 for a first publish, record-pr for a tracked branch.
      const stamps = readEvents(runDir).filter((e) => e.type === 'bookkeeping-stamp-deny').map((e) => e.stamp);
      assert.deepEqual(stamps, [s.tracked ? 'record-pr' : 'record-pr-step1'], `gate deny stamp: ${s.name}`);
    }
  });
}

test('gate: a memoized prExempt does not short-circuit a first-publish push that has only a FAILED line', () => {
  const { wt, branch, runDir } = scenarioFixture({ state: {}, decisions: FAILED, tracked: false });
  const state = { status: 'active', worktree: wt, prExempt: true, claimExempt: true };
  const out = gatePush(wt, branch, runDir, state);
  assert.ok(isDenied(out), 'a first publish with no Step 1 line must be denied even with prExempt and claimExempt memoized');
  assert.ok(
    readEvents(runDir).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'record-pr-step1'),
    'the deny must be the record-pr-step1 stamp',
  );
});

const decisionsDir = (lines) => {
  const dir = tmp('ct-prsr-run-');
  if (lines) fs.writeFileSync(path.join(dir, 'decisions.md'), `## /build\n${lines}`);
  return dir;
};

test('prStampReleased: null runState does not throw and reads as nothing recorded', () => {
  assert.equal(pre.prStampReleased({ runState: null, runDir: decisionsDir(null), branch: 'b', model: 'pr-first', hasNoUpstream: false }), false);
});

test('prStampReleased: a non-pr-first model releases', () => {
  assert.equal(pre.prStampReleased({ runState: {}, runDir: decisionsDir(null), branch: 'b', model: 'local-merge', hasNoUpstream: true }), true);
});

test('prStampReleased: a closed run or a pr stamp releases a first publish ahead of its Step 1 rule', () => {
  for (const runState of [{ status: 'clean' }, { pr: { number: 7, url: 'u', branch: 'b' } }]) {
    assert.equal(pre.prStampReleased({ runState, runDir: decisionsDir(null), branch: 'b', model: 'pr-first', hasNoUpstream: true }), true, JSON.stringify(runState));
  }
});

test('prStampReleased: first publish with a null branch does not release', () => {
  assert.equal(pre.prStampReleased({ runState: {}, runDir: decisionsDir(STEP1('b')), branch: null, model: 'pr-first', hasNoUpstream: true }), false);
});

test('prStampReleased: a spec-* dir whose parent is not run-id-shaped does not read that parent', () => {
  for (const c of [{ line: FAILED('b'), hasNoUpstream: false }, { line: STEP1('b'), hasNoUpstream: true }]) {
    const parent = path.join(tmp('ct-prsr-other-'), 'other');
    const spec = path.join(parent, 'spec-991');
    fs.mkdirSync(spec, { recursive: true });
    fs.writeFileSync(path.join(parent, 'decisions.md'), `## /build\n${c.line}`);
    assert.equal(pre.prStampReleased({ runState: {}, runDir: spec, branch: 'b', model: 'pr-first', hasNoUpstream: c.hasNoUpstream }), false, c.line);
  }
});
