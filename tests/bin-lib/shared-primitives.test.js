'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../helpers/tmp-dir');
const os = require('os');
const { runClassified, runClassifiedAsync, isPathContained, toPosix, relativeDisplayId, ghTimeoutMsAt } = require('../../plugin/bin/lib/shared-primitives');
const path = require('path');
const { captureExecTimeouts, evictModules, isolateExecBounds } = require('../helpers/gh-timeout-probe');

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
  const dir = scratchDir('ct-gh-timeout-', { realpath: true });
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

// Review finding (#2567): the env override originally had no upper bound at
// all — a positive integer of any size was accepted outright, unlike the
// policy key, which the schema already caps at 60000. An operator typo (an
// extra zero on CLAUDE_TWEAKS_GH_TIMEOUT_MS) would have silently hung every
// `gh` call for minutes instead of falling back to a sane value. Fixed to
// share the same [min, max] the policy key already enforces.
test('GH_TIMEOUT_MS: an out-of-range env override falls through to the policy key, not applied unbounded', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 8000\n');
    const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = '999999'; // over the schema's 60000 max
    try {
      assert.strictEqual(freshGhTimeoutMs(), 8000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
    }
  });
});

test('GH_TIMEOUT_MS: an out-of-range env override with no policy set falls through to the 5000 default', () => {
  withTempCwd(() => {
    const prior = process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = '500'; // under the schema's 1000 min
    try {
      assert.strictEqual(freshGhTimeoutMs(), 5000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = prior;
    }
  });
});

// ghTimeoutMsAt (#4856): the same ladder as the getter above, but root- and
// env-parameterised and never memoized.
test('ghTimeoutMsAt: policy 7000 with an empty env -> 7000; env override wins -> 12000', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 7000\n');
    assert.strictEqual(ghTimeoutMsAt(dir, { env: {} }), 7000);
    assert.strictEqual(ghTimeoutMsAt(dir, { env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: '12000' } }), 12000);
  });
});

test('ghTimeoutMsAt: a policy-less root accepts scientific and padded env integers', () => {
  withTempCwd((dir) => {
    assert.strictEqual(ghTimeoutMsAt(dir, { env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: '9e3' } }), 9000);
    assert.strictEqual(ghTimeoutMsAt(dir, { env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: ' 9000' } }), 9000);
  });
});

test('ghTimeoutMsAt: invalid env values fall through to the policy value', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 7000\n');
    for (const bad of ['abc', '0', '90000']) {
      assert.strictEqual(ghTimeoutMsAt(dir, { env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: bad } }), 7000, bad);
    }
  });
});

test('ghTimeoutMsAt: a non-string repoRoot has no policy file and resolves env, then 5000', () => {
  withTempCwd((dir) => {
    // A cwd policy that must not be read: a non-string root never falls back to the cwd.
    writePolicyFile(dir, 'gh-timeout-ms: 7000\n');
    for (const root of [undefined, null, 42]) {
      assert.strictEqual(ghTimeoutMsAt(root, { env: {} }), 5000, String(root));
      assert.strictEqual(ghTimeoutMsAt(root, { env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: '9000' } }), 9000, String(root));
    }
  });
});

test('ghTimeoutMsAt: an empty-string repoRoot has no policy file — it never reads the cwd policy', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 7000\n');
    assert.strictEqual(ghTimeoutMsAt('', { env: {} }), 5000);
  });
});

test('ghTimeoutMsAt: an array opts.env is not an env — it reads process.env', () => {
  const key = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const prior = process.env[key];
  process.env[key] = '15000';
  try {
    withTempCwd((dir) => {
      assert.strictEqual(ghTimeoutMsAt(dir, { env: [] }), 15000);
    });
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
});

test('ghTimeoutMsAt: does not memoize across alternating roots', () => {
  withTempCwd((a) => {
    withTempCwd((b) => {
      writePolicyFile(a, 'gh-timeout-ms: 7000\n');
      writePolicyFile(b, 'gh-timeout-ms: 8000\n');
      assert.strictEqual(ghTimeoutMsAt(a, { env: {} }), 7000);
      assert.strictEqual(ghTimeoutMsAt(b, { env: {} }), 8000);
      assert.strictEqual(ghTimeoutMsAt(a, { env: {} }), 7000);
    });
  });
});

// #4492: the policy rung finds policy.yml through locatePolicyFile, so a linked
// worktree with no policy.yml of its own reads the main checkout's value.
test('ghTimeoutMsAt: a linked worktree with no policy.yml reads the main checkout\'s gh-timeout-ms', (t) => {
  // eslint-disable-next-line global-require
  const { gitRepo, linkedWorktreeOf } = require('../helpers/git-fixtures');
  const main = gitRepo();
  writePolicyFile(main, 'gh-timeout-ms: 7000\n');
  const wt = linkedWorktreeOf(main);
  t.after(() => {
    fs.rmSync(path.dirname(wt), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  });
  assert.strictEqual(fs.existsSync(path.join(wt, '.claude-tweaks', 'policy.yml')), false);
  assert.strictEqual(ghTimeoutMsAt(wt, { env: {} }), 7000);
});

test('ghTimeoutMsAt: no opts argument reads process.env, and a null opts.env does too', () => {
  const key = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const prior = process.env[key];
  process.env[key] = '15000';
  try {
    withTempCwd(() => {
      assert.strictEqual(ghTimeoutMsAt(process.cwd()), 15000);
      assert.strictEqual(ghTimeoutMsAt(process.cwd(), { env: null }), 15000);
    });
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
});

test('GH_TIMEOUT_MS getter: a throwing process.cwd still resolves env, then 5000, and never throws', () => {
  const realCwd = process.cwd;
  const key = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const prior = process.env[key];
  process.cwd = () => { throw new Error('ENOENT: deleted cwd'); };
  try {
    process.env[key] = '12000';
    assert.strictEqual(freshGhTimeoutMs(), 12000);
    delete process.env[key];
    assert.strictEqual(freshGhTimeoutMs(), 5000);
  } finally {
    process.cwd = realCwd;
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
});

// GH_BATCH_TIMEOUT_MS (#4815): max(30000, GH_TIMEOUT_MS) — the bound for one
// aliased GraphQL batch. A twin of freshGhTimeoutMs() reading the composed getter.
function freshBatchTimeoutMs() {
  delete require.cache[MODULE_PATH];
  // eslint-disable-next-line global-require
  return require('../../plugin/bin/lib/shared-primitives').GH_BATCH_TIMEOUT_MS;
}

// freshBatchTimeoutMs() with CLAUDE_TWEAKS_GH_TIMEOUT_MS set to `envValue` (unset when
// undefined), the prior value restored afterwards.
function freshBatchTimeoutMsWithEnv(envValue) {
  const key = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const prior = process.env[key];
  if (envValue === undefined) delete process.env[key];
  else process.env[key] = envValue;
  try {
    return freshBatchTimeoutMs();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

test('AC1.1: GH_BATCH_TIMEOUT_MS: no override -> the 30000 floor', () => {
  withTempCwd(() => {
    assert.strictEqual(freshBatchTimeoutMsWithEnv(undefined), 30000);
  });
});

test('AC1.1: GH_BATCH_TIMEOUT_MS: gh-timeout-ms above the floor wins', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 45000\n');
    assert.strictEqual(freshBatchTimeoutMsWithEnv(undefined), 45000);
  });
});

test('AC1.1: GH_BATCH_TIMEOUT_MS: gh-timeout-ms below the floor keeps 30000', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 8000\n');
    assert.strictEqual(freshBatchTimeoutMsWithEnv(undefined), 30000);
  });
});

test('AC1.1: GH_BATCH_TIMEOUT_MS: CLAUDE_TWEAKS_GH_TIMEOUT_MS above the floor wins', () => {
  withTempCwd(() => {
    assert.strictEqual(freshBatchTimeoutMsWithEnv('50000'), 50000);
  });
});

test('AC1.1: GH_BATCH_TIMEOUT_MS: a malformed gh-timeout-ms falls back to the 30000 floor', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'gh-timeout-ms: 999999\n'); // over the schema's 60000 max
    assert.strictEqual(freshBatchTimeoutMsWithEnv(undefined), 30000);
  });
});

test('GH_BATCH_TIMEOUT_MS is an enumerable export', () => {
  assert.ok(Object.keys(require('../../plugin/bin/lib/shared-primitives')).includes('GH_BATCH_TIMEOUT_MS'));
});

// GIT_TIMEOUT_MS resolution (#3051): same shape as GH_TIMEOUT_MS above —
// env var > `git-timeout-ms` policy key > hard-coded 30000 default.
function freshGitTimeoutMs() {
  delete require.cache[MODULE_PATH];
  // eslint-disable-next-line global-require
  return require('../../plugin/bin/lib/shared-primitives').GIT_TIMEOUT_MS;
}

test('GIT_TIMEOUT_MS: no env override and no policy key -> unchanged 30000 default', () => {
  withTempCwd(() => {
    const prior = process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    delete process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    try {
      assert.strictEqual(freshGitTimeoutMs(), 30000);
    } finally {
      if (prior !== undefined) process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = prior;
    }
  });
});

test('GIT_TIMEOUT_MS: git-timeout-ms policy key raises the effective timeout', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'git-timeout-ms: 45000\n');
    const prior = process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    delete process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    try {
      assert.strictEqual(freshGitTimeoutMs(), 45000);
    } finally {
      if (prior !== undefined) process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = prior;
    }
  });
});

test('GIT_TIMEOUT_MS: CLAUDE_TWEAKS_GIT_TIMEOUT_MS env override takes precedence over the policy key', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'git-timeout-ms: 45000\n');
    const prior = process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = '60000';
    try {
      assert.strictEqual(freshGitTimeoutMs(), 60000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = prior;
    }
  });
});

test('GIT_TIMEOUT_MS: a non-numeric env override falls through to the policy key', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'git-timeout-ms: 40000\n');
    const prior = process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = 'not-a-number';
    try {
      assert.strictEqual(freshGitTimeoutMs(), 40000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = prior;
    }
  });
});

test('GIT_TIMEOUT_MS: an out-of-range policy value falls back to the 30000 default', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'git-timeout-ms: 999999\n'); // over the schema's 120000 max
    const prior = process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    delete process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    try {
      assert.strictEqual(freshGitTimeoutMs(), 30000);
    } finally {
      if (prior !== undefined) process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = prior;
    }
  });
});

test('GIT_TIMEOUT_MS: an out-of-range env override falls through to the policy key, not applied unbounded', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'git-timeout-ms: 40000\n');
    const prior = process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = '999999'; // over the schema's 120000 max
    try {
      assert.strictEqual(freshGitTimeoutMs(), 40000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = prior;
    }
  });
});

test('GIT_TIMEOUT_MS: an out-of-range env override with no policy set falls through to the 30000 default', () => {
  withTempCwd(() => {
    const prior = process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
    process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = '500'; // under the schema's 1000 min
    try {
      assert.strictEqual(freshGitTimeoutMs(), 30000);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GIT_TIMEOUT_MS = prior;
    }
  });
});

// GIT_PUSH_TIMEOUT_MS (#4026): phase-exit.js's `git push`, which runs the consumer's
// pre-push hook — env var CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS > a 600000 (10 min) default,
// parsed by the same bounded env reader as the two keys above (bounds 1000-3600000).
function freshGitPushTimeoutMs() {
  delete require.cache[MODULE_PATH];
  // eslint-disable-next-line global-require
  return require('../../plugin/bin/lib/shared-primitives').GIT_PUSH_TIMEOUT_MS;
}

test('GIT_PUSH_TIMEOUT_MS: an in-range env override wins; unset, non-numeric or out-of-range falls to the 600000 default', () => {
  withTempCwd((dir) => {
    writePolicyFile(dir, 'git-timeout-ms: 45000\n');
    const prior = process.env.CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS;
    try {
      for (const [raw, expected] of [[undefined, 600000], ['', 600000], ['1200000', 1200000], ['1000', 1000], ['not-a-number', 600000], ['999', 600000], ['3600001', 600000]]) {
        if (raw === undefined) delete process.env.CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS;
        else process.env.CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS = raw;
        assert.strictEqual(freshGitPushTimeoutMs(), expected, String(raw));
      }
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS;
      else process.env.CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS = prior;
    }
  });
});

// isTimeoutError (#3051): now exported (previously an internal-only helper)
// so claims-git-cas.js can classify a timeout kill without re-implementing
// the ETIMEDOUT/killed/SIGTERM check.
test('isTimeoutError: is exported and recognizes a killed-by-signal error', () => {
  // eslint-disable-next-line global-require
  const { isTimeoutError } = require('../../plugin/bin/lib/shared-primitives');
  assert.equal(isTimeoutError({ killed: true, signal: 'SIGTERM' }), true);
  assert.equal(isTimeoutError(new Error('plain failure')), false);
});

test('toPosix converts a win32-separated path to forward slashes (#2767)', () => {
  assert.strictEqual(toPosix('demo\\SKILL.md', path.win32.sep), 'demo/SKILL.md');
  assert.strictEqual(toPosix('wrap-up\\a\\b.md', path.win32.sep), 'wrap-up/a/b.md');
  assert.strictEqual(toPosix('\\lead\\x', path.win32.sep), '/lead/x');
});

test('toPosix is the identity under a POSIX separator (#2767)', () => {
  assert.strictEqual(toPosix('a/b/c.md', path.posix.sep), 'a/b/c.md');
  assert.strictEqual(toPosix('a\\b', path.posix.sep), 'a\\b', 'a backslash is a filename character on POSIX');
});

test('AC1.1: relativeDisplayId joins a win32 relative path with forward slashes (#3315)', () => {
  assert.strictEqual(relativeDisplayId('C:\\repo', 'C:\\repo\\plugin\\bin\\x.js', path.win32), 'plugin/bin/x.js');
  assert.strictEqual(relativeDisplayId('C:\\repo', 'C:\\repo', path.win32), '');
});

test('relativeDisplayId is plain path.relative under path.posix (#3315)', () => {
  assert.strictEqual(relativeDisplayId('/repo', '/repo/a/b.md', path.posix), 'a/b.md');
});

// execTimeoutMsFor (#5050): the one command-to-bound map the four exec seams share —
// gh -> GH_BATCH_TIMEOUT_MS, git -> GIT_TIMEOUT_MS, anything else -> a fixed 30000.
// Each case loads shared-primitives fresh (the getters memoize per process) through
// captureExecTimeouts, which clears both bound env vars and runs from an empty temp cwd,
// so neither this checkout's policy.yml nor an ambient env value reaches it.
function execBoundsWithEnv(env) {
  let bounds;
  captureExecTimeouts({
    env,
    exercise: (setEnv) => {
      setEnv();
      // eslint-disable-next-line global-require
      const { execTimeoutMsFor } = require('../../plugin/bin/lib/shared-primitives');
      bounds = { gh: execTimeoutMsFor('gh'), git: execTimeoutMsFor('git'), node: execTimeoutMsFor('node') };
    },
  });
  return bounds;
}

test('AC7.1: execTimeoutMsFor: both keys unset -> gh, git and node all keep 30000', () => {
  assert.deepStrictEqual(execBoundsWithEnv({}), { gh: 30000, git: 30000, node: 30000 });
});

test('execTimeoutMsFor: gh env above the floor raises only the gh bound', () => {
  assert.deepStrictEqual(execBoundsWithEnv({ CLAUDE_TWEAKS_GH_TIMEOUT_MS: '45000' }), { gh: 45000, git: 30000, node: 30000 });
});

test('execTimeoutMsFor: gh env below the 30000 floor keeps gh at 30000', () => {
  assert.strictEqual(execBoundsWithEnv({ CLAUDE_TWEAKS_GH_TIMEOUT_MS: '10000' }).gh, 30000);
});

test('execTimeoutMsFor: gh env outside gh-timeout-ms bounds (65000, 500) is ignored -> gh 30000', () => {
  assert.strictEqual(execBoundsWithEnv({ CLAUDE_TWEAKS_GH_TIMEOUT_MS: '65000' }).gh, 30000);
  assert.strictEqual(execBoundsWithEnv({ CLAUDE_TWEAKS_GH_TIMEOUT_MS: '500' }).gh, 30000);
});

test('execTimeoutMsFor: git env raises only the git bound', () => {
  assert.deepStrictEqual(execBoundsWithEnv({ CLAUDE_TWEAKS_GIT_TIMEOUT_MS: '90000' }), { gh: 30000, git: 90000, node: 30000 });
});

test('execTimeoutMsFor: git env above the 120000 max is ignored -> git 30000', () => {
  assert.strictEqual(execBoundsWithEnv({ CLAUDE_TWEAKS_GIT_TIMEOUT_MS: '200000' }).git, 30000);
});

test('execTimeoutMsFor: any other command stays fixed at 30000 even with both keys raised', () => {
  const bounds = execBoundsWithEnv({ CLAUDE_TWEAKS_GH_TIMEOUT_MS: '55000', CLAUDE_TWEAKS_GIT_TIMEOUT_MS: '90000' });
  assert.deepStrictEqual(bounds, { gh: 55000, git: 90000, node: 30000 });
});

// captureExecTimeouts (#5050): the per-command probe the four seams' tests share.
test('captureExecTimeouts: records every timeout per command in spawn order; unspawned commands are []', () => {
  const cp = require('node:child_process');
  const seen = captureExecTimeouts({
    exercise: () => {
      cp.execFileSync('gh', ['api'], { timeout: 111 });
      cp.execFileSync('git', ['status'], { timeout: 222 });
      cp.execFileSync('gh', ['api'], { timeout: 333 });
    },
  });
  assert.deepStrictEqual(seen, { gh: [111, 333], git: [222], node: [] });
});

test('captureExecTimeouts: stubs the callback and promisified execFile too', async () => {
  const cp = require('node:child_process');
  const { promisify } = require('node:util');
  let cbOut;
  let asyncOut;
  const seen = captureExecTimeouts({
    reply: 'R',
    exercise: () => {
      cp.execFile('git', ['x'], { timeout: 5 }, (err, stdout) => { cbOut = stdout; });
      asyncOut = promisify(cp.execFile)('gh', ['y'], { timeout: 6 });
    },
  });
  assert.deepStrictEqual(seen, { gh: [6], git: [5], node: [] });
  assert.strictEqual(cbOut, 'R');
  assert.deepStrictEqual(await asyncOut, { stdout: 'R', stderr: '' });
});

test('captureExecTimeouts: an env value of undefined deletes the variable, never the string "undefined"', () => {
  const key = 'CT_5050_PROBE_VAR';
  const prior = process.env[key];
  process.env[key] = 'before';
  let during;
  try {
    captureExecTimeouts({ env: { [key]: undefined }, exercise: (setEnv) => { setEnv(); during = process.env[key]; } });
    assert.strictEqual(during, undefined);
    assert.strictEqual(process.env[key], 'before', 'restored after the probe');
  } finally {
    if (prior === undefined) delete process.env[key]; else process.env[key] = prior;
  }
});

test('captureExecTimeouts: an ambient git bound does not leak into a gh-only probe, and is restored', () => {
  const gitKey = 'CLAUDE_TWEAKS_GIT_TIMEOUT_MS';
  const ghKey = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const priorGit = process.env[gitKey];
  const priorGh = process.env[ghKey];
  process.env[gitKey] = '90000';
  process.env[ghKey] = '40000';
  let seenGitInside;
  let ghBound;
  try {
    captureExecTimeouts({
      env: { [ghKey]: '45000' },
      exercise: (setEnv) => {
        setEnv();
        seenGitInside = process.env[gitKey];
        // eslint-disable-next-line global-require
        const { execTimeoutMsFor } = require('../../plugin/bin/lib/shared-primitives');
        ghBound = { gh: execTimeoutMsFor('gh'), git: execTimeoutMsFor('git') };
      },
    });
    assert.strictEqual(seenGitInside, undefined, 'the ambient git bound was cleared for the probe');
    assert.deepStrictEqual(ghBound, { gh: 45000, git: 30000 });
    assert.strictEqual(process.env[gitKey], '90000');
    assert.strictEqual(process.env[ghKey], '40000');
  } finally {
    if (priorGit === undefined) delete process.env[gitKey]; else process.env[gitKey] = priorGit;
    if (priorGh === undefined) delete process.env[ghKey]; else process.env[ghKey] = priorGh;
  }
});

test('captureExecTimeouts: child_process is restored and shared-primitives is evicted from the require cache', () => {
  const cp = require('node:child_process');
  const { execFileSync, execFile } = cp;
  captureExecTimeouts({ modulePaths: [], exercise: () => { require('../../plugin/bin/lib/shared-primitives'); } });
  assert.strictEqual(cp.execFileSync, execFileSync);
  assert.strictEqual(cp.execFile, execFile);
  assert.strictEqual(require.cache[MODULE_PATH], undefined, 'shared-primitives was evicted after the probe');
});

test('isolateExecBounds: clears both bound keys and the cwd for the call, then restores them, for a sync throw and an async reject alike', async () => {
  const ghKey = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const gitKey = 'CLAUDE_TWEAKS_GIT_TIMEOUT_MS';
  const priorGh = process.env[ghKey];
  const priorGit = process.env[gitKey];
  const cwdBefore = process.cwd();
  process.env[ghKey] = '40000';
  process.env[gitKey] = '90000';
  try {
    let inside;
    isolateExecBounds([], () => { inside = { gh: process.env[ghKey], git: process.env[gitKey], cwd: process.cwd() }; });
    assert.deepStrictEqual({ gh: inside.gh, git: inside.git }, { gh: undefined, git: undefined });
    assert.notStrictEqual(inside.cwd, cwdBefore, 'ran from an empty temp cwd');
    assert.deepStrictEqual({ gh: process.env[ghKey], git: process.env[gitKey], cwd: process.cwd() }, { gh: '40000', git: '90000', cwd: cwdBefore });
    assert.throws(() => isolateExecBounds([], () => { throw new Error('sync boom'); }), /sync boom/);
    assert.strictEqual(process.env[ghKey], '40000', 'restored after a throw');
    assert.strictEqual(process.cwd(), cwdBefore);
    await assert.rejects(isolateExecBounds([], async () => { throw new Error('async boom'); }), /async boom/);
    assert.strictEqual(process.env[gitKey], '90000', 'restored after a reject');
    assert.strictEqual(process.cwd(), cwdBefore);
  } finally {
    if (priorGh === undefined) delete process.env[ghKey]; else process.env[ghKey] = priorGh;
    if (priorGit === undefined) delete process.env[gitKey]; else process.env[gitKey] = priorGit;
  }
});

test('evictModules: drops the named modules and shared-primitives from the require cache', () => {
  // eslint-disable-next-line global-require
  require('../../plugin/bin/lib/shared-primitives');
  const probePath = require.resolve('../helpers/gh-timeout-probe');
  evictModules([probePath]);
  assert.strictEqual(require.cache[MODULE_PATH], undefined);
  assert.strictEqual(require.cache[probePath], undefined);
});
