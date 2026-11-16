// tests/hooks-pre-tool-use-forge-memo.test.js
// The #4830 forge-degrade memo half of the PreToolUse suite, split out of
// tests/hooks-pre-tool-use.test.js so CI can run the two in parallel shards.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');
const { STUB_SKIP } = require('./helpers/path-stub');
const { fakeGh } = require('./helpers/fake-gh');
const { withoutGhTimeoutEnv, unpinnedRepoWithOrigin } = require('./helpers/pre-tool-use');

test('FORGE_DEGRADE_MEMO_TTL_MS is 60 s (#4830)', () => {
  const { FORGE_DEGRADE_MEMO_TTL_MS } = require('../plugin/bin/lib/policy-schema');
  assert.strictEqual(FORGE_DEGRADE_MEMO_TTL_MS, 60000);
});

test('isFreshForgeDegradeMemo: fresh only for a finite past timestamp younger than the TTL (#4830)', () => {
  const f = pre.isFreshForgeDegradeMemo;
  assert.strictEqual(f(1000, 1000, 60000), true);        // age 0
  assert.strictEqual(f(1000, 60999, 60000), true);       // age TTL-1
  assert.strictEqual(f(1000, 61000, 60000), false);      // age === TTL -> expired
  assert.strictEqual(f(5000, 1000, 60000), false);       // future
  for (const bad of [undefined, null, '1000', NaN, Infinity, {}]) assert.strictEqual(f(bad, 1000, 60000), false);
});

// --- #4830: opt-in run-scoped degrade memo in resolveRunPinnedIntegrationModel ---

const MEMO_T = 1700000000000;
const MEMO_TTL = 60000;
const memoRunDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4830-run-'));
const memoState = (run) => JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));

test('#4830 memo: a degrade stamps the memo; a second call inside the TTL spawns no gh and reports a memoized degrade', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  const gh = fakeGh({ first: 'hang' });
  const seen = [];
  try {
    withoutGhTimeoutEnv(() => {
      const opts = (now) => ({ timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now, onDegrade: (d) => seen.push(d) });
      assert.strictEqual(pre.resolveRunPinnedIntegrationModel(repo, run, opts(() => MEMO_T)), 'local-merge');
      assert.strictEqual(gh.count(), 2);
      assert.strictEqual(memoState(run).forgeDegradedAt, MEMO_T);
      assert.strictEqual(seen[0].reason, 'timeout');
      assert.strictEqual(pre.resolveRunPinnedIntegrationModel(repo, run, opts(() => MEMO_T + 59999)), 'local-merge');
      assert.strictEqual(gh.count(), 2);
      assert.deepStrictEqual(seen[1], { memoized: true, degradedAt: MEMO_T });
    });
  } finally {
    gh.restore();
  }
});

test('#4830 memo: an expired memo re-probes and refreshes the stamp', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ forgeDegradedAt: MEMO_T }));
  const gh = fakeGh({ first: 'hang' });
  try {
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, run, { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T + MEMO_TTL });
      assert.strictEqual(result, 'local-merge');
      assert.strictEqual(gh.count(), 2);
      assert.strictEqual(memoState(run).forgeDegradedAt, MEMO_T + MEMO_TTL);
    });
  } finally {
    gh.restore();
  }
});

test('#4830 memo: a future memo and a numeric-string memo both probe, then re-stamp', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const gh = fakeGh({ first: 'hang' });
  try {
    withoutGhTimeoutEnv(() => {
      const opts = { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T };
      const futureRun = memoRunDir();
      fs.writeFileSync(path.join(futureRun, 'run-state.json'), JSON.stringify({ forgeDegradedAt: MEMO_T + 1000 }));
      pre.resolveRunPinnedIntegrationModel(repo, futureRun, opts);
      assert.strictEqual(gh.count(), 2);
      assert.strictEqual(memoState(futureRun).forgeDegradedAt, MEMO_T);
      // A numeric string coerces under `-`, so only the isFinite clause rejects it.
      const stringRun = memoRunDir();
      fs.writeFileSync(path.join(stringRun, 'run-state.json'), JSON.stringify({ forgeDegradedAt: String(MEMO_T) }));
      pre.resolveRunPinnedIntegrationModel(repo, stringRun, opts);
      assert.strictEqual(gh.count(), 4);
      assert.strictEqual(memoState(stringRun).forgeDegradedAt, MEMO_T);
    });
  } finally {
    gh.restore();
  }
});

test('#4830 memo: a garbled run-state.json probes and does not throw', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  fs.writeFileSync(path.join(run, 'run-state.json'), 'not json');
  const gh = fakeGh({ first: 'hang' });
  try {
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, run, { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T });
      assert.strictEqual(result, 'local-merge');
      assert.strictEqual(gh.count(), 2);
      assert.strictEqual(memoState(run).forgeDegradedAt, MEMO_T);
    });
  } finally {
    gh.restore();
  }
});

test('#4830 memo: a clean detection clears a stale memo', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ forgeDegradedAt: MEMO_T - MEMO_TTL }));
  const gh = fakeGh({ first: 'fail' });
  const seen = [];
  try {
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, run, { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T, onDegrade: (d) => seen.push(d) });
      assert.strictEqual(result, 'local-merge');
      assert.strictEqual(memoState(run).forgeDegradedAt, null);
      assert.deepStrictEqual(seen, []);
    });
  } finally {
    gh.restore();
  }
});

test('#4830 memo: a run-config pin ignores a fresh memo', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  fs.writeFileSync(path.join(run, 'config.yml'), 'integration-model: pr-first\n');
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ forgeDegradedAt: MEMO_T }));
  const gh = fakeGh({ first: 'hang' });
  const seen = [];
  try {
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, run, { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T, onDegrade: (d) => seen.push(d) });
      assert.strictEqual(result, 'pr-first');
      assert.strictEqual(gh.count(), 0);
      assert.deepStrictEqual(seen, []);
    });
  } finally {
    gh.restore();
  }
});

test('#4830 memo: without degradeMemoTtlMs (precondition.js call shape) a fresh memo is ignored and nothing is written', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  const stateFile = path.join(run, 'run-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ forgeDegradedAt: MEMO_T }));
  const before = fs.readFileSync(stateFile);
  const gh = fakeGh({ first: 'hang' });
  try {
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, run, { timeoutMs: 1000, onDegrade: () => {}, now: () => MEMO_T });
      assert.strictEqual(result, 'local-merge');
      assert.strictEqual(gh.count(), 2);
      assert.ok(fs.readFileSync(stateFile).equals(before), 'run-state.json must be byte-identical');
    });
  } finally {
    gh.restore();
  }
});

test('#4830 memo: a throwing onDegrade on a memo hit neither throws nor spawns gh', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ forgeDegradedAt: MEMO_T }));
  const gh = fakeGh({ first: 'hang' });
  try {
    withoutGhTimeoutEnv(() => {
      const before = gh.count();
      const result = pre.resolveRunPinnedIntegrationModel(repo, run, {
        timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T, onDegrade: () => { throw new Error('reporter broke'); },
      });
      assert.strictEqual(result, 'local-merge');
      assert.strictEqual(gh.count(), before);
    });
  } finally {
    gh.restore();
  }
});

// Regression guard (pre-change code already writes nothing). Red against the
// mutation that replaces the guarded clear with an unconditional plain patch,
// `else ctxLib.writeRunState(runDir, { forgeDegradedAt: null })`.
test('#4830 memo: a clean detection with no run-state.json writes nothing', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const run = memoRunDir();
  const gh = fakeGh({ first: 'fail' });
  try {
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, run, { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T });
      assert.strictEqual(result, 'local-merge');
    });
    assert.strictEqual(fs.existsSync(path.join(run, 'run-state.json')), false);
  } finally {
    gh.restore();
  }
});

test('#4830 memo: a null runDir with the option set probes and writes nothing', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4830-cwd-'));
  const gh = fakeGh({ first: 'hang' });
  const cwd = process.cwd();
  try {
    process.chdir(scratch);
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, null, { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T });
      assert.strictEqual(result, 'local-merge');
      assert.strictEqual(gh.count(), 2);
    });
    assert.strictEqual(fs.existsSync(path.join(scratch, 'run-state.json')), false);
  } finally {
    process.chdir(cwd);
    gh.restore();
  }
});

test('#4830 memo: an empty runDir with the option set probes and writes nothing', { skip: STUB_SKIP }, () => {
  const repo = unpinnedRepoWithOrigin();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4830-cwd-'));
  const gh = fakeGh({ first: 'hang' });
  const cwd = process.cwd();
  try {
    process.chdir(scratch);
    withoutGhTimeoutEnv(() => {
      const result = pre.resolveRunPinnedIntegrationModel(repo, '', { timeoutMs: 1000, degradeMemoTtlMs: MEMO_TTL, now: () => MEMO_T });
      assert.strictEqual(result, 'local-merge');
      assert.strictEqual(gh.count(), 2);
    });
    assert.strictEqual(fs.existsSync(path.join(scratch, 'run-state.json')), false);
  } finally {
    process.chdir(cwd);
    gh.restore();
  }
});
