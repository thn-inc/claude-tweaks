'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { sweepCli } = require('../../helpers/health-sweep-cli');
const { seedDurableState } = require('../health-core/seed-durable-state');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'journey-health.js');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-durable-'));
}

// In-process (#5380), with the file-protocol-only git guard — see tests/helpers/health-sweep-cli.js.
// The guard also makes the unreachable https remotes below fail at once instead of retrying DNS.
const cli = (argv, opts) => sweepCli(CLI, argv, opts);

test('retry-queue drain prints [] against a repo with no health-state branch', () => {
  const root = tmpRepo();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/nonexistent.git'], { cwd: root });
  const result = cli(['retry-queue', 'drain', '--root', root]);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), []);
});

// No --root: the root defaults to the cwd the call was given (the injected one, never the test process's).
// The fixture carries a queued payload on its own health-state branch, so an empty `[]` could
// only come from reading some other root: the drain must print exactly that payload.
test('retry-queue drain without --root drains the retry queue of the injected cwd', () => {
  const root = tmpRepo();
  seedDurableState(root, 'journey-health', 'retry-queue.json', [
    { fingerprint: 'journeyhealth-aaaa0001', payload: { title: 'Queued from the injected cwd' }, attempts: 1 },
  ], 'journey-health-durable');
  const result = cli(['retry-queue', 'drain'], { cwd: root });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), [{ title: 'Queued from the injected cwd' }]);
});

// bin/journey-health.js's run() dispatches `retry-queue update` by rebasing
// args._ (dropping the leading 'retry-queue' entry) before handing off to
// retryQueueCommands.update(), which expects its own args._[1] to be the
// results-file path (see the comment above that dispatch line). Nothing
// exercised that dispatch/rebase through the real CLI before this test —
// only `retry-queue drain` had CLI coverage. A repo with no health-state
// branch (same invalid-remote setup as the drain test above) means
// writeDurableState's write attempt fails before ever invoking its mutator,
// so `escalated` stays at its initial `[]` regardless of the results file's
// contents — what's actually under test here is that the CLI routes
// `retry-queue update <file>` to the right function with the right args,
// not makeRetryQueueCommands' own internal enqueue/escalate logic (that's
// covered by tests/bin-lib/health-core/retry-cli.test.js).
test('retry-queue update <results.json> dispatches correctly against a repo with no health-state branch', () => {
  const root = tmpRepo();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/nonexistent.git'], { cwd: root });

  const resultsFile = path.join(root, 'results.json');
  fs.writeFileSync(resultsFile, JSON.stringify([
    { fingerprint: 'journeyhealth-aaaa0001', payload: { title: 'Stale example journey' }, ok: false, error: 'filing failed: 500' },
  ]));

  // The result object carries the exit code rather than throwing on a non-zero one: against
  // this fixture's unreachable fake git remote, the durable-state write itself genuinely fails
  // after exhausting its retries, so the CLI now correctly exits non-zero (a real, intended
  // consequence of the retry-cli.js fix — a genuinely failed persistence attempt must not
  // silently report success to the calling shell/Routine).
  const result = cli(['retry-queue', 'update', resultsFile, '--root', root]);
  assert.deepStrictEqual(JSON.parse(result.stdout), [], 'a single failed attempt has not crossed the 3-attempt escalation threshold');
  assert.notStrictEqual(result.status, 0, 'the durable write against this unreachable remote genuinely fails, so this must not exit 0');
});

// No --root, and a results-file path relative to the injected cwd: both resolve against it.
test('retry-queue update without --root resolves the root and a relative results file against the injected cwd', () => {
  const root = tmpRepo();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/nonexistent.git'], { cwd: root });
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify([
    { fingerprint: 'journeyhealth-aaaa0001', payload: { title: 'Stale example journey' }, ok: false, error: 'filing failed: 500' },
  ]));

  const result = cli(['retry-queue', 'update', 'results.json'], { cwd: root });
  // The failed durable write's error names the git command it ran, and with it the root it ran against.
  assert.ok(result.stderr.includes(`git -C ${root} push origin`), `expected the failed push to name the injected cwd as root, got:\n${result.stderr}`);
  assert.deepStrictEqual(JSON.parse(result.stdout), [], 'a single failed attempt has not crossed the 3-attempt escalation threshold');
  assert.notStrictEqual(result.status, 0, 'the durable write against this unreachable remote genuinely fails, so this must not exit 0');
});
