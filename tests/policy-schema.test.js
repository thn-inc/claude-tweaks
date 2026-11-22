'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { POLICY_KEYS, RENAMED_KEYS, auditPolicy, resolveValue, resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');
const { readText } = require('./helpers/read-skill');
const { runCliSync } = require('./helpers/run-cli');
const { assertLastBump } = require('./helpers/last-bump');

function tmpRepo() {
  return scratchDir('ct-policy-schema-');
}
function writePolicy(repo, content) {
  const dir = path.join(repo, '.claude-tweaks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'policy.yml'), content);
}
function writeClaudeMd(repo, content) {
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), content);
}

// The seven #332 identity renames (naming convention + rename program): one
// misnomer (review-severity-floor is a max, so -ceiling), two spelling fixes
// (automerge -> auto-merge), four dot -> dash. One fixture, three consumers
// below — the schema-shape check, the resolve/audit round-trip, and the
// RENAMED_KEYS enumeration — so a rename table edited in one place cannot
// drift from the others. `shape` is the unchanged POLICY_KEYS row shape;
// `raw`/`coerced`/`other` are policy.yml inputs and their resolved values.
const RENAMES_332 = [
  { oldKey: 'review-severity-floor', newKey: 'review-auto-apply-ceiling', shape: { type: 'enum', values: ['none', 'low', 'medium'], default: 'low' }, raw: 'medium', coerced: 'medium', other: 'none', otherCoerced: 'none' },
  { oldKey: 'automerge-max-lines', newKey: 'auto-merge-max-lines', shape: { type: 'integer', default: 40 }, raw: '55', coerced: 55, other: '7', otherCoerced: 7 },
  { oldKey: 'automerge-max-files', newKey: 'auto-merge-max-files', shape: { type: 'integer', default: 2 }, raw: '4', coerced: 4, other: '9', otherCoerced: 9 },
  { oldKey: 'project.maturity', newKey: 'project-maturity', shape: { type: 'enum', values: ['greenfield', 'pre-launch', 'early-production', 'established'], default: 'greenfield' }, raw: 'established', coerced: 'established', other: 'pre-launch', otherCoerced: 'pre-launch' },
  { oldKey: 'harness-health.scoped-rule-budget', newKey: 'harness-health-scoped-rule-budget', shape: { type: 'integer', default: 30 }, raw: '12', coerced: 12, other: '13', otherCoerced: 13 },
  { oldKey: 'harness-health.always-loaded-budget', newKey: 'harness-health-always-loaded-budget', shape: { type: 'integer', default: 150 }, raw: '99', coerced: 99, other: '98', otherCoerced: 98 },
  { oldKey: 'doc-convention.adr', newKey: 'doc-convention-adr', shape: { type: 'enum', values: ['plugin', 'project'] }, raw: 'project', coerced: 'project', other: 'plugin', otherCoerced: 'plugin' },
];

test('POLICY_KEYS entries are unique', () => {
  assertLastBump(__filename);
  // Changes only with a recorded reason. Recompute by counting the merged list,
  // never by summing either side's delta (IL-99); history is `git log -L`.
  // Last bump: 119 -> 120, #6051
  assert.strictEqual(POLICY_KEYS.length, 120);
  assert.strictEqual(new Set(POLICY_KEYS.map((k) => k.key)).size, 120);
});

test('express-lane keys resolve their defaults (#4025)', () => {
  const resolved = resolvePolicyKeys(['express-lane', 'express-review-sample-every'], { policyRaw: '', runConfigRaw: null });
  assert.deepStrictEqual(resolved['express-lane'], { value: false, source: 'default' });
  assert.deepStrictEqual(resolved['express-review-sample-every'], { value: 5, source: 'default' });
  const zero = resolvePolicyKeys(['express-review-sample-every'], { policyRaw: 'express-review-sample-every: 0\n', runConfigRaw: null });
  assert.strictEqual(zero['express-review-sample-every'].invalid, true, 'min: 1 — a sample cadence of 0 is schema-invalid');
});

test('dispatch-batch-size is registered alongside its deprecated alias', () => {
  // #295 renamed dispatch-pick-max-concurrent -> dispatch-batch-size. Registering
  // only the old name made auditPolicy reject the name every skill now documents.
  const renamed = POLICY_KEYS.find((k) => k.key === 'dispatch-batch-size');
  assert.ok(renamed, 'dispatch-batch-size missing from POLICY_KEYS — the renamed key must validate');
  assert.strictEqual(renamed.type, 'integer');
  assert.strictEqual(renamed.default, 3);

  const alias = POLICY_KEYS.find((k) => k.key === 'dispatch-pick-max-concurrent');
  assert.ok(alias, 'the deprecated alias must stay recognized until its removal condition is met');
  assert.strictEqual(alias.default, renamed.default, 'alias and canonical key must resolve the same default');
});

test('unattended-tier is retired from POLICY_KEYS', () => {
  assert.strictEqual(
    POLICY_KEYS.find((k) => k.key === 'unattended-tier'),
    undefined,
    'unattended-tier was merged into autonomy; RENAMED_KEYS carries the migration, not POLICY_KEYS',
  );
});

test('integration-branch is a recognized string key with no default', () => {
  const branch = POLICY_KEYS.find((k) => k.key === 'integration-branch');
  assert.ok(branch, 'integration-branch missing from POLICY_KEYS');
  assert.strictEqual(branch.type, 'string');
  assert.strictEqual(branch.default, undefined, 'unset must mean "resolve the default branch per firing"');
});

test('ui-stack is registered with no static default (mirrors integration-branch)', () => {
  const uiStack = POLICY_KEYS.find((k) => k.key === 'ui-stack');
  assert.ok(uiStack, 'ui-stack missing from POLICY_KEYS');
  assert.equal(uiStack.type, 'string');
  assert.equal('default' in uiStack, false, 'ui-stack must carry no static default — KEPT-PROMPT depends on unset resolving to null');
});

test('routine.branch is gone — renamed before it ever shipped, with no alias', () => {
  assert.strictEqual(
    POLICY_KEYS.find((k) => k.key === 'routine.branch'),
    undefined,
    'routine.branch was renamed before it shipped (the work landed as 6.42.0); an alias would be a compatibility path with no expiry'
  );
});

test('integration-branch accepts a branch name and flags a whitespace-bearing one', () => {
  const ok = tmpRepo();
  writePolicy(ok, 'integration-branch: dev\n');
  assert.deepStrictEqual(auditPolicy(ok).invalidValues, []);
  assert.deepStrictEqual(auditPolicy(ok).unrecognizedKeys, []);

  const bad = tmpRepo();
  writePolicy(bad, 'integration-branch: dev branch\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, 'a name git itself would reject must be flagged, like every other typed key');
  assert.strictEqual(result.invalidValues[0].key, 'integration-branch');
});

test('execution-strategy and git-strategy are recognized policy keys', () => {
  const byKey = new Map(POLICY_KEYS.map((k) => [k.key, k]));

  const exec = byKey.get('execution-strategy');
  assert.ok(exec, 'execution-strategy missing from POLICY_KEYS');
  assert.strictEqual(exec.type, 'enum');
  assert.deepStrictEqual(exec.values, ['subagent', 'batched', 'subagent-only', 'batched-only']);
  assert.strictEqual(exec.default, 'subagent');

  const git = byKey.get('git-strategy');
  assert.ok(git, 'git-strategy missing from POLICY_KEYS');
  assert.strictEqual(git.type, 'enum');
  assert.deepStrictEqual(git.values, ['current-branch', 'worktree']);
  assert.strictEqual(git.default, 'worktree');
});

test('autonomy is a recognized enum key defaulting to supervised; an invalid value is invalid, not unrecognized', () => {
  const byKey = new Map(POLICY_KEYS.map((k) => [k.key, k]));

  const autonomy = byKey.get('autonomy');
  assert.ok(autonomy, 'autonomy missing from POLICY_KEYS');
  assert.strictEqual(autonomy.type, 'enum');
  assert.deepStrictEqual(autonomy.values, ['supervised', 'trusted', 'unattended']);
  assert.strictEqual(autonomy.default, 'supervised');

  const repo = tmpRepo();
  writePolicy(repo, 'autonomy: reckless\n');
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1, 'a value outside the enum must be flagged as invalid');
  assert.strictEqual(result.invalidValues[0].key, 'autonomy');
  assert.strictEqual(result.invalidValues[0].value, 'reckless');
  assert.deepStrictEqual(result.unrecognizedKeys, [], 'a recognized key with a bad value must never also appear as unrecognized');
});

test('execution-strategy is the ONE execution key — plain values are overridable defaults, -only values are locks', () => {
  // #331 merged execution.always into execution-strategy: the '-only' enum
  // values carry the old lock semantics; RENAMED_KEYS migrates stray lines.
  const keys = POLICY_KEYS.map((k) => k.key);
  assert.ok(!keys.includes('execution.always'), 'execution.always was merged into execution-strategy; RENAMED_KEYS carries the migration, not POLICY_KEYS');
  const exec = POLICY_KEYS.find((k) => k.key === 'execution-strategy');
  assert.deepStrictEqual(exec.values, ['subagent', 'batched', 'subagent-only', 'batched-only']);
  assert.strictEqual(exec.default, 'subagent', 'the schema default stays the unlocked plain value');
});

test('branch-divergence-check replaces merge-check — boolean, default-parity true', () => {
  const keys = POLICY_KEYS.map((k) => k.key);
  assert.ok(!keys.includes('merge-check'), 'merge-check was renamed in #331; the old name lives only in RENAMED_KEYS');
  const renamed = POLICY_KEYS.find((k) => k.key === 'branch-divergence-check');
  assert.ok(renamed, 'branch-divergence-check missing from POLICY_KEYS');
  assert.strictEqual(renamed.type, 'boolean');
  assert.strictEqual(renamed.default, true, 'default-parity with the removed merge-check row');
});

test('the three #331-retired keys are gone from POLICY_KEYS', () => {
  const keys = new Set(POLICY_KEYS.map((k) => k.key));
  for (const retired of ['review-diff-heuristic-thresholds', 'promise-register-min-leaves', 'section-confirmation']) {
    assert.ok(!keys.has(retired), `${retired} was retired outright in #331; RENAMED_KEYS carries the retirement, not POLICY_KEYS`);
  }
});

test('#332 renames: seven new names are in POLICY_KEYS with unchanged shape; old names live only in RENAMED_KEYS', () => {
  const byKey = new Map(POLICY_KEYS.map((k) => [k.key, k]));
  for (const { oldKey, newKey, shape } of RENAMES_332) {
    assert.ok(!byKey.has(oldKey), `${oldKey} must not remain in POLICY_KEYS (renamed in #332)`);
    const row = byKey.get(newKey);
    assert.ok(row, `${newKey} missing from POLICY_KEYS`);
    assert.strictEqual(row.type, shape.type, `${newKey}: type`);
    if ('values' in shape) assert.deepStrictEqual(row.values, shape.values, `${newKey}: values`);
    if ('default' in shape) assert.strictEqual(row.default, shape.default, `${newKey}: default`);
    else assert.strictEqual(row.default, undefined, `${newKey}: must stay default-less`);
    assert.strictEqual(typeof row.summary, 'string', `${newKey}: metadata carried across`);
  }
});

test('#332 renames: a stray old-name line resolves under the new name with renamed-from attribution, resolves when asked by its old name, loses to an explicit new-name line, and audits under renamedKeys', () => {
  for (const { oldKey, newKey, raw, coerced, other, otherCoerced } of RENAMES_332) {
    const resolved = resolvePolicyKeys([newKey], { policyRaw: `${oldKey}: ${raw}\n` });
    assert.strictEqual(resolved[newKey].value, coerced, `${oldKey}: value migrates`);
    assert.strictEqual(resolved[newKey]['renamed-from'], oldKey, `${oldKey}: renamed-from attribution`);
    const asked = resolvePolicyKeys([oldKey], { policyRaw: `${oldKey}: ${raw}\n` });
    assert.strictEqual(asked[oldKey].value, coerced, `${oldKey}: requesting the old name resolves the replacement key (established alias contract — tests/resolve-policy-lib.test.js), never unknown-key`);
    assert.strictEqual(asked[oldKey].source, 'policy');
    const both = resolvePolicyKeys([newKey], { policyRaw: `${oldKey}: ${raw}\n${newKey}: ${other}\n` });
    assert.strictEqual(both[newKey].value, otherCoerced, `${oldKey}: when both names are set, the new name wins`);
    assert.strictEqual(both[newKey]['renamed-from'], undefined, `${oldKey}: no renamed-from tag when the new name supplied the value`);
    const repo = tmpRepo();
    writePolicy(repo, `${oldKey}: ${raw}\n`);
    const audit = auditPolicy(repo);
    const hit = audit.renamedKeys.find((r) => r.key === oldKey);
    assert.ok(hit, `${oldKey}: audit lists it under renamedKeys`);
    assert.strictEqual(hit.replacedBy, newKey);
    assert.deepStrictEqual(audit.unrecognizedKeys, [], `${oldKey}: never also unrecognized`);
  }
});

test('#602: worktree-always is the POLICY_KEYS row (boolean, default false); worktree.always lives only in RENAMED_KEYS', () => {
  const byKey = new Map(POLICY_KEYS.map((k) => [k.key, k]));
  assert.ok(!byKey.has('worktree.always'), 'worktree.always must not remain in POLICY_KEYS (renamed in #602)');
  const row = byKey.get('worktree-always');
  assert.ok(row, 'worktree-always missing from POLICY_KEYS');
  assert.strictEqual(row.type, 'boolean');
  assert.strictEqual(row.default, false);
  assert.strictEqual(row.tier, 'core');
  assert.strictEqual(typeof row.summary, 'string');
});

test('#602: a worktree.always line resolves under worktree-always with renamed-from; both set -> the new line wins; the stray line audits under renamedKeys', () => {
  const oldOnly = resolvePolicyKeys(['worktree-always'], { policyRaw: 'worktree.always: true\n' });
  assert.strictEqual(oldOnly['worktree-always'].value, true);
  assert.strictEqual(oldOnly['worktree-always']['renamed-from'], 'worktree.always');
  const newOnly = resolvePolicyKeys(['worktree-always'], { policyRaw: 'worktree-always: true\n' });
  assert.strictEqual(newOnly['worktree-always'].value, true);
  assert.strictEqual(newOnly['worktree-always']['renamed-from'], undefined);
  const both = resolvePolicyKeys(['worktree-always'], { policyRaw: 'worktree-always: false\nworktree.always: true\n' });
  assert.strictEqual(both['worktree-always'].value, false, 'new key wins even when the old line says true');
  const asked = resolvePolicyKeys(['worktree.always'], { policyRaw: 'worktree.always: true\n' });
  assert.strictEqual(asked['worktree.always'].value, true, 'requesting the old name resolves the replacement (alias contract)');
  const repo = tmpRepo();
  writePolicy(repo, 'worktree.always: true\n');
  const audit = auditPolicy(repo);
  const hit = audit.renamedKeys.find((r) => r.key === 'worktree.always');
  assert.ok(hit, 'audit lists the stray line under renamedKeys');
  assert.strictEqual(hit.replacedBy, 'worktree-always');
  assert.deepStrictEqual(audit.unrecognizedKeys, []);
});

test('a recognized key in CLAUDE.md is flagged for migration, not validated', () => {
  const repo = tmpRepo();
  writeClaudeMd(repo, 'tidy-aggressiveness: moderate\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.migratableKeys, [
    { key: 'tidy-aggressiveness', value: 'moderate', alsoInPolicy: false },
  ]);
  assert.deepStrictEqual(result.invalidValues, [], 'CLAUDE.md values are no longer validated — the fix is to move the key, not to correct a value that has no effect');
});

test('a recognized key in CLAUDE.md with an INVALID value is still only a migration, never an invalidValues entry', () => {
  const repo = tmpRepo();
  writeClaudeMd(repo, 'tidy-aggressiveness: extreme\n');
  const result = auditPolicy(repo);
  assert.strictEqual(result.migratableKeys.length, 1);
  assert.strictEqual(result.migratableKeys[0].value, 'extreme');
  assert.deepStrictEqual(result.invalidValues, [], 'once CLAUDE.md is not read, its values cannot be wrong — only misplaced');
});

test('the same key in policy.yml is not flagged for migration', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'tidy-aggressiveness: moderate\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.migratableKeys, []);
});

test('a key in BOTH resolves to policy.yml and still flags the CLAUDE.md copy, marked alsoInPolicy', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'tidy-aggressiveness: aggressive\n');
  writeClaudeMd(repo, 'tidy-aggressiveness: conservative\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.migratableKeys, [
    { key: 'tidy-aggressiveness', value: 'conservative', alsoInPolicy: true },
  ]);
  assert.deepStrictEqual(result.invalidValues, [], 'both values are individually valid; policy.yml is the one that applies');
});

test('an UNrecognized key in CLAUDE.md is not flagged — CLAUDE.md prose is full of key-shaped lines', () => {
  const repo = tmpRepo();
  writeClaudeMd(repo, 'Lifecycle: capture -> specify -> build\nStatus: Approved\nwork-backend: github-issues\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.migratableKeys, [], 'only keys in POLICY_KEYS are migratable; work-backend is deliberately out of scope, and ordinary prose must never be touched');
  assert.deepStrictEqual(result.unrecognizedKeys, [], 'unrecognizedKeys is policy.yml-derived only');
});

test('invalidValues entries no longer carry a source field', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'tidy-aggressiveness: extreme\n');
  const [entry] = auditPolicy(repo).invalidValues;
  assert.strictEqual(entry.source, undefined, 'every entry is policy.yml-derived now — a field that can hold exactly one value reads as a live branch and is not one');
  assert.deepStrictEqual(Object.keys(entry).sort(), ['expected', 'key', 'value']);
});

test('missing policy.yml and missing CLAUDE.md -> all-empty result', () => {
  const result = auditPolicy(tmpRepo());
  assert.deepStrictEqual(result, { unrecognizedKeys: [], invalidValues: [], migratableKeys: [], renamedKeys: [], sourceExcludedKeys: [] });
});

test('a stray unattended-tier: on with no autonomy key -> renamedKeys entry, and never also unrecognizedKeys', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'unattended-tier: on\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.renamedKeys, [
    { key: 'unattended-tier', value: 'on', replacedBy: 'autonomy', suggestedValue: 'unattended', currentReplacementValue: null },
  ]);
  assert.deepStrictEqual(result.unrecognizedKeys, []);
});

test('a stray unattended-tier: on alongside an existing autonomy value -> currentReplacementValue reflects it', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'unattended-tier: on\nautonomy: trusted\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.renamedKeys, [
    { key: 'unattended-tier', value: 'on', replacedBy: 'autonomy', suggestedValue: 'unattended', currentReplacementValue: 'trusted' },
  ]);
});

test('no unattended-tier key -> renamedKeys is empty', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'autonomy: trusted\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.renamedKeys, []);
});

test('unattended-tier: off (the schema default, distinct from absent) -> suggestedValue is null', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'unattended-tier: off\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.renamedKeys, [
    { key: 'unattended-tier', value: 'off', replacedBy: 'autonomy', suggestedValue: null, currentReplacementValue: null },
  ]);
});

test('RENAMED_KEYS names every alias and retirement, each with its migration', () => {
  // 1 -> 2, #329: dispatch-pick-max-concurrent gained an alias entry so the
  // resolver migrates it under dispatch-batch-size (it also STAYS in
  // POLICY_KEYS — it runs its own removal course, see
  // skills/dispatch/deprecated-aliases.md).
  // 2 -> 7, #331 (key collapse): execution.always -> execution-strategy
  // (lock-preserving migrate), merge-check -> branch-divergence-check
  // (identity migrate), plus three retirements with replacedBy: null.
  assert.strictEqual(RENAMED_KEYS.length, 15);
  const byKey = new Map(RENAMED_KEYS.map((entry) => [entry.key, entry]));
  assert.strictEqual(byKey.get('unattended-tier').replacedBy, 'autonomy');
  assert.strictEqual(byKey.get('dispatch-pick-max-concurrent').replacedBy, 'dispatch-batch-size');
  assert.strictEqual(byKey.get('dispatch-pick-max-concurrent').migrate('5'), '5', 'the alias migrates by identity — the value meaning did not change shape, only the name did');

  const exec = byKey.get('execution.always');
  assert.strictEqual(exec.replacedBy, 'execution-strategy');
  assert.strictEqual(exec.migrate('subagent'), 'subagent-only', 'a valid lock value migrates to its -only lock form');
  assert.strictEqual(exec.migrate('batched'), 'batched-only', 'a valid lock value migrates to its -only lock form');
  assert.strictEqual(exec.migrate('yes'), null, 'a malformed value null-migrates to the schema default — never a minted -only value');

  const divergence = byKey.get('merge-check');
  assert.strictEqual(divergence.replacedBy, 'branch-divergence-check');
  assert.strictEqual(divergence.migrate('false'), 'false', 'boolean semantics unchanged — identity migrate');

  for (const retired of ['review-diff-heuristic-thresholds', 'promise-register-min-leaves', 'section-confirmation']) {
    const entry = byKey.get(retired);
    assert.ok(entry, `${retired} missing from RENAMED_KEYS`);
    assert.strictEqual(entry.replacedBy, null, 'retired outright — no replacement key');
    assert.strictEqual(entry.migrate('anything'), null, 'nothing carries forward from a retirement');
  }

  // 7 -> 14, #332 (naming convention + rename program): the seven identity
  // renames in RENAMES_332 (top of file). Every one carries the value across
  // unchanged; only the name moved.
  for (const { oldKey, newKey } of RENAMES_332) {
    const entry = byKey.get(oldKey);
    assert.ok(entry, `${oldKey} missing from RENAMED_KEYS`);
    assert.strictEqual(entry.replacedBy, newKey);
    assert.strictEqual(entry.migrate('anything'), 'anything', `${oldKey}: identity migrate — value shape unchanged`);
  }

  // 14 -> 15, #602: worktree.always -> worktree-always — the last dotted key,
  // carved out of #332 because the hook reads it by literal (bin/lib/policy.js).
  const wt = byKey.get('worktree.always');
  assert.ok(wt, 'worktree.always missing from RENAMED_KEYS');
  assert.strictEqual(wt.replacedBy, 'worktree-always');
  assert.strictEqual(wt.migrate('true'), 'true', 'identity migrate — boolean semantics unchanged');
});

test('recognized key with a valid value -> no invalidValues entry', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'dispatch-retry-ceiling: 5\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.invalidValues, []);
});

test('recognized enum key with an invalid value -> flagged', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'tidy-aggressiveness: extreme\n');
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'tidy-aggressiveness');
  assert.strictEqual(result.invalidValues[0].value, 'extreme');
});

test('recognized integer key with a non-integer value -> flagged', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'auto-merge-max-lines: forty\n');
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'auto-merge-max-lines');
});

test('recognized boolean key with a non-boolean value -> flagged', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: yes\n');
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'worktree-always');
});

test('AC 2: all three #331-retired keys audit under renamedKeys with replacedBy: null, never unrecognizedKeys', () => {
  // Was the presence-only pin for review-diff-heuristic-thresholds (opaque
  // type); #331 retired the key, so the pin becomes a retirement-audit pin.
  const repo = tmpRepo();
  writePolicy(repo, [
    'review-diff-heuristic-thresholds: anything at all, not even valid YAML',
    'promise-register-min-leaves: 4',
    'section-confirmation: per-section',
    '',
  ].join('\n'));
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.unrecognizedKeys, [], 'a deliberate retirement must never read as a typo');
  assert.deepStrictEqual(result.invalidValues, [], 'a retired key has no schema row left to validate against');
  assert.deepStrictEqual(result.renamedKeys, [
    { key: 'review-diff-heuristic-thresholds', value: 'anything at all, not even valid YAML', replacedBy: null, suggestedValue: null, currentReplacementValue: null },
    { key: 'promise-register-min-leaves', value: '4', replacedBy: null, suggestedValue: null, currentReplacementValue: null },
    { key: 'section-confirmation', value: 'per-section', replacedBy: null, suggestedValue: null, currentReplacementValue: null },
  ]);
});

test('unrecognized key -> flagged, does not also appear in invalidValues', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'made-up-lever: 42\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.unrecognizedKeys, ['made-up-lever']);
  assert.deepStrictEqual(result.invalidValues, []);
});

test('invalid value in policy.yml is flagged in invalidValues', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'tidy-aggressiveness: extreme\n');
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'tidy-aggressiveness');
  assert.strictEqual(result.invalidValues[0].value, 'extreme');
});

test('a CLAUDE.md key is reported under migratableKeys, never invalidValues', () => {
  const repo = tmpRepo();
  writeClaudeMd(repo, 'tidy-aggressiveness: extreme\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.invalidValues, []);
  assert.strictEqual(result.migratableKeys.length, 1);
  assert.strictEqual(result.migratableKeys[0].key, 'tidy-aggressiveness');
});

test('malformed policy.yml (unparseable) is treated as absent, not thrown', () => {
  const repo = tmpRepo();
  const dir = path.join(repo, '.claude-tweaks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'policy.yml'), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  assert.doesNotThrow(() => auditPolicy(repo));
});

test('doc-convention-adr is an enum with no default — unset means "detect and ask"', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'doc-convention-adr');
  assert.ok(key, 'doc-convention-adr missing from POLICY_KEYS');
  assert.strictEqual(key.type, 'enum');
  assert.deepStrictEqual(key.values, ['plugin', 'project']);
  assert.strictEqual(key.default, undefined, 'unset is a meaningful third state: the question has not been asked yet');

  const repo = tmpRepo();
  writePolicy(repo, 'doc-convention-adr: project\n');
  const ok = auditPolicy(repo);
  assert.deepStrictEqual(ok.invalidValues, []);
  assert.deepStrictEqual(ok.unrecognizedKeys, []);

  const bad = tmpRepo();
  writePolicy(bad, 'doc-convention-adr: whatever-the-repo-does\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, 'a value outside the enum must be flagged');
  assert.strictEqual(result.invalidValues[0].key, 'doc-convention-adr');
});

test('doc-convention-{tutorial,how-to,reference,explanation,journey} are enums with no default, mirroring doc-convention-adr', () => {
  const genres = ['tutorial', 'how-to', 'reference', 'explanation', 'journey'];
  for (const genre of genres) {
    const key = POLICY_KEYS.find((k) => k.key === `doc-convention-${genre}`);
    assert.ok(key, `doc-convention-${genre} missing from POLICY_KEYS`);
    assert.strictEqual(key.type, 'enum');
    assert.deepStrictEqual(key.values, ['plugin', 'project']);
    assert.strictEqual(key.default, undefined, 'unset is a meaningful third state: the question has not been asked yet');
  }

  const repo = tmpRepo();
  writePolicy(repo, 'doc-convention-how-to: project\n');
  const ok = auditPolicy(repo);
  assert.deepStrictEqual(ok.invalidValues, []);
  assert.deepStrictEqual(ok.unrecognizedKeys, []);

  const bad = tmpRepo();
  writePolicy(bad, 'doc-convention-journey: whatever-the-repo-does\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, 'a value outside the enum must be flagged');
  assert.strictEqual(result.invalidValues[0].key, 'doc-convention-journey');
});

test('superpowers-plans-retention is an enum defaulting to keep-forever', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'superpowers-plans-retention');
  assert.ok(key, 'superpowers-plans-retention missing from POLICY_KEYS');
  assert.strictEqual(key.type, 'enum');
  assert.deepStrictEqual(key.values, ['keep-forever', 'prune-after-wrapup', 'ask']);
  assert.strictEqual(key.default, 'keep-forever');

  assert.strictEqual(resolveValue('superpowers-plans-retention', undefined), 'keep-forever');
  assert.strictEqual(resolveValue('superpowers-plans-retention', 'prune-after-wrapup'), 'prune-after-wrapup');
  assert.strictEqual(resolveValue('superpowers-plans-retention', 'ask'), 'ask');
  // Out-of-enum degrades to the default via the existing resolveValue coercion contract — no throw.
  assert.strictEqual(resolveValue('superpowers-plans-retention', 'delete-immediately'), 'keep-forever');

  const repo = tmpRepo();
  writePolicy(repo, 'superpowers-plans-retention: prune-after-wrapup\n');
  const ok = auditPolicy(repo);
  assert.deepStrictEqual(ok.invalidValues, []);
  assert.deepStrictEqual(ok.unrecognizedKeys, []);

  const bad = tmpRepo();
  writePolicy(bad, 'superpowers-plans-retention: delete-everything\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, 'a value outside the enum must be flagged');
  assert.strictEqual(result.invalidValues[0].key, 'superpowers-plans-retention');
});

test('trust-revert-window-days is a recognized integer key with a floor of 1, defaulting to 14', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'trust-revert-window-days');
  assert.ok(key, 'trust-revert-window-days missing from POLICY_KEYS');
  assert.strictEqual(key.type, 'integer');
  assert.strictEqual(key.min, 1);
  assert.strictEqual(key.default, 14);

  const repo = tmpRepo();
  writePolicy(repo, 'trust-revert-window-days: 21\n');
  assert.deepStrictEqual(auditPolicy(repo).invalidValues, []);

  const bad = tmpRepo();
  writePolicy(bad, 'trust-revert-window-days: 0\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, '0 is below the floor of 1 and must be flagged');
  assert.strictEqual(result.invalidValues[0].key, 'trust-revert-window-days');

  const negative = tmpRepo();
  writePolicy(negative, 'trust-revert-window-days: -5\n');
  assert.strictEqual(auditPolicy(negative).invalidValues.length, 1, 'a negative value must be flagged too');
});

test('AC6.1: trust-evaluation-window-days is a recognized integer key with a floor of 1, defaulting to 30', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'trust-evaluation-window-days');
  assert.ok(key, 'trust-evaluation-window-days missing from POLICY_KEYS');
  assert.strictEqual(key.type, 'integer');
  assert.strictEqual(key.min, 1);
  assert.strictEqual(key.default, 30);

  const repo = tmpRepo();
  writePolicy(repo, 'trust-evaluation-window-days: 45\n');
  assert.deepStrictEqual(auditPolicy(repo).invalidValues, []);

  for (const bad of ['0', '-5']) {
    const dir = tmpRepo();
    writePolicy(dir, `trust-evaluation-window-days: ${bad}\n`);
    const result = auditPolicy(dir);
    assert.strictEqual(result.invalidValues.length, 1, `${bad} is below the floor of 1 and must be flagged`);
    assert.strictEqual(result.invalidValues[0].key, 'trust-evaluation-window-days');
  }
});

test('AC6.1: trust-follow-up-rate-max-percent is an integer key bounded 0..100, defaulting to 30', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'trust-follow-up-rate-max-percent');
  assert.ok(key, 'trust-follow-up-rate-max-percent missing from POLICY_KEYS');
  assert.strictEqual(key.type, 'integer');
  assert.strictEqual(key.min, 0);
  assert.strictEqual(key.max, 100);
  assert.strictEqual(key.default, 30);

  for (const ok of ['0', '100']) {
    const dir = tmpRepo();
    writePolicy(dir, `trust-follow-up-rate-max-percent: ${ok}\n`);
    assert.deepStrictEqual(auditPolicy(dir).invalidValues, [], `${ok} is inside 0..100`);
  }
  for (const bad of ['101', '-1', 'banana']) {
    const dir = tmpRepo();
    writePolicy(dir, `trust-follow-up-rate-max-percent: ${bad}\n`);
    const result = auditPolicy(dir);
    assert.strictEqual(result.invalidValues.length, 1, `${bad} must be flagged`);
    assert.strictEqual(result.invalidValues[0].key, 'trust-follow-up-rate-max-percent');
  }
  assert.strictEqual(resolveValue('trust-follow-up-rate-max-percent', '101'), 30);
});

test('AC6.1: resolvePolicyKeys flags a malformed trust window and rate and resolves their defaults', () => {
  const keys = ['trust-evaluation-window-days', 'trust-follow-up-rate-max-percent'];
  const bad = resolvePolicyKeys(keys, { policyRaw: 'trust-evaluation-window-days: 0\ntrust-follow-up-rate-max-percent: 101\n' });
  assert.strictEqual(bad['trust-evaluation-window-days'].value, 30);
  assert.strictEqual(bad['trust-evaluation-window-days'].invalid, true);
  assert.strictEqual(bad['trust-follow-up-rate-max-percent'].value, 30);
  assert.strictEqual(bad['trust-follow-up-rate-max-percent'].invalid, true);

  const good = resolvePolicyKeys(keys, { policyRaw: 'trust-evaluation-window-days: 45\ntrust-follow-up-rate-max-percent: 20\n' });
  assert.strictEqual(good['trust-evaluation-window-days'].value, 45);
  assert.strictEqual(good['trust-follow-up-rate-max-percent'].value, 20);
  assert.strictEqual(good['trust-evaluation-window-days'].invalid, undefined);
  assert.strictEqual(good['trust-follow-up-rate-max-percent'].invalid, undefined);
});

test('grant-veto-window-hours is a recognized integer key with a floor of 1, defaulting to 24', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'grant-veto-window-hours');
  assert.ok(key, 'grant-veto-window-hours missing from POLICY_KEYS');
  assert.strictEqual(key.type, 'integer');
  assert.strictEqual(key.min, 1);
  assert.strictEqual(key.default, 24);

  const repo = tmpRepo();
  writePolicy(repo, 'grant-veto-window-hours: 48\n');
  assert.deepStrictEqual(auditPolicy(repo).invalidValues, []);

  const bad = tmpRepo();
  writePolicy(bad, 'grant-veto-window-hours: 0\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, '0 is below the floor of 1 and must be flagged');
  assert.strictEqual(result.invalidValues[0].key, 'grant-veto-window-hours');

  const negative = tmpRepo();
  writePolicy(negative, 'grant-veto-window-hours: -5\n');
  assert.strictEqual(auditPolicy(negative).invalidValues.length, 1, 'a negative value must be flagged too');
});

test('model-stance, frontier-run-cap, model-ceiling, model-profiles, research-mode are registered', () => {
  const byKey = new Map(POLICY_KEYS.map((k) => [k.key, k]));

  const stance = byKey.get('model-stance');
  assert.ok(stance, 'model-stance missing from POLICY_KEYS');
  assert.strictEqual(stance.type, 'enum');
  assert.deepStrictEqual(stance.values, ['economy', 'default', 'max-rigor']);
  assert.strictEqual(stance.default, 'default');

  const cap = byKey.get('frontier-run-cap');
  assert.ok(cap, 'frontier-run-cap missing from POLICY_KEYS');
  assert.strictEqual(cap.type, 'integer');
  assert.strictEqual(cap.default, 3);

  const ceiling = byKey.get('model-ceiling');
  assert.ok(ceiling, 'model-ceiling missing from POLICY_KEYS');
  assert.strictEqual(ceiling.type, 'enum');
  assert.deepStrictEqual(ceiling.values, ['fast', 'standard', 'capable', 'frontier']);
  assert.strictEqual(ceiling.default, undefined, 'unset means no ceiling clamp');

  const profiles = byKey.get('model-profiles');
  assert.ok(profiles, 'model-profiles missing from POLICY_KEYS');
  assert.strictEqual(profiles.type, 'map');
  assert.deepStrictEqual(profiles.keys, ['fast', 'standard', 'capable', 'frontier']);

  const researchMode = byKey.get('research-mode');
  assert.ok(researchMode, 'research-mode missing from POLICY_KEYS');
  assert.strictEqual(researchMode.type, 'enum');
  assert.deepStrictEqual(researchMode.values, ['quick', 'standard', 'deep', 'ultradeep']);
  assert.strictEqual(researchMode.default, undefined, 'unset falls through to /claude-tweaks:research\'s own standard default');
});

test('model-stance/model-ceiling/frontier-run-cap/research-mode accept valid values and flag invalid ones', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'model-stance: economy\nmodel-ceiling: capable\nfrontier-run-cap: 5\nresearch-mode: deep\n');
  assert.deepStrictEqual(auditPolicy(repo).invalidValues, []);
  assert.deepStrictEqual(auditPolicy(repo).unrecognizedKeys, []);

  const badStance = tmpRepo();
  writePolicy(badStance, 'model-stance: turbo\n');
  const stanceResult = auditPolicy(badStance);
  assert.strictEqual(stanceResult.invalidValues.length, 1);
  assert.strictEqual(stanceResult.invalidValues[0].key, 'model-stance');

  const badCeiling = tmpRepo();
  writePolicy(badCeiling, 'model-ceiling: ultra\n');
  const ceilingResult = auditPolicy(badCeiling);
  assert.strictEqual(ceilingResult.invalidValues.length, 1);
  assert.strictEqual(ceilingResult.invalidValues[0].key, 'model-ceiling');

  const badMode = tmpRepo();
  writePolicy(badMode, 'research-mode: exhaustive\n');
  const modeResult = auditPolicy(badMode);
  assert.strictEqual(modeResult.invalidValues.length, 1);
  assert.strictEqual(modeResult.invalidValues[0].key, 'research-mode');
});

test('model-profiles: a row keyed by a real profile name is accepted, any field shape inside it is', () => {
  const repo = tmpRepo();
  writePolicy(repo, [
    'model-profiles:',
    '  standard:',
    '    model: opus',
    '    effort: low',
    '  capable:',
    '    effort: medium',
    '',
  ].join('\n'));
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.invalidValues, []);
  assert.deepStrictEqual(result.unrecognizedKeys, [], 'row field lines (model:/effort:) must never be read as top-level flat keys');
});

test('model-profiles: a row keyed by a non-profile name is flagged, key names only — shallow by design', () => {
  const repo = tmpRepo();
  writePolicy(repo, ['model-profiles:', '  bogus:', '    model: opus', ''].join('\n'));
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'model-profiles');
  assert.deepStrictEqual(result.invalidValues[0].value, { bogus: true });
});

test('model-profiles: an unrecognized sub-field inside a valid row is accepted — deep row validation is the resolver\'s job, not the schema\'s', () => {
  const repo = tmpRepo();
  writePolicy(repo, ['model-profiles:', '  standard:', '    speed: fast', ''].join('\n'));
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.invalidValues, []);
});

test('AC1.1: model-profiles audit sees the block when policy.yml has CRLF endings and a trailing comment on the key line (#4816)', () => {
  const repo = tmpRepo();
  writePolicy(repo, ['model-profiles:   # project overrides', '  bogus:', '    model: opus', ''].join('\r\n'));
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'model-profiles');
  assert.deepStrictEqual(result.invalidValues[0].value, { bogus: true });
});

test('auditPolicy flags a valid policy.yml value for a source-excluded lever as sourceExcludedKeys, not silently accepted (#839)', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'merge-authorization: pre-authorized\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.invalidValues, [], 'a valid enum value must not also be reported as invalid');
  assert.deepStrictEqual(result.unrecognizedKeys, [], 'a recognized key must not also be reported as unrecognized');
  assert.deepStrictEqual(result.sourceExcludedKeys, [{ key: 'merge-authorization', value: 'pre-authorized' }]);
});

test('auditPolicy reports no sourceExcludedKeys when merge-authorization is unset', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'autonomy: trusted\n');
  assert.deepStrictEqual(auditPolicy(repo).sourceExcludedKeys, []);
});

test('an invalid value for a source-excluded key reports as invalidValues, never double-reported as sourceExcludedKeys', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'merge-authorization: sometimes\n');
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'merge-authorization');
  assert.deepStrictEqual(result.sourceExcludedKeys, []);
});

test('the policy.yml value is still discarded at resolve time (unchanged behavior) when a lever is flagged sourceExcludedKeys', () => {
  const result = resolvePolicyKeys(['merge-authorization'], {
    policyRaw: 'merge-authorization: pre-authorized\n',
    runConfigRaw: null,
  });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'ask', source: 'default' }, 'auditPolicy surfacing the finding must not change resolvePolicyKeys\' own discard behavior');
});

test('the source-excluded special case is keyed on the generic policySourceExcluded flag, not a hardcoded key name (#839)', () => {
  const src = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'policy-schema.js'));
  assert.ok(
    !/canonical === 'merge-authorization'/.test(src),
    'the resolver must not special-case merge-authorization by name — a second excluded lever needs zero code changes here, only registering policySourceExcluded on its POLICY_KEYS row',
  );
  assert.ok(/policySourceExcluded/.test(src), 'the resolver and auditPolicy must both consult the generic policySourceExcluded flag');
});

test('merge-authorization is the one POLICY_KEYS entry currently flagged policySourceExcluded', () => {
  const flagged = POLICY_KEYS.filter((k) => k.policySourceExcluded === true).map((k) => k.key);
  assert.deepStrictEqual(flagged, ['merge-authorization']);
});

// #6006: a key a run decides live is both excluded from the standing sources and refused from the
// factory layer, so the refused-key warning names every factory value the exclusion would discard.
test('every policySourceExcluded row in POLICY_KEYS is in FACTORY_REFUSED_KEYS', () => {
  const { FACTORY_REFUSED_KEYS } = require('../plugin/bin/lib/policy-factory');
  const flagged = POLICY_KEYS.filter((k) => k.policySourceExcluded === true).map((k) => k.key);
  assert.ok(flagged.length > 0, 'at least one flagged row, or this check is vacuous');
  assert.deepStrictEqual(flagged.filter((key) => !FACTORY_REFUSED_KEYS.includes(key)), []);
});

// #6006: merge-authorization, the one flagged row, is also factory-refused, so only a temporarily
// flagged row reaches the guard with a factory value. The flag is restored before the test returns.
test('a policySourceExcluded row is set neither from policy.yml nor from the factory layer, only from a run config', () => {
  const row = POLICY_KEYS.find((k) => k.key === 'design-ceremony');
  assert.ok(row && !row.policySourceExcluded && !row.policyOnly);
  row.policySourceExcluded = true;
  try {
    const resolve = (raws) => resolvePolicyKeys(['design-ceremony'], raws)['design-ceremony'];
    assert.deepStrictEqual(resolve({ factoryRaw: 'design-ceremony: fast-lane\n' }), { value: 'standard', source: 'default' });
    assert.deepStrictEqual(resolve({ policyRaw: 'design-ceremony: fast-lane\n' }), { value: 'standard', source: 'default' });
    assert.deepStrictEqual(resolve({ runConfigRaw: 'design-ceremony: fast-lane\n', factoryRaw: 'design-ceremony: standard\n' }), { value: 'fast-lane', source: 'run-config' });
  } finally {
    delete row.policySourceExcluded;
  }
  assert.deepStrictEqual(resolvePolicyKeys(['design-ceremony'], { factoryRaw: 'design-ceremony: fast-lane\n' })['design-ceremony'], { value: 'fast-lane', source: 'factory' });
});

test('mixed policy.yml + CLAUDE.md content is read independently, both audited together', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'dispatch-retry-ceiling: 5\nmade-up-lever: 1\n');
  writeClaudeMd(repo, 'tidy-aggressiveness: not-a-real-value\n');
  const result = auditPolicy(repo);
  assert.deepStrictEqual(result.unrecognizedKeys, ['made-up-lever']);
  const migrated = result.migratableKeys.find((e) => e.key === 'tidy-aggressiveness');
  assert.ok(migrated, 'expected the CLAUDE.md key to be reported as migratable');
  assert.strictEqual(migrated.alsoInPolicy, false);
});

test('resolveValue falls back to the schema default when the raw value is absent', () => {
  assert.strictEqual(resolveValue('trust-revert-window-days', undefined), 14);
  assert.strictEqual(resolveValue('trust-revert-window-days', null), 14);
  assert.strictEqual(resolveValue('trust-revert-window-days', ''), 14);
});

test('resolveValue coerces a valid raw value to a number', () => {
  assert.strictEqual(resolveValue('trust-revert-window-days', '21'), 21);
  assert.strictEqual(resolveValue('trust-revert-window-days', 21), 21);
});

test('resolveValue falls back to the default on a malformed integer — zero, negative, non-integer', () => {
  assert.strictEqual(resolveValue('trust-revert-window-days', '0'), 14);
  assert.strictEqual(resolveValue('trust-revert-window-days', 0), 14);
  assert.strictEqual(resolveValue('trust-revert-window-days', '-5'), 14);
  assert.strictEqual(resolveValue('trust-revert-window-days', 'abc'), 14);
});

test('resolveValue passes an unrecognized key through unchanged', () => {
  assert.strictEqual(resolveValue('made-up-lever', 'anything'), 'anything');
});

test('resolveValue never throws on a malformed value of any type', () => {
  assert.doesNotThrow(() => resolveValue('trust-revert-window-days', {}));
  assert.doesNotThrow(() => resolveValue('trust-revert-window-days', ['x']));
});

test('resolveValue accepts a whitespace-bearing release-hook command via allowWhitespace (#2253)', () => {
  assert.strictEqual(resolveValue('release-hook', 'npm run deploy'), 'npm run deploy');
});

test('resolveValue still rejects a whitespace-only release-hook value — blank after trim falls back to the default', () => {
  assert.strictEqual(resolveValue('release-hook', '   '), undefined);
});

test('resolveValue control: integration-branch has no allowWhitespace and still rejects a spaced value', () => {
  assert.strictEqual(resolveValue('integration-branch', 'dev branch'), undefined);
});

test('resolveValue strips one matched pair of surrounding quotes from an allowWhitespace value before validation (F6, #2253)', () => {
  assert.strictEqual(resolveValue('release-hook', '"npm run deploy"'), 'npm run deploy');
  assert.strictEqual(resolveValue('release-hook', "'./publish.sh --tag'"), './publish.sh --tag');
  assert.strictEqual(resolveValue('release-hook', '"unbalanced'), '"unbalanced');
});

test('specify-budget is registered as an integer defaulting to 5, sibling of dispatch-batch-size (#1491)', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'specify-budget');
  assert.ok(key, 'specify-budget missing from POLICY_KEYS');
  assert.strictEqual(key.type, 'integer');
  assert.strictEqual(key.default, 5);
  assert.strictEqual(key.category, 'pipeline-behavior');
  assert.strictEqual(key.tier, 'advanced');
  assert.strictEqual(typeof key.summary, 'string');

  const repo = tmpRepo();
  writePolicy(repo, 'specify-budget: 7\n');
  assert.deepStrictEqual(auditPolicy(repo).invalidValues, []);

  const bad = tmpRepo();
  writePolicy(bad, 'specify-budget: not-a-number\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, 'a non-integer value must be flagged');
  assert.strictEqual(result.invalidValues[0].key, 'specify-budget');
});

test('design-variant-exploration is registered as an enum off|offer defaulting to off (#2540)', () => {
  const lever = POLICY_KEYS.find((k) => k.key === 'design-variant-exploration');
  assert.ok(lever, 'design-variant-exploration missing from POLICY_KEYS');
  assert.strictEqual(lever.type, 'enum');
  assert.deepStrictEqual(lever.values, ['off', 'offer']);
  assert.strictEqual(lever.default, 'off');
  assert.strictEqual(lever.category, 'pipeline-behavior');
  assert.strictEqual(lever.tier, 'advanced');

  const repo = tmpRepo();
  writePolicy(repo, 'design-variant-exploration: offer\n');
  const ok = auditPolicy(repo);
  assert.deepStrictEqual(ok.invalidValues, []);
  assert.deepStrictEqual(ok.unrecognizedKeys, []);

  const bad = tmpRepo();
  writePolicy(bad, 'design-variant-exploration: always\n');
  const result = auditPolicy(bad);
  assert.strictEqual(result.invalidValues.length, 1, 'a value outside the enum must be flagged');
  assert.strictEqual(result.invalidValues[0].key, 'design-variant-exploration');

  assert.strictEqual(resolveValue('design-variant-exploration', undefined), 'off');
  assert.strictEqual(resolveValue('design-variant-exploration', 'offer'), 'offer');
});

test('design-critique is registered as an enum off|auto|full defaulting to auto (#595)', () => {
  const lever = POLICY_KEYS.find((k) => k.key === 'design-critique');
  assert.ok(lever, 'design-critique missing from POLICY_KEYS');
  assert.strictEqual(lever.type, 'enum');
  assert.deepStrictEqual(lever.values, ['off', 'auto', 'full']);
  assert.strictEqual(lever.default, 'auto');
  assert.strictEqual(lever.category, 'pipeline-behavior');
  assert.strictEqual(lever.tier, 'advanced');
  assert.ok(!POLICY_KEYS.some((k) => k.key === 'design.critique'), 'the dotted spelling must not be registered — keys are flat kebab-case');
});

test('#4029 M4: the procedure-kb ceiling summaries say a run may read its procedure KB, not load it', () => {
  // procedure KB counts the bytes skill-file Reads returned, not what the harness loaded
  for (const key of ['fast-lane-run-procedure-kb-ceiling', 'standard-run-procedure-kb-ceiling']) {
    const { summary } = POLICY_KEYS.find((k) => k.key === key);
    assert.match(summary, / may read before /, key);
    assert.doesNotMatch(summary, /may load/, key);
    assert.ok(summary.length <= 140, `${key}: ${summary.length} chars`);
  }
});

// #5216: the express-driver keys — all policyOnly, so a --run config never sets them.
const DRIVER_CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');
// In-process (#5384): the child's stdout is what the assertions parse; the cwd is the fixture repo.
function driverCli(args, cwd) {
  const r = runCliSync(DRIVER_CLI, args, { cwd, env: { ...process.env } });
  return { stdout: r.stdout, stderr: r.stderr, status: r.code };
}
const DRIVER_KEYS = [
  { id: 'AC11.1', key: 'express-driver', def: 'off', other: 'on', policyVal: 'split' },
  { id: 'AC11.2', key: 'express-driver-wall-clock-minutes', def: 30, other: 99, policyVal: 5 },
  { id: 'AC11.3', key: 'express-driver-spend-ceiling-dollars', def: 10, other: 77, policyVal: 5 },
  { id: 'AC16.1', key: 'express-driver-review', def: 'beyond-express', other: 'on', policyVal: 'off' },
  { id: 'AC7.1 (#5224)', key: 'express-driver-max-size', def: 'low', other: 'medium', policyVal: 'medium' },
  { id: 'AC7.2 (#5224)', key: 'express-driver-max-key-files', def: 3, other: 9, policyVal: 5 },
  { id: 'AC7.3 (#5224)', key: 'express-driver-max-lines', def: 40, other: 999, policyVal: 120 },
  { id: 'AC8 (#6018)', key: 'express-driver-max-risk', def: 'low', other: 'high', policyVal: 'medium' },
];

// AC7 (#5384): the fresh-project cwd is the only input that yields `off` — this repo's own policy.yml pins `on`.
test('AC7.1: express-driver resolves off from the default in a fresh project', () => {
  const repo = tmpRepo();
  try {
    const r = driverCli(['express-driver'], repo);
    assert.deepStrictEqual(JSON.parse(r.stdout)['express-driver'], { value: 'off', source: 'default' });
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('AC6/express-driver: each value resolves; a malformed one falls back', () => {
  for (const v of ['split', 'on']) {
    assert.deepStrictEqual(resolvePolicyKeys(['express-driver'], { policyRaw: `express-driver: ${v}\n`, runConfigRaw: null })['express-driver'], { value: v, source: 'policy' });
  }
  assert.deepStrictEqual(resolvePolicyKeys(['express-driver'], { policyRaw: 'express-driver: half\n', runConfigRaw: null })['express-driver'], { value: 'off', source: 'default', invalid: true });
});

test('AC16: express-driver-review resolves its default from resolve-policy.js in a fresh project', () => {
  const repo = tmpRepo();
  try {
    const r = driverCli(['express-driver-review'], repo);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout)['express-driver-review'], { value: 'beyond-express', source: 'default' });
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('AC16: express-driver-review values resolve and a malformed one falls back', () => {
  for (const v of ['off', 'on', 'beyond-express']) {
    assert.deepStrictEqual(resolvePolicyKeys(['express-driver-review'], { policyRaw: `express-driver-review: ${v}\n`, runConfigRaw: null })['express-driver-review'], { value: v, source: 'policy' });
  }
  assert.deepStrictEqual(resolvePolicyKeys(['express-driver-review'], { policyRaw: 'express-driver-review: sometimes\n', runConfigRaw: null })['express-driver-review'], { value: 'beyond-express', source: 'default', invalid: true });
});

test('AC8.1, AC8.2 (#6018): express-driver-max-risk resolves low unset, each enum value from policy, and a malformed value to low with invalid', () => {
  const key = 'express-driver-max-risk';
  assert.deepStrictEqual(resolvePolicyKeys([key], { policyRaw: '', runConfigRaw: null })[key], { value: 'low', source: 'default' });
  for (const v of ['low', 'medium', 'high']) {
    assert.deepStrictEqual(resolvePolicyKeys([key], { policyRaw: `${key}: ${v}\n`, runConfigRaw: null })[key], { value: v, source: 'policy' });
  }
  for (const v of ['Medium', 'critical', '2']) {
    assert.deepStrictEqual(resolvePolicyKeys([key], { policyRaw: `${key}: ${v}\n`, runConfigRaw: null })[key], { value: 'low', source: 'default', invalid: true }, v);
  }
  const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets.js');
  const shared = path.join(__dirname, '..', 'plugin', 'skills', '_shared');
  assert.ok(fs.statSync(path.join(shared, 'policy-schema.md')).size < RAIL_BYTES);
  assert.match(readText(path.join(shared, 'policy-schema-express-driver.md')), /^\| `express-driver-max-risk` \| /m);
});

test('AC8.1: each ceiling resolves its default when unset, at or above the design targets', () => {
  const r = resolvePolicyKeys(['express-driver-wall-clock-minutes', 'express-driver-spend-ceiling-dollars'], { policyRaw: '', runConfigRaw: null });
  assert.deepStrictEqual(r['express-driver-wall-clock-minutes'], { value: 30, source: 'default' });
  assert.ok(r['express-driver-wall-clock-minutes'].value >= 15);
  assert.deepStrictEqual(r['express-driver-spend-ceiling-dollars'], { value: 10, source: 'default' });
  assert.ok(r['express-driver-spend-ceiling-dollars'].value >= 5);
});

test('AC8.2: a ceiling below 1, negative or non-integer falls back invalid', () => {
  const ceilings = ['express-driver-wall-clock-minutes', 'express-driver-spend-ceiling-dollars'];
  for (const { key, def } of DRIVER_KEYS.filter((k) => ceilings.includes(k.key))) {
    for (const bad of ['0', '-3', '1.5', 'abc']) {
      assert.deepStrictEqual(resolvePolicyKeys([key], { policyRaw: `${key}: ${bad}\n`, runConfigRaw: null })[key], { value: def, source: 'default', invalid: true }, `${key}=${bad}`);
    }
  }
});

for (const { id, key, def, other, policyVal } of DRIVER_KEYS) {
  test(`${id}: a run config cannot set ${key}`, () => {
    const viaRun = resolvePolicyKeys([key], { policyRaw: '', runConfigRaw: `${key}: ${other}\n` })[key];
    assert.deepStrictEqual(viaRun, { value: def, source: 'default' });
    const withPolicy = resolvePolicyKeys([key], { policyRaw: `${key}: ${policyVal}\n`, runConfigRaw: `${key}: ${other}\n` })[key];
    assert.deepStrictEqual(withPolicy, { value: policyVal, source: 'policy' });
  });

  test(`${id} via the CLI: resolve-policy.js --run ignores a run config that sets ${key}`, () => {
    const repo = tmpRepo();
    const runDir = scratchDir('ct-driver-run-');
    try {
      fs.writeFileSync(path.join(runDir, 'config.yml'), `${key}: ${other}\n`);
      const r = driverCli(['--run', runDir, key], repo);
      assert.deepStrictEqual(JSON.parse(r.stdout)[key], { value: def, source: 'default' });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
}

test('AC8.3: each ceiling\'s doc row states its unit', () => {
  const lines = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema-express-driver.md')).split('\n');
  // The summary cell alone: the key cell already spells the unit, so matching the whole row could not fail.
  const summaryOf = (key) => lines.find((l) => l.startsWith(`| \`${key}\` |`)).split('|')[5];
  assert.match(summaryOf('express-driver-wall-clock-minutes'), /\bminutes\b/i);
  assert.match(summaryOf('express-driver-spend-ceiling-dollars'), /\bwhole dollars\b/i);
});

test('AC11.4: the policyOnly bullet names every DRIVER_KEYS key', () => {
  const line = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema-coverage.md')).split('\n').find((l) => l.includes('are `policyOnly`'));
  for (const { key } of DRIVER_KEYS) assert.ok(line.includes('`' + key + '`'), key);
});

// #5917: express-driver-models, a policyOnly block key of per-role work profiles.
const MODELS = 'express-driver-models';
const FOUR = { implementer: 'standard', reviewer: 'capable', 'merge-check': 'standard', acceptance: 'standard' };
const rModels = (policyRaw, runConfigRaw = null) => resolvePolicyKeys([MODELS], { policyRaw, runConfigRaw })[MODELS];
const REJECTED = { value: null, source: 'default', invalid: true };

test('express-driver-models: unset resolves the four spec roles\' defaults, no explorer', () => {
  assert.deepStrictEqual(rModels(''), { value: FOUR, source: 'default' });
  assert.ok(!Object.hasOwn(rModels('').value, 'explorer'));
});

test('AC2.1: a policy.yml block sets one role and keeps the others', () => {
  const expected = { value: { ...FOUR, implementer: 'fast' }, source: 'policy' };
  assert.deepStrictEqual(rModels('express-driver-models:\n  implementer: fast\n'), expected);
  assert.deepStrictEqual(rModels('express-driver-models:\r\n  implementer: fast\r\n'), expected);
  assert.deepStrictEqual(rModels('express-driver-models:   # note\r\n  reviewer: standard   # why\r\n'), { value: { ...FOUR, reviewer: 'standard' }, source: 'policy' });
  assert.deepStrictEqual(rModels('express-driver-models:\n'), { value: FOUR, source: 'policy' });
});

test('express-driver-models: a rejected block resolves null invalid, never a partial map', () => {
  const bad = [
    'express-driver-models: fast\n',
    'express-driver-models:\n  scout: fast\n',
    'express-driver-models:\n  explorer: fast\n',
    'express-driver-models:\n  implementer: fast\n  explorer: capable\n',
    'express-driver-models:\n  implementer: turbo\n',
    'express-driver-models:\n  implementer: fast\n  implementer: capable\n',
    'express-driver-models:\n    implementer: fast\n',
    'express-driver-models:\n\timplementer: fast\n',
    'express-driver-models:\n  implementer:\n',
    'express-driver-models:\n  implementer: fast\nexpress-driver-models:\n  reviewer: fast\n',
  ];
  for (const raw of bad) {
    const seen = [];
    const got = resolvePolicyKeys([MODELS], { policyRaw: raw, runConfigRaw: null, onInvalid: (k) => seen.push(k) })[MODELS];
    assert.deepStrictEqual(got, REJECTED, JSON.stringify(raw));
    assert.deepStrictEqual(seen, [MODELS], JSON.stringify(raw));
  }
  assert.deepStrictEqual(rModels('express-driver-models:\n  implementer: fast\nautonomy: trusted\n'), { value: { ...FOUR, implementer: 'fast' }, source: 'policy' });
  // A following block's indented rows are not this block's rows: the next column-0 line closes it.
  assert.deepStrictEqual(rModels('express-driver-models:\n  implementer: fast\nmodel-profiles:\n  standard:\n    model: opus\n'), { value: { ...FOUR, implementer: 'fast' }, source: 'policy' });
});

test('AC2.2: a run config block never sets express-driver-models', () => {
  assert.deepStrictEqual(rModels('', 'express-driver-models:\n  implementer: fast\n'), { value: FOUR, source: 'default' });
  assert.strictEqual(rModels('express-driver-models:\n  reviewer: standard\n', 'express-driver-models:\n  implementer: fast\n').value.implementer, 'standard');
});

test('AC2.2 via the CLI: resolve-policy.js --run ignores the block in config.yml', () => {
  const repo = tmpRepo();
  const runDir = scratchDir('ct-driver-models-run-');
  try {
    fs.writeFileSync(path.join(runDir, 'config.yml'), 'express-driver-models:\n  implementer: fast\n');
    const r = driverCli(['--run', runDir, MODELS], repo);
    assert.deepStrictEqual(JSON.parse(r.stdout)[MODELS], { value: FOUR, source: 'default' });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('express-driver-models: --values refuses it, as a block key', () => {
  const repo = tmpRepo();
  try {
    const r = driverCli(['--values', MODELS], repo);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /--values does not support express-driver-models \(no scalar form\)/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('express-driver-models: registered policyOnly, advanced, models, map keyed by the four policy roles', () => {
  const row = POLICY_KEYS.find((k) => k.key === MODELS);
  assert.strictEqual(row.type, 'map');
  assert.strictEqual(row.policyOnly, true);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(row.category, 'models');
  assert.deepStrictEqual([...row.keys], ['implementer', 'reviewer', 'merge-check', 'acceptance']);
  assert.deepStrictEqual({ ...row.default }, FOUR);
  assert.ok(Object.isFrozen(row.default));
});

test('express-driver-models: auditPolicy flags an explorer row', () => {
  const repo = tmpRepo();
  try {
    writePolicy(repo, 'express-driver-models:\n  explorer: fast\n');
    const rows = auditPolicy(repo).invalidValues.filter((x) => x.key === MODELS);
    assert.strictEqual(rows.length, 1);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('express-driver-models: auditPolicy flags a rejected block once and a valid one never', () => {
  const cases = [['express-driver-models:\n  implementer: turbo\n', 1], ['express-driver-models: fast\n', 1], ['express-driver-models:\n  implementer: fast\n', 0]];
  for (const [policy, count] of cases) {
    const repo = tmpRepo();
    try {
      writePolicy(repo, policy);
      const audit = auditPolicy(repo);
      assert.strictEqual(audit.invalidValues.filter((x) => x.key === MODELS).length, count, policy);
      assert.deepStrictEqual(audit.unrecognizedKeys, [], policy);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  }
});

test('express-driver-models: the pre-change flat reader sees nothing of the block', () => {
  const { parseFlatLines } = require('../plugin/bin/lib/policy-schema');
  assert.deepStrictEqual(parseFlatLines('express-driver-models:\n  implementer: fast\n'), {});
});

test('AC11.4 (#5917): the policyOnly bullet names express-driver-models', () => {
  const line = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema-coverage.md')).split('\n').find((l) => l.includes('are `policyOnly`'));
  assert.ok(line.includes('`express-driver-models`'));
});

test('review-lens-dispatch resolves task by default and for an invalid value, workflow when set (#5599)', () => {
  const cases = [[null, 'task'], ['review-lens-dispatch: sideways\n', 'task'], ['review-lens-dispatch: workflow\n', 'workflow']];
  for (const [policy, expected] of cases) {
    const repo = tmpRepo();
    try {
      if (policy !== null) writePolicy(repo, policy);
      const r = driverCli(['--values', 'review-lens-dispatch'], repo);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout.trim(), expected, `policy.yml: ${policy}`);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  }
  // Neither policyOnly nor policySourceExcluded: /claude-tweaks:review Step 3 resolves it with --run, so a run config sets it for one review.
  const repo = tmpRepo();
  const runDir = scratchDir('ct-review-lens-run-');
  try {
    fs.writeFileSync(path.join(runDir, 'config.yml'), 'review-lens-dispatch: workflow\n');
    const r = driverCli(['--run', runDir, '--values', 'review-lens-dispatch'], repo);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), 'workflow', r.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

// #5224: the driver lane bound keys.
const LANE_KEYS = ['express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-lines'];
const resolveLane = (policyRaw, runConfigRaw = null, keys = LANE_KEYS) => resolvePolicyKeys(keys, { policyRaw, runConfigRaw });

test('AC5.1 (#5224): the size and Key File keys resolve the express values unset', () => {
  const r = resolveLane('');
  assert.deepStrictEqual(r['express-driver-max-size'], { value: 'low', source: 'default' });
  assert.deepStrictEqual(r['express-driver-max-key-files'], { value: 3, source: 'default' });
  assert.deepStrictEqual(r['express-driver-max-lines'], { value: 40, source: 'default' });
});

test('AC5.5 (#5224): express-driver-max-lines unset derives whatever auto-merge-max-lines holds', () => {
  const k = ['express-driver-max-lines'];
  assert.deepStrictEqual(resolveLane('auto-merge-max-lines: 77\n', null, k)['express-driver-max-lines'], { value: 77, source: 'default' });
  assert.deepStrictEqual(resolveLane('auto-merge-max-lines: x\n', null, k)['express-driver-max-lines'], { value: 40, source: 'default' });
  assert.deepStrictEqual(resolveLane('', 'auto-merge-max-lines: 55\n', k)['express-driver-max-lines'], { value: 55, source: 'default' });
  assert.deepStrictEqual(resolveLane('express-driver-max-lines: 0\nauto-merge-max-lines: 77\n', null, k)['express-driver-max-lines'], { value: 77, source: 'default', invalid: true });
});

test('AC5.2 (#5224): the Key File default equals EXPRESS_MAX_KEY_FILES', () => {
  const { EXPRESS_MAX_KEY_FILES } = require('../plugin/bin/lib/express/eligibility');
  assert.strictEqual(POLICY_KEYS.find((k) => k.key === 'express-driver-max-key-files').default, EXPRESS_MAX_KEY_FILES);
});

test('AC5.3 (#5224): malformed values never widen', () => {
  for (const bad of ['high', 'Medium', 'med']) {
    assert.deepStrictEqual(resolveLane(`express-driver-max-size: ${bad}\n`)['express-driver-max-size'], { value: 'low', source: 'default', invalid: true }, bad);
  }
  for (const bad of ['0', '2.5', 'x']) {
    assert.deepStrictEqual(resolveLane(`express-driver-max-key-files: ${bad}\n`)['express-driver-max-key-files'], { value: 3, source: 'default', invalid: true }, bad);
  }
  for (const bad of ['0', '-1', 'x']) {
    assert.deepStrictEqual(resolveLane(`express-driver-max-lines: ${bad}\n`)['express-driver-max-lines'], { value: 40, source: 'default', invalid: true }, bad);
  }
});

test('AC7.3 (#5224): a run config setting express-driver-max-lines and auto-merge-max-lines feeds only the derivation', () => {
  const k = ['express-driver-max-lines'];
  const both = 'express-driver-max-lines: 999\nauto-merge-max-lines: 55\n';
  assert.deepStrictEqual(resolveLane('', both, k)['express-driver-max-lines'], { value: 55, source: 'default' });
  assert.deepStrictEqual(resolveLane('auto-merge-max-lines: 77\n', both, k)['express-driver-max-lines'], { value: 55, source: 'default' });
  assert.deepStrictEqual(resolveLane('express-driver-max-lines: 120\n', both, k)['express-driver-max-lines'], { value: 120, source: 'policy' });
});

test('(#5224) the express-driver-max-lines summary names the reviewer condition', () => {
  const { summary } = POLICY_KEYS.find((k) => k.key === 'express-driver-max-lines');
  assert.match(summary, /reviewer step is on/);
  assert.ok(summary.length <= 140, `${summary.length}`);
});

test('AC5.4 (#5224): set values resolve from policy', () => {
  const r = resolveLane('express-driver-max-size: medium\nexpress-driver-max-key-files: 5\nexpress-driver-max-lines: 120\n');
  assert.deepStrictEqual(r['express-driver-max-size'], { value: 'medium', source: 'policy' });
  assert.deepStrictEqual(r['express-driver-max-key-files'], { value: 5, source: 'policy' });
  assert.deepStrictEqual(r['express-driver-max-lines'], { value: 120, source: 'policy' });
});

// --- #4492: policy.yml located through the main checkout from a linked worktree ---
const { resolvePolicyConfig, resolveIntegrationModel, resolveForgeProbeTimeoutMs } = require('../plugin/bin/lib/policy-schema');

function worktreeFixture(t, policy = 'integration-branch: develop\nworktree-always: true\n') {
  // realpath: the main-checkout lookup resolves symlinks (macOS /var -> /private/var).
  const base = fs.realpathSync(scratchDir('policy-wt-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
  if (policy !== null) fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), policy);
  return { main, wt };
}

function fakeTopLevelGit(top) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args.join(' ') === 'rev-parse --show-toplevel') return `${top}\n`;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  git.calls = calls;
  return git;
}

const realRead = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

test('AC5.1: resolvePolicyConfig, fake git runner — worktree file present: reads it, policySource checkout', (t) => {
  const { wt } = worktreeFixture(t);
  fs.mkdirSync(path.join(wt, '.claude-tweaks'));
  fs.writeFileSync(path.join(wt, '.claude-tweaks', 'policy.yml'), 'integration-branch: release\n');
  const git = fakeTopLevelGit(wt);
  const out = resolvePolicyConfig({ git, readFile: realRead, keys: ['integration-branch'] });
  assert.strictEqual(out.policySource, 'checkout');
  assert.strictEqual(out.policyPath, path.join(wt, '.claude-tweaks', 'policy.yml'));
  assert.strictEqual(out.result['integration-branch'].value, 'release');
  assert.deepStrictEqual(git.calls, [['rev-parse', '--show-toplevel']]);
});

test('AC5.1: resolvePolicyConfig, fake git runner — worktree absent, main present: reads main\'s, policySource main-checkout', (t) => {
  const { main, wt } = worktreeFixture(t);
  const out = resolvePolicyConfig({ git: fakeTopLevelGit(wt), readFile: realRead, keys: ['integration-branch'] });
  assert.strictEqual(out.policySource, 'main-checkout');
  assert.strictEqual(out.policyPath, path.join(main, '.claude-tweaks', 'policy.yml'));
  assert.strictEqual(out.result['integration-branch'].value, 'develop');
});

test('AC5.1: resolvePolicyConfig, fake git runner — both absent: policyRaw null, policySource checkout, every key at its default', (t) => {
  const { wt } = worktreeFixture(t, null);
  const out = resolvePolicyConfig({ git: fakeTopLevelGit(wt), readFile: realRead, keys: ['integration-branch', 'worktree-always'] });
  assert.strictEqual(out.policyRaw, null);
  assert.strictEqual(out.policySource, 'checkout');
  assert.strictEqual(out.policyPath, path.join(wt, '.claude-tweaks', 'policy.yml'));
  assert.strictEqual(out.result['integration-branch'].source, 'default');
  assert.strictEqual(out.result['worktree-always'].source, 'default');
});

test('resolveIntegrationModel from a linked worktree honors the main checkout\'s integration-model pin', (t) => {
  // pr-first, not local-merge: local-merge is also what detection returns for this forge-less fixture.
  const { wt } = worktreeFixture(t, 'integration-model: pr-first\n');
  assert.strictEqual(resolveIntegrationModel(wt), 'pr-first');
});

test('resolveForgeProbeTimeoutMs from a linked worktree reads the main checkout\'s gh-timeout-ms', (t) => {
  const { wt } = worktreeFixture(t, 'gh-timeout-ms: 7000\n');
  assert.strictEqual(resolveForgeProbeTimeoutMs(wt, { env: {} }), 7000);
});

test('auditPolicy from a linked worktree still reads CLAUDE.md at the worktree root', (t) => {
  const { wt } = worktreeFixture(t);
  fs.writeFileSync(path.join(wt, 'CLAUDE.md'), 'integration-branch: release\n');
  const keys = auditPolicy(wt).migratableKeys.map((row) => row.key);
  assert.ok(keys.includes('integration-branch'));
});

test('AC1.1: resolvePolicyConfig from a linked worktree without policy.yml reads the main checkout\'s — integration-branch develop, policySource main-checkout', (t) => {
  const { wt } = worktreeFixture(t);
  const out = resolvePolicyConfig({ git: fakeTopLevelGit(wt), readFile: realRead, keys: ['integration-branch'] });
  assert.strictEqual(out.root, wt);
  assert.strictEqual(out.result['integration-branch'].value, 'develop');
  assert.strictEqual(out.policySource, 'main-checkout');
});

test('AC2.1: resolvePolicyConfig — a worktree policy.yml wins; the main checkout\'s is not read', (t) => {
  const { main, wt } = worktreeFixture(t);
  fs.mkdirSync(path.join(wt, '.claude-tweaks'));
  fs.writeFileSync(path.join(wt, '.claude-tweaks', 'policy.yml'), 'integration-branch: release\n');
  const reads = [];
  const readFile = (p) => { reads.push(p); return realRead(p); };
  const out = resolvePolicyConfig({ git: fakeTopLevelGit(wt), readFile, keys: ['integration-branch'] });
  assert.strictEqual(out.result['integration-branch'].value, 'release');
  assert.ok(!reads.includes(path.join(main, '.claude-tweaks', 'policy.yml')));
});

test('AC3.1: resolvePolicyConfig from the main checkout — policySource checkout, same result as before', (t) => {
  const { main } = worktreeFixture(t);
  const out = resolvePolicyConfig({ git: fakeTopLevelGit(main), readFile: realRead, keys: ['integration-branch'] });
  assert.strictEqual(out.policySource, 'checkout');
  assert.strictEqual(out.policyPath, path.join(main, '.claude-tweaks', 'policy.yml'));
  assert.strictEqual(out.result['integration-branch'].value, 'develop');
  assert.strictEqual(out.root, main);
});

test('auditPolicy from a linked worktree audits the main checkout\'s policy.yml', (t) => {
  const { wt } = worktreeFixture(t, 'integration-branch: develop\nbogus-key: 1\n');
  assert.ok(auditPolicy(wt).unrecognizedKeys.includes('bogus-key'));
});
