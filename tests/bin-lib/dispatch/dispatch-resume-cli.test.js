'use strict';
// #4588: pins plugin/bin/dispatch-resume.js, the gatherer behind `/claude-tweaks:dispatch resume #N`.
// The CLI reads PR / labels / claim / run-dir / worktree state through injected deps and hands it to
// the pure verdict (lib/dispatch/resume-eligibility.js); these tests drive `run(argv, deps)` with fakes
// shaped like the real #4589 stall (draft PR #4604, run 2026-10-30T101632-record-4589).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run, realDeps } = require('../../../plugin/bin/dispatch-resume');
const { claimPayload, releasePayload } = require('../../../plugin/bin/lib/issues/claims');
const { findConflictingSession } = require('../../../plugin/bin/lib/hooks/sibling-sessions');
const { MAX_PID } = require('../../../plugin/bin/lib/run-liveness/owner-pid-probe');

const N = 4589;
const PR = 4604;
const HEAD = 'worktree-dispatch-record-4589';
const RUN = '2026-10-30T101632-record-4589';
const URL = 'https://github.com/o/r/pull/4604';
const OID = 'a'.repeat(40);
const SLUG = 'o/r';
const MAIN = '/repo';
const ROOT = '/repo/.claude-tweaks/pipelines';
const ARCH = `${ROOT}/archive/${RUN}`;
const RUNDIR = `${ROOT}/${RUN}`;
const WT = '/repo/.claude/worktrees/dispatch-record-4589';
const NOW = Date.parse('2026-10-31T12:00:00Z');
const HOUR = 3600 * 1000;
const SESSION = 'resuming-session';
const BODY = `## Summary\n\nclaude-tweaks-run: ${RUN}\n<!-- claude-tweaks-run: ${RUN} -->\n`;
const CLEAN_STATUS = `## ${HEAD}...origin/${HEAD}\0`;
const DECISIONS = path.join(__dirname, '..', '..', 'fixtures', 'dispatch-resume', 'record-4589-decisions.md');

function prEntry(over = {}) {
  return {
    url: URL, number: PR, headRefName: HEAD, headRefOid: OID, body: BODY, isDraft: true, isCrossRepository: false, ...over,
  };
}
function tombstone(reason, over = {}) {
  return releasePayload({
    issueNumber: N, runId: RUN, reason, now: NOW - 5 * HOUR, ...over,
  }).tombstoneContent;
}
const FAILED = () => tombstone('failed: plan-review-needs-human');
const STALE = () => claimPayload({
  issueNumber: N, runId: RUN, sessionId: 's1', ttlHours: 72, host: 'h', now: NOW - 100 * HOUR,
}).fileContent;
const gitExit1 = () => Object.assign(new Error('exit 1'), { status: 1, stdout: '' });

// A fake world. `cfg` is mutated by each test before run(); `calls` records every dep touch.
function makeEnv(over = {}) {
  const cfg = {
    prs: [prEntry()],
    issue: { labels: [{ name: 'ready' }, { name: 'auto:build' }], state: 'OPEN', body: 'No deps.' },
    depStates: {},
    claim: FAILED(),
    claimResult: null,
    files: {},
    dirs: {},
    status: CLEAN_STATUS,
    statusThrows: false,
    revParse: () => { throw gitExit1(); },
    porcelain: `worktree ${MAIN}\nHEAD ${OID}\nbranch refs/heads/main\n\n`,
    sibling: null,
    runDirs: [],
    workLinks: 'body-text',
    native: new Map(),
    sessionId: SESSION,
    host: 'h1',
    alive: () => true,
    startTime: () => 'T0',
    gitAvailable: true,
    ...over,
  };
  // default world: run archived, stalled worktree present
  if (!over.files && !over.dirs) {
    cfg.dirs[ARCH] = ['run-state.json', 'decisions.md'];
    cfg.files[`${ARCH}/run-state.json`] = JSON.stringify({
      status: 'clean', sessionId: 'dispatcher', worktree: null, worktreeAtClose: WT,
    });
    cfg.dirs[WT] = ['x'];
  }
  const calls = {
    gh: [], git: [], fs: [], findSibling: [], readClaim: [], native: [], out: [], err: [],
  };
  const deps = {
    stdout: (s) => calls.out.push(s),
    stderr: (s) => calls.err.push(s),
    mainRoot: () => MAIN,
    ghAvailable: () => cfg.gitAvailable,
    sessionId: cfg.sessionId,
    now: () => NOW,
    gh: (args) => {
      calls.gh.push(args);
      if (args[0] === 'repo') return `${SLUG}\n`;
      if (args[0] === 'pr' && args[1] === 'list') {
        if (cfg.prListThrows) throw new Error('boom pr list');
        return typeof cfg.prs === 'string' ? cfg.prs : JSON.stringify(cfg.prs);
      }
      if (args[0] === 'issue' && args[1] === 'view') {
        const n = Number(args[2]);
        if (n === N) {
          if (cfg.issueThrows) throw new Error('boom issue view');
          return JSON.stringify(cfg.issue);
        }
        const st = cfg.depStates[n];
        if (st === undefined || st instanceof Error) throw st || new Error(`no dep ${n}`);
        return JSON.stringify({ state: st });
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    git: (args) => {
      calls.git.push(args);
      if (args.includes('status')) {
        if (cfg.statusThrows) throw new Error('status boom');
        return cfg.status;
      }
      if (args.includes('rev-parse')) return cfg.revParse(args);
      if (args.includes('worktree')) return cfg.porcelain;
      throw new Error(`unexpected git ${args.join(' ')}`);
    },
    readClaim: (slug, n) => {
      calls.readClaim.push([slug, n]);
      return cfg.claimResult || { content: cfg.claim, failure: null, absent: false };
    },
    exists: (p) => { calls.fs.push(['exists', p]); return Object.hasOwn(cfg.files, p) || Object.hasOwn(cfg.dirs, p); },
    readdir: (p) => {
      calls.fs.push(['readdir', p]);
      if (!Object.hasOwn(cfg.dirs, p)) throw new Error(`ENOENT ${p}`);
      return cfg.dirs[p];
    },
    readFile: (p) => {
      calls.fs.push(['readFile', p]);
      if (!Object.hasOwn(cfg.files, p)) throw new Error(`ENOENT ${p}`);
      return cfg.files[p];
    },
    findSibling: (ref, opts) => {
      calls.findSibling.push({ ref, opts });
      return cfg.sibling ? cfg.sibling(ref, opts) : null;
    },
    listRunDirsWithState: () => cfg.runDirs,
    probes: {
      hostname: () => cfg.host,
      pidAlive: (pid) => { calls.pidAlive = (calls.pidAlive || 0) + 1; return cfg.alive(pid); },
      pidStartTime: (pid) => cfg.startTime(pid),
    },
    workLinks: () => cfg.workLinks,
    fetchNative: (opts) => { calls.native.push(opts); return cfg.native; },
    resolveTarget: ({ runDir }) => (cfg.target ? cfg.target(runDir) : { ok: true, dir: runDir }),
  };
  return { cfg, calls, deps };
}

function exec(env, argv = ['--issue', String(N)]) {
  const code = run(argv, env.deps);
  const lines = env.calls.out.join('').split('\n').filter(Boolean);
  return { code, json: lines.length ? JSON.parse(lines[lines.length - 1]) : null, lines, err: env.calls.err.join('') };
}

function setRunState(env, state, { files = ['run-state.json', 'work'] } = {}) {
  delete env.cfg.dirs[ARCH];
  delete env.cfg.files[`${ARCH}/run-state.json`];
  env.cfg.dirs[RUNDIR] = files;
  if (state !== undefined) env.cfg.files[`${RUNDIR}/run-state.json`] = typeof state === 'string' ? state : JSON.stringify(state);
}
const OWNER = { sessionId: 'other-session', host: 'h1', pid: 4242, pidStartedAt: 'T0' };

// ---- baseline and PR selection ----

test('eligible: archived prior run, failed: tombstone, clean worktree -> exit 0 with the full JSON', () => {
  const env = makeEnv();
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(env.calls.out.length, 1, 'exactly one stdout write');
  assert.deepStrictEqual(r.json, {
    eligible: true,
    issue: N,
    prUrl: URL,
    prNumber: PR,
    headRefName: HEAD,
    priorRunId: RUN,
    priorRunDir: 'archived',
    priorRunPath: null,
    archivePriorRun: false,
    closePriorRun: false,
    localBranchExists: false,
    worktreePath: WT,
    context: { lastPhase: null, openDefects: [] },
  });
});

test('the gh pr list argv pins the head branch, repo and a --json list that includes isDraft and headRefOid', () => {
  const env = makeEnv();
  exec(env);
  const call = env.calls.gh.find((a) => a[0] === 'pr' && a[1] === 'list');
  assert.deepStrictEqual(call, [
    'pr', 'list', '--repo', SLUG, '--head', HEAD, '--state', 'open',
    '--json', 'url,number,headRefName,headRefOid,body,isDraft,isCrossRepository',
  ]);
});

test('context is read from the archived decisions.md', () => {
  const env = makeEnv();
  env.cfg.files[`${ARCH}/decisions.md`] = fs.readFileSync(DECISIONS, 'utf8');
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.deepStrictEqual(r.json.context.lastPhase, { section: '/build', step: 'Common Step 1.5' });
  assert.equal(r.json.context.openDefects.length, 1);
});

test('context falls back to the root decisions.md when the run is not archived', () => {
  const env = makeEnv();
  setRunState(env, { status: 'clean' });
  env.cfg.files[`${RUNDIR}/decisions.md`] = '## /build\n- AUTO 10:00:00 — Step 1: built. Reversibility: n/a.\n';
  const r = exec(env);
  assert.deepStrictEqual(r.json.context.lastPhase, { section: '/build', step: 'Step 1' });
});

test('context prefers the archived decisions.md over a root stub of the same run', () => {
  const env = makeEnv();
  env.cfg.files[`${ARCH}/decisions.md`] = '## /build\n- AUTO 10:00:00 — Step 7: archived. Reversibility: n/a.\n';
  env.cfg.dirs[RUNDIR] = ['work', 'decisions.md'];
  env.cfg.files[`${RUNDIR}/decisions.md`] = '## /build\n- AUTO 10:00:00 — Step 1: stub. Reversibility: n/a.\n';
  assert.deepStrictEqual(exec(env).json.context.lastPhase, { section: '/build', step: 'Step 7' });
});

test('a fork PR listed before the same-repo PR:the prior run id comes from the same-repo PR marker', () => {
  const env = makeEnv();
  env.cfg.prs = [
    prEntry({ number: 9, url: 'https://github.com/f/r/pull/9', isCrossRepository: true, body: 'claude-tweaks-run: 2020-01-01T000000-record-4589\n' }),
    prEntry(),
  ];
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.priorRunId, RUN);
  assert.ok(env.calls.fs.some(([, p]) => p === ARCH), 'the fake fs saw archive/{that id}');
  assert.ok(!env.calls.fs.some(([, p]) => p.includes('2020-01-01')));
});

test('foreign head -> exit 3 with the open-pr line', () => {
  const env = makeEnv();
  env.cfg.prs = [prEntry({ headRefName: 'worktree-dispatch-record-1' })];
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.deepStrictEqual(r.json, {
    eligible: false, issue: N, reason: 'foreign-pr',
    line: `#${N} already has an open PR (#${PR}) — not re-dispatch-eligible until that PR merges or closes`,
  });
});

test('isDraft: false -> exit 3 not-draft', () => {
  const env = makeEnv();
  env.cfg.prs = [prEntry({ isDraft: false })];
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'not-draft');
});

test('an empty listing -> exit 3 no-pr with zero claim, fs, sibling and git reads', () => {
  const env = makeEnv();
  env.cfg.prs = [];
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'no-pr');
  assert.deepStrictEqual(env.calls.readClaim, []);
  assert.deepStrictEqual(env.calls.fs, []);
  assert.deepStrictEqual(env.calls.findSibling, []);
  assert.deepStrictEqual(env.calls.git, []);
  assert.ok(!env.calls.gh.some((a) => a[0] === 'issue'), 'no label read either');
});

test('two same-repo PRs on the head branch pass through: exit 3 multiple-prs naming both numbers', () => {
  const env = makeEnv();
  env.cfg.prs = [prEntry(), prEntry({ number: 4700, url: 'https://github.com/o/r/pull/4700' })];
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'multiple-prs');
  assert.match(r.json.line, /#4604, #4700/);
  assert.deepStrictEqual(env.calls.readClaim, []);
});

test('a non-array listing -> exit 4', () => {
  const env = makeEnv();
  env.cfg.prs = '{"not":"an array"}';
  assert.equal(exec(env).code, 4);
});

test('an unparseable listing -> exit 4', () => {
  const env = makeEnv();
  env.cfg.prs = 'not json';
  assert.equal(exec(env).code, 4);
});

test('gh throws on pr list -> exit 4', () => {
  const env = makeEnv();
  env.cfg.prListThrows = true;
  assert.equal(exec(env).code, 4);
});

// ---- argv / environment ----

test('missing --issue -> exit 2', () => {
  const r = exec(makeEnv(), []);
  assert.equal(r.code, 2);
  assert.match(r.err, /--issue/);
});

test('malformed --issue values -> exit 2 (zero, negative, decimal, empty, trailing flag)', () => {
  for (const argv of [['--issue', '0'], ['--issue', '-3'], ['--issue', '4.5'], ['--issue', ''], ['--issue'], ['--issue', '12abc']]) {
    const env = makeEnv();
    assert.equal(exec(env, argv).code, 2, argv.join(' '));
    assert.deepStrictEqual(env.calls.gh, []);
  }
});

test('unknown flag and a value-less --bound-run -> exit 2', () => {
  assert.equal(exec(makeEnv(), ['--issue', '5', '--wat']).code, 2);
  assert.equal(exec(makeEnv(), ['--issue', '5', '--bound-run']).code, 2);
});

test('--help prints usage, exit 0, before any dep is touched', () => {
  const env = makeEnv();
  const code = run(['--help'], env.deps);
  assert.equal(code, 0);
  assert.match(env.calls.out.join(''), /usage: dispatch-resume\.js/);
  assert.deepStrictEqual(env.calls.gh, []);
});

test('gh absent -> exit 2', () => {
  const env = makeEnv({ gitAvailable: false });
  assert.equal(exec(env).code, 2);
  assert.deepStrictEqual(env.calls.gh, []);
});

test('ghAvailable throwing -> exit 2', () => {
  const env = makeEnv();
  env.deps.ghAvailable = () => { throw new Error('x'); };
  assert.equal(exec(env).code, 2);
});

test('main root unresolvable -> exit 2', () => {
  const env = makeEnv();
  env.deps.mainRoot = () => null;
  assert.equal(exec(env).code, 2);
});

test('repo slug unresolved (empty answer or throw) -> exit 2', () => {
  const a = makeEnv();
  const ghA = a.deps.gh;
  a.deps.gh = (args) => (args[0] === 'repo' ? '\n' : ghA(args));
  assert.equal(exec(a).code, 2);
  const b = makeEnv();
  const ghB = b.deps.gh;
  b.deps.gh = (args) => { if (args[0] === 'repo') throw new Error('no repo'); return ghB(args); };
  assert.equal(exec(b).code, 2);
});

// ---- labels, record state, blockers ----

test('bot:blocked label -> exit 3 not-granted', () => {
  const env = makeEnv();
  env.cfg.issue.labels.push({ name: 'bot:blocked' });
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'not-granted');
});

test('bot:parked label -> exit 3 unlisted-label', () => {
  const env = makeEnv();
  env.cfg.issue.labels.push({ name: 'bot:parked' });
  assert.equal(exec(env).json.reason, 'unlisted-label');
});

test('the issue read is one gh issue view with the labels,state,body field list', () => {
  const env = makeEnv();
  exec(env);
  const reads = env.calls.gh.filter((a) => a[0] === 'issue');
  assert.deepStrictEqual(reads, [['issue', 'view', String(N), '--repo', SLUG, '--json', 'labels,state,body']]);
});

test('state: CLOSED -> exit 3 record-closed', () => {
  const env = makeEnv();
  env.cfg.issue.state = 'CLOSED';
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'record-closed');
});

test('a body Blocked by #4500 whose state is OPEN -> exit 3 blocked-by; CLOSED -> eligible', () => {
  const open = makeEnv();
  open.cfg.issue.body = 'Spec.\n\nBlocked by #4500\n';
  open.cfg.depStates[4500] = 'OPEN';
  const r = exec(open);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'blocked-by');
  assert.match(r.json.line, /#4500/);
  assert.deepStrictEqual(open.calls.gh.filter((a) => a[2] === '4500'), [['issue', 'view', '4500', '--repo', SLUG, '--json', 'state']]);

  const closed = makeEnv();
  closed.cfg.issue.body = 'Blocked by #4500\n';
  closed.cfg.depStates[4500] = 'CLOSED';
  assert.equal(exec(closed).code, 0);
});

test('a blocker whose state read throws -> exit 4, never read as closed', () => {
  const env = makeEnv();
  env.cfg.issue.body = 'Blocked by #4500\n';
  env.cfg.depStates[4500] = new Error('gh 502');
  assert.equal(exec(env).code, 4);
});

test('a blocker state that is not a string -> exit 4', () => {
  const env = makeEnv();
  env.cfg.issue.body = 'Blocked by #4500\n';
  env.cfg.depStates[4500] = null;
  assert.equal(exec(env).code, 4);
});

test('the issue read throwing, or a labels field that is not an array -> exit 4', () => {
  const a = makeEnv();
  a.cfg.issueThrows = true;
  assert.equal(exec(a).code, 4);
  const b = makeEnv();
  b.cfg.issue.labels = null;
  assert.equal(exec(b).code, 4);
});

test('work-links native: openBlockerIds from the fake fetchNativeDependencies -> blocked-by; the call targets [N]', () => {
  const env = makeEnv();
  env.cfg.workLinks = 'native';
  env.cfg.native = new Map([[N, { blockedBy: [4501], openBlocker: true, openBlockerIds: [4501] }]]);
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'blocked-by');
  assert.deepStrictEqual(env.calls.native.length, 1);
  assert.deepStrictEqual(env.calls.native[0].numbers, [N]);
  assert.equal(env.calls.native[0].owner, 'o');
  assert.equal(env.calls.native[0].repo, 'r');
});

test('work-links native with no open blocker -> eligible; a throwing or entry-less native fetch -> exit 4', () => {
  const ok = makeEnv();
  ok.cfg.workLinks = 'native';
  ok.cfg.native = new Map([[N, { blockedBy: [], openBlocker: false, openBlockerIds: [] }]]);
  assert.equal(exec(ok).code, 0);
  const missing = makeEnv();
  missing.cfg.workLinks = 'native';
  missing.cfg.native = new Map();
  assert.equal(exec(missing).code, 4);
  const thrown = makeEnv();
  thrown.cfg.workLinks = 'native';
  thrown.deps.fetchNative = () => { throw new Error('graphql down'); };
  assert.equal(exec(thrown).code, 4);
});

test('work-links unset (or body-text) never calls the native fetch', () => {
  for (const wl of ['', 'body-text']) {
    const env = makeEnv();
    env.cfg.workLinks = wl;
    exec(env);
    assert.deepStrictEqual(env.calls.native, [], wl);
  }
});

test('openBlockers reaching the verdict are deduplicated and ascending (body and native overlap)', () => {
  const env = makeEnv();
  env.cfg.workLinks = 'native';
  env.cfg.issue.body = 'Blocked by #4700\nBlocked by #4500\n';
  env.cfg.depStates[4700] = 'OPEN';
  env.cfg.depStates[4500] = 'OPEN';
  env.cfg.native = new Map([[N, { blockedBy: [], openBlocker: true, openBlockerIds: [4700, 4300] }]]);
  const r = exec(env);
  assert.equal(r.json.reason, 'blocked-by');
  assert.match(r.json.line, /open #4300, #4500, #4700 —/);
});

test('workLinks resolution throwing -> exit 4', () => {
  const env = makeEnv();
  env.deps.workLinks = () => { throw new Error('policy unreadable'); };
  assert.equal(exec(env).code, 4);
});

// ---- claim ----

test('claim read failure -> exit 4; a thrown read -> exit 4', () => {
  const a = makeEnv();
  a.cfg.claimResult = { content: null, failure: 'network-failure', absent: false };
  assert.equal(exec(a).code, 4);
  const b = makeEnv();
  b.deps.readClaim = () => { throw new Error('x'); };
  assert.equal(exec(b).code, 4);
});

test('the claim is read for the resolved slug and the issue', () => {
  const env = makeEnv();
  exec(env);
  assert.deepStrictEqual(env.calls.readClaim, [[SLUG, N]]);
});

test('a stale claim with no bot:in-progress label is eligible; a live-claim -> exit 3 live-claim', () => {
  const stale = makeEnv();
  stale.cfg.claim = STALE();
  assert.equal(exec(stale).code, 0);
  const live = makeEnv();
  live.cfg.claim = claimPayload({
    issueNumber: N, runId: RUN, sessionId: 's1', ttlHours: 72, host: 'h', now: NOW - HOUR,
  }).fileContent;
  assert.equal(exec(live).json.reason, 'live-claim');
});

// ---- prior run directory ----

test('archive-first: archive/{runId} plus a work/-only root dir reads archived (Review Focus 6)', () => {
  const env = makeEnv();
  env.cfg.dirs[RUNDIR] = ['work'];
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.priorRunDir, 'archived');
  assert.equal(r.json.archivePriorRun, false);
  assert.equal(r.json.priorRunPath, RUNDIR, 'priorRunPath is the root dir when present');
});

test('a root dir absent and not archived -> absent, eligible, priorRunPath null', () => {
  const env = makeEnv();
  delete env.cfg.dirs[ARCH];
  delete env.cfg.files[`${ARCH}/run-state.json`];
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.priorRunDir, 'absent');
  assert.equal(r.json.priorRunPath, null);
});

test('a work/-only root dir with no archive -> residue', () => {
  const env = makeEnv();
  setRunState(env, undefined, { files: ['work'] });
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.priorRunDir, 'residue');
  assert.equal(r.json.archivePriorRun, false);
  assert.equal(r.json.priorRunPath, RUNDIR);
});

test('a root dir without run-state.json -> stateless, eligible, never archived', () => {
  const env = makeEnv();
  setRunState(env, undefined, { files: ['events.jsonl', 'work'] });
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.priorRunDir, 'stateless');
  assert.equal(r.json.archivePriorRun, false);
  assert.equal(r.json.closePriorRun, false);
});

test('run-state.json with no owner block -> dead-owner (archive, close when non-terminal)', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active' });
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.priorRunDir, 'dead-owner');
  assert.equal(r.json.archivePriorRun, true);
  assert.equal(r.json.closePriorRun, true);
  assert.equal(r.json.priorRunPath, RUNDIR);
});

test('non-terminal run whose owner pid is gone -> dead-owner; the same with a fresh heartbeat and a held worktree lock (Review Focus 8)', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: OWNER, heartbeatAt: new Date(NOW).toISOString(), worktree: WT });
  env.cfg.alive = () => false;
  env.cfg.porcelain = `worktree ${WT}\nHEAD ${OID}\nbranch refs/heads/${HEAD}\nlocked claude (pid ${process.pid})\n\n`;
  const r = exec(env);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.priorRunDir, 'dead-owner');
  assert.equal(r.json.archivePriorRun, true);
  assert.equal(r.json.closePriorRun, true);
});

test('terminal status + gone pid -> archivePriorRun true, closePriorRun false', () => {
  const env = makeEnv();
  setRunState(env, { status: 'clean', owner: OWNER });
  env.cfg.alive = () => false;
  const r = exec(env);
  assert.equal(r.json.archivePriorRun, true);
  assert.equal(r.json.closePriorRun, false);
});

test('an interrupted run counts as non-terminal (closePriorRun true)', () => {
  const env = makeEnv();
  setRunState(env, { status: 'interrupted', owner: OWNER });
  env.cfg.alive = () => false;
  assert.equal(exec(env).json.closePriorRun, true);
});

test('owner sessionId equal to the resuming session with a live pid -> dead-owner, no probe', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: { ...OWNER, sessionId: SESSION } });
  env.cfg.alive = () => true;
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.priorRunDir, 'dead-owner');
  assert.equal(env.calls.pidAlive, undefined);
});

test('an empty deps.sessionId never matches an owner.sessionId of ""', () => {
  const env = makeEnv({ sessionId: '' });
  setRunState(env, { status: 'active', owner: { ...OWNER, sessionId: '' } });
  env.cfg.alive = () => true;
  env.cfg.startTime = () => 'T0';
  assert.equal(exec(env).json.reason, 'prior-run-live');
});

test('owner pid alive with a matching start time -> exit 3 prior-run-live (live)', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: OWNER });
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'prior-run-live');
  assert.match(r.json.line, /\(live\)/);
});

test('owner pid alive with no recorded start time -> prior-run-live (live)', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: { ...OWNER, pidStartedAt: null } });
  const r = exec(env);
  assert.equal(r.json.reason, 'prior-run-live');
  assert.match(r.json.line, /\(live\)/);
});

test('pidAlive throwing -> exit 3 prior-run-live (unknown)', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: OWNER });
  env.cfg.alive = () => { throw new Error('EPERM'); };
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'prior-run-live');
  assert.match(r.json.line, /\(unknown\)/);
});

test('unparseable, array and null run-state.json -> exit 3 prior-run-live (unknown)', () => {
  for (const raw of ['{not json', '[]', 'null', '"str"', '42']) {
    const env = makeEnv();
    setRunState(env, raw);
    const r = exec(env);
    assert.equal(r.code, 3, raw);
    assert.equal(r.json.reason, 'prior-run-live', raw);
    assert.match(r.json.line, /\(unknown\)/, raw);
  }
});

test('an unreadable run-state.json (it exists but the read throws) and a throwing readdir -> prior-run-live (unknown)', () => {
  const a = makeEnv();
  setRunState(a, { status: 'active' });
  const readFile = a.deps.readFile;
  a.deps.readFile = (p) => { if (p === `${RUNDIR}/run-state.json`) throw new Error('EACCES'); return readFile(p); };
  const ra = exec(a);
  assert.equal(ra.json.reason, 'prior-run-live');
  assert.match(ra.json.line, /\(unknown\)/);
  const b = makeEnv();
  setRunState(b, { status: 'active' });
  b.deps.readdir = () => { throw new Error('EACCES'); };
  const rb = exec(b);
  assert.equal(rb.json.reason, 'prior-run-live');
});

test('an owner block whose host differs from this machine -> exit 3 prior-run-other-host naming that host; pidAlive never called', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: { ...OWNER, host: 'elsewhere.local' } });
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'prior-run-other-host');
  assert.match(r.json.line, /elsewhere\.local/);
  assert.equal(env.calls.pidAlive, undefined);
});

test('a host-less owner block: no pid -> dead-owner; a valid pid -> prior-run-live (unknown); pid above MAX_PID -> dead-owner', () => {
  const noPid = makeEnv();
  setRunState(noPid, { status: 'active', owner: { sessionId: 'o' } });
  assert.equal(exec(noPid).json.priorRunDir, 'dead-owner');
  const withPid = makeEnv();
  setRunState(withPid, { status: 'active', owner: { sessionId: 'o', pid: 4242 } });
  const r = exec(withPid);
  assert.equal(r.json.reason, 'prior-run-live');
  assert.match(r.json.line, /\(unknown\)/);
  assert.equal(withPid.calls.pidAlive, undefined, 'the host-less case is decided before the probe');
  const huge = makeEnv();
  setRunState(huge, { status: 'active', owner: { sessionId: 'o', pid: MAX_PID + 1 } });
  assert.equal(exec(huge).json.priorRunDir, 'dead-owner');
  for (const host of ['', 7, null]) {
    const e = makeEnv();
    setRunState(e, { status: 'active', owner: { sessionId: 'o', host, pid: 4242 } });
    assert.equal(exec(e).json.reason, 'prior-run-live', `host ${JSON.stringify(host)}`);
  }
});

test('an owner block with a host and no pid -> dead-owner (no-pid)', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: { sessionId: 'o', host: 'h1' } });
  assert.equal(exec(env).json.priorRunDir, 'dead-owner');
});

test('owner pid pid-reused (start time differs) -> dead-owner', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: OWNER });
  env.cfg.startTime = () => 'T-other';
  assert.equal(exec(env).json.priorRunDir, 'dead-owner');
});

test('a malformed (non-object) owner is not a proven death: prior-run-live (unknown)', () => {
  for (const owner of ['alive', 7, ['x'], true]) {
    const env = makeEnv();
    setRunState(env, { status: 'active', owner });
    assert.equal(exec(env).json.reason, 'prior-run-live', JSON.stringify(owner));
  }
});

test('an explicit owner: null reads as no owner block -> dead-owner', () => {
  const env = makeEnv();
  setRunState(env, { status: 'active', owner: null });
  assert.equal(exec(env).json.priorRunDir, 'dead-owner');
});

// ---- stalled worktree ----

test('dirty worktree: the status argv is pinned, both dirty paths are listed, and no other git call names the worktree', () => {
  const env = makeEnv();
  env.cfg.status = `## ${HEAD}...origin/${HEAD}\0 M plugin/x.js\0?? notes.txt\0`;
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'dirty-worktree');
  assert.match(r.json.line, /plugin\/x\.js, notes\.txt/);
  const statusCalls = env.calls.git.filter((a) => a.includes('status'));
  assert.deepStrictEqual(statusCalls, [['-C', WT, '--no-optional-locks', 'status', '--porcelain', '-b', '-z']]);
  const naming = env.calls.git.filter((a) => a.includes(WT));
  assert.deepStrictEqual(naming, statusCalls);
});

test('a rename record lists the new path only, skipping the original-path record', () => {
  const env = makeEnv();
  env.cfg.status = `## ${HEAD}\0R  new.js\0old.js\0`;
  const r = exec(env);
  assert.equal(r.json.reason, 'dirty-worktree');
  assert.match(r.json.line, /: new\.js — /);
  assert.ok(!r.json.line.includes('old.js'));
});

test('a copy record (Y = C) also skips its original-path record; a later dirty path is still listed', () => {
  const env = makeEnv();
  env.cfg.status = `## ${HEAD}\0 C copy.js\0orig.js\0?? tail.txt\0`;
  const r = exec(env);
  assert.match(r.json.line, /: copy\.js, tail\.txt — /);
});

test('header-only status output (ahead/behind suffix) -> eligible', () => {
  const env = makeEnv();
  env.cfg.status = `## ${HEAD} [ahead 1]\0`;
  assert.equal(exec(env).code, 0);
});

test('a worktree on another branch -> exit 3 worktree-branch; a detached HEAD likewise', () => {
  const other = makeEnv();
  other.cfg.status = '## main...origin/main\0';
  const r = exec(other);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'worktree-branch');
  assert.match(r.json.line, /branch main/);
  const detached = makeEnv();
  detached.cfg.status = '## HEAD (no branch)\0';
  const d = exec(detached);
  assert.equal(d.json.reason, 'worktree-branch');
  assert.match(d.json.line, /detached HEAD/);
});

test('"No commits yet on {b}" names the branch b', () => {
  const env = makeEnv();
  env.cfg.status = `## No commits yet on ${HEAD}\0`;
  assert.equal(exec(env).code, 0);
});

test('status output with no ## header -> exit 4; git status throwing -> exit 4; empty output -> exit 4', () => {
  for (const status of [' M a.js\0', '', 'garbage']) {
    const env = makeEnv();
    env.cfg.status = status;
    assert.equal(exec(env).code, 4, JSON.stringify(status));
  }
  const thrown = makeEnv();
  thrown.cfg.statusThrows = true;
  assert.equal(exec(thrown).code, 4);
});

test('missing worktree: no status call, eligible, worktreePath still reported', () => {
  const env = makeEnv();
  delete env.cfg.dirs[WT];
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.worktreePath, WT);
  assert.ok(!env.calls.git.some((a) => a.includes('status')));
  assert.ok(!env.calls.git.some((a) => a.includes(WT)));
});

test('missing worktree: rev-parse printing the PR headRefOid -> eligible with localBranchExists true', () => {
  const env = makeEnv();
  delete env.cfg.dirs[WT];
  env.cfg.revParse = () => `${OID}\n`;
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.localBranchExists, true);
  const rp = env.calls.git.find((a) => a.includes('rev-parse'));
  assert.deepStrictEqual(rp, ['-C', MAIN, 'rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${HEAD}`]);
});

test('missing worktree: rev-parse printing another sha -> exit 3 branch-diverged', () => {
  const env = makeEnv();
  delete env.cfg.dirs[WT];
  env.cfg.revParse = () => `${'b'.repeat(40)}\n`;
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'branch-diverged');
});

test('missing worktree: rev-parse exiting 1 with no output -> eligible with localBranchExists false; any other failure -> exit 4', () => {
  const ok = makeEnv();
  delete ok.cfg.dirs[WT];
  const r = exec(ok);
  assert.equal(r.code, 0);
  assert.equal(r.json.localBranchExists, false);
  for (const err of [Object.assign(new Error('fatal'), { status: 128, stdout: '' }), new Error('spawn git ENOENT')]) {
    const env = makeEnv();
    delete env.cfg.dirs[WT];
    env.cfg.revParse = () => { throw err; };
    assert.equal(exec(env).code, 4);
  }
});

test('missing worktree: the head branch checked out at another path -> exit 3 branch-checked-out', () => {
  const env = makeEnv();
  delete env.cfg.dirs[WT];
  env.cfg.porcelain = `worktree ${MAIN}\nHEAD ${OID}\nbranch refs/heads/main\n\nworktree /elsewhere/wt\nHEAD ${OID}\nbranch refs/heads/${HEAD}\n\n`;
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'branch-checked-out');
  assert.match(r.json.line, /\/elsewhere\/wt/);
  const list = env.calls.git.find((a) => a.includes('worktree'));
  assert.deepStrictEqual(list, ['-C', MAIN, 'worktree', 'list', '--porcelain']);
});

test('missing worktree: a failing worktree list -> exit 4', () => {
  const env = makeEnv();
  delete env.cfg.dirs[WT];
  const git = env.deps.git;
  env.deps.git = (args) => { if (args.includes('worktree')) throw new Error('boom'); return git(args); };
  assert.equal(exec(env).code, 4);
});

test('worktree present: neither rev-parse nor worktree list is called', () => {
  const env = makeEnv();
  exec(env);
  assert.ok(!env.calls.git.some((a) => a.includes('rev-parse')));
  assert.ok(!env.calls.git.some((a) => a.includes('worktree')));
});

// ---- sibling sessions ----

test('the sibling check is called with the main root as cwd, the session id and a listing seam', () => {
  const env = makeEnv();
  exec(env);
  assert.equal(env.calls.findSibling.length, 1);
  const { ref, opts } = env.calls.findSibling[0];
  assert.equal(ref, `#${N}`);
  assert.equal(opts.cwd, MAIN);
  assert.equal(opts.sessionId, SESSION);
  assert.equal(typeof opts.listRunDirsWithState, 'function');
});

test('a sibling conflict -> exit 3 live-sibling with the open-pr line', () => {
  const env = makeEnv();
  env.cfg.sibling = () => ({ path: '/elsewhere' });
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'live-sibling');
  assert.match(r.json.line, /already has an open PR/);
});

test('a throwing sibling check -> exit 4', () => {
  const env = makeEnv();
  env.cfg.sibling = () => { throw new Error('x'); };
  assert.equal(exec(env).code, 4);
});

test('own kept lock (Review Focus 18): the archived prior run holds this session id, worktree null, worktreeAtClose = the stalled path -> eligible', () => {
  const env = makeEnv();
  env.cfg.files[`${ARCH}/run-state.json`] = JSON.stringify({
    status: 'clean', sessionId: SESSION, worktree: null, worktreeAtClose: WT,
  });
  env.cfg.sibling = (ref, opts) => {
    const owned = opts.listRunDirsWithState(opts.cwd).some(({ state }) => state.sessionId === opts.sessionId
      && (state.worktree === WT));
    return owned ? null : { path: WT };
  };
  const r = exec(env);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  const entry = env.calls.findSibling[0].opts.listRunDirsWithState(MAIN).find(({ state }) => state.sessionId === SESSION);
  assert.deepStrictEqual(entry.state, { sessionId: SESSION, worktree: WT });
});

test('own kept lock: a different recorded session id, or a conflict on another path -> exit 3 live-sibling', () => {
  const differentSession = makeEnv();
  differentSession.cfg.sibling = (ref, opts) => {
    const owned = opts.listRunDirsWithState(opts.cwd).some(({ state }) => state.sessionId === opts.sessionId && state.worktree === WT);
    return owned ? null : { path: WT };
  };
  assert.equal(exec(differentSession).json.reason, 'live-sibling');

  const otherPath = makeEnv();
  otherPath.cfg.files[`${ARCH}/run-state.json`] = JSON.stringify({ status: 'clean', sessionId: SESSION, worktree: null, worktreeAtClose: WT });
  otherPath.cfg.sibling = () => ({ path: '/some/other/worktree' });
  assert.equal(exec(otherPath).json.reason, 'live-sibling');
});

test('own kept lock where the prior run is at the root (not archived) and records worktree directly -> the entry carries worktree', () => {
  const env = makeEnv();
  setRunState(env, { status: 'clean', sessionId: SESSION, worktree: WT, owner: { ...OWNER, sessionId: SESSION } });
  exec(env);
  const entry = env.calls.findSibling[0].opts.listRunDirsWithState(MAIN).find(({ state }) => state.sessionId === SESSION);
  assert.equal(entry.dir, RUNDIR);
  assert.equal(entry.state.worktree, WT);
});

test('the prior run listing entry is added only when the sessionId is non-empty and matches', () => {
  const none = makeEnv({ sessionId: '' });
  none.cfg.files[`${ARCH}/run-state.json`] = JSON.stringify({ status: 'clean', sessionId: '', worktree: null, worktreeAtClose: WT });
  exec(none);
  assert.deepStrictEqual(none.calls.findSibling[0].opts.listRunDirsWithState(MAIN), []);
  const other = makeEnv();
  exec(other);
  assert.deepStrictEqual(other.calls.findSibling[0].opts.listRunDirsWithState(MAIN), []);
});

test('own kept lock plus a second in-use #N worktree: the real findConflictingSession still returns the second (live-sibling)', () => {
  const env = makeEnv();
  env.cfg.files[`${ARCH}/run-state.json`] = JSON.stringify({ status: 'clean', sessionId: SESSION, worktree: null, worktreeAtClose: WT });
  const lock = `locked claude (pid ${process.pid})`;
  const porcelain = [
    `worktree ${MAIN}`, `HEAD ${OID}`, 'branch refs/heads/main', '',
    `worktree ${WT}`, `HEAD ${OID}`, `branch refs/heads/${HEAD}`, lock, '',
    '', // spacer
    'worktree /repo/.claude/worktrees/flow-spec-4589', `HEAD ${OID}`, 'branch refs/heads/worktree-flow-spec-4589', lock, '',
  ].join('\n');
  env.cfg.sibling = (ref, opts) => findConflictingSession(ref, { ...opts, run: () => porcelain });
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'live-sibling');

  // control: with only the own kept lock the same real function returns null
  const alone = makeEnv();
  alone.cfg.files[`${ARCH}/run-state.json`] = JSON.stringify({ status: 'clean', sessionId: SESSION, worktree: null, worktreeAtClose: WT });
  const lone = [`worktree ${MAIN}`, `HEAD ${OID}`, 'branch refs/heads/main', '', `worktree ${WT}`, `HEAD ${OID}`, `branch refs/heads/${HEAD}`, lock, ''].join('\n');
  alone.cfg.sibling = (ref, opts) => findConflictingSession(ref, { ...opts, run: () => lone });
  assert.equal(exec(alone).code, 0);
});

// ---- verdict type contract (Task 2 fails closed on malformed input) ----

test('the gatherer passes real booleans/arrays: a clean run never refuses invalid-input', () => {
  const env = makeEnv();
  const r = exec(env);
  assert.notEqual(r.json.reason, 'invalid-input');
  assert.equal(r.code, 0);
});

test('the PRs reach the verdict with headRefOid: a reaped worktree whose local branch equals the PR head is eligible, not branch-diverged', () => {
  const env = makeEnv();
  delete env.cfg.dirs[WT];
  env.cfg.revParse = () => OID;
  assert.equal(exec(env).json.localBranchExists, true);
});

test('the refusal line is printed verbatim for every verdict refusal, invalid-input included', () => {
  const env = makeEnv();
  env.cfg.issue.state = 'CLOSED';
  const r = exec(env);
  assert.equal(r.lines.length, 1);
  assert.equal(typeof r.json.line, 'string');
  assert.equal(r.json.eligible, false);
  assert.equal(r.json.issue, N);
});

// ---- --bound-run ----

const NEW_RUN = `${ROOT}/2026-10-31T120000-record-4589`;
const BOUND = ['--issue', String(N), '--bound-run', NEW_RUN];

test('--bound-run with nothing else bound -> exit 0 {concurrent:false}; no gh, no verdict', () => {
  const env = makeEnv();
  env.cfg.runDirs = [{ dir: NEW_RUN, state: { status: 'active', sessionId: SESSION, worktree: WT } }];
  const r = exec(env, BOUND);
  assert.equal(r.code, 0);
  assert.deepStrictEqual(r.json, { concurrent: false });
  assert.deepStrictEqual(env.calls.gh, []);
  assert.deepStrictEqual(env.calls.readClaim, []);
});

test('--bound-run: a second non-terminal top-level run dir bound to the worktree -> exit 3 concurrent-resume naming its basename', () => {
  const env = makeEnv();
  env.cfg.runDirs = [
    { dir: NEW_RUN, state: { status: 'active', sessionId: SESSION, worktree: WT } },
    { dir: `${ROOT}/2026-10-31T115900-record-4589`, state: { status: 'active', sessionId: 'rival', worktree: WT } },
  ];
  const r = exec(env, BOUND);
  assert.equal(r.code, 3);
  assert.deepStrictEqual(r.json, {
    concurrent: true,
    reason: 'concurrent-resume',
    line: `#${N}'s stalled worktree ${WT} is bound to another active run 2026-10-31T115900-record-4589 — another dispatch resume may be running; stop this one, then run /claude-tweaks:dispatch resume #${N} once that run ends`,
  });
});

test('--bound-run: the rival with an interrupted status still counts; terminal status or another worktree does not', () => {
  const interrupted = makeEnv();
  interrupted.cfg.runDirs = [{ dir: `${ROOT}/r1`, state: { status: 'interrupted', sessionId: 'rival', worktree: WT } }];
  assert.equal(exec(interrupted, BOUND).code, 3);
  for (const state of [
    { status: 'clean', sessionId: 'rival', worktree: WT },
    { status: 'closed', sessionId: 'rival', worktree: WT },
    { status: 'active', sessionId: 'rival', worktree: '/repo/.claude/worktrees/other' },
    { status: 'active', sessionId: 'rival', worktree: null },
    { status: 'active', sessionId: 'rival' },
    null,
  ]) {
    const env = makeEnv();
    env.cfg.runDirs = [{ dir: `${ROOT}/r1`, state }];
    const r = exec(env, BOUND);
    assert.equal(r.code, 0, JSON.stringify(state));
    assert.deepStrictEqual(r.json, { concurrent: false });
  }
});

test('--bound-run: only this session\'s own ad-hoc dir bound there -> {concurrent:false}; another session\'s ad-hoc dir there counts', () => {
  const own = makeEnv();
  own.cfg.runDirs = [{ dir: `${ROOT}/2026-10-31T115900-adhoc-standalone`, state: { status: 'active', sessionId: SESSION, worktree: WT } }];
  const r = exec(own, BOUND);
  assert.equal(r.code, 0);
  assert.deepStrictEqual(r.json, { concurrent: false });
  const foreign = makeEnv();
  foreign.cfg.runDirs = [{ dir: `${ROOT}/2026-10-31T115900-adhoc-standalone`, state: { status: 'active', sessionId: 'rival', worktree: WT } }];
  assert.equal(exec(foreign, BOUND).json.reason, 'concurrent-resume');
});

test('--bound-run: an empty deps.sessionId never matches an ad-hoc dir with sessionId ""', () => {
  const env = makeEnv({ sessionId: '' });
  env.cfg.runDirs = [{ dir: `${ROOT}/2026-10-31T115900-adhoc-standalone`, state: { status: 'active', sessionId: '', worktree: WT } }];
  assert.equal(exec(env, BOUND).json.reason, 'concurrent-resume');
});

test('--bound-run: a live sibling on the lock check -> exit 3 live-sibling (checked before the run-dir scan)', () => {
  const env = makeEnv();
  env.cfg.sibling = () => ({ path: WT });
  env.cfg.runDirs = [{ dir: `${ROOT}/r1`, state: { status: 'active', sessionId: 'rival', worktree: WT } }];
  const r = exec(env, BOUND);
  assert.equal(r.code, 3);
  assert.equal(r.json.concurrent, true);
  assert.equal(r.json.reason, 'live-sibling');
  assert.equal(typeof r.json.line, 'string');
  assert.equal(env.calls.findSibling[0].opts.cwd, MAIN);
  assert.equal(env.calls.findSibling[0].opts.sessionId, SESSION);
});

test('--bound-run: a throwing sibling check -> exit 4', () => {
  const env = makeEnv();
  env.cfg.sibling = () => { throw new Error('x'); };
  assert.equal(exec(env, BOUND).code, 4);
});

test('--bound-run outside the main root pipelines dir -> exit 2 (a worktree-local run dir, an unanchored path, a missing dir)', () => {
  for (const dir of [
    '/repo/.claude/worktrees/dispatch-record-4589/.claude-tweaks/pipelines/2026-10-31T120000-record-4589',
    '/tmp/elsewhere/2026-10-31T120000-record-4589',
    `${ROOT}/..`,
  ]) {
    const env = makeEnv();
    const r = exec(env, ['--issue', String(N), '--bound-run', dir]);
    assert.equal(r.code, 2, dir);
    assert.equal(r.json, null, 'nothing on stdout');
    assert.deepStrictEqual(env.calls.findSibling, [], dir);
  }
});

test('--bound-run refused by resolveTarget (not anchored / missing) -> exit 2', () => {
  const env = makeEnv();
  env.cfg.target = () => ({ ok: false, reason: 'not-anchored' });
  const r = exec(env, BOUND);
  assert.equal(r.code, 2);
  assert.match(r.err, /not-anchored/);
  assert.deepStrictEqual(env.calls.findSibling, []);
});

// ---- the real wiring ----

test('realDeps carries the production seams the CLI needs', () => {
  for (const key of ['ghAvailable', 'gh', 'git', 'mainRoot', 'readClaim', 'exists', 'readdir', 'readFile', 'findSibling',
    'listRunDirsWithState', 'probes', 'workLinks', 'fetchNative', 'resolveTarget', 'now', 'stdout', 'stderr']) {
    assert.ok(realDeps[key] !== undefined, key);
  }
  assert.equal(typeof realDeps.probes.pidAlive, 'function');
  assert.equal(typeof realDeps.probes.hostname, 'function');
});

test('the real git dep runs a quiet read and throws on a failing command', () => {
  assert.equal(typeof realDeps.git(['--version']), 'string');
  assert.throws(() => realDeps.git(['rev-parse', '--verify', '--quiet', '--end-of-options', 'refs/heads/definitely-not-a-branch-4588']));
});

test('the real workLinks dep resolves to a string', () => {
  assert.equal(typeof realDeps.workLinks(), 'string');
});
