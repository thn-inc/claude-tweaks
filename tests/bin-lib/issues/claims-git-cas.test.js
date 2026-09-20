'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyGitError, readClaimBlobGit, writeClaimBlobGit, readClaimBlobsGitBatch, CLAIMS_BRANCH,
} = require('../../../plugin/bin/lib/issues/claims-git-cas');

test('classifyGitError: missing path in a git show', () => {
  const err = new Error("fatal: path 'claims/issue-42.json' does not exist in '1234abcd'");
  assert.deepEqual(classifyGitError(err), { kind: 'missing-path' });
});

test('classifyGitError: force-with-lease rejection is contested', () => {
  const err = new Error('! [rejected]        HEAD -> claims-registry (stale info)');
  err.stderr = '! [rejected]        HEAD -> claims-registry (stale info)\nerror: failed to push some refs';
  assert.deepEqual(classifyGitError(err), { kind: 'contested' });
});

test('classifyGitError: fetch-first rejection is contested', () => {
  const err = new Error('fatal: push failed');
  err.stderr = '! [rejected]        claims-registry -> claims-registry (fetch first)';
  assert.deepEqual(classifyGitError(err), { kind: 'contested' });
});

test('classifyGitError: secondary rate limit is distinct from contested', () => {
  const err = new Error('remote: You have exceeded a secondary rate limit');
  err.stderr = 'remote: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.';
  assert.deepEqual(classifyGitError(err), { kind: 'secondary-rate-limit' });
});

test('classifyGitError: Retry-After signature also reads as secondary rate limit', () => {
  const err = new Error('remote: Retry-After: 60');
  err.stderr = 'remote: Retry-After: 60\nremote: You have triggered an abuse detection mechanism.';
  assert.deepEqual(classifyGitError(err), { kind: 'secondary-rate-limit' });
});

test('classifyGitError: everything else is a plain transport failure', () => {
  const err = new Error('fatal: unable to access: Could not resolve host');
  assert.deepEqual(classifyGitError(err), { kind: 'transport-failure' });
});

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every git call below pipes stderr — the house convention for a bare-repo
// fixture (tests/bin-lib/reconcile/prune-remote.test.js's `git` helper).
// Without it execFileSync echoes the child's stderr to this process's
// stderr *as well as* capturing it, so the failure paths these tests
// exercise on purpose (`git show` on an absent claim, the rejected
// stale-lease push, the empty-clone warning) print `fatal:` / `! [rejected]`
// lines into the TAP stream as `#` diagnostics — output that reads like a
// broken suite while every assertion passes. stdin stays 'pipe' because
// realRunner feeds `hash-object --stdin` through `opts.input`.
const PIPE_ALL = ['pipe', 'pipe', 'pipe'];

function realRunner(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8', stdio: PIPE_ALL, cwd: opts.cwd, input: opts.input, env: opts.env,
  });
}

function setupGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: PIPE_ALL });
}

function makeBareOriginAndClone() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-git-cas-'));
  const originDir = path.join(root, 'origin.git');
  const cloneDir = path.join(root, 'clone');
  setupGit(['init', '--bare', '-q', '-b', 'main', originDir]);
  setupGit(['clone', '-q', originDir, cloneDir]);
  setupGit(['-C', cloneDir, 'config', 'user.email', 'test@example.com']);
  setupGit(['-C', cloneDir, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(cloneDir, 'README.md'), 'seed\n');
  setupGit(['-C', cloneDir, 'add', 'README.md']);
  setupGit(['-C', cloneDir, 'commit', '-q', '-m', 'seed']);
  setupGit(['-C', cloneDir, 'push', '-q', 'origin', 'main']);
  setupGit(['-C', cloneDir, 'push', '-q', 'origin', `main:${CLAIMS_BRANCH}`]);
  return { root, cloneDir };
}

test('readClaimBlobGit: absent path on a fresh registry branch', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  const result = readClaimBlobGit({ issueNumber: 42, remote: 'origin', runner });
  assert.equal(result.absent, true);
  assert.equal(result.content, null);
  assert.equal(typeof result.tipSha, 'string');
  assert.equal(result.tipSha.length, 40);
});

test('writeClaimBlobGit then readClaimBlobGit round-trips the blob', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  const read1 = readClaimBlobGit({ issueNumber: 42, remote: 'origin', runner });
  const write = writeClaimBlobGit({
    issueNumber: 42, content: '{"runId":"r1"}', message: 'Claim #42',
    expectedTipSha: read1.tipSha, remote: 'origin', runner,
  });
  assert.equal(write.ok, true);
  const read2 = readClaimBlobGit({ issueNumber: 42, remote: 'origin', runner });
  assert.equal(read2.absent, false);
  assert.equal(read2.content, '{"runId":"r1"}');
  assert.notEqual(read2.tipSha, read1.tipSha);
});

// #1467: writeClaimBlobGit's success return carries the just-pushed commit
// sha, and readClaimBlobGit accepts it back as `knownTip` to skip its own
// fetch entirely — the batch-amortization seam claim-targets.js's group loop
// chains through. Proven independently of that loop: a runner that throws on
// `fetch`/`rev-parse` still succeeds when a `knownTip` is supplied, and the
// content it reads matches what the write just landed.
test('writeClaimBlobGit: success return carries commitSha, and readClaimBlobGit(knownTip) reads it with zero fetch calls', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  const read1 = readClaimBlobGit({ issueNumber: 42, remote: 'origin', runner });
  const write = writeClaimBlobGit({
    issueNumber: 42, content: '{"runId":"r1"}', message: 'Claim #42',
    expectedTipSha: read1.tipSha, remote: 'origin', runner,
  });
  assert.equal(write.ok, true);
  assert.equal(typeof write.commitSha, 'string');
  assert.equal(write.commitSha.length, 40);

  const fetchCalls = [];
  const noFetchRunner = (args, opts) => {
    if (args[0] === 'fetch' || (args[0] === 'rev-parse' && args[1] !== write.commitSha)) {
      fetchCalls.push(args);
      throw new Error('fetch/rev-parse must not be called when knownTip is supplied');
    }
    return realRunner(args, { ...opts, cwd: cloneDir });
  };
  const read2 = readClaimBlobGit({
    issueNumber: 42, remote: 'origin', runner: noFetchRunner, knownTip: write.commitSha,
  });
  assert.equal(fetchCalls.length, 0, 'knownTip must skip the fetch + scratch-ref dance entirely');
  assert.equal(read2.absent, false);
  assert.equal(read2.content, '{"runId":"r1"}');
  assert.equal(read2.tipSha, write.commitSha);
});

// A `knownTip` that a caller supplied but doesn't resolve locally (a bad or
// unreachable sha — the only way this happens in practice is a caller bug,
// since a real batch always chains from a sha it just committed itself)
// never crashes. `git show <bad-sha>:<path>` reports the identical "path
// does not exist in <tree-ish>" text git also uses for a genuinely missing
// path on a real tip (confirmed against real git, not assumed), so this
// degrades to the ordinary `absent: true` outcome — the ambiguity is
// harmless here because it only ever feeds a claim/contest content decision;
// the write-side `--force-with-lease` (a REAL git ref, never a caller-echoed
// string) is what actually enforces correctness regardless of what a read
// believed.
test('readClaimBlobGit: an unresolvable knownTip degrades to absent, never a crash', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  const result = readClaimBlobGit({
    issueNumber: 42, remote: 'origin', runner, knownTip: 'f'.repeat(40),
  });
  assert.equal(result.failure, null);
  assert.equal(result.absent, true);
  assert.equal(result.tipSha, 'f'.repeat(40));
});

test('writeClaimBlobGit: a second write on a stale expectedTipSha is contested', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  const read1 = readClaimBlobGit({ issueNumber: 42, remote: 'origin', runner });
  writeClaimBlobGit({
    issueNumber: 42, content: '{"runId":"r1"}', message: 'Claim #42 by r1',
    expectedTipSha: read1.tipSha, remote: 'origin', runner,
  });
  // Second writer still holds the STALE tip from read1 — its lease no longer matches.
  const write2 = writeClaimBlobGit({
    issueNumber: 42, content: '{"runId":"r2"}', message: 'Claim #42 by r2',
    expectedTipSha: read1.tipSha, remote: 'origin', runner,
  });
  assert.equal(write2.ok, false);
  assert.equal(write2.conflict, true);
});

// #787 hindsight finding: FETCH_HEAD is a single shared pseudo-ref, not
// scoped to one call — a concurrent `git fetch` elsewhere in the same
// checkout between this function's own fetch and its read used to be able to
// overwrite it, making the read resolve someone else's fetch instead of its
// own. Simulates exactly that interleaving (an unrelated fetch sneaked in
// right after this call's own fetch) and pins that the read still resolves
// this call's own target, never the decoy.
test('readClaimBlobGit: a concurrent unrelated fetch in the same checkout does not corrupt the read', () => {
  const { root, cloneDir } = makeBareOriginAndClone();
  const originDir = path.join(root, 'origin.git');
  // A second branch, unrelated to claims-registry, whose tip an interleaved
  // fetch will plant into the shared FETCH_HEAD pseudo-ref.
  setupGit(['-C', cloneDir, 'checkout', '-q', '-b', 'decoy']);
  fs.writeFileSync(path.join(cloneDir, 'decoy.txt'), 'decoy\n');
  setupGit(['-C', cloneDir, 'add', 'decoy.txt']);
  setupGit(['-C', cloneDir, 'commit', '-q', '-m', 'decoy']);
  setupGit(['-C', cloneDir, 'push', '-q', 'origin', 'decoy']);
  setupGit(['-C', cloneDir, 'checkout', '-q', 'main']);

  let fetchCount = 0;
  const runner = (args, opts) => {
    const out = realRunner(args, { ...opts, cwd: cloneDir });
    if (args[0] === 'fetch') {
      fetchCount += 1;
      if (fetchCount === 1) {
        // An unrelated concurrent fetch, interleaved right after this call's
        // own fetch — the exact race window the fix closes.
        realRunner(['fetch', '-q', 'origin', 'decoy'], { cwd: cloneDir });
      }
    }
    return out;
  };
  const result = readClaimBlobGit({ issueNumber: 42, remote: 'origin', runner });
  assert.equal(result.absent, true, 'claims-registry genuinely has no issue-42 claim yet — must not resolve the decoy branch instead');
  const decoyTip = realRunner(['ls-remote', originDir, 'decoy'], { cwd: cloneDir }).split('\t')[0];
  const registryTip = realRunner(['ls-remote', originDir, CLAIMS_BRANCH], { cwd: cloneDir }).split('\t')[0];
  assert.notEqual(result.tipSha, decoyTip, "must resolve claims-registry's own tip, never the interleaved decoy fetch's");
  assert.equal(result.tipSha, registryTip);
});

test('writeClaimBlobGit: unrelated existing files in the tree survive a write', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  const read1 = readClaimBlobGit({ issueNumber: 1, remote: 'origin', runner });
  writeClaimBlobGit({
    issueNumber: 1, content: '{"runId":"r1"}', message: 'Claim #1',
    expectedTipSha: read1.tipSha, remote: 'origin', runner,
  });
  const read2 = readClaimBlobGit({ issueNumber: 1, remote: 'origin', runner });
  writeClaimBlobGit({
    issueNumber: 2, content: '{"runId":"r2"}', message: 'Claim #2',
    expectedTipSha: read2.tipSha, remote: 'origin', runner,
  });
  const readme = realRunner(['show', `origin/${CLAIMS_BRANCH}:README.md`], { cwd: cloneDir });
  assert.equal(readme, 'seed\n');
  const issue1 = readClaimBlobGit({ issueNumber: 1, remote: 'origin', runner });
  assert.equal(issue1.content, '{"runId":"r1"}');
});

// #2613: readClaimBlobsGitBatch replaces N per-blob `git show` calls with 2
// total subprocess invocations (`ls-tree` + `cat-file --batch`), regardless
// of registry size — the fix for a documented full-scan procedure that had
// no batched alternative and, on a ~1000-blob registry, tempted a sampling
// shortcut that produced a 93% false-positive rate.
function writeBlob(cloneDir, runner, issueNumber, content) {
  const before = readClaimBlobGit({ issueNumber, remote: 'origin', runner });
  const write = writeClaimBlobGit({
    issueNumber, content, message: `Claim #${issueNumber}`, expectedTipSha: before.tipSha, remote: 'origin', runner,
  });
  assert.equal(write.ok, true, `fixture setup: claim #${issueNumber} must write cleanly`);
  return write.commitSha;
}

test('readClaimBlobsGitBatch: returns identical per-blob classification to N sequential readClaimBlobGit calls, including an absent number', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  let tip;
  tip = writeBlob(cloneDir, runner, 10, '{"runId":"r10"}');
  tip = writeBlob(cloneDir, runner, 11, '{"runId":"r11"}');
  tip = writeBlob(cloneDir, runner, 12, '{"runId":"r12"}');
  // 13 is left absent on purpose.

  const batch = readClaimBlobsGitBatch({ issueNumbers: [10, 11, 12, 13], tip, runner });
  assert.equal(batch.failure, null);
  for (const n of [10, 11, 12, 13]) {
    const sequential = readClaimBlobGit({ issueNumber: n, remote: 'origin', runner, knownTip: tip });
    assert.deepEqual(batch.results[n], sequential, `issue #${n} must classify identically via both paths`);
  }
  assert.equal(batch.results[13].absent, true);
});

test('readClaimBlobsGitBatch: with issueNumbers omitted, discovers the full claims/ keyspace from the same ls-tree call (the Primary listing use case)', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  let tip;
  tip = writeBlob(cloneDir, runner, 20, '{"runId":"r20"}');
  tip = writeBlob(cloneDir, runner, 21, '{"runId":"r21"}');

  const batch = readClaimBlobsGitBatch({ tip, runner });
  assert.equal(batch.failure, null);
  assert.deepEqual(Object.keys(batch.results).map(Number).sort(), [20, 21]);
  assert.equal(batch.results[20].content, '{"runId":"r20"}');
  assert.equal(batch.results[21].content, '{"runId":"r21"}');
});

test('readClaimBlobsGitBatch: a claim blob with embedded newlines (pretty-printed JSON, the real production shape) survives batching intact', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  const prettyContent = JSON.stringify({ runId: 'r1', claimedAt: '2026-01-01T00:00:00.000Z', ttlHours: 72 }, null, 2);
  assert.ok(prettyContent.includes('\n'), 'fixture must actually exercise the embedded-newline case');
  const tip = writeBlob(cloneDir, runner, 30, prettyContent);

  const batch = readClaimBlobsGitBatch({ issueNumbers: [30], tip, runner });
  assert.equal(batch.results[30].content, prettyContent);
});

test('readClaimBlobsGitBatch: issues exactly 2 subprocess invocations regardless of blob count', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const setupRunner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
  let tip;
  const numbers = [40, 41, 42, 43, 44];
  for (const n of numbers) {
    tip = writeBlob(cloneDir, setupRunner, n, `{"runId":"r${n}"}`);
  }

  const calls = [];
  const countingRunner = (args, opts) => {
    calls.push(args[0]);
    return realRunner(args, { ...opts, cwd: cloneDir });
  };
  const batch = readClaimBlobsGitBatch({ issueNumbers: numbers, tip, runner: countingRunner });
  assert.equal(batch.failure, null);
  assert.deepEqual(calls, ['ls-tree', 'cat-file'], 'exactly one ls-tree call and one cat-file --batch call, never one per blob');
  for (const n of numbers) {
    assert.equal(batch.results[n].content, `{"runId":"r${n}"}`);
  }
});
