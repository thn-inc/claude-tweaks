'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const { runClassified, runClassifiedAsync, isPathContained } = require('../../plugin/bin/lib/shared-primitives');
const path = require('path');

// A synthetic execFileSync/execFile timeout-kill error — the exact shape
// bin/lib/hooks/git-exec.js's own tests already use to force this branch
// deterministically (killed + SIGTERM), which is also what
// shared-primitives.js's isTimeoutError checks for.
function timeoutError(message = 'mock timeout') {
  const err = new Error(message);
  err.killed = true;
  err.signal = 'SIGTERM';
  return err;
}

test('runClassified: returns fn()\'s value on success', () => {
  const result = runClassified(() => 'ok', () => 'unused');
  assert.strictEqual(result, 'ok');
});

test('runClassified: returns mapError(err) when fn() throws', () => {
  const err = new Error('boom');
  const result = runClassified(
    () => { throw err; },
    (caught) => ({ caught }),
  );
  assert.deepStrictEqual(result, { caught: err });
});

test('runClassified: mapError never runs on the success path', () => {
  let mapErrorCalls = 0;
  runClassified(() => 'ok', () => { mapErrorCalls += 1; return 'unused'; });
  assert.strictEqual(mapErrorCalls, 0);
});

// #2567: an opt-in single automatic retry, gated specifically on a
// timeout-shaped error. Opt-in, not a default — retryOnTimeout defaults to
// false, so every pre-existing caller (bin/lib/hooks/git-exec.js's
// runGit/runGitAsync included) is completely unaffected unless it passes
// `{ retryOnTimeout: true }` explicitly; only the gh-calling consumers that
// opted in (release-merged.js, preflight.js, pr-state.js) get the retry.

test('runClassified: retryOnTimeout omitted (the default) -> a timeout is NOT retried, matching pre-#2567 behavior', () => {
  let calls = 0;
  const err = timeoutError();
  const result = runClassified(
    () => { calls += 1; throw err; },
    (caught) => ({ caught }),
  );
  assert.strictEqual(calls, 1, 'no opts arg means no retry, even on a timeout-shaped error');
  assert.deepStrictEqual(result, { caught: err });
});

test('runClassified: retryOnTimeout: false -> a timeout is NOT retried', () => {
  let calls = 0;
  const err = timeoutError();
  const result = runClassified(
    () => { calls += 1; throw err; },
    (caught) => ({ caught }),
    { retryOnTimeout: false },
  );
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(result, { caught: err });
});

test('runClassified: retryOnTimeout: true -> a timeout on the first call is retried once and returns the retry\'s success', () => {
  let calls = 0;
  const result = runClassified(
    () => {
      calls += 1;
      if (calls === 1) throw timeoutError();
      return 'ok-on-retry';
    },
    () => 'unused',
    { retryOnTimeout: true },
  );
  assert.strictEqual(result, 'ok-on-retry');
  assert.strictEqual(calls, 2, 'fn() must be called exactly twice: the original attempt plus one retry');
});

test('runClassified: retryOnTimeout: true -> a timeout on both attempts calls mapError with the SECOND error, not the first', () => {
  let calls = 0;
  const firstErr = timeoutError('first');
  const secondErr = timeoutError('second');
  const result = runClassified(
    () => {
      calls += 1;
      throw calls === 1 ? firstErr : secondErr;
    },
    (caught) => ({ caught }),
    { retryOnTimeout: true },
  );
  assert.strictEqual(calls, 2, 'a persistent timeout retries exactly once, never more');
  assert.deepStrictEqual(result, { caught: secondErr });
});

test('runClassified: retryOnTimeout: true -> a non-timeout error (a real auth failure or 404) is never retried', () => {
  let calls = 0;
  const err = new Error('HTTP 404 Not Found');
  const result = runClassified(
    () => { calls += 1; throw err; },
    (caught) => ({ caught }),
    { retryOnTimeout: true },
  );
  assert.strictEqual(calls, 1, 'a non-timeout failure must reach mapError on the first attempt, no retry');
  assert.deepStrictEqual(result, { caught: err });
});

// The concrete scenario release-merged.js's ghApi/ghApiAsync rely on
// (Deliverable 4): a call that only failed because it timed out once should
// never reach a caller's "network-failure" classification — the retry runs
// before that classification is ever computed, since mapError is only
// invoked after both attempts are exhausted.
test('runClassified: retryOnTimeout: true -> a retry-recovered call never reaches a network-failure-shaped mapError', () => {
  let calls = 0;
  const classifyAsNetworkFailure = () => ({ stdout: null, failure: 'network-failure' });
  const result = runClassified(
    () => {
      calls += 1;
      if (calls === 1) throw timeoutError();
      return { stdout: 'success-payload', failure: null };
    },
    classifyAsNetworkFailure,
    { retryOnTimeout: true },
  );
  assert.deepStrictEqual(result, { stdout: 'success-payload', failure: null });
});

test('runClassifiedAsync: returns fn()\'s resolved value on success', async () => {
  const result = await runClassifiedAsync(async () => 'ok', () => 'unused');
  assert.strictEqual(result, 'ok');
});

test('runClassifiedAsync: returns mapError(err) when fn() rejects', async () => {
  const err = new Error('boom');
  const result = await runClassifiedAsync(
    async () => { throw err; },
    (caught) => ({ caught }),
  );
  assert.deepStrictEqual(result, { caught: err });
});

test('runClassifiedAsync: mapError never runs on the success path', async () => {
  let mapErrorCalls = 0;
  await runClassifiedAsync(async () => 'ok', () => { mapErrorCalls += 1; return 'unused'; });
  assert.strictEqual(mapErrorCalls, 0);
});

// #2567: same opt-in one-retry-on-timeout contract as runClassified above, awaited.

test('runClassifiedAsync: retryOnTimeout omitted (the default) -> a timeout is NOT retried, matching pre-#2567 behavior', async () => {
  let calls = 0;
  const err = timeoutError();
  const result = await runClassifiedAsync(
    async () => { calls += 1; throw err; },
    (caught) => ({ caught }),
  );
  assert.strictEqual(calls, 1, 'no opts arg means no retry, even on a timeout-shaped error');
  assert.deepStrictEqual(result, { caught: err });
});

test('runClassifiedAsync: retryOnTimeout: true -> a timeout on the first call is retried once and returns the retry\'s success', async () => {
  let calls = 0;
  const result = await runClassifiedAsync(
    async () => {
      calls += 1;
      if (calls === 1) throw timeoutError();
      return 'ok-on-retry';
    },
    () => 'unused',
    { retryOnTimeout: true },
  );
  assert.strictEqual(result, 'ok-on-retry');
  assert.strictEqual(calls, 2, 'fn() must be called exactly twice: the original attempt plus one retry');
});

test('runClassifiedAsync: retryOnTimeout: true -> a timeout on both attempts calls mapError with the SECOND error, not the first', async () => {
  let calls = 0;
  const firstErr = timeoutError('first');
  const secondErr = timeoutError('second');
  const result = await runClassifiedAsync(
    async () => {
      calls += 1;
      throw calls === 1 ? firstErr : secondErr;
    },
    (caught) => ({ caught }),
    { retryOnTimeout: true },
  );
  assert.strictEqual(calls, 2, 'a persistent timeout retries exactly once, never more');
  assert.deepStrictEqual(result, { caught: secondErr });
});

test('runClassifiedAsync: retryOnTimeout: true -> a non-timeout error (a real auth failure or 404) is never retried', async () => {
  let calls = 0;
  const err = new Error('HTTP 404 Not Found');
  const result = await runClassifiedAsync(
    async () => { calls += 1; throw err; },
    (caught) => ({ caught }),
    { retryOnTimeout: true },
  );
  assert.strictEqual(calls, 1, 'a non-timeout failure must reach mapError on the first attempt, no retry');
  assert.deepStrictEqual(result, { caught: err });
});

test('isPathContained: a strict descendant is contained', () => {
  const root = path.join('a', 'b');
  assert.equal(isPathContained(path.join(root, 'c'), root), true);
});

test('isPathContained: an unrelated sibling path is not contained', () => {
  const root = path.join('a', 'b');
  assert.equal(isPathContained(path.join('a', 'bee'), root), false);
});

test('isPathContained: the root itself is NOT contained by default (orEqual defaults false)', () => {
  const root = path.join('a', 'b');
  assert.equal(isPathContained(root, root), false);
});

test('isPathContained: the root itself IS contained when orEqual is true', () => {
  const root = path.join('a', 'b');
  assert.equal(isPathContained(root, root), false);
  assert.equal(isPathContained(root, root, { orEqual: true }), true);
});

test('isPathContained: a strict descendant is contained regardless of orEqual', () => {
  const root = path.join('a', 'b');
  assert.equal(isPathContained(path.join(root, 'c'), root, { orEqual: true }), true);
});

// GH_TIMEOUT_MS resolution (#2567): env var > `gh-timeout-ms` policy key >
// hard-coded 5000 default, resolved once per process. GH_TIMEOUT_MS is a
// getter (module-load-time destructuring in a consumer triggers it once),
// so each test here evicts the require cache and chdir's into a fresh temp
// dir before re-requiring — the same "evict, mutate, re-require" pattern
// tests/hooks-git-exec.test.js's own windowsHide test already uses to
// observe a module's own module-level state fresh.
const MODULE_PATH = require.resolve('../../plugin/bin/lib/shared-primitives');

function freshGhTimeoutMs() {
  delete require.cache[MODULE_PATH];
  // eslint-disable-next-line global-require
  return require('../../plugin/bin/lib/shared-primitives').GH_TIMEOUT_MS;
}

function withTempCwd(fn) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-gh-timeout-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    fn(dir);
  } finally {
    process.chdir(originalCwd);
    delete require.cache[MODULE_PATH];
  }
}

function writePolicyFile(dir, content) {
  const policyDir = path.join(dir, '.claude-tweaks');
  fs.mkdirSync(policyDir, { recursive: true });
  fs.writeFileSync(path.join(policyDir, 'policy.yml'), content);
}

test('GH_TIMEOUT_MS: no env override and no policy key -> unchanged 5000 default', () => {
  withTempCwd(() => {
    const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    try {
      assert.strictEqual(freshGhTimeoutMs(), 5000);
    } finally {
      if (prior !== undefined) process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
    }
  });
});

test('GH_TIMEOUT_MS: gh-timeout-ms policy key raises the effective timeout', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 10000\n');
    const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    try {
      assert.strictEqual(freshGhTimeoutMs(), 10000);
    } finally {
      if (prior !== undefined) process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
    }
  });
});

test('GH_TIMEOUT_MS: CLAUDE_TWEAKS_GH_TIMEOUT_MS env override takes precedence over the policy key', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 10000\n');
    const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = '20000';
    try {
      assert.strictEqual(freshGhTimeoutMs(), 20000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
    }
  });
});

test('GH_TIMEOUT_MS: a non-numeric env override falls through to the policy key', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 8000\n');
    const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = 'not-a-number';
    try {
      assert.strictEqual(freshGhTimeoutMs(), 8000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
    }
  });
});

test('GH_TIMEOUT_MS: an out-of-range policy value falls back to the 5000 default', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 999999\n'); // over the schema's 60000 max
    const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    try {
      assert.strictEqual(freshGhTimeoutMs(), 5000);
    } finally {
      if (prior !== undefined) process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
    }
  });
});
