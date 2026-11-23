# Driver implementer at the record's profile, with one relaunch one profile up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `implementer-tier: record`, the pipeline driver launches its implementer on the profile #5996's record rule picks, and relaunches it once, one profile up, after a `cannot-complete` worker or a red test step, before the record leaves the lane; under `lane` (the default) the driver behaves as today.

**Architecture:** `launch.js` gains an explicit `profile` argument on `roleLaunch`/`launchTracked` and a `recordImplementerProfile` that turns #5996's rule into a profile (a throw is a `DRIVER_MODEL_REFUSED` refusal). A new pure module `plugin/bin/lib/driver/relaunch.js` decides whether a relaunch runs and composes its prompt text. `run.js`'s record loop learns one generic result field, `then` (steps to run next, before the rest of the table), so `steps.js`'s one relaunch helper can queue `[relaunch worker, commit, test]` after the failing step and every queued step writes its own line and becomes the stop under its own name; no step name enters `run.js`.

**Tech Stack:** Node 18+ CommonJS, `node --test` via `tools/run-tests.js`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T062207-record-5997/work/5997-spec.md` (re-materialized with the record's `## Decisions` section, which settles the first run's two plan-review questions; both match this plan's readings)

Scope keywords: runImplementer, fixWorkerLaunch, mergeWorker

Waived plugin/bin/lib/driver/events.js: read only — `neutralize` and the step names are reused; the event vocabulary gains fields, never names (`STEP_NAMES` unchanged), so no edit (Tasks 3 and 5 read it).
Waived plugin/bin/lib/model-profiles/implementer-tier.js: read only — `implementerProfile`, `keyFileCount` and `stepUp` are called as #5996 shipped them (Tasks 2 and 4).
Waived plugin/bin/lib/driver/roles.js: read only — Task 1 checks envelopes against its `RESULT_SCHEMA`.
Waived plugin/bin/lib/verify/pre-existing.js: read only — it names `failingFiles`, but the field is not in `report.json` (premise reversed at Spec Step 3); Task 4 reads `lib/verify/extract.js` instead.


## Global Constraints

- Under `lane`, or the key unset, the implementer's profile comes from `express-driver-models.implementer` exactly as today, and no relaunch ever runs (spec Deliverable 1, AC2).
- Under `record`, the first profile is `implementerProfile({ size, keyFileCount: keyFileCount(body), rule: 'record' })`, `size` from `parseRecordFacets(ctx.issue.labels)`, `body` = `ctx.issue.body` (confirmed at Spec Step 3: `fetchStep` requests `body`). Never derive the count from `ctx.keyFiles`.
- The profile reaches `roleLaunch` as an explicit argument, never through `ctx.shared`. Resolution goes through the same `resolve()` call (`unattended: true`), so `model-profiles`, `model-ceiling` and `model-effort` still apply. Every other role is unchanged.
- A throw from #5996's functions refuses the launch as `DRIVER_MODEL_REFUSED` (no event line, like today's launch-time refusal).
- Exactly two triggers, once, at `stepUp(firstProfile)`: a worker step ending `cannot-complete` (status `stop`) and a test step ending red (`reason: 'failing-test'`). A worker `fail` (launch error, ceiling, a status that is neither `done` nor `cannot-complete`) never relaunches.
- No relaunch when `stepUp` returns `null` or when the step-up's resolved model equals the first attempt's resolved model (compare `roleLaunch(...).model`, not profile names); the triggering line says why (`noRelaunch`).
- At most one relaunch per record; a second failure ends the record as a single failure of that kind does today, its detail noting the relaunch. A record launches at most three implementers: first, relaunch, review fix round.
- The review fix round (`review.js`'s `fixRound`) is unchanged and launches on the profile of the attempt that went green; its `worker` line gains `profile` only (no `attempt`).
- Ceilings stay per launch: the relaunch gets the full `express-driver-wall-clock-minutes` and `express-driver-spend-ceiling-dollars`. No run-wide budget.
- Event lines: each worker-step or relaunch line carries `model`, `profile`, `attempt` (`1` or `2`); the relaunch line also `escalatedFrom` and `trigger` (`'cannot-complete'` | `'red-tests'`). Fields are added, never renamed (`events.js` header).
- After red tests the relaunch prompt names the failing test files with their failure lines: at most 20 files and 4 KB, each through `neutralize`. When the report is missing or unreadable, fixed text, never report-shaped words, and the relaunch still runs.
- Spec premise reversed at Spec Step 3 (`decisions.md`): `report.json` has no `failingFiles` field. The failing files come from `plugin/bin/lib/verify/extract.js`'s `extractFailingFiles` over each failed check's `failingRegion` (a capped string), the report found through the last `type: "verify"` line's `reportPath` in `{ctx.runDir}/events.jsonl`.
- Spec Decision Q1 (Reading A, user decision 2026-11-23, replacing Reading B): a red test step always triggers the relaunch, whether or not the test run left the worktree different from HEAD. There is no tree-state no-relaunch case and no tree check before the relaunch. The relaunch's commit step stages whatever git reports changed, test-written bytes included, and the second test run, `check`'s bounds and CI judge those bytes like any worker edit.
- Spec Decision Q2 (Reading A): when `resolve()` throws for the stepped-up profile (`roleLaunch('implementer', policy, { profile: to })` refuses), it counts as a relaunch whose launch is refused: `planRelaunch` returns `{ relaunch: true, to }`, the relaunch worker step's launch refuses with `DRIVER_MODEL_REFUSED`, no `worker` line is written for it, and the final stop's detail names the relaunch (`relaunchNote`). Never `noRelaunch: 'unresolved'`.
- After a red-tests relaunch the continuation commit step extends, never overwrites, `ctx.changedFiles`: the first commit's paths, then the relaunch commit's new ones, first seen first (the same union `review.js`'s `fixRound` builds), so `check`, the reviewer prompt and the summary line name both commits' files. After a cannot-complete relaunch there is no first commit, so the continuation commit's paths stand as they are.
- Plan decision (spec reading): "the final stop reports the second failure's step" needs the queued relaunch steps to be walked by `run.js` under their own names, so the relaunch's steps are queued through the generic `then` result field rather than run inline inside the test step. The spec's Key Files list names `run.js` for exactly this ("if the relaunch needs the test step re-entered").
- Driver reads `implementer-tier` through the same `realDeps.resolvePolicy` call as `express-driver-models` (no run dir, so no `config.yml`; whatever layers that resolver reads — `policy.yml`, and the factory layer since #6006 — apply alike).
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Maturity `established` (verbatim): "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them."
- Tests run through `node tools/run-tests.js <files>` (never bare `node --test`, never the whole suite per task). Never `git stash`; never `git checkout`/`git restore` to undo an edit — use the Edit tool.

Governing project skills, quoted verbatim (every implementer reads these as rules):

- `.claude/skills/driver-step-addition`: "`run.js` owns only event emission, stop handling and interrupts, and it names no step, so most of a new step is one table entry." — "Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one." — "Event fields may be added but never renamed, because the settle unit reads the final line's `stop`" — "Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3)." — "Reach the re-run steps through a wiring object that `steps.js` builds and passes in. The new module never requires `steps.js`." — "Launch workers through `plugin/bin/lib/driver/launch.js` (`readCeilings`, `launchTracked`, `WIN32_CLAUDE_BIN`). Never copy the launch wiring." — "Say which `ctx` fields the re-run merges (`ctx.worker`), extends (`ctx.changedFiles`) or overwrites (`ctx.check`). The push guard reads the last check's head." — "Propagate a re-run step's own status and class unchanged, and list each re-run step's stops in the new module's header." — "A value resolved at launch that an event line must name travels on the thrown error as well as on the result: `launchTracked` resolves `{ envelope, model }`, and a launcher throw after the model resolved carries `err.model`. Every catch of a launch keeps it on the stop it returns" — "A baseline the check keeps on `ctx` (`ctx.indexFlags`) starts as `null` in `newCtx` and gets no `interruptClass` rung: it is a read, not a side effect." — Second line under an existing step name: "Every reader keyed on the step name now sees two lines, so a second line of an existing name owes three things: **A station-mirror decision.** … **A step-yield reading.** … **The baseline captures.** The line shifts `BASE_LINES_FIX`, `BASE_KEYS_FIX` and `BASE_CALLS_FIX` in `run.test.js` by one entry each … Say both in the commit body." — "Every comparison with those captures goes through `baselineCalls` … A later check adds its own reads' filter there, never a new filter chain at each comparison". — "`docs/driver.md` | Copied by hand. A few tests in `run.test.js` pin named rules in it (the `AC9.1` docs tests, and #5454's tree-stop test), so a change to a pinned rule's wording updates its test too".
- `.claude/skills/headless-worker-launch`: "Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached" — "Copying the probed facts into this skill or another document | They drift from the headers they came from; point at `roles.js` and `worker.js` instead" — "Envelope `ok` means only that conforming structured output arrived; the worker's verdict is `result.status`, which may be `cannot-complete`." — "A live smoke or probe prompt that leaves the worker to phrase its own Bash commands | The model rewrites them … tell it to run each command exactly as written" — "Termination forwarding goes through `plugin/bin/lib/driver/launch.js`'s `launchTracked`, which every driver launch site calls … A new launch site calls `launchTracked` rather than wrapping the runner itself."
- `bin-source-scan-conformance` / source-scan lint: new `plugin/bin` code reads files only through `deps.readFile` (never bare `fs.existsSync`/`fs.realpathSync`; `tests/path-guard-conformance.test.js`), and spawns nothing.

## Review Focus

1. A record with no `size:*` label under `record` — `implementerProfile` returns `standard`; the first launch goes on Standard, never refused (Task 3 test).
2. A red test run that rewrote a tracked file or left an untracked one — it still relaunches (Decision Q1), and the relaunch commit stages those bytes by explicit path like any worker edit; the second test run and `check` then judge them (Task 5 test).
3. A verify report that is missing, not JSON, names a non-string `reportPath`, or lists 30 failing files with megabytes of region — fixed text or a capped, neutralized block (≤ 20 files, ≤ 4096 bytes), the relaunch still runs (Task 4 tests).
4. A signal during the relaunch worker launch — reported as the interrupt at the relaunch step, no commit or test after it (Task 5 test, through `run.js`'s existing handler).
5. A relaunch worker that moves HEAD or sets an index flag — `runImplementer`'s existing HEAD and flag checks stop it with `fail`, detail noting the relaunch, no third launch (Task 5 test).

---

### Task 1: Live probe of three Fast workers, recorded in `worker.js`'s header (before any code)

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js` (module header, after the `Launch effort (#5942)` bullet)
- Test: `tests/bin-lib/driver/worker.test.js` (one opt-in live test after `AC7.1 (#5942)`)

**Interfaces:**
- Consumes: `launchWorker`, `RESULT_SCHEMA`, `resolve` (`profiles.js`), `resolvePolicyKeys` + `modelProfilesEntry` over this repository's `.claude-tweaks/policy.yml` text.
- Produces: nothing code-facing.

- [ ] **Step 1: Write the opt-in live test** `AC9.1 (#5997): live probe — three implementer launches on the Fast model return a RESULT_SCHEMA envelope`, skipped unless `DRIVER_LIVE_SMOKE` is set (same skip message shape as `AC8.1`). It resolves `resolve('fast', { policy, unattended: true })` from the repository's own `policy.yml` (read with `fs.readFileSync(path.join(REPO_ROOT, '.claude-tweaks', 'policy.yml'), 'utf8')`, keys `model-profiles`, `model-ceiling`, `model-effort`), then three times: a fresh `git init` temp dir holding a committed `greet.js` (`return 'Hello ' + name;`), a prompt in `workerPrompt`'s shape asking for `'Hello Ann!'` with "Tests: do not run tests", `launchWorker({ role: 'implementer', model, ...(launchEffort ? { effort } : {}), testCommand: 'npm test', ceilings: { wallClockMs: 300000, spendCeiling: 1 } })`. Each launch is logged with `t.diagnostic` (status, reason, `result.status`, costUsd). Asserts: every envelope `status === 'ok'` and `['done', 'cannot-complete'].includes(result.status)` (count of valid envelopes `=== 3`).

- [ ] **Step 2: Run it live**

Run: `DRIVER_LIVE_SMOKE=1 node tools/run-tests.js tests/bin-lib/driver/worker.test.js -- --test-name-pattern="AC9.1"` (if `run-tests.js` passes no `--test-name-pattern`, run `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern="AC9.1" tests/bin-lib/driver/worker.test.js` once and say so in the report). Quote the three diagnostic lines. Also run `claude --version`.
Expected: 3 of 3 valid envelopes. Fewer than three: STOP, report BLOCKED with the diagnostics — do not continue to Task 2 (spec: "fewer than three valid envelopes fails it, and the record stops and reports").

The controller's scratch probe at Spec Step 3 (2026-11-22, CLI 2.1.325, darwin, subscription login, no TTY) returned 3/3 `ok` on `haiku` (`launchEffort` null): two `done`, one `cannot-complete` after a correct edit; all three tried `git commit` and were denied.

- [ ] **Step 3: Record the probe in `worker.js`'s header** as a new bullet `- Fast implementer (#5997).` naming: the date, CLI version, platform, login kind, no TTY, the model alias (`haiku`, what `resolve('fast')` returns under this repository's policy), launches under `--safe-mode --restricted`, how many of three returned a valid result envelope and their `result.status` values, the denied `git commit` attempts, and that a change to `RESULT_SCHEMA`, the sandbox flags or the Fast profile's model needs a re-probe (re-run: the opt-in `AC9.1 (#5997)` live probe).

- [ ] **Step 4: Commit**

```bash
git add plugin/bin/lib/driver/worker.js tests/bin-lib/driver/worker.test.js
git commit -m "Probe three Fast implementer launches before the driver uses them — refs #5997"
```

### Task 2: `launch.js` — an explicit implementer profile and the record rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/launch.js`
- Modify: `tests/bin-lib/driver/run.test.js` (`POLICY` only: add `'implementer-tier': 'lane'` at the end, in `MODEL_POLICY_KEYS` order)
- Test: `tests/bin-lib/driver/launch.test.js`

**Interfaces:**
- Produces:
  - `roleLaunch(role, policy, { profile } = {}) -> { model, effort, profile }` — `profile` given (a string) replaces the role-map lookup for that call (any role; only the implementer path passes one); the returned `profile` is the profile name resolved (the map's value, the code default, or the one passed). Refusals as today; a passed profile that does not resolve refuses `profile {p} did not resolve (…)`.
  - `roleModel(role, policy)` unchanged (= `roleLaunch(role, policy).model`).
  - `launchTracked(shared, deps, ceilings, opts) -> { envelope, model, effort, profile }`; `opts.profile` (optional) is passed to `roleLaunch` and stripped from what reaches `deps.launchWorker`; a launcher throw carries `err.profile` beside `err.model`/`err.effort`.
  - `recordImplementerProfile({ labels, body }, { profileFor = implementerProfile } = {}) -> 'fast' | 'standard'` — `profileFor({ size: parseRecordFacets(labels || []).size, keyFileCount: keyFileCount(typeof body === 'string' ? body : ''), rule: 'record' })`; any throw becomes `refuse('implementer', 'implementer-tier: ' + neutralize(err.message))` (code `DRIVER_MODEL_REFUSED`). `profileFor` is a test seam only: probed at authoring, `parseRecordFacets` maps an unknown `size:huge` to `null` and `keyFileCount` always returns a safe integer, so no real record makes `implementerProfile` throw — the wrapper is the spec's fail-closed rule for a future #5996 change.
  - `MODEL_POLICY_KEYS` gains `'implementer-tier'` (last), so `modelPolicyRefusal` returns `driver model policy invalid: implementer-tier` for an invalid value (fail closed, as `bin/implementer-tier.js` refuses one).
  - `IMPLEMENTER_TIER_KEY = 'implementer-tier'` exported.

- [ ] **Step 1: Write the failing tests** in `launch.test.js` (reuse its `policyFrom`, `M`, `refused`, `composedArgs` helpers):
  - `#5997: roleLaunch with an explicit profile resolves that profile and names it` — `roleLaunch('implementer', policyFrom(''), { profile: 'fast' })` deep-equals `{ model: M('fast'), effort: null, profile: 'fast' }`; with no option `.profile === 'standard'`; `roleLaunch('reviewer', policyFrom('')).profile === 'capable'`; `roleLaunch('explorer', policyFrom('')).profile === 'standard'`.
  - `#5997: an explicit profile still goes through model-ceiling` — `roleLaunch('implementer', policyFrom('model-ceiling: fast\n'), { profile: 'standard' }).model === M('fast')`.
  - `#5997: an explicit profile that does not resolve refuses` — `{ profile: 'turbo' }` throws `DRIVER_MODEL_REFUSED`, message matching `/^no model for driver role implementer: profile turbo did not resolve/`.
  - `#5997 AC1.1: recordImplementerProfile` table — labels `[{name:'size:low'}]` with a body whose `### Key Files` lists `a.js` and `b.js` → `'fast'`; three files → `'standard'`; `size:high` with one file → `'standard'`; no size label, one file → `'standard'`; `size:low` with a `src/` directory entry → `'standard'`.
  - `#5997: a throw from the rule refuses as DRIVER_MODEL_REFUSED` — `recordImplementerProfile({ labels: [], body: '' }, { profileFor: () => { throw new Error('implementer-tier: unknown size "x" @y') } })` throws with `code === MODEL_REFUSED_CODE`, a message starting `no model for driver role implementer: implementer-tier`, and no `@y` mention (neutralized); `labels: [{ name: 'size:huge' }]` through the real rule returns `'standard'` (an unknown size label reads as no size).
  - `#5997: launchTracked passes opts.profile and keeps it off the launcher's opts` — fake `launchWorker` records `o`; `launchTracked(shared, deps, limits, { role: 'implementer', profile: 'fast', prompt: 'p' })` resolves `{ envelope, model: M('fast'), effort: null, profile: 'fast' }`, `'profile' in got === false`, `got.model === M('fast')`; a throwing launcher's error has `err.profile === 'fast'`.
  - `#5997: an invalid implementer-tier refuses the run` — `modelPolicyRefusal(policyFrom('implementer-tier: sometimes\n')) === 'driver model policy invalid: implementer-tier'`; `policyFrom('implementer-tier: record\n')` → `null`.
  - Update the existing `#5942: launchTracked resolves { envelope, model, effort } …` deep-equal to `{ envelope: 'env', model: M('standard'), effort, profile: 'standard' }` and add `assert.strictEqual(err.profile, 'standard')` (return-shape widening; this is the only literal deep-equal on `launchTracked`/`roleLaunch` — `judgment-io.js` and `review.js` destructure).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/driver/launch.test.js`
Expected: FAIL after Step 1 — `recordImplementerProfile is not a function`, and the explicit-profile cases resolve `standard`.

- [ ] **Step 3: Implement** the Interfaces above in `launch.js`. Requires: `parseRecordFacets` (`../issues/record`), `keyFileCount`, `implementerProfile` (`../model-profiles/implementer-tier`). Extend the module header paragraph by one sentence naming #5997 (the explicit profile and the record rule). In `run.test.js` add `'implementer-tier': 'lane'` to `POLICY` after `'model-effort'`, with the comment extended to say `implementer-tier` (#5997) follows them.

- [ ] **Step 4: Run the tests**

Run: `node tools/run-tests.js tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/worker.test.js tests/bin-lib/driver/acceptance.test.js tests/bin-lib/driver/judgments-merge-check.test.js tests/bin-lib/driver/review.test.js`
Expected: PASS (run.test.js unchanged in behavior: the policy step now requests one more key, answered `lane`). If a run.test.js test pins the policy step's requested key list, add `'implementer-tier'` at its end and name the test in the report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/launch.js tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/run.test.js
git commit -m "Let a driver launch take an explicit implementer profile and resolve the record rule — refs #5997"
```

### Task 3: The worker step launches at the record's profile; worker lines name `profile` and `attempt`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`runImplementer`, `launchImplementerAndCheck`, `launchThrowFail`, `workerStep`, `fixWorkerLaunch`, the header comment above `POLICY_KEYS`)
- Modify: `plugin/bin/lib/driver/run.js` (`newCtx`: `implementer: null`; `realDeps.recordImplementerProfile`)
- Modify: `plugin/bin/lib/policy-schema.js` (the `implementer-tier` comment and row, lines 286-287 at the merged base — re-find them by the key name; drop the `Not yet used.` summary prefix and the "No build calls the CLI yet …" sentence; the comment now says the driver reads it in-process, #5997, and #5999 wires the standard lane)
- Modify: `tests/resolve-policy-control-mode.test.js:313` (remove `'implementer-tier'` from `NOT_YET_USED`; the comment at line 310 stays true)
- Modify: `plugin/skills/_shared/policy-schema-model-profiles.md:15` (owner cell: `bin/lib/driver/launch.js` reads it for the driver (#5997); no skill calls `bin/implementer-tier.js` yet (#5999 standard lane)) — 5,259 B, far under the 52,500 B rail
- Modify: `docs/plugin-structure.md` (the `implementer-tier.js` CLI line, 405 at the merged base: `no build calls it yet (#5997, #5999)` → `the driver applies the same rule in-process (#5997); no skill calls the CLI yet (#5999)`) and its `plugin/bin/lib/model-profiles/` entry (line 40 at the merged base) (`consumed by plugin/bin/implementer-tier.js` → `… and plugin/bin/lib/driver/launch.js (#5997)`)
- Test: `tests/bin-lib/driver/run.test.js`
- Not touched: `plugin/skills/_shared/policy-schema.md` — its line 176 sentence stays true (it says what the key chooses, not who reads it); the file is at 51,733 B of 52,500 and is not touched.

**Interfaces:**
- Consumes: Task 2's `roleLaunch`/`launchTracked` `profile`, `recordImplementerProfile`, `IMPLEMENTER_TIER_KEY`.
- Produces:
  - `ctx.implementer = { rule: 'lane' | 'record', profile: string, model: string, attempt: 1 | 2 }` — set after every worker-step launch that resolved a model (`null` until then; a read, no `interruptClass` rung).
  - `runImplementer(ctx, deps, { extraPrompt = '', profile } = {})` — `profile` reaches `launchTracked`'s opts only when it is a string; every result of a launch that resolved a model carries `extra.profile` beside `model`/`effort`; `launchThrowFail` adds `profile: err.profile ?? null`.
  - `implementerRule(policy) -> 'lane' | 'record'` (`'record'` only when `policy['implementer-tier'].value === 'record'`).
  - Worker-step line: `attempt: 1` and `profile` on every line that carries `model` (both rules).
  - `fixWorkerLaunch` passes `profile: ctx.implementer.profile` when `ctx.implementer && ctx.implementer.rule === 'record'`; its line gains `profile` (from the result), no `attempt`.

- [ ] **Step 1: Write the failing tests** in `run.test.js` (harness `policy` override; `issueFor` overridden by a scripted `gh issue view` reply where a body or labels differ; the worker call's model is `calls.find((c) => c.kind === 'worker').args[0].model`):
  - `#5997 AC1.1: record — size:low with 2 Key Files launches the implementer on fast` — policy `{ 'implementer-tier': 'record' }`, labels `size:low`, body with `### Key Files` naming 2 files → worker model `M('fast')`, worker line `profile: 'fast'`, `attempt: 1`, `model: M('fast')`.
  - `#5997 AC1.2: record — 3 Key Files, or size:high, launches on standard` — both cases → `M('standard')`, `profile: 'standard'`. (A `size:high` record must pass the harness's eligibility/admission fakes — they are scripted, so it does.)
  - `#5997 AC2.1: lane and unset launch from express-driver-models for every size` — for `implementer-tier` `'lane'` and `undefined`, sizes low/medium/high, `express-driver-models.implementer: 'fast'` → model `M('fast')` every time, `profile: 'fast'`, `attempt: 1`.
  - `#5997: a record with no size label launches on standard under record` (Review Focus 1).
  - `#5997: a refused record-rule launch writes no worker line` — `workerStep` calls `recordImplementerProfile` through a `deps.recordImplementerProfile` member whose harness default and `realDeps` value are the real function (add it to `run.js`'s `realDeps`, and route one test through `realDeps`' own member, per driver-step-addition's "One deps namespace"); a test replacing it with a thrower carrying `code: 'DRIVER_MODEL_REFUSED'` gets no `worker` line, no `worker` call, and `final.stop.step === 'worker'`, `final.stop.detail` starting `no model for driver role implementer`.
  - `#5997: the fix round launches on the first attempt's profile and its line names profile only` — `fixRig` with `implementer-tier: record` and a size:low 2-file record: both worker calls `M('fast')`; the `fix: true` line has `profile: 'fast'` and no `attempt` key.
  - Update `KW` to `[...K1, 'attempt', 'effort', 'model', 'profile', 'tests'].sort()` and `KWF` to `[...K1, 'effort', 'fix', 'model', 'profile', 'tests'].sort()` (the fix line gets `profile`, not `attempt`), with the capture comment extended: "the worker line `attempt` and `profile`, and the fix line `profile` (#5997)".
  - Characterization (maturity `established`): before changing `runImplementer`, add `#5997 characterization: lane worker launch opts` — the `launchWorker` opts of the happy-path run have no `profile` key and `model === M('standard')`; it must stay green after the change.

- [ ] **Step 2: Run them to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 — record cases launch `M('standard')`; lines lack `profile`/`attempt`; key-set captures differ.

- [ ] **Step 3: Implement** the Interfaces in `steps.js`: in `workerStep`, under `record` call `recordImplementerProfile(ctx.issue)` first (a `MODEL_REFUSED_CODE` throw returns `{ status: 'fail', detail: err.message, noLine: true }`), pass it as `profile`; under `lane` pass none. Set `ctx.implementer` from the result's `extra.model`/`extra.profile` (or the thrown error's). Add `'implementer-tier'` (via `MODEL_POLICY_KEYS`, already in `POLICY_KEYS`) to the POLICY_KEYS comment. `newCtx` gets `implementer: null`; if a run.test.js test pins `newCtx`'s keys, extend it.

- [ ] **Step 4: Run the tests**

Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/launch.test.js tests/resolve-policy-control-mode.test.js tests/policy-schema.test.js tests/bin-lib/model-profiles/policy-keys-registration.test.js`
Expected: PASS.

- [ ] **Step 5: Record the contract proof** in the commit body and the PR (this line is the plan step Check G reads):

Proof(public-contract): every new `driver-events.jsonl` field (`profile`, `attempt`, `escalatedFrom`, `trigger`, `noRelaunch`) is additive and pinned by the `BASE_KEYS_*` key-set captures in `tests/bin-lib/driver/run.test.js` (Tasks 3 and 5), no existing field is renamed, and the only line reader that keys on the step name (`station-events/driver-mirror.js`, `tools/step-yield-report.js`) gets a pinning test for a second `worker` line (Task 6); the `implementer-tier` key's schema row (values, default, run-config settability) is unchanged, so the installed 6.175.0 driver, which never reads it, keeps resolving the committed `implementer-tier: record` line as today.

- [ ] **Step 6: Commit** (body says: `BASE_KEYS_PLAIN`/`BASE_KEYS_FIX` worker entries gain `attempt` and `profile`, the fix entry `profile`; `BASE_LINES_*` and `BASE_CALLS_*` unchanged)

```bash
git add plugin/bin/lib/driver/steps.js plugin/bin/lib/driver/run.js plugin/bin/lib/policy-schema.js tests/resolve-policy-control-mode.test.js plugin/skills/_shared/policy-schema-model-profiles.md docs/plugin-structure.md tests/bin-lib/driver/run.test.js
git commit -m "Launch the driver implementer at the record's profile under implementer-tier record — refs #5997"
```

### Task 4: `relaunch.js` — the decision and the relaunch prompt text

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/relaunch.js`
- Test: `tests/bin-lib/driver/relaunch.test.js`
- Create: `tests/fixtures/driver-relaunch/red-report.json` (a real `verify.js` report, Step 0)

**Interfaces:**
- Consumes: `stepUp` (`../model-profiles/implementer-tier`), `roleLaunch` (`./launch`), `neutralize` (`./events`), `fenceFor` (`../markdown-blocks`), `truncateUtf8` (`./review`), `sniffFamily`, `extractFailingFiles` (`../verify/extract`).
- Produces:
  - `TRIGGERS = Object.freeze({ cannotComplete: 'cannot-complete', redTests: 'red-tests' })`
  - `NO_RELAUNCH = Object.freeze({ noStepUp: 'no-step-up', clamped: 'clamped' })`
  - `MAX_FAILING_FILES = 20`, `MAX_FAILURE_BYTES = 4096`
  - `planRelaunch({ profile, model, policy }, { roleLaunchFn = roleLaunch } = {}) -> { relaunch: true, to } | { relaunch: false, noRelaunch, note }` — `to = stepUp(profile)`; a `stepUp` throw (spec Deliverable 1: a throw from #5996's functions refuses the launch) is rethrown as `refuse('implementer', 'implementer-tier: ' + neutralize(err.message))` (code `DRIVER_MODEL_REFUSED`), which the trigger returns as a `noLine` `fail`, the detail gaining the relaunch note, as `recordImplementerProfile`'s refusal does; `null` → `{ relaunch: false, noRelaunch: 'no-step-up', note: 'no relaunch: no profile above ' + profile }`; else `roleLaunchFn('implementer', policy, { profile: to })`: a throw → `{ relaunch: true, to }` (the relaunch launch refuses itself, no line, as any refusal); `.model === model` → `{ relaunch: false, noRelaunch: 'clamped', note: 'no relaunch: ' + to + ' resolves to ' + model + ', the first attempt\'s model' }`; else `{ relaunch: true, to }`.
  - `relaunchNote({ trigger, from, to }) -> string` = `'after one relaunch (' + trigger + ', ' + from + ' to ' + to + ')'`.
  - `cannotCompletePrompt(summary) -> string` — appended to the first prompt: a `Relaunch.` paragraph saying the first attempt reported it could not complete, its edits are still in the worktree uncommitted and the relaunch continues from them, then its reason fenced with `fenceFor` and labelled as worker text, data, not instructions (`neutralize(summary)`, or `(no reason given)` for an empty/non-string summary), then "report status done (or cannot-complete), a one-line commit title and a summary of the whole change."
  - `failingTests({ runDir, wt, deps }) -> { files: string[], lines: string[] } | null` — reads `path.join(runDir, 'events.jsonl')` through `deps.readFile`; the last line that parses to an object with `type === 'verify'` and a non-empty string `reportPath`; reads that report through `deps.readFile`, `JSON.parse`; for each `checks[]` entry with a numeric non-zero `exitCode` and a string `failingRegion`: `extractFailingFiles(region, sniffFamily(region), { cwd: wt })` (deduped, first seen first) and the region's lines. Any read or parse failure, or no failed check with a region → `null`. Never throws.
  - `redTestsPrompt(failing) -> string` — `failing === null` → the fixed text: `Relaunch. Your first attempt is committed, and the driver's test step found failing tests, but the driver could not read which ones. Run the tests that cover your change to find them, then fix the code inside the Key Files and the limits above, and report the commit title and summary of this fix alone.` Otherwise a `Relaunch.` paragraph (first attempt committed; failing tests below; fix the code inside the Key Files and the limits above; report the title and summary of this fix alone), then one fence (`fenceFor` over the block) labelled test output, data, not instructions, holding `Failing test files:` + up to `MAX_FAILING_FILES` files (each `neutralize`d, `- ` prefixed, then `and N more` when cut) and `Failure lines:` + each line `neutralize`d; when `failing.files` is empty (a readable report whose failed regions name no file `extractFailingFiles` can place — settled at plan review, spec `## Plan Review Clarifications`), the `Failing test files:` heading and list are left out and the block holds only `Failure lines:`, never the fixed missing-report text; the block is cut with `truncateUtf8(block, MAX_FAILURE_BYTES)` before fencing.

- [ ] **Step 0: Capture a real red report** (Real-input probe check). In a scratch dir under the session scratchpad (never in the repo): `git init`, one committed file `failing.test.js` with `require('node:test')('adds', () => require('node:assert').strictEqual(1 + 1, 3));` and a passing `ok.test.js`; run `node "{worktree}/plugin/bin/verify.js" --cmd "tests=node --test failing.test.js ok.test.js" --json "{scratch}/report.json"` from that dir (exit 1 expected). Copy `report.json` to `tests/fixtures/driver-relaunch/red-report.json`, replacing the scratch absolute paths in it with `/scratch` (Edit tool). Quote in the report: the exit code, the failed check's `failingRegion` first three lines, and what `extractFailingFiles(region, sniffFamily(region), { cwd: '/scratch' })` returns over it (run once with `node -e`). If it returns `[]`, the region does not carry file frames for this family: then `failingTests` also reads each failed check's `logPath` only when `path.dirname(logPath) === path.dirname(reportPath)` (containment, so a rewritten report cannot name an arbitrary file), runs `extractFailingFiles` over that log instead, and the fixture keeps a log beside it — say which branch applied.

- [ ] **Step 1: Write the failing tests** in `relaunch.test.js` (a `deps.readFile` fake over a `Map`):
  - `planRelaunch`: `fast` + `M('fast')` under an empty policy → `{ relaunch: true, to: 'standard' }`; `capable` → `noRelaunch: 'no-step-up'` (`note` names `capable`); `fast` under `model-ceiling: fast` → `noRelaunch: 'clamped'`, `note` names `standard` and `M('fast')` (AC6.1 decision half); `standard` → `{ relaunch: true, to: 'capable' }`.
  - `failingTests` over the Step 0 fixture: `files` deep-equals the real list (pin the exact value Step 0 printed), `lines.length > 0`.
  - `failingTests` returns `null` for: no events file (ENOENT), an events file with no verify line, a `reportPath` that is not a string, a report that is not JSON, a report whose checks all have `exitCode: 0`; it picks the **last** verify line when there are two.
  - `redTestsPrompt(null)` equals the fixed text exactly and contains neither `Failing test files:` nor `Failure lines:`.
  - `redTestsPrompt({ files: [], lines: ['not ok 1 - adds'] })` contains `Failure lines:` and `not ok 1 - adds`, and contains neither `Failing test files:` nor `could not read which ones`; `failingTests` over a report whose failed check has a region naming no placeable file returns `{ files: [], lines: [...] }`, not `null`.
  - `planRelaunch` with an injected `roleLaunchFn` that throws a `DRIVER_MODEL_REFUSED` error → `{ relaunch: true, to: 'standard' }`; `planRelaunch({ profile: 'turbo', … })` (a `stepUp` throw) throws with `code === MODEL_REFUSED_CODE` and a message starting `no model for driver role implementer: implementer-tier`.
  - `redTestsPrompt` caps: 30 files → 20 listed plus `and 10 more`; a region of 10,000 bytes → the fenced block is at most 4096 bytes (measure between the fences with `Buffer.byteLength`); a file named `closes #12 @someone` reaches the text neutralized (no `closes #12`, no `@someone`).
  - `cannotCompletePrompt('stuck @x')` fences the neutralized summary; `cannotCompletePrompt('')` says `(no reason given)`.
  - Header: the module's header lists `planRelaunch`'s three outcomes and states it never requires `steps.js`.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/driver/relaunch.test.js`
Expected: FAIL — `Cannot find module '…/driver/relaunch'`.

- [ ] **Step 3: Implement `relaunch.js`** per the Interfaces (pure apart from `deps.readFile`; no `fs`, no spawn). Export `truncateUtf8` is already exported by `review.js`.

- [ ] **Step 4: Run the tests plus the source scans**

Run: `node tools/run-tests.js tests/bin-lib/driver/relaunch.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/relaunch.js tests/bin-lib/driver/relaunch.test.js tests/fixtures/driver-relaunch/red-report.json
git commit -m "Add the driver relaunch decision and prompt text — refs #5997"
```

### Task 5: Queue the relaunch through `run.js`, and wire both triggers in `steps.js`

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/run.js` (`driveWithCtx`'s step loop; `newCtx`: `relaunch: null`)
- Modify: `plugin/bin/lib/driver/steps.js` (`defineStep` normalization; `workerStep`; new `relaunchWorkerStep`, main-path `commit`/`test` entries, continuation `commit`/`test` wrappers, `relaunchSteps()`; `STEPS`; header paragraph)
- Modify: `plugin/bin/lib/driver/review.js` (export `mergeWorker`, gaining a third parameter `label = 'Review fix'`; header line 181 at the merged base "Nothing launches a third implementer." → "The round launches no further implementer.")
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: Task 3's `ctx.implementer`, `runImplementer(ctx, deps, { extraPrompt, profile })`; Task 4's `planRelaunch`, `relaunchNote`, `cannotCompletePrompt`, `failingTests`, `redTestsPrompt`, `TRIGGERS`, `NO_RELAUNCH`.
- Produces:
  - `defineStep`'s normalized result gains `then: Step[]` — kept only when the result does not halt (`[]` otherwise and when absent); an element that is not an object with a string `name` and a function `run` makes the result `{ status: 'fail', detail: 'step returned an invalid continuation', … }`.
  - `run.js`: the loop walks a queue seeded from `steps`; after a non-halting result whose `then` is non-empty, those steps run next, then the rest of the table. No step-name literal (AC13.1).
  - `ctx.relaunch = { trigger, from, to, prompt, ran: boolean }` — set by a trigger, `ran` set by the relaunch worker step; `null` in `newCtx`; no `interruptClass` rung.
  - `relaunchSteps() -> [relaunchWorkerStep, continuationCommitStep, continuationTestStep]` — the one relaunch helper: launch through `runImplementer` with `extraPrompt: ctx.relaunch.prompt` and `profile: ctx.relaunch.to`, then the commit step, then the test step (both the unchanged core steps, wrapped so a non-ok result's detail gains `'; ' + relaunchNote(ctx.relaunch)`). `checkStep` stays once, in the table, after the final test.
  - Relaunch worker line: `attempt: 2`, `profile`, `model`, `effort`, `tests`, `escalatedFrom: ctx.relaunch.from`, `trigger: ctx.relaunch.trigger`; non-ok detail gains the relaunch note; once the launch returns, `ctx.worker` sums cost, turns and denials across both launches (so the final line counts every implementer launch): after `red-tests` it is `mergeWorker(firstWorker, ctx.worker, 'Relaunch')` (the relaunch prompt asks for the summary of the fix alone, so the two summaries concatenate); after `cannot-complete` it keeps the relaunch's own `title` and `summary` alone (its prompt asks for a summary of the whole change, and the first worker's could-not-complete reason must not open the PR summary `steps.js`'s PR step reads from `ctx.worker.summary`), with only the counters summed; `ctx.implementer` becomes `{ rule: 'record', profile: to, model, attempt: 2 }`.
  - The continuation commit wrapper, after a red-tests relaunch, sets `ctx.changedFiles` to the first commit's paths followed by the relaunch commit's new paths, first seen first (Global Constraints; the first commit's list is held on `ctx.relaunch.firstChangedFiles`, set by the red-tests trigger; `null` after cannot-complete, where the commit's own list stands).
  - A refused relaunch launch (Decision Q2: `roleLaunch` throws `DRIVER_MODEL_REFUSED` for `ctx.relaunch.to`) returns the refusal as the relaunch worker step's `fail` with `noLine: true` (no `worker` line) and the detail gaining `'; ' + relaunchNote(ctx.relaunch)`; nothing after it runs.
  - Main-path entries in `STEPS` (names `commit`, `test`): skip (`{ status: 'ok', skip: true }`) when `ctx.relaunch && ctx.relaunch.ran` (already run by the continuation); otherwise the core step. The core `commitStep`/`testStep` objects stay what `reviewStep`'s wiring passes to `fixRound` (so the fix round never skips or relaunches).
  - Cannot-complete trigger (in `workerStep`, rule `record`, result `status === 'stop'`): `planRelaunch({ profile, model, policy })`; no relaunch → the result as today plus `extra.noRelaunch` and detail `'; ' + note`; relaunch → `ctx.relaunch = { trigger: 'cannot-complete', from, to, prompt: cannotCompletePrompt(ctx.worker && ctx.worker.summary), ran: false }`, result `{ ...result, halt: false, then: relaunchSteps() }`. No reset, checkout or stash of the uncommitted edits.
  - Red-tests trigger (main-path test entry, rule `record`, `ctx.relaunch === null`, core result `reason === 'failing-test'`): `planRelaunch` as above, with no tree check first (Decision Q1); relaunch → `ctx.relaunch = { trigger: 'red-tests', from, to, prompt: redTestsPrompt(failingTests({ runDir: ctx.runDir, wt: ctx.wt, deps })), ran: false }`, result `{ ...result, halt: false, then: relaunchSteps() }`.
  - Header paragraph in `steps.js` (beside the existing #5414/#5415/#5454 paragraphs): the relaunch (#5997), its two triggers, the two no-relaunch reasons (no step-up, clamped), that a red run relaunches whatever the tree state (Decision Q1), that an unresolvable step-up is a refused relaunch (Decision Q2), that it is driver-only (`express-lane.md` has no counterpart), and the stops each queued step can return (propagated unchanged plus the note).

- [ ] **Step 1: Write the failing tests** in `run.test.js`. Script the first and second `worker` calls with `nthCall((c) => c.kind === 'worker' && c.args[0].role === 'implementer', n, reply)`; red tests with `nthCall(on('node', /verify\.js$/), 1, { code: 1, stdout: '', stderr: '' })`; the report through `readFile` replies for `{runDir}/events.jsonl` and the report path (use Task 4's fixture). A `RECORD_TIER` helper gives `policy: { 'implementer-tier': 'record' }` and a size:low two-Key-File record (first profile `fast`).
  - `#5997 run.js: a non-halting result's then-steps run next, then the table` — a fake three-step table via `driveRecord(…, steps)`: step A returns `{ status: 'stop', halt: false, then: [X, Y] }`; the line order is `A, X, Y, B`; an invalid `then` element fails step A with `step returned an invalid continuation`; a halting result's `then` is ignored.
  - `#5997 AC3.1: cannot-complete on fast relaunches once on standard with the reason and the edit kept` — first implementer envelope `result.status: 'cannot-complete'`, summary `stuck on X`; exactly two implementer `worker` calls; the second's `model === M('standard')`; its `prompt` contains `stuck on X` and the first prompt; no git call whose args include `reset`, `checkout`, `stash`, `restore` or `clean` between the two launches; the git status read before the commit is in the same `WT`.
  - `#5997 AC3.2: then the commit and test steps run` — line order from the first `worker` line: `worker stop`, `worker ok` (attempt 2, `escalatedFrom: 'fast'`, `trigger: 'cannot-complete'`), `commit ok`, `test ok`, `check ok`, …; exactly one `commit` and one `test` line.
  - `#5997 AC4.1: red tests after a fast attempt relaunch once on standard naming the failing files` — two implementer calls; the second's prompt contains the fixture's first failing file and `Failure lines:`; line order `worker ok`, `commit ok`, `test stop`, `worker ok (attempt 2, trigger 'red-tests')`, `commit ok`, `test ok`.
  - `#5997 AC4.2: a green second test run continues to check and review` — with `express-driver-review: 'on'`, the lines after the second `test ok` are `check`, then the review's lines, then `push`; `check` appears once.
  - `#5997: an unreadable report still relaunches with the fixed text` — every `readFile` ENOENT; the second prompt contains `could not read which ones` and not `Failing test files:`.
  - `#5997 AC5.1: a second failure ends as a single failure of its kind does with the key unset` — table-driven over (red → cannot-complete), (cannot-complete → red), (red → red), (red → worker fail via a second envelope `{ status: 'fail', reason: 'exit' }`): for each, a control run with `implementer-tier` unset whose single failure is the second kind gives `final.outcome`, `final.stop.class`, `final.stop.reason`, `final.stop.step`; the relaunch run's final line has those four equal, `final.stop.detail` contains `after one relaunch (`; the settle escalate call's reason argument equals the control's; implementer launches `=== 2` and verify.js calls `<= 2`.
  - `#5997 AC6.1: model-ceiling fast — a failed fast attempt is not relaunched and its line names the clamp` — both triggers: one implementer launch; the triggering line (`worker` or `test`) has `noRelaunch: 'clamped'` and a detail containing `no relaunch: standard resolves to`; final outcome as with the key unset.
  - `#5997 AC7.1: every implementer launch writes one worker line with model, profile and attempt; the relaunch's adds escalatedFrom and trigger` — over the AC4 run plus a review fix round (`fixRig`): three `worker` lines, attempts `[1, 2, undefined]` (the fix line has none), every line has `model` and `profile`, only the second has `escalatedFrom`/`trigger`.
  - `#5997 AC8.1: a first worker fail is not relaunched; after a green relaunch the fix round launches on the relaunch's profile` — (a) first envelope `{ status: 'fail', reason: 'launch-error' }` and (b) `{ status: 'fail', reason: 'spend-ceiling' }`: one implementer launch each, no `noRelaunch` key; (c) red → green relaunch → a confirmed review finding: the fix worker's model `M('standard')`, its line `profile: 'standard'`.
  - `#5997: lane never relaunches` — `implementer-tier: 'lane'`, a cannot-complete first worker and, separately, red tests: one implementer launch, no `noRelaunch` key, line sequences equal to the unset-key run.
  - `#5997 Decision Q1: a red run that changed the tree still relaunches and the relaunch commit includes those bytes` — red verify, after which the worktree's git status (read by the continuation commit step) lists the test-written ` M src/x.js` and `?? tmp/out.txt` beside the relaunch's own edit: exactly two implementer launches, the test line carries no `noRelaunch` key, the relaunch commit's `git add` argv names `src/x.js` and `tmp/out.txt`, and the second test run follows (Review Focus 2).
  - `#5997 Decision Q2: a stepped-up profile that does not resolve is a refused relaunch` — a reachable fixture, no seam: a `size:high` record (first profile `standard`), `express-driver-models.reviewer: standard` (so `modelPolicyRefusal`, which resolves every role, passes), and a `model-profiles` row that makes `capable` fail to resolve; confirm first with one `node -e` probe that `modelPolicyRefusal` returns `null` for that policy and `roleLaunch('implementer', policy, { profile: 'capable' })` throws `DRIVER_MODEL_REFUSED`, and quote both results in the report; if no `model-profiles` shape does both, stop and report NEEDS_CONTEXT rather than adding a seam. A cannot-complete first worker gives one implementer launch, no second `worker` line, `final.stop.step === 'worker'`, `final.stop.detail` starting `no model for driver role implementer` and containing `after one relaunch (`; no `noRelaunch` key anywhere.
  - `#5997: a red-tests relaunch's changedFiles is both commits' paths` — first commit's status lists `a.js`, the relaunch commit's lists `a.js` and `b.js` (in that order) and then `c.js`: `ctx.changedFiles`, read through the summary line's text or the check call's argv, names `a.js, b.js, c.js` in first-seen order; after a cannot-complete relaunch it names only the one commit's paths.
  - `#5997: an interrupt during the relaunch launch is reported at the relaunch and runs nothing after it` — the second implementer reply sets `h.deps`' signal (follow the existing AC14 interrupt tests' pattern); no `commit` call after it; the final line `settle: 'interrupted'` (Review Focus 4).
  - `#5997: a relaunch worker that moves HEAD fails with the relaunch noted` — HEAD read after the second launch returns another sha: final stop `worker`/`fail`, detail contains `the worker moved HEAD` and `after one relaunch (` (Review Focus 5).
  - `#5997: the final line's costUsd sums both implementer launches` — envelopes with `costUsd` 0.25 and 0.5 → `final.costUsd === 0.75`.
  - `#5997: after a cannot-complete relaunch the PR summary is the relaunch's alone` — first summary `stuck on X`, relaunch summary `did the whole thing`: the summary file the PR step writes contains `did the whole thing` and not `stuck on X`; after a red-tests relaunch it contains both summaries, the relaunch's after a `Relaunch:` label.
  - `#5997: the fix round never relaunches or skips` — a fix-round test run that goes red ends the record as today's fix-round red (`propagate('test', …)`) with one fix launch, under `record`.
  - Baseline: `BASE_LINES_*`, `BASE_KEYS_*` and `BASE_CALLS_*` of the happy path stay equal (no relaunch on a green run) — the existing tests already assert this; they must stay green unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 — the new cases see one implementer launch and halt at the first failure; the `then` case runs `A, B`.

- [ ] **Step 3: Implement** the Interfaces: `defineStep` normalization and the queue in `run.js` first (the `then` test green), then `review.js`'s `mergeWorker` export (default label keeps `Review fix: …` byte-identical), then the `steps.js` wiring.

- [ ] **Step 4: Run the driver suites**

Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/relaunch.test.js tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/settle.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/merge.test.js`
Expected: PASS.

- [ ] **Step 5: Go-red check** (scratch, not committed): with the Edit tool, make `planRelaunch` always return `{ relaunch: false, noRelaunch: 'no-step-up', note: 'x' }`; re-run `node tools/run-tests.js tests/bin-lib/driver/run.test.js` and confirm AC3.1, AC4.1 and AC5.1 fail; put it back with the Edit tool and re-run green. Then delete the `queue.unshift(...)` line in `run.js` the same way, confirm the `then` test and AC3.2 fail, restore. Quote the four runs' fail/pass lines.

- [ ] **Step 6: Commit** (body names which baseline captures changed, if any — expected none)

```bash
git add plugin/bin/lib/driver/run.js plugin/bin/lib/driver/steps.js plugin/bin/lib/driver/review.js tests/bin-lib/driver/run.test.js
git commit -m "Relaunch the driver implementer once one profile up after cannot-complete or red tests — refs #5997"
```

### Task 6: The readers of a second `worker` line, and the docs

**Role:** integration

**Files:**
- Test: `tests/bin-lib/station-events/driver-mirror.test.js` (no source change expected: a relaunch line has no `fix` marker, so it maps to a work segment and its `session_bound`, as a separate worker session should)
- Test: `tests/step-yield-report.test.js` (no source change expected)
- Modify: `docs/driver.md` (Event lines paragraph; final-line table row `costUsd, turns, denialCount`; "One fix round" paragraph; Worker rights "Ceilings" bullet; Worker models — a new `**Implementer tier (#5997).**` paragraph after "The `effort` field")
- Modify: `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md` (lines 70, 71 and 86: "the two implementer launches", "No third implementer ever starts", "A third implementer launch" → the fix round launches no further implementer; under `implementer-tier: record` a relaunch can make the fix worker a record's third implementer, and the final line counts every implementer launch)
- Test: `tests/bin-lib/driver/run.test.js` (the `AC9.1` docs tests: one phrase test for the new paragraph)

**Interfaces:**
- Consumes: the lines Task 5 writes.

- [ ] **Step 1: Write the failing/pinning tests**
  - `driver-mirror.test.js`: `#5997: a relaunch worker line (attempt 2, no fix marker) maps to a work segment and binds its own session` — a line `{ step: 'worker', attempt: 2, trigger: 'red-tests', escalatedFrom: 'fast', sessionId: 's2', status: 'ok', … }` yields `started`, `exited` and a `session_bound` with `sessionId: 's2'`; control: the same line with `fix: true` yields `[]`.
  - `step-yield-report.test.js`: `#5997: step-yield counts the relaunch's worker, commit and test lines in their rows` — a `driver-events.jsonl` with `worker stop`, `worker ok`, `commit ok`, `test ok` (relaunch on cannot-complete): the `worker` row `count: 2`, `failed: 1`, minutes and tokens summed; a red-tests file (`worker ok`, `commit ok`, `test stop`, `worker ok`, `commit ok`, `test ok`): `test` row `count: 2`, `failed: 1`, `commit` row `count: 2`.
  - `run.test.js` docs test `#5997: docs/driver.md documents the record profile, the one relaunch and the new event fields` — the Worker models section contains each of: `implementer-tier`, `` `record` ``, `stepUp`, `cannot-complete`, `red-tests`, `escalatedFrom`, `attempt`, `noRelaunch`, `three implementer launches`, `model-ceiling`; the Event lines paragraph contains `profile` and `attempt`.

- [ ] **Step 2: Run them**

Run: `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/step-yield-report.test.js tests/bin-lib/driver/run.test.js`
Expected: the mirror and step-yield tests PASS on the current code (they pin behavior that is already right; if either fails, the reader needs a fix — report it and fix it in this task); the docs test FAILS.

- [ ] **Step 3: Write the docs.** `docs/driver.md`: Event lines — the worker line adds `profile` (the work profile the launch resolved) and `attempt` (`1`, or `2` on a relaunch line, which also carries `escalatedFrom` and `trigger`), `noRelaunch` on a triggering line that did not relaunch (`no-step-up`, `clamped`), the fix line adds `profile` only; a relaunch writes a second `worker`, `commit` and `test` line. Final line: `costUsd`/`turns`/`denialCount` summed over every implementer launch (first, relaunch, fix round). "One fix round": "a record launches at most two implementers" → "the fix round launches one more implementer, so a record launches at most three implementers (first attempt, relaunch, fix round)". Ceilings: up to six workers (reviewer, implementer, relaunched implementer, fix implementer, `merge-check`, `acceptance`), each under the full ceilings; no run-wide budget; worst case three implementer launches per record. Worker models — **Implementer tier (#5997)**: under `implementer-tier: record` (read through the same policy resolver as `express-driver-models`) the implementer's first profile is the record rule's (`fast` for `size:low` with one or two Key Files, `standard` otherwise; `express-driver-models.implementer` is then not used for it, though still validated), resolved through `resolve()` so `model-profiles` and `model-ceiling` apply; one relaunch at `stepUp` after `cannot-complete` (no commit yet, the edits kept) or red tests (on top of the first commit, the failing files and failure lines in the prompt, capped at 20 files and 4 KB, or fixed text when the report cannot be read); no relaunch on a worker `fail`, at no step-up, or when `model-ceiling` clamps the step-up to the first model; a red run relaunches whether or not it changed the tree, and the relaunch commit stages what the test run wrote like any worker edit; a stepped-up profile that does not resolve is a refused relaunch (`DRIVER_MODEL_REFUSED`); a second failure ends the record as one failure of that kind does, its detail naming the relaunch; the fix round launches on the profile of the attempt that went green; under `lane` (the default) nothing changes. Point at `worker.js`'s `Fast implementer (#5997)` header bullet for the probe — do not copy its numbers.

- [ ] **Step 4: Run the tests**

Run: `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/step-yield-report.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (body lists the worker-line readers checked: `station-events/driver-mirror.js`, `tools/step-yield-report.js`, `run.test.js`'s key captures; `dispatch/driver-route.md` reads only the final line; `tools/pipeline-cost-report/funnel.js` only checks the file exists — this list goes in the PR body too)

```bash
git add tests/bin-lib/station-events/driver-mirror.test.js tests/step-yield-report.test.js tests/bin-lib/driver/run.test.js docs/driver.md docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md
git commit -m "Document the driver's record profile and one relaunch, and pin the worker-line readers — refs #5997"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (record profile, explicit arg, lane unchanged, refusal) | 2, 3 |
| Deliverable 2 (two triggers, fail never) | 5 |
| Deliverable 3 (one helper; cannot-complete keeps tree; red names failing files, caps, fixed text) | 4, 5 |
| Deliverable 4 (no relaunch at null / clamped step-up, line says why) | 4, 5 |
| Deliverable 5 (second failure, note, no third) | 5 |
| Deliverable 6 (fix round unchanged, its profile) | 3, 5 |
| Deliverable 7 (event fields, readers) | 3, 5, 6 |
| Deliverable 8 (ceilings per launch, worst case documented) | 5, 6 |
| Deliverable 9 (docs) | 6 |
| Deliverable 10 (live probe first) | 1 |
| Deliverable 11 (tests) | 2–6 |
| AC1.1, AC1.2 | 2, 3 |
| AC2.1 | 3 |
| AC3.1, AC3.2, AC4.1, AC4.2, AC5.1, AC6.1, AC7.1, AC8.1 | 5 |
| AC9.1 | 1 |
| Decision Q1 (a red run relaunches whatever the tree state; test-written bytes committed) | 5 |
| Decision Q2 (unresolvable step-up is a refused relaunch) | 4, 5 |
