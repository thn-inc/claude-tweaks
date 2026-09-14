'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { POLICY_KEYS, RENAMED_KEYS, auditPolicy, resolveValue, resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-policy-schema-'));
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
  // 35 -> 37, #269 (backlog grant mode): grant-origination-enabled and
  // fleet-daily-grant-cap, the reserved opt-in + the mode's own soft cap.
  // 37 -> 42, #219 (model-profile levers): model-stance, frontier-run-cap,
  // model-ceiling, model-profiles, research-mode — count recomputed from the
  // merged list at conflict resolution, never summed from either side (IL-99).
  // 42 -> 44, #274 (experiment-cleanup vertical): experiment-flag-patterns,
  // experiment-flag-exclude — the repo's flag idiom + kill-switch exclusion.
  // 44 -> 45, #330 (prose migration): health-open-cap — documented in
  // _shared/policy-schema.md since #235 but never registered; the resolver
  // migration surfaced the gap (unknown-key for a documented lever).
  // 45 -> 41, #331 (key collapse): execution.always merged into
  // execution-strategy's widened enum, merge-check renamed to
  // branch-divergence-check, and review-diff-heuristic-thresholds /
  // promise-register-min-leaves / section-confirmation retired outright —
  // five rows out, one (branch-divergence-check) in; RENAMED_KEYS carries
  // all five migrations.
  // 41 -> 43, #366 (oversight-floor predicate): risk-floor, size-floor — the
  // shared floors grant-gate.js's gate 5 and /claude-tweaks:demo's binary gate
  // both read via exceedsOversightFloor.
  // 43 -> 44, #406 (pr-first integration model): integration-model — no static
  // default (computed at resolve time by bin/resolve-policy.js's forge
  // detection instead), see skills/_shared/integration-model.md.
  // 44 -> 47, #414 (sweep backstop): pr-unarmed-age-hours, unsettled-age-hours,
  // housekeeping-auto-merge — the two threshold keys plus the tidy
  // housekeeping-PR arming grant, see skills/_shared/github-pr-scan.md's
  // 'unarmed ready PR' check.
  // 47 -> 48, #363 (plans-retention policy): superpowers-plans-retention —
  // configurable docs/superpowers/plans/*.md retention at wrap-up cleanup
  // item 1, default keep-forever preserves today's unconditional behavior.
  // 48 -> 49, #559 (merge-verification): CI-verification lever for merges
  // into the integration branch, default derived by bin/lib/merge-verification.js.
  // 49 -> 50, #595 (design-critique lever): off | auto | full, default auto —
  // governs whether project-local design critics run at review time.
  // 50 -> 51, #645 (session-scoped record snapshot): record-snapshot-ttl-seconds
  // — freshness window for /tmp/ct-records-{session-id}.json, shared by
  // backlog/capture/specify/trust-table/help/tidy/visualize.
  // 51 -> 52, #715 (merge-authorization lever): lets a human pre-authorize,
  // at Manifesto time, that this run should merge itself once every
  // HARD-GATE is green — policy.yml is deliberately excluded as a source
  // (see resolvePolicyKeys' merge-authorization special case).
  // 52 -> 53, #310 (sampling floor): grant-sampling-every — every Nth
  // machine-granted merged record is flagged for a real /demo verdict, so
  // human calibration evidence keeps entering the trust table.
  // 53 -> 54, #660 (review prose-exemption lever): review-auto-apply-prose-exempt
  // — lets a prose-only fix auto-apply one severity tier above the resolved
  // review-auto-apply-ceiling, see skills/review/step3-routing.md.
  // 54 -> 59, #194 (Phase 2 doc-convention wiring): doc-convention-tutorial,
  // doc-convention-how-to, doc-convention-reference, doc-convention-explanation,
  // doc-convention-journey — one enum key per newly-wired Diátaxis/Journey genre,
  // same shape as doc-convention-adr.
  // 59 -> 60, #357 (ui-stack decision point): ui-stack — free-form string
  // naming the UI component library/styling approach a frontend build should
  // use, mirrors integration-branch's no-static-default shape.
  // 60 -> 61, #1137 (brainstorming auto-continue): specify-auto-continue —
  // lets a session invoke /claude-tweaks:specify on an approved brainstorming
  // design doc immediately, see skills/specify/SKILL.md's Auto-continue section.
  // 61 -> 62, #309 (veto-window maturation): grant-veto-window-hours — how
  // long a machine-granted auto:merge-pending grant must sit unvetoed before
  // /claude-tweaks:dispatch's Auto-merge gate matures it to auto:merge.
  // 62 -> 63, #1654 (dispatch group-size guard lever): dispatch-group-size-guard
  // — headless `next` selection's file-overlap group-size exclusion threshold,
  // wired through the same policy.yml precedence chain as its dispatch-batch-size
  // sibling; grouping.js's GROUP_SIZE_GUARD_DEFAULT stays the unset fallback.
  // 63 -> 64, #1491 (specify drain budget): specify-budget — default
  // attempt-count budget for a bare /specify drain invocation, sibling of
  // dispatch-batch-size; the shared n/all --budget semantics are canonical in
  // _shared/record-batch-input.md, not restated here.
  // 64 -> 65, #1792 (port isolation): port-services — names the services
  // that get a port from this checkout's leased block; read directly by
  // SessionStart, not an auto-mode lever.
  // 65 -> 66, #1910 (fast-lane bundling): dispatch-fastlane-bundle-cap —
  // caps how many non-overlapping ceremony:fast-lane singleton dispatch
  // groups queue-pull-script.md folds into one multi-spec group; 0 disables
  // bundling, grouping.js's FASTLANE_BUNDLE_CAP_DEFAULT stays the unset
  // fallback (sibling of #1654's dispatch-group-size-guard above).
  // 66 -> 67, #1886 (design-ceremony lever): design-ceremony — new static
  // per-project policy key gating whether /claude-tweaks:specify's
  // /superpowers:brainstorming handoff prepends a per-section-approval
  // consolidation instruction (fast-lane) or leaves the invocation
  // unchanged (standard, the default).
  // 67 -> 69, #2253 (release family, unit 3): release-hook — the local
  // engine's post-tag publish/mirror/deploy command, ignored under
  // pr-first; release-train — opt-in for the unattended release train,
  // honored only at autonomy: unattended. Both non-core scaffolding seeded
  // commented-out by /claude-tweaks:init Step 21; consumers land in units 4 and 6.
  assert.strictEqual(POLICY_KEYS.length, 69);
  assert.strictEqual(new Set(POLICY_KEYS.map((k) => k.key)).size, 69);
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
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'policy-schema.js'), 'utf8');
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
