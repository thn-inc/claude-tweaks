# Driver worker launch effort (#5942) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch each headless driver worker with `--effort {level}` when `model-effort: profile` resolves a level for its role's profile, and name that level (or `null`) on every worker-launch event line.

**Architecture:** `launch.js` already resolves each role's profile through `profiles.js` `resolve()` (#5917); it now also passes `model-effort` into that call and reads `launchEffort` from the same result. `launchTracked` hands the level to `launchWorker`, which validates it and hands it to `composeArgs`, which emits `--effort`. `launchTracked` returns the level beside `model` (and attaches it to a thrown error beside `err.model`), and every call site that puts `model` on an event line puts `effort` beside it.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-21T171056-spec-5941-5942/spec-5942/work/5942-spec.md`

Waived AC7.2: a build-process rule, not code behavior — the probe ran and passed at Spec Step 3 (`decisions.md` 20:52), before any code; Task 1 records it.

## Global Constraints

- `composeArgs({ …, effort })`: optional; one of `low`, `medium`, `high`, `xhigh`, `max` (spec, Data / API Surface). The list is `EFFORT_SCALE` from `plugin/bin/lib/model-profiles/profiles.js` — import it, never a second copy.
- `driver-events.jsonl` worker lines gain `effort: "<level>" | null`. Additive; readers that ignore unknown fields are unaffected (spec). Event fields may be added, never renamed (`events.js` header).
- `null` means no flag was passed, whether the key is `inherit` or the resolution is Fast; a reader must not tell the two apart (spec Deliverable 3).
- `launchTracked` never computes an effort itself (spec Deliverable 2): it passes `resolve().launchEffort` unchanged.
- No new policy key (spec Technical Approach): the switch is #5941's `model-effort`, each profile's effort is `PROFILES` plus `model-profiles` rows.
- Measured fact this plan rests on (Spec Step 3 probes, `decisions.md` 20:52): Claude Code 2.1.325 does **not** reject an unknown `--effort` value — it warns on stderr and runs at its default — so `composeArgs` must refuse it itself.
- Quoted from `.claude/skills/headless-worker-launch` (governs `roles.js`, `worker.js`): "Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off." / Decision Framework row: "A new CLI version changes a flag's behavior | Re-run the probes the header names for that flag and update the version and date beside each result" / Anti-pattern: "Copying the probed facts into this skill or another document | They drift from the headers they came from; point at `roles.js` and `worker.js` instead".
- Quoted from `.claude/skills/headless-worker-launch` (Decision Framework, model row) — why no judgment eval re-run is owed: "Changing the model a role launches with (`DRIVER_ROLE_PROFILES`, the `express-driver-models` defaults, or a profile's model) | For a judgment role (`merge-check`, `acceptance`), make `node tools/driver-merge-check-eval.js evaluate` a plan task". This change moves no role's model; the eval tool's policy is the keys at their defaults (`model-effort` unset), so it launches with no flag before and after. Not run; stated here.
- Quoted from `.claude/skills/driver-step-addition` (governs `steps.js`, `review.js`, `judgment-io.js`, `run.test.js`): "A value resolved at launch that an event line must name travels on the thrown error as well as on the result: `launchTracked` resolves `{ envelope, model }`, and a launcher throw after the model resolved carries `err.model`. Every catch of a launch keeps it on the stop it returns (`steps.js`'s `runImplementer` and `workerStep`, `review.js`'s reviewer launch, `judgment-io.js`'s `launchJudge`). #5917's first reviewer and judgment catches dropped it, so those lines lost `model` on a throw, and only the whole-branch review caught it."
- Quoted from `.claude/skills/driver-step-addition`: "Capture the happy path's call signatures, event `[step, status]` pairs and per-line key sets on the unmodified code as literal constants (`BASE_CALLS_PLAIN`, `BASE_CALLS_FIX`, `BASE_LINES_*`, `BASE_KEYS_*` in `run.test.js`)." — the new field joins those key-set constants the way `model` did (`KW`, `K5M`), never by loosening the comparison.
- Quoted from `.claude/skills/driver-step-addition` (`docs/driver.md` row): "Copied by hand. A few tests in `run.test.js` pin named rules in it (the `AC9.1` docs tests, and #5454's tree-stop test), so a change to a pinned rule's wording updates its test too".
- Waived `.claude/skills/headless-worker-launch`: read only, its rules are quoted above. Waived `.claude/skills/driver-step-addition`: read only, quoted above. Waived `plugin/bin/lib/model-profiles/profiles.js`: read only (Task 3 imports `resolve`/`EFFORT_SCALE`; its unknown-effort throw is what AC8 rests on, unchanged).
- Premise reversed (logged at Spec Step 3): the spec's "a one-retry relaunch and a continuation included" names launches the driver does not make — no driver step retries or continues a worker launch (`grep -n "retry\|continuation" plugin/bin/lib/driver/*.js` finds none). The review step's fix round relaunches the implementer inside the `review` step, which writes one line naming the reviewer's `model`; its `effort` follows the same rule (the reviewer's), exactly as `model` does.

## Review Focus

1. `effort: null` passed explicitly (not `undefined`) to `composeArgs` / `launchWorker` — the Fast and `inherit` paths hand `null`; it must mean "no flag", never throw. Test in Task 2.
2. A launcher throw after resolution must still put `effort` on the worker, review, merge-check and merge-acceptance lines (the #5917 regression class quoted above). Tests in Task 4.
3. An invalid `model-effort` policy entry (the resolver's `invalid: true`, e.g. `model-effort: fancy`) must refuse the run at the policy step, not launch flagless: an invalid key read as `inherit` would hide a typo. Test in Task 3.
4. `model-effort: profile` with `model-ceiling: standard` on the reviewer: `effort` comes from the clamped profile (`standard`'s), since `launchEffort` is the final effort after every stage. Test in Task 3.
5. Old readers of `driver-events.jsonl` (`driverStepsOf`) parse lines carrying `effort` identically to lines without it. Test in Task 4.

---

### Task 1: Record the effort probe in `worker.js`'s header

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js` (the "What the launch rests on" bullet list, after the `Default models (#5917)` bullet)

**Interfaces:**
- Consumes: nothing.
- Produces: the dated record later tasks and `docs/driver.md` point at for what `effort: null` means.

The probe already ran centrally at Spec Step 3 (AC7.2: it passed, so the build continues; a failed probe would have stopped here and been reported). It drove `launchWorker` with the real `defaultRunner`, wrapped so it appended only `--effort {level}` to the composed argv, reviewer role, `REVIEW_RESULT_SCHEMA`, prompt `Use no tool. Return exactly this structured output and nothing else: {"findings":[]}`; evidence is each launch's session transcript found by the envelope's `sessionId` (`grep -o '"effort":"[a-z]*"'` over its assistant turns).

- [ ] **Step 1: Add one header bullet `Launch effort (#5942)` with exactly these facts**

Re-probed on 2026-11-21 with Claude Code CLI 2.1.325 on macOS (darwin), under a subscription login, launched from a process with no TTY, every launch under `--safe-mode --restricted`:
- sonnet with `--effort medium` recorded `medium`; with no flag recorded `medium`; with `--effort low` recorded `low`; with `--effort high` recorded `high`.
- opus with no flag recorded `medium`; with `--effort high` recorded `high`.
- haiku with `--effort high` was accepted and recorded `high` (the driver never passes one to a Fast resolution).
- `--effort extreme` was not rejected: the CLI printed `Warning: Unknown --effort value 'extreme' — ignoring it and using the default effort. Valid values: low, medium, high, xhigh, max.` and the transcript recorded `medium`. That is why `composeArgs` refuses a level outside `EFFORT_SCALE` before any process starts.
- An unknown flag (`--effort-bogus`) exited 1 with empty stdout: `launch-error` with the CLI's first stderr line, no retry.
- So on this CLI a worker launched with no `--effort` (an event line's `effort: null`) runs at `medium` on sonnet and opus, and `--effort` takes effect under `--safe-mode --restricted`. `medium` against no flag does not discriminate; `low` and `high` do. Re-run: the opt-in `AC7.1 (#5942)` live probe in `tests/bin-lib/driver/worker.test.js` (Task 2).

- [ ] **Step 2: Commit**

```bash
git -C "$WT" add plugin/bin/lib/driver/worker.js
git -C "$WT" commit -m "Record the 2026-11-21 launch effort probe in worker.js — #5942"
```

---

### Task 2: `composeArgs` and `launchWorker` take an `effort` option

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/roles.js` (`composeArgs`, a new `assertEffort` beside `assertSpendCeiling`, `module.exports`)
- Modify: `plugin/bin/lib/driver/worker.js` (`launchWorker`: destructure `effort`, call `assertEffort` beside `assertSpendCeiling`, pass `effort` to `composeArgs`)
- Test: `tests/bin-lib/driver/roles.test.js`
- Test: `tests/bin-lib/driver/worker.test.js`

**Interfaces:**
- Consumes: `EFFORT_SCALE` from `plugin/bin/lib/model-profiles/profiles.js`.
- Produces: `assertEffort(value)` exported from `roles.js` — `undefined` and `null` pass; anything not in `EFFORT_SCALE` throws `RangeError('effort must be one of low, medium, high, xhigh, max, got ' + String(value))`. `composeArgs({ …, effort })` appends `'--effort', effort` after the `--model` pair when `effort` is a non-null value. `launchWorker(opts)` accepts `opts.effort` and passes it through.

- [ ] **Step 1: Write the failing tests**

In `roles.test.js`:
- `#5942 composeArgs: effort appends --effort {level} after --model` — for each of `EFFORT_SCALE`, `composeArgs({ role: 'reviewer', schema: REVIEW_RESULT_SCHEMA, model: 'sonnet', effort: lvl, platform: 'darwin' })` ends with `['--model', 'sonnet', '--effort', lvl]` and holds `--effort` once.
- `#5942 AC1.1 (argv): no effort, or effort null, composes no --effort` — for every role in `ROLES`, both `effort` omitted and `effort: null` produce no `'--effort'` element.
- `#5942 AC5.1: composeArgs refuses an unknown effort` — `assert.throws(() => composeArgs({ …, effort: 'extreme' }), RangeError)`; same for `'HIGH'`, `''`, `1`.

In `worker.test.js`:
- `#5942 AC5.1: launchWorker refuses an unknown effort before anything is written or started` — with a runner that counts calls and a fresh `settingsDir`, `await assert.rejects(launchWorker({ …, effort: 'extreme' }, { runner }), RangeError)`, runner calls `0`, `settingsDir` holds no file.
- `#5942: launchWorker passes effort through to the argv` — fake runner capturing `call.args`; `effort: 'medium'` → args include `'--effort', 'medium'`; `effort: null` → no `'--effort'`.
- `AC7.1 (#5942): live probe — a launch with --effort low records low, one with medium records medium, one with none records the CLI default`, opt-in exactly like `AC8.1 (#5917)` (`skip: !process.env.DRIVER_LIVE_SMOKE && …`): three reviewer launches on `sonnet` through `launchWorker` with the real `defaultRunner`, `effort` `'low'`, `'medium'`, omitted; find each transcript by `env.sessionId` under `os.homedir()/.claude/projects/*/{sessionId}.jsonl`; assert the set of `"effort":"x"` values on assistant lines is `['low']`, `['medium']`, and a single value (print it with `t.diagnostic` — it is what `effort: null` means). A missing transcript fails the test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/worker.test.js`
Expected: FAIL after Step 1 (the `#5942` tests: no `--effort` emitted, no RangeError thrown)

- [ ] **Step 3: Implement `assertEffort`, the `composeArgs` option and the `launchWorker` pass-through**

`composeArgs` calls `assertEffort(effort)` with its other argument checks; `launchWorker` calls it before any file is written. Extend the `composeArgs` row in `worker.js`'s header nothing more — Task 1 owns the header.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/worker.test.js`
Expected: PASS (the live probe reports skipped)

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add plugin/bin/lib/driver/roles.js plugin/bin/lib/driver/worker.js tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/worker.test.js
git -C "$WT" commit -m "Add an effort option to composeArgs and launchWorker — #5942"
```

The controller runs the live probe once after this task, centrally: `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern "AC7.1 \(#5942\)" tests/bin-lib/driver/worker.test.js`, and logs its result as an `AC evidence` entry (AC7.1).

---

### Task 3: `launch.js` resolves and passes each role's launch effort

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/launch.js` (`MODEL_POLICY_KEYS`, `roleModel` → `roleLaunch`, `modelPolicyRefusal`, `launchTracked`, header comment)
- Modify: `plugin/bin/lib/driver/steps.js` (the `POLICY_KEYS` comment naming the model keys — the list itself spreads `MODEL_POLICY_KEYS`)
- Modify: `tests/bin-lib/driver/run.test.js` (the harness's default policy object: add `'model-effort': 'inherit'` after `'model-ceiling'`, in `MODEL_POLICY_KEYS` order — without it the policy step refuses every harness run as `policy unreadable: model-effort`)
- Test: `tests/bin-lib/driver/launch.test.js`

**Interfaces:**
- Consumes: `resolve(profile, { policy, unattended })` → `{ model, effort, launchEffort, … }` (#5941); `composeArgs`/`launchWorker` `effort` (Task 2).
- Produces: `MODEL_POLICY_KEYS` = `['express-driver-models', 'model-profiles', 'model-ceiling', 'model-effort']`. `roleLaunch(role, policy)` → `{ model, effort }`, `effort` being `resolve().launchEffort` unchanged (a string or `null`); `roleModel(role, policy)` stays exported as `roleLaunch(role, policy).model` (the AC8.1 `#5917` live probe and the eval tool's callers keep working). `launchTracked(...)` passes `effort` to `deps.launchWorker` after the opts spread (no caller can override it, as with `model`), resolves `{ envelope, model, effort }`, and a launcher throw carries `err.effort` beside `err.model`.

- [ ] **Step 1: Write the failing tests**

Reuse the file's `composedArgs(role, policyRaw)` and `policyFrom` helpers (both build policy from the real resolvers); add `const argEffort = (args) => (args.includes('--effort') ? args[args.indexOf('--effort') + 1] : null);`.
- `#5942 AC1.1: with model-effort unset no role composes --effort` — for every role in `POLICY_DRIVER_ROLES`, `argEffort(await composedArgs(role, ''))` is `null`.
- `#5942 AC2.1: model-effort profile composes resolve().launchEffort for implementer and reviewer` — policyRaw `'model-effort: profile\n'`; for each of `implementer`, `reviewer`: `argEffort(...) === resolve(FOUR[role], { policy: { 'model-effort': 'profile' }, unattended: true }).launchEffort`.
- `#5942 AC2.2: with the shipped table that is high for both` — same policy; both equal `'high'`.
- `#5942 AC3.1: a model-profiles row giving standard medium composes --effort medium for the implementer` — policyRaw `'model-effort: profile\nmodel-profiles:\n  standard:\n    effort: medium\n'`.
- `#5942 AC4.1: an implementer mapped to fast composes no --effort` — policyRaw `'model-effort: profile\nexpress-driver-models:\n  implementer: fast\n'`; `argEffort` is `null` and `argModel` is `M('fast')`.
- `#5942 AC8.1: an unknown effort in a model-profiles row refuses before any launch` — policyRaw `'model-effort: profile\nmodel-profiles:\n  standard:\n    effort: extreme\n'`: `modelPolicyRefusal(policyFrom(raw))` names `implementer`; `launchTracked` rejects with `MODEL_REFUSED_CODE` and the counting runner/launcher stay at `0`, `shared.activeWorker` `null` (copy `AC5.1: launchTracked refuses before any runner call`'s shape).
- `#5942: launchTracked resolves { envelope, model, effort } and a throw carries err.effort` — fake `launchWorker` returning `'env'`, then one throwing; under `model-effort: profile` the resolved value is `{ envelope: 'env', model: M('standard'), effort: 'high' }` and the thrown error has `effort === 'high'` and `model === M('standard')`; with the key unset `effort` is `null` in both.
- `#5942: the resolved effort wins over an effort in the caller opts` — copy `launchTracked: the resolved model wins…` with `effort: 'max'` in opts; `got.effort` is `null` (key unset).
- `#5942: model-ceiling standard clamps the reviewer's effort with its model` — policyRaw `'model-effort: profile\nmodel-ceiling: standard\nmodel-profiles:\n  standard:\n    effort: low\n'`; reviewer `argModel` is `M('standard')`, `argEffort` is `'low'`.
- `#5942: an invalid model-effort refuses every role` — `policyFrom('model-effort: fancy\n')` marks the entry `invalid` (assert that first, so the test reaches the guard); `modelPolicyRefusal` returns `driver model policy invalid: model-effort`, and `roleLaunch('implementer', …)` throws `MODEL_REFUSED_CODE` with `driver model policy invalid: model-effort`. Deleting `'model-effort'` from `roleLaunch`'s invalid-key loop turns the second assertion red.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/driver/launch.test.js`
Expected: FAIL after Step 1 (`roleLaunch` not exported; no `--effort` composed)

- [ ] **Step 3: Implement**

In `roleLaunch`: the invalid-key loop covers `model-profiles`, `model-ceiling` and `model-effort`; `resolvePolicy['model-effort']` is set from `policy['model-effort'].value` when it is a non-empty string (an empty or absent value is unset, matching #5941's "empty model-effort as unset"); return `{ model: r.model, effort: r.launchEffort }`. Update the header's #5917 sentence to name `model-effort` and the effort.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add plugin/bin/lib/driver/launch.js plugin/bin/lib/driver/steps.js tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/run.test.js
git -C "$WT" commit -m "Resolve and pass each driver role's launch effort — #5942"
```

---

### Task 4: Every worker-launch event line names its `effort`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`runImplementer`'s `launch` record and its `extra.model` merge; `launchImplementerAndCheck`'s two `launch.model` assignments; `workerStep`'s throw path)
- Modify: `plugin/bin/lib/driver/review.js` (`launchReviewer`'s return and catch, `reviewPass`'s `model` tracking and `extraOf`)
- Modify: `plugin/bin/lib/driver/judgment-io.js` (`launchJudge`'s return and catch)
- Modify: `plugin/bin/lib/driver/judgments.js` (`emitEvent`, the `judged` returns, `finish`)
- Modify: `plugin/bin/lib/driver/acceptance.js` (`judge`'s returns, the four `state.model` sites, the `merge-acceptance` emit)
- Modify: `plugin/bin/lib/driver/events.js` (header sentence on `model`: add `effort`)
- Test: `tests/bin-lib/driver/run.test.js` (`KW`, `K5M` key sets; new tests)
- Test: `tests/bin-lib/driver/review.test.js`
- Test: `tests/bin-lib/driver/judgments-merge-check.test.js`
- Test: `tests/bin-lib/driver/acceptance.test.js`

**Interfaces:**
- Consumes: `launchTracked` → `{ envelope, model, effort }`, `err.effort` (Task 3).
- Produces: wherever a line carries `model`, it carries `effort` too (a level string or `null`), under the same condition (`model` present ⇔ `effort` present). `launchJudge` → `{ envelope, model, effort }` or `{ stop, model?, effort? }`.

Return-shape widening (plan-authoring check): `grep -n "deepStrictEqual\|deepEqual" tests/bin-lib/driver/{run,review,judgments-merge-check,acceptance,merge}.test.js` hits that compare a whole `extra`, launch result or event line holding `model` must gain `effort`; `KW` and `K5M` are the known ones. List each one changed in the commit message body.

- [ ] **Step 1: Write the failing tests**

In `run.test.js` (the harness's worker fake receives the launcher opts; read `opts.effort` from it):
- `#5942 AC6.1: under model-effort profile every worker line's effort is the level its launch was given` — harness policy `{ 'model-effort': 'profile' }`; the worker line's `effort` equals the `effort` the fake launcher received (`'high'` with the shipped table); a fix-round run (`fixRig`) gives the review line the reviewer's level.
- `#5942 AC6.2: with the key unset the worker line's effort is null` — default harness; `'effort' in workerLine` and `workerLine.effort === null`.
- `#5942: a launcher throw after resolution keeps effort on the worker line` — copy `#5917: a launcher throw that moved HEAD still names the model on the worker line` and its index-flag sibling; assert `effort` beside `model`.
- `#5942: old readers tolerate the effort field` — copy `old readers tolerate the model field (#5917)`, stripping `effort`.
- Update `KW` to `[...K1, 'effort', 'model', 'tests'].sort()` and `K5M` to `[...K5, 'effort', 'model'].sort()` with the comment line naming #5942.

Proof(public-contract): the `BASE_KEYS_PLAIN`/`BASE_KEYS_FIX` comparisons, captured on pre-#5917 code, now differ from the run only by `effort` beside `model` on the worker and review lines, and the `BASE_LINES_*`/`BASE_CALLS_*` comparisons stay unchanged and green, so every pre-existing key and call keeps its value and order.
In `review.test.js`: the reviewer's line carries `effort` on the happy path and on a reviewer launcher throw (copy the existing `model`-on-throw case).
In `judgments-merge-check.test.js` and `acceptance.test.js`: the `merge-check` and `merge-acceptance` lines carry `effort` on the happy path and after a launcher throw that resolved (copy each file's `model` cases).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/judgments-merge-check.test.js tests/bin-lib/driver/acceptance.test.js`
Expected: FAIL after Step 1 (no `effort` key on the lines)

- [ ] **Step 3: Implement** — mirror each `model` site with `effort`; keep `model`'s presence as the condition (`launch.model` set ⇒ add both).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/driver/*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add plugin/bin/lib/driver/steps.js plugin/bin/lib/driver/review.js plugin/bin/lib/driver/judgment-io.js plugin/bin/lib/driver/judgments.js plugin/bin/lib/driver/acceptance.js plugin/bin/lib/driver/events.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/judgments-merge-check.test.js tests/bin-lib/driver/acceptance.test.js
git -C "$WT" commit -m "Name each worker launch's effort on its event line — #5942"
```

---

### Task 5: `docs/driver.md` documents the flag and the field

**Role:** integration

**Files:**
- Modify: `docs/driver.md` ("Event lines" step-line paragraph's `model` sentence; "Worker models" section: the `launchTracked` paragraph's "its `effort` is not passed to driver workers" clause, the Refusal paragraph's key list, and a new **The `effort` field.** paragraph after **The `model` field.**)
- Test: `tests/bin-lib/driver/run.test.js` (a docs test beside `docs (#5917): driver.md states the models key, its defaults and the refusal`)

**Interfaces:**
- Consumes: Tasks 1-4's behavior.
- Produces: none.

- [ ] **Step 1: Write the failing test** `docs (#5942): driver.md states the effort flag, when it is passed and the effort field` — reads `docs/driver.md` and asserts it contains each literal: `` `--effort` ``, `` `model-effort: profile` ``, `` `launchEffort` ``, `` The `effort` field. ``, `` `null` `` within that paragraph, `worker.js`. Factor the assertions into one function and add a go-red control that runs it against the text with the new paragraph removed and expects it to throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "docs \(#5942\)" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1

- [ ] **Step 3: Write the docs** — the flag is passed when `model-effort: profile` and the role's resolution gives a level (`resolve()`'s `launchEffort`; a Fast resolution gives none); an unknown level in a `model-profiles` row refuses the run at the policy step, and an invalid `model-effort` too; the field names the requested level, not what ran, `null` when no flag was passed (key unset or Fast, indistinguishable by design); what a flagless launch runs at points to `worker.js`'s header (Launch effort bullet), never restating the measured levels.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add docs/driver.md tests/bin-lib/driver/run.test.js
git -C "$WT" commit -m "Document the driver worker effort flag and event field — #5942"
```
