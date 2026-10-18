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
  assert.deepEqual(parseArgs(['--run', 'x']), { run: 'x', help: false });
  assert.ok(parseArgs(['--bogus']).error);
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
  assert.deepEqual(h.ghCalls[0], ['pr', 'view', '7', '--json', 'headRefOid,statusCheckRollup']);
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
