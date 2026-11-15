# Express-lane run record binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An express-lane run's `config.yml` records `spec: {n}`, and `wrap-up-pack.js` resolves that run's record from it, so wrap-up merge mode binds an express run and the pack's `claim` probe returns `ok: true`.

**Architecture:** `spec` becomes a second run pin in `plugin/bin/lib/set-config/write.js` (beside `integration-model`), validated as a positive integer, so `set-config.js --set` accepts it. `express-lane.js check` appends `spec={n}` to the `configSet` string it already emits, so step 7's existing `set-config.js --set {configSet}` call (and the driver's `plugin/bin/lib/driver/steps.js`, which forwards the same string) writes it with no new call. `pack.js`'s `resolveRecords` gains a last rung, source `config`, that reads `config.yml`'s `spec:` when no header or manifest resolves. The lane does not write a materialized header: a `work/{n}-spec.md` would be a changed file outside the record's Key Files, which `express-lane.js check`'s diff bounds escalate as `out-of-bounds`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T085544-spec-5347/work/5347-spec.md`

Scope keywords: RUN_PINS, resolveRecords, configSet, closingRecords

## Global Constraints

- The `config` rung is **not** a closing source. `CLOSING_RECORD_SOURCES` stays `['headers', 'worktree-headers']` (Ruling R1, `pack.js`): a `config.yml` `spec:` is the lowest of a run's records (`plugin/bin/lib/flow/manifesto-write.js` writes `Math.min(...)`), so it names only one record of a multi-record run, and only a materialized header carries closing intent. An express run is single-record by construction (its gate admits one record), and its PR body already carries `Fixes #{n}` (`compose-pr-body.js --express --fixes {n}`).
- The `config` rung runs **last**, after both manifest rungs, so a header or manifest always wins over it. It never runs for a multi-spec `spec-{N}/` subdirectory (basename matching `/^spec-/`): that directory's `config.yml` is a byte-for-byte copy of the parent's (`flow/multispec-run-dir-layout.md`), so its `spec:` names the parent's lowest record, not this spec's.
- The Review Console's auto-merge short-circuit stays header-only (decided by the user at plan review, Reading A): its three gates — `wrap-up/auto-merge-short-circuit.md:9`, `wrap-up/review-console.md:26` and `wrap-up/SKILL.md:273` — test `inputs.closingRecords` being non-empty, never `inputs.records`, so a `config`-rung record never qualifies. Express runs keep merging through the lane's own step 9 or `/claude-tweaks:wrap-up #N merge`.
- The error string `records unresolved — no materialized header or manifest found` (`pack.js:664`) stays byte-identical (AC3.1); a run with no header, no manifest, and no valid `config.yml` `spec:` still resolves `unavailable`.
- Read `spec:` with `policy-schema.js`'s `parseFlatLines` (last occurrence wins, the same semantics `setConfigLever` documents), and accept only `/^[1-9][0-9]*$/`.
- Commit messages: `{Verb} {what} — refs #5347`, ending with `Claude-Session: https://claude.ai/code/session_01Ngy9oYpgbF2YHU6WxVApTz`. Stage by explicit path, never `-A`.
- Governing skill `gh-api-module-pattern/cli-wrapper-contract.md` (quoted verbatim): "*Sanctioned-writer* (`plugin/bin/log-decision.js`, `plugin/bin/stage-item.js`, `plugin/bin/set-config.js`, …): 0 written (the written path echoed to stdout), 2 malformed invocation, 3 the run dir is missing or not anchored under the main checkout, or the target file is unwritable — **no 1 at all**." A non-integer `spec` value is therefore exit 2 with nothing written.
- Same file, quoted verbatim: "Before adding a second concurrent writer of `config.yml`, or widening the batch further, give `setConfigLever` the same `withLock` + tmp+rename pairing `appendEntry` already has." This plan adds no concurrent writer (the express step 7 call is still the run's only `config.yml` writer, and step 9's read follows it sequentially) and does not widen the Manifesto's 14-entry batch (the Manifesto keeps appending `spec:` itself). The express batch grows from 4 to 5 sequential rewrites with no reader racing it. Record this reasoning in the Task 1 commit body. That file's "(plus at most the `integration-model` run pin)" phrase becomes stale and is updated in Task 1.
- Governing skill `run-directory-fact-packs/SKILL.md`: "**A filter every reader must apply is a field the pack owes.** … `inputs.records` names this run's closing records only when `inputs.sources.records` is `headers` or `worktree-headers` (#3365's Ruling R1)". The new rung keeps that: readers that need closing records keep reading `inputs.closingRecords`, which stays empty for `config`.

## Review Focus

1. A run dir carrying both a materialized header and a `config.yml` `spec:` naming a different number: the header wins (`source: 'headers'`) — Task 3 test.
2. A `config.yml` whose `spec:` is `0`, `abc`, `12x`, or empty: the rung yields nothing and the run stays `unavailable` — Task 3 test; `set-config.js` refuses the same values with exit 2 — Task 1 test.
3. A multi-spec parent dir with a `manifest.yml` and a `config.yml` `spec:`: the manifest rung wins and `closingRecords` stays `[]` — Task 3 test.
4. A `config.yml` written with CRLF line endings (a Windows checkout's hand-edit): `spec: 5338\r` still resolves `[5338]` — Task 3 test (`parseFlatLines` trims the value).
5. A config-rung pack's `closingRecords` is `[]` even though `records` is `[n]` — Task 3 test, plus `closingRecords({ records, source: 'config' })` returning `[]`.

---

### Task 1: `spec` is a run pin `set-config.js` accepts

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/set-config/write.js` (`RUN_PINS`, a positive-integer value rule for `spec`, header comments)
- Modify: `plugin/bin/set-config.js` (header comment "Run pins (RUN_PINS, currently just integration-model)"; no logic change — `validateLever` already drives the refusal message)
- Modify: `plugin/bin/lib/flow/manifesto-write.js:250-251` (comment only: `created:` is bookkeeping `set-config` refuses; `spec:` is a run pin since #5347 but is still appended here beside `created:`; behavior unchanged)
- Modify: `plugin/skills/flow/manifesto.md:167` — the sentence "`spec:`/`created:` (the two bookkeeping keys below) are not levers — `--set`/`--key` both refuse them by design — so this step writes them itself, appending both lines to `config.yml` after the batch call. Known gap: a worktree-pinned session has no writer for these two keys and ends the run with both absent — bounded (nothing reads them today), but do not add a reader without closing it first." becomes: `spec:` is a run pin `set-config.js` accepts (#5347) — after the batch call, write it with one single-key call, `node "${CLAUDE_PLUGIN_ROOT}/bin/set-config.js" --run "$PIPELINE_RUN_DIR" --key spec --value {lowest record number}`, which works from a worktree-pinned session too, since merge mode's run binding and the wrap-up pack's `config` rung read it; `created:` is bookkeeping `set-config.js` refuses, so the step appends that line itself; a worktree-pinned session has no writer for it and ends the run without it, which is bounded because nothing reads `created:`. The single-key call keeps the 14-pair Manifesto batch unchanged (the cli-wrapper-contract lock rule in Global Constraints). Add a pin in `tests/flow-manifesto-integration-model-pin.test.js` (the file that already reads this paragraph via `writeMechanismParagraph`): `test('AC1.1: the Write mechanism writes spec: through a single-key set-config call', …)` asserting the paragraph matches `/--key spec --value \{lowest record number\}/` and still has no `spec=` pair inside its `--set "…"` argument.
- Modify: `docs/plugin-structure.md:42` ("the RUN_PINS run pins — today `integration-model`" → name both pins, `integration-model` and `spec`)
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` ("(plus at most the `integration-model` run pin)" → "(plus at most the run pins, `RUN_PINS`)")
- Test: `tests/bin-lib/set-config/write.test.js`
- Test: `tests/bin-lib/set-config/cli.test.js`
- Test: `tests/flow-manifesto-integration-model-pin.test.js`
- No change (read and classified): `tests/flow-manifesto-integration-model-pin.test.js:80` and `tests/manifesto-lever-conformance.test.js:83` filter `RUN_PINS` and stay correct with `spec` in it; `write.test.js:90` already excludes `spec` by name; `plugin/skills/_shared/integration-model.md:29` describes only the `integration-model` pin.

**Interfaces:**
- Produces: `RUN_PINS` = `['integration-model', 'spec']`; `validateLever('spec', v)` → `{ ok: true }` for `/^[1-9][0-9]*$/`, else `{ ok: false, reason: 'invalid-value', allowed: ['a positive integer record number'] }`; `leverValues('spec')` → `null` (no enum).

- [ ] **Step 1: Write the failing tests**

In `write.test.js`: change the `RUN_PINS` test to `assert.deepEqual([...RUN_PINS], ['integration-model', 'spec'])` and `assert.equal(MANIFESTO_LEVERS.includes('spec'), false)`. Add `test('AC1.1: validateLever accepts spec as a positive-integer run pin', …)`: `validateLever('spec', '5347')` and `('spec', '7')` → `{ ok: true }`; each of `'0'`, `'-1'`, `'abc'`, `'12x'`, `'07'`, `''` → `{ ok: false, reason: 'invalid-value', allowed: ['a positive integer record number'] }`. In the existing unknown-key test, drop `'spec'` from the list (keep `'created'`, `'worktree-always'`, `'not-a-lever'`).

In `cli.test.js` (follow its existing fixture and deps helpers): `test('AC1.1: --set accepts spec={n} and writes spec: {n} to config.yml', …)` running `run(['--run', runDir, '--set', 'mode=auto,spec=5347'], deps)` → exit 0 and `config.yml` matching `/^spec: 5347$/m`; and `--set spec=abc` → exit 2, stderr matching `/--value "abc" is not valid for spec \(allowed: a positive integer record number\)/`, no `config.yml` written.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/set-config/write.test.js tests/bin-lib/set-config/cli.test.js`
Expected: FAIL after Step 1 — `RUN_PINS` lacks `spec`; `validateLever('spec', …)` returns `unknown-key`.

- [ ] **Step 3: Implement** — add `'spec'` to `RUN_PINS`; add a pattern-validated pin rule (`spec: /^[1-9][0-9]*$/` with its `allowed` description) that `validateLever` checks after `isConfigKey` and before the enum lookup. Update the comments and the three prose sites listed under Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/set-config/ tests/flow-manifesto-integration-model-pin.test.js tests/manifesto-lever-conformance.test.js tests/bin-lib/flow/manifesto-write.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Accept spec as a set-config run pin — refs #5347`, with the Global Constraints' lock reasoning in the body.

### Task 2: `express-lane.js check` emits `spec={n}` in `configSet`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/express/cli.js:345` (`configSet` gains `,spec=${n}` at the end; update the comment above it to name the record pin)
- Modify: `plugin/skills/_shared/express-lane.md` step 7 — "carries the express merge-verification and the `integration-model` pin (`_shared/integration-model.md`'s Run-scoped stability) to the merge" gains "and the run's record as `spec: {n}`, which `wrap-up/merge-mode.md`'s run binding and the wrap-up pack's record resolution read". The 18305-byte file stays far under the 52500-byte rail.
- Test: `tests/bin-lib/express/cli.test.js` (the three exact `configSet` assertions at lines 300, 342, 346 become `…,merge-verification={v},spec=7`), `tests/express-lane-prose.test.js` (add a pin for the new clause beside line 51's)
- No change (classified): `plugin/bin/lib/driver/steps.js:810-814` forwards `configSet` verbatim, so it carries `spec` with no edit; `tests/bin-lib/driver/run.test.js` uses a fake `configSet` (`'k=v'`). `plugin/skills/flow/express-entry.md:20` appends `,merge-authorization=pre-authorized` to the end of the string, which still composes.

**Interfaces:**
- Consumes: Task 1's `spec` run pin.
- Produces: `check`'s `proceed` envelope `configSet` = `mode=auto,ceremony-profile=fast-lane,integration-model=pr-first,merge-verification=${mergeVerification},spec=${n}`.

- [ ] **Step 1: Write the failing tests** — update the three `configSet` assertions; add `test('AC1.1 AC3.1: the proceed configSet written through set-config.js leaves spec: {n} in config.yml', …)`, which takes `h.json().configSet` from a `check` proceed on issue 7, runs `require('../../../plugin/bin/set-config.js').run(['--run', fx.runDir, '--set', configSet], deps)` (deps anchored at the fixture's main root the way `tests/bin-lib/set-config/cli.test.js` builds them), and asserts exit 0 and `config.yml` matching `/^spec: 7$/m` and `/^integration-model: pr-first$/m`. This end-to-end case is the "express `check` → `set-config` sequence" pin the spec's third Deliverable names. Add the prose pin `/and the run's record as `spec: \{n\}`/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/express/cli.test.js tests/express-lane-prose.test.js`
Expected: FAIL after Step 1 — `configSet` has no `spec=7`; the prose clause is absent.

- [ ] **Step 3: Implement** the `configSet` change and the step 7 sentence.

- [ ] **Step 4: Run tests to verify they pass** — same command, plus `node --test tests/bin-lib/driver/run.test.js tests/flow-express-entry-prose.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** — `Record the run's spec in the express configSet — refs #5347`.

### Task 3: the wrap-up pack resolves an express run's record from `config.yml`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` — a `configRecords(deps, dir)` helper (reads `{dir}/config.yml` through `readText`, `parseFlatLines`, returns `[n]` for a valid `spec:` else `[]`); `resolveRecords` adds rung (e) after the worktree-manifest rung, returning `{ records, source: 'config', parkedAtShaping: {} }`, skipped when `path.basename(runDir)` matches `/^spec-/` (a multi-spec subdirectory — Global Constraints); update the ladder comment above `resolveRecords` and the Ruling R1 comment above `CLOSING_RECORD_SOURCES` to say why `config` is not closing.
- Modify: `plugin/skills/wrap-up/review-console.md:26` — re-gate the Auto-merge short-circuit's header test on `{run-dir}/wrap-up-pack.json`'s `inputs.closingRecords` being non-empty (in place of `inputs.records`), naming it as the header rungs' result (own `work/`, then the worktree's mirror) — a `manifest` or `config` rung never qualifies (Reading A)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` — its line 9 condition gets the same re-gate to `inputs.closingRecords`; line 135's "this short-circuit already requires a materialized header with a `record:` field" stays true and needs no edit
- Modify: `plugin/skills/wrap-up/SKILL.md:273` — "This run resolves a materialized header (`inputs.records`)" → `inputs.closingRecords`
- Test: `tests/wrap-up-record-resolution-conformance.test.js` — `test('Reading A: the auto-merge short-circuit gates on inputs.closingRecords at all three sites, never inputs.records', …)` asserting each of the three passages names `inputs.closingRecords` and none of them gates on `` `inputs.records` is non-empty ``
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md:76` ("is empty on a `manifest`/`worktree-manifest` rung" → also on the `config` rung, which names only the run's lowest record)
- Modify: `.claude/skills/run-directory-fact-packs/SKILL.md:155` ("reads own `work/`, then that mirror (#3365)" → add "then the manifest rungs, then `config.yml`'s `spec:` (#5347)")
- Modify: `plugin/bin/lib/console/resolve.js:295-298` (comment only: the ladder list gains the `config.yml` `spec:` rung)
- Modify: `docs/journeys/gather-the-wrap-up-fact-pack-1930.md` (its `sources.records` list names `headers`, `worktree-headers`, `manifest`, `worktree-manifest`; add `config` — the run's `config.yml` `spec:`, the express-lane case — and note it is not a closing source)
- Test: `tests/bin-lib/wrap-up/pack.test.js`
- Consumers (read and classified): `engine-verify.js:447` reads `closingRecords(…)` — unaffected, since `config` is not closing; `console/resolve.js` `readMembers` (list-all) and `pack.js` `ownRecordNumbers` (list-all, the ledger's `excludeRecords`) gain the express run's one record, which is its correct member and own record; the `claim`, `ledger`, `recordLabels` and `unblocked` probes stop failing on `recordsOrThrow()` for an express run.

**Interfaces:**
- Consumes: the `config.yml` `spec:` line Tasks 1–2 write.
- Produces: `resolveRecords(deps, runDir, worktree)` may return `source: 'config'`; `closingRecords({ source: 'config' })` → `[]`.

- [ ] **Step 1: Write the failing tests** (each builds its own temp run dir with `run-state.json` `{ worktree: '/w/tree' }` and no `work/`):
  - `test('AC2.1: an express run dir (config.yml spec:, no header or manifest) resolves its record from the config rung and the claim probe is ok', …)`: `config.yml` `spec: 5338\nceremony-profile: fast-lane\nintegration-model: pr-first\n`; `resolveInputs(…).records` → `[5338]`, `sources.records` → `'config'`, `closingRecords` → `[]`; `gatherPack({ only: ['claim'], deps: okDeps() })` → `pack.claim.ok === true` and `pack.claim.value` → `{ 5338: { state: 'live', reclaimable: false, via: 'git' } }`.
  - `test('AC3.1: a config.yml with no valid spec: still leaves records unresolved', …)`: for each of `''` (no spec line), `spec: 0`, `spec: abc`, `spec: 12x` → `sources.records === 'unavailable'` and `gatherPack({ only: ['claim'] })` → `claim.ok === false`, `claim.error` matching `/^records unresolved — no materialized header or manifest found$/`.
  - `test('the config rung is last: a header wins over config.yml spec:', …)`: header `work/1535-spec.md` plus `spec: 9999` → `records` `[1535]`, source `'headers'`.
  - `test('the config rung is last: a manifest wins and closingRecords stays empty', …)`: `manifest.yml` with ids 1930, 1931 plus `spec: 1930` → source `'manifest'`, `closingRecords` `[]`.
  - `test('the config rung reads a CRLF config.yml', …)`: `spec: 5338\r\nmode: auto\r\n` → `[5338]`.
  - `test('the config rung never runs for a multi-spec spec-{N} subdirectory', …)`: a run dir whose basename is `spec-1931`, holding only `config.yml` `spec: 1930` (the parent copy) and a `run-state.json` with no `worktree` → `sources.records === 'unavailable'`, `records` `[]`.
  - Extend `closingRecords keeps records only for the two header rungs` so its empty-list loop includes `'config'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js`
Expected: FAIL after Step 1 — the express fixture resolves `unavailable` and its claim probe throws `records unresolved`.

- [ ] **Step 3: Implement** `configRecords` and the rung, then the comment and prose updates listed under Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/ tests/bin-lib/console/ tests/wrap-up-record-resolution-conformance.test.js tests/wrap-up-pack-conformance.test.js tests/wrap-up-closing-records-array-fill.test.js`
Expected: PASS

- [ ] **Step 5: AC3.1 grep** — run `git grep -n -F 'records unresolved — no materialized header or manifest found' -- plugin/bin/lib/wrap-up/pack.js`. Expected: one match.

- [ ] **Step 6: Commit** — `Resolve an express run's record from config.yml spec in the wrap-up pack — refs #5347`.

## Scope sweep (Check B, read and classified — no change)

Each path below matched a `Scope keywords:` term; none needs an edit.

- Read: `CHANGELOG.md` — append-only history.
- Read: `docs/superpowers/plans/2026-11-03-ledger-row-cli.md` — a shipped plan, history.
- Read: `docs/superpowers/plans/2026-11-12-drive-js.md` — a shipped plan, history.
- Read: `docs/journeys/verify-wrap-ups-closure-checklist-900.md` — describes `carrier-commit`'s closing set, header rungs only, which this plan keeps.
- Read: `plugin/bin/dispatch-resume.js` — its `closingRecords` is GitHub's `closingIssuesReferences.totalCount` on a PR, a different field.
- Read: `plugin/bin/lib/dispatch/resume-eligibility.js` — the same PR closing-issue count.
- Read: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js` — the same PR closing-issue count.
- Read: `tests/bin-lib/dispatch/resume-eligibility.test.js` — the same PR closing-issue count.
- Read: `tests/bin-lib/dispatch/stuck-open-pr.test.js` — the same PR closing-issue count.
- Read: `plugin/bin/lib/dispatch/first-call-artifact-check.js` — its comment says the ladder reads one header shape per run; still true, the new rung reads no header.
- Read: `plugin/bin/lib/driver/steps.js` — forwards `configSet` verbatim (Task 2).
- Read: `tests/bin-lib/driver/run.test.js` — fakes `configSet` as `'k=v'` (Task 2).
- Read: `plugin/bin/lib/wrap-up/engine-verify.js` — reads `closingRecords`, unchanged for `config` (Task 3).
- Read: `tests/bin-lib/wrap-up/engine-verify.test.js` — the same closing set.
- Read: `plugin/skills/_shared/integration-model.md` — names `RUN_PINS` only for the `integration-model` pin (Task 1).
- Read: `plugin/skills/dispatch/two-call-gate.md` — cites `inputs.closingRecords` without enumerating sources.
- Read: `plugin/skills/flow/express-entry.md` — appends `merge-authorization` to the end of `configSet` (Task 2).
- Read: `plugin/skills/wrap-up/cleanup-procedures.md` — cites `inputs.closingRecords` without enumerating sources.
- Read: `plugin/skills/wrap-up/execution-and-verification.md` — cites `inputs.closingRecords` without enumerating sources.
- Read: `tests/express-lane-prose.test.js` — Task 2 adds a pin here.
- Read: `tests/flow-express-entry-prose.test.js` — Task 2's Step 4 runs it.
- Read: `tests/flow-manifesto-integration-model-pin.test.js` — filters `RUN_PINS` (Task 1).
- Read: `tests/manifesto-lever-conformance.test.js` — filters `RUN_PINS` (Task 1).
- Read: `tests/wrap-up-closing-records-array-fill.test.js` — reads `inputs.closingRecords` from a hand-written pack (Task 3's Step 4 runs it).
- Read: `tests/wrap-up-pack-conformance.test.js` — Task 3's Step 4 runs it.
- Read: `tests/wrap-up-record-resolution-conformance.test.js` — Task 3's Step 4 runs it.

`plugin/skills/wrap-up/cleanup-procedures-execution.md` is 47386 bytes (5114 under the 52500 rail); Task 3's one-clause edit adds well under 200 bytes.

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 — after step 7, `config.yml` holds `spec: {n}` | Task 1 `AC1.1` tests; Task 2 `AC1.1 AC3.1` end-to-end test |
| AC1.2 — merge-mode's binding check passes without a hand-logged decision | Waived AC1.2: `merge-mode.md:13`'s binding is a prose comparison of `config.yml` `spec:` with `{n}` (no CLI to test); Task 2's end-to-end test pins that the value written equals the issue number |
| AC2.1 — `wrap-up-pack.js --only claim` prints `ok: true` for an express run | Task 3 `AC2.1` test |
| AC3.1 — the error string still matches, and the new test fails on current code | Task 3 Step 5 grep and `AC3.1` test; each task's Step 2 shows its tests red first |
