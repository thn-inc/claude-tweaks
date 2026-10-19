'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs, classifyMergeState, PHASE_SECTIONS, STATES } = require('../../../plugin/bin/pr-merge-state');

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

// Fake-.git anchored fixture, same shape as tests/bin-lib/pr-checks/cli.test.js:
// a main checkout's .git is a directory; mainRoot is injected so resolveTarget never spawns git.
function fixture(runState, { spec = false } = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prmergestate-cli-'));
  created.push(main);
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  let runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-19T000001-record-1');
  fs.mkdirSync(runDir, { recursive: true });
  if (spec) {
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
    runDir = path.join(runDir, 'spec-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  } else if (runState) {
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  }
  return { main, runDir };
}

// `result` is what the faked resolver returns (an object, a string, or null).
function makeDeps(main, result, over = {}) {
  const out = []; const err = []; const calls = [];
  const deps = {
    cwd: () => main,
    mainRoot: main,
    resolvePrState: (repoRoot, n) => { calls.push([repoRoot, n]); return result; },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  return { deps, out, err, calls, json: () => JSON.parse(out.join('')) };
}

const decisionsOf = (runDir) => path.join(runDir, 'decisions.md');
const DIRTY = { number: 7, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' };

test('AC1.1: DIRTY prints conflicting and writes exactly one AUTO entry naming PR and phase', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, DIRTY);
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'conflicting');
  assert.equal(j.pr, 7);
  assert.equal(j.logged, true);
  const text = fs.readFileSync(decisionsOf(runDir), 'utf8');
  const entries = text.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(entries.length, 1);
  assert.match(text, /^- AUTO \d{2}:\d{2}:\d{2} — Post-push merge-state check: PR #7 conflicts with the integration branch at build exit/m);
  assert.ok(text.indexOf('## /build') !== -1 && text.indexOf('## /build') < text.indexOf('- AUTO'));
});

test('conflicting via mergeable alone, via mergeStateStatus alone, and via DIRTY with an UNKNOWN mergeable', () => {
  for (const view of [
    { number: 7, mergeable: 'CONFLICTING', mergeStateStatus: 'BLOCKED' },
    { number: 7, mergeable: 'MERGEABLE', mergeStateStatus: 'DIRTY' },
    { number: 7, mergeable: 'UNKNOWN', mergeStateStatus: 'DIRTY' },
  ]) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, view);
    assert.equal(run(['--run', runDir, '--phase', 'test'], h.deps), 0);
    const j = h.json();
    assert.equal(j.state, 'conflicting');
    assert.equal(j.logged, true);
    const text = fs.readFileSync(decisionsOf(runDir), 'utf8');
    assert.ok(text.indexOf('## /test') !== -1 && text.indexOf('## /test') < text.indexOf('- AUTO'));
    assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 1);
  }
});

test('polish logs under /flow', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, DIRTY);
  assert.equal(run(['--run', runDir, '--phase', 'polish'], h.deps), 0);
  const text = fs.readFileSync(decisionsOf(runDir), 'utf8');
  assert.match(text, /^## \/flow\n- AUTO .*at polish exit/m);
});

test('every state a case can emit is a STATES member, and the cases cover the whole list', () => {
  const cases = [
    [DIRTY, 'conflicting'],
    [{ number: 7, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }, 'no-conflict'],
    [{ number: 7, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }, 'unknown'],
    [{ number: 7, state: 'CLOSED', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, 'not-open'],
    [null, 'no-pr'],
    ['network-failure', 'read-failed'],
    ['gh-absent', 'gh-absent'],
  ];
  const seen = new Set();
  for (const [result, expected] of cases) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, result);
    run(['--run', runDir, '--phase', 'build'], h.deps);
    assert.equal(h.json().state, expected);
    seen.add(h.json().state);
  }
  assert.deepEqual([...seen].sort(), [...STATES].sort());
  assert.ok(Object.isFrozen(STATES));
});

test('PHASE_SECTIONS maps every phase to its decisions.md section', () => {
  assert.deepEqual(PHASE_SECTIONS, { build: '/build', test: '/test', review: '/review', polish: '/flow', 'wrap-up': '/wrap-up' });
});

test('AC4.1: UNKNOWN is no signal — one resolver call, no decisions write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { number: 7, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'unknown');
  assert.equal(h.calls.length, 1);
  assert.equal(fs.existsSync(decisionsOf(runDir)), false);
});

test('AC4.1: failed read fails open — read-failed, no write', () => {
  for (const reason of ['network-failure', 'invalid-arguments']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, reason);
    assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
    const j = h.json();
    assert.equal(j.state, 'read-failed');
    assert.equal(j.reason, reason);
    assert.equal(h.calls.length, 1);
    assert.equal(fs.existsSync(decisionsOf(runDir)), false);
  }
});

test('an unparseable resolver result is read-failed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, 42);
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'read-failed');
  assert.equal(h.json().reason, 'unparseable');
});

test('a null resolver result is no-pr', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, null);
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'no-pr');
});

test('gh-absent', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, 'gh-absent');
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'gh-absent');
  assert.equal(fs.existsSync(decisionsOf(runDir)), false);
});

test('no-conflict — CLEAN and BEHIND write nothing', () => {
  for (const mss of ['CLEAN', 'BEHIND']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { number: 7, mergeable: 'MERGEABLE', mergeStateStatus: mss });
    assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
    const j = h.json();
    assert.equal(j.state, 'no-conflict');
    assert.equal(j.mergeStateStatus, mss);
    assert.equal(j.logged, false);
    assert.equal(fs.existsSync(decisionsOf(runDir)), false);
  }
});

test('a non-OPEN PR is no signal — a CLOSED view reporting DIRTY is not-open, no write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { ...DIRTY, state: 'CLOSED' });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'not-open');
  assert.equal(j.pr, 7);
  assert.equal(j.mergeable, 'CONFLICTING');
  assert.equal(j.mergeStateStatus, 'DIRTY');
  assert.equal(j.logged, false);
  assert.equal(fs.existsSync(decisionsOf(runDir)), false);
});

test('a MERGED PR is not-open, no write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { number: 7, state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });
  assert.equal(run(['--run', runDir, '--phase', 'wrap-up'], h.deps), 0);
  assert.equal(h.json().state, 'not-open');
  assert.equal(fs.existsSync(decisionsOf(runDir)), false);
});

test('an OPEN DIRTY view is still conflicting', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { ...DIRTY, state: 'OPEN' });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'conflicting');
});

test('AC3.1: no pr object reads no-pr with no gh call', () => {
  const { main, runDir } = fixture({ status: 'active' });
  const h = makeDeps(main, DIRTY);
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'no-pr');
  assert.equal(h.calls.length, 0);
  const none = fixture(null);
  const h2 = makeDeps(none.main, DIRTY);
  assert.equal(run(['--run', none.runDir, '--phase', 'build'], h2.deps), 0);
  assert.equal(h2.json().state, 'no-pr');
  assert.equal(h2.calls.length, 0);
});

test('non-integer pr.number is no-pr with no gh call', () => {
  for (const pr of [{ number: '7' }, { number: 0 }, { number: null }]) {
    const { main, runDir } = fixture({ pr });
    const h = makeDeps(main, DIRTY);
    assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
    assert.equal(h.json().state, 'no-pr');
    assert.equal(h.calls.length, 0);
  }
});

test('spec subdirectory reads the parent run dir pr', () => {
  const { main, runDir } = fixture({ pr: { number: 9 } }, { spec: true });
  const h = makeDeps(main, { number: 9, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], 9);
  assert.equal(h.json().pr, 9);
});

test('resolver is called with the cwd as repoRoot, not the main root', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const elsewhere = path.join(main, 'a-worktree-cwd');
  fs.mkdirSync(elsewhere, { recursive: true });
  const h = makeDeps(main, null, { cwd: () => elsewhere });
  run(['--run', runDir, '--phase', 'build'], h.deps);
  assert.equal(h.calls[0][0], elsewhere);
  assert.notEqual(h.calls[0][0], main);
});

test('a corrupt run-state.json reads as no-pr and never reaches the resolver', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), '{ not json');
  const h = makeDeps(main, DIRTY);
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'no-pr');
  assert.equal(h.calls.length, 0);
});

test('a throwing run-state reader reads as no-pr and never reaches the resolver', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, DIRTY, { readRunState: () => { throw new Error('unreadable'); } });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().state, 'no-pr');
  assert.equal(h.calls.length, 0);
});

test('append failure still reports conflicting, logged false, one stderr line', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, DIRTY, { appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'conflicting');
  assert.equal(j.logged, false);
  assert.equal(h.err.join('').trim().split('\n').length, 1);
  assert.match(h.err.join(''), /disk full/);
});

test('classifyMergeState: missing fields are unknown', () => {
  assert.equal(classifyMergeState({}), 'unknown');
  assert.equal(classifyMergeState({ mergeable: 'MERGEABLE' }), 'unknown');
  assert.equal(classifyMergeState({ mergeable: 'MERGEABLE', mergeStateStatus: 5 }), 'unknown');
});

test('parseArgs: reads --run and --phase, unknown flag rejected', () => {
  const o = parseArgs(['--run', 'x', '--phase', 'build']);
  assert.equal(o.run, 'x');
  assert.equal(o.phase, 'build');
  assert.ok(parseArgs(['--bogus']).error);
});

test('a throwing resolver reads as read-failed and writes nothing', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, null, { resolvePrState: () => { throw new Error('boom'); } });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'read-failed');
  assert.equal(j.reason, 'resolver-threw');
  assert.equal(fs.existsSync(decisionsOf(runDir)), false);
});

test('--help prints usage and exits 0 without resolving', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, DIRTY);
  assert.equal(run(['--help'], h.deps), 0);
  assert.match(h.out.join(''), /usage: pr-merge-state\.js --run <run-dir> --phase/);
  assert.equal(h.calls.length, 0);
});

test('malformed invocations are exit 2', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  for (const argv of [
    ['--phase', 'build'],
    ['--run', runDir],
    ['--run', runDir, '--phase', 'deploy'],
    ['--run', runDir, '--phase', 'build', '--bogus'],
  ]) {
    const h = makeDeps(main, DIRTY);
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.equal(h.calls.length, 0);
  }
});

test('a run dir that does not exist is exit 3', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, DIRTY);
  assert.equal(run(['--run', path.join(main, 'nope'), '--phase', 'build'], h.deps), 3);
  assert.match(h.err.join(''), /pr-merge-state\.js: run dir does not exist/);
});

test('a worktree-local shadow run dir is exit 3, not anchored', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const wt = path.join(main, '.claude', 'worktrees', 'flow-spec-1');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', '2026-10-19T000001-record-1');
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'run-state.json'), JSON.stringify({ pr: { number: 7 } }));
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-1\n');
  const h = makeDeps(main, DIRTY);
  assert.equal(run(['--run', shadow, '--phase', 'build'], h.deps), 3);
  assert.match(h.err.join(''), /not anchored/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.out.join(''), '');
});
