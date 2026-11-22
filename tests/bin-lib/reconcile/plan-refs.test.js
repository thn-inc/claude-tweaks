'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PLAN_REFS_BATCH_CHUNK, listPlanRefs, buildIssueStateQuery, parseIssueStateResponse, decidePlanRef, planRefs,
} = require('../../../plugin/bin/lib/reconcile/plan-refs');

const P = 'refs/claude-tweaks/plans/';
const sha = (n) => String(n).padStart(40, '0');

test('listPlanRefs: keeps exact-integer refs only', () => {
  const out = [
    `${'a'.repeat(40)}\t${P}12`, `${'b'.repeat(40)}\t${P}0`, `${'c'.repeat(40)}\t${P}007`, `${'d'.repeat(40)}\t${P}12abc`, `${'e'.repeat(40)}\t${P}5/x`,
    `${'f'.repeat(40)}\t${P}3^{}`, `${'1'.repeat(40)}\trefs/heads/main`, `${'2'.repeat(64)}\t${P}4\r`, `nothex\t${P}9`, `abc\t${P}8`, '', '',
  ].join('\n');
  assert.deepEqual(listPlanRefs(out), [
    { ref: `${P}4`, record: 4, sha: '2'.repeat(64) },
    { ref: `${P}12`, record: 12, sha: 'a'.repeat(40) },
  ]);
});

test('listPlanRefs: a non-hex line does not claim a record, and the first valid sha per record wins', () => {
  const out = [
    `nothex\t${P}12`, `${'a'.repeat(40)}\t${P}12`, `${'b'.repeat(40)}\t${P}12`,
  ].join('\n');
  assert.deepEqual(listPlanRefs(out), [{ ref: `${P}12`, record: 12, sha: 'a'.repeat(40) }]);
});

test('buildIssueStateQuery: aliases each record, omits invalid ones', () => {
  const q = buildIssueStateQuery([7, 0, 'x', 9]);
  assert.match(q, /i0: issue\(number:7\)\{ number state \}/);
  assert.match(q, /i3: issue\(number:9\)\{ number state \}/);
  assert.doesNotMatch(q, /i1/);
  assert.doesNotMatch(q, /i2/);
  assert.match(q, /query\(\$owner:String!,\$name:String!\)/);
});

test('parseIssueStateResponse: keeps only exact-number CLOSED/OPEN nodes', () => {
  const data = { i0: { number: 1, state: 'CLOSED' }, i1: { number: 2, state: 'OPEN' }, i2: { number: 99, state: 'CLOSED' }, i3: null, i4: { number: 5, state: 'closed' } };
  const m = parseIssueStateResponse(JSON.stringify({ data: { repository: data } }), [1, 2, 3, 4, 5]);
  assert.deepEqual([...m], [[1, 'CLOSED'], [2, 'OPEN']]);
});

test('parseIssueStateResponse: an own-alias NOT_FOUND is absent, others still read', () => {
  const body = { data: { repository: { i0: { number: 1, state: 'CLOSED' }, i1: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'i1'] }] };
  assert.deepEqual([...parseIssueStateResponse(JSON.stringify(body), [1, 2])], [[1, 'CLOSED']]);
});

test('parseIssueStateResponse: a foreign error poisons the chunk', () => {
  const repo = { i0: { number: 1, state: 'CLOSED' } };
  const forbidden = { data: { repository: repo }, errors: [{ type: 'FORBIDDEN', path: ['repository', 'i0'] }] };
  assert.equal(parseIssueStateResponse(JSON.stringify(forbidden), [1]).size, 0);
  assert.equal(parseIssueStateResponse('not json', [1]).size, 0);
  assert.equal(parseIssueStateResponse(JSON.stringify({ data: { repository: repo }, errors: 'boom' }), [1]).size, 0);
});

test('decidePlanRef: only CLOSED deletes', () => {
  assert.deepEqual(decidePlanRef({ record: 1, state: 'CLOSED' }), { action: 'delete', reason: 'record-closed' });
  assert.deepEqual(decidePlanRef({ record: 1, state: 'OPEN' }), { action: 'skip', reason: 'record-open' });
  assert.deepEqual(decidePlanRef({ record: 1, state: undefined }), { action: 'skip', reason: 'state-unreadable' });
});

const URL = 'https://github.com/thn-inc/claude-tweaks.git';
function makeFakes({ refs, states = {}, ghThrowAt = {}, pushThrow = {} }) {
  const calls = { git: [], gh: [], pushes: [] };
  const git = (args) => {
    calls.git.push(args);
    if (args[0] === 'ls-remote') return refs.map((n) => `${sha(n)}\t${P}${n}`).join('\n');
    if (args[0] === 'remote') return URL;
    if (args[0] === 'push') {
      calls.pushes.push(args);
      const n = Number(args[5].slice(1 + P.length));
      if (pushThrow[n]) throw Object.assign(new Error('push failed'), { stderr: pushThrow[n] });
      return '';
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const gh = (args) => {
    calls.gh.push(args);
    const idx = calls.gh.length;
    if (ghThrowAt[idx]) throw ghThrowAt[idx];
    const q = args.find((a) => a.startsWith('query=')).slice('query='.length);
    const repo = {};
    for (const m of q.matchAll(/(i\d+): issue\(number:(\d+)\)/g)) {
      const s = states[m[2]];
      repo[m[1]] = s ? { number: Number(m[2]), state: s } : null;
    }
    return JSON.stringify({ data: { repository: repo } });
  };
  return { git, gh, calls };
}
const noLocal = () => 'github-issues';

test('planRefs: closed deleted, open kept, unreadable kept', () => {
  const f = makeFakes({ refs: [1, 2, 3], states: { 1: 'CLOSED', 2: 'OPEN' } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.equal(r.failure, null);
  assert.deepEqual(r.entries.map((e) => [e.record, e.action, e.reason]), [
    [1, 'delete', 'record-closed'], [2, 'skip', 'record-open'], [3, 'skip', 'state-unreadable'],
  ]);
  assert.deepEqual(f.calls.pushes, [['push', '--no-verify', '-q', `--force-with-lease=${P}1:${sha(1)}`, 'origin', `:${P}1`]]);
});

test('planRefs: a rejected lease push reports delete-failed and keeps going', () => {
  const f = makeFakes({ refs: [1, 4], states: { 1: 'CLOSED', 4: 'CLOSED' }, pushThrow: { 1: `To /x/remote.git\n ! [rejected]        (delete) -> ${P}1 (stale info)\nerror: failed to push some refs to '/x/remote.git'\n` } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.equal(r.entries[0].action, 'skip');
  assert.equal(r.entries[0].reason, 'delete-failed');
  assert.match(r.entries[0].detail, /stale info/);
  assert.doesNotMatch(r.entries[0].detail, /^To /);
  assert.deepEqual(f.calls.pushes[1], ['push', '--no-verify', '-q', `--force-with-lease=${P}4:${sha(4)}`, 'origin', `:${P}4`]);
  assert.equal(r.entries[1].action, 'delete');
  assert.equal(r.entries[1].reason, 'record-closed');
});

test('planRefs: chunks of 50, a failed chunk keeps only its refs', () => {
  const refs = Array.from({ length: 51 }, (_, i) => i + 1);
  const states = Object.fromEntries(refs.map((n) => [n, 'CLOSED']));
  const f = makeFakes({ refs, states, ghThrowAt: { 2: new Error('boom') } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.equal(PLAN_REFS_BATCH_CHUNK, 50);
  assert.equal(f.calls.gh.length, 2);
  assert.equal(r.entries.filter((e) => e.action === 'delete').length, 50);
  const last = r.entries[50];
  assert.deepEqual([last.record, last.action, last.reason], [51, 'skip', 'state-unreadable']);
});

test('planRefs: gh rejection stdout is still parsed', () => {
  const body = JSON.stringify({ data: { repository: { i0: { number: 1, state: 'CLOSED' } } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'i1'] }] });
  const f = makeFakes({ refs: [1, 2], ghThrowAt: { 1: Object.assign(new Error('exit 1'), { stdout: body }) } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.deepEqual(r.entries.map((e) => [e.record, e.action]), [[1, 'delete'], [2, 'skip']]);
  assert.equal(f.calls.pushes.length, 1);
});

test('planRefs: dry run deletes nothing', () => {
  const f = makeFakes({ refs: [1], states: { 1: 'CLOSED' } });
  const r = planRefs({ cwd: '/x', dryRun: true, git: f.git, gh: f.gh, readBackend: noLocal });
  assert.deepEqual(r.entries.map((e) => [e.action, e.reason]), [['would-delete', 'record-closed']]);
  assert.equal(f.calls.pushes.length, 0);
});

test('planRefs: ls-remote failure aborts with a reported failure', () => {
  const calls = { gh: 0 };
  const r = planRefs({
    cwd: '/x', readBackend: noLocal,
    git: (args) => {
      if (args[0] === 'remote') return URL;
      throw new Error('ls-remote failed');
    },
    gh: () => { calls.gh++; return ''; },
  });
  assert.deepEqual(r, { entries: [], failure: 'ls-remote-failed' });
  assert.equal(calls.gh, 0);
});

test('planRefs: no origin remote is reported as no-origin', () => {
  const calls = { gh: 0 };
  const r = planRefs({
    cwd: '/x', readBackend: noLocal,
    git: () => { throw new Error('fatal: No such remote'); },
    gh: () => { calls.gh++; return ''; },
  });
  assert.deepEqual(r, { entries: [], failure: 'no-origin' });
  assert.equal(calls.gh, 0);
});

test('planRefs: local-files backend skips', () => {
  let touched = 0;
  const r = planRefs({ cwd: '/x', readBackend: () => 'local-files', git: () => { touched++; return ''; }, gh: () => { touched++; return ''; } });
  assert.deepEqual(r, { entries: [], failure: 'local-files-backend' });
  assert.equal(touched, 0);
});

test('planRefs: no plan refs makes no gh call', () => {
  let ghCalls = 0;
  const r = planRefs({ cwd: '/x', readBackend: noLocal, git: () => '', gh: () => { ghCalls++; return ''; } });
  assert.deepEqual(r, { entries: [], failure: null });
  assert.equal(ghCalls, 0);
});

test('planRefs: an origin that does not parse is a reported failure', () => {
  const pushes = [];
  const git = (args) => {
    if (args[0] === 'ls-remote') return `${sha(1)}\t${P}1`;
    if (args[0] === 'remote') return 'not a url';
    pushes.push(args);
    return '';
  };
  let ghCalls = 0;
  const r = planRefs({ cwd: '/x', readBackend: noLocal, git, gh: () => { ghCalls++; return ''; } });
  assert.deepEqual(r, { entries: [], failure: 'origin-unresolvable' });
  assert.equal(ghCalls, 0);
  assert.equal(pushes.length, 0);
});

test('planRefs: an unexpected throw is a reported failure', () => {
  const r = planRefs({ cwd: '/x', readBackend: () => { throw new Error('boom'); }, git: () => '', gh: () => '' });
  assert.deepEqual(r, { entries: [], failure: 'unexpected-error' });
});

test('planRefs: an absent gh is a reported failure', () => {
  const f = makeFakes({ refs: [1], ghThrowAt: { 1: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.deepEqual(r, { entries: [], failure: 'gh-absent' });
  assert.equal(f.calls.pushes.length, 0);
});

test('planRefs: gh missing is answered before any network call', () => {
  const f = makeFakes({ refs: [1], states: { 1: 'CLOSED' } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal, ghAvailableFn: () => false });
  assert.deepEqual(r, { entries: [], failure: 'gh-absent' });
  assert.equal(f.calls.git.length, 0);
  assert.equal(f.calls.gh.length, 0);
});

test('planRefs: a GHE origin routes the GraphQL call to its host with its owner/name; github.com passes no --hostname', () => {
  const savedHost = process.env.GH_HOST;
  delete process.env.GH_HOST;
  try {
    const run = (url) => {
      const f = makeFakes({ refs: [1], states: { 1: 'CLOSED' } });
      const git = (args) => (args[0] === 'remote' ? url : f.git(args));
      const r = planRefs({ cwd: '/x', git, gh: f.gh, readBackend: noLocal });
      assert.equal(r.failure, null);
      return f.calls.gh[0];
    };
    const ghe = run('https://acme.ghe.com/o/r.git');
    assert.deepEqual(ghe.slice(0, 4), ['api', 'graphql', '--hostname', 'acme.ghe.com']);
    assert.equal(ghe.filter((a) => a === '--hostname').length, 1);
    assert.ok(ghe.includes('owner=o') && ghe.includes('name=r'), ghe.join(' '));
    const dotcom = run(URL);
    assert.ok(!dotcom.includes('--hostname'), dotcom.join(' '));
    assert.equal(dotcom[1], 'graphql');
    assert.ok(dotcom.includes('owner=thn-inc') && dotcom.includes('name=claude-tweaks'), dotcom.join(' '));
  } finally {
    if (savedHost === undefined) delete process.env.GH_HOST;
    else process.env.GH_HOST = savedHost;
  }
});

test('planRefs: a number past the GraphQL 32-bit Int is left out of the query, so it cannot poison its chunk', () => {
  const huge = 2147483648;
  assert.doesNotMatch(buildIssueStateQuery([huge]), /issue\(number/);
  assert.match(buildIssueStateQuery([2147483647]), /issue\(number:2147483647\)/);
  const f = makeFakes({ refs: [5, huge], states: { 5: 'CLOSED' } });
  const okGh = f.gh;
  // A fake gh that rejects the whole query (a non-NOT_FOUND error) when it names an out-of-range number.
  const gh = (args) => {
    const q = args.find((a) => a.startsWith('query='));
    if ([...q.matchAll(/issue\(number:(\d+)\)/g)].some((m) => Number(m[1]) > 2147483647)) {
      return JSON.stringify({ errors: [{ type: 'INVALID', message: 'Int cannot represent non 32-bit signed integer value' }] });
    }
    return okGh(args);
  };
  const r = planRefs({ cwd: '/x', git: f.git, gh, readBackend: noLocal });
  assert.deepEqual(r.entries.map((e) => [e.record, e.action, e.reason]), [
    [5, 'delete', 'record-closed'], [huge, 'skip', 'state-unreadable'],
  ]);
  assert.equal(f.calls.pushes.length, 1);
});

test('planRefs: the GraphQL batch runs under the batch timeout, not the 5 s one', () => {
  const shared = require('../../../plugin/bin/lib/shared-primitives');
  const cp = require('child_process');
  const seen = [];
  const orig = cp.execFileSync;
  cp.execFileSync = (cmd, args, o) => { seen.push({ cmd, timeout: o && o.timeout }); return JSON.stringify({ data: { repository: {} } }); };
  try {
    const f = makeFakes({ refs: [1] });
    // default gh runner, injected git
    planRefs({ cwd: process.cwd(), git: f.git, readBackend: noLocal, ghAvailableFn: () => true });
  } finally {
    cp.execFileSync = orig;
  }
  const gh = seen.find((c) => c.cmd === 'gh');
  assert.ok(gh, 'default gh runner was invoked');
  assert.equal(gh.timeout, shared.GH_BATCH_TIMEOUT_MS);
});

// ---- registration (index.js dispatch, hooks.js lists, format-summary) ----

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scratchDir } = require('../../helpers/tmp-dir');
const { initRepo } = require('../../helpers/git-fixtures');
const { readText } = require('../../helpers/read-skill');
const { reconcile, ALL_CHECKS } = require('../../../plugin/bin/lib/reconcile');
const { formatSummary } = require('../../../plugin/bin/lib/reconcile/format-summary');

function gitIn(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A working checkout with a bare origin on main, pr-first forced by policy.
function makeRepo({ claudeMd = null } = {}) {
  const origin = scratchDir('plan-refs-origin-');
  gitIn(origin, 'init', '--bare', '-b', 'main');
  const dir = scratchDir('plan-refs-');
  initRepo(dir, { branch: 'main', name: 't', email: 't@t' });
  if (claudeMd !== null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\nintegration-branch: main\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-m', 'init');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-u', 'origin', 'main');
  return { dir, origin };
}

// Stub the preflight's gh health probe for the duration of fn (ledger-residue.test.js's pattern).
async function withGhHealthy(fn) {
  const preflight = require('../../../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  try {
    return await fn();
  } finally {
    preflight.ghHealthCheck = original;
  }
}

// Stub the gh presence probe plan-refs reads at call time (repo-resolve's ghAvailable), so a host without gh stays hermetic.
async function withGhAvailable(fn) {
  const repoResolve = require('../../../plugin/bin/lib/repo-resolve');
  const original = repoResolve.ghAvailable;
  repoResolve.ghAvailable = () => true;
  try {
    return await fn();
  } finally {
    repoResolve.ghAvailable = original;
  }
}

test('index: plan-refs is registered on the background tier, deferred from the unscoped CLI, dispatched between ledger-residue and reap', () => {
  const hooks = require('../../../plugin/bin/hooks');
  assert.ok(ALL_CHECKS.includes('plan-refs'));
  assert.ok(hooks.BACKGROUND_CHECKS.includes('plan-refs'));
  assert.ok(hooks.CLI_DEFERRED_CHECKS.includes('plan-refs'));
  const src = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'reconcile', 'index.js'));
  const lastIndex = (needle) => src.lastIndexOf(needle);
  assert.ok(lastIndex("checks.includes('ledger-residue')") < lastIndex("checks.includes('plan-refs')"), 'plan-refs dispatch must follow ledger-residue');
  assert.ok(lastIndex("checks.includes('plan-refs')") < lastIndex("checks.includes('reap')"), 'plan-refs dispatch must precede reap');
  assert.ok(src.includes("'ledger-residue', 'plan-refs', 'reap'"), 'DISPATCH_ORDER must list ledger-residue, plan-refs, reap adjacently');
});

test('index: requesting plan-refs under pr-first sets result.planRefs to an array; not requesting it leaves null', async () => {
  const { dir } = makeRepo();
  await withGhAvailable(() => withGhHealthy(async () => {
    const withDispatch = await reconcile({ cwd: dir, checks: ['plan-refs'] });
    assert.ok(Array.isArray(withDispatch.planRefs), 'plan-refs requested under pr-first must set planRefs to an array, not stay null');
    const withoutDispatch = await reconcile({ cwd: dir, checks: ['mirror'] });
    assert.strictEqual(withoutDispatch.planRefs, null, 'plan-refs not requested must leave planRefs null');
  }));
});

test('index: a plan-refs failure lands in skipped', async () => {
  const { dir } = makeRepo({ claudeMd: 'work-backend: local-files\n' });
  await withGhHealthy(async () => {
    const r = await reconcile({ cwd: dir, checks: ['plan-refs'] });
    assert.deepStrictEqual(r.skipped.filter((s) => s.check === 'plan-refs'), [{ check: 'plan-refs', reason: 'local-files-backend' }]);
    assert.strictEqual(r.planRefs, null);
  });
});

test('index: under local-merge plan-refs still runs and stays out of the local-merge skip string', async () => {
  const { dir } = makeRepo();
  const localMerge = () => 'local-merge';
  await withGhAvailable(async () => {
    const r = await reconcile({ cwd: dir, checks: ['plan-refs'], resolveIntegrationModel: localMerge });
    assert.ok(Array.isArray(r.planRefs), 'plan-refs must run as a local-merge fallback');
    const skip = r.skipped.find((s) => s.reason === 'local-merge-model');
    assert.ok(skip, 'the local-merge skip entry must be present');
    assert.strictEqual(skip.check, 'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console');
    const reaped = await reconcile({ cwd: dir, checks: ['reap'], resolveIntegrationModel: localMerge });
    assert.strictEqual(reaped.planRefs, null, 'reap alone under local-merge must leave planRefs null');
  });
});

test('formatSummary renders plan-refs taken, planned and skipped lines', () => {
  const out = formatSummary({
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null,
    planRefs: [
      { ref: `${P}1`, record: 1, action: 'delete', reason: 'record-closed' },
      { ref: `${P}2`, record: 2, action: 'would-delete', reason: 'record-closed' },
      // Two planned entries, one taken: a dry-run row that counted `delete` instead of `would-delete` would read 1, not 2.
      { ref: `${P}4`, record: 4, action: 'would-delete', reason: 'record-closed' },
      { ref: `${P}3`, record: 3, action: 'skip', reason: 'record-open' },
    ],
  });
  assert.ok(out.includes('deleted: 1 plan ref'), out);
  assert.ok(out.includes('to delete (dry run): 2 plan refs'), out);
  assert.ok(out.includes('skipped: 1 plan ref (record-open 1)'), out);
});

test('hooks.js reconcile-threw fallback carries planRefs', () => {
  const src = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'hooks.js'));
  const line = src.split('\n').find((l) => l.includes("reason: 'reconcile-threw'"));
  assert.ok(line, 'the reconcile-threw fallback literal must exist');
  assert.ok(line.includes('planRefs: null'), line);
});

// ---- end to end: a real delete against a local bare origin (git real, gh injected) ----

test('planRefs: a real delete removes the closed record ref from the bare origin and keeps the open one', () => {
  const { dir, origin } = makeRepo();
  const head = gitIn(dir, 'rev-parse', 'HEAD').trim();
  gitIn(dir, 'push', 'origin', `${head}:${P}5`);
  gitIn(dir, 'push', 'origin', `${head}:${P}6`);
  // gh is injected, and origin's URL must parse for the owner/name gate, so the remote URL read answers a GitHub URL
  // while every other git call runs for real against the bare origin.
  const realGit = (args) => (args[0] === 'remote' ? URL : gitIn(dir, ...args));
  const states = { 5: 'CLOSED', 6: 'OPEN' };
  const gh = (args) => {
    const q = args.find((a) => a.startsWith('query=')).slice('query='.length);
    const repo = {};
    for (const m of q.matchAll(/(i\d+): issue\(number:(\d+)\)/g)) repo[m[1]] = { number: Number(m[2]), state: states[m[2]] };
    return JSON.stringify({ data: { repository: repo } });
  };
  const r = planRefs({ cwd: dir, git: realGit, gh, readBackend: noLocal });
  assert.equal(r.failure, null);
  assert.deepEqual(r.entries.map((e) => [e.record, e.action]), [[5, 'delete'], [6, 'skip']]);
  const left = gitIn(dir, 'ls-remote', origin, `${P}*`);
  assert.doesNotMatch(left, new RegExp(`${P}5\\b`));
  assert.match(left, new RegExp(`${P}6\\b`));
});

test('planRefs: a plan ref re-written between the listing and the push survives the lease (real git)', () => {
  const { dir, origin } = makeRepo();
  const head = gitIn(dir, 'rev-parse', 'HEAD').trim();
  gitIn(dir, 'push', 'origin', `${head}:${P}5`);
  gitIn(dir, 'commit', '--allow-empty', '-m', 'rewritten plan');
  const newSha = gitIn(dir, 'rev-parse', 'HEAD').trim();
  assert.notEqual(newSha, head);
  const realGit = (args) => (args[0] === 'remote' ? URL : gitIn(dir, ...args));
  // The injected gh runs after ls-remote and before the push: it re-writes the ref on origin, then answers CLOSED.
  const gh = (args) => {
    gitIn(dir, 'push', '--force', 'origin', `${newSha}:${P}5`);
    const q = args.find((a) => a.startsWith('query=')).slice('query='.length);
    const repo = {};
    for (const m of q.matchAll(/(i\d+): issue\(number:(\d+)\)/g)) repo[m[1]] = { number: Number(m[2]), state: 'CLOSED' };
    return JSON.stringify({ data: { repository: repo } });
  };
  const r = planRefs({ cwd: dir, git: realGit, gh, readBackend: noLocal });
  assert.equal(r.failure, null);
  assert.equal(r.entries.length, 1);
  assert.deepEqual([r.entries[0].action, r.entries[0].reason], ['skip', 'delete-failed']);
  assert.match(r.entries[0].detail, /stale info/);
  assert.match(gitIn(dir, 'ls-remote', origin, `${P}5`), new RegExp(`^${newSha}\\t${P}5`));
});
