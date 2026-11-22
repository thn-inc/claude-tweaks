# Keep Driver-Routable Records Out of Fast-Lane Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `expressQueuePolicy().keepSingleton` also keeps a `ceremony:fast-lane` record the pipeline driver would route out of dispatch's fast-lane bundles, with a distinct queue-order grouping stamp for the driver half.

**Architecture:** Change `plugin/bin/lib/express/queue.js` only (its two callers, `queue-pull.js` and the embedded script in `queue-pull-script.md`, keep calling it unchanged). The driver half asks the driver's own questions by composing already-exported pure functions: `routingReason` (newly exported from `admission.js`), `preScreen` (`budget.js`) with `eligibilityOptions` (`steps.js`), `reviewRequired` (`review.js`) and `reviewerGateReason` (`admission.js`). `groupingMode` gains a second argument so the four lane combinations stamp four distinct values.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T083032-record-6011/work/6011-spec.md` (record #6011)

**Scope keywords:** expressQueuePolicy, groupingMode, routingReason

## Global Constraints

- `expressQueuePolicy(deps) → { enabled, grouping, keepSingleton }` keeps its shape. `enabled` stays the express half's flag; with only the driver half on, `enabled` is false and `grouping`/`keepSingleton` are the driver variant, so the frozen disabled value applies only when both halves are off.
- Policy keys are read with `runDir: null`, in exactly two resolver calls: the first reads `['express-lane', 'express-driver']`; the second, made only when either half is on, reads `['integration-model', 'merge-sensitive-paths', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-review']`. With `express-lane` not `true` and `express-driver` `off`, the second call is not made.
- The driver half is on when `express-driver` resolves `on` or `split` (exactly those two strings), whatever `express-lane` resolves. Any other value (`off`, an unrecognised value) leaves the driver half off.
- `split` is read through `routingReason` (`admission.js:75-86`), exported by this record and called as is; never a second copy of the even/odd rule.
- Import `eligibilityOptions` from `plugin/bin/lib/driver/steps.js` and `preScreen` from `plugin/bin/lib/driver/budget.js`; edit neither. `admission.js` changes only by one added export.
- Require the driver modules (`../driver/admission`, `../driver/budget`, `../driver/steps`, `../driver/review`) lazily, inside the driver-on branch of `expressQueuePolicy`, never at the top of `queue.js`: a project using neither lane must not load the driver graph on every queue pull, and `budget.js` requires `../dispatch/queue-pull`, the module that calls `expressQueuePolicy`.
- New stamp values only, never a changed meaning: `groupingMode(false, false)` = `'per-record'`, `groupingMode(true, false)` = `'per-record+express'`, `groupingMode(false, true)` = `'per-record+driver'`, `groupingMode(true, true)` = `'per-record+express+driver'`. `groupingMode(false)` and `groupingMode(true)` keep their current values. `GROUPING_MODE` stays `'per-record'`.
- An unreadable input never keeps the record: a `keyFiles` that is not an array, a non-integer issue number under `split`, an `express-driver` value other than `on`, `off` or `split` → the driver half answers false (the record is bundled).
- A failed policy read, on either resolver call, makes `expressQueuePolicy` return the frozen disabled value for that pull (`keepSingleton: () => false`, `grouping: 'per-record'`, `enabled: false`) with exactly one stderr line naming the failed read (the keys of the call that threw).
- A throwing driver-half check for one record answers false for that record, with one stderr line naming `#{number}`, mirroring the express half's existing per-record fallback.
- Governing project skill `.claude/skills/shared-contract-extraction/SKILL.md`, quoted verbatim: "**A persisted consumer keeps its own schema; convert at the boundary and say so there.** Not every reader of the old shape is in scope. The queue-order disk cache (`bin/lib/dispatch/queue-order.js`) keeps its pre-#1752 `{number, blockedBy}[]` `excluded` field, and `queue-pull-script.md` converts in both directions at exactly the two points the schemas meet — cache-hit materialization and write-back — each with a comment saying that is what it is." This plan changes no blob field; it adds stamp values only. No other project skill under `.claude/skills/` names these files' changed behavior (`blocker-surface-parity`, `dispatch-queue-exclusion-addition` and `claim-targets-stop-addition` name `queue-order.js`/`driver-route.md` for blocker exclusions and claim stops, which this plan does not touch).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #6011` (never `closes`/`fixes`).

## Review Focus

- **Only the driver half on (`express-lane: false`, `express-driver: on`)** — `enabled` must stay `false` while `grouping` is `per-record+driver` and `keepSingleton` keeps driver-routable records; a reader that keys on `enabled` alone would wrongly bundle. Pinned in Task 2 (AC2.1 test asserts all three fields).
- **An express-eligible record with the driver half off** — today's behavior must be unchanged (kept, stamp `per-record+express`). Pinned in Task 2's updated existing test.
- **A record both halves would take** — kept once, no double stderr, no throw. Pinned in Task 2 (`both halves on: a size:low record eligible for both is kept`).
- **Label objects vs. label strings** — queue-pull records carry `labels: [{ name }]`; `reviewerGateReason` and `preScreen` must accept that shape. Task 2's fixtures use `{ name }` objects, matching `tests/bin-lib/express/queue.test.js`'s existing `issue()` helper.
- **Load cost** — loading `queue.js` must not load the driver modules. Pinned in Task 2 (extend the existing "does not load the express CLI module" probe to also assert `driver[\\/]steps\.js` is absent from `require.cache`).

---

### Task 1: `groupingMode`'s driver variant

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-order.js:31-35` (the `groupingMode` function and its comment)
- Test: `tests/bin-lib/dispatch/queue-order.test.js` (next to the existing `groupingMode names the express variant…` test at line 177)

**Interfaces:**
- Produces: `groupingMode(expressEnabled: boolean, driverEnabled?: boolean) -> string` — the four stamps in Global Constraints; an omitted second argument means `false`.

- [ ] **Step 1: Write the failing test**

```js
test('AC12.1, AC6.1: groupingMode maps the four lane combinations to four distinct stamps; cacheUsable accepts a blob only under its exact stamp', () => {
  assert.equal(groupingMode(false, false), 'per-record');
  assert.equal(groupingMode(true, false), 'per-record+express');
  assert.equal(groupingMode(false, true), 'per-record+driver');
  assert.equal(groupingMode(true, true), 'per-record+express+driver');
  assert.equal(groupingMode(false), 'per-record');
  assert.equal(groupingMode(true), 'per-record+express');
  const stamps = ['per-record', 'per-record+express', 'per-record+driver', 'per-record+express+driver'];
  for (const stamped of stamps) {
    const blob = composeOrderBlob({ computedAt: 'x', runId: 'y', freshnessSignal: SIGNAL, groups: [], excluded: [], grouping: stamped });
    for (const mode of stamps) assert.equal(cacheUsable(blob, SIGNAL, mode), stamped === mode, `${stamped} blob under ${mode}`);
  }
});
```

(`SIGNAL`, `composeOrderBlob` and `cacheUsable` are already in scope in that file — the test at line 182 uses them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/dispatch/queue-order.test.js`
Expected: FAIL after Step 1 — the new AC12.1 test: `groupingMode(false, true)` returns `'per-record'`, not `'per-record+driver'`.

- [ ] **Step 3: Implement `groupingMode(expressEnabled, driverEnabled = false)` in `plugin/bin/lib/dispatch/queue-order.js`**

Build the stamp as `GROUPING_MODE` + `'+express'` when `expressEnabled` + `'+driver'` when `driverEnabled`. Extend the comment above it: `#6011: with the driver half on, driver-routable records also stay out of fast-lane bundles; each lane combination stamps its own value, and an existing value never changes meaning.`

- [ ] **Step 4: Run the file to verify it passes**

Run: `node --test tests/bin-lib/dispatch/queue-order.test.js`
Expected: PASS, every test (the existing line-177 test still passes unchanged).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-order.js tests/bin-lib/dispatch/queue-order.test.js
git commit -m "Add groupingMode's driver variant — per-record+driver and per-record+express+driver stamps (refs #6011)"
```

---

### Task 2: The driver half of `expressQueuePolicy`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/admission.js:156` (add `routingReason` to `module.exports`; nothing else in the file changes)
- Modify: `plugin/bin/lib/express/queue.js` (whole function `expressQueuePolicy`, the header comment lines 1-5 and the function comment lines 14-20)
- Test: `tests/bin-lib/express/queue.test.js`
- Waived `tests/bin-lib/driver/admission.test.js`: read-only for this task — AC11.1 requires it to pass unchanged; Step 4 runs it.
- Waived `plugin/bin/lib/driver/steps.js`: `eligibilityOptions` is imported, never edited (spec Gotchas); Step 3 reads it.
- Waived `plugin/bin/lib/driver/budget.js`: `preScreen` is imported, never edited (spec Gotchas); Step 3 reads it.
- Waived `_shared/issue-claims.md`: cited by the spec's Gotchas for the group-claim rule only; no step reads or changes claims.
- Read only (no edit): `plugin/bin/lib/driver/review.js` (`reviewRequired`), `plugin/bin/lib/issues/grouping.js` (`extractKeyFiles`).

**Interfaces:**
- Consumes: Task 1's `groupingMode(expressEnabled, driverEnabled)`.
- Consumes (existing exports): `routingReason(routing: string, number: unknown) -> string|null` (`admission.js`, newly exported); `reviewerGateReason({ labels, keyFiles, bounds, reviewerOn }) -> string|null` (`admission.js`); `preScreen(record, opts, { evaluateRecordEligibility }) -> { verdict: 'pass'|'skip'|'unparseable', reasons }` (`budget.js`); `eligibilityOptions(policy) -> opts` where `policy` is the resolver's `{ [key]: { value } }` map (`steps.js`); `reviewRequired({ issue, keyFiles, policyValue }) -> { on, reason }` (`review.js`); `extractKeyFiles(issue) -> string[]` (`issues/grouping.js`); `evaluateRecordEligibility` (`express/eligibility.js`).
- Produces: `expressQueuePolicy(deps?: { resolvePolicy?, stderr? }) -> { enabled: boolean, grouping: string, keepSingleton: (issue) => boolean }` — `keepSingleton(issue)` is express-eligible (unchanged rule, only when `express-lane` is `true`) OR driver-routable (only when the driver half is on).

**Driver-routable(issue)**, in this order, any failure → `false`:
1. `routingReason(routing, issue.number) === null`.
2. `preScreen(issue, eligibilityOptions(policy), { evaluateRecordEligibility }).verdict === 'pass'`.
3. `keyFiles = extractKeyFiles(issue)`; not an array → false.
4. `reviewerOn = reviewRequired({ issue, keyFiles, policyValue: policy['express-driver-review'].value }).on`.
5. `reviewerGateReason({ labels: issue.labels, keyFiles, bounds: { sizeCeiling: policy['express-driver-max-size'].value, maxKeyFiles: policy['express-driver-max-key-files'].value }, reviewerOn }) === null`.

Compute `eligibilityOptions(policy)` and the `bounds` object once per `expressQueuePolicy` call, not per record.

Proof(public-contract): the queue-order blob's `grouping` stamp is read by live sessions on older plugin builds through `cacheUsable`'s exact-equality check (`queue-order.js`), so the two new stamps `per-record+driver` and `per-record+express+driver` make an older reader recompute rather than reuse, while `groupingMode(false)`/`groupingMode(true)` keep `per-record`/`per-record+express` byte-identical — Task 1's AC12 test pins all four values and the exact-stamp acceptance; `expressQueuePolicy`'s return keys are unchanged and Task 2's tests assert `enabled`, `grouping` and `keepSingleton` on every lane combination.

**Stderr line on a failed read:** `express-lane: policy read failed ({keys of the throwing call, joined ', '}), fast-lane bundling unchanged this pull: {message, whitespace collapsed}\n`. **On a throwing driver check:** `express-driver: queue eligibility check failed for #{number}, fast-lane bundling unchanged for it: {message}\n` (the express half keeps its existing line).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/express/queue.test.js`

Add a fixture builder beside the existing `issue()`:

```js
// Two Key Files, none protected or merge-sensitive (AC1's records).
const BODY_TWO_KEYS = BODY.replace(
  '- `plugin/skills/init/claude-md-template.md` (modify)',
  '- `plugin/skills/init/claude-md-template.md` (modify)\n- `plugin/skills/init/rules-template.md` (modify)',
);
const FAST_MEDIUM = ['risk:low', 'size:medium', 'ceremony:fast-lane', 'type:task'];
const medium = (number, labels = FAST_MEDIUM) => ({ number, body: BODY_TWO_KEYS, labels: labels.map((name) => ({ name })) });
const DRIVER_POLICY = {
  'express-lane': true, 'express-driver': 'on', 'integration-model': 'pr-first', 'merge-sensitive-paths': [],
  'express-driver-max-size': 'medium', 'express-driver-max-key-files': 3, 'express-driver-review': 'beyond-express',
};
const groupsOf = (records, values) => {
  const { buildDispatchGroups } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'grouping.js'));
  return buildDispatchGroups(records, { bundleCap: 3, keepSingleton: expressQueuePolicy({ resolvePolicy: policy(values).resolvePolicy }).keepSingleton });
};
const numbers = (r) => r.groups.map((g) => g.map((i) => i.number));
```

Then the tests (each name carries its clause ids):

```js
test('AC1.1, AC1.2: express-driver on + max-size medium keeps three size:medium fast-lane records as singletons; off bundles them', () => {
  const recs = [medium(20), medium(21), medium(22)];
  const on = groupsOf(recs, DRIVER_POLICY);
  assert.deepEqual(numbers(on), [[20], [21], [22]]);
  assert.deepEqual(on.bundles, []);
  const off = groupsOf(recs, { ...DRIVER_POLICY, 'express-driver': 'off' });
  assert.deepEqual(numbers(off), [[20, 21, 22]]);
  assert.equal(off.bundles.length, 1);
});

test('AC2.1: express-lane false + express-driver on still keeps them; enabled is false, grouping is per-record+driver', () => {
  const values = { ...DRIVER_POLICY, 'express-lane': false };
  assert.deepEqual(numbers(groupsOf([medium(20), medium(21), medium(22)], values)), [[20], [21], [22]]);
  const p = expressQueuePolicy({ resolvePolicy: policy(values).resolvePolicy });
  assert.equal(p.enabled, false);
  assert.equal(p.grouping, 'per-record+driver');
});

test('AC3.1, AC3.2: express-driver split keeps even #10 and bundles odd #11', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver': 'split' }).resolvePolicy });
  assert.equal(p.keepSingleton(medium(10)), true);
  assert.equal(p.keepSingleton(medium(11)), false);
});

test('AC4.1: express-driver-review off bundles a size:medium record (reviewerGateReason refuses it)', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver-review': 'off' }).resolvePolicy });
  assert.equal(p.keepSingleton(medium(20)), false);
  // Discrimination: the same record with the reviewer on is kept, so only the reviewer gate decides.
  assert.equal(expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy }).keepSingleton(medium(20)), true);
});

test('AC5.1: a record both lanes refuse (size:high, or a protected Key File) is bundled exactly as today', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy });
  assert.equal(p.keepSingleton(medium(20, ['risk:low', 'size:high', 'ceremony:fast-lane', 'type:task'])), false);
  const protectedBody = { number: 22, body: BODY_TWO_KEYS.replace('plugin/skills/init/rules-template.md', 'plugin/skills/_shared/ledger-format.md'), labels: FAST_MEDIUM.map((name) => ({ name })) };
  assert.equal(p.keepSingleton(protectedBody), false);
});
```

(`plugin/skills/_shared/ledger-format.md` is protected by `eligibility.js`'s `/(^|\/)skills\/_shared\//` entry; `plugin/skills/init/rules-template.md` matches no entry of that list.)

```js
test('AC6.1: with the driver half on, grouping differs from per-record and per-record+express', () => {
  const g = expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy }).grouping;
  assert.equal(g, 'per-record+express+driver');
  assert.notEqual(g, 'per-record');
  assert.notEqual(g, 'per-record+express');
});

test('AC7.1: a resolver that throws on the first or the second call disables both halves with exactly one stderr line naming the failed read', () => {
  for (const [failOn, named] of [[1, /express-driver\b/], [2, /express-driver-review/]]) {
    let n = 0;
    const resolvePolicy = (keys) => {
      n += 1;
      if (n === failOn) throw new Error('policy.yml unreadable');
      return Object.fromEntries(keys.map((k) => [k, { value: DRIVER_POLICY[k], source: 'policy' }]));
    };
    const sink = stderrSink();
    const p = expressQueuePolicy({ resolvePolicy, stderr: sink.stderr });
    assert.equal(p.keepSingleton(medium(20)), false);
    assert.equal(p.keepSingleton(ELIGIBLE), false);
    assert.equal(p.grouping, 'per-record');
    assert.equal(sink.lines.length, 1);
    assert.match(sink.lines[0], named);
    assert.match(sink.lines[0], /policy\.yml unreadable/);
  }
});

test('AC10.1: split with a non-integer number, and an unrecognised express-driver value, never keep a driver-only record', () => {
  const split = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver': 'split' }).resolvePolicy });
  assert.equal(split.keepSingleton({ ...medium(20), number: '20' }), false);
  assert.equal(split.keepSingleton({ ...medium(20), number: 20.5 }), false);
  const unknown = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver': 'sometimes' }).resolvePolicy });
  assert.equal(unknown.keepSingleton(medium(20)), false);
  assert.equal(unknown.grouping, 'per-record+express');
});

test('AC11.1: routingReason is exported from admission.js with its split rule', () => {
  const { routingReason, ADMISSION_REASONS: R } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'driver', 'admission.js'));
  assert.equal(routingReason('on', 3), null);
  assert.equal(routingReason('split', 4), null);
  assert.equal(routingReason('split', 5), R.splitOdd);
  assert.equal(routingReason('split', '4'), R.splitUnreadable);
  assert.equal(routingReason('off', 4), R.routingOff);
});

test('both halves on: a size:low record eligible for both is kept once, with no stderr', () => {
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy, stderr: sink.stderr });
  assert.equal(p.keepSingleton(ELIGIBLE), true);
  assert.deepEqual(sink.lines, []);
});

test('a throwing driver check keeps that record bundleable, with one stderr line naming it', () => {
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-lane': false }).resolvePolicy, stderr: sink.stderr });
  const malformed = { number: 8, body: BODY_TWO_KEYS, get labels() { throw new Error('labels unreadable'); } };
  assert.equal(p.keepSingleton(malformed), false);
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /#8/);
});
```

Update the two existing tests whose resolver-call assertions change (the call structure is the spec's):
- `express-lane false: …` → resolve `{ 'express-lane': false, 'express-driver': 'off', … }`; assert `calls.map((c) => c.keys)` deep-equals `[['express-lane', 'express-driver']]`.
- `express-lane true + pr-first: …` → add `'express-driver': 'off'` and the three driver keys to its values; assert calls deep-equal `[['express-lane', 'express-driver'], ['integration-model', 'merge-sensitive-paths', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-review']]`; `grouping` stays `'per-record+express'`.
- The other existing tests that pass values without `express-driver` keep passing (an `undefined` `express-driver` is not `on`/`split`, so the driver half is off); add `'express-driver': 'off'` to their values only if a test fails for that reason.
- Extend `loading queue.js does not load the express CLI module` to also assert no `require.cache` key matches `/driver[\\/](steps|budget|admission|review)\.js$/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/express/queue.test.js`
Expected: FAIL — AC1.1 (three records bundled into one group), AC2.1, AC3.1, AC11.1 (`routingReason` is not a function), and the updated call-structure assertions.

- [ ] **Step 3: Export `routingReason` and implement the driver half in `plugin/bin/lib/express/queue.js`**

`admission.js:156` becomes `module.exports = { ADMISSION_REASONS, evaluateAdmission, reviewerGateReason, routingReason };`. In `queue.js`, implement per the Interfaces block and Global Constraints: first resolver call `['express-lane', 'express-driver']`; return `DISABLED` when neither half is on; second call with the five keys; lazy-require the driver modules inside the driver-on branch; `grouping: groupingMode(expressOn, driverOn)`; `enabled: expressOn`; each half's per-record check in its own `try`. Rewrite the header comment (lines 1-5) and the function comment (lines 14-20) to say the policy keeps express-eligible and driver-routable fast-lane records out of bundles (#4025, #6011) and to name both resolver calls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/express/queue.test.js tests/bin-lib/driver/admission.test.js tests/bin-lib/issues/grouping.test.js`
Expected: PASS, every test; `admission.test.js` unmodified (`git diff --stat -- tests/bin-lib/driver/admission.test.js` prints nothing).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/admission.js plugin/bin/lib/express/queue.js tests/bin-lib/express/queue.test.js
git commit -m "Keep driver-routable records out of fast-lane bundles — expressQueuePolicy asks the driver's routing, eligibility and reviewer rules (refs #6011)"
```

---

### Task 3: Queue pull end-to-end (AC8, AC9)

**Role:** integration

**Files:**
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (beside the `#5230 express:` test at line 3431)
- Read only (no edit): `plugin/skills/dispatch/queue-pull-script.md` — the embedded script calls `expressQueuePolicy` unchanged (line 236 and the `.grouping` sites); this task runs its parity suite and edits nothing.
- Read only (no edit): `plugin/bin/lib/dispatch/queue-pull.js` — calls `deps.expressQueuePolicy` unchanged at lines 587 and 840; read-only.

**Interfaces:**
- Consumes: Task 2's `expressQueuePolicy({ resolvePolicy, stderr })`.

- [ ] **Step 1: Write the test**

```js
test('AC9.1 (#6011): a files-transport pull with the driver half on writes each driver-routable fast-lane record as its own group and no bundles', () => {
  const { expressQueuePolicy } = require('../../../plugin/bin/lib/express/queue');
  const values = {
    'express-lane': true, 'express-driver': 'on', 'integration-model': 'pr-first', 'merge-sensitive-paths': [],
    'express-driver-max-size': 'medium', 'express-driver-max-key-files': 3, 'express-driver-review': 'beyond-express',
  };
  const resolvePolicy = (keys) => Object.fromEntries(keys.map((k) => [k, { value: values[k], source: 'policy' }]));
  const run = (driver) => pull(S1(), {
    transport: 'files', run: noGhOnFiles,
    deps: { expressQueuePolicy: (o) => expressQueuePolicy({ ...o, resolvePolicy: (keys) => ({ ...resolvePolicy(keys), 'express-driver': { value: driver, source: 'policy' } }) }) },
    prepare: (own) => ({ inputs: {
      queueRaw: writeInput(own, 'queue.json', JSON.stringify([9201, 9202, 9203].map(fastMedium))),
      openNumbers: writeInput(own, 'open.json', '[{"number":9201},{"number":9202},{"number":9203}]'),
    } }),
  });
  const on = run('on');
  assert.deepEqual(on.json('dispatch-groups.json').map((g) => g.map((i) => i.number ?? i)), [[9201], [9202], [9203]]);
  assert.deepEqual(on.json('dispatch-fastlane-bundles.json'), []);
  const off = run('off');
  assert.deepEqual(off.json('dispatch-fastlane-bundles.json'), [{ records: [9201, 9202, 9203] }], 'control: with the driver half off the same records bundle');
});
```

`fastMedium(n)` is a local helper built from `mcpRecord(n, body)` (line 1079) with labels `auto:build`, `ready`, `ceremony:fast-lane`, `risk:low`, `size:medium`, `type:task` and a body that is `withBody(n)` with its `### Key Files` list replaced by two non-protected paths (reuse Task 2's two paths). Read `withBody` in `tests/bin-lib/dispatch/queue-pull-fixtures.js` to see its Key Files shape, and read how `dispatch-groups.json` stores a group (numbers or record objects) before fixing the `map` in the first assertion. If the files-transport pull requires inputs beyond `queueRaw`/`openNumbers` (compare `pullBlockedRecord` at line 1199, which also passes `depFreshness` and `verifiedOpenDeps`), pass them the same way with empty values. If `S1()`'s group-size guard turns a three-record bundle into an `oversized` exclusion so the control cannot read the bundles file, set the guard via the scenario's `policy` (`'dispatch-group-size-guard': '3'`), as `SFast()` sets it.

- [ ] **Step 2: Run it to verify the control and the positive case**

Run: `node --test --test-name-pattern="AC9.1" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS (Task 2 is already in). Then prove discrimination: temporarily change `queue.js`'s driver half to answer `false`, re-run, see the `on` assertion go red, and restore it (`git diff -- plugin/bin/lib/express/queue.js` empty afterwards).

- [ ] **Step 3: Run the queue-pull suites, including the script/module parity test (AC8.1)**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-oracle-checks.test.js`
Expected: PASS, every test. Also run `git grep -l -e "queue-pull-script" -- tests` and run each listed suite that compares the embedded script with `bin/lib/dispatch/queue-pull.js`; expected PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Pin the driver half end to end in the queue pull — files transport writes driver-routable records as singletons (refs #6011)"
```

---

### Task 4: The bundle row and the docs that describe `keepSingleton`

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/driver-route.md:15` (the `| a bundle group |` Closed rule row; file is 12,813 B, far under the 52,500 B `RAIL_BYTES` rail)
- Modify: `tests/dispatch-express-routing-prose.test.js:353-354` (the bundle row's `CLOSED_ROWS` pattern)
- Modify: `docs/plugin-structure.md:118` (queue-order.js entry: `groupingMode(true)'s per-record+express` sentence) and `:121` (queue.js entry: "resolves `express-lane`, `integration-model` and `merge-sensitive-paths` once per queue pull")
- Modify: `docs/skill-graph.md:310` ("its `keepSingleton` keeps an express-eligible fast-lane record out of `buildDispatchGroups`'s bundles")
- No change: `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:54` (still true: the express lane's own records stay out of bundles; it does not describe the driver).

- [ ] **Step 1: Update the test pin first**

In `CLOSED_ROWS`, the bundle row's pattern becomes:

```js
/\| today's path; the route is never consulted\. The queue pull keeps a record the driver would take out of bundles \(`bin\/lib\/express\/queue\.js`'s `keepSingleton`\), so a bundle has no member the driver would take \|/
```

Run: `node --test tests/dispatch-express-routing-prose.test.js`
Expected: FAIL — `driver-route.md: the Closed rule has exactly its five rows` reports the bundle row's fact missing.

- [ ] **Step 2: Edit the row**

`plugin/skills/dispatch/driver-route.md` line 15 becomes:

```
| a bundle group | today's path; the route is never consulted. The queue pull keeps a record the driver would take out of bundles (`bin/lib/express/queue.js`'s `keepSingleton`), so a bundle has no member the driver would take |
```

Run: `node --test tests/dispatch-express-routing-prose.test.js`
Expected: PASS, including the go-red cell-swap control.

- [ ] **Step 3: Edit the two docs**

- `docs/plugin-structure.md:118`: name all four stamps — `GROUPING_MODE` by default, `groupingMode(express, driver)`'s `per-record+express`, `per-record+driver` or `per-record+express+driver` when the express lane, the driver half or both are on (#4025, #6011).
- `docs/plugin-structure.md:121`: the queue.js entry says it resolves `express-lane` and `express-driver` first and, only when either is on, `integration-model`, `merge-sensitive-paths` and the three `express-driver-*` bound/review keys; `keepSingleton` keeps an express-eligible or driver-routable fast-lane record (the driver's routing, `preScreen` eligibility and reviewer gate, #6011); a failed read on either call falls back to bundling for the whole pull.
- `docs/skill-graph.md:310`: "its `keepSingleton` keeps an express-eligible or driver-routable fast-lane record out of `buildDispatchGroups`'s bundles" (the rest of the cell unchanged).

Sweep for other descriptions of the old rule, one `-e` per phrasing:

Run: `git grep -n -i -e "keeps an express-eligible" -e "express-eligible fast-lane" -e "groupingMode(true)" -e "per-record+express" -- plugin docs ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' ':!docs/superpowers/specs'`
Expected: every hit either was edited above, is `queue-order.js`'s own code, or is the journey line classified no-change.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/dispatch/driver-route.md tests/dispatch-express-routing-prose.test.js docs/plugin-structure.md docs/skill-graph.md
git commit -m "State that the queue pull keeps driver-routable records out of bundles — driver-route.md's bundle row and the docs (refs #6011)"
```
