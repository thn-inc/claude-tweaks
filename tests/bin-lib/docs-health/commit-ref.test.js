'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  verifyCommits, defaultGit, OUTCOMES, DEEPEN_LOCK_FILENAME, TIMEOUT_MARKER_FILENAME,
} = require('../../../plugin/bin/lib/docs-health/commit-ref');
const { git, tmpDir, makeOriginRepo, cloneOf, makeAmbiguousRepo } = require('./commit-fixtures');

const outcomeOf = (result, input) => result.commits.find((c) => c.input === input).outcome;

test('OUTCOMES lists exactly the six outcome strings', () => {
  assert.deepStrictEqual([...OUTCOMES], [
    'reachable', 'exists-unreachable', 'not-found', 'unverifiable', 'ambiguous', 'invalid',
  ]);
});

test('full clone: reachable, exists-unreachable, not-found against origin/HEAD', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin);
  const missing = '0000000000000000000000000000000000000000';
  const r = verifyCommits({ root: dir, hashes: [origin.root, origin.sideOnly.slice(0, 9), missing] });
  assert.strictEqual(r.integrationBranch, 'main');
  assert.strictEqual(r.integrationRef, 'refs/remotes/origin/main');
  assert.strictEqual(r.shallow.initial, false);
  assert.deepStrictEqual(r.commits, [
    { input: origin.root, outcome: 'reachable', sha: origin.root },
    { input: origin.sideOnly.slice(0, 9), outcome: 'exists-unreachable', sha: origin.sideOnly },
    { input: missing, outcome: 'not-found' },
  ]);
});

test('repo with no remote falls back to refs/heads/<integration-branch>', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({ root: origin.dir, hashes: [origin.third], integrationBranch: 'main' });
  assert.strictEqual(r.integrationRef, 'refs/heads/main');
  assert.strictEqual(outcomeOf(r, origin.third), 'reachable');
});

test('uppercase input classifies like lowercase', () => {
  const origin = makeOriginRepo();
  const upper = origin.second.slice(0, 10).toUpperCase();
  const r = verifyCommits({ root: origin.dir, hashes: [upper], integrationBranch: 'main' });
  assert.deepStrictEqual(r.commits, [{ input: upper, outcome: 'reachable', sha: origin.second }]);
});

test('ambiguous abbreviated hash is its own outcome, listing every candidate', () => {
  const amb = makeAmbiguousRepo();
  const r = verifyCommits({ root: amb.dir, hashes: [amb.prefix], integrationBranch: 'main' });
  assert.deepStrictEqual(r.commits, [
    { input: amb.prefix, outcome: 'ambiguous', candidates: amb.candidates },
  ]);
});

test('invalid inputs keep their outcome and input order is preserved', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({
    root: origin.dir, hashes: ['xyz', origin.root, 'abc', '-evil'], integrationBranch: 'main',
  });
  assert.deepStrictEqual(r.commits.map((c) => [c.input, c.outcome]), [
    ['xyz', 'invalid'], [origin.root, 'reachable'], ['abc', 'invalid'], ['-evil', 'invalid'],
  ]);
});

test('shallow clone is deepened over every branch head, then classified', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
  const r = verifyCommits({ root: dir, hashes: [origin.root, origin.sideOnly] });
  assert.strictEqual(r.shallow.initial, true);
  assert.strictEqual(r.shallow.deepened, true);
  assert.deepStrictEqual(r.commits.map((c) => c.outcome), ['reachable', 'exists-unreachable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'false');
});

test('deepen failure: shallow view never yields reachable or not-found', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  git(dir, ['remote', 'set-url', 'origin', `file://${tmpDir('gone')}/missing`]);
  const missing = '1111111111111111111111111111111111111111';
  // origin.third is the clone's tip, so it IS present in the shallow view.
  const r = verifyCommits({ root: dir, hashes: [origin.third, origin.root, missing, 'nothex'] });
  assert.strictEqual(r.shallow.deepened, false);
  assert.ok(r.shallow.error, 'the fetch failure is reported');
  assert.deepStrictEqual(r.commits.map((c) => c.outcome),
    ['unverifiable', 'unverifiable', 'unverifiable', 'invalid']);
  for (const c of r.commits.slice(0, 3)) assert.match(c.reason, /shallow/);
});

test('deepen disabled: shallow clone returns unverifiable without fetching', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const r = verifyCommits({ root: dir, hashes: [origin.third], deepen: false });
  assert.deepStrictEqual(r.commits.map((c) => c.outcome), ['unverifiable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
});

test('unresolvable integration branch yields unverifiable', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({ root: origin.dir, hashes: [origin.root], integrationBranch: 'nope' });
  assert.strictEqual(outcomeOf(r, origin.root), 'unverifiable');
  assert.strictEqual(r.integrationRef, null);
});

test('rejects option-shaped names without invoking git on them', () => {
  const calls = [];
  const fakeGit = (args) => { calls.push(args); throw new Error(`unexpected ${args.join(' ')}`); };
  for (const opts of [{ integrationBranch: '-evil' }, { remote: '--upload-pack=x' }]) {
    const r = verifyCommits({ root: '/nowhere', hashes: ['abcd'], git: fakeGit, ...opts });
    assert.strictEqual(r.commits[0].outcome, 'unverifiable');
    assert.match(r.commits[0].reason, /invalid (remote|integration branch) name/);
  }
  assert.deepStrictEqual(calls, []);
});

test('not a git repository yields unverifiable, never a throw', () => {
  const r = verifyCommits({ root: tmpDir('plain'), hashes: ['abcd'], integrationBranch: 'main' });
  assert.strictEqual(r.commits[0].outcome, 'unverifiable');
});

test('an input one character longer than a full sha1 hash classifies invalid, not reachable', () => {
  const origin = makeOriginRepo();
  const over = `${origin.root}0`;
  const r = verifyCommits({ root: origin.dir, hashes: [over], integrationBranch: 'main' });
  assert.strictEqual(outcomeOf(r, over), 'invalid');
});

test('an annotated tag object hash is peeled to its commit and classified, not not-found', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({
    root: origin.dir, hashes: [origin.annotatedTag.slice(0, 10)], integrationBranch: 'main',
  });
  assert.deepStrictEqual(r.commits, [
    { input: origin.annotatedTag.slice(0, 10), outcome: 'reachable', sha: origin.second },
  ]);
});

test('verifyCommits throws a clear TypeError on a non-array hashes value', () => {
  const origin = makeOriginRepo();
  assert.throws(
    () => verifyCommits({ root: origin.dir, hashes: 'abcd', integrationBranch: 'main' }),
    /verifyCommits: hashes must be an array, got string/,
  );
});

test('two real child processes racing verifyCommits against the same shallow clone: exactly one real fetch, both classify correctly (#2988)', async () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const counterPath = path.join(tmpDir('counter'), 'fetch-count.txt');
  fs.writeFileSync(counterPath, '');
  const commitRefModule = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'docs-health', 'commit-ref.js');

  // Each child sleeps synchronously right before the real fetch it's
  // about to issue -- widening the real git fetch's own duration so two
  // children spawned back-to-back reliably overlap instead of depending
  // on OS scheduling luck. The sleep happens in THIS wrapper, never
  // inside git itself, so it never interacts with execFileSync's own
  // DEEPEN_TIMEOUT_MS bound.
  const raceWorkerScript = (hash) => `
    const fs = require('fs');
    const { verifyCommits, defaultGit } = require(${JSON.stringify(commitRefModule)});
    function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
    const countingGit = (args, opts) => {
      if (args.includes('fetch')) {
        fs.appendFileSync(${JSON.stringify(counterPath)}, '1\\n');
        sleepSync(300);
      }
      return defaultGit(args, opts);
    };
    const r = verifyCommits({
      root: ${JSON.stringify(dir)}, hashes: [${JSON.stringify(hash)}],
      integrationBranch: 'main', git: countingGit,
    });
    process.stdout.write(JSON.stringify(r));
  `;

  function runChild(hash) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', raceWorkerScript(hash)]);
      let stdout = ''; let stderr = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('close', (code) => (code === 0
        ? resolve(JSON.parse(stdout))
        : reject(new Error(`child exited ${code}: ${stderr}`))));
      p.on('error', reject);
    });
  }

  const [resultA, resultB] = await Promise.all([runChild(origin.root), runChild(origin.sideOnly)]);

  const fetchCount = fs.readFileSync(counterPath, 'utf8').split('\n').filter(Boolean).length;
  assert.strictEqual(fetchCount, 1, 'exactly one real git fetch --unshallow must be issued across both racing processes');
  assert.deepStrictEqual(resultA.commits, [{ input: origin.root, outcome: 'reachable', sha: origin.root }]);
  assert.deepStrictEqual(resultB.commits, [{ input: origin.sideOnly, outcome: 'exists-unreachable', sha: origin.sideOnly }]);
  assert.strictEqual(resultA.shallow.deepened, true);
  assert.strictEqual(resultB.shallow.deepened, true);
});

test('two real child processes racing verifyCommits against a shallow LINKED WORKTREE: exactly one real fetch, both classify correctly (#2988 review finding)', async () => {
  // A linked worktree's `.git` is a FILE (a `gitdir:` pointer), not a
  // directory -- this is the shape `path.join(root, '.git', lockFile)`
  // would silently fail open against (ENOTDIR), and exactly the shape
  // this project's own pipeline worktree runs use. Shallow state lives in
  // the shared git-common dir, so a worktree added off a shallow clone is
  // shallow too, which lets the same race shape as the plain-clone test
  // above exercise the lock's git-common-dir resolution specifically.
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const worktreeDir = path.join(tmpDir('worktree'), 'wt');
  git(dir, ['worktree', 'add', '-q', '--detach', worktreeDir, 'HEAD']);
  assert.ok(fs.statSync(path.join(worktreeDir, '.git')).isFile(),
    'sanity check: a linked worktree\'s .git must be a file, not a directory');

  const counterPath = path.join(tmpDir('counter'), 'fetch-count.txt');
  fs.writeFileSync(counterPath, '');
  const commitRefModule = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'docs-health', 'commit-ref.js');

  const raceWorkerScript = (hash) => `
    const fs = require('fs');
    const { verifyCommits, defaultGit } = require(${JSON.stringify(commitRefModule)});
    function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
    const countingGit = (args, opts) => {
      if (args.includes('fetch')) {
        fs.appendFileSync(${JSON.stringify(counterPath)}, '1\\n');
        sleepSync(300);
      }
      return defaultGit(args, opts);
    };
    const r = verifyCommits({
      root: ${JSON.stringify(worktreeDir)}, hashes: [${JSON.stringify(hash)}],
      integrationBranch: 'main', git: countingGit,
    });
    process.stdout.write(JSON.stringify(r));
  `;

  function runChild(hash) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', raceWorkerScript(hash)]);
      let stdout = ''; let stderr = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('close', (code) => (code === 0
        ? resolve(JSON.parse(stdout))
        : reject(new Error(`child exited ${code}: ${stderr}`))));
      p.on('error', reject);
    });
  }

  const [resultA, resultB] = await Promise.all([runChild(origin.root), runChild(origin.sideOnly)]);

  const fetchCount = fs.readFileSync(counterPath, 'utf8').split('\n').filter(Boolean).length;
  assert.strictEqual(fetchCount, 1, 'exactly one real git fetch --unshallow must be issued across both racing processes against the linked worktree');
  assert.deepStrictEqual(resultA.commits, [{ input: origin.root, outcome: 'reachable', sha: origin.root }]);
  assert.deepStrictEqual(resultB.commits, [{ input: origin.sideOnly, outcome: 'exists-unreachable', sha: origin.sideOnly }]);
  assert.strictEqual(resultA.shallow.deepened, true);
  assert.strictEqual(resultB.shallow.deepened, true);
});

test('a cached deepen-timeout is not retried with a fresh fetch on a second call in the same process (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  let fetchCalls = 0;
  const timeoutGit = (args, opts) => {
    if (args.includes('fetch')) {
      fetchCalls += 1;
      const err = new Error('git fetch --unshallow timed out');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    return defaultGit(args, opts);
  };
  const first = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: timeoutGit });
  assert.strictEqual(outcomeOf(first, origin.third), 'unverifiable');
  assert.strictEqual(fetchCalls, 1);

  const second = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: timeoutGit });
  assert.strictEqual(outcomeOf(second, origin.third), 'unverifiable');
  assert.strictEqual(fetchCalls, 1, 'the cached timeout must not trigger a second real fetch attempt');
});

test('the deepen lock is released even when the fetch throws, leaving the repo lockable immediately after (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const failingGit = (args, opts) => {
    if (args.includes('fetch')) { const err = new Error('network unreachable'); err.status = 1; throw err; }
    return defaultGit(args, opts);
  };
  const r = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: failingGit });
  assert.strictEqual(outcomeOf(r, origin.third), 'unverifiable');

  const { acquireLock, releaseLock } = require('../../../plugin/bin/lib/file-lock');
  const lockPath = path.join(dir, '.git', DEEPEN_LOCK_FILENAME);
  const held = acquireLock(lockPath);
  assert.notStrictEqual(held, null, 'the lock must be free immediately after an ordinary (non-timeout) fetch failure');
  releaseLock(held);
});

test('CLAUDE_TWEAKS_LOCK_WAIT_MS is restored after a deepen attempt, even on failure (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const failingGit = (args, opts) => {
    if (args.includes('fetch')) { const err = new Error('network unreachable'); err.status = 1; throw err; }
    return defaultGit(args, opts);
  };
  const prev = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '42';
  try {
    verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: failingGit });
    assert.strictEqual(process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS, '42');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
    else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prev;
  }
});

test('a non-timeout fetch failure does not poison the cache -- a later call still attempts a fresh fetch (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  let fetchCalls = 0;
  const flakyGit = (args, opts) => {
    if (args.includes('fetch')) {
      fetchCalls += 1;
      if (fetchCalls === 1) { const err = new Error('network unreachable'); err.status = 1; throw err; }
    }
    return defaultGit(args, opts);
  };
  const first = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: flakyGit });
  assert.strictEqual(outcomeOf(first, origin.third), 'unverifiable');
  assert.strictEqual(fetchCalls, 1);

  const second = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: flakyGit });
  assert.strictEqual(outcomeOf(second, origin.third), 'reachable');
  assert.strictEqual(fetchCalls, 2, 'a non-timeout failure must not be cached -- the second call retries for real');
});

test('the deepen-timeout cache is keyed per repo root -- a cached timeout for one repo does not block a different one (#2988)', () => {
  const originA = makeOriginRepo();
  const dirA = cloneOf(originA, { depth: 1 });
  const originB = makeOriginRepo();
  const dirB = cloneOf(originB, { depth: 1 });
  const timeoutGit = (args, opts) => {
    if (args.includes('fetch')) { const err = new Error('timed out'); err.code = 'ETIMEDOUT'; throw err; }
    return defaultGit(args, opts);
  };
  const a1 = verifyCommits({ root: dirA, hashes: [originA.third], integrationBranch: 'main', git: timeoutGit });
  assert.strictEqual(outcomeOf(a1, originA.third), 'unverifiable');

  const b1 = verifyCommits({ root: dirB, hashes: [originB.third], integrationBranch: 'main', git: defaultGit });
  assert.strictEqual(outcomeOf(b1, originB.third), 'reachable', "repo B must still deepen normally -- its own cache entry is independent of repo A's");
});

test('a timeout marker written by a prior process is honored by a fresh process, with zero real fetch calls (#2988 whole-branch review finding)', async () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  // Simulate a PRIOR process having already recorded a confirmed timeout --
  // this is exactly what a real docs-health run under --budget > 1 needs:
  // the real caller (plugin/bin/docs-health.js's verify-commit command) is
  // invoked as a fresh process per citation, so only a cross-process marker
  // (not an in-process cache) can actually help the real workload.
  const markerPath = path.join(dir, '.git', TIMEOUT_MARKER_FILENAME);
  fs.writeFileSync(markerPath, JSON.stringify({ at: Date.now(), reason: 'simulated prior timeout' }));

  const counterPath = path.join(tmpDir('counter'), 'fetch-count.txt');
  fs.writeFileSync(counterPath, '');
  const commitRefModule = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'docs-health', 'commit-ref.js');
  const workerScript = `
    const fs = require('fs');
    const { verifyCommits, defaultGit } = require(${JSON.stringify(commitRefModule)});
    const countingGit = (args, opts) => {
      if (args.includes('fetch')) fs.appendFileSync(${JSON.stringify(counterPath)}, '1\\n');
      return defaultGit(args, opts);
    };
    const r = verifyCommits({
      root: ${JSON.stringify(dir)}, hashes: [${JSON.stringify(origin.third)}],
      integrationBranch: 'main', git: countingGit,
    });
    process.stdout.write(JSON.stringify(r));
  `;
  const child = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', workerScript]);
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`child exited ${code}: ${stderr}`))));
    p.on('error', reject);
  });

  const fetchCount = fs.readFileSync(counterPath, 'utf8').split('\n').filter(Boolean).length;
  assert.strictEqual(fetchCount, 0, "a fresh process must honor a prior process's timeout marker without attempting its own fetch");
  assert.strictEqual(outcomeOf(child, origin.third), 'unverifiable');
  assert.match(child.commits[0].reason, /simulated prior timeout/);
});

test('an expired timeout marker is ignored -- a stale cached failure does not block a fresh attempt (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const markerPath = path.join(dir, '.git', TIMEOUT_MARKER_FILENAME);
  const past = Date.now() - (31 * 60 * 1000); // 31 minutes ago -- just past the 30-minute TTL
  fs.writeFileSync(markerPath, JSON.stringify({ at: past, reason: 'stale simulated timeout' }));
  const r = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main' });
  assert.strictEqual(outcomeOf(r, origin.third), 'reachable');
});
