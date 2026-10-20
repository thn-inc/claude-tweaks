# Run-config integration-model pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `/flow` run's `config.yml` carries the resolved `integration-model` pin, written through `bin/set-config.js`, and the two readers that depend on it say so explicitly when it is missing instead of silently skipping their PR-bookend check.

**Architecture:** `integration-model` becomes a *run pin* in `bin/lib/set-config/write.js` — a config.yml key that `set-config.js` accepts and validates (against its `POLICY_KEYS` enum) but that is not a Manifesto lever (not numbered, not in the FYI table, not overridable). The Manifesto's one batch write gains an `integration-model={v}` pair resolved at run start; `flow/steps-and-gates.md` case 3's recovery batch carries it too. `verify-run-bookends.js` and `first-call-artifact-check.js` keep their current skip when the pin is absent or invalid, but print one degrade line on stderr.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T200655-record-3350/work/3350-spec.md` (record #3350)

Scope keywords: MANIFESTO_LEVERS, isManifestoAutoBatch, readConfigIntegrationModel, resolveIntegrationModel

## Global Constraints

- The pin is written only through the sanctioned writer `bin/set-config.js` — never a hand append (spec Deliverable 1).
- `integration-model` values: exactly `POLICY_KEYS`' enum, `pr-first` / `local-merge` (`plugin/bin/lib/policy-schema.js:34`).
- A missing pin must not start enforcing the PR bookend — the readers still skip, but loudly. Re-detecting the model mid-run is forbidden by `_shared/integration-model.md`'s Run-scoped stability.
- Any skill `.md` that newly names `integration-model` must cite `_shared/integration-model.md` (`tests/integration-model.test.js`'s walk).
- Commit messages: `{Verb} {what} — {detail}`, reference `refs #3350`, never `closes`/`fixes`.

## Review Focus

1. A pin whose value is not in the enum (`integration-model: bogus`, hand-edited) — readers must treat it as unpinned and print the degrade line, not treat it as local-merge silently. (Tasks 3, 4)
2. A `--set` batch carrying the 13 levers **plus** the pin with `mode=auto` — the FYI table must still render; adding the pin must not break `isManifestoAutoBatch`. (Task 1)
3. `--set` with an invalid pin value (`integration-model=github`) — exit 2, nothing written, message names the allowed values. (Task 1)
4. A pre-existing run whose `config.yml` predates this change (no pin) adopted under case 1 — the readers must print the degrade line rather than fail closed, so in-flight runs keep working. (Tasks 3, 4)
5. `local-merge` pin — no degrade line (it is a valid pin, the PR bookend is legitimately not required). (Tasks 3, 4)

---

### Task 1: `set-config.js` accepts the `integration-model` run pin

**Files:**
- Modify: `plugin/bin/lib/set-config/write.js` (lever set, `leverValues`, `validateLever`, exports)
- Modify: `plugin/bin/set-config.js` (`isManifestoAutoBatch`, unknown-key message, header comment)
- Test: `tests/bin-lib/set-config/write.test.js`, `tests/bin-lib/set-config/cli.test.js`

**Interfaces:**
- Produces: `RUN_PINS` (frozen array, `['integration-model']`) exported from `write.js`; `validateLever(key, value)` accepts any key in `MANIFESTO_LEVERS ∪ RUN_PINS`; `leverValues('integration-model')` → `['pr-first', 'local-merge']`. `MANIFESTO_LEVERS` is unchanged (still the 13 levers).

- [ ] **Step 1: Write the failing tests**

In `write.test.js`:
- `test('RUN_PINS: integration-model is a run pin, not a Manifesto lever')` — `RUN_PINS` deep-equals `['integration-model']`; `MANIFESTO_LEVERS.includes('integration-model')` is false; `leverValues('integration-model')` deep-equals `['pr-first', 'local-merge']`.
- `test('validateLever: integration-model accepts pr-first/local-merge and rejects other values')` — `validateLever('integration-model','pr-first').ok === true`; `validateLever('integration-model','github')` deep-equals `{ ok:false, reason:'invalid-value', allowed:['pr-first','local-merge'] }`.

In `cli.test.js` (reuse `fixture()`/`fakeDeps()` and `FULL_MANIFESTO_BATCH_AUTO`):
- `test('cli: a 13-lever auto batch plus the integration-model pin writes the pin and still prints the FYI table')` — `--set FULL_MANIFESTO_BATCH_AUTO + ',integration-model=pr-first'` exits 0; config.yml matches `/^integration-model: pr-first$/m`; stdout includes `### Pipeline Config (auto)`.
- `test('cli: an invalid integration-model pin value is exit 2 and writes nothing')` — `--key integration-model --value github` exits 2; stderr names `pr-first`; config.yml unchanged.
- `test('cli: a batch carrying an unknown non-pin extra key alongside the 13 levers is exit 2')` — `FULL_MANIFESTO_BATCH_AUTO + ',spec=12'` exits 2 (the pin allowance is not a general extra-key allowance).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/set-config/write.test.js tests/bin-lib/set-config/cli.test.js`
Expected: FAIL after Step 1 — `RUN_PINS` undefined; `integration-model` rejected as unknown-key.

- [ ] **Step 3: Implement**

`write.js`: add `RUN_PINS`; `leverValues`/`validateLever` check membership in `[...MANIFESTO_LEVERS, ...RUN_PINS]` (enum from the `POLICY_KEYS` row); header comment names run pins and why they are not levers (`_shared/integration-model.md`'s Run-scoped stability). `set-config.js`: `isManifestoAutoBatch` requires all 13 levers present and permits extra keys only from `RUN_PINS`; the unknown-key message lists `MANIFESTO_LEVERS` then `run pins: integration-model`. `renderManifestoFyi` is unchanged (levers only).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/set-config/write.test.js tests/bin-lib/set-config/cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/set-config/write.js plugin/bin/set-config.js tests/bin-lib/set-config/write.test.js tests/bin-lib/set-config/cli.test.js
git commit -m "Accept integration-model as a set-config run pin — refs #3350"
```

### Task 2: The Manifesto writes the pin

**Files:**
- Modify: `plugin/skills/flow/manifesto.md` — "Write mechanism" paragraph (line ~167) and the `On approval (option 1)` yaml example block
- Modify: `plugin/skills/flow/steps-and-gates.md` — case 3's first bullet (the batch-recovery write, line ~76)
- Modify: `plugin/skills/_shared/integration-model.md` — "Run-scoped stability" (line 29): name the writer
- Modify: `tests/bin-lib/set-config/write.test.js` — the `MANIFESTO_LEVERS matches manifesto.md's config.yml example block` test excludes `RUN_PINS` keys (as it excludes `spec`/`created`)
- Modify: `tests/dispatch-flow-rundir-handoff-fixture.test.js` — `MANIFESTO_SET` gains `integration-model=pr-first` (it mirrors the real batch shape; its comment says so)
- Create: `tests/flow-manifesto-integration-model-pin.test.js`

**Interfaces:**
- Consumes: Task 1's `RUN_PINS`, and `set-config.js` accepting `integration-model={v}` in `--set`.

- [ ] **Step 1: Write the failing tests** in `tests/flow-manifesto-integration-model-pin.test.js`

- `test('AC1.1: the Manifesto batch command, run as written, leaves integration-model: pr-first in config.yml with no hand edit')` — extract the `--set "…"` argument from manifesto.md's "Write mechanism" paragraph (regex on the paragraph starting `**Write mechanism`); assert its key list includes `integration-model`; substitute each `{v}` with a valid value (levers: the `FULL_MANIFESTO_BATCH_AUTO` values from `cli.test.js`; `integration-model`: `pr-first`); run `set-config.js`'s exported `run()` against a fixture shaped like `cli.test.js`'s `fixture()`; assert exit 0 and config.yml matches `/^integration-model: pr-first$/m`.
- `test('manifesto.md names how the pin value is resolved and cites the integration-model fragment')` — the Write mechanism paragraph contains `resolve-policy.js` and `--values integration-model`, and manifesto.md contains `_shared/integration-model.md`.
- `test('the On-approval yaml example carries the integration-model pin')` — the yaml block after `On approval (option 1)` has an `integration-model:` line.
- `test('steps-and-gates.md case 3 recovery batch carries the integration-model pin')` — the region between `### Adopting an inherited run directory` and `### Partial step lists` mentions `integration-model=` in its batch-write bullet.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/flow-manifesto-integration-model-pin.test.js`
Expected: FAIL — the batch command has no `integration-model` key.

- [ ] **Step 3: Edit the prose**

- `manifesto.md` Write mechanism: before the batch call, resolve the pin once — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values integration-model` — and append `,integration-model={v}` to the `--set` string (keep "all 13 lever values" wording true: the pin is named as the 14th pair, a run pin per `_shared/integration-model.md`'s Run-scoped stability, not a lever — it has no row in the levers table and no override). Add `integration-model: pr-first` to the yaml example after `merge-authorization: ask`. Keep the edit compact (file is 24 KB, rail 52.5 KB).
- `steps-and-gates.md` case 3 first bullet: the batch carries `integration-model={v}` too — from the snapshot header when it lists one, else resolved fresh as above.
- `integration-model.md` Run-scoped stability: say the pin is written by `/flow`'s Manifesto through `bin/set-config.js` (a run pin, not a lever), and that a reader finding no valid pin prints a degrade line and skips rather than re-detecting.
- `write.test.js`: skip keys in `RUN_PINS` when collecting the yaml block's lever keys.
- `dispatch-flow-rundir-handoff-fixture.test.js`: add `'integration-model=pr-first'` to `MANIFESTO_SET` (its per-pair config.yml loop then asserts it).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/flow-manifesto-integration-model-pin.test.js tests/bin-lib/set-config/write.test.js tests/dispatch-flow-rundir-handoff-fixture.test.js tests/flow-manifesto-degrade-trace.test.js tests/integration-model.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/manifesto.md plugin/skills/flow/steps-and-gates.md plugin/skills/_shared/integration-model.md tests/flow-manifesto-integration-model-pin.test.js tests/bin-lib/set-config/write.test.js tests/dispatch-flow-rundir-handoff-fixture.test.js
git commit -m "Write the integration-model pin from the Manifesto batch — refs #3350"
```

### Task 3: `verify-run-bookends.js` degrades loudly without a pin

**Files:**
- Modify: `plugin/bin/verify-run-bookends.js` (`run()`, after `readIntegrationModel`)
- Test: `tests/verify-run-bookends.test.js`

**Interfaces:**
- Produces: on a pin that is neither `pr-first` nor `local-merge` (absent → `null`, or any other string), `run()` writes exactly one stderr line starting `verify-run-bookends: degraded —` and naming `integration-model`; behavior and exit code otherwise unchanged. stdout JSON shape unchanged.

- [ ] **Step 1: Write the failing tests** (use `makeDeps`/`captured`)

- `test('AC2.1: with an integration-model: pr-first pin and no recorded PR, the pr bookend is asserted (missing), not skipped')` — `runState: { worktree: '/wt' }`, `integrationModel: 'pr-first'`, live claims for the targets; exit 1 and `missing` contains `{ bookend: 'pr' }`; stderr has no `degraded` line.
- `test('AC2.1: readConfigIntegrationModel reads a pin written by set-config.js')` — write a fixture config.yml via `set-config.js`'s `run()` (`--key integration-model --value pr-first`, fixture as in `cli.test.js`); `realDeps.readIntegrationModel(runDir) === 'pr-first'`.
- `test('AC3.1: with no integration-model pin, a degrade line is printed instead of passing silently')` — `integrationModel: null`, otherwise passing deps; exit 0 (unchanged) and `err.join('')` matches `/^verify-run-bookends: degraded — .*integration-model/m`.
- `test('AC3.1: an invalid integration-model pin prints the same degrade line')` — `integrationModel: 'bogus'`; same assertion.
- `test('a local-merge pin prints no degrade line')` — `integrationModel: 'local-merge'`; stderr empty.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/verify-run-bookends.test.js`
Expected: FAIL after Step 1 — the two AC3.1 tests (no stderr line).

- [ ] **Step 3: Implement** — in `run()`, after resolving `integrationModel`, when it is not `pr-first`/`local-merge` call `deps.stderr` once with `verify-run-bookends: degraded — {runDir}/config.yml carries no valid integration-model pin ({value|absent}); PR bookend not checked (_shared/integration-model.md's Run-scoped stability)\n`. Update the header comment's "Reads:" paragraph.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/verify-run-bookends.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/verify-run-bookends.js tests/verify-run-bookends.test.js
git commit -m "Print a degrade line when verify-run-bookends finds no integration-model pin — refs #3350"
```

### Task 4: `first-call-artifact-check.js` degrades loudly without a pin

**Files:**
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js` (`checkFirstCallArtifacts` deps + the pr-first branch)
- Modify: `plugin/skills/dispatch/two-call-gate.md` §2 "Artifact check" paragraph — one sentence: a `degraded` stderr line is logged as a `SKIP` decision (`log-decision.js --status SKIP`), never treated as a failure
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`

**Interfaces:**
- Produces: `checkFirstCallArtifacts(args, deps)` accepts `deps.warn` (`(line: string) => void`, default writes to `process.stderr`). When config.yml exists but `resolveIntegrationModel` returns `null` (absent or invalid pin), it calls `warn` once with a line starting `first-call-artifact-check: degraded —` naming `integration-model`. Return values unchanged.

- [ ] **Step 1: Write the failing tests** (reuse `mkRunDir`/`writeRunDir`/`writeHeader`/`fakeGhApi`/`fakeGitRunner`)

- `test('AC2.1: with an integration-model: pr-first pin, the PR-bookend check runs — no recorded PR fails pr-missing')` — config `integration-model: pr-first\n`, live claim, no `pr` in run-state; result `reason === 'pr-missing'`; `warn` never called.
- `test('AC3.1: with no integration-model pin, a degrade line is emitted instead of passing silently')` — config `autonomy: trusted\n`, live claim, header present, no PR; result `{ ok: true }` (unchanged) and the captured `warn` lines match `/^first-call-artifact-check: degraded — .*integration-model/`.
- `test('AC3.1: an invalid integration-model pin emits the same degrade line')` — config `integration-model: bogus\n`.
- `test('a local-merge pin emits no degrade line')`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: FAIL after Step 1 — the AC3.1 tests (`warn` never called).

- [ ] **Step 3: Implement** — add `warn = (line) => process.stderr.write(line)` to the deps destructure; after `resolveIntegrationModel(configRaw)`, when the result is `null` call `warn('first-call-artifact-check: degraded — {configPath} carries no valid integration-model pin; PR-bookend check not run (_shared/integration-model.md\'s Run-scoped stability)\n')`. Update the `resolveIntegrationModel` comment ("skipped" → "skipped with a degrade line"). Add the two-call-gate.md sentence.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js tests/dispatch-mechanical-enforcement.test.js tests/integration-model.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/first-call-artifact-check.js plugin/skills/dispatch/two-call-gate.md tests/bin-lib/dispatch/first-call-artifact-check.test.js
git commit -m "Emit a degrade line when the first-call artifact check finds no integration-model pin — refs #3350"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — Manifesto writes the pin through the sanctioned writer | 2 |
| Deliverable 2 — `set-config.js` accepts `integration-model` | 1 |
| Deliverable 3 — both readers report an explicit degrade | 3, 4 |
| AC1.1 | 2 (`AC1.1:` test) |
| AC2.1 | 3, 4 (`AC2.1:` tests, one per reader) |
| AC3.1 | 3, 4 (`AC3.1:` tests, one per reader) |
