// tests/integration-model-gh-timeout.test.js
// Second half of the gh timeout ladder tests split out of tests/integration-model.test.js
// so CI can run the two halves on separate shards.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectIntegrationModel } = require('../plugin/bin/lib/policy-schema');
const { STUB_SKIP } = require('./helpers/path-stub');
const { fakeGh } = require('./helpers/fake-gh');
const { gitRepo, GH_REMOTE, withTimeoutEnv } = require('./helpers/integration-model');

test('detectIntegrationModel: CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000 with no policy key outlasts an 8 s gh -> pr-first (AC2.1)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: { slow: 8 } });
  try {
    withTimeoutEnv('20000', () => {
      assert.strictEqual(detectIntegrationModel(dir), 'pr-first');
    });
    assert.strictEqual(gh.count(), 1);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: timeout then non-zero exit on retry -> degraded local-merge, two invocations, one degrade (AC14.1, AC14.2)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: 'hang', rest: 'fail' });
  const seen = [];
  try {
    withTimeoutEnv(undefined, () => {
      assert.strictEqual(detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }), 'local-merge');
    });
    assert.strictEqual(gh.count(), 2);
    assert.deepStrictEqual(seen, [{ reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 }]);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: a throwing onDegrade never escapes -> local-merge', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: 'hang' });
  try {
    withTimeoutEnv(undefined, () => {
      const result = detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: () => { throw new Error('boom'); } });
      assert.strictEqual(result, 'local-merge');
    });
    assert.strictEqual(gh.count(), 2);
  } finally {
    gh.restore();
  }
});
