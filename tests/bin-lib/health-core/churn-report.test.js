'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeCmdChurnReport } = require('../../../plugin/bin/lib/health-core/churn-report');

// Regression: cmdChurnReport used to be byte-identical across all four
// health-suite CLI files (code-health.js, harness-health.js,
// journey-health.js, docs-health.js) — now a single shared implementation
// parameterized by { readDurableState, computeChurn }.

function fakeDurableState(runs) {
  return { readDurableState: () => ({ runs }) };
}

function computeChurn(currentFps, priorRun) {
  const priorFps = priorRun && Array.isArray(priorRun.fingerprints) ? priorRun.fingerprints : [];
  const current = new Set(currentFps);
  const prior = new Set(priorFps);
  const appeared = currentFps.filter((fp) => !prior.has(fp));
  const disappeared = priorFps.filter((fp) => !current.has(fp));
  const union = new Set([...currentFps, ...priorFps]);
  const ratio = Math.round(((appeared.length + disappeared.length) / Math.max(union.size, 1)) * 1000) / 1000;
  return { appeared, disappeared, ratio };
}

function captureStdout(fn) {
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return out;
}

test('prints "no run logs found" and does not exit when there are no runs', () => {
  const { readDurableState } = fakeDurableState([]);
  const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn });
  const out = captureStdout(() => cmdChurnReport({ root: '/tmp' }));
  assert.match(out, /no run logs found/);
});

test('renders a row per run with appeared/disappeared/ratio columns', () => {
  const runs = [
    { runId: 'r1', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['a', 'b'] },
    { runId: 'r2', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['a', 'c'] },
  ];
  const { readDurableState } = fakeDurableState(runs);
  const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn });
  const out = captureStdout(() => cmdChurnReport({ root: '/tmp' }));
  assert.match(out, /runId/);
  assert.match(out, /r1/);
  assert.match(out, /r2/);
});

// #2053: cmdChurnReport no longer calls process.exit() directly (a pending
// stdout write right before process.exit() can truncate it for a piped
// consumer -- the caller's own main() applies the returned code to
// process.exitCode instead). These three tests assert the returned value
// rather than mocking process.exit.

test('returns 1 and prints a high-churn notice when --fail-on-high-churn threshold is exceeded', () => {
  const runs = [
    { runId: 'r1', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['a', 'b'] },
    { runId: 'r2', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['c', 'd'] }, // total churn
  ];
  const { readDurableState } = fakeDurableState(runs);
  const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn });
  let code;
  const out = captureStdout(() => { code = cmdChurnReport({ root: '/tmp', 'fail-on-high-churn': '0.5' }); });
  assert.strictEqual(code, 1);
  assert.match(out, /high churn/);
});

test('returns 2 with a usage error instead of silently disabling the gate when --fail-on-high-churn is not a number', () => {
  const runs = [
    { runId: 'r1', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['a', 'b'] },
    { runId: 'r2', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['c', 'd'] }, // total churn
  ];
  const { readDurableState } = fakeDurableState(runs);
  const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn });
  const origStderrWrite = process.stderr.write;
  let errOut = '';
  process.stderr.write = (chunk) => { errOut += chunk; return true; };
  let code;
  try {
    code = cmdChurnReport({ root: '/tmp', 'fail-on-high-churn': 'hihg' });
  } finally {
    process.stderr.write = origStderrWrite;
  }
  assert.strictEqual(code, 2, 'a malformed threshold must be a usage error, not a silently-disabled gate (exit 0/null)');
  assert.match(errOut, /invalid --fail-on-high-churn/);
});

test('returns undefined when ratio stays under threshold', () => {
  const runs = [
    { runId: 'r1', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['a', 'b'] },
    { runId: 'r2', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['a', 'b'] }, // no churn
  ];
  const { readDurableState } = fakeDurableState(runs);
  const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn });
  let code;
  captureStdout(() => { code = cmdChurnReport({ root: '/tmp', 'fail-on-high-churn': '0.5' }); });
  assert.strictEqual(code, undefined);
});

test('works unmodified against a computeChurn that returns an extra field (code-health\'s own shape has "stayed")', () => {
  const runs = [
    { runId: 'r1', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['a'] },
    { runId: 'r2', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['a'] },
  ];
  const { readDurableState } = fakeDurableState(runs);
  const computeChurnWithStayed = (currentFps, priorRun) => ({ ...computeChurn(currentFps, priorRun), stayed: ['a'] });
  const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn: computeChurnWithStayed });
  const out = captureStdout(() => cmdChurnReport({ root: '/tmp' }));
  assert.match(out, /r1/);
  assert.match(out, /r2/);
});
