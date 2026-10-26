'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPhaseExit, realDeps } = require('../../../plugin/bin/lib/phase-exit/phase-exit');
const { run } = require('../../../plugin/bin/phase-exit');
const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');
const { GIT_PUSH_TIMEOUT_MS, GIT_TIMEOUT_MS } = require('../../../plugin/bin/lib/shared-primitives');

const RUN_ID = '2026-10-25T000001-record-1';
const BRANCH = 'worktree-dispatch-record-1';
const PR_URL = 'https://github.com/o/r/pull/42';

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

// Fake-.git anchored fixture, same shape as tests/bin-lib/pr-merge-state/cli.test.js:
// a main checkout's .git is a directory; mainRoot is injected so resolveTarget never spawns git.
function fixture(runState = { worktree: '/wt', pr: { number: 42, url: PR_URL } }, { archived = false } = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-phase-exit-'));
  created.push(main);
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  const runDir = archived
    ? path.join(main, '.claude-tweaks', 'pipelines', 'archive', RUN_ID)
    : path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (runState) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  return { main, runDir, wt: path.join(main, '.claude', 'worktrees', 'dispatch-record-1') };
}

// Every seam faked. `git` answers by subcommand; a handler value that is an Error is thrown.
function makeDeps(main, wt, opts = {}) {
  const {
    model = 'pr-first', integrationBranch = '', branch = BRANCH, porcelain = '', push = '',
    currentBranch = false, prList = [{ number: 42, url: PR_URL }],
    recordWorktree = 'claude-tweaks: worktree recorded for x\n', recordPr = 'claude-tweaks: PR #42 recorded for x\n',
    checklist = { exit: 0, out: { action: 'written', pr: 42, phase: 'build' } },
    mergeState = { state: 'no-conflict', pr: 42, logged: false },
    ...over
  } = opts;
  const calls = { git: [], gh: [], hooks: [], policy: [], checklist: [], mergeState: [] };
  const out = []; const err = [];
  const gitDir = currentBranch ? '.git' : path.join(main, '.git', 'worktrees', 'dispatch-record-1');
  const answer = (v) => { if (v instanceof Error) throw v; return v; };
  const deps = {
    cwd: () => main,
    mainRoot: main,
    git: (args) => {
      calls.git.push(args);
      assert.equal(args[0], '-C');
      const sub = args.slice(2).join(' ');
      if (sub === 'rev-parse --git-dir --git-common-dir') return `${gitDir}\n${currentBranch ? '.git' : path.join(main, '.git')}\n`;
      if (sub === 'rev-parse HEAD') return 'abc1234def\n';
      if (sub === 'rev-parse --short HEAD') return 'abc1234\n';
      if (sub === 'branch --show-current') return `${branch}\n`;
      if (sub === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return 'origin/main\n';
      if (sub === '--no-optional-locks status --porcelain -z') return answer(porcelain);
      if (args[2] === 'push') return answer(push);
      throw new Error(`unexpected git ${sub}`);
    },
    gh: (args) => { calls.gh.push(args); return answer(typeof prList === 'string' || prList instanceof Error ? prList : JSON.stringify(prList)); },
    resolvePolicy: (runDir, key) => {
      calls.policy.push(key);
      if (key === 'integration-model') return answer(model);
      if (key === 'integration-branch') return integrationBranch;
      throw new Error(`unexpected key ${key}`);
    },
    hooks: (args) => {
      calls.hooks.push(args);
      return answer(args[0] === 'record-worktree' ? recordWorktree : recordPr);
    },
    prChecklistRun: (argv, d) => {
      calls.checklist.push(argv);
      if (checklist instanceof Error) throw checklist;
      if (checklist.out) d.stdout(`${JSON.stringify(checklist.out)}\n`);
      return checklist.exit;
    },
    // mergeState: an envelope object (printed, exit 0), an Error (thrown), or
    // { exit, raw } (raw stdout text printed verbatim, that exit returned).
    prMergeStateRun: (argv, d) => {
      calls.mergeState.push(argv);
      if (mergeState instanceof Error) throw mergeState;
      if (Object.hasOwn(mergeState, 'raw')) { if (mergeState.raw) d.stdout(mergeState.raw); return mergeState.exit; }
      d.stdout(`${JSON.stringify(mergeState)}\n`);
      return 0;
    },
    hasNoUpstreamYet: () => false,
    now: () => new Date(2026, 9, 25, 12, 0, 0),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  return { deps, calls, out, err };
}

const opts = (runDir, wt, phase = 'build', extra = {}) => ({ run: runDir, phase, worktree: wt, ...extra });
const entriesOf = (runDir) => {
  const f = path.join(runDir, 'decisions.md');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('- '));
};
const stripTime = (l) => l.replace(/^- (\w[\w-]*) \d{2}:\d{2}:\d{2} — /, '- $1 — ');
const pushCalls = (calls) => calls.git.filter((a) => a[2] === 'push');

// ---- route ----

test('AC2.2: route — local-merge at build logs the SKIP line and calls no git push or gh', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { model: 'local-merge' });
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.equal(env.route, 'local-merge');
  assert.equal(env.push.state, 'skipped');
  assert.equal(env.checklist, null);
  assert.equal(env.mergeState, null);
  assert.equal(pushCalls(h.calls).length, 0);
  assert.equal(h.calls.gh.length, 0);
  assert.equal(h.calls.checklist.length, 0);
  assert.equal(h.calls.mergeState.length, 0);
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(text, /^## \/build\n- SKIP \d{2}:\d{2}:\d{2} — Common Step 7 phase-exit push \(skipped\): /m);
  assert.equal(entriesOf(runDir).length, 1);
});

test('AC2.2: route — local-merge at test is silent', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { model: 'local-merge' });
  const env = runPhaseExit(opts(runDir, wt, 'test'), h.deps);
  assert.equal(env.route, 'local-merge');
  assert.equal(env.push.state, 'skipped');
  assert.deepEqual(entriesOf(runDir), []);
  assert.equal(pushCalls(h.calls).length, 0);
  assert.equal(h.calls.gh.length, 0);
});

test('AC2.2: route — current-branch (git-dir == common-dir) skips like local-merge', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { currentBranch: true });
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.equal(env.route, 'current-branch');
  assert.equal(env.push.state, 'skipped');
  assert.deepEqual(env.bookkeeping, { worktree: 'n/a', pr: 'n/a' });
  assert.equal(pushCalls(h.calls).length, 0);
  assert.equal(h.calls.gh.length, 0);
  assert.equal(h.calls.hooks.length, 0);
  assert.equal(h.calls.checklist.length, 0);
  assert.equal(entriesOf(runDir).length, 1);
  assert.match(entriesOf(runDir)[0], /Common Step 7 phase-exit push \(skipped\)/);
});

test('route — local-merge still backfills a missing worktree stamp (Common Step 7 runs in worktree mode, not only pr-first)', () => {
  const { main, runDir, wt } = fixture({});
  const h = makeDeps(main, wt, { model: 'local-merge' });
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.deepEqual(env.bookkeeping, { worktree: 'backfilled', pr: 'n/a' });
  assert.deepEqual(h.calls.hooks, [['record-worktree', '--run', runDir, path.resolve(wt)]]);
  assert.equal(h.calls.gh.length, 0);
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    '- AUTO — Common Step 7 bookkeeping assertion: backfilled worktree registration before phase-exit push. Reversibility: high.',
    '- SKIP — Common Step 7 phase-exit push (skipped): condition: integration-model=local-merge or current-branch mode → fallback: no phase-exit push, one push at finish. Reversibility: n/a.',
  ]);
});

test('route — an unresolvable integration-model pushes nothing and logs one SKIP degrade trace', () => {
  for (const model of [new Error('resolve-policy: boom'), '', 'something-else']) {
    const { main, runDir, wt } = fixture();
    const h = makeDeps(main, wt, { model });
    const env = runPhaseExit(opts(runDir, wt, 'review'), h.deps);
    assert.equal(env.route, null);
    assert.equal(env.push.state, 'skipped');
    assert.match(env.push.reason, /integration-model unresolved/);
    assert.equal(pushCalls(h.calls).length, 0);
    assert.equal(h.calls.checklist.length, 0);
    const entries = entriesOf(runDir);
    assert.equal(entries.length, 1);
    assert.match(entries[0], /^- SKIP .* — Phase-exit push: condition: integration-model unresolved/);
  }
});

// ---- branch guard ----

test('AC2.2: branch guard — detached HEAD and the integration branch are refused, checklist still runs, merge-state does not', () => {
  const cases = [
    { branch: '', label: 'detached HEAD' },
    { branch: 'main', label: 'main' },
    { branch: 'dev', integrationBranch: 'dev', label: 'dev' },
  ];
  for (const c of cases) {
    const { main, runDir, wt } = fixture();
    const h = makeDeps(main, wt, { branch: c.branch, integrationBranch: c.integrationBranch || '' });
    const env = runPhaseExit(opts(runDir, wt, 'test'), h.deps);
    assert.equal(env.push.state, 'refused', c.label);
    assert.equal(pushCalls(h.calls).length, 0, c.label);
    assert.equal(h.calls.checklist.length, 1, c.label);
    assert.equal(h.calls.mergeState.length, 0, c.label);
    assert.equal(env.mergeState, null);
    assert.equal(env.branch, c.branch || null);
    assert.deepEqual(env.commit, { clean: true, dirty: [] }, c.label);
    const entries = entriesOf(runDir).map(stripTime);
    assert.deepEqual(entries, [`- AUTO — Phase-exit push: refused to push ${c.label} at test exit — not a run branch. Reversibility: n/a.`], c.label);
    assert.ok(!fs.existsSync(path.join(runDir, 'events.jsonl')), c.label);
  }
});

test('branch guard — a refused branch still runs the commit check, so a dirty tree leaves its trace', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { branch: 'main', porcelain: ' M a.js\0' });
  const env = runPhaseExit(opts(runDir, wt, 'review'), h.deps);
  assert.equal(env.push.state, 'refused');
  assert.deepEqual(env.commit, { clean: false, dirty: ['a.js'] });
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    '- AUTO — Phase-exit push: refused to push main at review exit — not a run branch. Reversibility: n/a.',
    '- AUTO — Phase-exit push: 1 uncommitted path(s) at review exit not included in the push. Reversibility: n/a.',
  ]);
});

test('branch guard — integration branch falls back to origin/HEAD, then main', () => {
  // origin/HEAD names `trunk`: a `trunk` branch is refused and a `main` branch is a run branch,
  // so the answer is read, not assumed.
  const underOriginHead = (branch) => {
    const { main, runDir, wt } = fixture();
    const h = makeDeps(main, wt, { branch });
    const baseGit = h.deps.git;
    h.deps.git = (args) => (args[2] === 'symbolic-ref' ? 'origin/trunk\n' : baseGit(args));
    return runPhaseExit(opts(runDir, wt), h.deps);
  };
  assert.equal(underOriginHead('trunk').push.state, 'refused');
  assert.equal(underOriginHead('main').push.state, 'pushed');
  const { main: m2, runDir: r2, wt: w2 } = fixture();
  const h2 = makeDeps(m2, w2, { branch: 'main' });
  const baseGit = h2.deps.git;
  h2.deps.git = (args) => {
    if (args[2] === 'symbolic-ref') throw new Error('not a symbolic ref');
    return baseGit(args);
  };
  const env = runPhaseExit(opts(r2, w2), h2.deps);
  assert.equal(env.push.state, 'refused');
});

// ---- commit check ----

test('AC2.2: commit check — a dirty tree logs the uncommitted-paths line and still pushes', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { porcelain: ' M a.js\0?? b.js\0R  new.js\0old.js\0' });
  const env = runPhaseExit(opts(runDir, wt, 'review'), h.deps);
  assert.deepEqual(env.commit, { clean: false, dirty: ['a.js', 'b.js', 'new.js'] });
  assert.equal(env.push.state, 'pushed');
  assert.deepEqual(pushCalls(h.calls), [['-C', wt, 'push', 'origin', BRANCH]]);
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    '- AUTO — Phase-exit push: 3 uncommitted path(s) at review exit not included in the push. Reversibility: n/a.',
  ]);
  assert.match(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), /^## \/review$/m);
});

test('AC2.2: commit check — a throwing git status reports commit.error, logs nothing and still pushes', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { porcelain: Object.assign(new Error('Command failed'), { stderr: 'fatal: index file corrupt\n' }) });
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.deepEqual(env.commit, { clean: null, dirty: [], error: 'fatal: index file corrupt' });
  assert.equal(env.push.state, 'pushed');
  assert.deepEqual(entriesOf(runDir), []);
});

test('commit check — a clean tree is commit.clean true with no entry', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.deepEqual(env.commit, { clean: true, dirty: [] });
  assert.equal(env.head, 'abc1234def');
  assert.equal(env.branch, BRANCH);
});

// ---- bookkeeping ----

test('AC2.2: bookkeeping — missing worktree calls record-worktree and logs the backfill line', () => {
  const { main, runDir, wt } = fixture({ pr: { number: 42, url: PR_URL } });
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.equal(env.bookkeeping.worktree, 'backfilled');
  assert.equal(env.bookkeeping.pr, 'present');
  assert.deepEqual(h.calls.hooks, [['record-worktree', '--run', runDir, path.resolve(wt)]]);
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    '- AUTO — Common Step 7 bookkeeping assertion: backfilled worktree registration before phase-exit push. Reversibility: high.',
  ]);
});

test('bookkeeping — other phases log under their own step name and section', () => {
  const { main, runDir, wt } = fixture({ pr: { number: 42, url: PR_URL } });
  const h = makeDeps(main, wt);
  runPhaseExit(opts(runDir, wt, 'polish'), h.deps);
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(text, /^## \/flow\n- AUTO \d{2}:\d{2}:\d{2} — Phase-exit bookkeeping assertion: backfilled worktree registration before phase-exit push\. Reversibility: high\.$/m);
});

test('AC2.2: bookkeeping — missing pr with one open PR records it', () => {
  const { main, runDir, wt } = fixture({ worktree: '/wt' });
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.equal(env.bookkeeping.pr, 'backfilled');
  assert.equal(env.bookkeeping.detail, 'recorded open PR #42');
  assert.equal(env.push.state, 'pushed');
  assert.deepEqual(h.calls.gh, [['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number,url']]);
  assert.deepEqual(h.calls.hooks, [['record-pr', '--run', runDir, '42', PR_URL]]);
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    '- AUTO — Common Step 7 bookkeeping assertion: backfilled PR-early lifecycle before phase-exit push. Reversibility: high.',
  ]);
});

// The SKIP line a pr-first push with no recorded PR (and no gate release) writes.
const NO_PR_SKIP = `- SKIP — Phase-exit push: condition: no recorded PR for ${BRANCH} and no PR-early run lifecycle FAILED line → fallback: no phase-exit push this phase; open the PR first (_shared/pr-early-run-lifecycle.md). Reversibility: n/a.`;

test('AC2.2: bookkeeping — missing pr with no open PR reports missing, and the push is skipped ([IL-131])', () => {
  const { main, runDir, wt } = fixture({ worktree: '/wt' });
  const h = makeDeps(main, wt, { prList: [] });
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.equal(env.bookkeeping.pr, 'missing');
  assert.equal(h.calls.hooks.length, 0);
  assert.deepEqual(env.push, { state: 'skipped', reason: 'no recorded PR — open it first (pr-early-run-lifecycle)' });
  assert.equal(pushCalls(h.calls).length, 0);
  assert.equal(h.calls.mergeState.length, 0);
  assert.equal(h.calls.checklist.length, 1);
  assert.deepEqual(entriesOf(runDir).map(stripTime), [NO_PR_SKIP]);
});

test('[IL-131] PR precondition — a logged PR-early FAILED line, prExempt, or a first publish with its Step 1 line releases the push', () => {
  const failedLine = '- AUTO 10:00:00 — /build: PR-early run lifecycle: push of x FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.\n';
  const step1Line = `- AUTO 10:00:00 — PR-early run lifecycle: no existing PR for ${BRANCH}; creating. Reversibility: n/a.\n`;
  const cases = [
    { name: 'FAILED degrade line', state: { worktree: '/wt' }, decisions: failedLine, over: {} },
    { name: 'prExempt', state: { worktree: '/wt', prExempt: true }, decisions: null, over: {} },
    { name: 'first publish + Step 1 line', state: { worktree: '/wt' }, decisions: step1Line, over: { hasNoUpstreamYet: () => true } },
  ];
  for (const c of cases) {
    const { main, runDir, wt } = fixture(c.state);
    if (c.decisions) fs.writeFileSync(path.join(runDir, 'decisions.md'), c.decisions);
    const h = makeDeps(main, wt, { prList: [], ...c.over });
    const env = runPhaseExit(opts(runDir, wt), h.deps);
    assert.equal(env.push.state, 'pushed', c.name);
    assert.equal(pushCalls(h.calls).length, 1, c.name);
  }
});

test('[IL-131] PR precondition — a per-spec run dir also reads its parent run dir for the FAILED degrade line', () => {
  const failedLine = '- AUTO 10:00:00 — /build: PR-early run lifecycle: push of x FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.\n';
  for (const c of [{ parentLine: failedLine, state: 'pushed' }, { parentLine: null, state: 'skipped' }]) {
    const { main, runDir, wt } = fixture({ worktree: '/wt' });
    const specDir = path.join(runDir, 'spec-4');
    fs.mkdirSync(specDir);
    if (c.parentLine) fs.writeFileSync(path.join(runDir, 'decisions.md'), c.parentLine);
    const h = makeDeps(main, wt, { prList: [] });
    const env = runPhaseExit(opts(specDir, wt), h.deps);
    assert.equal(env.push.state, c.state, JSON.stringify(c));
  }
});

test('[IL-131] PR precondition — a first publish without its Step 1 line, or a Step 1 line on a tracked branch, stays skipped', () => {
  const step1Line = `- AUTO 10:00:00 — PR-early run lifecycle: no existing PR for ${BRANCH}; creating. Reversibility: n/a.\n`;
  for (const c of [{ decisions: null, noUpstream: true }, { decisions: step1Line, noUpstream: false }]) {
    const { main, runDir, wt } = fixture({ worktree: '/wt' });
    if (c.decisions) fs.writeFileSync(path.join(runDir, 'decisions.md'), c.decisions);
    const h = makeDeps(main, wt, { prList: [], hasNoUpstreamYet: () => c.noUpstream });
    const env = runPhaseExit(opts(runDir, wt), h.deps);
    assert.equal(env.push.state, 'skipped');
    assert.equal(pushCalls(h.calls).length, 0);
  }
});

test('bookkeeping — a prExempt run is pr n/a with no lookup', () => {
  const { main, runDir, wt } = fixture({ worktree: '/wt', prExempt: true });
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.equal(env.bookkeeping.pr, 'n/a');
  assert.equal(h.calls.gh.length, 0);
});

test('bookkeeping — an ambiguous, unreadable or unrecorded PR lookup reports failed, logs no backfill, and skips the push', () => {
  const cases = [
    { prList: [{ number: 42, url: PR_URL }, { number: 43, url: `${PR_URL}3` }], detail: /2 open PRs/ },
    { prList: new Error('gh: network'), detail: /gh pr list failed/ },
    { prList: 'not json', detail: /gh pr list failed/ },
    { prList: [{ number: 'x', url: PR_URL }], detail: /unusable/ },
    { recordPr: 'claude-tweaks: failed to record PR for x — run-state.json could not be written\n', detail: /failed to record PR/ },
    { recordPr: Object.assign(new Error('exit 1'), { stdout: 'claude-tweaks: record-pr requires --run — PR not recorded\n' }), detail: /did not record PR #42: claude-tweaks: record-pr requires --run/ },
    { recordPr: new Error('spawn EAGAIN'), detail: /did not record PR #42: spawn EAGAIN/ },
  ];
  for (const c of cases) {
    const { main, runDir, wt } = fixture({ worktree: '/wt' });
    const h = makeDeps(main, wt, c);
    const env = runPhaseExit(opts(runDir, wt), h.deps);
    assert.equal(env.bookkeeping.pr, 'failed');
    assert.match(env.bookkeeping.detail, c.detail);
    assert.deepEqual(entriesOf(runDir).map(stripTime), [NO_PR_SKIP]);
    assert.equal(env.push.state, 'skipped');
  }
});

test('AC2.2: bookkeeping — record-worktree failing output reports failed', () => {
  const failing = [
    'claude-tweaks: failed to record worktree for x — run-state.json could not be written\n',
    'claude-tweaks: --run path rejected: x — worktree not recorded\n',
    Object.assign(new Error('exit 1'), { stdout: 'claude-tweaks: record-worktree requires --run — worktree not recorded\n' }),
  ];
  for (const recordWorktree of failing) {
    const { main, runDir, wt } = fixture({ pr: { number: 42, url: PR_URL } });
    const h = makeDeps(main, wt, { recordWorktree });
    const env = runPhaseExit(opts(runDir, wt), h.deps);
    assert.equal(env.bookkeeping.worktree, 'failed');
    assert.match(env.bookkeeping.detail, /record/);
    assert.deepEqual(entriesOf(runDir), []);
    assert.equal(env.push.state, 'pushed');
  }
});

// The run dir cleanup item 8 leaves at wrap-up's exit: the real close-run write (status clean,
// worktree null, worktreeAtClose), on the live path (archive-run refused) or moved under archive/.
function closedFixture(runState, { archive }) {
  const f = fixture(runState);
  const closed = closeRunState(f.runDir, { explicit: true, checkLiveWorktree: false });
  assert.equal(closed.status, 'closed');
  assert.ok(closed.writeOk);
  if (!archive) return f;
  const archived = path.join(f.main, '.claude-tweaks', 'pipelines', 'archive', RUN_ID);
  fs.mkdirSync(path.dirname(archived), { recursive: true });
  fs.renameSync(f.runDir, archived);
  return { ...f, runDir: archived };
}
const runStateOf = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
const commitEventsOf = (runDir) => eventsOf(runDir).filter((e) => e.type === 'commit');

test('closed run — close-run\'s shape is never re-armed: n/a bookkeeping, no hook, no gh, no breadcrumb; push, checklist and merge state still run', () => {
  for (const archive of [false, true]) {
    for (const state of [{ worktree: '/wt', pr: { number: 42, url: PR_URL } }, { worktree: '/wt' }]) {
      const label = `${archive ? 'archive' : 'live'} path, ${state.pr ? 'with' : 'no'} pr`;
      const { main, runDir, wt } = closedFixture(state, { archive });
      const before = runStateOf(runDir);
      assert.equal(before.status, 'clean', label);
      assert.equal(before.worktree, null, label);
      assert.equal(before.worktreeAtClose, '/wt', label);
      const h = makeDeps(main, wt);
      const env = runPhaseExit(opts(runDir, wt, 'wrap-up'), h.deps);
      assert.deepEqual(env.bookkeeping, { worktree: 'n/a', pr: 'n/a' }, label);
      assert.deepEqual(h.calls.hooks, [], label);
      assert.deepEqual(h.calls.gh, [], label);
      assert.deepEqual(runStateOf(runDir), before, label);
      assert.equal(env.push.state, 'pushed', `${label}: a clean run releases the push, as the PreToolUse PR-stamp gate does`);
      assert.equal(pushCalls(h.calls).length, 1, label);
      assert.deepEqual(commitEventsOf(runDir), [], `${label}: no events.jsonl breadcrumb into a closed run`);
      assert.equal(h.calls.checklist.length, 1, label);
      assert.equal(h.calls.mergeState.length, 1, label);
      assert.deepEqual(entriesOf(runDir), [], `${label}: no backfill line`);
      assert.deepEqual(env.logFailures, [], label);
    }
  }
});

test('closed run — a worktreeAtClose alone, or an archived dir with no close-run fields, is never written either', () => {
  for (const [state, archived] of [[{ worktreeAtClose: '/wt', pr: { number: 42, url: PR_URL } }, false], [{}, true]]) {
    const { main, runDir, wt } = fixture(state, { archived });
    const h = makeDeps(main, wt);
    const env = runPhaseExit(opts(runDir, wt, 'wrap-up'), h.deps);
    assert.deepEqual(env.bookkeeping, { worktree: 'n/a', pr: 'n/a' }, JSON.stringify(state));
    assert.deepEqual(h.calls.hooks, [], JSON.stringify(state));
    assert.deepEqual(h.calls.gh, [], JSON.stringify(state));
    assert.deepEqual(commitEventsOf(runDir), [], JSON.stringify(state));
  }
  // Not status clean and no recorded PR: the [IL-131] precondition still holds.
  const { main, runDir, wt } = fixture({}, { archived: true });
  const env = runPhaseExit(opts(runDir, wt, 'wrap-up'), makeDeps(main, wt).deps);
  assert.equal(env.push.state, 'skipped');
  assert.deepEqual(entriesOf(runDir).map(stripTime), [NO_PR_SKIP]);
});

test('active run — a run-state with status active and no worktree still backfills it', () => {
  const { main, runDir, wt } = fixture({ status: 'active', pr: { number: 42, url: PR_URL } });
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt, 'wrap-up'), h.deps);
  assert.equal(env.bookkeeping.worktree, 'backfilled');
  assert.deepEqual(h.calls.hooks, [['record-worktree', '--run', runDir, path.resolve(wt)]]);
  assert.equal(commitEventsOf(runDir).length, 1);
});

// ---- push ----

test('AC2.2: push failure logs the FAILED line, skips merge-state, still flips the checklist', () => {
  const { main, runDir, wt } = fixture();
  const fail = Object.assign(new Error('Command failed'), { stderr: '\nfatal: unable to access remote\nmore\n' });
  const h = makeDeps(main, wt, { push: fail });
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.equal(env.push.state, 'failed');
  assert.equal(env.push.reason, 'fatal: unable to access remote');
  assert.equal(h.calls.checklist.length, 1);
  assert.equal(h.calls.mergeState.length, 0);
  assert.equal(env.mergeState, null);
  assert.ok(!fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8').includes('push'));
  assert.ok(!fs.existsSync(path.join(runDir, 'events.jsonl')), 'a failed push writes no push breadcrumb');
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    `- AUTO — Phase-exit push: push of ${BRANCH} to origin FAILED at build exit (fatal: unable to access remote); the next phase exit's push retries. Reversibility: n/a.`,
  ]);
});

test('push timeout — the push runs under GIT_PUSH_TIMEOUT_MS, not the git bound, and a timeout kill names it', () => {
  assert.ok(GIT_PUSH_TIMEOUT_MS > GIT_TIMEOUT_MS, 'a pre-push hook that runs tests needs more than the 30 s git bound');
  const { main, runDir, wt } = fixture();
  const killed = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM' });
  const h = makeDeps(main, wt, { push: killed });
  const seen = [];
  const base = h.deps.git;
  h.deps.git = (args, o) => { seen.push({ sub: args[2], o }); return base(args); };
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.deepEqual(seen.filter((s) => s.sub === 'push').map((s) => s.o), [{ timeout: GIT_PUSH_TIMEOUT_MS }]);
  assert.ok(seen.filter((s) => s.sub !== 'push').every((s) => s.o === undefined), 'every other git call keeps the default bound');
  assert.deepEqual(env.push, { state: 'failed', reason: `timed out after ${GIT_PUSH_TIMEOUT_MS} ms` });
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    `- AUTO — Phase-exit push: push of ${BRANCH} to origin FAILED at build exit (timed out after ${GIT_PUSH_TIMEOUT_MS} ms); the next phase exit's push retries. Reversibility: n/a.`,
  ]);
});

// ---- worktree guard (wd-push-mismatch) ----

// An active run whose run-state names `assigned` as its worktree; both directories exist on disk.
function assignedFixture(assignedName) {
  const f = fixture(null);
  fs.mkdirSync(f.wt, { recursive: true });
  const assigned = assignedName ? path.join(f.main, '.claude', 'worktrees', assignedName) : f.wt;
  fs.mkdirSync(assigned, { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: assigned, pr: { number: 42, url: PR_URL } }));
  return { ...f, assigned };
}

test('worktree guard — a --worktree other than the active run\'s refuses the push and appends wd-push-mismatch', () => {
  const { main, runDir, wt, assigned } = assignedFixture('dispatch-record-2');
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt, 'review'), h.deps);
  const expected = fs.realpathSync(assigned);
  const actual = fs.realpathSync(wt);
  assert.deepEqual(env.push, { state: 'refused', reason: `--worktree ${actual} is not the run's worktree ${expected}` });
  assert.equal(pushCalls(h.calls).length, 0);
  assert.equal(h.calls.checklist.length, 1, 'a refused push still flips the checklist');
  assert.equal(h.calls.mergeState.length, 0);
  const events = eventsOf(runDir);
  assert.equal(events.length, 1);
  const { ts, ...rest } = events[0];
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(rest, { type: 'wd-push-mismatch', expected, actual, command: `git -C ${wt} push origin ${BRANCH}` });
  assert.deepEqual(entriesOf(runDir).map(stripTime), [
    `- AUTO — Phase-exit push: refused to push ${BRANCH} at review exit — --worktree ${actual} is not the run's worktree ${expected}. Reversibility: n/a.`,
  ]);
  // A failed event append is reported, and the refusal stands.
  const f2 = assignedFixture('dispatch-record-2');
  const h2 = makeDeps(f2.main, f2.wt, { appendEvent: () => { throw new Error('EROFS'); } });
  const env2 = runPhaseExit(opts(f2.runDir, f2.wt, 'review'), h2.deps);
  assert.equal(env2.push.state, 'refused');
  assert.equal(env2.logFailures.length, 1);
  assert.equal(env2.logFailures[0].kind, 'event');
  assert.equal(env2.logFailures[0].type, 'wd-push-mismatch');
});

test('worktree guard — the run\'s own worktree, also through a symlink, pushes with no mismatch event', () => {
  const { main, runDir, wt } = assignedFixture(null);
  const link = path.join(main, 'wt-link');
  fs.symlinkSync(wt, link);
  for (const target of [wt, link]) {
    const h = makeDeps(main, target);
    const env = runPhaseExit(opts(runDir, target), h.deps);
    assert.equal(env.push.state, 'pushed', target);
    assert.equal(eventsOf(runDir).filter((e) => e.type === 'wd-push-mismatch').length, 0, target);
  }
});

test('worktree guard — a closed run is never compared, so its worktreeAtClose cannot refuse the push', () => {
  const other = os.tmpdir(); // a real directory that is not --worktree
  const { main, runDir, wt } = closedFixture({ worktree: other, pr: { number: 42, url: PR_URL } }, { archive: false });
  fs.mkdirSync(wt, { recursive: true });
  const env = runPhaseExit(opts(runDir, wt, 'wrap-up'), makeDeps(main, wt).deps);
  assert.equal(env.push.state, 'pushed');
  assert.equal(eventsOf(runDir).filter((e) => e.type === 'wd-push-mismatch').length, 0);
  // close-run nulls `worktree`, so the case above never reaches the comparison; a clean
  // run that still names another worktree is what proves the closed guard itself.
  const f2 = fixture(null);
  fs.mkdirSync(f2.wt, { recursive: true });
  fs.writeFileSync(path.join(f2.runDir, 'run-state.json'), JSON.stringify({ status: 'clean', worktree: other, pr: { number: 42, url: PR_URL } }));
  const env2 = runPhaseExit(opts(f2.runDir, f2.wt, 'wrap-up'), makeDeps(f2.main, f2.wt).deps);
  assert.equal(env2.push.state, 'pushed');
  assert.equal(eventsOf(f2.runDir).filter((e) => e.type === 'wd-push-mismatch').length, 0);
});

// ---- push breadcrumb (events.jsonl) ----

const eventsOf = (runDir) => {
  const f = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

test('push breadcrumb — a landed push writes exactly the post-tool-use.js push event through context.js appendEvent', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt, 'wrap-up'), h.deps);
  assert.equal(env.push.state, 'pushed');
  const events = eventsOf(runDir);
  assert.equal(events.length, 1);
  const { ts, ...rest } = events[0];
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(rest, { action: 'push', dir: path.resolve(wt), hash: 'abc1234', type: 'commit' });
  assert.deepEqual(env.logFailures, []);
});

test('push breadcrumb — the timing derivation reads it as the merge phase start', () => {
  const { derivePhases } = require('../../../plugin/bin/lib/timing/derive');
  const { main, runDir, wt } = fixture();
  const t0 = new Date(Date.UTC(2026, 9, 25, 12, 0, 0)).toISOString();
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: t0, type: 'skill_invoked', skill: 'claude-tweaks:wrap-up' })}\n`);
  runPhaseExit(opts(runDir, wt, 'wrap-up'), makeDeps(main, wt).deps);
  const events = eventsOf(runDir);
  assert.equal(events.length, 2);
  const out = derivePhases({ events, now: new Date(Date.parse(events[1].ts) + 60000) });
  const merge = out.phases.find((p) => p.phase === 'merge');
  assert.ok(merge, JSON.stringify(out.phases));
  assert.equal(merge.source, 'commit');
  assert.equal(merge.start, events[1].ts);
  // Control: the same events without the breadcrumb derive no commit-sourced merge span.
  const control = derivePhases({ events: [events[0]], now: new Date(Date.parse(events[1].ts) + 60000) });
  assert.notEqual((control.phases.find((p) => p.phase === 'merge') || {}).source, 'commit');
});

test('push breadcrumb — a failed, refused, or skipped push writes none', () => {
  const cases = [
    { push: new Error('rejected') },
    { branch: 'main' },
    { model: 'local-merge' },
    { currentBranch: true },
  ];
  for (const c of cases) {
    const { main, runDir, wt } = fixture();
    runPhaseExit(opts(runDir, wt), makeDeps(main, wt, c).deps);
    assert.deepEqual(eventsOf(runDir), [], JSON.stringify(c));
  }
  const { main, runDir, wt } = fixture({ worktree: '/wt' });
  const env = runPhaseExit(opts(runDir, wt), makeDeps(main, wt, { prList: [] }).deps);
  assert.equal(env.push.state, 'skipped');
  assert.deepEqual(eventsOf(runDir), []);
});

test('push breadcrumb — deduped on (action, hash, dir) against a prior push event, as post-tool-use.js does', () => {
  const { main, runDir, wt } = fixture();
  const prior = { action: 'push', dir: path.resolve(wt), hash: 'abc1234', ts: '2026-10-25T10:00:00.000Z', type: 'commit' };
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify(prior)}\n`);
  runPhaseExit(opts(runDir, wt), makeDeps(main, wt).deps);
  assert.equal(eventsOf(runDir).length, 1);
});

test('push breadcrumb — an unreadable short hash writes the event without one, and the dedupe (which needs a hash) lets it repeat', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt);
  const baseGit = h.deps.git;
  h.deps.git = (args) => {
    if (args.slice(2).join(' ') === 'rev-parse --short HEAD') throw new Error('no short hash');
    return baseGit(args);
  };
  runPhaseExit(opts(runDir, wt), h.deps);
  runPhaseExit(opts(runDir, wt), h.deps);
  const events = eventsOf(runDir);
  assert.equal(events.length, 2);
  for (const e of events) assert.deepEqual({ type: e.type, action: e.action, hash: e.hash }, { type: 'commit', action: 'push', hash: undefined });
});

test('push breadcrumb — an append failure lands in logFailures and changes nothing else', () => {
  const { main, runDir, wt } = fixture();
  const good = runPhaseExit(opts(runDir, wt), makeDeps(main, wt).deps);
  const { main: m2, runDir: r2, wt: w2 } = fixture();
  const h = makeDeps(m2, w2, { appendEvent: () => { throw new Error('EROFS'); } });
  const env = runPhaseExit(opts(r2, w2), h.deps);
  assert.equal(env.logFailures.length, 1);
  assert.deepEqual(env.logFailures[0], {
    kind: 'event', type: 'commit', data: { action: 'push', dir: path.resolve(w2), hash: 'abc1234' }, error: 'EROFS',
  });
  assert.match(h.err.join(''), /events\.jsonl push breadcrumb: EROFS/);
  const strip = (e) => ({ ...e, logFailures: [] });
  assert.deepEqual(strip(env), strip(good));
  assert.equal(h.calls.mergeState.length, 1);
});

// ---- the real git seam ----

test('realDeps.git — output past execFileSync\'s 1 MiB default is returned, not killed (a chatty pre-push hook must not read as a timeout)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-phase-exit-git-'));
  created.push(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore', windowsHide: true });
  git('init', '-q');
  const message = path.join(repo, 'message.txt');
  fs.writeFileSync(message, 'x'.repeat(2 * 1024 * 1024));
  git('commit', '-q', '--allow-empty', '-F', message);
  const out = realDeps.git(['-C', repo, 'log', '-1', '--format=%B']);
  assert.ok(out.length >= 2 * 1024 * 1024, `read ${out.length} bytes`);
});

// ---- checklist ----

test('AC2.2: checklist exit 4/5 is reported in the envelope with exit 0 overall', () => {
  for (const code of [4, 5]) {
    const { main, runDir, wt } = fixture();
    const h = makeDeps(main, wt, { checklist: { exit: code, out: null } });
    const env = runPhaseExit(opts(runDir, wt), h.deps);
    assert.equal(env.checklist.exit, code);
    assert.equal(env.push.state, 'pushed');
    assert.deepEqual(entriesOf(runDir), []);
  }
  // Through the CLI wrapper: exit 0 overall.
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { checklist: { exit: 5, out: null } });
  assert.equal(run(['--run', runDir, '--phase', 'build', '--worktree', wt], h.deps), 0);
  assert.equal(JSON.parse(h.out.join('')).checklist.exit, 5);
});

test('checklist — the parsed envelope is carried and the forwarded flags reach pr-checklist unchanged', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt);
  const env = runPhaseExit(opts(runDir, wt, 'test', { remove: true, fixes: '12,13', summaryFile: '/s.md' }), h.deps);
  assert.deepEqual(env.checklist, { exit: 0, action: 'written', pr: 42, phase: 'build' });
  assert.deepEqual(h.calls.checklist, [['--run', runDir, '--phase', 'test', '--remove', '--fixes', '12,13', '--summary-file', '/s.md']]);
});

test('checklist — --fixes is not forwarded when absent', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt);
  runPhaseExit(opts(runDir, wt), h.deps);
  assert.deepEqual(h.calls.checklist, [['--run', runDir, '--phase', 'build']]);
});

// ---- merge state ----

test('AC2.2: merge-state envelope is carried through after a successful push', () => {
  const { main, runDir, wt } = fixture();
  const ms = { state: 'conflicting', pr: 42, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', phase: 'review', logged: true };
  const h = makeDeps(main, wt, { mergeState: ms });
  const env = runPhaseExit(opts(runDir, wt, 'review'), h.deps);
  assert.equal(env.push.state, 'pushed');
  assert.deepEqual(env.mergeState, { exit: 0, ...ms });
  assert.deepEqual(h.calls.mergeState, [['--run', runDir, '--phase', 'review']]);
  assert.deepEqual(entriesOf(runDir), [], 'phase-exit never re-logs a sub-CLI line');
});

test('AC2.2: merge state — a non-zero exit, no or garbled JSON, and a throw are reported as data, exit 0 overall', () => {
  const cases = [
    { mergeState: { exit: 3, raw: '' }, expected: { exit: 3 } },
    { mergeState: { exit: 2, raw: 'pr-merge-state.js: invalid --phase\n' }, expected: { exit: 2 } },
    { mergeState: { exit: 0, raw: '{"state": "no-conf' }, expected: { exit: 0 } },
    { mergeState: { exit: 0, raw: '[1,2]\n' }, expected: { exit: 0 } },
    { mergeState: new Error('resolver exploded'), expected: { exit: null, error: 'resolver exploded' } },
  ];
  for (const c of cases) {
    const { main, runDir, wt } = fixture();
    const h = makeDeps(main, wt, { mergeState: c.mergeState });
    const env = runPhaseExit(opts(runDir, wt), h.deps);
    assert.deepEqual(env.mergeState, c.expected, JSON.stringify(c.mergeState));
    assert.equal(env.push.state, 'pushed');
    assert.deepEqual(entriesOf(runDir), []);
    assert.equal(run(['--run', runDir, '--phase', 'build', '--worktree', wt], makeDeps(main, wt, { mergeState: c.mergeState }).deps), 0);
  }
});

test('AC2.2: checklist — a throwing pr-checklist run is reported as data and merge state still runs', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { checklist: new Error('gh exploded') });
  const env = runPhaseExit(opts(runDir, wt), h.deps);
  assert.deepEqual(env.checklist, { exit: null, error: 'gh exploded' });
  assert.equal(env.push.state, 'pushed');
  assert.equal(h.calls.mergeState.length, 1);
  assert.equal(run(['--run', runDir, '--phase', 'build', '--worktree', wt], makeDeps(main, wt, { checklist: new Error('x') }).deps), 0);
});

// ---- log failures ----

test('AC2.2: an append failure lands in logFailures and changes nothing else', () => {
  const { main, runDir, wt } = fixture({ pr: { number: 42, url: PR_URL } });
  const base = makeDeps(main, wt, { porcelain: ' M a.js\0' });
  const good = runPhaseExit(opts(runDir, wt), base.deps);
  const { main: m2, runDir: r2, wt: w2 } = fixture({ pr: { number: 42, url: PR_URL } });
  const h = makeDeps(m2, w2, { porcelain: ' M a.js\0', appendDecision: () => { throw new Error('disk full'); } });
  const env = runPhaseExit(opts(r2, w2), h.deps);
  assert.equal(env.logFailures.length, 2);
  assert.match(env.logFailures[0].error, /disk full/);
  assert.equal(env.logFailures[0].step, 'Phase-exit push');
  assert.match(env.logFailures[0].text, /1 uncommitted path\(s\)/);
  assert.equal(env.logFailures[1].step, 'Common Step 7 bookkeeping assertion');
  assert.equal(env.logFailures[1].status, 'AUTO');
  assert.match(env.logFailures[1].text, /backfilled worktree registration/);
  const strip = (e) => ({ ...e, logFailures: [], checklist: null, mergeState: null });
  assert.deepEqual(strip(env), strip(good));
  assert.equal(good.logFailures.length, 0);
  assert.equal(h.err.join('').trim().split('\n').length, 2);
});

// ---- AC3.1 parity ----

test('AC3.1: phase-exit writes the same entries the prose sequence wrote', () => {
  // Expected lines are copied from the current prose: _shared/git-discipline.md's
  // Phase-exit push SKIP command, build/SKILL.md Common Step 7's bookkeeping-assertion line,
  // and git-discipline.md's "logs a warning" on a failed push (task brief text).
  const cases = [
    { name: 'clean pr-first build exit', state: undefined, deps: {}, expected: [] },
    {
      name: 'push failure',
      state: undefined,
      deps: { push: Object.assign(new Error('x'), { stderr: 'error: failed to push some refs\n' }) },
      expected: [`- AUTO — Phase-exit push: push of ${BRANCH} to origin FAILED at build exit (error: failed to push some refs); the next phase exit's push retries. Reversibility: n/a.`],
    },
    {
      name: 'local-merge build',
      state: undefined,
      deps: { model: 'local-merge' },
      expected: ['- SKIP — Common Step 7 phase-exit push (skipped): condition: integration-model=local-merge or current-branch mode → fallback: no phase-exit push, one push at finish. Reversibility: n/a.'],
    },
    {
      name: 'missing-worktree backfill',
      state: { pr: { number: 42, url: PR_URL } },
      deps: {},
      expected: ['- AUTO — Common Step 7 bookkeeping assertion: backfilled worktree registration before phase-exit push. Reversibility: high.'],
    },
    {
      // build/SKILL.md:309's `{worktree registration | PR-early lifecycle}` alternative.
      name: 'missing-PR backfill',
      state: { worktree: '/wt' },
      deps: {},
      expected: ['- AUTO — Common Step 7 bookkeeping assertion: backfilled PR-early lifecycle before phase-exit push. Reversibility: high.'],
    },
  ];
  for (const c of cases) {
    const { main, runDir, wt } = fixture(c.state);
    const h = makeDeps(main, wt, c.deps);
    runPhaseExit(opts(runDir, wt), h.deps);
    assert.deepEqual(entriesOf(runDir).map(stripTime), c.expected, c.name);
  }
});

// ---- CLI wrapper ----

test('CLI: --help exits 0 and prints usage without touching any seam', () => {
  const { main, wt } = fixture();
  const h = makeDeps(main, wt);
  assert.equal(run(['--help'], h.deps), 0);
  assert.match(h.out.join(''), /^usage: phase-exit\.js --run <run-dir> --phase <build\|test\|review\|polish\|wrap-up> --worktree <path>/);
  assert.equal(h.calls.git.length + h.calls.gh.length + h.calls.policy.length, 0);
});

test('CLI: a successful call prints one JSON line and exits 0', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt);
  assert.equal(run(['--run', runDir, '--phase', 'build', '--worktree', wt], h.deps), 0);
  const lines = h.out.join('').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const env = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(env), ['phase', 'route', 'branch', 'head', 'commit', 'bookkeeping', 'push', 'checklist', 'mergeState', 'logFailures']);
  assert.equal(env.route, 'pr-first');
  assert.equal(env.push.state, 'pushed');
});

test('CLI: missing --worktree / --phase, an unknown phase or flag, and a malformed --fixes exit 2', () => {
  const { main, runDir, wt } = fixture();
  for (const argv of [
    ['--run', runDir, '--phase', 'build'],
    ['--run', runDir, '--worktree', wt],
    ['--phase', 'build', '--worktree', wt],
    ['--run', runDir, '--phase', 'deploy', '--worktree', wt],
    ['--run', runDir, '--phase', 'build', '--worktree', wt, '--bogus'],
    ['--run', runDir, '--phase', 'build', '--worktree', wt, '--fixes', 'abc'],
    ['--run', runDir, '--phase', 'build', '--worktree'],
  ]) {
    const h = makeDeps(main, wt);
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.equal(h.calls.git.length, 0, argv.join(' '));
    assert.equal(h.out.join(''), '');
  }
});

test('CLI: a --worktree that is not a git checkout exits 2', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { git: () => { throw new Error('fatal: not a git repository'); } });
  assert.equal(run(['--run', runDir, '--phase', 'build', '--worktree', wt], h.deps), 2);
  assert.match(h.err.join(''), /not a git checkout/);
  assert.deepEqual(entriesOf(runDir), []);
});

test('CLI: unanchored or missing --run exits 3 before any probe', () => {
  const { main, wt } = fixture();
  const shadowWt = path.join(main, '.claude', 'worktrees', 'flow-spec-1');
  const shadow = path.join(shadowWt, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadowWt, '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-1\n');
  for (const [runDir, re] of [[shadow, /not anchored/], [path.join(main, 'nope'), /does not exist/]]) {
    const h = makeDeps(main, wt);
    assert.equal(run(['--run', runDir, '--phase', 'build', '--worktree', wt], h.deps), 3);
    assert.match(h.err.join(''), re);
    assert.equal(h.calls.git.length, 0);
    assert.equal(h.out.join(''), '');
  }
  assert.ok(!fs.existsSync(path.join(shadow, 'decisions.md')));
});

test('CLI: a relative --run and --worktree reach every sub-step as one absolute path', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt);
  const relRun = path.relative(process.cwd(), runDir);
  const relWt = path.relative(process.cwd(), wt);
  assert.ok(!path.isAbsolute(relRun) && !path.isAbsolute(relWt));
  assert.equal(run(['--run', relRun, '--phase', 'build', '--worktree', relWt], h.deps), 0);
  assert.deepEqual(h.calls.checklist, [['--run', runDir, '--phase', 'build']]);
  assert.deepEqual(h.calls.mergeState, [['--run', runDir, '--phase', 'build']]);
  assert.ok(h.calls.git.every((a) => a[1] === wt), JSON.stringify(h.calls.git));
  assert.equal(eventsOf(runDir).length, 1);
});

test('CLI: an archived wrap-up run dir resolves', () => {
  const { main, runDir, wt } = closedFixture(undefined, { archive: true });
  const h = makeDeps(main, wt);
  assert.equal(run(['--run', runDir, '--phase', 'wrap-up', '--worktree', wt], h.deps), 0);
  const env = JSON.parse(h.out.join(''));
  assert.equal(env.push.state, 'pushed');
  assert.deepEqual(env.bookkeeping, { worktree: 'n/a', pr: 'n/a' });
});
