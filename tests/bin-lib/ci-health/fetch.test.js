'use strict';
// Record #5161 — plugin/bin/lib/ci-health/fetch.js: the repo read and the paged
// `repos/{o}/{r}/actions/runs` read behind an injected runner, plus the error helpers billing reuses.
// Fake runners record argv and opts inside and branch on the args shape; anything unhandled throws.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { errorText, httpStatusOf, isGhAbsent, readRepo, fetchRuns } = require('../../../plugin/bin/lib/ci-health/fetch');
const { CI_HEALTH_GH_TIMEOUT_MS } = require('../../../plugin/bin/lib/ci-health/constants');

const REPO_ORG = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'ci-health', 'repo-org.json'), 'utf8');
const RUNS_PATH = 'repos/acme/widgets/actions/runs';
const FROM = '2026-10-13';

function ghError(stderr, extra = {}) {
  const err = new Error(`Command failed: gh api\n${stderr}`);
  err.stderr = stderr;
  return Object.assign(err, extra);
}

function enoent() {
  const err = new Error('spawnSync gh ENOENT');
  err.code = 'ENOENT';
  return err;
}

function pageBody(count) {
  const workflow_runs = Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
  return JSON.stringify({ total_count: count, workflow_runs });
}

// pages: array indexed from page 1; each entry is a run count, an Error to throw, or a raw string body.
function runsRunner(pages) {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (args[3] !== RUNS_PATH) throw new Error('unexpected ' + args.join(' '));
    const n = Number(args[args.length - 1].replace('page=', ''));
    const entry = pages[n - 1];
    if (entry === undefined) throw new Error('unexpected ' + args.join(' '));
    if (entry instanceof Error) throw entry;
    if (typeof entry === 'string') return entry;
    return pageBody(entry);
  };
  return { runner, calls };
}

test('page 1 argv is the exact GET read with the created window, 100 per page, and the 15 s timeout', () => {
  const { runner, calls } = runsRunner([3]);
  fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
  assert.deepStrictEqual(calls[0].args, [
    'api', '--method', 'GET', 'repos/acme/widgets/actions/runs',
    '-f', 'created=>=2026-10-13', '-f', 'per_page=100', '-f', 'page=1',
  ]);
  assert.deepStrictEqual(calls[0].opts, { timeout: 15000 });
  assert.strictEqual(CI_HEALTH_GH_TIMEOUT_MS, 15000);
});

test('a short page 1 is the whole window: one call, runs returned, not truncated', () => {
  const { runner, calls } = runsRunner([3]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(r, { available: true, runs: [{ id: 1 }, { id: 2 }, { id: 3 }], pages: 1, truncated: false, ghAbsent: false, failures: [] });
});

test('AC7.1: page 2 throwing HTTP 503 keeps page 1, names the failed page, and stops', () => {
  const { runner, calls } = runsRunner([100, ghError('HTTP 503: Service Unavailable (https://api.github.com/...)'), 100]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
  assert.strictEqual(r.runs.length, 100);
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.pages, 1);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].query, 'runs page 2');
  assert.strictEqual(r.failures[0].status, 503);
  assert.match(r.failures[0].error, /HTTP 503/);
  assert.strictEqual(calls.length, 2, 'no page 3 call');
});

test('AC7.3: ten full pages hit the cap — truncated, exactly 10 calls, 1,000 runs', () => {
  const { runner, calls } = runsRunner(Array(11).fill(100));
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(r.runs.length, 1000);
  assert.strictEqual(r.pages, 10);
  assert.deepStrictEqual(calls.map((c) => c.args[c.args.length - 1]), Array.from({ length: 10 }, (_, i) => `page=${i + 1}`));
});

test('AC7.3: a 40-run page 3 ends the window — 3 calls, not truncated', () => {
  const { runner, calls } = runsRunner([100, 100, 40, 100]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.runs.length, 240);
  assert.strictEqual(r.pages, 3);
});

test('a short page 10 is not truncated', () => {
  const { runner, calls } = runsRunner([...Array(9).fill(100), 99]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.runs.length, 999);
});

for (const [label, stderr, status] of [
  ['401', 'HTTP 401: Bad credentials (https://api.github.com/repos/acme/widgets/actions/runs)', 401],
  ['403', 'HTTP 403: Resource not accessible by integration', 403],
  ['429', 'API rate limit exceeded for user ID 1. (HTTP 429)', 429],
]) {
  test(`page 1 throwing HTTP ${label} leaves the runs half unavailable with status ${status}`, () => {
    const { runner, calls } = runsRunner([ghError(stderr)]);
    const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
    assert.strictEqual(r.available, false);
    assert.strictEqual(r.ghAbsent, false);
    assert.strictEqual(r.pages, 0);
    assert.deepStrictEqual(r.runs, []);
    assert.strictEqual(r.failures[0].query, 'runs page 1');
    assert.strictEqual(r.failures[0].status, status);
    assert.strictEqual(calls.length, 1);
  });
}

test('ENOENT on page 1 signals gh absent with no failure row, and stops', () => {
  const { runner, calls } = runsRunner([enoent(), 100]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
  assert.strictEqual(r.ghAbsent, true);
  assert.strictEqual(r.available, false);
  assert.deepStrictEqual(r.failures, []);
  assert.deepStrictEqual(r.runs, []);
  assert.strictEqual(calls.length, 1);
});

for (const [label, body] of [
  ['an unparseable body', 'not json'],
  ['a non-array workflow_runs', JSON.stringify({ total_count: 1, workflow_runs: { id: 1 } })],
  ['a body without workflow_runs', JSON.stringify({ message: 'ok' })],
]) {
  test(`${label} on page 2 is a failed page with a null status, and stops`, () => {
    const { runner, calls } = runsRunner([100, body, 100]);
    const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM }, { runner });
    assert.strictEqual(r.available, true);
    assert.strictEqual(r.runs.length, 100);
    assert.strictEqual(r.failures.length, 1);
    assert.strictEqual(r.failures[0].query, 'runs page 2');
    assert.strictEqual(r.failures[0].status, null);
    assert.ok(r.failures[0].error.length > 0);
    assert.strictEqual(calls.length, 2);
  });
}

test('readRepo issues the exact GET and maps the org fixture', () => {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (args[3] !== 'repos/example-org/widgets') throw new Error('unexpected ' + args.join(' '));
    return REPO_ORG;
  };
  const r = readRepo({ owner: 'example-org', repo: 'widgets' }, { runner });
  assert.deepStrictEqual(r, { ok: true, ownerType: 'Organization', ownerLogin: 'example-org', defaultBranch: 'main' });
  assert.deepStrictEqual(calls, [{ args: ['api', '--method', 'GET', 'repos/example-org/widgets'], opts: { timeout: 15000 } }]);
});

test('readRepo maps a throw to ok: false with the HTTP status and error text', () => {
  const runner = () => { throw ghError('HTTP 404: Not Found (https://api.github.com/repos/acme/gone)'); };
  const r = readRepo({ owner: 'acme', repo: 'gone' }, { runner });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 404);
  assert.match(r.error, /HTTP 404: Not Found/);
  assert.strictEqual(r.ghAbsent, false);
});

test('readRepo maps ENOENT to ghAbsent: true with a null status', () => {
  const r = readRepo({ owner: 'acme', repo: 'widgets' }, { runner: () => { throw enoent(); } });
  assert.deepStrictEqual({ ok: r.ok, status: r.status, ghAbsent: r.ghAbsent }, { ok: false, status: null, ghAbsent: true });
});

test('readRepo maps a body without an owner type to ok: false, never ok with an undefined field', () => {
  const r = readRepo({ owner: 'acme', repo: 'widgets' }, { runner: () => JSON.stringify({ default_branch: 'main', owner: { login: 'acme' } }) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, null);
  assert.strictEqual(r.ghAbsent, false);
});

test('errorText prefers stderr, else message plus stdout, trimmed and capped at 300 chars', () => {
  assert.strictEqual(errorText(ghError('  HTTP 403: nope \n')), 'HTTP 403: nope');
  const noStderr = Object.assign(new Error('boom'), { stdout: ' partial \n' });
  assert.strictEqual(errorText(noStderr), 'boom partial');
  assert.strictEqual(errorText(new Error('only message')), 'only message');
  assert.strictEqual(errorText(ghError('x'.repeat(500))).length, 300);
});

test('httpStatusOf reads stderr first, then message, else null', () => {
  assert.strictEqual(httpStatusOf(ghError('HTTP 410: Gone')), 410);
  assert.strictEqual(httpStatusOf(new Error('gh: HTTP 502 bad gateway')), 502);
  const both = Object.assign(new Error('HTTP 500'), { stderr: 'HTTP 404: Not Found' });
  assert.strictEqual(httpStatusOf(both), 404);
  assert.strictEqual(httpStatusOf(new Error('socket hang up')), null);
  assert.strictEqual(httpStatusOf(enoent()), null);
});

test('isGhAbsent is true only for ENOENT', () => {
  assert.strictEqual(isGhAbsent(enoent()), true);
  assert.strictEqual(isGhAbsent(ghError('HTTP 404')), false);
  assert.strictEqual(isGhAbsent(Object.assign(new Error('t'), { code: 'ETIMEDOUT' })), false);
  assert.strictEqual(isGhAbsent(undefined), false);
});
