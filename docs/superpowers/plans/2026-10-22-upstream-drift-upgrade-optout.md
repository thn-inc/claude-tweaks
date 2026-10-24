# Upstream-drift upgrade opt-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manifest entry can set `report-upgrades: false` so `tools/upstream-drift/run.js` never reports `upgrade-available` for it (nor counts an upgrade as a reason it is due); `claude-code` sets it.

**Architecture:** One optional, boolean, per-entry manifest key validated in `manifest.js`. `run.js`'s `evaluate()` copies it onto the evaluation as `reportUpgrades`, and `hasUpgrade()` — already the single predicate shared by `isDue`, `buildFindings` and `cmdDue`'s reason list — returns `false` when it is `false`. Drift findings (pin-breach, absent, assertion-*, fixture-breach) are untouched.

**Tech Stack:** Node 18+, `node --test`, the hand-rolled YAML subset parser in `tools/upstream-drift/manifest.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T131631-record-3820/work/3820-spec.md` (record #3820)

**Scope keywords:** upgrade-available, hasUpgrade, report-upgrades

## Global Constraints

- Maintainer-only tooling under `tools/` — nothing under `plugin/` changes; no release note ("No user-visible change").
- Key name is exactly `report-upgrades` (kebab-case, like `version-mode`); only the literal boolean `false` suppresses; absent means `true` (today's behavior).
- The upgrade predicate keeps exactly one definition (`hasUpgrade`) — `tools/upstream-drift/tests/run.test.js`'s "hasUpgrade: due, findings, and the due-report all agree" test pins that; do not add a second check in `buildFindings` or `cmdDue`.
- Tests live in `tools/upstream-drift/tests/`, sized like their neighbours; cite AC clause ids in test names (`AC1.1`, `AC2.1`).

## Review Focus

- A suppressed entry must still report every drift finding and still be `due` on drift — the opt-out silences only the upgrade class (Task 2 test "report-upgrades: false never silences drift").
- A quoted `"false"` (string) or `no` in the YAML is a typo, not an opt-out — it must fail validation loudly, never silently keep or drop upgrades (Task 1 test).
- `report-upgrades` on a `versioning: none` entry is dead config and must fail validation, matching the existing dead-key guard (Task 1 test).
- Entries without the key keep reporting `upgrade-available` exactly as before, including on the real manifest (Task 2 real-manifest test, AC2.1).
- The `due` report still prints `latest` for a suppressed entry — only the reason and the `due` flag change (Task 2 verification probe).

## Premise probe (run at authoring time, recorded)

`node tools/upstream-drift/run.js due --dep claude-code` on this machine, before any change:
`"due": true, "installed": "2.1.302", "pinned": "2.1.302", "latest": "2.1.308", "reasons": ["an upgrade is available"]` — installed is behind latest and the upgrade is the only reason it is due. The same command with `--latest-tag claude-code=v9.9.9` printed the same shape with `"latest": "9.9.9"`.

---

### Task 1: `report-upgrades` manifest key — schema and the claude-code entry

**Files:**
- Modify: `tools/upstream-drift/manifest.js` (`validateManifest`: probe-class optional key after the `version-mode` check ~line 494; content-class dead-key list ~line 449)
- Modify: `tools/upstream-drift/manifest.yml` (claude-code entry, ~lines 353-417: key + comment)
- Test: `tools/upstream-drift/tests/manifest.test.js` (new tests after the `#2277: version-mode` block, ~line 418)

**Interfaces:**
- Produces: manifest entries may carry `'report-upgrades': false | true` (JS boolean, as `parseScalar` returns for bare `true`/`false`). Task 2 reads `entry['report-upgrades']`.

- [ ] **Step 1: Write the failing tests** in `manifest.test.js`, using the file's existing `validDependency()` helper and `loadManifest`/`validateManifest` imports:

```js
// ─── #3820: report-upgrades (optional boolean, probe-class only) ─────────

test('report-upgrades: false validates clean on a probe-class entry', () => {
  const dep = validDependency();
  dep['report-upgrades'] = false;
  assert.deepStrictEqual(validateManifest({ dependencies: [dep] }), []);
});

test('a non-boolean report-upgrades is a validation error naming the value', () => {
  for (const bad of ['false', 'no', 0]) {
    const dep = validDependency();
    dep['report-upgrades'] = bad;
    const errors = validateManifest({ dependencies: [dep] });
    assert.ok(errors.some((e) => e.includes("'report-upgrades'") && e.includes(String(bad))), `expected an error for ${JSON.stringify(bad)}`);
  }
});

test('conformance: the real claude-code entry sets report-upgrades: false', () => {
  const manifest = loadManifest(path.join(__dirname, '..', 'manifest.yml'));
  const cc = manifest.dependencies.find((d) => d.name === 'claude-code');
  assert.strictEqual(cc['report-upgrades'], false);
});
```

Also extend the existing test `'probe-machinery keys on a content-pinned entry each produce a validation error — silently-dead config fails loudly'` (~line 518): add `'report-upgrades': false,` to its `probeMachineryKeys` map. Its loop already asserts an error naming the key and `versioning: none`, so `report-upgrades` on a content-pinned entry is pinned as dead config.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="report-upgrades|probe-machinery keys" tools/upstream-drift/tests/manifest.test.js`
Expected: FAIL after Step 1 (the non-boolean, probe-machinery-keys and conformance tests fail; the first may pass already — an unknown key is ignored today)

- [ ] **Step 3: Implement in `manifest.js` `validateManifest`**
  - Probe-class branch, right after the `version-mode` check: when `hasKey(dep, 'report-upgrades')` and `typeof dep['report-upgrades'] !== 'boolean'`, push `` `Dependency ${label}: 'report-upgrades' must be true or false (got '${dep['report-upgrades']}')` ``. Add a two-line comment in the style of the `version-mode` one: optional, defaults to reporting; `false` suppresses the `upgrade-available` class for a drift-only entry whose assertions carry the signal (see the claude-code entry).
  - Content-class branch: add `'report-upgrades'` to the `for (const key of ['installed-probe', 'pinned', 'version-mode', 'contract-paths', 'assertions', 'fixtures'])` dead-key list.

- [ ] **Step 4: Edit the claude-code entry in `manifest.yml`** — add `report-upgrades: false` directly under `version-mode: floor`, and extend the entry's comment block (the `` `version-mode: floor` `` paragraph) with: `` `report-upgrades: false`: for the same reason a newer release is not a finding here — upstream-drift would otherwise keep an `upgrade-available` issue open almost permanently and dedup reopens it after every lag (#3820). Drift findings are unaffected. ``

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tools/upstream-drift/tests/manifest.test.js`
Expected: PASS, 0 failures (the existing `conformance: loadManifest succeeds on the real tools/upstream-drift/manifest.yml` test included)

- [ ] **Step 6: Commit**

```bash
git add tools/upstream-drift/manifest.js tools/upstream-drift/manifest.yml tools/upstream-drift/tests/manifest.test.js
git commit -m "Add the report-upgrades manifest key to upstream-drift — claude-code opts out (refs #3820)"
```

### Task 2: Suppress the upgrade class in `run.js` when `report-upgrades: false`

**Files:**
- Modify: `tools/upstream-drift/run.js` (`evaluate()` probe-class evaluation object ~line 210; `hasUpgrade()` ~line 232 and its comment)
- Test: `tools/upstream-drift/tests/run.test.js` (new tests after the "the upgrade class is not a defect" block, ~line 286; real-manifest test after ~line 592)
- Modify: `docs/journeys/notice-a-reworded-isolation-refusal-3304.md` (line 27, the "Should understand" bullet)
- Modify: `.claude/skills/upstream-repin/SKILL.md` (line 60, the claude-code drift-only sentence)

**Interfaces:**
- Consumes: `entry['report-upgrades']` (Task 1).
- Produces: probe-class evaluations carry `reportUpgrades: boolean` (`entry['report-upgrades'] !== false`). `hasUpgrade(evaluation)` returns `false` when `evaluation.reportUpgrades === false` (an evaluation with no `reportUpgrades` field — every existing test fixture — behaves as today).

- [ ] **Step 1: Write the failing tests** in `run.test.js` (imports: add `isDue` and `hasUpgrade` to the top-level destructure from `'../run'`):

```js
test('AC1.1: report-upgrades: false suppresses upgrade-available when installed is behind latest', () => {
  const ev = greenEvaluation({ latest: '4.0.4', reportUpgrades: false });
  assert.ok(!buildFindings(ev).some((f) => f.kind === 'upgrade-available'));
  assert.strictEqual(hasUpgrade(ev), false);
  assert.strictEqual(isDue(ev), false, 'a version lag alone must not make an opted-out entry due');
});

test('report-upgrades: false never silences drift', () => {
  const ev = greenEvaluation({
    latest: '4.0.4',
    reportUpgrades: false,
    assertions: { status: 'drift', results: [{ file: 'f.md', claims: 'c', upstreamPath: 'u', status: 'unmatched', detail: 'd' }] },
  });
  assert.ok(buildFindings(ev).some((f) => f.kind === 'assertion-drift'));
  assert.strictEqual(isDue(ev), true);
});

test('evaluate: reportUpgrades follows the entry, defaulting to true', () => {
  const stubs = {
    checkVersion: () => ({ check: 'version', status: 'ok', installed: ['1.0.0'], pinned: '1.0.0', detail: 'ok' }),
    checkAssertions: () => ({ check: 'assertions', status: 'ok', results: [] }),
    replayFixtures: () => ({ check: 'fixtures', status: 'ok', results: [] }),
    resolveLatest: () => ({ tag: 'v1.0.1', version: '1.0.1' }),
  };
  const base = { name: 'p', pinned: '1.0.0', upstream: { repo: 'r', 'tag-prefix': 'v' } };
  assert.strictEqual(evaluate(base, stubs).reportUpgrades, true);
  assert.strictEqual(evaluate({ ...base, 'report-upgrades': false }, stubs).reportUpgrades, false);
});
```

And, after the existing "buildFindings runs end-to-end against the real manifest with stubbed checks" test:

```js
test('AC1.1 + AC2.1: on the real manifest, claude-code reports no upgrade when behind latest; every other version-line entry still does', () => {
  const { loadManifest } = require('../manifest');
  const manifest = loadManifest(path.join(__dirname, '..', 'manifest.yml'));
  const versionLine = manifest.dependencies.filter((d) => !(d.pin && d.pin.versioning === 'none'));
  let others = 0;
  for (const dep of versionLine) {
    const ev = evaluate(dep, {
      checkVersion: () => ({ check: 'version', status: 'ok', installed: [dep.pinned], pinned: dep.pinned, detail: 'ok' }),
      checkAssertions: () => ({ check: 'assertions', status: 'ok', results: [] }),
      replayFixtures: () => ({ check: 'fixtures', status: 'ok', results: [] }),
      resolveLatest: () => ({ tag: `${dep.upstream['tag-prefix']}999.0.0`, version: '999.0.0' }),
    });
    const upgrades = buildFindings(ev).filter((f) => f.kind === 'upgrade-available');
    if (dep.name === 'claude-code') {
      assert.strictEqual(upgrades.length, 0, 'claude-code opted out of the upgrade class (AC1.1)');
      assert.strictEqual(ev.due, false);
    } else {
      others++;
      assert.strictEqual(upgrades.length, 1, `${dep.name} must still report upgrade-available (AC2.1)`);
      assert.strictEqual(ev.due, true);
    }
  }
  assert.ok(versionLine.some((d) => d.name === 'claude-code'), 'the real manifest must still carry claude-code');
  assert.ok(others >= 1, 'AC2.1 must check at least one other entry, never pass vacuously');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="AC1.1|reportUpgrades|never silences drift" tools/upstream-drift/tests/run.test.js`
Expected: FAIL after Step 1 (the AC1.1 and reportUpgrades tests fail; "never silences drift" may already pass)

- [ ] **Step 3: Implement in `run.js`**
  - `evaluate()` probe-class evaluation object: add `reportUpgrades: entry['report-upgrades'] !== false`.
  - `hasUpgrade()`: after the `contentPins` guard, `if (evaluation.reportUpgrades === false) return false;` with a one-line comment (entry opted out via `report-upgrades: false`; drift findings are unaffected because they never call this predicate). Extend the function's header comment to say the opt-out lives here so `isDue`, `buildFindings` and `cmdDue` stay in agreement.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/upstream-drift/tests/run.test.js tools/upstream-drift/tests/manifest.test.js tools/upstream-drift/tests/checks.test.js`
Expected: PASS, 0 failures (the existing "hasUpgrade: due, findings, and the due-report all agree" test included)

- [ ] **Step 5: Live probe (AC1.1 against the real CLI)**

Run: `node tools/upstream-drift/run.js due --dep claude-code --latest-tag claude-code=v9.9.9`
Expected: claude-code `"due": false`, `"latest": "9.9.9"`, `"reasons": []` (baseline before the change: `"due": true`, reasons `["an upgrade is available"]`).

Run: `node tools/upstream-drift/run.js findings --dep claude-code --latest-tag claude-code=v9.9.9`
Expected: `[]` (no `upgrade-available` entry).

Run: `node tools/upstream-drift/run.js due --dep superpowers --latest-tag superpowers=v99.0.0`
Expected: superpowers `"reasons"` still contains `"an upgrade is available"` (AC2.1).

- [ ] **Step 6: Update the two prose sites that describe the old behavior**
  - `docs/journeys/notice-a-reworded-isolation-refusal-3304.md` line 27: replace the sentence "an `upgrade-available` finding for claude-code is expected noise, because Claude Code ships near daily. It is not drift." with "claude-code never reports `upgrade-available`: the entry sets `report-upgrades: false`, because Claude Code ships near daily and the assertions, not the version, carry the signal." Keep the rest of the bullet.
  - `.claude/skills/upstream-repin/SKILL.md` line 60: add `report-upgrades: false` to the drift-only key list (`` `version-mode: floor`, `report-upgrades: false`, `contract-paths: []`, `fixtures: []` ``), so a re-pin does not drop it.

- [ ] **Step 7: Commit**

```bash
git add tools/upstream-drift/run.js tools/upstream-drift/tests/run.test.js docs/journeys/notice-a-reworded-isolation-refusal-3304.md .claude/skills/upstream-repin/SKILL.md
git commit -m "Suppress upgrade-available for report-upgrades: false entries in upstream-drift — refs #3820"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1: an upgrade-class opt-out field | Task 1 (schema), Task 2 (behavior) |
| Deliverable 2: set it on `claude-code` + a `tools/upstream-drift/tests` case | Task 1 Step 4 + conformance test; Task 2 tests |
| AC1.1: `run.js due --dep claude-code` reports no upgrade finding when behind latest | Task 2 tests named `AC1.1…`; Task 2 Step 5 live probe |
| AC2.1: other entries still report `upgrade-available` | Task 2 real-manifest test `AC1.1 + AC2.1…`; Step 5 superpowers probe |
