// tests/bin-lib/wrap-up/evidence-route.test.js
// Pure decision module for verification-brief Step 4's screenshot route (#4125).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SAFE_BRANCH_RE,
  STATES,
  ROUTES,
  REASONS,
  decideEvidenceRoute,
  branchReadState,
  stripTrailingSlash,
} = require('../../../plugin/bin/lib/wrap-up/evidence-route');

const base = {
  currentBranch: 'worktree-x',
  integrationBranch: 'main',
  toplevel: '/r/wt',
  worktree: '/r/wt/',
  state: 'no-conflict',
  inRun: false,
  leaveOpen: false,
  consoleResolution: null,
};
const decide = (over) => decideEvidenceRoute({ ...base, ...over });

const OPEN_STATES = ['conflicting', 'no-conflict', 'unknown', 'open'];
const UNREADABLE_STATES = ['gh-absent', 'read-failed'];

test('vocabularies are frozen and the safe-name pattern is the contract', () => {
  assert.deepEqual(STATES, ['conflicting', 'no-conflict', 'unknown', 'open', 'not-open', 'no-pr', 'gh-absent', 'read-failed']);
  assert.deepEqual(ROUTES, ['current-branch', 'evidence-pr']);
  assert.ok(Object.isFrozen(STATES) && Object.isFrozen(ROUTES) && Object.isFrozen(REASONS));
  assert.equal(SAFE_BRANCH_RE.source, '^[A-Za-z0-9._/-]+$');
});

test('AC1.1: the integration branch takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    const r = decide({ currentBranch: 'main', state });
    assert.equal(r.route, 'evidence-pr', state);
    assert.equal(r.reason, 'integration-branch', state);
  }
});

test('AC1.1: an empty current branch takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    for (const currentBranch of ['', null, undefined]) {
      const r = decide({ currentBranch, state });
      assert.equal(r.route, 'evidence-pr', state);
      assert.equal(r.reason, 'no-branch', state);
      assert.equal(r.branch, '');
    }
  }
});

test('AC1.1: a branch name outside ^[A-Za-z0-9._/-]+$ takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    for (const currentBranch of ['a$b', 'a b', 'a`b', "a'b"]) {
      const r = decide({ currentBranch, state });
      assert.equal(r.route, 'evidence-pr', `${state} ${currentBranch}`);
      assert.equal(r.reason, 'unsafe-branch-name', `${state} ${currentBranch}`);
    }
  }
});

test('AC1.1: a toplevel that is not the recorded worktree takes evidence-pr whatever the PR state', () => {
  for (const state of STATES) {
    for (const toplevel of ['/r/main', null]) {
      const r = decide({ toplevel, state });
      assert.equal(r.route, 'evidence-pr', `${state} ${toplevel}`);
      assert.equal(r.reason, 'not-run-worktree', `${state} ${toplevel}`);
    }
  }
});

test('AC1.1: the worktree match is exact after dropping a trailing slash', () => {
  assert.equal(decide({ toplevel: '/r/wt/', worktree: '/r/wt' }).route, 'current-branch');
  assert.equal(decide({ toplevel: '/r/wt', worktree: '/r/wt/' }).route, 'current-branch');
  assert.equal(decide({ toplevel: '/r/wt2', worktree: '/r/wt' }).reason, 'not-run-worktree');
  assert.equal(decide({ toplevel: '/R/wt', worktree: '/r/wt' }).reason, 'not-run-worktree');
});

test('stripTrailingSlash drops trailing separators and passes a non-string through', () => {
  assert.equal(stripTrailingSlash('/r/wt/'), '/r/wt');
  assert.equal(stripTrailingSlash('C:\\r\\wt\\'), 'C:\\r\\wt');
  assert.equal(stripTrailingSlash('/r/wt'), '/r/wt');
  assert.equal(stripTrailingSlash(null), null);
  assert.equal(stripTrailingSlash(undefined), undefined);
});

test('unresolved integration branch fails closed', () => {
  for (const state of STATES) {
    for (const integrationBranch of [null, '', undefined]) {
      const r = decide({ integrationBranch, state });
      assert.equal(r.route, 'evidence-pr', state);
      assert.equal(r.reason, 'integration-branch-unresolved', state);
    }
  }
});

test("AC2.1: an open run PR takes current-branch on the run's own branch", () => {
  for (const state of OPEN_STATES) {
    const r = decide({ state });
    assert.deepEqual(r, { route: 'current-branch', branch: 'worktree-x', state, reason: 'run-pr-open' });
  }
});

test("AC2.1: no-pr takes current-branch on the run's own branch", () => {
  const r = decide({ state: 'no-pr' });
  assert.deepEqual(r, { route: 'current-branch', branch: 'worktree-x', state: 'no-pr', reason: 'no-pr' });
});

test("AC2.2: with no worktree recorded the current branch counts as the run's own, still under the guard", () => {
  for (const worktree of [null, undefined, '']) {
    const r = decide({ worktree, toplevel: '/anywhere', state: 'no-conflict' });
    assert.equal(r.route, 'current-branch');
    assert.equal(r.reason, 'run-pr-open');
    const g = decide({ worktree, toplevel: '/anywhere', currentBranch: 'main' });
    assert.equal(g.route, 'evidence-pr');
    assert.equal(g.reason, 'integration-branch');
  }
});

test('run PR not-open takes evidence-pr', () => {
  const r = decide({ state: 'not-open' });
  assert.equal(r.route, 'evidence-pr');
  assert.equal(r.reason, 'run-pr-not-open');
  assert.equal(r.state, 'not-open');
});

test("AC3.1: an unreadable state takes current-branch only for an in-run leave-open console on the run's own branch", () => {
  for (const state of UNREADABLE_STATES) {
    for (const over of [
      { inRun: true, consoleResolution: 'leave-open' },
      { inRun: true, leaveOpen: true },
    ]) {
      const r = decide({ state, ...over });
      assert.equal(r.route, 'current-branch', `${state} ${JSON.stringify(over)}`);
      assert.equal(r.reason, 'unreadable-leave-open', `${state} ${JSON.stringify(over)}`);
      assert.equal(r.state, state);
    }
  }
});

test('AC3.2: an unreadable state otherwise takes evidence-pr', () => {
  for (const state of [...UNREADABLE_STATES, 'weird']) {
    for (const over of [
      { inRun: false, consoleResolution: 'leave-open' },
      { inRun: false, leaveOpen: true },
      { inRun: true, consoleResolution: 'merge' },
      { inRun: true, consoleResolution: null },
    ]) {
      const r = decide({ state, ...over });
      assert.equal(r.route, 'evidence-pr', `${state} ${JSON.stringify(over)}`);
      assert.equal(r.reason, 'unreadable-state', `${state} ${JSON.stringify(over)}`);
    }
  }
  assert.equal(decide({ state: 'weird' }).state, 'read-failed');
  assert.equal(decide({ state: undefined }).state, 'read-failed');
});

test('AC3.1: the leave-open exception never overrides the guard', () => {
  const r = decide({ inRun: true, consoleResolution: 'leave-open', state: 'gh-absent', toplevel: '/r/main' });
  assert.equal(r.route, 'evidence-pr');
  assert.equal(r.reason, 'not-run-worktree');
});

test('branchReadState maps every resolvePrState result', () => {
  assert.equal(branchReadState(null), 'no-pr');
  assert.equal(branchReadState('gh-absent'), 'gh-absent');
  assert.equal(branchReadState('network-failure'), 'read-failed');
  assert.equal(branchReadState('invalid-arguments'), 'read-failed');
  assert.equal(branchReadState({ state: 'OPEN', number: 1 }), 'open');
  assert.equal(branchReadState({ state: 'MERGED' }), 'not-open');
  assert.equal(branchReadState({ state: 'CLOSED' }), 'not-open');
  assert.equal(branchReadState({ state: 'DRAFT?' }), 'read-failed');
  assert.equal(branchReadState(42), 'read-failed');
});

test('every returned route, reason and state is in the frozen vocabularies', () => {
  const overs = [];
  for (const state of [...STATES, 'weird']) {
    for (const currentBranch of ['worktree-x', 'main', '', 'a$b']) {
      for (const toplevel of ['/r/wt', '/r/main', null]) {
        for (const worktree of ['/r/wt/', null]) {
          for (const integrationBranch of ['main', null]) {
            for (const [inRun, leaveOpen, consoleResolution] of [[false, false, null], [true, false, 'leave-open'], [true, true, 'merge']]) {
              overs.push({ state, currentBranch, toplevel, worktree, integrationBranch, inRun, leaveOpen, consoleResolution });
            }
          }
        }
      }
    }
  }
  for (const over of overs) {
    const r = decide(over);
    assert.ok(ROUTES.includes(r.route), JSON.stringify(over));
    assert.ok(REASONS.includes(r.reason), JSON.stringify(over));
    assert.ok(STATES.includes(r.state), JSON.stringify(over));
    assert.equal(r.branch, over.currentBranch || '');
  }
});

// ---------------------------------------------------------------------------
// CLI: bin/evidence-route.js gathers the six inputs. Every seam is injected, so no
// real git or gh runs; the fixture is a fake-.git main checkout (as in
// tests/bin-lib/pr-merge-state/cli.test.js) so resolveTarget never spawns git.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs, USAGE } = require('../../../plugin/bin/evidence-route');

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture({ archived = false } = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-evidenceroute-cli-'));
  created.push(main);
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  const parts = ['.claude-tweaks', 'pipelines', ...(archived ? ['archive'] : []), '2026-10-26T000001-record-1'];
  const runDir = path.join(main, ...parts);
  fs.mkdirSync(runDir, { recursive: true });
  return { main, runDir };
}

const WT = '/r/wt';

// `omit` names seams left to the real default (the wiring under test).
function harness(fx, over = {}, omit = []) {
  const out = []; const err = [];
  const calls = { prMergeState: [], resolveBranchPr: [] };
  const deps = {
    cwd: () => fx.main,
    mainRoot: fx.main,
    git: (args) => {
      const key = args.join(' ');
      if (key === 'branch --show-current') return 'worktree-x\n';
      if (key === 'rev-parse --show-toplevel') return `${WT}\n`;
      throw new Error(`unexpected git ${key}`);
    },
    readRunState: () => ({ worktree: WT, pr: { number: 7 } }),
    prMergeStateRun: (argv, sub) => { calls.prMergeState.push({ argv, sub }); sub.stdout('{"state":"no-conflict"}\n'); return 0; },
    resolveBranchPr: (root, branch) => { calls.resolveBranchPr.push([root, branch]); return null; },
    integrationBranch: () => 'main',
    consoleResolution: () => null,
    canonical: (p) => p,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  for (const k of omit) delete deps[k];
  return { deps, out, err, calls, json: () => JSON.parse(out.join('')) };
}

test('--help prints usage naming every state and reason and exits 0', () => {
  const h = harness(fixture());
  assert.equal(run(['--help'], h.deps), 0);
  const text = h.out.join('');
  assert.equal(text, USAGE);
  for (const s of [...STATES, ...REASONS, ...ROUTES]) assert.ok(text.includes(s), s);
  assert.match(text, /exit 0 in every route; 2 malformed invocation; 3 run dir missing or not anchored/);
  assert.match(text, /decisions\.md/);
  assert.equal(h.calls.prMergeState.length, 0);
});

test('malformed invocations exit 2', () => {
  for (const argv of [['--bogus'], ['--run'], ['--run', ''], ['--run', '--in-run']]) {
    const h = harness(fixture());
    assert.equal(run(argv, h.deps), 2, JSON.stringify(argv));
    assert.equal(h.out.join(''), '', JSON.stringify(argv));
    assert.match(h.err.join(''), /usage: evidence-route\.js/);
    assert.equal(h.calls.prMergeState.length, 0);
  }
  assert.ok(parseArgs(['--run']).error);
  assert.deepEqual(parseArgs(['--run', '/x', '--in-run', '--leave-open']), { run: '/x', inRun: true, leaveOpen: true, help: false });
});

test('an unanchored --run exits 3 and prints nothing on stdout', () => {
  const fx = fixture();
  const elsewhere = fixture();
  const h = harness(fx);
  assert.equal(run(['--run', elsewhere.runDir], h.deps), 3);
  assert.equal(h.out.join(''), '');
  assert.match(h.err.join(''), /not anchored/);
  assert.equal(h.calls.prMergeState.length, 0);
  const missing = harness(fx);
  assert.equal(run(['--run', path.join(fx.main, 'no-such-dir')], missing.deps), 3);
  assert.equal(missing.out.join(''), '');
});

test("open run PR on the run's own branch prints current-branch", () => {
  const fx = fixture();
  const h = harness(fx);
  assert.equal(run(['--run', fx.runDir], h.deps), 0);
  assert.deepEqual(h.json(), { route: 'current-branch', branch: 'worktree-x', state: 'no-conflict', reason: 'run-pr-open' });
  assert.equal(h.calls.prMergeState.length, 1);
  assert.deepEqual(h.calls.prMergeState[0].argv, ['--run', fx.runDir, '--phase', 'wrap-up']);
  assert.equal(h.calls.resolveBranchPr.length, 0);
});

test('run read no-pr falls back to the branch read', () => {
  const fx = fixture();
  const h = harness(fx, {
    prMergeStateRun: (argv, sub) => { sub.stdout('{"state":"no-pr"}\n'); return 0; },
    resolveBranchPr: (root, branch) => { h.calls.resolveBranchPr.push([root, branch]); return { state: 'MERGED', number: 3 }; },
  });
  assert.equal(run(['--run', fx.runDir], h.deps), 0);
  assert.deepEqual(h.json(), { route: 'evidence-pr', branch: 'worktree-x', state: 'not-open', reason: 'run-pr-not-open' });
  assert.deepEqual(h.calls.resolveBranchPr, [[fx.main, 'worktree-x']]);
});

test('no --run reads the branch only', () => {
  const fx = fixture();
  const h = harness(fx);
  assert.equal(run([], h.deps), 0);
  assert.deepEqual(h.json(), { route: 'current-branch', branch: 'worktree-x', state: 'no-pr', reason: 'no-pr' });
  assert.equal(h.calls.prMergeState.length, 0);
  assert.deepEqual(h.calls.resolveBranchPr, [[fx.main, 'worktree-x']]);

  const open = harness(fx, { resolveBranchPr: () => ({ state: 'OPEN', number: 9 }) });
  assert.equal(run([], open.deps), 0);
  assert.deepEqual(open.json(), { route: 'current-branch', branch: 'worktree-x', state: 'open', reason: 'run-pr-open' });
});

test('pr-merge-state failure shapes read as read-failed', () => {
  const shapes = {
    'read-failed envelope': (argv, sub) => { sub.stdout('{"state":"read-failed","reason":"unparseable"}\n'); return 0; },
    'non-JSON line': (argv, sub) => { sub.stdout('not json at all\n'); return 0; },
    'exit 2': (argv, sub) => { sub.stdout('{"state":"no-conflict"}\n'); return 2; },
    'throws': () => { throw new Error('boom'); },
  };
  for (const [name, prMergeStateRun] of Object.entries(shapes)) {
    const fx = fixture();
    const h = harness(fx, { prMergeStateRun });
    assert.equal(run(['--run', fx.runDir], h.deps), 0, name);
    assert.deepEqual(h.json(), { route: 'evidence-pr', branch: 'worktree-x', state: 'read-failed', reason: 'unreadable-state' }, name);
  }
});

test("--in-run with a leave-open console.json on the run's own branch takes current-branch when the read is unreadable", () => {
  const fx = fixture();
  const gone = (argv, sub) => { sub.stdout('{"state":"gh-absent"}\n'); return 0; };
  const inRun = harness(fx, { consoleResolution: () => 'leave-open', prMergeStateRun: gone });
  assert.equal(run(['--run', fx.runDir, '--in-run'], inRun.deps), 0);
  assert.deepEqual(inRun.json(), { route: 'current-branch', branch: 'worktree-x', state: 'gh-absent', reason: 'unreadable-leave-open' });
  const outside = harness(fx, { consoleResolution: () => 'leave-open', prMergeStateRun: gone });
  assert.equal(run(['--run', fx.runDir], outside.deps), 0);
  assert.deepEqual(outside.json(), { route: 'evidence-pr', branch: 'worktree-x', state: 'gh-absent', reason: 'unreadable-state' });
});

test('--leave-open stands in for an attended console choice', () => {
  const fx = fixture();
  const h = harness(fx, { consoleResolution: () => null, prMergeStateRun: (argv, sub) => { sub.stdout('{"state":"gh-absent"}\n'); return 0; } });
  assert.equal(run(['--run', fx.runDir, '--in-run', '--leave-open'], h.deps), 0);
  assert.deepEqual(h.json(), { route: 'current-branch', branch: 'worktree-x', state: 'gh-absent', reason: 'unreadable-leave-open' });
});

test('multi-spec parent console is not a leave-open signal', () => {
  const gone = (argv, sub) => { sub.stdout('{"state":"gh-absent"}\n'); return 0; };
  const fx = fixture();
  fs.writeFileSync(path.join(fx.runDir, 'console.json'), JSON.stringify({ merge: { resolution: 'leave-open' } }));
  fs.writeFileSync(path.join(fx.runDir, 'manifest.yml'), 'members: []\n');
  // consoleResolution is left to the real default (engine-verify's consoleMergeResolution).
  const parent = harness(fx, { prMergeStateRun: gone }, ['consoleResolution']);
  assert.equal(run(['--run', fx.runDir, '--in-run'], parent.deps), 0);
  assert.deepEqual(parent.json(), { route: 'evidence-pr', branch: 'worktree-x', state: 'gh-absent', reason: 'unreadable-state' });

  fs.rmSync(path.join(fx.runDir, 'manifest.yml'));
  const single = harness(fx, { prMergeStateRun: gone }, ['consoleResolution']);
  assert.equal(run(['--run', fx.runDir, '--in-run'], single.deps), 0);
  assert.deepEqual(single.json(), { route: 'current-branch', branch: 'worktree-x', state: 'gh-absent', reason: 'unreadable-leave-open' });
});

test('worktree compare canonicalizes both sides', () => {
  const fx = fixture();
  const map = { '/link/wt': '/real/wt', '/real/wt': '/real/wt' };
  const git = (args) => (args.join(' ') === 'branch --show-current' ? 'worktree-x\n' : '/real/wt\n');
  const readRunState = () => ({ worktree: '/link/wt', pr: { number: 7 } });
  const resolved = harness(fx, { git, readRunState, canonical: (p) => map[p] ?? null });
  assert.equal(run(['--run', fx.runDir], resolved.deps), 0);
  assert.deepEqual(resolved.json(), { route: 'current-branch', branch: 'worktree-x', state: 'no-conflict', reason: 'run-pr-open' });

  const raw = harness(fx, { git, readRunState, canonical: () => null });
  assert.equal(run(['--run', fx.runDir], raw.deps), 0);
  assert.deepEqual(raw.json(), { route: 'evidence-pr', branch: 'worktree-x', state: 'no-conflict', reason: 'not-run-worktree' });
});

test('a failing git read for the branch reads as no-branch', () => {
  const fx = fixture();
  const h = harness(fx, {
    git: (args) => {
      if (args.join(' ') === 'branch --show-current') throw new Error('not a repo');
      return `${WT}\n`;
    },
  });
  assert.equal(run(['--run', fx.runDir], h.deps), 0);
  assert.deepEqual(h.json(), { route: 'evidence-pr', branch: '', state: 'no-conflict', reason: 'no-branch' });
});

test('an unresolvable integration branch fails closed', () => {
  const fx = fixture();
  const h = harness(fx, { integrationBranch: () => { throw new Error('no origin/HEAD'); } });
  assert.equal(run(['--run', fx.runDir], h.deps), 0);
  assert.deepEqual(h.json(), { route: 'evidence-pr', branch: 'worktree-x', state: 'no-conflict', reason: 'integration-branch-unresolved' });
});

test('archived run dir is read like a live one', () => {
  const fx = fixture({ archived: true });
  assert.match(fx.runDir, /pipelines[\\/]archive[\\/]/);
  const h = harness(fx);
  assert.equal(run(['--run', fx.runDir], h.deps), 0);
  assert.equal(h.calls.prMergeState.length, 1);
  assert.equal(h.calls.prMergeState[0].argv[1], fx.runDir);
  assert.equal(h.json().route, 'current-branch');
});
