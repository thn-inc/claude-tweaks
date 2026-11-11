'use strict';
// #4347: fetchCiVerdict's CI-run read, through a fake gh runner — never the network.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fetchCiVerdict, normalizeCiLog } = require('../../../plugin/bin/lib/verify/ci-source');

const SHA = 'a'.repeat(40);
const SOURCE = { workflow: 'test.yml', job: 'test', waitSeconds: 60, pollSeconds: 20 };

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ci-source-')); }

// A fake gh: `routes` maps an endpoint matcher to a response (string → JSON
// body, function → called per hit, Error → thrown). Unknown calls throw loudly.
function fakeGh(routes) {
  const calls = [];
  const runner = (args) => {
    calls.push(args.join(' '));
    assert.strictEqual(args[0], 'api');
    for (const [re, resp] of routes) {
      if (re.test(args[1])) {
        const v = typeof resp === 'function' ? resp(args) : resp;
        if (v instanceof Error) throw v;
        return typeof v === 'string' ? v : JSON.stringify(v);
      }
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { runner, calls };
}

function clock() {
  let t = 1000;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

const PULLS = [/\/commits\/a{40}\/pulls$/, [{ number: 7, state: 'open', head: { sha: SHA } }]];
const PR = [/\/pulls\/7$/, { number: 7, mergeable_state: 'clean' }];
const RUNS = [/\/actions\/workflows\/test\.yml\/runs\?head_sha=a{40}/, { workflow_runs: [{ id: 41, head_sha: SHA, status: 'completed', html_url: 'https://example.test/runs/41' }] }];
function jobs(conclusion, status = 'completed') {
  return [/\/actions\/runs\/41\/jobs/, { jobs: [{ id: 99, name: 'test', status, conclusion, started_at: '2026-10-25T17:27:00Z', completed_at: '2026-10-25T17:30:30Z', html_url: 'https://example.test/job/99' }] }];
}
const LOG = '2026-10-25T17:27:01.1234567Z ✖ failing tests:\n2026-10-25T17:27:02.0000000Z test at /home/runner/work/claude-tweaks/claude-tweaks/tests/a.test.js:3:1\n';

function call(over, { runner, clk = clock(), source = SOURCE } = {}) {
  const logDir = tmpDir();
  return fetchCiVerdict({
    suite: 'tests', source, headSha: SHA, logDir, localRoot: '/local/root', runner, sleep: clk.sleep, now: clk.now, ...over,
  }).then((v) => ({ v, logDir }));
}

test('a green CI job on HEAD is used: exit 0, log written, run id and url recorded (#4347)', async () => {
  const { runner } = fakeGh([PULLS, PR, RUNS, jobs('success'), [/\/jobs\/99\/logs$/, '2026-10-25T17:30:00.0Z ℹ tests 3\n']]);
  const { v, logDir } = await call({}, { runner });
  assert.strictEqual(v.used, true);
  assert.strictEqual(v.result.exitCode, 0);
  assert.strictEqual(v.result.name, 'tests');
  assert.strictEqual(v.result.durationMs, 210000);
  assert.strictEqual(v.ci.runId, 41);
  assert.strictEqual(v.ci.runUrl, 'https://example.test/runs/41');
  assert.strictEqual(v.ci.prNumber, 7);
  assert.strictEqual(v.ci.fallback, null);
  assert.strictEqual(fs.readFileSync(path.join(logDir, 'tests.log'), 'utf8'), 'ℹ tests 3\n\n');
});

test('a red CI job is used with exit 1 and its log normalized to the local checkout (#4347)', async () => {
  const { runner } = fakeGh([PULLS, PR, RUNS, jobs('failure'), [/\/jobs\/99\/logs$/, LOG]]);
  const { v, logDir } = await call({}, { runner });
  assert.strictEqual(v.used, true);
  assert.strictEqual(v.result.exitCode, 1);
  const log = fs.readFileSync(path.join(logDir, 'tests.log'), 'utf8');
  assert.match(log, /^✖ failing tests:\ntest at \/local\/root\/tests\/a\.test\.js:3:1\n/);
});

test('HEAD that is not an open PR head falls back at once, never polling (#4347)', async () => {
  const { runner, calls } = fakeGh([[/\/commits\/a{40}\/pulls$/, [{ number: 7, state: 'open', head: { sha: 'b'.repeat(40) } }]]]);
  const { v } = await call({}, { runner });
  assert.deepStrictEqual([v.used, v.ci.fallback], [false, 'no-open-pr-at-head']);
  assert.strictEqual(calls.length, 1);
});

test('an unpushed HEAD (commit unknown to GitHub) falls back as head-not-pushed (#4347)', async () => {
  const err = new Error('gh: No commit found for SHA (HTTP 422)');
  const { runner } = fakeGh([[/\/commits\//, err]]);
  const { v } = await call({}, { runner });
  assert.strictEqual(v.ci.fallback, 'head-not-pushed');
});

test('a conflicted (dirty) PR falls back at once — it gets no pull_request runs (#4347)', async () => {
  const { runner, calls } = fakeGh([PULLS, [/\/pulls\/7$/, { number: 7, mergeable_state: 'dirty' }]]);
  const { v } = await call({}, { runner });
  assert.strictEqual(v.ci.fallback, 'pr-conflicted');
  assert.ok(!calls.some((c) => c.includes('actions/')), 'no run lookup for a conflicted PR');
});

test('no CI run for the head sha within the wait falls back after bounded polling (#4347)', async () => {
  const clk = clock();
  const { runner, calls } = fakeGh([PULLS, PR, [/\/actions\/workflows\//, { workflow_runs: [] }]]);
  const { v } = await call({}, { runner, clk });
  assert.strictEqual(v.ci.fallback, 'no-ci-run-within-wait');
  assert.strictEqual(calls.filter((c) => c.includes('/runs?')).length, 4, 'polls at 0, 20, 40, 60 s then stops');
  assert.strictEqual(v.ci.waitedMs, 60000);
});

test('a run still in progress is polled until its job completes (#4347)', async () => {
  let hits = 0;
  const { runner } = fakeGh([PULLS, PR, RUNS,
    [/\/actions\/runs\/41\/jobs/, () => { hits += 1; return jobs(hits < 3 ? null : 'success', hits < 3 ? 'in_progress' : 'completed')[1]; }],
    [/\/jobs\/99\/logs$/, 'ok\n']]);
  const { v } = await call({}, { runner });
  assert.strictEqual(v.used, true);
  assert.strictEqual(hits, 3);
});

test('a cancelled CI job falls back (#4347)', async () => {
  const { runner } = fakeGh([PULLS, PR, RUNS, jobs('cancelled')]);
  const { v } = await call({}, { runner });
  assert.strictEqual(v.ci.fallback, 'ci-run-cancelled');
});

test('a completed run with no job of the declared name falls back (#4347)', async () => {
  const { runner } = fakeGh([PULLS, PR, RUNS, [/\/actions\/runs\/41\/jobs/, { jobs: [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success' }] }]]);
  const { v } = await call({}, { runner });
  assert.strictEqual(v.ci.fallback, 'ci-job-not-found');
});

test('gh not installed falls back as gh-unavailable (#4347)', async () => {
  const runner = () => { const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e; };
  const { v } = await call({}, { runner });
  assert.strictEqual(v.ci.fallback, 'gh-unavailable');
});

test('a red job whose log cannot be fetched falls back — nothing names its failures (#4347)', async () => {
  const { runner } = fakeGh([PULLS, PR, RUNS, jobs('failure'), [/\/jobs\/99\/logs$/, new Error('HTTP 410')]]);
  const { v } = await call({}, { runner });
  assert.strictEqual(v.ci.fallback, 'ci-log-unavailable');
});

test('only REST endpoints with {owner}/{repo} placeholders are called (#4347)', async () => {
  const { runner, calls } = fakeGh([PULLS, PR, RUNS, jobs('success'), [/\/jobs\/99\/logs$/, '']]);
  await call({}, { runner });
  assert.ok(calls.length >= 4);
  for (const c of calls) assert.match(c, /^api repos\/\{owner\}\/\{repo\}\//);
});

test('normalizeCiLog strips the timestamp prefix and remaps both runner roots (#4347)', () => {
  const out = normalizeCiLog('2026-10-25T17:27:01.1234567Z at /home/runner/work/x/x/tests/a.js:1\nD:\\a\\x\\x\\tests\\b.js\nplain', '/r/');
  assert.strictEqual(out, 'at /r/tests/a.js:1\n/r\\tests\\b.js\nplain');
});
