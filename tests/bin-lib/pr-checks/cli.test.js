'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../../../plugin/bin/pr-checks');

const HEAD = 'c'.repeat(40);

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

// Fake-.git anchored fixture, same shape as tests/bin-lib/pr-bookkeeping/cli.test.js:
// a main checkout's .git is a directory; mainRoot is injected so resolveTarget never spawns git.
function fixture(runState, { spec = false } = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prchecks-cli-'));
  created.push(main);
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  let runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-16T000001-record-1');
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

function makeDeps(main, over = {}) {
  const out = []; const err = []; const ghCalls = [];
  const deps = {
    cwd: () => main,
    mainRoot: main,
    ghAvailable: () => true,
    hasPullRequestCi: () => true,
    git: (args) => {
      if (args.join(' ') === 'rev-parse HEAD') return `${HEAD}\n`;
      if (args.join(' ') === 'rev-parse --show-toplevel') return `${main}\n`;
      throw new Error('unexpected git ' + args.join(' '));
    },
    gh: (args) => {
      ghCalls.push(args);
      if (args[0] === 'pr' && args[1] === 'view') {
        return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci.example/test' }] });
      }
      if (args[0] === 'run' && args[1] === 'list') return '[]';
      throw new Error('unexpected gh ' + args.join(' '));
    },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  return { deps, out, err, ghCalls, json: () => JSON.parse(out.join('')) };
}

test('parseArgs: --run required, unknown flag rejected', () => {
  assert.deepEqual(parseArgs(['--run', 'x']), { run: 'x', pr: null, help: false });
  assert.ok(parseArgs(['--bogus']).error);
});

test('parseArgs: --pr takes a positive integer; --pr with --run is an error', () => {
  assert.equal(parseArgs(['--pr', '12']).pr, 12);
  assert.ok(parseArgs(['--pr', 'abc']).error);
  assert.ok(parseArgs(['--pr', '0']).error);
  assert.ok(parseArgs(['--pr']).error);
  assert.ok(parseArgs(['--pr', '7', '--run', 'x']).error);
});

test('--help prints usage and exits 0 without touching gh', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main);
  assert.equal(run(['--help'], h.deps), 0);
  assert.match(h.out.join(''), /usage: pr-checks\.js --run <run-dir>/);
  assert.equal(h.ghCalls.length, 0);
});

test('missing --run is exit 2', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main);
  assert.equal(run([], h.deps), 2);
});

test('a run dir that does not exist is exit 3', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main);
  assert.equal(run(['--run', path.join(main, 'nope')], h.deps), 3);
});

test('red at HEAD: reads pr.number from run-state.json and reports the failing check', () => {
  const { main, runDir } = fixture({ pr: { number: 7, url: 'u' } });
  const h = makeDeps(main);
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'red');
  assert.equal(j.pr, 7);
  assert.equal(j.localHead, HEAD);
  assert.deepEqual(j.failing, [{ name: 'test', url: 'https://ci.example/test' }]);
  assert.deepEqual(h.ghCalls[0], ['pr', 'view', '7', '--json', 'headRefOid,statusCheckRollup,baseRefName']);
});

test('no pr in run-state.json is no-pr and never calls gh (local-merge / standalone fail-open)', () => {
  const { main, runDir } = fixture({ status: 'active' });
  const h = makeDeps(main);
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'no-pr');
  assert.equal(h.ghCalls.length, 0);
});

test('no run-state.json at all is no-pr', () => {
  const { main, runDir } = fixture(null);
  const h = makeDeps(main);
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'no-pr');
});

test('a per-spec spec-* run dir inherits pr from its parent run dir', () => {
  const { main, runDir } = fixture({ pr: { number: 9 } }, { spec: true });
  const h = makeDeps(main);
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().pr, 9);
  assert.equal(h.json().state, 'red');
});

test('gh absent is gh-absent and never calls gh pr view', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { ghAvailable: () => false });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'gh-absent');
  assert.equal(h.ghCalls.length, 0);
});

test('a gh pr view throw is read-failed, never green', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { gh: () => { throw new Error('HTTP 502'); } });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'read-failed');
  assert.match(j.reason, /HTTP 502/);
});

test('unparseable gh output is read-failed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { gh: () => 'not json' });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'read-failed');
});

test('an unreadable local HEAD is read-failed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { git: () => { throw new Error('not a git repo'); } });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'read-failed');
});

test('hasPullRequestCi receives the git toplevel, not cwd (#3013 F7)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const toplevel = path.join(main, 'nested-cwd-should-not-be-used');
  let received;
  const h = makeDeps(main, {
    cwd: () => path.join(main, 'somewhere-else'),
    git: (args) => {
      if (args.join(' ') === 'rev-parse HEAD') return `${HEAD}\n`;
      if (args.join(' ') === 'rev-parse --show-toplevel') return `${toplevel}\n`;
      throw new Error('unexpected git ' + args.join(' '));
    },
    hasPullRequestCi: (root) => { received = root; return true; },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(received, toplevel);
});

test('an empty rollup with no PR workflow is no-ci', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { hasPullRequestCi: () => false, gh: (args) => (args[0] === 'run' ? '[]' : JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [] })) });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'no-ci');
});

test('a green rollup plus an in_progress head run is pending, not green (#3405)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const ghCalls = [];
  const h = makeDeps(main, {
    gh: (args) => {
      ghCalls.push(args);
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' }, { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
      return JSON.stringify([{ name: 'test', workflowName: 'test', status: 'in_progress', conclusion: '', url: 'https://ci.example/r/1' }]);
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'pending');
  assert.deepEqual(j.pending, ['test']);
  assert.deepEqual(ghCalls.find((a) => a[0] === 'run'), ['run', 'list', '--commit', HEAD, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url']);
});

test('a failing gh run list is read-failed, never green (#3405)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    gh: (args) => {
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
      throw new Error('HTTP 503');
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'read-failed');
  assert.match(j.reason, /^gh run list failed:/);
});

test('a failing gh run list does not mask a red rollup (#3405)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    gh: (args) => {
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci.example/test' }] });
      throw new Error('HTTP 503');
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'red');
  assert.deepEqual(j.failing, [{ name: 'test', url: 'https://ci.example/test' }]);
});

test('a non-array gh run list output is read-failed, never green (#3405)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    gh: (args) => {
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
      return JSON.stringify({ message: 'not a list' });
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'read-failed');
  assert.match(j.reason, /^gh run list failed:/);
});

test('a stale head skips gh run list, so a runs-read failure cannot turn stale into read-failed (#3405)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const ghCalls = [];
  const h = makeDeps(main, {
    gh: (args) => {
      ghCalls.push(args);
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: 'd'.repeat(40), statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
      throw new Error('HTTP 503');
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'stale');
  assert.equal(ghCalls.some((a) => a[0] === 'run'), false);
});

test('a green rollup plus a completed failing head run is red, naming that run (#3405)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    gh: (args) => {
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
      return JSON.stringify([{ name: 'lint', workflowName: 'lint', status: 'completed', conclusion: 'failure', url: 'https://ci.example/r/2' }]);
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'red');
  assert.deepEqual(j.failing, [{ name: 'lint', url: 'https://ci.example/r/2' }]);
});

// --pr <n> (#3469): classify a PR by number with no run dir. git answers only
// `rev-parse --show-toplevel`; a `rev-parse HEAD` call throws, proving --pr never reads local HEAD.
function prDeps(main, over = {}) {
  return makeDeps(main, {
    git: (args) => {
      if (args.join(' ') === 'rev-parse --show-toplevel') return `${main}\n`;
      throw new Error('unexpected git ' + args.join(' '));
    },
    ...over,
  });
}

function prGh(headRun, ghCalls = []) {
  return (args) => {
    ghCalls.push(args);
    if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }], baseRefName: 'main' });
    return JSON.stringify([headRun]);
  };
}

test('--pr and --run together is exit 2 with no gh calls', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = prDeps(main);
  assert.equal(run(['--pr', '7', '--run', runDir], h.deps), 2);
  assert.equal(h.ghCalls.length, 0);
});

test('--pr with a non-integer is exit 2', () => {
  const { main } = fixture(null);
  for (const bad of ['abc', '0']) {
    const h = prDeps(main);
    assert.equal(run(['--pr', bad], h.deps), 2, bad);
    assert.equal(h.ghCalls.length, 0, bad);
  }
});

test('AC1.1: --pr reads a green rollup with an in-progress head run as pending', () => {
  const { main } = fixture(null);
  const ghCalls = [];
  const h = prDeps(main, { gh: prGh({ name: 'test', workflowName: 'test', status: 'in_progress', conclusion: '', url: 'u' }, ghCalls) });
  assert.equal(run(['--pr', '7'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'pending');
  assert.ok(j.pending.includes('test'));
  assert.equal(j.pr, 7);
  assert.equal(j.localHead, null);
  assert.deepEqual(ghCalls[0], ['pr', 'view', '7', '--json', 'headRefOid,statusCheckRollup,baseRefName']);
  const runCall = ghCalls.find((a) => a[0] === 'run');
  assert.ok(runCall.includes('--commit'));
  assert.equal(runCall[runCall.indexOf('--commit') + 1], HEAD);
});

test('--pr green when rollup and head runs are complete', () => {
  const { main } = fixture(null);
  const h = prDeps(main, { gh: prGh({ name: 'test', workflowName: 'test', status: 'completed', conclusion: 'success', url: 'u' }) });
  assert.equal(run(['--pr', '7'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'green');
  assert.equal(j.pr, 7);
  assert.equal(j.localHead, null);
});

test('--pr with gh absent is gh-absent and never calls gh', () => {
  const { main } = fixture(null);
  const h = prDeps(main, { ghAvailable: () => false });
  assert.equal(run(['--pr', '7'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'gh-absent');
  assert.equal(j.pr, 7);
  assert.equal(h.ghCalls.length, 0);
});

test('--pr: a failed head-runs read on a non-red verdict is read-failed', () => {
  const { main } = fixture(null);
  const h = prDeps(main, {
    gh: (args) => {
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
      throw new Error('HTTP 503');
    },
  });
  assert.equal(run(['--pr', '7'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'read-failed');
  assert.match(j.reason, /gh run list failed/);
  assert.equal(j.pr, 7);
});

test('--pr: a red rollup still reads the base tip and can be inherited-red', () => {
  const { main } = fixture(null);
  const f = redWithBase(['test'], ['test']);
  const h = prDeps(main, f.over);
  assert.equal(run(['--pr', '7'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'inherited-red');
  assert.equal(j.localHead, null);
  assert.equal(j.pr, 7);
});

test('--pr: a failed gh pr view is read-failed with a null localHead', () => {
  const { main } = fixture(null);
  const h = prDeps(main, { gh: () => { throw new Error('HTTP 502'); } });
  assert.equal(run(['--pr', '7'], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'read-failed');
  assert.equal(j.localHead, null);
  assert.match(j.reason, /gh pr view failed/);
});

const BASE_SHA = 'e'.repeat(40);
// gh fake for a red PR (failing: given names) and a base tip failing `baseFailing` (as check-run names).
function redWithBase(prFailing, baseFailing, over = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, statusCheckRollup: prFailing.map((n) => ({ __typename: 'CheckRun', name: n, status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: `https://ci.example/${n}` })) });
    if (args[0] === 'run' && args[3] === HEAD) return '[]';
    if (args[0] === 'api' && args[1] === 'repos/{owner}/{repo}/commits/main') return `${BASE_SHA}\n`;
    if (args[0] === 'api' && args[1] === `repos/{owner}/{repo}/commits/${BASE_SHA}/check-runs?per_page=100`) return JSON.stringify({ total_count: baseFailing.length, check_runs: baseFailing.map((n) => ({ name: n, status: 'completed', conclusion: 'failure' })) });
    if (args[0] === 'api' && args[1] === `repos/{owner}/{repo}/commits/${BASE_SHA}/status?per_page=100`) return JSON.stringify({ state: 'failure', total_count: 0, statuses: [] });
    if (args[0] === 'run' && args[3] === BASE_SHA) return '[]';
    throw new Error('unexpected gh ' + args.join(' '));
  };
  return { calls, over: { integrationBranch: () => 'main', gh, ...over } };
}

test('AC1.1: a PR red only on a check also red at the integration tip reads inherited-red, naming baseSha', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const f = redWithBase(['test'], ['test']);
  const h = makeDeps(main, f.over);
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'inherited-red');
  assert.equal(j.baseSha, BASE_SHA);
  assert.deepEqual(j.failing, [{ name: 'test', url: 'https://ci.example/test', inherited: true }]);
  assert.deepEqual(f.calls.find((a) => a[0] === 'run' && a[3] === BASE_SHA), ['run', 'list', '--commit', BASE_SHA, '--limit', '100', '--json', 'databaseId,name,workflowName,status,conclusion,url']);
});

test('AC2.1: one inherited + one new failing check stays red; only the new one is attributable', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, redWithBase(['test', 'lint'], ['test']).over);
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'red');
  assert.deepEqual(j.failing.filter((x) => !x.inherited).map((x) => x.name), ['lint']);
});

test('AC3.1: a base read that throws leaves plain red (never green) with baseReason', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const f = redWithBase(['test'], ['test']);
  const h = makeDeps(main, { ...f.over, gh: (args) => { if (args[0] === 'api') throw new Error('HTTP 502'); return f.over.gh(args); } });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'red');
  assert.match(j.baseReason, /HTTP 502/);
  assert.deepEqual(j.failing, [{ name: 'test', url: 'https://ci.example/test' }]);
});

test('an unresolvable integration branch is plain red and makes no gh api call', () => {
  for (const integrationBranch of [() => null, () => { throw new Error('no origin'); }]) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const f = redWithBase(['test'], ['test'], { integrationBranch });
    const h = makeDeps(main, f.over);
    assert.equal(run(['--run', runDir], h.deps), 0);
    assert.equal(h.json().state, 'red');
    assert.ok(h.json().baseReason);
    assert.equal(f.calls.some((a) => a[0] === 'api'), false);
  }
});

test('a non-sha base response is plain red and skips the check-runs read', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const f = redWithBase(['test'], ['test']);
  const h = makeDeps(main, { ...f.over, gh: (args) => (args[1] === 'repos/{owner}/{repo}/commits/main' ? 'Not Found\n' : f.over.gh(args)) });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'red');
  assert.match(h.json().baseReason, /base sha unreadable/);
  assert.equal(f.calls.some((a) => String(a[1]).includes('/check-runs')), false);
});

test('green, pending and stale verdicts never read the base tip', () => {
  const rollups = {
    green: { headRefOid: HEAD, rollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
    pending: { headRefOid: HEAD, rollup: [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: '' }] },
    stale: { headRefOid: 'd'.repeat(40), rollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] },
  };
  for (const [state, { headRefOid, rollup }] of Object.entries(rollups)) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const calls = [];
    const h = makeDeps(main, { integrationBranch: () => 'main', gh: (args) => { calls.push(args); return args[0] === 'pr' ? JSON.stringify({ headRefOid, statusCheckRollup: rollup }) : '[]'; } });
    assert.equal(run(['--run', runDir], h.deps), 0);
    assert.equal(h.json().state, state);
    assert.equal(calls.some((a) => a[0] === 'api'), false);
  }
});

test('the PR\'s own baseRefName is the comparison base, not the resolver branch', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const f = redWithBase(['test'], ['test']);
  const h = makeDeps(main, {
    ...f.over,
    integrationBranch: () => 'main',
    gh: (args) => {
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, baseRefName: 'dev', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci.example/test' }] });
      if (args[0] === 'api' && args[1] === 'repos/{owner}/{repo}/commits/dev') { f.calls.push(args); return `${BASE_SHA}\n`; }
      return f.over.gh(args);
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'inherited-red');
  assert.equal(j.baseBranch, 'dev');
  assert.equal(f.calls.some((a) => a[1] === 'repos/{owner}/{repo}/commits/dev'), true);
  assert.equal(f.calls.some((a) => a[1] === 'repos/{owner}/{repo}/commits/main'), false);
});

test('with no baseRefName the integration-branch resolver is the fallback base', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, redWithBase(['test'], ['test']).over);
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'inherited-red');
  assert.equal(j.baseBranch, 'main');
});

test('a failed head-runs read plus a base comparison that concludes inherited-red is read-failed (partial read)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const f = redWithBase(['test'], ['test']);
  const h = makeDeps(main, {
    ...f.over,
    gh: (args) => { if (args[0] === 'run' && args[3] === HEAD) throw new Error('HTTP 503'); return f.over.gh(args); },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  const j = h.json();
  assert.equal(j.state, 'read-failed');
  assert.match(j.reason, /^gh run list failed:/);
});

test('AC3.1: any one failing base read — check-runs, statuses or base run list — leaves plain red, never inherited-red', () => {
  const failers = {
    'check-runs': (args) => args[0] === 'api' && String(args[1]).includes('/check-runs'),
    statuses: (args) => args[0] === 'api' && String(args[1]).includes('/status?'),
    'run list': (args) => args[0] === 'run' && args[3] === BASE_SHA,
  };
  for (const [label, fails] of Object.entries(failers)) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const f = redWithBase(['test'], ['test']);
    const h = makeDeps(main, { ...f.over, gh: (args) => { if (fails(args)) throw new Error(`HTTP 502 ${label}`); return f.over.gh(args); } });
    assert.equal(run(['--run', runDir], h.deps), 0);
    const j = h.json();
    assert.equal(j.state, 'red', label);
    assert.match(j.baseReason, new RegExp(`HTTP 502 ${label}`), label);
    assert.deepEqual(j.failing, [{ name: 'test', url: 'https://ci.example/test' }], label);
  }
});

test('a malformed base listing (check_runs not an array) is plain red with baseReason', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const f = redWithBase(['test'], ['test']);
  const h = makeDeps(main, { ...f.over, gh: (args) => (args[0] === 'api' && String(args[1]).includes('/check-runs') ? JSON.stringify({ total_count: 1, check_runs: {} }) : f.over.gh(args)) });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'red');
  assert.match(h.json().baseReason, /malformed base read/);
});

test('a truncated base listing (check-runs or statuses) is plain red naming the truncation, never inherited-red', () => {
  const truncators = {
    'check-runs': (args, body) => (String(args[1]).includes('/check-runs') ? JSON.stringify({ ...JSON.parse(body), total_count: 250 }) : body),
    statuses: (args, body) => (String(args[1]).includes('/status?') ? JSON.stringify({ ...JSON.parse(body), total_count: 31 }) : body),
  };
  for (const [label, bend] of Object.entries(truncators)) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const f = redWithBase(['test'], ['test']);
    const h = makeDeps(main, { ...f.over, gh: (args) => { const body = f.over.gh(args); return args[0] === 'api' ? bend(args, body) : body; } });
    assert.equal(run(['--run', runDir], h.deps), 0);
    const j = h.json();
    assert.equal(j.state, 'red', label);
    assert.match(j.baseReason, /truncated/, label);
  }
});

test('a base ref name with URL-significant characters is encoded per segment in the tip read', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const f = redWithBase(['test'], ['test']);
  const h = makeDeps(main, {
    ...f.over,
    gh: (args) => {
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: HEAD, baseRefName: 'release/v1#x', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci.example/test' }] });
      if (args[0] === 'api' && args[1] === 'repos/{owner}/{repo}/commits/release/v1%23x') { f.calls.push(args); return `${BASE_SHA}\n`; }
      return f.over.gh(args);
    },
  });
  assert.equal(run(['--run', runDir], h.deps), 0);
  assert.equal(h.json().state, 'inherited-red');
  assert.equal(f.calls.some((a) => a[1] === 'repos/{owner}/{repo}/commits/release/v1%23x'), true);
});

test('a workflow failing at the base tip only as a run row is inherited; a superseded failed run is not', () => {
  const cases = [
    { rows: [{ databaseId: 5, name: 'ci', workflowName: 'windows-regression', status: 'completed', conclusion: 'failure' }], state: 'inherited-red' },
    { rows: [
      { databaseId: 5, name: 'ci', workflowName: 'windows-regression', status: 'completed', conclusion: 'failure' },
      { databaseId: 9, name: 'ci', workflowName: 'windows-regression', status: 'completed', conclusion: 'success' },
    ], state: 'red' },
  ];
  for (const { rows, state } of cases) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const f = redWithBase(['windows-regression'], []);
    const h = makeDeps(main, { ...f.over, gh: (args) => (args[0] === 'run' && args[3] === BASE_SHA ? JSON.stringify(rows) : f.over.gh(args)) });
    assert.equal(run(['--run', runDir], h.deps), 0);
    assert.equal(h.json().state, state);
  }
});
