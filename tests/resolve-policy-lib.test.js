// tests/resolve-policy-lib.test.js — focused unit tests for
// bin/lib/policy-schema.js's resolvePolicyKeys (#329). Inline string fixtures
// only: never reads this repo's live .claude-tweaks/policy.yml (IL-80 — a test
// pinned to live production content is a scheduled failure).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolvePolicyKeys, parseFlatLines } = require('../plugin/bin/lib/policy-schema');

test('parseFlatLines is exported (Task 2 wrappers consume it)', () => {
  assert.strictEqual(typeof parseFlatLines, 'function');
  assert.deepStrictEqual(parseFlatLines('tidy-aggressiveness: moderate # note\n'), {
    'tidy-aggressiveness': 'moderate',
  });
});

test('returns a plain object keyed by requested name, never an array', () => {
  const result = resolvePolicyKeys(['autonomy'], { policyRaw: null, runConfigRaw: null });
  assert.ok(!Array.isArray(result), 'must be a plain object — array-attached properties are dropped by JSON.stringify (IL-121)');
  assert.deepStrictEqual(Object.keys(result), ['autonomy']);
});

test('health-open-cap is schema-registered — default 10, configured value wins (#330 gap fix)', () => {
  const unset = resolvePolicyKeys(['health-open-cap'], { policyRaw: null });
  assert.deepStrictEqual(unset['health-open-cap'], { value: 10, source: 'default' });
  const set = resolvePolicyKeys(['health-open-cap'], { policyRaw: 'health-open-cap: 25\n' });
  assert.deepStrictEqual(set['health-open-cap'], { value: 25, source: 'policy' });
});

test('dispatch-group-size-guard is schema-registered — default 10, configured value wins', () => {
  const unset = resolvePolicyKeys(['dispatch-group-size-guard'], { policyRaw: null });
  assert.deepStrictEqual(unset['dispatch-group-size-guard'], { value: 10, source: 'default' });
  const set = resolvePolicyKeys(['dispatch-group-size-guard'], { policyRaw: 'dispatch-group-size-guard: 25\n' });
  assert.deepStrictEqual(set['dispatch-group-size-guard'], { value: 25, source: 'policy' });
});

test('policy-source value resolves with source: "policy"', () => {
  const result = resolvePolicyKeys(['tidy-aggressiveness'], {
    policyRaw: 'tidy-aggressiveness: aggressive\n',
  });
  assert.deepStrictEqual(result['tidy-aggressiveness'], { value: 'aggressive', source: 'policy' });
});

test('known-but-unset key resolves to the schema default with source: "default" and NO invalid flag', () => {
  const result = resolvePolicyKeys(['autonomy'], { policyRaw: 'worktree-always: true\n' });
  assert.deepStrictEqual(result.autonomy, { value: 'supervised', source: 'default' });
  assert.ok(!('invalid' in result.autonomy), 'source: "default" alone means known-but-unset — invalid must be absent');
});

test('run-config overrides policy for the same key', () => {
  const result = resolvePolicyKeys(['dispatch-retry-ceiling'], {
    policyRaw: 'dispatch-retry-ceiling: 5\n',
    runConfigRaw: 'dispatch-retry-ceiling: 7\n',
  });
  assert.deepStrictEqual(result['dispatch-retry-ceiling'], { value: 7, source: 'run-config' });
});

test('runConfigRaw only overlays when it is a string — a non-string overlay contributes nothing', () => {
  const result = resolvePolicyKeys(['dispatch-retry-ceiling'], {
    policyRaw: 'dispatch-retry-ceiling: 5\n',
    runConfigRaw: undefined,
  });
  assert.deepStrictEqual(result['dispatch-retry-ceiling'], { value: 5, source: 'policy' });
});

test('alias old-key-only in policy: dispatch-pick-max-concurrent: 5 resolves dispatch-batch-size with renamed-from', () => {
  const result = resolvePolicyKeys(['dispatch-batch-size'], {
    policyRaw: 'dispatch-pick-max-concurrent: 5\n',
  });
  // Full-envelope equality: this test FAILS if renamed-from were omitted or
  // held the wrong old-key name — it asserts the field's presence AND value.
  assert.deepStrictEqual(result['dispatch-batch-size'], {
    value: 5,
    source: 'policy',
    'renamed-from': 'dispatch-pick-max-concurrent',
  });
  assert.strictEqual(typeof result['dispatch-batch-size'].value, 'number', 'migrated integer must coerce to a native number');
});

test('both old and new key in one source: new wins, NO renamed-from', () => {
  const result = resolvePolicyKeys(['dispatch-batch-size'], {
    policyRaw: 'dispatch-pick-max-concurrent: 5\ndispatch-batch-size: 2\n',
  });
  assert.deepStrictEqual(result['dispatch-batch-size'], { value: 2, source: 'policy' });
  assert.ok(!('renamed-from' in result['dispatch-batch-size']), 'a stray old key beside the new one is auditPolicy\'s business, never a renamed-from tag');
});

test('null-migrate fall-through: run-config unattended-tier: off -> autonomy default, renamed-from still tagged', () => {
  const result = resolvePolicyKeys(['autonomy'], {
    policyRaw: null,
    runConfigRaw: 'unattended-tier: off\n',
  });
  // Full-envelope equality: FAILS if renamed-from were omitted.
  assert.deepStrictEqual(result.autonomy, {
    value: 'supervised',
    source: 'default',
    'renamed-from': 'unattended-tier',
  });
});

test('non-null migrate at run-config: unattended-tier: on -> autonomy unattended, source run-config, renamed-from', () => {
  const result = resolvePolicyKeys(['autonomy'], { runConfigRaw: 'unattended-tier: on\n' });
  assert.deepStrictEqual(result.autonomy, {
    value: 'unattended',
    source: 'run-config',
    'renamed-from': 'unattended-tier',
  });
});

test('null-migrate at one source does not shadow a real value at the next', () => {
  const result = resolvePolicyKeys(['autonomy'], {
    policyRaw: 'autonomy: trusted\n',
    runConfigRaw: 'unattended-tier: off\n',
  });
  assert.deepStrictEqual(result.autonomy, { value: 'trusted', source: 'policy' }, 'policy contributed a value, so no renamed-from and no default fall-through');
});

test('malformed value resolves to the schema default with invalid: true', () => {
  const result = resolvePolicyKeys(['trust-revert-window-days'], {
    policyRaw: 'trust-revert-window-days: banana\n',
  });
  assert.deepStrictEqual(result['trust-revert-window-days'], {
    value: 14,
    source: 'default',
    invalid: true,
  });
});

test('malformed value at run-config does NOT cascade to a valid policy value', () => {
  const result = resolvePolicyKeys(['trust-revert-window-days'], {
    policyRaw: 'trust-revert-window-days: 21\n',
    runConfigRaw: 'trust-revert-window-days: banana\n',
  });
  assert.deepStrictEqual(result['trust-revert-window-days'], {
    value: 14,
    source: 'default',
    invalid: true,
  }, 'a typo must not activate a different configured value — the winning source resolves, invalid, no cascade');
});

test('unknown key yields an error entry while its sibling still resolves', () => {
  const result = resolvePolicyKeys(['made-up-lever', 'autonomy'], {
    policyRaw: 'autonomy: trusted\n',
  });
  assert.deepStrictEqual(result['made-up-lever'], { error: 'unknown-key' });
  assert.ok(!('value' in result['made-up-lever']) && !('source' in result['made-up-lever']), 'error entries carry no value/source');
  assert.deepStrictEqual(result.autonomy, { value: 'trusted', source: 'policy' });
});

test('boolean coercion: worktree-always: true resolves to native boolean true', () => {
  const result = resolvePolicyKeys(['worktree-always'], { policyRaw: 'worktree-always: true\n' });
  assert.strictEqual(result['worktree-always'].value, true);
  assert.strictEqual(result['worktree-always'].source, 'policy');
});

test('boolean coercion through the #602 alias: a worktree.always line resolves worktree-always to native boolean true with renamed-from', () => {
  const result = resolvePolicyKeys(['worktree-always'], { policyRaw: 'worktree.always: true\n' });
  assert.strictEqual(result['worktree-always'].value, true);
  assert.strictEqual(result['worktree-always'].source, 'policy');
  assert.strictEqual(result['worktree-always']['renamed-from'], 'worktree.always');
});

test('review-auto-apply-prose-exempt defaults to true (source: default) when unset', () => {
  const result = resolvePolicyKeys(['review-auto-apply-prose-exempt'], { policyRaw: null, runConfigRaw: null });
  assert.deepStrictEqual(result['review-auto-apply-prose-exempt'], { value: true, source: 'default' });
});

test('review-auto-apply-prose-exempt: false in policy.yml resolves to native boolean false', () => {
  const result = resolvePolicyKeys(['review-auto-apply-prose-exempt'], { policyRaw: 'review-auto-apply-prose-exempt: false\n' });
  assert.deepStrictEqual(result['review-auto-apply-prose-exempt'], { value: false, source: 'policy' });
});

test('review-auto-apply-prose-exempt: run-config (config.yml) wins over policy.yml, same precedence as review-auto-apply-ceiling', () => {
  const result = resolvePolicyKeys(['review-auto-apply-prose-exempt'], {
    policyRaw: 'review-auto-apply-prose-exempt: false\n',
    runConfigRaw: 'review-auto-apply-prose-exempt: true\n',
  });
  assert.deepStrictEqual(result['review-auto-apply-prose-exempt'], { value: true, source: 'run-config' });
});

test('specify-auto-continue defaults to false (source: default) when unset', () => {
  const result = resolvePolicyKeys(['specify-auto-continue'], { policyRaw: null, runConfigRaw: null });
  assert.deepStrictEqual(result['specify-auto-continue'], { value: false, source: 'default' });
});

test('specify-auto-continue: true in policy.yml resolves to native boolean true', () => {
  const result = resolvePolicyKeys(['specify-auto-continue'], { policyRaw: 'specify-auto-continue: true\n' });
  assert.deepStrictEqual(result['specify-auto-continue'], { value: true, source: 'policy' });
});

test('specify-auto-continue: resolves with no runConfigRaw at all (the no-run-dir standalone read this key is designed for)', () => {
  const result = resolvePolicyKeys(['specify-auto-continue'], { policyRaw: 'specify-auto-continue: true\n' });
  assert.deepStrictEqual(result['specify-auto-continue'], { value: true, source: 'policy' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result['specify-auto-continue'], 'renamed-from'), false);
});

test('a key with no schema default, absent everywhere, resolves to value: null, source: "default"', () => {
  const result = resolvePolicyKeys(['integration-branch', 'review-effort-floor'], { policyRaw: '' });
  assert.deepStrictEqual(result['integration-branch'], { value: null, source: 'default' });
  assert.deepStrictEqual(result['review-effort-floor'], { value: null, source: 'default' });
});

test('model-profiles resolves to its documented absent shape — the CLI overwrites this entry via delegation', () => {
  const result = resolvePolicyKeys(['model-profiles'], {
    policyRaw: 'model-profiles:\n  standard:\n    model: opus\n',
  });
  assert.deepStrictEqual(result['model-profiles'], { value: null, source: 'default' });
});

test('requesting an alias\'s old name resolves the replacement key, never unknown-key', () => {
  const result = resolvePolicyKeys(['unattended-tier'], { policyRaw: 'autonomy: trusted\n' });
  assert.deepStrictEqual(result['unattended-tier'], { value: 'trusted', source: 'policy' });
});

// --- #331 key collapse: execution.always -> execution-strategy (AC 1) ---

test('AC 1: execution.always: subagent migrates to execution-strategy subagent-only with renamed-from', () => {
  const result = resolvePolicyKeys(['execution-strategy'], {
    policyRaw: 'execution.always: subagent\n',
  });
  assert.deepStrictEqual(result['execution-strategy'], {
    value: 'subagent-only',
    source: 'policy',
    'renamed-from': 'execution.always',
  });
});

test('AC 1: execution.always: batched migrates to execution-strategy batched-only with renamed-from', () => {
  const result = resolvePolicyKeys(['execution-strategy'], {
    policyRaw: 'execution.always: batched\n',
  });
  assert.deepStrictEqual(result['execution-strategy'], {
    value: 'batched-only',
    source: 'policy',
    'renamed-from': 'execution.always',
  });
});

test('AC 1: malformed execution.always null-migrates to the schema default, source default, renamed-from — never a minted -only value', () => {
  const result = resolvePolicyKeys(['execution-strategy'], {
    policyRaw: 'execution.always: yes\n',
  });
  assert.deepStrictEqual(result['execution-strategy'], {
    value: 'subagent',
    source: 'default',
    'renamed-from': 'execution.always',
  });
});

test('AC 1: merge-check: false resolves branch-divergence-check to native false with renamed-from', () => {
  const result = resolvePolicyKeys(['branch-divergence-check'], {
    policyRaw: 'merge-check: false\n',
  });
  assert.deepStrictEqual(result['branch-divergence-check'], {
    value: false,
    source: 'policy',
    'renamed-from': 'merge-check',
  });
});

test('execution-strategy set directly to a -only lock value resolves it — the widened enum accepts locks', () => {
  const result = resolvePolicyKeys(['execution-strategy'], {
    policyRaw: 'execution-strategy: batched-only\n',
  });
  assert.deepStrictEqual(result['execution-strategy'], { value: 'batched-only', source: 'policy' });
});

// --- #331 retirements: replacedBy: null ---

test('requesting a RETIRED key\'s own name yields unknown-key — there is no replacement to resolve', () => {
  const result = resolvePolicyKeys(
    ['review-diff-heuristic-thresholds', 'promise-register-min-leaves', 'section-confirmation'],
    { policyRaw: 'section-confirmation: per-section\n' },
  );
  for (const retired of ['review-diff-heuristic-thresholds', 'promise-register-min-leaves', 'section-confirmation']) {
    assert.deepStrictEqual(result[retired], { error: 'unknown-key' }, `${retired} is retired with no replacement — it must error, not crash or resolve`);
  }
});

test('a retired key\'s line is inert: deleted from the source\'s flat view, no renamed-from anywhere, siblings unaffected', () => {
  const result = resolvePolicyKeys(['autonomy', 'branch-divergence-check'], {
    policyRaw: 'section-confirmation: per-section\npromise-register-min-leaves: 9\nautonomy: trusted\n',
    runConfigRaw: 'review-diff-heuristic-thresholds: whatever\n',
  });
  assert.deepStrictEqual(result.autonomy, { value: 'trusted', source: 'policy' });
  assert.deepStrictEqual(result['branch-divergence-check'], { value: true, source: 'default' }, 'a retired line contributes no value and no renamed-from tag to any canonical key');
});

test('design-critique resolves to the schema default auto with source: "default" when unset (#595)', () => {
  const result = resolvePolicyKeys(['design-critique'], { policyRaw: null, runConfigRaw: null });
  assert.deepStrictEqual(result['design-critique'], { value: 'auto', source: 'default' });
  const set = resolvePolicyKeys(['design-critique'], { policyRaw: 'design-critique: full\n' });
  assert.deepStrictEqual(set['design-critique'], { value: 'full', source: 'policy' });
});

// --- housekeeping-auto-merge autonomy-derived default (#580) ---
// The key is requested ALONE in every case below: the derivation must
// internally resolve autonomy from the same sources, never rely on
// autonomy appearing in requestedKeys (the per-key loop shares no state).

test('AC 1: unset + autonomy supervised (or unset) derives false', () => {
  const unsetBoth = resolvePolicyKeys(['housekeeping-auto-merge'], { policyRaw: null });
  assert.deepStrictEqual(unsetBoth['housekeeping-auto-merge'], { value: false, source: 'default' });
  const supervised = resolvePolicyKeys(['housekeeping-auto-merge'], { policyRaw: 'autonomy: supervised\n' });
  assert.deepStrictEqual(supervised['housekeeping-auto-merge'], { value: false, source: 'default' });
});

test('AC 2: unset + autonomy trusted derives true', () => {
  const result = resolvePolicyKeys(['housekeeping-auto-merge'], { policyRaw: 'autonomy: trusted\n' });
  assert.deepStrictEqual(result['housekeeping-auto-merge'], { value: true, source: 'default' });
});

test('AC 3+4: unset + autonomy unattended derives true, with the key requested alone', () => {
  const requested = ['housekeeping-auto-merge'];
  assert.ok(!requested.includes('autonomy'), 'invariant: autonomy must not be in requestedKeys');
  const result = resolvePolicyKeys(requested, { policyRaw: 'autonomy: unattended\n' });
  assert.deepStrictEqual(result['housekeeping-auto-merge'], { value: true, source: 'default' });
});

test('AC 5: explicit false at unattended wins with a non-default source', () => {
  const result = resolvePolicyKeys(['housekeeping-auto-merge'], {
    policyRaw: 'housekeeping-auto-merge: false\nautonomy: unattended\n',
  });
  assert.deepStrictEqual(result['housekeeping-auto-merge'], { value: false, source: 'policy' });
});

test('AC 6: explicit true at supervised wins with a non-default source', () => {
  const result = resolvePolicyKeys(['housekeeping-auto-merge'], {
    policyRaw: 'housekeeping-auto-merge: true\nautonomy: supervised\n',
  });
  assert.deepStrictEqual(result['housekeeping-auto-merge'], { value: true, source: 'policy' });
});

test('AC 7: set-but-invalid keeps invalid: true and falls back to the derived value', () => {
  const result = resolvePolicyKeys(['housekeeping-auto-merge'], {
    policyRaw: 'housekeeping-auto-merge: maybe\nautonomy: unattended\n',
  });
  assert.deepStrictEqual(result['housekeeping-auto-merge'], { value: true, source: 'default', invalid: true });
});

test('run-config explicit value beats a policy autonomy derivation', () => {
  const result = resolvePolicyKeys(['housekeeping-auto-merge'], {
    policyRaw: 'autonomy: unattended\n',
    runConfigRaw: 'housekeeping-auto-merge: false\n',
  });
  assert.deepStrictEqual(result['housekeeping-auto-merge'], { value: false, source: 'run-config' });
});

test('an invalid autonomy value feeding the derivation falls back to supervised, deriving false', () => {
  const result = resolvePolicyKeys(['housekeeping-auto-merge'], {
    policyRaw: 'autonomy: banana\n',
  });
  assert.deepStrictEqual(result['housekeeping-auto-merge'], { value: false, source: 'default' });
});

// --- merge-authorization: run-config-or-arg only, never policy.yml (#715) ---

test('merge-authorization: unset everywhere resolves to the ask default', () => {
  const result = resolvePolicyKeys(['merge-authorization'], { policyRaw: null, runConfigRaw: null });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'ask', source: 'default' });
});

test('merge-authorization: a run-config value (a live Manifesto override) wins', () => {
  const result = resolvePolicyKeys(['merge-authorization'], {
    policyRaw: null,
    runConfigRaw: 'merge-authorization: pre-authorized\n',
  });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'pre-authorized', source: 'run-config' });
});

test('merge-authorization: a policy.yml value is ignored — falls back to the default, not "policy"', () => {
  const result = resolvePolicyKeys(['merge-authorization'], {
    policyRaw: 'merge-authorization: pre-authorized\n',
    runConfigRaw: null,
  });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'ask', source: 'default' });
});

test('merge-authorization: run-config still wins even when policy.yml also sets it (policy ignored, not merely lower-precedence)', () => {
  const result = resolvePolicyKeys(['merge-authorization'], {
    policyRaw: 'merge-authorization: pre-authorized\n',
    runConfigRaw: 'merge-authorization: ask\n',
  });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'ask', source: 'run-config' });
});

test('merge-authorization: an invalid run-config value falls back to the default, tagged invalid', () => {
  const result = resolvePolicyKeys(['merge-authorization'], {
    policyRaw: null,
    runConfigRaw: 'merge-authorization: sometimes\n',
  });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'ask', source: 'default', invalid: true });
});

test('merge-authorization: an unattended autonomy ceiling alone never pre-authorizes (#2734)', () => {
  const result = resolvePolicyKeys(['merge-authorization'], { policyRaw: 'autonomy: unattended\n', runConfigRaw: null });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'ask', source: 'default' });
});

test('merge-authorization: a run-config pre-authorized value wins over an unattended autonomy ceiling (#2734)', () => {
  const result = resolvePolicyKeys(['merge-authorization'], {
    policyRaw: 'autonomy: unattended\n',
    runConfigRaw: 'merge-authorization: pre-authorized\n',
  });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'pre-authorized', source: 'run-config' });
});
