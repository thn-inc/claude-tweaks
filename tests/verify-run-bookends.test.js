// tests/verify-run-bookends.test.js
// Fake deps per the gh-api-module-pattern skill's injectable-runner
// convention — never real git or the filesystem. `readClaimBlobGit` fakes
// return the same shape claims-git-cas.js's real implementation does
// ({content, tipSha, absent, failure}).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  run, parseArgs, parseTargets, USAGE,
} = require('../plugin/bin/verify-run-bookends');

const RUN_DIR = '/repo/.claude-tweaks/pipelines/2026-09-17T001731-record-1728';
const RUN_ID = '2026-09-17T001731-record-1728';
const NOW = Date.parse('2026-09-17T01:00:00.000Z');

function liveMarker(runId, claimedAtIso = new Date(NOW).toISOString(), ttlHours = 72) {
  return JSON.stringify({
    runId, sessionId: 's', claimedAt: claimedAtIso, ttlHours, host: 'h',
  });
}
function tombstoneMarker(runId) {
  return JSON.stringify({ released: true, runId, reason: 'x', releasedAt: new Date(NOW).toISOString() });
}

function makeDeps({
  runState = { worktree: '/wt', pr: { number: 1, url: 'https://x' } },
  integrationModel = 'pr-first',
  claims = {},
} = {}) {
  return {
    readRunState: () => runState,
    readIntegrationModel: () => integrationModel,
    readClaimBlobGit: ({ issueNumber }) => claims[issueNumber] || { content: null, absent: true, failure: null },
    now: () => NOW,
    stdout: () => {},
    stderr: () => {},
  };
}

function captured(deps) {
  const out = [];
  const err = [];
  return {
    ...deps,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    out,
    err,
  };
}

test('parseArgs: rejects an unknown flag', () => {
  assert.deepStrictEqual(parseArgs(['--bogus']), { error: 'unknown argument: --bogus' });
});

test('parseTargets: rejects blank, trailing comma, and non-positive-integer parts', () => {
  assert.strictEqual(parseTargets(''), null);
  assert.strictEqual(parseTargets('1,'), null);
  assert.strictEqual(parseTargets('0'), null);
});

test('parseTargets: accepts a clean comma-separated list', () => {
  assert.deepStrictEqual(parseTargets('1,2,3'), [1, 2, 3]);
});

test('--help prints usage and exits 0', () => {
  const deps = captured(makeDeps());
  const code = run(['--help'], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.out[0], USAGE);
});

test('missing --run exits 2', () => {
  const deps = captured(makeDeps());
  const code = run(['--targets', '1728'], deps);
  assert.strictEqual(code, 2);
});

test('missing --targets exits 2', () => {
  const deps = captured(makeDeps());
  const code = run(['--run', RUN_DIR], deps);
  assert.strictEqual(code, 2);
});

test('all bookends confirmed (worktree stamped, PR recorded under pr-first, live claim matching this run) -> exit 0', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 0);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.ok, true);
  assert.deepStrictEqual(payload.confirmed.claims, [1728]);
});

test('a stale claim still counts as confirmed when the runId matches this run (TTL expiry is not "never claimed")', () => {
  const staleClaimedAt = new Date(NOW - 100 * 60 * 60 * 1000).toISOString(); // 100h ago, past the 72h TTL
  const deps = captured(makeDeps({
    claims: { 1728: { content: liveMarker(RUN_ID, staleClaimedAt), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 0);
});

test('no run-state.json (worktree never recorded) -> exit 1, missing worktree bookend', () => {
  const deps = captured(makeDeps({
    runState: null,
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.ok, false);
  assert.ok(payload.missing.some((m) => m.bookend === 'worktree'));
});

test('pr-first with no PR recorded -> exit 1, missing pr bookend', () => {
  const deps = captured(makeDeps({
    runState: { worktree: '/wt' },
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  assert.ok(payload.missing.some((m) => m.bookend === 'pr'));
});

test('local-merge run with no PR recorded -> the pr bookend is not required', () => {
  const deps = captured(makeDeps({
    runState: { worktree: '/wt' },
    integrationModel: 'local-merge',
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 0);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.confirmed.pr, 'n/a');
});

test('claim never written (absent) -> exit 1, missing claim bookend', () => {
  const deps = captured(makeDeps({ claims: {} }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  const claimMiss = payload.missing.find((m) => m.bookend === 'claim' && m.issue === 1728);
  assert.ok(claimMiss, 'absent claim must be reported missing');
  assert.match(claimMiss.reason, /state=absent/);
});

test('claim held by a DIFFERENT run -> exit 1, not silently accepted as this run\'s own', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: liveMarker('some-other-run'), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  const claimMiss = payload.missing.find((m) => m.bookend === 'claim' && m.issue === 1728);
  assert.match(claimMiss.reason, /runId=some-other-run/);
});

test('a tombstoned (released) claim does not count as confirmed', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: tombstoneMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
});

test('a git read failure surfaces as a distinct reason, never mistaken for "never claimed"', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: null, absent: false, failure: 'transport-failure' } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  const claimMiss = payload.missing.find((m) => m.bookend === 'claim' && m.issue === 1728);
  assert.match(claimMiss.reason, /read-failed: transport-failure/);
});

test('multiple targets: every one is checked independently, all confirmed -> exit 0', () => {
  const deps = captured(makeDeps({
    claims: {
      1728: { content: liveMarker(RUN_ID), absent: false, failure: null },
      1729: { content: liveMarker(RUN_ID), absent: false, failure: null },
    },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728,1729'], deps);
  assert.strictEqual(code, 0);
});

test('multiple targets: one unconfirmed target is reported without masking the confirmed one', () => {
  const deps = captured(makeDeps({
    claims: {
      1728: { content: liveMarker(RUN_ID), absent: false, failure: null },
      1729: { content: null, absent: true, failure: null },
    },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728,1729'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.missing.length, 1);
  assert.strictEqual(payload.missing[0].issue, 1729);
});
