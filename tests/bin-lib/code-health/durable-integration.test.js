'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'code-health.js');

function tmpRepo() {
  const dir = scratchDir('code-health-durable-');
  fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 1;\n');
  return dir;
}

test('retry-queue drain prints [] against a repo with no health-state branch (real git, no gh network call needed since it degrades before ever calling gh)', () => {
  const root = tmpRepo();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/nonexistent.git'], { cwd: root });
  const out = execFileSync('node', [CLI, 'retry-queue', 'drain', '--root', root], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(out), []);
});

// Regression: run()'s `retry-queue update` dispatch line rebases args._ via
// `args._.slice(1)` before handing it to makeRetryQueueCommands().update(),
// which reads its results-file path from args._[1] (i.e. args._[0] after the
// rebase). A typo in that rebase (e.g. `.slice(2)`, or dropping it) would
// make args._[1] resolve to the literal string 'update' instead of the real
// results-file path, so this real-CLI (argv-parsed) invocation is what
// actually exercises that dispatch line — tests/bin-lib/health-core/
// retry-cli.test.js calls makeRetryQueueCommands directly and bypasses argv
// parsing entirely, so it can't catch this class of bug.
test('retry-queue update <results.json> dispatches correctly against a repo with no health-state branch', () => {
  const root = tmpRepo();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/nonexistent.git'], { cwd: root });

  const resultsFile = path.join(root, 'results.json');
  fs.writeFileSync(resultsFile, JSON.stringify([
    { fingerprint: 'codehealth-aaaa0001', payload: { title: 'Stale skill count' }, ok: false, error: 'filing failed: 500' },
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
