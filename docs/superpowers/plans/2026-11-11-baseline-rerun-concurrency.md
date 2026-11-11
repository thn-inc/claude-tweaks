# Baseline Rerun Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--baseline` adjudication reruns failing files one at a time unless `concurrency.reruns` declares more, never fans out on timeout evidence, and checks the base out at one stable path per held slot instead of a fresh `mkdtemp` path per run — without ever counting a base-side run as evidence when its checkout was not at the base commit.

**Architecture:** `declaration.js` accepts two more `concurrency` keys; `extract.js` exports one `timeoutEvidence` helper built on its own `INCONCLUSIVE_RE` and `cancelledCount`; `adjudicate()` computes one phase limit, lowers it to 1 on check-level evidence and again after any phase whose reruns timed out, and reports the limit each phase ran under; `realGit().addWorktree(sha, { slot, slotBase })` builds `<tmpdir>/ct-verify-base/<repo-key>/slot-<index>/wt`, where `<repo-key>` folds in the slot lock dir the index came from, clears this slot's own leftover first, and falls back to today's `mkdtemp` path (named in `scratch.fallback`) whenever a guard fails; every base-side run checks the scratch's HEAD before and after it runs and is no evidence on a mismatch. `verify.js` passes the declared values and the hold's lock dir, and prints one line when timeout evidence forced serial reruns.

**Tech Stack:** Node 18+ CommonJS, `node:test`, `node:crypto` (sha256), no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-11T053439-spec-5150/work/5150-spec.md` (worktree copy; its `## Plan Review Clarifications` section carries the three user decisions below)

**Scope keywords:** adjudicate, realGit, addWorktree, removeWorktree, headOf, findStaleBaselineWorktrees, slotScratchPath, holdSlot, defaultSlotBase, takeSlot, timeoutEvidence, INCONCLUSIVE_RE, cancelledCount, CONCURRENCY_KEYS, readDeclaration, defaultConcurrency, baselineAdjudicated, ct-verify-base, suiteSlots, reruns, timeoutPatterns

## Global Constraints

- Shipped code stays stack-agnostic: no database-, test-runner- or language-specific behavior in `plugin/**`, and no runner timeout wording beyond what `INCONCLUSIVE_RE` (`extract.js:262`) already carries; a project supplies its own through `timeoutPatterns`. The consumer evidence in the spec is a motivating example only: never name or describe the consumer project in code, comments, commits or docs beyond "a project with many parallel pipeline sessions on one machine and a shared test resource".
- Run tests only through `tools/run-tests.js` (it holds the machine-wide slot), never a bare `node --test`, never the full suite inside a task. A positional argument to `run-tests.js` is a directory root (a file path throws `ENOTDIR`), so a targeted run is `node tools/run-tests.js --files-from {list}`. The list files below already exist, one repo-relative path per line, under `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/`; every command spells the full path.
- No policy key. `reruns` and `timeoutPatterns` live in the `verify-scope.json` `concurrency` block, which stays strict: an unknown key is still a validation error.
- Version floor: the first release whose `declaration.js` accepts `reruns`/`timeoutPatterns` is the release carrying #5150 (the next release after 6.164.0; release-please assigns the number). Never hard-code a version number in code or docs. This repo's committed `.claude-tweaks/verify-scope.json` must not adopt either key in this PR.
- `timeoutPatterns` entries are literal substrings matched with `String.prototype.includes` on ANSI-stripped text, never regexes.
- The stable scratch path is derived only from a slot this process took (`takeSlot()`'s `{ index, base }`, or an explicit `slot` argument of the same shape). Never from an inherited env var: `verify.js`'s `holdFor` returns null under `CT_TEST_SUITE_SLOT_HELD=1`, so a nested run keeps the `mkdtemp` path.
- Decided by the user at plan review: holders of one slot index from different lock dirs never share a path (the lock dir is part of `<repo-key>`), and a base-side run whose scratch HEAD is not the base sha is never evidence — so even a path collision costs evidence, never a false pass.
- Decided by the user at plan review: a stable-path guard failure falls back to a fresh `mkdtemp` path with one stderr line and records `scratch.fallback: {reason}`; `scratch.fallback` is absent when the stable path was used or when no slot was held.
- Decided by the user at plan review: `concurrency.used` is per phase, `{ baseline, isolated, retry }`, each the limit that phase ran under, and `null` for a phase that spawned no rerun (all three keys always present).
- Source-scan suites over `plugin/bin/`: no new `existsSync`/`realpathSync` tokens in `baseline.js` (its `tests/path-guard-conformance.test.js:148` allowlist entry pins `realpathSync: 1, existsSync: 3`; use `lstatType`, `canonicalRealpath`, `resolveWithin` from `plugin/bin/lib/path-guard`), no hand-rolled `startsWith(root + path.sep)` containment (`tests/path-containment-conformance.test.js`), and every git spawn goes through `realGit`'s existing `git()` helper (`windowsHide: true`, `tests/windows-hide-spawn-conformance.test.js`).
- Governing skill `verify-scope-rule-kind` (verbatim): "**The committed declaration stays readable by the previous release.** The installed plugin build reads this repo's committed `.claude-tweaks/verify-scope.json` with older code. … Since #4135 `tests/verify-scope-declaration.test.js` runs that check itself" and its Anti-Patterns row: "Adding a key inside an existing block (`impact`, `ci`, `concurrency`) because a new top-level block needed no compatibility value | `readDeclaration` has no unknown-key check at the top level, so an older reader ignores a new block (#4347's `ci`, #5119's `concurrency`). Each block checks its own keys (`IMPACT_KEYS`, `CI_KEYS`, `CONCURRENCY_KEYS`), so a release that knows the block rejects the committed file over one new key inside it". Item 1's other sites: `scope.js` (unchanged — no selection effect), `plugin/bin/lib/init/verify-scope-starter.js` (unchanged — `/init` does not offer `reruns`: declaring it opts a project out of the serial default, which only the project can judge), the Re-verify scoping table (unchanged).
- Governing skill `suite-slot-test-env` (verbatim): "Build the child env with `slotEnv(dir, extra)` from `tests/helpers/suite-slot-env.js`." / "A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env`" / "A test that waits on a slot-holding child bounds it with the spawn's own `timeout` … Never assert a wall-clock budget to catch a hang". A slot-holding `verify.js` child now writes its scratch under `os.tmpdir()`, so such a child also gets a private `TMPDIR`/`TMP`/`TEMP` (the AC3.1 test at `cli.test.js` already passes one to a `run-tests.js` child). An in-process `holdSlot` test passes an explicit `env` (`hold` in `tests/bin-lib/verify/slot.test.js:44-53`).
- Governing skill `node-test-output-evidence` (verbatim): "Diagnostics follow the same scoping: `conclusiveOnly` tests `INCONCLUSIVE_RE` only against the block's own top-level key lines (`keys`), so a quoted child timeout cannot make its parent inconclusive." `timeoutEvidence` deliberately reads the whole failing region instead: its only effect is to run reruns serially, so a quoted child timeout over-matching costs speed, never a verdict. Say so in its header comment.
- Governing skill `skill-prose-conformance-tests` (verbatim): "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** … `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) is the home of both" and "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`".
- Governing skill `windows-checkout-test-parity` (verbatim): "Build the expected value with `path.resolve`/`path.join` when the code under test resolves or joins the path". Symlink-fixture tests skip on win32.

## Review Focus

- A shared or multi-user tmpdir where `<tmpdir>/ct-verify-base` is a symlink or another user's directory: nothing is ever removed through it, the run falls back to a fresh `ct-verify-base-*` path with one stderr line and `scratch.fallback`, and adjudication still completes — Task 4 test "RF1".
- A symlink anywhere under the root on the way to the slot path (`slot-<index>`, `<repo-key>`) or at `wt` itself: never followed or removed; same fallback — Task 4 tests "RF2" and "RF2b".
- A leftover worktree still registered at the slot path whose directory a tmp cleaner already deleted: `git worktree add` would refuse it ("missing but already registered"), so it is pruned first and `reused` is true — Task 4 test "RF3".
- A rerun that exits non-zero with a per-test timeout in its own log (not a process timeout): later phases still go serial (`phase-timeout: {phase}`) — Task 3 test "RF4".
- `timeoutPatterns` holding regex metacharacters, or a log whose timeout wording is wrapped in ANSI color codes: matched literally after stripping — Task 2 test "RF5".

---

## Spec premises checked at HEAD

- **False:** "One test per evidence source: `timedOut`" assumes a failing check can carry `timedOut` into the phases. `run.js:212-215` sets `exitCode: null` with `timedOut: true`, and `adjudicate()` refuses any check without a numeric exit at `baseline.js:333` before a rerun exists. The check-level `timedOut` source is kept in the predicate (cheap, and the spec lists it), its AC3.2 test uses a synthetic `{ exitCode: 1, timedOut: true }` check, and the same test asserts the real shape (`exitCode: null`) is refused with zero `runOne` calls.
- **False (corrected by the user at plan review):** the Gotchas' "can at worst let two adjudications share a path once … never to a false pass". A second run's leftover cleanup removes the first run's live checkout and re-adds it at another base sha, so the first run's later base reruns would run at the wrong commit and could read as "fails at base"; and holders of one index under different `CT_TEST_SUITE_SLOT_DIR` values collide on every run, not once. Tasks 4 and 5 close both.
- **Stale:** the spec says "verify.js passes that index to `adjudicate()` as `slot`". At HEAD verify.js passes only `takeSlot` (`verify.js:987-990`, returning `adjHold.index`); `adjudicate()` sets `slot` from `takeSlot()`'s return (`baseline.js:434-437`). That is already the own-slot-only route the Gotchas require; Task 4 widens the return to `{ index, base }`.
- **Re-located (#5119 moved them):** `adjudicate` signature `baseline.js:312-321` (`concurrency = 4` at :314), phase pools :457 / :484 / :565, base evidence :467-480, base full run :615-617, signal handlers :451-452, `addWorktree` :108-119, `removeWorktree` :123-130, `findStaleBaselineWorktrees` :147 (called at `verify.js:488`), `holdSlot`'s lock base `slot.js:74` and its return `slot.js:118-120`, `defaultConcurrency` `verify.js:206-220`, the adjudication call `verify.js:974-991`, the `Baseline:` stdout block `verify.js:1486-1515`.
- **No change needed:** `report.js` copies `baselineAdjudicated` verbatim (`report.js:134`), so the new fields reach `report.json` from `adjudicate()`'s return alone.

## Plan decisions beyond the spec

- `adjudicate()`'s `concurrency` default becomes `null` (undeclared → 1, `default-serial`) and verify.js passes the declared value or `null`, not `?? 1`: the report must tell an undeclared limit from a declared `1`.
- A rerun's own log carrying timeout evidence counts as that phase timing out, not only a process timeout (`timedOut`) — RF4. Its only effect is serial later phases.
- `addWorktree` returns `{ dir, reused, fallback? }` instead of a bare path (one producer, one consumer; the three test fakes update with it).
- `scratch.moved: true` is recorded when any base-side run was refused for a scratch HEAD mismatch (absent otherwise), so a collision that cost evidence is visible, like `scratch.fallback`.

Waived plugin/bin/lib/verify/report.js: pass-through at `report.js:134`; Task 6's CLI tests read the new fields from `report.json`.
Waived tools/run-tests.js: every task's `Run:` uses it unchanged; no task modifies it.

---

### Task 1: `concurrency.reruns` and `concurrency.timeoutPatterns` in the declaration

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/verify/declaration.js:25` (`CONCURRENCY_KEYS`), `:188-205` (the block)
- Test: `tests/bin-lib/verify/declaration.test.js:381-413` (the five #5119 tests pin the old shape and text; update them, add the new ones)

**Interfaces:**
- Produces: `decl.concurrency: { suiteSlots: number|null, reruns: number|null, timeoutPatterns: string[] }`, always present; `CONCURRENCY_KEYS = ['suiteSlots', 'reruns', 'timeoutPatterns']`.

- [ ] **Step 1: Write the failing tests** (update the existing #5119 assertions to the widened shape; add):
  - `AC8.1: reruns: 3 and timeoutPatterns: ["deadline"] parse (#5150)` — `r.ok === true`, `r.decl.concurrency` deep-equals `{ suiteSlots: null, reruns: 3, timeoutPatterns: ['deadline'] }`; an absent block and `{}` deep-equal `{ suiteSlots: null, reruns: null, timeoutPatterns: [] }`; `timeoutPatterns: []` parses to `[]`.
  - `AC8.2: other reruns and timeoutPatterns values each report their exact message (#5150)` — via the existing `errs` helper: `reruns` of `0`, `1.5`, `'2'`, `null` → `['concurrency.reruns: must be a positive integer']`; `timeoutPatterns` of `'x'`, `[1]`, `['']`, `['a', null]`, `{}` → `['concurrency.timeoutPatterns: must be an array of non-empty strings']`; `{ slots: 2 }` → `['concurrency: unknown key(s) "slots" (allowed: suiteSlots, reruns, timeoutPatterns)']`.
  - `AC8.2: CONCURRENCY_KEYS names suiteSlots, reruns and timeoutPatterns (#5150)` — deep-equals `['suiteSlots', 'reruns', 'timeoutPatterns']` (replaces the #5119 pin at :411-413).

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task1.txt"`
Expected: FAIL after Step 1 — `concurrency: unknown key(s) "reruns"` and the shape mismatch on `{ suiteSlots: null }`.

- [ ] **Step 3: Implement** in `readDeclaration`'s `concurrency` block: same pattern as `suiteSlots` (validate when `!== undefined`, assign only when valid), errors exactly as in Step 1; update the block's header comment (#5150, and that a reader before the release carrying #5150 rejects either key).

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/verify/declaration.js tests/bin-lib/verify/declaration.test.js`, message `Accept concurrency.reruns and concurrency.timeoutPatterns in verify-scope.json — the concurrency block stays strict (#5150)`.

### Task 2: `timeoutEvidence` in extract.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/extract.js:45-90` (factor the region), `:262` (`INCONCLUSIVE_RE` stays here), `:777-782` (export)
- Test: `tests/bin-lib/verify/extract.test.js`

**Interfaces:**
- Produces: `timeoutEvidence(text: string, family: string, patterns: string[] = []) → 'cancelled' | 'inconclusive-marker' | 'timeout-pattern' | null`, checked in that order on `stripAnsi(text)`: `cancelledCount(text, family) > 0`; any line of the **uncapped** failing region matching `INCONCLUSIVE_RE`; any `patterns` entry contained in the stripped text. Its verdict decides whether adjudication fans out, so each branch gets a test where only it decides.

- [ ] **Step 1: Write the failing tests**
  - `AC3.2: timeoutEvidence names a cancelled count, an inconclusive marker and a declared pattern, each alone (#5150)` — `'ℹ tests 2\nℹ cancelled 1'` (spec) and `'# tests 2\n# cancelled 3'` (tap) → `'cancelled'`; a spec log whose `✖ failing tests:` entry body has `  test timed out after 100ms` → `'inconclusive-marker'`; a tap `not ok` block whose YAML has `failureType: 'testTimeoutFailure'` → `'inconclusive-marker'`; a spec log with `ran past its deadline` in an entry body and `patterns: ['ran past its deadline']` → `'timeout-pattern'`; the same three logs with the trigger removed (or `patterns: []`) → `null`; `ℹ cancelled 0` → `null`.
  - `timeoutEvidence checks in order — a cancelled count wins over a marker and a pattern (#5150)` — one log carrying all three → `'cancelled'`; marker plus pattern → `'inconclusive-marker'`.
  - `timeoutEvidence reads the failing region uncapped — a marker past MAX_REGION_LINES still counts (#5150)` — a spec log with `MAX_REGION_LINES + 20` failing-section lines before the marker line → `'inconclusive-marker'`, while `extractFailingRegion` of the same log does not contain the marker.
  - `RF5: timeoutPatterns match literally after ANSI stripping (#5150)` — `patterns: ['a.c']` on a log containing `abc` only → `null`; on a log containing `\u001b[31ma.c\u001b[39m` → `'timeout-pattern'`; `patterns: ['(?:']` does not throw.
  - A marker outside the failing region (a passing test's line above `✖ failing tests:`) → `null`.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task2.txt"`
Expected: FAIL after Step 1 — `timeoutEvidence is not a function`.

- [ ] **Step 3: Implement** — factor `extractFailingRegion`'s tap loop and spec slice (`extract.js:53-65`, `:86-89`) into an uncapped `failingRegionLines(text, family)` (the spec slice from `✖ failing tests:` on, the tap `not ok` blocks; `null` for any other family, where `timeoutEvidence` reads the whole text). `extractFailingRegion` caps its result and its output stays byte-identical (the existing `extractFailingRegion` tests guard that). Header comment: the over-match note from Global Constraints.

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/verify/extract.js tests/bin-lib/verify/extract.test.js`, message `Add timeoutEvidence to extract.js — one source for the inconclusive markers adjudication backs off on (#5150)`.

### Task 3: Serial-by-default phases and the timeout back-off in `adjudicate()`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js:27-30` (require `timeoutEvidence`), `:312-321` (options), `:330-398` (record the first accepted check carrying evidence), `:457`, `:484`, `:565` (the three pools), `:637-653` (result)
- Test: `tests/bin-lib/verify/baseline.test.js` (the pool-abort test at :388-404 passes `concurrency: 2` explicitly and keeps doing so; every other existing test keeps its start order under serial pools)

**Interfaces:**
- Consumes: `timeoutEvidence` (Task 2).
- Produces: `adjudicate({ …, concurrency = null, timeoutPatterns = [] })`. `concurrency` is `null` (undeclared) or a positive integer. Eligible results gain `concurrency: { declared: number|null, used: { baseline: number|null, isolated: number|null, retry: number|null }, reason: string }`. Each `used` entry is the limit that phase's pool ran under, or `null` when the phase spawned no rerun (no file present at base for `baseline`/`isolated`, no `needsRetry` file for `retry`); all three keys are always present. `reason` is `default-serial`, `declared`, `timeout-evidence: {check}` or `phase-timeout: baseline|isolated`. Ineligible results are unchanged.

Resolution (the algorithm the tests pin):

```
limit, reason = concurrency == null ? (1, 'default-serial') : (concurrency, 'declared')
if limit > 1 and evidenceCheck: limit, reason = 1, `timeout-evidence: ${evidenceCheck}`
baseRuns  = pool(work, limit, …);  used.baseline = (any base rerun spawned) ? limit : null
if limit > 1 and baseRuns.some(timedOutRun): limit, reason = 1, 'phase-timeout: baseline'
headRuns  = pool(work, limit, …);  used.isolated = (any isolated rerun spawned) ? limit : null
if limit > 1 and headRuns.some(timedOutRun): limit, reason = 1, 'phase-timeout: isolated'
retryRuns = pool(work, limit, …);  used.retry = (any retry spawned) ? limit : null
```

`evidenceCheck` is the first accepted failing check where `c.timedOut || timeoutEvidence(text, family, timeoutPatterns) !== null` (`text` is the `readLog` already read at :336). `timedOutRun(r)` is `r && (r.timedOut || timeoutEvidence(log, sniffFamily(log), timeoutPatterns) !== null)` over the rerun's own `readLog(r.logPath)` — the RF4 case; a null log is not evidence.

- [ ] **Step 1: Write the failing tests** — a `peakFakes(opts)` helper wraps `fakes(opts)`'s `runOne`: classify each call by the same kind rule `fakes` uses, hold it for `setTimeout(5)`, and record the peak in-flight count per kind (`baseline`, `isolated`, `isolated-retry`) and per `cwd`. `SIX` is `tests/a.test.js` … `tests/f.test.js`; `allPhases` is outcomes `baseline:{f}: 0`, `isolated:{f}: 1`, `isolated-retry:{f}: 1` for each (a base pass plus an isolated failure sends every file through all three phases).
  - `AC1.1, AC1.2: with no reruns declared every phase runs one rerun at a time (#5150)` — no `concurrency` argument; peaks `{ baseline: 1, isolated: 1, 'isolated-retry': 1 }` and per cwd `{ '/scratch': 1, '/repo': 1 }`; `r.concurrency` deep-equals `{ declared: null, used: { baseline: 1, isolated: 1, retry: 1 }, reason: 'default-serial' }`. Against HEAD's default of 4 the peaks read 4.
  - `AC2.1: reruns 3 with 6 failing files peaks at 3 in each phase (#5150)` — `concurrency: 3`; peaks all 3; `{ declared: 3, used: { baseline: 3, isolated: 3, retry: 3 }, reason: 'declared' }`.
  - `AC3.1, AC3.2: timeout evidence on a failing check runs every phase serially — <source> (#5150)`, one test per source, each `concurrency: 4`, expecting peaks all 1, `used: { baseline: 1, isolated: 1, retry: 1 }` and `reason: 'timeout-evidence: tests'`:
    - `timedOut` — check `{ name: 'tests', exitCode: 1, timedOut: true, logPath }`; the same test then runs check `{ exitCode: null, timedOut: true }` and asserts `eligible: false` and zero `runOne` calls (the real `run.js` shape — see Spec premises).
    - inconclusive marker — `SIX`'s log with `  test timed out after 100ms` in `tests/a.test.js`'s entry body.
    - cancelled count — a log with six entries, `ℹ fail 5`, `ℹ cancelled 1` (still eligible: entries = fail + cancelled).
    - declared pattern — an entry body line `\u001b[31mran past its deadline\u001b[39m` with `timeoutPatterns: ['ran past its deadline']`; its control (same log, `timeoutPatterns: []`) peaks at 4 with `reason: 'declared'`, so only the pattern decides.
  - `AC4.1: a timed-out base rerun runs the isolated and retry phases serially (#5150)` — `concurrency: 4`, `allPhases` with `baseline:tests/a.test.js: { exitCode: null, timedOut: true }`; peaks `{ baseline: 4, isolated: 1, 'isolated-retry': 1 }`; `r.concurrency` deep-equals `{ declared: 4, used: { baseline: 4, isolated: 1, retry: 1 }, reason: 'phase-timeout: baseline' }`.
  - `a timed-out isolated rerun runs the retry phase serially (#5150)` — `isolated:tests/a.test.js` timed out; peaks `{ baseline: 4, isolated: 4, 'isolated-retry': 1 }`; `used: { baseline: 4, isolated: 4, retry: 1 }`, `reason: 'phase-timeout: isolated'`.
  - `a phase that spawns no rerun reports used null (#5150)` — `concurrency: 4`, outcomes where every file fails the same tests at base and in isolation (the #3043 AC1 shape: no retry) → `used: { baseline: 4, isolated: 4, retry: null }`; every file absent at base → `used: { baseline: null, isolated: null, retry: null }`.
  - `RF4: a base rerun failing on a per-test timeout in its own log backs off like a process timeout (#5150)` — `baseline:tests/a.test.js: 1` with `logs` giving it a spec log carrying `test timed out after 100ms`; isolated and retry peaks 1; `reason: 'phase-timeout: baseline'`.
  - `undeclared reruns stays default-serial even with timeout evidence (#5150)` — no `concurrency`, the inconclusive-marker log; `reason: 'default-serial'` (evidence names itself only when it lowered a declared limit, which is what verify.js's stdout line keys on).

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task3.txt"`
Expected: FAIL after Step 1 — AC1.1 peaks read 4; `r.concurrency` is undefined.

- [ ] **Step 3: Implement** the options, the evidence capture in the checks loop, the resolution above and the result field. Replace the `concurrency = 4` default with `null` and document both new options in the signature's comment block (like `slot`/`takeSlot` at :316-320).

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS (the whole file, existing tests included).

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js`, message `Run baseline reruns one at a time unless declared, and back off on timeout evidence (#5150)`.

### Task 4: One stable scratch path per held slot and lock dir

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js:21-30` (requires: `crypto`, `../path-guard`, `ensureOwnDir` from `../suite-slot`), `:33` (`realGit` options), `:108-130` (`addWorktree`/`removeWorktree`), `:316-320` and `:434-437` (`slot`/`takeSlot` become `{ index, base }`), `:454` (pass `{ slot, slotBase }`, read `{ dir, reused, fallback }`), `:637-653` (result), `:660` (export `slotScratchPath`)
- Modify: `plugin/bin/lib/verify/slot.js:118-120` — `holdSlot`'s returned hold gains `base` (the `defaultSlotBase(env, tmpdir)` value at :74 it acquired under)
- Modify: `plugin/bin/verify.js:987-990` — `takeSlot` returns `adjHold ? { index: adjHold.index, base: adjHold.base } : null`
- Test: `tests/bin-lib/verify/baseline.test.js` — the fake `addWorktree`s at :45, :158 and :537 return `{ dir, reused: false }` instead of a bare path (:116's spy passes the return through unchanged); the #5119 test's `takeSlot` at :113 returns `{ index: 0, base: '/slots' }`
- Test: `tests/bin-lib/verify/slot.test.js` — `hold`'s returned object names its lock dir

**Interfaces:**
- Produces:
  - `holdSlot(...)` returns `{ lane, index, slots, source, waitedMs, release, base }`; `base` is the lock base dir (`CT_TEST_SUITE_SLOT_DIR`, else `<tmpdir>/ct-test-suite-slots`). `slotReport` (`verify.js:223-227`) is unchanged, so `report.json`'s `slot` does not gain it.
  - `slotScratchPath({ tmpdir, commonDir, slotBase, slot }) → string` — `path.join(tmpdir, 'ct-verify-base', <repo-key>, \`slot-${slot}\`, 'wt')` with `<repo-key>` = the first 12 hex digits of `sha256(\`${commonDir}\n${slotBase}\`)`; pure, exported. Callers pass both directories already canonical.
  - `realGit(cwd, { warn, rmSync, tmpdir = os.tmpdir() })` — the `mkdtemp` path uses `tmpdir` too.
  - `addWorktree(sha, { slot = null, slotBase = null } = {}) → { dir: string, reused: boolean, fallback?: string }` — `fallback` is present only when a slot was given and a guard sent the run to the `mkdtemp` path.
  - `removeWorktree(dir)` — removes `path.dirname(dir)` only when its basename starts `ct-verify-base-` (today's `mkdtemp` parent), else only `dir`, so `slot-<index>/` stays.
  - `adjudicate({ slot = null, takeSlot = () => null })` — both carry `{ index, base } | null`. Eligible results gain `scratch: { path: string|null, reused: boolean, fallback?: string }` (`path` is the realpath'd scratch, `null` when no file existed at base; `fallback` copied from `addWorktree`).

`addWorktree` with a slot, in order — any failed guard warns once, returns the `mkdtemp` path with `reused: false` and `fallback: {reason}`, never throws and never removes anything. The reasons are exact:
1. `slotBase` = `canonicalRealpath(slotBase)`; `null` (none given, or unresolvable) → `no-slot-lock-dir`.
2. `commonDir` = `canonicalRealpath(path.resolve(cwd, git(['rev-parse', '--git-common-dir'])))` (the `impact.js:173-175` resolution plus the realpath); `null` → `no-common-dir`.
3. `root = path.join(tmpdir, 'ct-verify-base')`; `ensureOwnDir(root)` (creates it 0700; refuses a symlink, a non-directory or another user's directory) → on throw, `root-unusable: {message}`.
4. `dir = slotScratchPath(…)`; `mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 })`; then `resolveWithin(path.dirname(dir), root)` must be non-null, else `parent-outside-root` (RF2b: a symlinked `slot-<index>` or `<repo-key>`; `mkdirSync` follows a symlinked intermediate, so through a symlinked `<repo-key>` it can leave one empty `slot-<index>` directory in the link's target — only this user can plant a link inside a root `ensureOwnDir` verified as theirs — and the guard refuses before anything is removed or checked out there).
5. Leftover = a worktree from `listWorktrees()` naming `dir` (compare canonical paths; for a registered path whose directory is gone, canonicalize its parent and rejoin the basename), or `lstatType(dir).type !== 'missing'`. A leftover present on disk must have `lstatType(dir).type === 'directory'`, else `leftover-not-a-directory` (RF2: a symlinked or file `wt`). Its parent is already proven inside `root`, so the leaf check alone decides.
6. Leftover → `git worktree remove --force dir` (best effort), `rmSync(dir, { recursive: true, force: true })`, `git worktree prune`; `reused = true`.
7. `git worktree add --detach dir sha`; on a throw remove `dir` only (best effort) and rethrow, as today's path does for its parent.

Fallback line, exact: `verify.js: baseline scratch: the per-slot path is unavailable ({reason}) — using a fresh ct-verify-base-* path for this run\n`.

- [ ] **Step 1: Write the failing tests** (real git repos under a fresh temp `tmpdir` passed to `realGit`; adjudications use `fakes()`'s `runOne` with `git: realGit(repo, { tmpdir })` and `takeSlot: () => ({ index: 0, base: S })`, `S` a fresh temp dir standing in for the lock dir)
  - `slotScratchPath joins tmpdir, a 12-hex key over the common dir and lock dir, slot-<index> and wt (#5150)` — expected built with `path.join` and `crypto.createHash('sha256')`; the same common dir with two different `slotBase` values gives two different paths.
  - `holdSlot's hold names the lock dir it acquired under (#5150)` (slot.test.js) — `hold(dir).h.base === dir`.
  - `AC5.1: two sequential adjudications holding slot 0 at two base shas use the same scratch path, and the tmpdir gains no ct-verify-base-* entry (#5150)` — a repo with `tests/a.test.js` and two commits; both results `eligible: true` with equal `scratch.path`, both `reused: false`, neither has `fallback`; `fs.readdirSync(tmpdir)` deep-equals `['ct-verify-base']`; `slot-0/` exists and is empty afterwards; `git worktree list --porcelain` names only the main checkout.
  - `two holders of slot 0 from different lock dirs never share a path (#5150)` — `addWorktree(sha, { slot: 0, slotBase: S1 })` and `addWorktree(sha, { slot: 0, slotBase: S2 })`, both live at once: two distinct `dir`s, both registered, neither `reused`.
  - `AC6.1: a leftover worktree registered at the slot path is removed before git worktree add, the adjudication completes, and scratch.reused is true (#5150)` — pre-create it with `git worktree add --detach {slotScratchPath(…)} {sha}` plus an untracked file inside; result `eligible: true`, `scratch.reused === true`; only the main checkout registered afterwards.
  - `RF3: a registered slot worktree whose directory is gone is pruned and reused (#5150)` — register it, then `fs.rmSync` its directory; `addWorktree(sha, { slot: 0, slotBase: S })` succeeds with `{ dir: slotScratchPath(…), reused: true }`.
  - `AC7.1: an adjudication with no slot keeps a fresh ct-verify-base-* path (#5150)` — no `takeSlot`; `path.basename(path.dirname(r.scratch.path))` matches `/^ct-verify-base-/`, `reused: false`, no `fallback`; and with the fake git, `addWorktree` received `{ slot: null, slotBase: null }` (and `{ slot: 0, slotBase: '/slots' }` when `takeSlot` returns `{ index: 0, base: '/slots' }`).
  - `RF1: a ct-verify-base root that is a symlink is never removed through — fresh path, one warning, scratch.fallback (#5150)` (skip on win32) — `tmpdir/ct-verify-base` symlinked to another temp dir holding a file; `addWorktree` returns a `ct-verify-base-*` path with `fallback` starting `root-unusable: `, `warn` was called once with the exact fallback line, the target's file still exists; through `adjudicate`, `r.scratch.fallback` carries the same reason.
  - `RF2: a wt entry that is a symlink is never followed — fresh path, leftover-not-a-directory (#5150)` (skip on win32) — `slot-0/wt` symlinked to an outside dir holding a file; `fallback === 'leftover-not-a-directory'`, the outside file still exists.
  - `RF2b: a slot-<index> directory symlinked outside the root is never used — fresh path, parent-outside-root (#5150)` (skip on win32) — `<root>/<repo-key>/slot-0` symlinked to an outside dir holding a file; `fallback === 'parent-outside-root'`, the outside dir gains no `wt` and its file still exists, and no worktree is registered there.
  - `a slot with no lock dir falls back with no-slot-lock-dir (#5150)` — `addWorktree(sha, { slot: 0 })` → `fallback === 'no-slot-lock-dir'`.
  - `removeWorktree on a slot path removes wt and keeps slot-<index> (#5150)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task4.txt"`
Expected: FAIL after Step 1 — `slotScratchPath is not a function`, and `h.base` is undefined.

- [ ] **Step 3: Implement** the interfaces and steps above. The signal handlers at `baseline.js:451-452` stay unchanged. `findStaleBaselineWorktrees` stays unchanged: a slot path's parent is `slot-<index>`, so it is never named — its leftover is this slot's to clear on the next run.

- [ ] **Step 4: Run to verify they pass, scans and the CLI included**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task4-scans.txt"`
Expected: PASS — including `tests/path-guard-conformance.test.js` with `baseline.js` still at `realpathSync: 1, existsSync: 3`, and `tests/bin-lib/verify/cli.test.js` (the #5119 slot tests drive the widened `takeSlot`).

- [ ] **Step 5: Mutation proof** — one guard at a time, rerunning the Step 2 command and restoring after each: delete step 6's `git worktree prune` → RF3 fails; delete step 4's `resolveWithin(path.dirname(dir), root)` check → RF2b fails; delete step 5's directory-type check → RF2 fails; drop `slotBase` from the key → the two-lock-dirs test fails.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/verify/baseline.js plugin/bin/lib/verify/slot.js plugin/bin/verify.js tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/slot.test.js`, message `Check the baseline out at one stable path per held slot and lock dir — a killed run's leftover is cleared by the next run on that slot (#5150)`.

### Task 5: A base-side run counts only at the base commit

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js:33-139` (`realGit` gains `headOf`), `:457` (per-file base reruns), `:467-468` (base evidence), `:615-620` (base full run), `:637-653` (`scratch.moved`)
- Test: `tests/bin-lib/verify/baseline.test.js` — `fakes`' git gains `headOf`, returning the sha of its most recent `addWorktree` call (initially `'b'.repeat(40)`, the `baseSha` every existing test passes); the custom git at :154-160 gains `headOf: () => 'b'.repeat(40)`

**Interfaces:**
- Consumes: Task 4's stable path and `realGit({ tmpdir })`.
- Produces: `realGit().headOf(dir) → string|null` — `git(['-C', dir, 'rev-parse', '--verify', 'HEAD'])`, `null` on any failure. Every base-side run (each per-file `baseline` rerun and each `base-full` run) reads `git.headOf(scratch)` immediately before it spawns and again once it settles; unless both equal `baseSha`, the run is no evidence: a per-file base rerun's `baseEv` entry is `null` (the file then routes exactly as an unusable base run does today: flaky on a clean isolated run, else `attributable` — never "fails at base"), and a base full run ends the `fixed` computation with `fixedReason: '{check} base full run: the scratch checkout was not at the base commit'`. When any base-side run was refused this way, `scratch.moved: true` (absent otherwise).

- [ ] **Step 1: Write the failing tests**
  - `a base rerun in a scratch whose HEAD is not the base sha is never "fails at base" (#5150)` — outcomes `baseline:tests/a.test.js: 1`, `isolated:tests/a.test.js: 1` (the #3043 AC1 shape, baseline when the scratch is right) with `headOf` returning `'c'.repeat(40)` → `baselineFailing: []`, `attributable: ['tests/a.test.js']`, `verdict: 'fail'`, `scratch.moved === true`; control with the default `headOf` → `baselineFailing: ['tests/a.test.js']` and no `moved`.
  - `a scratch that moves while a base rerun runs is no evidence — the check after the run decides (#5150)` — `headOf` returns `baseSha` before and `'c'.repeat(40)` after → as above.
  - `a scratch not at the base sha when a base rerun starts is no evidence — the check before the run decides (#5150)` — `headOf` returns `'c'.repeat(40)` before and `baseSha` after → as above.
  - `a base full run in a moved scratch leaves fixed null with a named reason (#5150)` — per-file runs see `baseSha`, the `base-full` run sees `'c'.repeat(40)` → `fixed === null`, `fixedReason === 'tests base full run: the scratch checkout was not at the base commit'`.
  - `two adjudications on one slot path: the one whose checkout was replaced loses its base evidence and never passes (#5150)` — real git (Task 4's setup): adjudication A holds `{ index: 0, base: S }`; A's `runOne`, on its first `baseline` call, first runs `realGit(repo, { tmpdir }).addWorktree(sha2, { slot: 0, slotBase: S })` (B's leftover cleanup removing A's live checkout and re-adding it at another sha), then writes its usual failing log → A's `baselineFailing: []`, `verdict: 'fail'`, `scratch.moved === true`; the test removes B's worktree afterwards.
  - `realGit.headOf reads a worktree's HEAD and returns null for a missing directory (#5150)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task5.txt"`
Expected: FAIL after Step 1 — the moved-scratch tests still classify `tests/a.test.js` baseline, and `realGit(...).headOf` is not a function.

- [ ] **Step 3: Implement** `headOf`, one `runAtBase(args)` wrapper used by both base-side call sites, the `baseEv`/`fixed` handling and `scratch.moved`.

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS (the whole file).

- [ ] **Step 5: Mutation proof** — delete the before-run check → the "check before the run" test fails; delete the after-run check → the "check after the run" test fails; restore both.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js`, message `Count a base-side rerun as evidence only when its scratch checkout is at the base commit (#5150)`.

### Task 6: verify.js passes the declared values and names a forced-serial run

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/verify.js:206-220` (`defaultConcurrency`'s `none` gains `reruns: null, timeoutPatterns: []`), `:795-799` (one memoized concurrency read), `:974-991` (pass `concurrency`, `timeoutPatterns`), `:1489` (the stdout line)
- Test: `tests/bin-lib/verify/cli.test.js` — new tests beside the `#3043` `--baseline` block (`baselineRepo` :2774, `headCommit` :2894); the `AC5.1` #5119 test at :3606 takes a slot, so its env gains a private `TMPDIR`/`TMP`/`TEMP`

**Interfaces:**
- Consumes: Task 1's `decl.concurrency`, Task 3's options and `concurrency` result, Task 4's `scratch` result and `slotScratchPath`.
- Produces: stdout line, exact, printed right after `Baseline: adjudicated against …` only when `b.concurrency.reason` starts `timeout-evidence:` or `phase-timeout:`: `Baseline: reruns ran one at a time (declared reruns ${declared}) — ${reason}`.

The concurrency block is read once: `decl ? decl.concurrency : defaultConcurrency(cwd)`, memoized; it feeds both the slot count and adjudication. The slot count keeps its rule (a nested run never reads the default declaration for `suiteSlots`). Adjudication reads the block whether or not the run is nested — `reruns` describes the command, not the machine — and only when adjudication runs, so a run that never adjudicates prints nothing new on stderr, and an invalid default declaration still prints its one `concurrency ignored` line once per run.

- [ ] **Step 1: Write the failing tests** (`baselineRepo()` + `headCommit(r)`; the default declaration is written uncommitted to `.claude-tweaks/verify-scope.json` as `{ checks: { tests: 'npm test' }, rules: [{ match: '**', suites: '*', static: false }], concurrency: {...} }`; runs use `r.opts`, which is HELD=1; the fixture's one failing file fails identically at base, so no retry spawns and `used.retry` is `null`)
  - `AC1.1: with no declaration the adjudication reports default-serial and prints no back-off line (#5150)` — `report.baselineAdjudicated.concurrency` deep-equals `{ declared: null, used: { baseline: 1, isolated: 1, retry: null }, reason: 'default-serial' }`; stdout lacks `Baseline: reruns ran one at a time`.
  - `AC2.1: a declared concurrency.reruns reaches adjudicate() from the default declaration, nested run included (#5150)` — `concurrency: { reruns: 3 }` → `{ declared: 3, used: { baseline: 3, isolated: 3, retry: null }, reason: 'declared' }`.
  - `AC3.1: a declared timeoutPatterns match forces serial reruns and prints one line (#5150)` — `concurrency: { reruns: 4, timeoutPatterns: ['env-specific'] }` (the fixture's own failure text) → `reason: 'timeout-evidence: tests'`, `used: { baseline: 1, isolated: 1, retry: null }`; stdout carries exactly one `Baseline: reruns ran one at a time (declared reruns 4) — timeout-evidence: tests`.
  - `an invalid default declaration prints its concurrency ignored line once on a failing --baseline run (#5150)` — `concurrency: { reruns: 0 }`, slot-taking env (`slotEnv` plus a private `TMPDIR`/`TMP`/`TEMP`) → exactly one `verify.js: concurrency ignored — ` line on stderr, and `concurrency.reason === 'default-serial'`.
  - `AC7.1: a nested run takes no slot, so its scratch stays a fresh ct-verify-base-* path (#5150)` — `path.basename(path.dirname(report.baselineAdjudicated.scratch.path))` matches `/^ct-verify-base-/`; no `slot` field, no `scratch.fallback`.
  - In the existing `AC5.1` test (:3606): env `slotEnv(dir, { TMPDIR: t, TMP: t, TEMP: t })` with `t = tmpDir()`; assert `report.baselineAdjudicated.scratch` deep-equals `{ path: path.join(fs.realpathSync(t), path.relative(t, slotScratchPath({ tmpdir: t, commonDir: fs.realpathSync.native(path.join(r.repo, '.git')), slotBase: fs.realpathSync.native(dir), slot: 0 }))), reused: false }` (no `fallback`, no `moved`), and `fs.readdirSync(t)` has no `ct-verify-base-` entry.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task6.txt"`
Expected: FAIL after Step 1 — `concurrency.declared` is `null` where 3 is declared, and the back-off line is missing.

- [ ] **Step 3: Implement** the memoized read, the two new `adjudicate()` arguments, the widened `none`, and the stdout line.

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS (the whole file).

- [ ] **Step 5: Commit** — `git add plugin/bin/verify.js tests/bin-lib/verify/cli.test.js`, message `Pass concurrency.reruns and timeoutPatterns into baseline adjudication, and name a forced-serial run on stdout (#5150)`.

### Task 7: Skill docs — verification.md and suite-slots.md

**Role:** integration

**Files:**
- Modify: `plugin/skills/test/verification.md` — a new paragraph after the verdict list ending at :174 (`- **attributable** — …`), and the eligible `baselineAdjudicated` field list at :176. Bytes 44,074 of `RAIL_BYTES` 52,500 (8,426 headroom); budget ≤ 2,000 bytes, leaving ≥ 6,400.
- Modify: `plugin/skills/test/suite-slots.md:28` — the declaration paragraph (it says "`suiteSlots` is the only allowed key") becomes the three-key form, plus a short `## Baseline reruns` section. Bytes 7,604 (44,896 headroom).
- Test: `tests/bin-lib/verify/snippet-conformance.test.js` (already reads `verification.md` as `DOC`, :15)

Content each file must state (wording is the implementer's; each fact anchored on a phrase that occurs exactly once in its slice):
- verification.md, Baseline adjudication section: per-file reruns run one at a time in every phase unless the declaration's `concurrency.reruns` allows more (`suite-slots.md` has the block); what counts as timeout evidence (a timed-out check, an inconclusive marker or non-zero cancelled count in its failing region, a declared `timeoutPatterns` substring); evidence on a failing check forces every phase serial, and a rerun that times out forces the later phases serial; `used` records each phase's limit (`null` for a phase that spawned no rerun); the `reason` vocabulary `default-serial`, `declared`, `timeout-evidence: {check}`, `phase-timeout: {phase}`; the stdout line `Baseline: reruns ran one at a time (declared reruns {n}) — {reason}`, presented verbatim in Step 3; the scratch path `<os tmpdir>/ct-verify-base/<repo-key>/slot-<index>/wt` with `<repo-key>` the first 12 hex digits of the sha256 of the git common dir's realpath and the slot lock dir's realpath, used only by a run that took its own slot (a nested run keeps a fresh `ct-verify-base-*` path); a leftover there is this slot's own and is removed first (`scratch.reused`); a path that fails a guard falls back to a fresh path with one stderr line and names why in `scratch.fallback`; a base-side run whose scratch HEAD is not the base commit before and after it runs is no evidence (`scratch.moved`); the reuse contract — a resource the project derives from the checkout path is reused across adjudications at different base commits, so it must tolerate starting from another commit's state, as it already does in an ordinary worktree when HEAD moves. Field list: `concurrency: {declared, used: {baseline, isolated, retry}, reason}, scratch: {path, reused, fallback?, moved?}` added to the eligible shape.
- suite-slots.md: the block `{ "concurrency": { "suiteSlots": N, "reruns": N, "timeoutPatterns": ["…"] } }`; allowed keys `suiteSlots`, `reruns`, `timeoutPatterns`, the new messages (`(allowed: suiteSlots, reruns, timeoutPatterns)`, `concurrency.reruns: must be a positive integer`, `concurrency.timeoutPatterns: must be an array of non-empty strings`); `reruns` is per checkout (one run's reruns), not machine-wide like `suiteSlots`, and declaring it above 1 is the opt-in for a test command that tolerates several runs sharing one checkout; `timeoutPatterns` are literal substrings for the project's own runner wording; adjudication reads the block in a nested run too (the existing "a nested run … does not" clause narrows to the slot count); the version floor stated by property, no number: a reader that knows the `concurrency` block but predates these keys rejects the whole declaration over either one, so every machine and cloud sandbox running the project's `verify.js` must be on a release that documents them before the project commits either key.
- Neither file gains an indented `node ".../bin/verify.js" … --baseline` line (`extractBaselineSnippet` at :80-83 requires exactly one).

- [ ] **Step 1: Write the failing test** — `verification.md and suite-slots.md document serial reruns, the timeout back-off and the per-slot scratch path (#5150)`: two fact lists (one per file, the verification.md one sliced from `### Baseline adjudication` to `### Declared pre-existing failures` as the #3511 test at :149-153 does, suite-slots.md read with `readText`) through `missingFactsOf` → `[]`, plus `assertEachPatternGoesRed` over each. Facts include the literals `` `concurrency.reruns` ``, `` `timeoutPatterns` ``, `` `<os tmpdir>/ct-verify-base/<repo-key>/slot-<index>/wt` ``, `Baseline: reruns ran one at a time (declared reruns {n}) — {reason}`, `` `default-serial` ``, `` `timeout-evidence: {check}` ``, `` `phase-timeout: {phase}` ``, `used: {baseline, isolated, retry}`, `` `scratch.fallback` ``, `` `scratch.moved` ``, the reuse-contract sentence's anchor, and in suite-slots.md `(allowed: suiteSlots, reruns, timeoutPatterns)` and the version-floor sentence's anchor.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task7.txt"`
Expected: FAIL after Step 1 — every #5150 fact missing.

- [ ] **Step 3: Write the prose**, then `wc -c` both files and confirm verification.md stays ≤ 46,074 bytes.

- [ ] **Step 4: Run to verify, with every suite that reads these files**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task7-pins.txt"`
Expected: PASS — `tests/verify-scope-declaration.test.js` included (AC10.1: the committed declaration, unchanged, still parses with the latest release tag's reader).

- [ ] **Step 5: Commit** — `git add plugin/skills/test/verification.md plugin/skills/test/suite-slots.md tests/bin-lib/verify/snippet-conformance.test.js`, message `Document serial baseline reruns, the timeout back-off and the per-slot scratch path (#5150)`.

### Task 8: ADR 0031 and the maintainer docs

**Role:** integration

**Files:**
- Create: `docs/decisions/0031-baseline-reruns-run-serially-and-reuse-one-scratch-path-per-slot.md` (0030 is the highest today; `ls docs/decisions` first — if a sibling took 0031, use the next free number and say so in the commit)
- Modify: `docs/plugin-structure.md:58` — the `baseline.js (#3043 — …` and `declaration.js (#1922 — …` clauses each gain a #5150 clause (serial phases, back-off, `slotScratchPath` keyed on the lock dir, the base-sha check; the two keys), and the `slot.js (#5119 — …` clause names the hold's `base`
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` Step 11 — "The comparison" bullet (serial reruns, per-slot path, a base run outside the base commit is no evidence), "Interrupting the run" (a slot-holding run's leftover after an uncatchable kill is cleared by the next run on that slot; only `ct-verify-base-*` leftovers are named), and the red flag "A stale `ct-verify-base-*` worktree silently removed…" stays, joined by "a run that holds no slot of its own reusing a per-slot path" and "a file classified baseline from a base run whose scratch was not at the base commit"

Behavior-change prose sweep (`git grep -n -i -e "ct-verify-base" -e "scratch worktree" -e "only allowed key" -- plugin docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans'`, run at authoring): the hits above and Task 7's two files change; `docs/journeys/queue-verify-runs-behind-a-machine-wide-slot-5119.md:67,83`, `plugin/bin/lib/verify/slot.js:63`, `plugin/skills/test/suite-slots.md:55` and `.claude/skills/node-test-output-evidence/SKILL.md:43,76` stay true and do not change.

ADR content (format of `0030-*`: Status, Date, Context line, then `## Context`, `## Decision`, `## Alternatives considered`, `## Consequences`; it carries the six Step 2 phrases verbatim — `concurrency.reruns`, `teardown command`, `SIGKILL`, `signal handler`, `slots × repositories`, `once-only race`):
- Context: four per-file reruns sharing one checkout's path-derived test resource on a project with many parallel pipeline sessions on one machine and a shared test resource — two simultaneous resets on one resource, one blocked behind the other, producing timeouts that fed more adjudication; and every adjudication minting a new resource from its fresh path (175 of 191 such resources on that machine matched no live worktree).
- Decision 1: reruns run serially unless `concurrency.reruns` declares more, because whether two runs of a test command can share a checkout is a property of the command, and the declaration is where the command lives; timeout evidence forces serial whatever is declared.
- Decision 2: a stable per-slot path over a project-declared teardown command: #3064's removal runs only on catchable exits, so a teardown would be skipped by exactly the uncatchable kills that leak, and it would run project code inside a signal handler that races `process.exit`; the stable path bounds leftovers to slots × repositories (× lock dirs) even after a SIGKILL, and a project can reclaim them by name.
- Decision 3 (decided by the user at plan review): the path key folds in the slot lock dir, and a base-side run counts only when its scratch HEAD is the base sha before and after it runs.
- Alternatives: a policy key (drifts from the command it describes); keeping 4 with an opt-down; a path per base sha (unbounded across shas); a teardown hook (above); failing adjudication outright on a guard failure (rejected by the user at plan review in favour of a visible `scratch.fallback`).
- Consequences: this repo's own adjudications go serial (its declaration does not adopt `reruns`, pinned by the previous-release reader); the reuse contract; residual risk — the slot module's once-only race (two reclaimers of one dead lock) can still put two adjudications on one path once, and the second's leftover cleanup then removes the first's live checkout and re-adds it at its own base sha; the first adjudication's base-side runs fail the HEAD check (or find no checkout) and are no evidence, so the collision costs that run its evidence (`attributable`, `scratch.moved`), never a false pass; a guard failure leaks one fresh path per run again, visible as `scratch.fallback`; the slot path is about 13 characters longer than the `mkdtemp` one (a Windows path-length cost); the version floor (the release carrying #5150); revisit if a project needs per-checkout resources reset between base commits.

- [ ] **Step 1: Write the three files.**

- [ ] **Step 2: Verify the ADR states its decisions** (AC9.1)

Run: `grep -c -F -e "concurrency.reruns" -e "teardown command" -e "SIGKILL" -e "signal handler" -e "slots × repositories" -e "once-only race" docs/decisions/0031-baseline-reruns-run-serially-and-reuse-one-scratch-path-per-slot.md`
Expected: a count of at least 6 (the ADR carries each phrase verbatim, on separate lines), and `grep -c '^## ' {same file}` prints 4 (Context, Decision, Alternatives considered, Consequences). Controls, run at authoring: the same grep over `docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md` prints 0, and over a six-line probe holding each phrase once it prints 6.

Record it: write the command, its output and `AC9.1: the ADR exists and states both decisions with their reasoning` to `$PIPELINE_RUN_DIR/evidence/ac9-adr.txt` (`mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, plain Bash redirect), then `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{a scratchpad file holding one line: AC9.1, the grep, its counts, and the evidence path}"`.

- [ ] **Step 3: Commit** — `git add docs/decisions/0031-baseline-reruns-run-serially-and-reuse-one-scratch-path-per-slot.md docs/plugin-structure.md docs/journeys/run-a-deterministic-verification-check.md`, message `Record ADR 0031 — serial baseline reruns and one scratch path per slot (#5150)`.

---

## AC coverage

| AC | Task | Test |
|----|------|------|
| AC1.1 — no `reruns`: at most one call in flight per phase | 3, 6 | `AC1.1, AC1.2: with no reruns declared every phase runs one rerun at a time`; CLI `AC1.1: with no declaration … default-serial` |
| AC1.2 — peak per `cwd`, fails against today's 4 | 3 | same test (per-cwd peaks; Step 2 reads 4) |
| AC2.1 — `reruns: 3`, 6 files, peak 3 per phase | 3, 6 | `AC2.1: reruns 3 with 6 failing files peaks at 3`; CLI `AC2.1: a declared concurrency.reruns reaches adjudicate()` |
| AC3.1 — evidence + `reruns: 4`: peak 1 everywhere, reason names the check | 3, 6 | the four `AC3.1, AC3.2: … — <source>` tests; CLI `AC3.1: a declared timeoutPatterns match forces serial reruns` |
| AC3.2 — one test per evidence source | 2, 3 | `AC3.2: timeoutEvidence names …`; the four per-source adjudicate tests (`timedOut` synthetic — see Spec premises) |
| AC4.1 — base rerun times out: later phases peak 1, `phase-timeout: baseline` | 3 | `AC4.1: a timed-out base rerun runs the isolated and retry phases serially` (`used: { baseline: 4, isolated: 1, retry: 1 }`) |
| AC5.1 — two sequential adjudications on slot 0, two shas: same path, no new `ct-verify-base-*` | 4, 6 | `AC5.1: two sequential adjudications holding slot 0 …`; CLI `AC5.1` (#5119 test) scratch assertion |
| AC6.1 — registered leftover removed first, completes, `reused` true | 4 | `AC6.1: a leftover worktree registered at the slot path …`; `RF3` |
| AC7.1 — no slot: fresh `ct-verify-base-*` path | 4, 6 | `AC7.1: an adjudication with no slot keeps a fresh ct-verify-base-* path`; CLI `AC7.1: a nested run takes no slot …` |
| AC8.1 — `reruns` positive integer, `timeoutPatterns` array of non-empty strings | 1 | `AC8.1: reruns: 3 and timeoutPatterns: ["deadline"] parse` |
| AC8.2 — anything else fails; allowed-key list names both | 1 | `AC8.2: other reruns and timeoutPatterns values …`; `AC8.2: CONCURRENCY_KEYS names …` |
| AC9.1 — ADR states both decisions with reasoning | 8 | Step 2 grep + `AC evidence` decisions.md entry |
| AC10.1 — committed declaration readable by the latest release's reader | 7 | `tests/verify-scope-declaration.test.js` `AC2.1: the committed verify-scope.json parses with the latest release tag's declaration reader (#4135)`, run in Task 7 Step 4; the file is untouched by every task |
| Clarification 1 — lock dir in the key; base-sha check, no false pass | 4, 5 | `two holders of slot 0 from different lock dirs never share a path`; `two adjudications on one slot path: the one whose checkout was replaced …` and the before/after HEAD-check tests |
| Clarification 2 — `scratch.fallback` on a guard failure | 4 | `RF1`, `RF2`, `RF2b`, `a slot with no lock dir falls back …` |
| Clarification 3 — per-phase `used` | 3, 6 | `AC4.1`, `a phase that spawns no rerun reports used null`, CLI `AC1.1`/`AC2.1`/`AC3.1` |
