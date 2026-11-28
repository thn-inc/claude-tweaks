'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

function tmpRepo() {
  return scratchDir('docs-health-durable-');
}

test('retry-queue drain prints [] against a repo with no health-state branch', () => {
  const root = tmpRepo();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/nonexistent.git'], { cwd: root });
  const out = execFileSync('node', [CLI, 'retry-queue', 'drain', '--root', root], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(out), []);
});

test('retry-queue update <results.json> dispatches correctly against a repo with no health-state branch', () => {
  const root = tmpRepo();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/nonexistent.git'], { cwd: root });

  const resultsFile = path.join(root, 'results.json');
  fs.writeFileSync(resultsFile, JSON.stringify([
    { fingerprint: 'docshealth-aaaa0001', payload: { title: 'Stale skill count' }, ok: false, error: 'filing failed: 500' },
  ]));

  // spawnSync, not execFileSync: against this fixture's unreachable fake git
  // remote, the durable-state write itself genuinely fails after exhausting
  // its retries, so the CLI now correctly exits non-zero (a real, intended
  // consequence of the retry-cli.js fix — a genuinely failed persistence
  // attempt must not silently report success to the calling shell/Routine).
  // execFileSync would throw on that non-zero exit before this test ever got
  // to inspect stdout; spawnSync returns a result object instead.
  const result = spawnSync('node', [CLI, 'retry-queue', 'update', resultsFile, '--root', root], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(result.stdout), [], 'a single failed attempt has not crossed the 3-attempt escalation threshold');
  assert.notStrictEqual(result.status, 0, 'the durable write against this unreachable remote genuinely fails, so this must not exit 0');
});
