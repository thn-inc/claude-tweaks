# Implementer Effort Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An implementer's first attempt runs at the lowest effort its record's `risk:` allows, and a failure an effort step can fix raises effort one step on the same profile before the profile steps up — at most two escalations, in both the driver lane and the standard (SDD) lane.

**Architecture:** Two pure functions, `startEffort` and `nextAttempt`, join the record rule in `plugin/bin/lib/model-profiles/implementer-tier.js`. The driver calls them in process (first launch's effort, then a relaunch queue that can now run twice); the standard lane reaches them through `plugin/bin/implementer-tier.js`'s JSON and `plugin/skills/build/dispatch.md`'s instruction. Both apply only under `implementer-tier: record` **and** `model-effort: profile`; under `model-effort: inherit` each lane keeps #5997/#5999's single profile step at no effort.

**Tech Stack:** Node 18+ CommonJS, `node --test`, zero npm deps.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T161212-record-6002/work/6002-spec.md` (worktree copy)

Scope keywords: startEffort, nextAttempt, relaunchNote, relaunchOrStop, planRelaunch, implementer escalated, implementer profile

## Global Constraints

- Effort values: `EFFORT_SCALE` (`profiles.js`) = `low`, `medium`, `high`, `xhigh`, `max`. No implementer attempt ever launches at `xhigh` or `max`: every effort the ladder returns is clamped to `high` (AC7.1).
- `risk:` values are `low`, `medium`, `high` (`parseRecordFacets`); anything else (absent, unknown, duplicated) is treated as missing → start at `launchEffort`, never `low`.
- Triggers: `red-tests`, `fix-round-failed`, `blocked`, `cannot-complete`. Only `red-tests` and `fix-round-failed` can take the effort rung, and only on the first escalation (`escalations === 0`).
- At most two escalations per record (driver) / per task (SDD). Under `model-effort: inherit` (a `null` effort everywhere) each lane keeps exactly #5997's/#5999's single profile step at no effort.
- No non-implementer role's effort changes (reviewer, merge-check, acceptance, explorer, task reviewers): AC7.1.
- Additive only (public contract): `implementer-tier.js`'s CLI keeps its five existing keys, in order, with unchanged values; new keys are appended. `attempt` on worker lines extends 1-2 to 1-3. Every existing #5997 and #5999 test stays green untouched unless a step below names it.
- `project-maturity: established`: for any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- `plugin/bin/` code: no bare `fs.existsSync`/`fs.realpathSync` (path-guard scan); run `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js` alongside focused tests.
- Byte rail: `RAIL_BYTES` = 52,500. `plugin/skills/build/dispatch.md` is 47,090 B at base (89.7%); Task 5 may add at most ~2,000 B net (target ≤ 49,500 B, ≥ 3,000 B headroom). Over budget → tighten Task 5's new paragraph, never move existing content.

**Governing project skills, quoted verbatim:**

From `.claude/skills/driver-step-addition/SKILL.md` — "A step that queues steps after itself":
> - Return the queued steps through the result's `then: Step[]`. `defineStep` keeps it only on a non-halting result, and `run.js` walks the queue under the steps' own names before the rest of the table. An element that is not a `{ name, run }` step makes the result a `fail` (`step returned an invalid continuation`).
> - Put a one-shot guard on `ctx` (`ctx.relaunch`, set before the queue is returned), so a queued step never queues again. A refused plan queues a single step that returns the refusal with `noLine: true`, so it writes no event line.
> - The table's later entries for the re-run steps skip once the queue has run them (`tableCommitStep`, `tableTestStep` return `skip: true`), while the core `commitStep` and `testStep` stay what the review fix round runs, so the fix round never skips or relaunches.
> - A queued step's non-ok result keeps its own status, reason and class and gains a note naming the queue (`withRelaunchNote`); list each queued step's stops in the header comment.
> - Every reader of the event the queue repeats (`worker`, `commit`, `test`) is checked to tolerate a second line per record, and the pull request lists the readers.

(This plan relaxes "a queued step never queues again" to "never queues a third time": the guard becomes the escalation count, see Task 4.)

From the same skill — "Worker-controlled text is neutralized before it leaves":
> The worker can shape strings such as its summary, a path it named, or CLI stderr that may echo either. Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3).

From the same skill — "A stop that writes no line, and a launch value a later line names":
> A value resolved at launch that an event line must name travels on the thrown error as well as on the result: `launchTracked` resolves `{ envelope, model }`, and a launcher throw after the model resolved carries `err.model`. Every catch of a launch keeps it on the stop it returns

From `.claude/skills/headless-worker-launch/SKILL.md` — "A probe speaks for one CLI version, one platform and one launch context":
> Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off.

From `.claude/skills/skill-prose-conformance-tests/SKILL.md`:
> **When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`.

> When the prose tells the reader to run a CLI, pin the whole call line including each argument's value, not the command and flag alone.

> Before considering a table-row content extension complete, grep sibling test files for an anchored regex (`$`/`^`) against that same row, not just the test file most obviously related to the change.

## Review Focus

1. A record with no `risk:` label, or `risk:critical`, under `record`+`profile` must start at the profile's own effort, never `low` — Task 3 test "AC1.1 (driver): an unlabeled-risk record starts at launchEffort".
2. `model-ceiling` clamping Capable to Standard: the second escalation's profile step resolves to the same model → no third launch, the stop names the clamp — Task 4 test "a clamped profile step after an effort step ends the ladder with noRelaunch clamped".
3. The review fix round after a ladder must launch at the last attempt's profile **and** effort, not the profile default — Task 3 test "fix round launches at the green attempt's effort".
4. Under `model-effort: inherit` with `implementer-tier: record`, two red test runs must still give exactly two implementer launches (no second relaunch) — Task 4 test "AC5.1".
5. A `cannot-complete` on the second (effort-step) attempt must step the profile, not raise effort again — Task 4 test "red then cannot-complete climbs to capable".

---

### Task 1: `startEffort` and `nextAttempt` in the record-rule module

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/model-profiles/implementer-tier.js`
- Modify: `docs/plugin-structure.md` (line 40's `implementer-tier.js (#5996)` entry gains `startEffort` and `nextAttempt (#6002)`)
- Test: `tests/bin-lib/model-profiles/implementer-tier.test.js`

**Interfaces:**
- Produces:
  - `TRIGGERS` — frozen `['red-tests', 'fix-round-failed', 'blocked', 'cannot-complete']`; `MAX_ESCALATIONS = 2`; `EFFORT_CAP = 'high'`.
  - `startEffort({ risk, launchEffort }) → 'low' | 'medium' | 'high' | null`
  - `nextAttempt({ profile, effort, escalations, trigger, resolveProfile }) → { profile, effort, escalations } | null`, where `resolveProfile(profileName) → { model: string|null, launchEffort: string|null }`.
- Consumes: `stepUp` (same module), `EFFORT_SCALE` (`./profiles`).

Rules (the spec's Deliverables 1-2, exactly):
- `startEffort`: `null` when `launchEffort` is `null`/`undefined`. Otherwise `base` = `launchEffort` clamped to `high` (`xhigh`/`max` → `high`). `risk: 'low'` → the lower of `low` and `base`; `risk: 'medium'` → the lower of `medium` and `base`; any other risk → `base`. A `launchEffort` outside `EFFORT_SCALE` throws `implementer-tier: unknown launchEffort …` (this module never falls back).
- `nextAttempt`: throws (message prefixed `implementer-tier: `, value through `describe`) on a `trigger` not in `TRIGGERS`, `escalations` not a safe integer in 0..2, an `effort` that is neither `null` nor in `EFFORT_SCALE`, or a non-function `resolveProfile`. Returns `null` when `escalations >= 2`. With `escalations === 0`, trigger `red-tests`/`fix-round-failed`, and `effort` not `null` and below `high`: `{ profile, effort: <next EFFORT_SCALE level>, escalations: 1 }` (no `resolveProfile` call). Otherwise: `to = stepUp(profile)`; `null` → `null`; when `resolveProfile(to).model === resolveProfile(profile).model` → `null`; else `{ profile: to, effort: <resolveProfile(to).launchEffort clamped to high, null stays null>, escalations: escalations + 1 }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/model-profiles/implementer-tier.test.js` (append; reuse the file's `require`). A fake `resolveProfile` from a table `{ fast: { model: 'haiku', launchEffort: null }, standard: { model: 'sonnet', launchEffort: 'medium' }, capable: { model: 'opus', launchEffort: 'medium' } }`.
  - `AC1.1: startEffort with launchEffort medium` — `low`→`'low'`, `medium`→`'medium'`, `high`→`'medium'`, `undefined`→`'medium'`, `'critical'`→`'medium'`.
  - `AC1.2: startEffort with a null launchEffort is null for every risk` — `low`, `medium`, `high`, `undefined`.
  - `AC1.3: startEffort clamps xhigh to high` — `{ risk: 'high', launchEffort: 'xhigh' }` → `'high'`; `max` → `'high'`; `{ risk: 'medium', launchEffort: 'low' }` → `'low'` (never above launchEffort).
  - `AC2.1 AC2.2 AC2.3: the red-tests sequence from low` — `{ profile: 'standard', effort: 'low', escalations: 0, trigger: 'red-tests' }` → `{ profile: 'standard', effort: 'medium', escalations: 1 }`; feed it back with `red-tests` → `{ profile: 'capable', effort: 'medium', escalations: 2 }`; feed that back → `null`.
  - `AC3.1: blocked skips the effort rung` — standard@low, 0, `blocked` → `{ profile: 'capable', effort: 'medium', escalations: 1 }`; same for `cannot-complete`.
  - `AC3.2: an effort already at high takes the profile step` — standard@high, 0, `red-tests` → capable step, `escalations: 1`.
  - `AC3.3: Fast's null effort takes the profile step` — fast@null, 0, `red-tests` → `{ profile: 'standard', effort: 'medium', escalations: 1 }`.
  - `nextAttempt sequence from medium` — standard@medium, 0, `fix-round-failed` → standard@high, 1; then capable step, 2; then `null`.
  - `AC7.1: no rung above high` — `resolveProfile` returning `launchEffort: 'max'` for capable → returned effort `'high'`; effort step from `high` never happens.
  - `nextAttempt is null at capable and when the step-up resolves to the same model` — capable@medium, 1, `blocked` → `null`; resolveProfile mapping capable to `'sonnet'` → standard@medium, 1, `red-tests` → `null`.
  - `nextAttempt refuses bad input` — trigger `'red'`, escalations `3`/`-1`/`1.5`, effort `'extreme'`, missing `resolveProfile`: each `assert.throws(…, /^Error: implementer-tier: /)` style match on the message prefix.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/model-profiles/implementer-tier.test.js`
  Expected: FAIL — `startEffort is not a function`.

- [ ] **Step 3: Implement** the two functions and constants above; export them beside the existing exports; extend the module header comment by one paragraph naming #6002 and both functions.

- [ ] **Step 4: Run to verify they pass** — same command, all pass.

- [ ] **Step 5: Commit** — `git add` both files; message `Add the implementer effort ladder functions — refs #6002`.

---

### Task 2: The CLI's `startEffort` and `next`

**Role:** integration

**Files:**
- Modify: `plugin/bin/implementer-tier.js`
- Modify: `docs/plugin-structure.md` (line 405's CLI usage line and JSON shape)
- Test: `tests/bin-lib/model-profiles/implementer-tier-cli.test.js` (line 125's `deepStrictEqual` gains the two new keys)

**Interfaces:**
- Consumes: Task 1's `startEffort`, `nextAttempt`, `TRIGGERS`; `resolve` (`./lib/model-profiles/profiles`); `locatePolicyFile` (`./lib/policy-file`); `parsePolicyModelConfig` (`./lib/model-profiles/policy-fragment`) — the same policy read `plugin/bin/resolve-profile.js` lines 69-75 do, so the CLI's efforts equal what `resolve-profile.js {profile}` returns as `launchEffort` for the SDD dispatch.
- Produces: stdout JSON `{ profile, stepUp, rule, size, keyFileCount, startEffort, next }` (existing five keys first, unchanged). `next` is `null` or `{ profile, effort, escalations }`.

Rules:
- New flags `--attempt-profile <profile>`, `--attempt-effort <low|medium|high|inherit>` (`inherit` = `null`), `--escalations <0|1|2>`, `--trigger <red-tests|fix-round-failed|blocked|cannot-complete>`: all four or none, else exit 2 naming the missing ones; an invalid value is exit 2. USAGE line and header comment updated.
- `risk` is read from the spec header like `size` (same `headerLines`), but never errors: zero lines, two or more lines, or a value outside `low|medium|high` → missing.
- `startEffort` = `startEffort({ risk, launchEffort: resolve(p, { policy }).launchEffort })` where `p` is `--from`'s profile when given (a `**Role:**` marker's task, spec Decisions Reading A), else the computed `profile`; `null` when `p` is null. Under `model-effort: inherit` (or unset) `launchEffort` is `null`, so `startEffort` is `null`.
- `next` = `null` without the four flags, and `null` whenever `startEffort` would be `null` because `model-effort` is not `profile` (spec: "under `model-effort: inherit` both are `null`"); otherwise `nextAttempt({ profile: attemptProfile, effort: attemptEffort, escalations, trigger, resolveProfile: (p) => { const r = resolve(p, { policy }); return { model: r.model, launchEffort: r.launchEffort }; } })`.
- An unreadable or malformed `policy.yml` → exit 1 with the parse message (mirrors resolve-profile.js); a missing one → empty policy (read with `readFileSync`, `ENOENT` → none; no `existsSync`).

- [ ] **Step 1: Write the failing tests** (append to the CLI test file; reuse its spec-file and policy fixtures; where the file has no policy fixture, write a `policy.yml` into the scratch cwd the test already passes through deps):
  - `AC1.1 (CLI): startEffort under model-effort profile follows risk` — policy `model-effort: profile` + `model-profiles: { standard: { effort: medium } }`, `--rule record`, spec `size: medium` + 3 Key Files: `risk: low` → `startEffort: 'low'`; `risk: medium` → `'medium'`; no risk line → `'medium'`.
  - `AC1.2 (CLI): model-effort inherit gives null startEffort and null next, the rest unchanged` — same spec without `model-effort`; with all four attempt flags: `{ profile: 'standard', stepUp: 'capable', rule: 'record', size: 'medium', keyFileCount: 3, startEffort: null, next: null }` exactly.
  - `AC2.1 (CLI): next takes the effort rung` — `--attempt-profile standard --attempt-effort low --escalations 0 --trigger red-tests` → `next` `{ profile: 'standard', effort: 'medium', escalations: 1 }`.
  - `AC3.1 (CLI): next for blocked is the profile step` — `--attempt-effort low --escalations 0 --trigger blocked` → `{ profile: 'capable', effort: 'medium', escalations: 1 }`.
  - `Decision Q1 (Reading A, CLI): --from sets the profile startEffort is computed against` — `model-effort: profile`, `risk: low`, build profile `standard`: `--from fast` → `startEffort: null` (Fast's `launchEffort` is `null`); `--from capable` with `model-profiles: { capable: { effort: high } }` and `risk: medium` → `'medium'`; `--from capable` with `risk: high` → `'high'`; `profile` and `keyFileCount` unchanged by `--from`.
  - `public-contract: the five existing keys keep their order and values` — `Object.keys(out).slice(0, 5)` equals `['profile', 'stepUp', 'rule', 'size', 'keyFileCount']` and the last two keys are `['startEffort', 'next']`.
  - `the attempt flags are all-or-none` — three of four → exit 2; `--escalations 3` → exit 2; `--attempt-effort xhigh` → exit 2.
  - Update line 125's expected object with `startEffort: null, next: null`.

- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/model-profiles/implementer-tier-cli.test.js` → FAIL on the new tests.

- [ ] **Step 3: Implement** per the rules above.

- [ ] **Step 4: Run** — the CLI test file, `tests/bin-lib/model-profiles/implementer-tier.test.js`, `tests/build-implementer-tier-conformance.test.js` (its CLI-answer block must stay green), `tests/path-guard-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js` — all pass.

- [ ] **Step 5: Commit** — `Report startEffort and the next attempt from implementer-tier.js — refs #6002`.

Proof(public-contract): the CLI test pins the five pre-existing output keys first, in order and with unchanged values, the two new keys appended last, and the exact pre-change object plus `startEffort: null, next: null` under `model-effort: inherit`, so no existing consumer of the JSON sees a changed or reordered field.

---

### Task 3: The driver's first launch at `startEffort`, and the fix round at the green attempt's effort

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/launch.js` (`launchTracked` accepts an explicit effort)
- Modify: `plugin/bin/lib/driver/steps.js` (`workerStep`, `setImplementer`, `fixWorkerLaunch`, `launchImplementerAndCheck`'s options)
- Modify: `plugin/bin/lib/driver/review.js` — header comment only, if it names the fix round's launch values (the fix round's launch lives in `steps.js`'s `fixWorkerLaunch`; review.js only calls it through the wiring object). Waived otherwise: `review.js` reads no effort; Step 3 below checks it.
- Modify: `plugin/bin/lib/driver/worker.js` (module header: new probe bullet)
- Test: `tests/bin-lib/driver/run.test.js`
- Test: `tests/bin-lib/driver/launch.test.js`
- Test: `tests/bin-lib/driver/worker.test.js` (opt-in live probe)

**Interfaces:**
- Consumes: Task 1's `startEffort`; `parseRecordFacets` (`../issues/record`) for `risk`; `roleLaunch` (launch.js).
- Produces (for Task 4):
  - `launchTracked(shared, deps, ceilings, { profile, effort, ...opts })`: `effort === undefined` → today's `roleLaunch` effort; otherwise the given value (string or `null`) is passed to the launcher and returned as `effort`.
  - `effortLadder(policy) → boolean` in steps.js: `implementerRule(policy) === 'record'` and `policy['model-effort'].value === 'profile'` (missing entry → false).
  - `ctx.implementer = { rule, profile, model, attempt, effort, escalations }` — `effort` is the launch's effort (string or `null`), `escalations` 0 after the first launch.
  - `runImplementer(ctx, deps, { extraPrompt, profile, effort })` forwards `effort` to `launchTracked` only when it is not `undefined`.

Rules:
- `workerStep`: under `effortLadder`, after `profile` resolves, `effort = startEffort({ risk: parseRecordFacets(ctx.issue.labels).risk, launchEffort: roleLaunch('implementer', policy, { profile }).effort })` (a `roleLaunch` throw here is the same no-line refusal as a launch-time model refusal); pass it to `runImplementer`. Not under the ladder: pass no `effort` (today's behavior byte-for-byte).
- `fixWorkerLaunch`: under `rule === 'record'` pass `effort: ctx.implementer.effort` beside `profile`; under `lane` pass neither.
- The worker line's `effort` field already carries `launch.effort`; nothing new on the line in this task.

- [ ] **Step 1: Characterization first (established maturity)** — add `#6002 characterization: record + inherit launch opts are unchanged` to run.test.js: under `RECORD_TIER` with `model-effort` unset, capture the first implementer launch's `{ model, effort }` and the fix round's (use `fixRig` with `RECORD_TIER`), assert `effort === null`/undefined as today. Run it — PASS on the unmodified code.

- [ ] **Step 2: Write the failing tests** (run.test.js; a `LADDER` policy const `{ 'implementer-tier': 'record', 'model-effort': 'profile', 'model-profiles': { standard: { effort: 'medium' }, capable: { effort: 'medium' } } }` — match how the harness passes `model-profiles` (read an existing `model-effort` test such as the #5942 ones first and mirror its policy shape); a `MEDIUM_LOW_RISK = tierIssue(['risk:low', 'size:medium'], keyFilesBody('a.js', 'b.js', 'c.js'))`):
  - `AC4.1 (first launch): risk:low size:medium starts standard at --effort low` — first implementer call `args[0].effort === 'low'`, model `M('standard')`, worker line `effort: 'low'`, `attempt: 1`.
  - `AC1.1 (driver): a risk:medium record starts at medium, an unlabeled-risk record at launchEffort` — `risk:medium` → `'medium'`; no risk label → `'medium'`.
  - `AC5.1 (first launch): model-effort inherit passes no effort under record` — same record, `model-effort` unset → `effort` null on the call and the line.
  - `fix round launches at the green attempt's effort` — `fixRig` under `LADDER` with the low-risk record: the fix worker call's `effort === 'low'` and profile `standard`; under `lane` the fix call carries no explicit effort (unchanged).
  - `AC7.1 (driver): the reviewer's effort is unchanged under the ladder` — in the same review run the reviewer launch's effort equals its value with `implementer-tier` unset.
  - launch.test.js: `launchTracked passes an explicit effort and returns it` (`'low'` and `null` both reach `deps.launchWorker` and the resolved object; `undefined` keeps `roleLaunch`'s).

- [ ] **Step 3: Run to verify they fail** — `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/launch.test.js` → the new tests FAIL, every pre-existing test PASSES.

- [ ] **Step 4: Implement** per the rules; read review.js's header for a fix-round launch-values claim and update it if present.

- [ ] **Step 5: Live-probe record** — append a `worker.js` header bullet `Standard implementer at low effort (#6002)`: "Probed on 2026-11-23 with Claude Code CLI 2.1.325 on macOS (darwin), under a subscription login, launched from a process with no TTY, every launch under `--safe-mode --restricted`, on the model alias `sonnet` (what `resolve('standard')` returns under this repository's policy) with `--effort low`. Three implementer launches, each in a fresh git repository holding a committed `greet.js`, asking for `greet('Ann')` to return `Hello Ann!`, each returned a valid result envelope (`status: ok`, `result.status` `done`, 4 turns, about $0.03, no denials) with the working change in the tree. Three Agent-tool dispatches at `model: sonnet`, `effort: low` on the same fixture each committed the change and replied `STATUS: DONE`. Re-run: the opt-in `#6002` live probe." Add that opt-in probe to `tests/bin-lib/driver/worker.test.js` as `'#6002 Gotcha: live probe — three implementer launches on Standard at --effort low return a done envelope'`, a copy of `AC9.1 (#5997)` with `resolve('standard', …)`, `effort: 'low'`, and asserting `env.result.status === 'done'` and the edited `greet.js` returning `'Hello Ann!'`, same `DRIVER_LIVE_SMOKE` skip. Do not run it (it spends tokens; the controller already ran the equivalent probe — 6 of 6 pass).

- [ ] **Step 6: Run** — `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/worker.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js` — all pass (the live probe skipped).

- [ ] **Step 7: Commit** — `Launch the driver implementer at the record's start effort — refs #6002`.

---

### Task 4: The driver's ladder — a second relaunch, effort before profile

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/relaunch.js` (`planRelaunch`, `relaunchNote`, the two prompt builders, header)
- Modify: `plugin/bin/lib/driver/steps.js` (`relaunchOrStop`, `relaunchWorkerStep`, `relaunchCommitStep`, `relaunchTestStep`, `setImplementer` calls, header paragraph at lines 69-87, comments at 1310-1316)
- Modify: `plugin/bin/lib/driver/events.js` — only if it documents `attempt`'s range; Waived otherwise (it has no `attempt` validation at base: `grep -n attempt plugin/bin/lib/driver/events.js` prints nothing).
- Modify: `docs/driver.md` (line 309's ceilings bullet; the `Implementer tier (#5997)` paragraph at line 333; a new `**Effort ladder (#6002).**` paragraph after it)
- Modify: `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md` (lines 68-70 describe one relaunch)
- Modify: `docs/plugin-structure.md` (the `relaunch.js` entry under `plugin/bin/lib/driver/`, "the implementer's one relaunch")
- Test: `tests/bin-lib/driver/run.test.js`
- Test: `tests/bin-lib/driver/relaunch.test.js` (planRelaunch's ladder cases: effort step, profile step, `no-step-up`, `clamped`, inherit unchanged)

**Interfaces:**
- Consumes: Task 1's `nextAttempt`; Task 3's `effortLadder`, `ctx.implementer.{effort,escalations}`, `runImplementer`'s `effort` option.
- Produces: `planRelaunch({ profile, model, effort, escalations, trigger, policy, ladder }, { roleLaunchFn })` → `{ relaunch: true, to, effort, escalations } | { relaunch: false, noRelaunch, note }` (throws the DRIVER_MODEL_REFUSED refusal as today on a `stepUp` throw).

Rules:
- `ladder` false (record + inherit): `planRelaunch` behaves exactly as today (one profile step; `effort` absent from the result); `relaunchOrStop` keeps its one-shot guard. Every existing `#5997` test passes unmodified.
- `ladder` true: `planRelaunch` calls `nextAttempt` with `resolveProfile = (p) => { try { const l = roleLaunchFn('implementer', policy, { profile: p }); return { model: l.model, launchEffort: l.effort }; } catch (_) { return { model: null, launchEffort: null }; } }` (an unresolvable step-up then plans a relaunch whose own launch refuses, Decision Q2 as today). `null` → `noRelaunch: 'no-step-up'` when `stepUp(profile)` is `null`, else `'clamped'`, with today's note texts.
- Guard: under the ladder `relaunchOrStop` queues while `ctx.implementer.escalations < 2`; the queued relaunch worker step (its `cannot-complete` stop) and the queued relaunch test step (its `failing-test` stop) are triggers under the ladder when `ctx.implementer.escalations === 1` — i.e. the second relaunch; after attempt 3 nothing queues. Under `lane`/inherit the queued steps stay never-triggers.
- `ctx.relaunch` keeps today's fields for the current relaunch and adds `effort` (the relaunch's), `escalations` (1 or 2) and `history: [{ trigger, from, to }]`; `firstChangedFiles` before the second relaunch is the union so far (first commit's paths, then the relaunch commit's new ones).
- Relaunch launch: `runImplementer(ctx, deps, { extraPrompt: '\n' + prompt, profile: to, effort })` where `effort` is passed only under the ladder. `setImplementer` records `attempt` 2 or 3, `effort`, `escalations`. Worker line: `attempt` 2/3, `escalatedFrom` (the previous attempt's profile), `trigger`, and its own `effort`.
- Prompts: the attempt-2 text is byte-identical to today. For attempt 3 the appended text is only the newest relaunch prompt, with "Your first attempt" → "Your previous attempt" (both builders take an `{ attempt }` option, default 2).
- Notes: one relaunch, inherit — byte-identical `after one relaunch (trigger, from to to)`. Under the ladder each side renders `{profile}@{effort}` (`{profile}` alone when effort is `null`): one relaunch `after one relaunch (red-tests, standard@low to standard@medium)`; two `after two relaunches (red-tests, standard@low to standard@medium; red-tests, standard@medium to capable@medium)`.
- Past the ladder: a third failure keeps its own stop (status, reason, class, step) — the same outcome #5997's second failure produces — with the two-relaunch note.
- ctx.worker: `relaunchWorker` merges each relaunch in turn (cost, turns, denials summed over all launches; the cannot-complete summary rule applies per relaunch).
- Readers of a third `worker`/`commit`/`test` line: `plugin/bin/lib/station-events/driver-mirror.js` and `tools/step-yield-report.js`'s `driverStepsOf` — read both, confirm they are count-agnostic (no `attempt === 2` or "at most two" assumption), and name them and the finding in the commit body.

- [ ] **Step 1: Write the failing tests** (run.test.js; a `ladderRig` = `relaunchRig` with `policy: LADDER` from Task 3, `issue: MEDIUM_LOW_RISK`, and per-launch replies by index instead of `first`/`second` — add a `replies: [ENVELOPE, …]` option rather than editing `relaunchRig`'s callers):
  - `AC4.1: two red runs climb low → medium on standard → capable` — `script: [redRun(1), redRun(2)]`: three implementer calls with `[model, effort]` `[M('standard'), 'low']`, `[M('standard'), 'medium']`, `[M('capable'), 'medium']`; three worker lines with `attempt` 1, 2, 3 and `effort` `'low'`, `'medium'`, `'medium'`; `fromFirstWorker` pairs `worker ok, commit ok, test stop, worker ok, commit ok, test stop, worker ok, commit ok, test ok, check ok`; one `check` line.
  - `AC4.2: a third red run leaves as #5997's second failure does` — `script: [redRun(1), redRun(2), redRun(3)]` versus the `AC5.1 (#5997)` "red twice" control: same `[outcome, stop.class, stop.reason, stop.step]`, `escalateReason` equal, detail includes `after two relaunches (`; exactly three implementer calls.
  - `AC4.3: a first cannot-complete goes straight to capable` — `replies: [STUCK, ENVELOPE]`: second call model `M('capable')`, effort `'medium'`, line `trigger: 'cannot-complete'`, `attempt: 2`.
  - `red then cannot-complete climbs to capable` — `script: [redRun(1)]`, `replies: [ENVELOPE, STUCK, ENVELOPE]`: third call `M('capable')`; second line `effort: 'medium'`.
  - `AC5.1: model-effort inherit keeps one relaunch with no effort` — `relaunchRig({ issue: MEDIUM_LOW_RISK, script: [redRun(1), redRun(2)] })` (record, no `model-effort`): exactly two implementer calls, both `effort` null, detail `after one relaunch (red-tests, standard to capable)`.
  - `a clamped profile step after an effort step ends the ladder with noRelaunch clamped` — `LADDER` + `'model-ceiling': 'standard'`, two red runs: two calls, last test line `noRelaunch: 'clamped'`.
  - `the second relaunch's changedFiles is all three commits' paths` and `the final line's costUsd sums all three launches` (mirror the two #5997 tests of those names).
  - `the attempt-3 prompt carries the first prompt and only the newest relaunch text` — third call's prompt includes the first prompt, includes "Your previous attempt", and contains exactly one `Relaunch.` paragraph.
  - `AC7.1 (ladder): no launch above high` — `model-profiles: { capable: { effort: 'max' } }`: the third call's effort is `'high'`.
  - `docs/driver.md documents the effort ladder` — extend the `#5997: docs/driver.md documents…` test's style (run.test.js:5559) with literals: `**Effort ladder (#6002).**`, `four implementer launches per record`, `attempt` `3`, `model-effort: inherit`.

- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/driver/run.test.js` → only the new tests fail.

- [ ] **Step 3: Implement** per the rules. Rewrite the header paragraph at steps.js 69-87 and relaunch.js 1-17 to describe the ladder (keep every stop listed; replace "relaunched once"/"never a trigger (at most one relaunch per record)" with the ladder's rule). docs/driver.md: line 309 → "…so the worst case is four implementer launches per record, the review fix round included (under the effort ladder; three otherwise)"; the `Implementer tier (#5997)` paragraph's "relaunches the implementer once" → "relaunches the implementer once (twice under the effort ladder, below)"; the new paragraph states: start effort by `risk:`; effort step only on the first escalation and only for red tests (and, in the standard lane, a failed fix-round re-review); `cannot-complete` steps the profile; at most two escalations, three implementer launches before the fix round; `attempt` 1-3 and `effort` on each worker line; inherit keeps one relaunch at no effort; ceilings per launch; the probe lives in `worker.js`'s `Standard implementer at low effort (#6002)` bullet. Journey lines 68-70: add the ladder clause.

- [ ] **Step 4: Run** — `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/relaunch.test.js tests/bin-lib/station-events/driver-mirror.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js` (drop a path that does not exist) — all pass, every pre-existing `#5997` test unmodified.

- [ ] **Step 5: Retirement sweep** — `git grep -n -i -e 'one relaunch' -e 'relaunched once' -e 'three implementer launches' -e 'at most one relaunch' -- plugin docs tools ':!docs/superpowers' ':!docs/plans'`: every remaining hit is either the inherit path's literal note text or prose qualified by the ladder.

- [ ] **Step 6: Commit** — `Climb the driver implementer's effort before its profile — refs #6002`; body lists the third-line readers and what was checked.

---

### Task 5: The standard lane's ladder in `build/dispatch.md`

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (line 14's `Implementer profile (#5999)` paragraph)
- Modify: `plugin/skills/build/handoff-template.md` (lines 56-57)
- Modify: `docs/journeys/pick-an-implementer-profile-from-a-spec-5996.md` (line 45's profile line)
- Test: `tests/build-implementer-tier-conformance.test.js`; check `tests/dispatch-no-stash-conformance.test.js` (pins `implementer-tier.js --spec-file` on the same paragraph) stays green.

**Interfaces:**
- Consumes: Task 2's CLI flags and JSON keys (`startEffort`, `next`, `--attempt-profile`, `--attempt-effort`, `--escalations`, `--trigger`).

Rules — the prose (dispatcher voice, the paragraph's existing style):
1. The profile log line becomes `` `AUTO {time} — implementer profile {profile} (rule: {rule}, size: {size}, key files: {count}) effort {startEffort}. Reversibility: n/a.` `` with "`{startEffort}` is `inherit` when `null`" (AC6.1).
2. A new sentence block `**Effort ladder (#6002).**` placed after the `**Escalation (#5999).**` paragraph's last sentence, before `**Child-prompt _shared bundle (#4359).**`:
   - Applies when the CLI's `rule` is `record`, no `profile=` token (or its `tier=` alias) was given, and `startEffort` is not `null` (`model-effort: profile`); it then replaces the #5999 escalation; with `startEffort` `null`, #5999's paragraph applies unchanged.
   - Every per-task implementer dispatch sets the Agent tool's `effort` parameter to `startEffort`, per `_shared/subagent-dispatch-core.md`'s Dispatching rule (#5941). A `**Role:**` marker's task starts from the marker's own profile instead (spec Decisions, Reading A): its effort is the `startEffort` of a second call, the same arguments plus `--from {marker profile}` (Task 2: `--from` sets the profile `startEffort` is computed against), never the build profile's — so a Fast marker starts with no effort (no `effort` parameter, no effort rung, its first escalation the profile step) and a Capable marker at its risk-allowed level capped at Capable's own effort.
   - Same two triggers as #5999 (`blocked`: a `STATUS: BLOCKED` reply; `fix-round-failed`: the re-review of the task's first fix round fails); same fresh-implementer rule.
   - The next attempt is the `next` of a second call, pinned whole: `node "${CLAUDE_PLUGIN_ROOT}/bin/implementer-tier.js" --spec-file "{spec-file}" --attempt-profile {profile} --attempt-effort {effort} --escalations {n} --trigger {trigger}` (plus `--run "$PIPELINE_RUN_DIR"` when set), `{profile}`/`{effort}` the task's current attempt (`inherit` for no effort), `{n}` the count of the task's `task {k} implementer escalated` lines in `decisions.md` (no run dir: SDD's `progress.md`); its model via `resolve-profile.js {next.profile}`, its `effort` parameter `next.effort` (none when `null`).
   - At most two escalations per task; a `null` `next` (two escalations, no step-up, or a step-up to the same model) gets SDD's own handling at the task's last profile and effort, as do fix rounds after an escalation.
   - Log each: `` `AUTO {time} — task {k} implementer escalated {from-profile}@{from-effort} → {to-profile}@{to-effort} ({trigger}). Reversibility: n/a.` `` (AC6.2); no line for a `null` `next` (AC6.3).
3. handoff-template.md lines 56-57: the profile line gains ` effort {startEffort}`; add the ladder's escalation-line shape beside the #5999 one.

- [ ] **Step 1: Write the failing tests** — in `tests/build-implementer-tier-conformance.test.js`, update `PROFILE_LINE` to the new literal; add patterns (each a `lit(...)` of one exact phrase, each matching exactly once in `DISPATCH`), with fact names carrying clause ids:
  - the ladder CLI call literal above → `'AC2.1 AC3.1 (lane): names the next-attempt CLI call'`
  - the ladder escalation line → `'AC6.2: effort-ladder escalation line'`
  - "sets the Agent tool's `effort` parameter to `startEffort`" → `'AC6.1: dispatch at startEffort'`
  - "At most two escalations per task" → `'AC6.3: at most two escalations'`
  - the marker clause "plus `--from {marker profile}`" in the Effort ladder block → `'Decision Q1: a Role-marker task starts at its own profile's startEffort'`
  - "a `null` `next`" clause → `'AC6.3: past the ladder, SDD's own handling'`
  - "`startEffort` is not `null`" gate → `'AC5.1 (lane): inherit keeps #5999'`
  - `"{startEffort}` is `inherit` when `null`" → `'AC6.1: inherit printed for null'`
  The existing `assertEachPatternGoesRed` test then proves each new fact goes red alone.
  Add `AC6.1: handoff-template names the effort on the profile line` (a `missingFactsOf` over handoff-template.md with the two line shapes) and a go-red control per fact via `assertEachPatternGoesRed`.
- [ ] **Step 2: Run to verify they fail** — `node --test tests/build-implementer-tier-conformance.test.js` → FAIL on the new/updated facts.
- [ ] **Step 3: Edit the prose** per Rules 1-3. Then `wc -c plugin/skills/build/dispatch.md` — must be ≤ 49,500 B; record the number in the commit body.
- [ ] **Step 4: Run** — `node --test tests/build-implementer-tier-conformance.test.js tests/dispatch-no-stash-conformance.test.js`, plus `git grep -ln "build/dispatch.md" -- tests` and run every hit — all pass.
- [ ] **Step 5: Commit** — `Climb the standard lane's implementer effort before its profile — refs #6002`.

---

## Audit waivers (plan-audit Check B)

- Waived `plugin/skills/_shared/policy-schema.md`, `plugin/skills/build/build-options.md`, `plugin/skills/flow/materialize.md`: each names `implementer-tier`/the profile override and none describes escalation or effort, so the ladder changes nothing they state (read during authoring).
- Waived `CHANGELOG.md` and the earlier `docs/superpowers/plans/2026-11-2*-*.md` and `docs/plans/*-ledger.md` files: append-only history.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 `startEffort`; AC1.1-AC1.3 | 1 (unit), 2 (CLI), 3 (driver) |
| Deliverable 2 `nextAttempt`; AC2.1-AC2.3, AC3.1-AC3.3 | 1, 2 |
| Deliverable 3 CLI fields | 2 |
| Deliverable 4 driver; AC4.1-AC4.3, AC5.1 | 3, 4 |
| Deliverable 5 standard lane; AC6.2, AC6.3 | 5 |
| Deliverable 6 profile line effort; AC6.1 | 5 |
| Deliverable 7 docs/driver.md | 4 |
| Deliverable 8 tests | 1-5 |
| AC7.1 | 1, 3, 4 |
| Decisions: plan review Q1, Reading A (a `**Role:**` marker's task starts at its own profile's `startEffort`) | 2 (`--from`), 5 (dispatch prose) |
| Gotcha: ASSUMPTION probe | controller ran it before planning (decisions.md, 6 of 6 pass); recorded in Task 3 Step 5 (worker.js header) and Task 4 (docs/driver.md), and in the PR body at review |
