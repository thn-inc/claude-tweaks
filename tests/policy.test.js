'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { isWorktreeAlwaysOn, resolveWorktreeAlways, readIntegrationBranch, readListKey, readCommitScope, readGhTimeoutMs, readEfficiencyCeilings, readChangelogMaxReleases } = require('../plugin/bin/lib/policy');

function tmpRepo() {
  return scratchDir('ct-policy-');
}
function writePolicy(repo, content) {
  const dir = path.join(repo, '.claude-tweaks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'policy.yml'), content);
}

test('missing policy file -> false', () => {
  assert.strictEqual(isWorktreeAlwaysOn(tmpRepo()), false);
});

test('worktree-always: true -> true', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('worktree-always: false -> false', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: false\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), false);
});

test('unrelated keys and near-miss lines -> false', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'issues.autonomous-eligibility: any\nworktree-something-else: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), false);
});

test('tolerates extra whitespace around the value', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always:    true  \n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('the key can appear alongside other policy lines in either order', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'issues.autonomous-eligibility: label agent:eligible\nworktree-always: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('a trailing inline # comment after true is ignored, not treated as policy-OFF', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: true  # enabled after the incident on 2026-07-10\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('a trailing inline # comment with no space before it is still ignored', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: true# comment\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('garbage trailing content that is not a # comment is still rejected', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: true and some other text\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), false);
});

test('isWorktreeAlwaysOn: a trailing inline # comment is tolerated through the pre-#602 alias — worktree.always: true  # note still reads as ON', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree.always: true  # note\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('isWorktreeAlwaysOn: the new spelling worktree-always: true reads as ON', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('isWorktreeAlwaysOn: the pre-#602 spelling worktree.always: true still reads as ON through the RENAMED_KEYS alias — an un-migrated project never silently loses the gate', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree.always: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), true);
});

test('isWorktreeAlwaysOn: when both spellings are set the new line wins — worktree-always: false beats worktree.always: true (same precedence as the resolver)', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: false\nworktree.always: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), false);
  const repo2 = tmpRepo();
  writePolicy(repo2, 'worktree.always: false\nworktree-always: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo2), true, 'order in the file does not matter — the new NAME wins, not the last line');
});

test('isWorktreeAlwaysOn: an invalid new-name value beside a valid old-name line still lets the new NAME win — the gate reads OFF, matching the resolver (deliberate: presence of the new name ends the alias window for that file)', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: yes\nworktree.always: true\n');
  assert.strictEqual(isWorktreeAlwaysOn(repo), false);
});

// resolveWorktreeAlways: direct unit coverage of the {on, matchedKey} pair
// session-start.js's verdict banner and isWorktreeAlwaysOn's gate both consume
// (IL-133) — cheaper to keep green than the session-start integration tests alone.

test('resolveWorktreeAlways: old key only -> {on: true, matchedKey: "worktree.always"}', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree.always: true\n');
  assert.deepStrictEqual(resolveWorktreeAlways(repo), { on: true, matchedKey: 'worktree.always' });
});

test('resolveWorktreeAlways: new key only -> {on: true, matchedKey: "worktree-always"}', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree-always: true\n');
  assert.deepStrictEqual(resolveWorktreeAlways(repo), { on: true, matchedKey: 'worktree-always' });
});

test('resolveWorktreeAlways: both keys present -> new key wins, matchedKey is "worktree-always"', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree.always: false\nworktree-always: true\n');
  assert.deepStrictEqual(resolveWorktreeAlways(repo), { on: true, matchedKey: 'worktree-always' });
});

test('resolveWorktreeAlways: neither key present -> {on: false, matchedKey: null}', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'integration-branch: main\n');
  assert.deepStrictEqual(resolveWorktreeAlways(repo), { on: false, matchedKey: null });
});

test('resolveWorktreeAlways: no policy.yml at all -> {on: false, matchedKey: null}', () => {
  assert.deepStrictEqual(resolveWorktreeAlways(tmpRepo()), { on: false, matchedKey: null });
});

test('readIntegrationBranch: key present -> returns the branch name', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'integration-branch: staging\n');
  assert.strictEqual(readIntegrationBranch(repo), 'staging');
});

test('readIntegrationBranch: key absent -> null', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree.always: true\n');
  assert.strictEqual(readIntegrationBranch(repo), null);
});

test('readIntegrationBranch: no policy file at all -> null', () => {
  assert.strictEqual(readIntegrationBranch(tmpRepo()), null);
});

test('readIntegrationBranch: key present with a trailing comment is tolerated', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'integration-branch: dev  # not main, see CLAUDE.md\n');
  assert.strictEqual(readIntegrationBranch(repo), 'dev');
});

test('readListKey: key present -> parsed, trimmed array', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'experiment-flag-patterns: foo, bar ,baz\n');
  assert.deepStrictEqual(readListKey(repo, 'experiment-flag-patterns'), ['foo', 'bar', 'baz']);
});

test('readListKey: key absent -> []', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'worktree.always: true\n');
  assert.deepStrictEqual(readListKey(repo, 'experiment-flag-patterns'), []);
});

test('readListKey: key present but empty -> []', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'experiment-flag-patterns: \n');
  assert.deepStrictEqual(readListKey(repo, 'experiment-flag-patterns'), []);
});

test('readListKey: no policy file at all -> []', () => {
  assert.deepStrictEqual(readListKey(tmpRepo(), 'experiment-flag-patterns'), []);
});

test('AC10.1: readCommitScope: key present -> the token; absent or blank -> null', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'commit-scope: api\n');
  assert.strictEqual(readCommitScope(repo), 'api');
  const blank = tmpRepo();
  writePolicy(blank, 'commit-scope: \n');
  assert.strictEqual(readCommitScope(blank), null);
  assert.strictEqual(readCommitScope(tmpRepo()), null);
});

test("readCommitScope returns the trimmed value without schema validation — a whitespace-bearing token reaches the composer's own check", () => {
  const repo = tmpRepo();
  writePolicy(repo, 'commit-scope: web app\n');
  assert.strictEqual(readCommitScope(repo), 'web app');
});

test('readListKey: a single value with no commas -> a one-element array', () => {
  const repo = tmpRepo();
  const pattern = 'isEnabled\\w+';
  writePolicy(repo, `experiment-flag-patterns: ${pattern}\n`);
  assert.deepStrictEqual(readListKey(repo, 'experiment-flag-patterns'), [pattern]);
});

test('readListKey: trailing comment is stripped before splitting', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'experiment-flag-exclude: rollback,failsafe  # extends the shipped defaults\n');
  assert.deepStrictEqual(readListKey(repo, 'experiment-flag-exclude'), ['rollback', 'failsafe']);
});

test('readListKey: a dotted key name (e.g. harness-health.scoped-rule-budget-style) resolves without regex-metachar corruption', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'doc-convention.adr: plugin\nexperiment-flag-patterns: a,b\n');
  assert.deepStrictEqual(readListKey(repo, 'experiment-flag-patterns'), ['a', 'b']);
});

// readGhTimeoutMs (#2567) — thin wrapper over policy-schema.js's own
// resolveValue for the `gh-timeout-ms` key; these pin that the wrapper wires
// parsePolicy's raw string through correctly, not policy-schema's own
// validation logic (already covered by policy-schema.test.js).

test('readGhTimeoutMs: no policy file -> the schema default (5000)', () => {
  assert.strictEqual(readGhTimeoutMs(tmpRepo()), 5000);
});

test('readGhTimeoutMs: a valid in-range value is used', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'gh-timeout-ms: 12000\n');
  assert.strictEqual(readGhTimeoutMs(repo), 12000);
});

test('readGhTimeoutMs: an out-of-range value falls back to the default', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'gh-timeout-ms: 100\n'); // under the schema's 1000 min
  assert.strictEqual(readGhTimeoutMs(repo), 5000);
});

test('readGhTimeoutMs: a non-integer value falls back to the default', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'gh-timeout-ms: soon\n');
  assert.strictEqual(readGhTimeoutMs(repo), 5000);
});

// readEfficiencyCeilings (#4029) — the six per-ceremony-profile efficiency
// budgets phase-timing.js --check-budgets compares a run's totals against.

test('#4029: readEfficiencyCeilings resolves defaults, a policy override, and an invalid value back to default', () => {
  const repo = tmpRepo();
  writePolicy(repo, 'fast-lane-run-round-trip-ceiling: 5\nstandard-run-verify-minutes-ceiling: abc\n');
  assert.deepStrictEqual(readEfficiencyCeilings(repo, 'fast-lane'), { roundTrips: 5, procedureKb: 560, verifyMinutes: 21 });
  assert.deepStrictEqual(readEfficiencyCeilings(repo, 'standard'), { roundTrips: 900, procedureKb: 580, verifyMinutes: 37 });
  assert.throws(() => readEfficiencyCeilings(repo, 'turbo'), TypeError);
});

test('#4029: readEfficiencyCeilings: no policy file -> the shipped defaults; 0 passes through as "budget disabled"', () => {
  assert.deepStrictEqual(readEfficiencyCeilings(tmpRepo(), 'standard'), { roundTrips: 900, procedureKb: 580, verifyMinutes: 37 });
  const repo = tmpRepo();
  writePolicy(repo, 'standard-run-procedure-kb-ceiling: 0\nstandard-run-round-trip-ceiling: -3\n');
  const got = readEfficiencyCeilings(repo, 'standard');
  assert.strictEqual(got.procedureKb, 0);
  assert.strictEqual(got.roundTrips, 900, 'a negative value is under min 0 and falls back to the default');
});

test('AC15.1: changelog-max-releases values -1, 1.5 and abc resolve to 0', () => {
  for (const v of ['-1', '1.5', 'abc']) {
    assert.deepStrictEqual(readChangelogMaxReleases(() => `changelog-max-releases: ${v}\n`), { count: 0, error: null });
  }
});
test('changelog-max-releases: absent file and absent key are 0; 50 is 50', () => {
  assert.deepStrictEqual(readChangelogMaxReleases(() => null), { count: 0, error: null });
  assert.deepStrictEqual(readChangelogMaxReleases(() => 'git-strategy: worktree\n'), { count: 0, error: null });
  assert.deepStrictEqual(readChangelogMaxReleases(() => 'changelog-max-releases: 50\n'), { count: 50, error: null });
});
test('changelog-max-releases: the schema row is an integer >= 0, default 0, read from policy.yml alone', () => {
  const row = require('../plugin/bin/lib/policy-schema').POLICY_KEYS.find((k) => k.key === 'changelog-max-releases');
  assert.strictEqual(row.type, 'integer');
  assert.strictEqual(row.min, 0);
  assert.strictEqual(row.default, 0);
  assert.strictEqual(row.policyOnly, true, 'both engines read policy.yml directly, so a run config must never carry a value for it');
});

test('model-effort is policyOnly: resolve-profile.js reads policy.yml directly and no per-run route exists (#5941)', () => {
  const row = require('../plugin/bin/lib/policy-schema').POLICY_KEYS.find((k) => k.key === 'model-effort');
  assert.strictEqual(row.policyOnly, true);
});
test('changelog-max-releases: an unreadable policy file is reported, not read as 0 silently', () => {
  const r = readChangelogMaxReleases(() => { throw new Error('EISDIR: illegal operation on a directory'); });
  assert.strictEqual(r.count, 0);
  assert.match(r.error, /EISDIR/);
});
test('changelog-max-releases: a non-Error or empty-message throw still yields a non-empty reason', () => {
  for (const thrown of [new Error(''), 'plain string', undefined, null]) {
    const r = readChangelogMaxReleases(() => { throw thrown; });
    assert.strictEqual(r.count, 0);
    assert.strictEqual(typeof r.error, 'string');
    assert.ok(r.error.length > 0, `reason for ${String(thrown)}`);
  }
  assert.strictEqual(readChangelogMaxReleases(() => { throw 'plain string'; }).error, 'plain string');
});

// --- #4492: readers fall back to the main checkout's policy.yml from a linked worktree ---
function linkedWorktree(t, policy) {
  const base = scratchDir('policy-wt-');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), policy);
  return wt;
}

test('AC1.1: readIntegrationBranch and isWorktreeAlwaysOn read the main checkout\'s policy from a linked worktree root', (t) => {
  const wt = linkedWorktree(t, 'integration-branch: develop\nworktree-always: true\n');
  assert.strictEqual(readIntegrationBranch(wt), 'develop');
  assert.strictEqual(isWorktreeAlwaysOn(wt), true);
});

test('readRiskPolicy from a linked worktree reads the main checkout\'s control-mode', (t) => {
  const wt = linkedWorktree(t, 'control-mode: on\nrisk-categories: billing\n');
  const { readRiskPolicy } = require('../plugin/bin/lib/policy');
  const risk = readRiskPolicy(wt);
  assert.strictEqual(risk.controlMode, true);
  assert.deepStrictEqual(risk.extraCategories, ['billing']);
});

test('readRiskPolicy with a non-string repoRoot throws a TypeError before calling readFile', () => {
  const { readRiskPolicy } = require('../plugin/bin/lib/policy');
  let called = false;
  assert.throws(() => readRiskPolicy(null, { readFile: () => { called = true; return ''; } }), TypeError);
  assert.strictEqual(called, false);
});

test('planning-decisions is policyOnly, defaults to ask-all and offers exactly ask-all and asked-classes (#6051)', () => {
  const row = require('../plugin/bin/lib/policy-schema').POLICY_KEYS.find((k) => k.key === 'planning-decisions');
  assert.ok(row, 'planning-decisions row exists');
  assert.strictEqual(row.policyOnly, true);
  assert.strictEqual(row.default, 'ask-all');
  assert.deepStrictEqual(row.values, ['ask-all', 'asked-classes']);
  assert.ok(!row.summary.startsWith('Not yet used'));
  assert.ok(!row.policySourceExcluded);
});

test('planning-decisions resolves ask-all when unset and when invalid (#6051)', () => {
  const { resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');
  const resolve = (policyRaw) => resolvePolicyKeys(['planning-decisions'], { policyRaw, runConfigRaw: null })['planning-decisions'];
  assert.deepStrictEqual(resolve(''), { value: 'ask-all', source: 'default' });
  const bad = resolve('planning-decisions: ask-some\n');
  assert.strictEqual(bad.value, 'ask-all');
  assert.strictEqual(bad.invalid, true);
  const good = resolve('planning-decisions: asked-classes\n');
  assert.strictEqual(good.value, 'asked-classes');
  assert.strictEqual(good.source, 'policy');
});

// #6056: plan-at-specify — shaping-time planning, refused while planning-decisions is ask-all.
const PLAN_AT_SPECIFY_CONFLICT_LINE = 'resolve-policy: warning: plan-at-specify is on but planning-decisions is ask-all — using "off"; set planning-decisions: asked-classes to plan at /claude-tweaks:specify\n';
const resolvePlanAtSpecify = (opts) => require('../plugin/bin/lib/policy-schema').resolvePolicyKeys(['plan-at-specify'], opts)['plan-at-specify'];

test('#6119 express-driver-runner: enum session|script, default session, policyOnly, factory-refused', () => {
  const { POLICY_KEYS, resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');
  const { FACTORY_REFUSED_KEYS } = require('../plugin/bin/lib/policy-factory');
  const K = 'express-driver-runner';
  const row = POLICY_KEYS.find((k) => k.key === K);
  assert.ok(row, 'express-driver-runner row exists');
  assert.strictEqual(row.type, 'enum');
  assert.deepStrictEqual(row.values, ['session', 'script']);
  assert.strictEqual(row.default, 'session');
  assert.strictEqual(row.policyOnly, true);
  assert.strictEqual(row.tier, 'advanced');
  assert.ok(FACTORY_REFUSED_KEYS.includes(K));
  const read = (policyRaw) => resolvePolicyKeys([K], { policyRaw })[K];
  assert.deepStrictEqual(read(''), { value: 'session', source: 'default' });
  assert.strictEqual(read('express-driver-runner: script\n').value, 'script');
  const bad = read('express-driver-runner: Script\n');
  assert.strictEqual(bad.value, 'session');
  assert.strictEqual(bad.invalid, true);
});

test('learned-skills-auto-merge is policyOnly, advanced, merge-safety, default false, factory-settable (#6109)', () => {
  const K = 'learned-skills-auto-merge';
  const row = require('../plugin/bin/lib/policy-schema').POLICY_KEYS.find((k) => k.key === K);
  const { FACTORY_REFUSED_KEYS } = require('../plugin/bin/lib/policy-factory');
  assert.ok(row, 'learned-skills-auto-merge row exists');
  assert.strictEqual(row.policyOnly, true);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(row.category, 'merge-safety');
  assert.strictEqual(row.default, false);
  assert.ok(!FACTORY_REFUSED_KEYS.includes(K));
});

test('plan-at-specify is policyOnly, defaults to off, offers exactly off and on, and is factory-settable (#6056)', () => {
  const row = require('../plugin/bin/lib/policy-schema').POLICY_KEYS.find((k) => k.key === 'plan-at-specify');
  const { FACTORY_REFUSED_KEYS } = require('../plugin/bin/lib/policy-factory');
  assert.ok(row, 'plan-at-specify row exists');
  assert.strictEqual(row.policyOnly, true);
  assert.strictEqual(row.default, 'off');
  assert.deepStrictEqual(row.values, ['off', 'on']);
  assert.strictEqual(row.category, 'pipeline-behavior');
  assert.strictEqual(row.tier, 'advanced');
  assert.ok(!row.summary.startsWith('Not yet used'));
  assert.ok(!row.policySourceExcluded);
  assert.ok(!FACTORY_REFUSED_KEYS.includes('plan-at-specify'));
});

test('AC1.1: plan-at-specify resolves off when unset, when off, and when malformed, with no conflict field (#6056)', () => {
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: '' }), { value: 'off', source: 'default' });
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: off\n' }), { value: 'off', source: 'policy' });
  const bad = resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: yes\n' });
  assert.strictEqual(bad.value, 'off');
  assert.strictEqual(bad.invalid, true);
  assert.ok(!('conflict' in bad));
});

test('Deliverable 9: on with planning-decisions ask-all (unset, explicit or malformed) resolves off with the conflict, source kept (#6056)', () => {
  const refused = { value: 'off', source: 'policy', conflict: 'planning-decisions' };
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\n' }), refused);
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\nplanning-decisions: ask-all\n' }), refused);
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\nplanning-decisions: ask-some\n' }), refused);
  // An invalid planning-decisions resolves the default (ask-all), never the next source's value.
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\nplanning-decisions: ask-some\n', factoryRaw: 'planning-decisions: asked-classes\n' }), refused);
  // A factory-sourced on is refused the same way, keeping the factory source.
  assert.deepStrictEqual(resolvePlanAtSpecify({ factoryRaw: 'plan-at-specify: on\n' }), { ...refused, source: 'factory' });
});

test('Deliverable 9: on with asked-classes resolves on, from the policy or the factory layer (#6056)', () => {
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }), { value: 'on', source: 'policy' });
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\n', factoryRaw: 'planning-decisions: asked-classes\n' }), { value: 'on', source: 'policy' });
  assert.deepStrictEqual(resolvePlanAtSpecify({ factoryRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }), { value: 'on', source: 'factory' });
});

test('a run config sets neither plan-at-specify nor the planning-decisions it is checked against (#6056)', () => {
  assert.deepStrictEqual(
    resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\n', runConfigRaw: 'planning-decisions: asked-classes\n' }),
    { value: 'off', source: 'policy', conflict: 'planning-decisions' },
  );
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: '', runConfigRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }), { value: 'off', source: 'default' });
});

test('Deliverable 9: warningLines names the conflict in every mode, from a real resolvePolicyKeys reply (#6056)', () => {
  const { resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');
  const { warningLines } = require('../plugin/bin/resolve-policy');
  const keys = ['plan-at-specify'];
  const conflicted = { keys, result: resolvePolicyKeys(keys, { policyRaw: 'plan-at-specify: on\n' }), invalidRaw: new Map(), degrades: new Map() };
  for (const values of [true, false]) assert.deepStrictEqual(warningLines(conflicted, { values }), [PLAN_AT_SPECIFY_CONFLICT_LINE]);
  const clean = { ...conflicted, result: resolvePolicyKeys(keys, { policyRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }) };
  for (const values of [true, false]) assert.deepStrictEqual(warningLines(clean, { values }), []);
});
