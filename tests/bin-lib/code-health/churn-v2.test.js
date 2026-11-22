'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { computeChurn } = require('../../../plugin/bin/lib/code-health/cache');
const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'code-health.js');

function tmp() { return scratchDir('codehealth-churn-v2-'); }

// recordRun/readRuns (local-disk run-log persistence) were removed by the
// health-state migration — run history now lives on the durable health-state
// branch (bin/lib/health-core/durable-state.js), not local disk. Its write
// path (gh api blob/tree/commit/ref calls) requires live GitHub credentials
// and is covered by tests/bin-lib/health-core/durable-state.test.js's
// fake-runner tests; the read path is pure git plumbing (fetch + show), so
// it's exercised for real below via a local bare git remote seeded directly
// with runs.json (no gh/network needed) — the same technique
// tests/bin-lib/code-health/cli-nextslice.test.js uses for cursors.
function seedDurableRuns(root, runs) {
  const bareDir = scratchDir('codehealth-churn-bare-');
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  const seedDir = scratchDir('codehealth-churn-seed-');
  execFileSync('git', ['init', '-q', seedDir]);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state']);
  fs.mkdirSync(path.join(seedDir, 'code-health'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'code-health', 'runs.json'), JSON.stringify(runs));
  execFileSync('git', ['-C', seedDir, 'add', '-A']);
  execFileSync(
    'git',
    ['-C', seedDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'seed'],
  );
  execFileSync('git', ['-C', seedDir, 'push', '-q', bareDir, 'health-state']);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root });
}

test('computeChurn works over consecutive v2 run-logs', () => {
  // Run records constructed directly (computeChurn is a pure function over
  // fingerprint arrays; it never needed recordRun/readRuns's disk round-trip).
  const runs = [
    { runId: 'run-001', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['codehealth-aaaa0001', 'codehealth-bbbb0002'] },
    { runId: 'run-002', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['codehealth-aaaa0001', 'codehealth-cccc0003'] },
  ];
  const churn = computeChurn(runs[1].fingerprints, runs[0]);
  assert.deepStrictEqual(churn.appeared, ['codehealth-cccc0003']);
  assert.deepStrictEqual(churn.disappeared, ['codehealth-bbbb0002']);
  assert.strictEqual(churn.stayed.length, 1);
  // ratio = 2 appeared+disappeared / 3 union = 0.667
  assert.ok(churn.ratio > 0.5 && churn.ratio < 0.8, `ratio ${churn.ratio}`);
});

test('churn-report CLI exits 1 when ratio exceeds threshold', () => {
  const root = tmp();
  seedDurableRuns(root, [
    { runId: 'run-001', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['codehealth-aaaa0001', 'codehealth-bbbb0002'] },
    { runId: 'run-002', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['codehealth-cccc0003', 'codehealth-dddd0004'] },
  ]);
  const result = spawnSync('node', [CLI, 'churn-report', '--root', root, '--fail-on-high-churn', '0.5'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 1, `stdout: ${result.stdout} stderr: ${result.stderr}`);
});

test('churn-report CLI exits 0 when ratio is below threshold', () => {
  const root = tmp();
  seedDurableRuns(root, [
    { runId: 'run-001', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['codehealth-aaaa0001', 'codehealth-bbbb0002'] },
    { runId: 'run-002', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['codehealth-aaaa0001', 'codehealth-bbbb0002'] },
  ]);
  const result = spawnSync('node', [CLI, 'churn-report', '--root', root, '--fail-on-high-churn', '0.5'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
});

// Regression: cmdChurnReport used to read args.root bare, without the
// `args.root || process.cwd()` fallback every other command in this file
// uses. A malformed --root (trailing flag, no value) silently made it
// report "no run logs found" instead of falling back to cwd.
test('churn-report falls back to process.cwd() when --root is a trailing flag with no value', () => {
  const root = tmp();
  seedDurableRuns(root, [
    { runId: 'run-001', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['codehealth-aaaa0001', 'codehealth-bbbb0002'] },
    { runId: 'run-002', runAt: '2026-01-02T00:00:00.000Z', fingerprints: ['codehealth-cccc0003', 'codehealth-dddd0004'] },
  ]);
  const result = spawnSync('node', [CLI, 'churn-report', '--fail-on-high-churn', '0.5', '--root'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 1, `expected the seeded high-churn run at cwd to be found: stdout: ${result.stdout} stderr: ${result.stderr}`);
});
