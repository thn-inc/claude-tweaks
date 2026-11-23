# Queue-Order Settings Fingerprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dispatch queue-order cache is reused only when every policy value that shapes the groups is unchanged, not only the grouping stamp.

**Architecture:** `plugin/bin/lib/express/queue.js` owns one exported list of grouping inputs (`GROUPING_INPUTS`) and a pure `groupingFingerprint(values)`; `expressQueuePolicy()` reads every input (the bundle cap and `work-links` join its first resolver call — no new resolver call) and returns `fingerprint` beside `grouping`. `plugin/bin/lib/dispatch/queue-order.js`'s `cacheUsable` takes a `{ grouping, fingerprint }` key (the policy object itself qualifies) and `composeOrderBlob` writes an additive `fingerprint` field. Both callers (`queue-pull.js` and `queue-pull-script.md`'s embedded script) pass the policy object instead of `.grouping`.

**Tech Stack:** Node 18+ CommonJS, `node:crypto` sha256, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T065346-record-6062/work/6062-spec.md` (record #6062; carries the plan-review Decision, Reading B: the fingerprint also covers `work-links`, AC8)

Scope keywords: cacheUsable, composeOrderBlob, expressQueuePolicy

## Global Constraints

- Expand-contract on shared state: the queue-order blob gains a `fingerprint` field; `grouping` and every existing stamp value (`per-record`, `per-record+express`, `per-record+driver`, `per-record+express+driver`) keep their meaning. No existing blob field changes.
- No new resolver call in `expressQueuePolicy`: `dispatch-fastlane-bundle-cap` and `work-links` are read in the existing first call.
- `work-links` (Decision, Reading B) is owned by `GROUPING_INPUTS` and read in `expressQueuePolicy`'s first call, not fed in by the callers. Premise reversed: the Decision says both callers feed the `work-links` value they already read, but neither has read it at its cache check — `queue-pull.js` reads it at `:599`, after the `:587` check; the embedded script reads `WORK_LINKS` at `queue-pull-script.md:142`, after the `:109` check. Feeding it would mean moving each read ahead of the check, which shifts the script's fence line numbers that `queue-pull.js` comments cite and grows a file 3 bytes under its rail. Folding it into the first call keeps no extra resolver call, one owner of the list, and the AC7 tests cover the read.
- Which records either half keeps out of bundles does not change (`keepSingleton` behavior untouched).
- A failed policy read (either resolver call throws, an unrecognised `express-driver` value, driver modules failing to load) keeps today's disabled behavior and carries one fixed fingerprint: `groupingFingerprint({})`.
- `plugin/skills/dispatch/queue-pull-script.md` is 52,497 bytes against a 52,500-byte Read rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`). Edits there must be in place (same line count — `queue-pull.js` comments cite fence line numbers) and must not grow the file; the edits below shrink it.
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #6062`; never `closes`/`fixes`.

## Review Focus

1. `merge-sensitive-paths` given as a comma string vs an array, or in a different order, with duplicates → same fingerprint (normalize through `sensitivePathsOf`, then sort and dedupe). Task 1 test.
2. A test fake or older caller passing a key with no `fingerprint` (undefined on both blob and key) → must be a miss, never `undefined === undefined` hit. Task 2 test.
3. Both lanes off → the second resolver call still never runs (no `gh repo view` probe), but the fingerprint still covers `express-lane`, `express-driver` and the bundle cap, so a cap change is still seen. Task 1 test.
4. A blob written by the new code read by an older reader → only additive field; `grouping` equals the stamp the old reader compares. Task 2 test (AC4).
5. Lane values that do not reach `groupingFingerprint` because a future code path reads a policy key the list omits → the AC7 tests (requested keys and accessed keys) go red. Task 1 test.

---

### Task 1: Grouping-input list and fingerprint in `express/queue.js`

**Review risk:** high — changes `expressQueuePolicy`'s early-return branches (lanes-off, failed reads) and the first resolver call that gates both lanes.

**Files:**
- Modify: `plugin/bin/lib/express/queue.js`
- Test: `tests/bin-lib/express/queue.test.js`

**Interfaces:**
- Produces:
  - `GROUPING_INPUTS: readonly string[]` — frozen, exactly `[...FIRST_KEYS, ...SECOND_KEYS]` where `FIRST_KEYS = ['express-lane', 'express-driver', 'dispatch-fastlane-bundle-cap', 'work-links']` and `SECOND_KEYS` stays `['integration-model', 'merge-sensitive-paths', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-risk', 'express-driver-review']`. (`express-driver-max-risk` is in the read today and feeds `eligibilityOptions`, so it is a grouping input though the record's list omits it.)
  - `groupingFingerprint(values: Record<string, unknown>) -> string` — `values` maps a key to the raw resolved `.value`. Uses only keys of `GROUPING_INPUTS` that are own properties of `values`, in `GROUPING_INPUTS` order, as `[key, normalized]` pairs; `merge-sensitive-paths` is normalized via `sensitivePathsOf({ value })`, then sorted and deduped; `undefined` becomes `null`. Returns the first 16 hex chars of sha256 over `JSON.stringify(pairs)`.
  - `expressQueuePolicy(deps) -> { enabled, grouping, fingerprint, keepSingleton }` — `fingerprint` is `groupingFingerprint` over every value the resolver calls actually returned (first call's four keys; plus the six second-call keys when either half is on). `DISABLED` gains `fingerprint: groupingFingerprint({})`. The lanes-off early return becomes `{ enabled: false, grouping: groupingMode(false), fingerprint: <first-call values>, keepSingleton: () => false }` (not `DISABLED`).
  - `module.exports = { expressQueuePolicy, GROUPING_INPUTS, groupingFingerprint }`.

- [ ] **Step 1: Append failing tests to `tests/bin-lib/express/queue.test.js`**

Tests (names verbatim):
- `#6062 AC5: groupingFingerprint is order-independent and stable for equal inputs` — `merge-sensitive-paths` `['b/**', 'a/**']`, `['a/**', 'b/**', 'a/**']` and `'a/**, b/**'` all give one fingerprint; two calls on equal objects give equal strings; result matches `/^[0-9a-f]{16}$/`.
- `#6062 AC1/AC2: the policy fingerprint changes when any one grouping input changes` — both halves on (base values: `express-lane: true`, `express-driver: 'on'`, `dispatch-fastlane-bundle-cap: 3`, `work-links: 'body-text'`, `integration-model: 'pr-first'`, `merge-sensitive-paths: ['a/**']`, `express-driver-max-size: 'low'`, `express-driver-max-key-files: 3`, `express-driver-max-risk: 'low'`, `express-driver-review: 'beyond-express'`); for each key one changed value (`false`, `'split'`, `2`, `'native'`, `'local-merge'`, `['b/**']`, `'medium'`, `4`, `'medium'`, `'on'`) gives a different `expressQueuePolicy(...).fingerprint`, while `grouping` stays the same for every key but `express-lane`/`express-driver`'s own lane flips. Assert the loop covered every `GROUPING_INPUTS` key.
- `#6062 AC3: equal grouping inputs give an equal policy fingerprint` — two `expressQueuePolicy` calls over the base values return equal fingerprints.
- `#6062 lanes off: the fingerprint still covers the bundle cap without the second resolver call` — `express-lane: false`, `express-driver: 'off'`; resolver called once; cap `3` vs `2` gives different fingerprints, and so does `work-links` `'body-text'` vs `'native'` (AC8); `enabled === false`, `grouping === 'per-record'`.
- `#6062 failed read: a throwing resolver and an unrecognised express-driver both carry groupingFingerprint({})`.
- `#6062 AC7: every key expressQueuePolicy requests is a grouping input` — recording resolver, both halves on; every key passed to any call is in `GROUPING_INPUTS`, and the union equals `GROUPING_INPUTS` as a set.
- `#6062 AC7: every policy entry the queue policy reads is a grouping input` — the resolver returns a `Proxy` over the entries object that records each property get; run `expressQueuePolicy` and call `keepSingleton` on an eligible fast-lane record (reuse the file's existing driver-routable fixture); every recorded string key is in `GROUPING_INPUTS`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/express/queue.test.js`
Expected: FAIL after Step 1 (`GROUPING_INPUTS`/`groupingFingerprint` are not exported; `fingerprint` is undefined)

- [ ] **Step 3: Implement `GROUPING_INPUTS`, `groupingFingerprint` and `fingerprint` in `plugin/bin/lib/express/queue.js`**

Collect the values from each resolver result over the keys requested (`read[k] = result[k] && result[k].value`), so a key added to `FIRST_KEYS`/`SECOND_KEYS` reaches the fingerprint automatically. Update the header comment and the `expressQueuePolicy` doc comment to name the fingerprint and its role (cache key beside the stamp, #6062).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/express/queue.test.js`
Expected: PASS, 0 failures (existing tests included — fakes built from `keys.map(...)` absorb the new first-call key)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/express/queue.js tests/bin-lib/express/queue.test.js
git commit -m "Add the grouping-input list and settings fingerprint to the queue policy — refs #6062"
```

### Task 2: `cacheUsable` and `composeOrderBlob` take the fingerprint

**Review risk:** high — `cacheUsable` decides whether a pull replays persisted groups and exclusions.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-order.js`
- Test: `tests/bin-lib/dispatch/queue-order.test.js`

**Interfaces:**
- Consumes: `groupingFingerprint` and `GROUPING_INPUTS` from Task 1 (tests only).
- Produces:
  - `cacheUsable(persisted, current, key: { grouping: string, fingerprint: string }) -> boolean` — the third parameter is now a key object (the `expressQueuePolicy()` result qualifies structurally); no default. True only when `key` is an object, `typeof key.fingerprint === 'string'`, `persisted.fingerprint === key.fingerprint`, `persisted.grouping === key.grouping`, and every existing condition (foreign flags, `signalsMatch`) holds. Never throws.
  - `composeOrderBlob({ computedAt, runId, freshnessSignal, groups, excluded, bundles, grouping = GROUPING_MODE, fingerprint })` — writes `fingerprint` when it is not `undefined` (same conditional shape as `bundles`); ignores any other property, so callers may spread the policy object into it. Doc comment says so.

- [ ] **Step 1: Write the failing tests and migrate the existing ones in `tests/bin-lib/dispatch/queue-order.test.js`**

New tests (names verbatim):
- `#6062 AC1: an express-driver-max-size change under the same stamp is a miss` — blob composed with `grouping: 'per-record+express+driver'` and `groupingFingerprint(base)`; key with the same grouping and `groupingFingerprint({ ...base, 'express-driver-max-size': 'medium' })` → `false`.
- `#6062 AC2: a change to any other grouping input is a miss` — one case each for `express-driver` (`'split'`↔`'on'`), `express-driver-max-key-files`, `express-driver-review`, `integration-model`, `merge-sensitive-paths`, `dispatch-fastlane-bundle-cap` → `false`.
- `#6062 AC8: a work-links change under the same stamp is a miss` — `groupingFingerprint(base)` vs `groupingFingerprint({ ...base, 'work-links': 'native' })` with base `'work-links': 'body-text'` → `false`.
- `#6062 AC3: unchanged grouping inputs and an unchanged queue still hit` → `true`.
- `#6062 AC4: a blob with no fingerprint is never reused, and a new blob keeps every older field` — a blob composed without `fingerprint` under a matching grouping → `false`; a key with `fingerprint: undefined` against that blob → `false`; a new blob, minus `fingerprint`, deep-equals the blob the same inputs composed before (`{ computedAt, runId, freshnessSignal, groups, excluded, grouping }` plus `bundles` when given) and its `grouping` is the passed stamp.

Migrate every existing `cacheUsable(blob, signal[, mode])` call to the key form: compose those blobs with a fixed `fingerprint: 'fp'` and pass `{ grouping: <mode or GROUPING_MODE>, fingerprint: 'fp' }`, keeping each test's original assertion (a test about a missing `grouping` keeps a fingerprint so it still tests the grouping refusal).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/queue-order.test.js`
Expected: FAIL after Step 1 (`cacheUsable` ignores the fingerprint, so AC1/AC2/AC4 return `true`)

- [ ] **Step 3: Implement the key-form `cacheUsable` and the `fingerprint` field in `plugin/bin/lib/dispatch/queue-order.js`**

Update the `cacheUsable` and `composeOrderBlob` comments (blob without `fingerprint` = older writer → miss; older readers ignore the field).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-order.test.js`
Expected: PASS, 0 failures. Interim state, expected until Task 3: both callers still pass the `.grouping` string, so `cacheUsable` misses on every call and any cache-hit test in `tests/bin-lib/dispatch/queue-pull.test.js` is red at this commit; Task 3 Step 4 runs that suite green.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-order.js tests/bin-lib/dispatch/queue-order.test.js
git commit -m "Key the queue-order cache on the settings fingerprint — refs #6062"
```

### Task 3: Both queue-pull callers pass and write the fingerprint

**Review risk:** high — changes what both callers write into the cross-version queue-order blob that older plugin versions also read and write.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js:587` and `:896`
- Modify: `plugin/skills/dispatch/queue-pull-script.md:109` and `:291`
- Modify: `tests/bin-lib/dispatch/queue-pull-helpers.js:590` (`EXPRESS_OFF`)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` (the `expressQueuePolicy` fakes at ~563 and `recordingExpress`, plus any hand-built `persisted` blob a cache-hit test relies on)
- Modify: `docs/plugin-structure.md:120` (the `queue-order.js` entry) and the `plugin/bin/lib/express/` entry if it describes `queue.js`'s return
- Modify: `docs/skill-graph.md:311` — "its `grouping` stamp keys the queue-order cache, so a blob computed under another mode is never reused" becomes "its `grouping` stamp and settings `fingerprint` key the queue-order cache, so a blob computed under another mode or other grouping settings is never reused"
- Not changed (Check B hits that stay true as written): the three `docs/journeys/*` mentions of `cacheUsable`, `plugin/skills/dispatch/queue-pull-notes.md:7`, `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js`
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`, `tests/bin-lib/dispatch/queue-pull-parity-*.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Consumes: `expressQueuePolicy(...)` result `{ grouping, fingerprint, ... }` (Task 1); `cacheUsable(persisted, current, key)` and `composeOrderBlob({ ..., grouping, fingerprint })` (Task 2).

- [ ] **Step 1: Extend the `#5230 express` test in `tests/bin-lib/dispatch/queue-pull.test.js`**

`recordingExpress()` returns `fingerprint: 'recorded-fp'`; assert `miss.store.written[0].blob.fingerprint === 'recorded-fp'`; add a pull whose policy returns the same grouping and `fingerprint: 'other-fp'` against that blob → `cacheHit === false` ("a blob written under other grouping settings is never reused"); give that persisted blob one `excluded` entry and assert the miss does not replay it into `dispatch-exclusions.json` (AC8: the blocker exclusions are recomputed, not replayed). Give `EXPRESS_OFF` and the ~563 fake a fixed `fingerprint: 'off-fp'`; any hand-built `persisted` blob in a cache-hit test gets the matching `fingerprint`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL after Step 1 (the module writes no `fingerprint` and passes a string to `cacheUsable`)

- [ ] **Step 3: Update `queue-pull.js` and the embedded script in place**

- `queue-pull.js:587`: `cacheUsable(persisted, current, deps.expressQueuePolicy({ stderr: deps.stderr }))`
- `queue-pull.js:896`: replace `grouping: deps.expressQueuePolicy({ stderr: deps.stderr }).grouping,` with `...deps.expressQueuePolicy({ stderr: deps.stderr }),`
- `queue-pull-script.md:109`: `cacheUsable(persisted, current, require('${CLAUDE_PLUGIN_ROOT}/bin/lib/express/queue.js').expressQueuePolicy())`
- `queue-pull-script.md:291`: replace `grouping: require('${CLAUDE_PLUGIN_ROOT}/bin/lib/express/queue.js').expressQueuePolicy().grouping,` with `...require('${CLAUDE_PLUGIN_ROOT}/bin/lib/express/queue.js').expressQueuePolicy(),`

No line added or removed in either file. Accepted window: the write-back spreads a fresh `expressQueuePolicy()` read, while the module's groups used `state.bundleCap`/`state.workLinks` read through the `resolve-policy.js` CLI; a policy edit between those reads stamps the blob with settings the groups were not computed under. This is the same pre-existing window `grouping` already has (every `expressQueuePolicy` call is its own read), and it lasts until a queue record changes. Update `docs/plugin-structure.md`'s `queue-order.js` entry to say `cacheUsable` also refuses a blob whose settings fingerprint (`express/queue.js`'s `groupingFingerprint` over `GROUPING_INPUTS`) differs or is absent (#6062).

- [ ] **Step 4: Run the suites and the rail to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull-parity-ac5.test.js tests/bin-lib/dispatch/queue-pull-parity-ac7.test.js tests/bin-lib/dispatch/queue-pull-parity-d1.test.js tests/bin-lib/dispatch/queue-pull-oracle-checks.test.js tests/bin-lib/dispatch/queue-order.test.js tests/bin-lib/express/queue.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures (AC6: the parity tests stay green). Also `wc -c plugin/skills/dispatch/queue-pull-script.md` prints at most `52500`, and `git diff --stat` shows equal insertions and deletions for that file.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md tests/bin-lib/dispatch/queue-pull-helpers.js tests/bin-lib/dispatch/queue-pull.test.js docs/plugin-structure.md docs/skill-graph.md
git commit -m "Pass and write the settings fingerprint from both queue-pull callers — refs #6062"
```
