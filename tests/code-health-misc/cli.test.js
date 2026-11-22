'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', '..', 'plugin', 'bin', 'code-health.js');

function tmpRepo() {
  const root = scratchDir('codehealth-cli-');
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'code-health'), { recursive: true });
  return root;
}

// Run history is now durable (health-state branch), not local disk under
// .claude-tweaks/code-health/runs/*.json (see bin/lib/code-health/cache.js).
// The read path (git fetch + show) is pure git plumbing, so it can be
// exercised for real without gh/network: seed a local bare repo as `origin`
// and commit runs.json directly onto a health-state branch — the same
// technique tests/bin-lib/code-health/churn-v2.test.js uses.
function seedDurableRuns(root, runs) {
  const bareDir = scratchDir('codehealth-cli-bare-');
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  const seedDir = scratchDir('codehealth-cli-seed-');
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

function writeCache(root, cache) {
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'code-health', 'cache.json'),
    JSON.stringify(cache, null, 2),
    'utf8',
  );
}

test('status prints counts and exits 0 with no regressions', () => {
  const root = tmpRepo();
  writeCache(root, {
    'fp-1': { status: 'open', severity: 'low' },
    'fp-2': { status: 'closed' },
    'fp-3': { status: 'wontfix' },
  });
  const r = spawnSync('node', [CLI, 'status', '--root', root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /open:1/);
  assert.match(r.stdout, /closed:1/);
  assert.match(r.stdout, /wontfix:1/);
});

test('status --fail-on regressed exits 1 when a finding regressed', () => {
  const root = tmpRepo();
  writeCache(root, { 'fp-1': { status: 'regressed' } });
  const r = spawnSync('node', [CLI, 'status', '--fail-on', 'regressed', '--root', root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /regressed:1/);
});

test('status --fail-on risk-high exits 1 when an open risk-high finding exists', () => {
  const root = tmpRepo();
  writeCache(root, { 'fp-1': { status: 'open', severity: 'high', risk: 'high' } });
  const r = spawnSync('node', [CLI, 'status', '--fail-on', 'risk-high', '--root', root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
});

test('churn-report --fail-on-high-churn exits 1 above threshold', () => {
  const root = tmpRepo();
  seedDurableRuns(root, [
    { runId: 'r1', runAt: '2026-06-13T00:00:00Z', fingerprints: ['fp-a', 'fp-b'] },
    { runId: 'r2', runAt: '2026-06-14T00:00:00Z', fingerprints: ['fp-c', 'fp-d'] },
  ]);
  const r = spawnSync('node', [CLI, 'churn-report', '--fail-on-high-churn', '0.5', '--root', root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1, `stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.match(r.stdout, /1\b/); // ratio 1.0 row present
});

