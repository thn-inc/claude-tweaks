# Baseline Rerun Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--baseline` adjudication reruns failing files one at a time unless `concurrency.reruns` declares more, never fans out on timeout evidence, and checks the base out at one stable path per held slot instead of a fresh `mkdtemp` path per run.

**Architecture:** `declaration.js` accepts two more `concurrency` keys; `extract.js` exports one `timeoutEvidence` helper built on its own `INCONCLUSIVE_RE` and `cancelledCount`; `adjudicate()` computes one phase limit, lowers it to 1 on check-level evidence and again after any phase whose reruns timed out, and reports `concurrency`/`scratch`; `realGit().addWorktree(sha, { slot })` builds `<tmpdir>/ct-verify-base/<repo-key>/slot-<index>/wt`, clears this slot's own leftover first, and falls back to today's `mkdtemp` path whenever a guard fails. `verify.js` passes the declared values and prints one line when timeout evidence forced serial reruns.

**Tech Stack:** Node 18+ CommonJS, `node:test`, `node:crypto` (sha256), no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-11T053439-spec-5150/work/5150-spec.md` (worktree copy)

**Scope keywords:** adjudicate, realGit, addWorktree, removeWorktree, findStaleBaselineWorktrees, slotScratchPath, timeoutEvidence, INCONCLUSIVE_RE, cancelledCount, CONCURRENCY_KEYS, readDeclaration, defaultConcurrency, baselineAdjudicated, ct-verify-base, suiteSlots, reruns, timeoutPatterns

## Global Constraints

- Shipped code stays stack-agnostic: no database-, test-runner- or language-specific behavior in `plugin/**`, and no runner timeout wording beyond what `INCONCLUSIVE_RE` (`extract.js:262`) already carries; a project supplies its own through `timeoutPatterns`. The consumer evidence in the spec is a motivating example only: never name or describe the consumer project in code, comments, commits or docs beyond "a project with many parallel pipeline sessions on one machine and a shared test resource".
- Run tests only through `tools/run-tests.js` (it holds the machine-wide slot), never a bare `node --test`, never the full suite inside a task. A positional argument to `run-tests.js` is a directory root (a file path throws `ENOTDIR`), so a targeted run is `node tools/run-tests.js --files-from {list}`. The list files below already exist, one repo-relative path per line, under `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/` (written as `$L/` below; spell the full path in every command).
- No policy key. `reruns` and `timeoutPatterns` live in the `verify-scope.json` `concurrency` block, which stays strict: an unknown key is still a validation error.
- Version floor: the first release whose `declaration.js` accepts `reruns`/`timeoutPatterns` is the release carrying #5150 (the next release after 6.164.0; release-please assigns the number). Never hard-code a version number in code or docs. This repo's committed `.claude-tweaks/verify-scope.json` must not adopt either key in this PR.
- `timeoutPatterns` entries are literal substrings matched with `String.prototype.includes` on ANSI-stripped text, never regexes.
- The stable scratch path is derived only from a slot index this process took (`takeSlot()`'s return, or an explicit `slot` argument). Never from an inherited env var: `verify.js`'s `holdFor` returns null under `CT_TEST_SUITE_SLOT_HELD=1`, so a nested run keeps the `mkdtemp` path.
- Source-scan suites over `plugin/bin/`: no new `existsSync`/`realpathSync` tokens in `baseline.js` (its `tests/path-guard-conformance.test.js:148` allowlist entry pins `realpathSync: 1, existsSync: 3`; use `lstatType`, `canonicalRealpath`, `resolveWithin` from `plugin/bin/lib/path-guard`), no hand-rolled `startsWith(root + path.sep)` containment (`tests/path-containment-conformance.test.js`), and every git spawn goes through `realGit`'s existing `git()` helper (`windowsHide: true`, `tests/windows-hide-spawn-conformance.test.js`).
- Governing skill `verify-scope-rule-kind` (verbatim): "**The committed declaration stays readable by the previous release.** The installed plugin build reads this repo's committed `.claude-tweaks/verify-scope.json` with older code. … Since #4135 `tests/verify-scope-declaration.test.js` runs that check itself" and its Anti-Patterns row: "Adding a key inside an existing block (`impact`, `ci`, `concurrency`) because a new top-level block needed no compatibility value | `readDeclaration` has no unknown-key check at the top level, so an older reader ignores a new block (#4347's `ci`, #5119's `concurrency`). Each block checks its own keys (`IMPACT_KEYS`, `CI_KEYS`, `CONCURRENCY_KEYS`), so a release that knows the block rejects the committed file over one new key inside it". Item 1's other sites: `scope.js` (unchanged — no selection effect), `plugin/bin/lib/init/verify-scope-starter.js` (unchanged — `/init` does not offer `reruns`: declaring it opts a project out of the serial default, which only the project can judge), the Re-verify scoping table (unchanged).
- Governing skill `suite-slot-test-env` (verbatim): "Build the child env with `slotEnv(dir, extra)` from `tests/helpers/suite-slot-env.js`." / "A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env`" / "A test that waits on a slot-holding child bounds it with the spawn's own `timeout` … Never assert a wall-clock budget to catch a hang". A slot-holding `verify.js` child now writes its scratch under `os.tmpdir()`, so such a child also gets a private `TMPDIR`/`TMP`/`TEMP` (the AC3.1 test at `cli.test.js` already passes one to a `run-tests.js` child).
- Governing skill `node-test-output-evidence` (verbatim): "Diagnostics follow the same scoping: `conclusiveOnly` tests `INCONCLUSIVE_RE` only against the block's own top-level key lines (`keys`), so a quoted child timeout cannot make its parent inconclusive." `timeoutEvidence` deliberately reads the whole failing region instead: its only effect is to run reruns serially, so a quoted child timeout over-matching costs speed, never a verdict. Say so in its header comment.
- Governing skill `skill-prose-conformance-tests` (verbatim): "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** … `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) is the home of both" and "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`".
- Governing skill `windows-checkout-test-parity` (verbatim): "Build the expected value with `path.resolve`/`path.join` when the code under test resolves or joins the path". Symlink-fixture tests skip on win32.

## Review Focus

- A shared or multi-user tmpdir where `<tmpdir>/ct-verify-base` is a symlink or another user's directory: nothing is ever removed through it, the run falls back to a fresh `ct-verify-base-*` path with one stderr line, and adjudication still completes — Task 4 test "RF1".
- A slot path whose `wt` entry is a symlink or a file rather than a directory: never followed or removed; same fallback — Task 4 test "RF2".
- A leftover worktree still registered at the slot path whose directory a tmp cleaner already deleted: `git worktree add` would refuse it ("missing but already registered"), so it is pruned first and `reused` is true — Task 4 test "RF3".
- A rerun that exits non-zero with a per-test timeout in its own log (not a process timeout): later phases still go serial (`phase-timeout: {phase}`) — Task 3 test "RF4".
- `timeoutPatterns` holding regex metacharacters, or a log whose timeout wording is wrapped in ANSI color codes: matched literally after stripping — Task 2 test "RF5".

---

## Spec premises checked at HEAD

- **False:** "One test per evidence source: `timedOut`" assumes a failing check can carry `timedOut` into the phases. `run.js:212-215` sets `exitCode: null` with `timedOut: true`, and `adjudicate()` refuses any check without a numeric exit at `baseline.js:333` before a rerun exists. The check-level `timedOut` source is kept in the predicate (cheap, and the spec lists it), its AC3.2 test uses a synthetic `{ exitCode: 1, timedOut: true }` check, and the same test asserts the real shape (`exitCode: null`) is refused with zero `runOne` calls.
- **Stale:** the spec says "verify.js passes that index to `adjudicate()` as `slot`". At HEAD verify.js passes only `takeSlot` (`verify.js:974-991`); `adjudicate()` sets `slot` from `takeSlot()`'s return (`baseline.js:434-437`). That is already the own-index-only route the Gotchas require, so this plan keeps it and passes no `slot`.
- **Re-located (#5119 moved them):** `adjudicate` signature `baseline.js:312-321` (`concurrency = 4` at :314), phase pools :457 / :484 / :565, signal handlers :451-452, `addWorktree` :108-119, `removeWorktree` :123-130, `findStaleBaselineWorktrees` :147 (called at `verify.js:488`), `defaultConcurrency` `verify.js:206-220`, the adjudication call `verify.js:974-991`, the `Baseline:` stdout block `verify.js:1486-1515`.
- **No change needed:** `report.js` copies `baselineAdjudicated` verbatim (`report.js:134`), so the new fields reach `report.json` from `adjudicate()`'s return alone.

## Plan decisions beyond the spec

- `adjudicate()`'s `concurrency` default becomes `null` (undeclared → 1, `default-serial`) and verify.js passes the declared value or `null`, not `?? 1`: the report must tell an undeclared limit from a declared `1`.
- A rerun's own log carrying timeout evidence counts as that phase timing out, not only a process timeout (`timedOut`) — RF4. Its only effect is serial later phases.
- Any stable-path guard failure (unusable `ct-verify-base` root, a non-directory leftover, an unresolvable common dir) falls back to today's `mkdtemp` path with one stderr line instead of failing the adjudication: a multi-user host whose `/tmp/ct-verify-base` belongs to another user would otherwise lose adjudication outright.
- `addWorktree` returns `{ dir, reused }` instead of a bare path (one producer, one consumer; the three test fakes update with it).

Waived plugin/bin/lib/verify/report.js: pass-through at `report.js:134`; Task 5's CLI tests read the new fields from `report.json`.
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

**Files:**
- Modify: `plugin/bin/lib/verify/extract.js:45-90` (factor the region), `:262` (`INCONCLUSIVE_RE` stays here), `:777-782` (export)
- Test: `tests/bin-lib/verify/extract.test.js`

**Interfaces:**
- Produces: `timeoutEvidence(text: string, family: string, patterns: string[] = []) → 'cancelled' | 'inconclusive-marker' | 'timeout-pattern' | null`, checked in that order on `stripAnsi(text)`: `cancelledCount(text, family) > 0`; any line of the **uncapped** failing region matching `INCONCLUSIVE_RE`; any `patterns` entry contained in the stripped text.

- [ ] **Step 1: Write the failing tests**
  - `AC3.2: timeoutEvidence names a cancelled count, an inconclusive marker and a declared pattern, each alone (#5150)` — `'ℹ tests 2\nℹ cancelled 1'` (spec) and `'# tests 2\n# cancelled 3'` (tap) → `'cancelled'`; a spec log whose `✖ failing tests:` entry body has `  test timed out after 100ms` → `'inconclusive-marker'`; a tap `not ok` block whose YAML has `failureType: 'testTimeoutFailure'` → `'inconclusive-marker'`; a spec log with `ran past its deadline` in an entry body and `patterns: ['ran past its deadline']` → `'timeout-pattern'`; the same three logs with the trigger removed (or `patterns: []`) → `null`; `ℹ cancelled 0` → `null`.
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
- Produces: `adjudicate({ …, concurrency = null, timeoutPatterns = [] })`. `concurrency` is `null` (undeclared) or a positive integer. Eligible results gain `concurrency: { declared: number|null, used: number, reason: string }`; `used` is the limit the last phase ran under; `reason` is `default-serial`, `declared`, `timeout-evidence: {check}` or `phase-timeout: baseline|isolated`. Ineligible results are unchanged.

Resolution (the algorithm the tests pin):

```
limit, reason = concurrency == null ? (1, 'default-serial') : (concurrency, 'declared')
if limit > 1 and evidenceCheck: limit, reason = 1, `timeout-evidence: ${evidenceCheck}`
baseRuns  = pool(work, limit, …)
if limit > 1 and baseRuns.some(timedOutRun): limit, reason = 1, 'phase-timeout: baseline'
headRuns  = pool(work, limit, …)
if limit > 1 and headRuns.some(timedOutRun): limit, reason = 1, 'phase-timeout: isolated'
retryRuns = pool(work, limit, …)
```

`evidenceCheck` is the first accepted failing check where `c.timedOut || timeoutEvidence(text, family, timeoutPatterns) !== null` (`text` is the `readLog` already read at :336). `timedOutRun(r)` is `r && (r.timedOut || timeoutEvidence(log, sniffFamily(log), timeoutPatterns) !== null)` over the rerun's own `readLog(r.logPath)` — the RF4 case; a null log is not evidence.

- [ ] **Step 1: Write the failing tests** — a `peakFakes(opts)` helper wraps `fakes(opts)`'s `runOne`: classify each call by the same kind rule `fakes` uses, hold it for `setTimeout(5)`, and record the peak in-flight count per kind (`baseline`, `isolated`, `isolated-retry`) and per `cwd`. `SIX` is `tests/a.test.js` … `tests/f.test.js`; `allPhases` is outcomes `baseline:{f}: 0`, `isolated:{f}: 1`, `isolated-retry:{f}: 1` for each (a base pass plus an isolated failure sends every file through all three phases).
  - `AC1.1, AC1.2: with no reruns declared every phase runs one rerun at a time (#5150)` — no `concurrency` argument; peaks `{ baseline: 1, isolated: 1, 'isolated-retry': 1 }` and per cwd `{ '/scratch': 1, '/repo': 1 }`; `r.concurrency` deep-equals `{ declared: null, used: 1, reason: 'default-serial' }`. Against HEAD's default of 4 the peaks read 4.
  - `AC2.1: reruns 3 with 6 failing files peaks at 3 in each phase (#5150)` — `concurrency: 3`; peaks all 3; `{ declared: 3, used: 3, reason: 'declared' }`.
  - `AC3.1, AC3.2: timeout evidence on a failing check runs every phase serially — <source> (#5150)`, one test per source, each `concurrency: 4`, expecting peaks all 1 and `reason: 'timeout-evidence: tests'`:
    - `timedOut` — check `{ name: 'tests', exitCode: 1, timedOut: true, logPath }`; the same test then runs check `{ exitCode: null, timedOut: true }` and asserts `eligible: false` and zero `runOne` calls (the real `run.js` shape — see Spec premises).
    - inconclusive marker — `SIX`'s log with `  test timed out after 100ms` in `tests/a.test.js`'s entry body.
    - cancelled count — a log with six entries, `ℹ fail 5`, `ℹ cancelled 1` (still eligible: entries = fail + cancelled).
    - declared pattern — an entry body line `\u001b[31mran past its deadline\u001b[39m` with `timeoutPatterns: ['ran past its deadline']`; its control (same log, `timeoutPatterns: []`) peaks at 4 with `reason: 'declared'`, so only the pattern decides.
  - `AC4.1: a timed-out base rerun runs the isolated and retry phases serially (#5150)` — `concurrency: 4`, `allPhases` with `baseline:tests/a.test.js: { exitCode: null, timedOut: true }`; peaks `{ baseline: 4, isolated: 1, 'isolated-retry': 1 }`; `{ declared: 4, used: 1, reason: 'phase-timeout: baseline' }`.
  - `a timed-out isolated rerun runs the retry phase serially (#5150)` — `isolated:tests/a.test.js` timed out; peaks `{ baseline: 4, isolated: 4, 'isolated-retry': 1 }`; `reason: 'phase-timeout: isolated'`.
  - `RF4: a base rerun failing on a per-test timeout in its own log backs off like a process timeout (#5150)` — `baseline:tests/a.test.js: 1` with `logs` giving it a spec log carrying `test timed out after 100ms`; isolated and retry peaks 1; `reason: 'phase-timeout: baseline'`.
  - `undeclared reruns stays default-serial even with timeout evidence (#5150)` — no `concurrency`, the inconclusive-marker log; `reason: 'default-serial'` (evidence names itself only when it lowered a declared limit, which is what verify.js's stdout line keys on).

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task3.txt"`
Expected: FAIL after Step 1 — AC1.1 peaks read 4; `r.concurrency` is undefined.

- [ ] **Step 3: Implement** the options, the evidence capture in the checks loop, the resolution above and the result field. Replace the `concurrency = 4` default with `null` and document both new options in the signature's comment block (like `slot`/`takeSlot` at :316-320).

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS (the whole file, existing tests included).

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js`, message `Run baseline reruns one at a time unless declared, and back off on timeout evidence (#5150)`.

### Task 4: One stable scratch path per held slot

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js:21-30` (requires: `crypto`, `../path-guard`, `ensureOwnDir` from `../suite-slot`), `:33` (`realGit` options), `:108-130` (`addWorktree`/`removeWorktree`), `:454` (pass `{ slot }`, read `{ dir, reused }`), `:637-653` (result), `:660` (export `slotScratchPath`)
- Test: `tests/bin-lib/verify/baseline.test.js` — the fake `addWorktree`s at :45, :158 and :537 return `{ dir, reused: false }` instead of a bare path (:116's spy passes the return through unchanged)

**Interfaces:**
- Produces:
  - `slotScratchPath({ tmpdir, commonDir, slot }) → string` — `path.join(tmpdir, 'ct-verify-base', sha256(commonDir).hex.slice(0, 12), \`slot-${slot}\`, 'wt')`; pure, exported.
  - `realGit(cwd, { warn, rmSync, tmpdir = os.tmpdir() })` — the `mkdtemp` path uses `tmpdir` too.
  - `addWorktree(sha, { slot = null } = {}) → { dir: string, reused: boolean }`.
  - `removeWorktree(dir)` — removes `path.dirname(dir)` only when its basename starts `ct-verify-base-` (today's `mkdtemp` parent), else only `dir`, so `slot-<index>/` stays.
  - Eligible `adjudicate()` results gain `scratch: { path: string|null, reused: boolean }` (`path` is the realpath'd scratch, `null` when no file existed at base).

`addWorktree` with a slot, in order — any failed guard warns once and returns the `mkdtemp` path with `reused: false`, never throws and never removes anything:
1. `commonDir` = `canonicalRealpath(path.resolve(cwd, git(['rev-parse', '--git-common-dir'])))` (the `impact.js:173-175` resolution plus the realpath); `null` → fallback.
2. `root = path.join(tmpdir, 'ct-verify-base')`; `ensureOwnDir(root)` (creates it 0700; refuses a symlink, a non-directory or another user's directory) → fallback on throw.
3. `dir = slotScratchPath(…)`; `mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 })`.
4. Leftover = a worktree from `listWorktrees()` naming `dir` (compare canonical paths; for a registered path whose directory is gone, canonicalize its parent and rejoin the basename), or `lstatType(dir).type !== 'missing'`. When the leftover exists on disk it must be a `directory` that `resolveWithin(dir, root)` places under `root`; otherwise fallback (RF2).
5. Leftover → `git worktree remove --force dir` (best effort), `rmSync(dir, { recursive: true, force: true })`, `git worktree prune`; `reused = true`.
6. `git worktree add --detach dir sha`; on a throw remove `dir` only (best effort) and rethrow, as today's path does for its parent.

Fallback line, exact: `verify.js: baseline scratch: the per-slot path is unavailable ({why}) — using a fresh ct-verify-base-* path for this run\n`.

- [ ] **Step 1: Write the failing tests** (real git repos under a fresh temp `tmpdir` passed to `realGit`; adjudications use `fakes()`'s `runOne` with `git: realGit(repo, { tmpdir })` and `takeSlot: () => 0`)
  - `slotScratchPath joins tmpdir, a 12-hex repo key, slot-<index> and wt (#5150)` — expected built with `path.join` and `crypto.createHash('sha256')`.
  - `AC5.1: two sequential adjudications holding slot 0 at two base shas use the same scratch path, and the tmpdir gains no ct-verify-base-* entry (#5150)` — a repo with `tests/a.test.js` and two commits; both results `eligible: true` with equal `scratch.path`, both `reused: false`; `fs.readdirSync(tmpdir)` deep-equals `['ct-verify-base']`; `slot-0/` exists and is empty afterwards; `git worktree list --porcelain` names only the main checkout.
  - `AC6.1: a leftover worktree registered at the slot path is removed before git worktree add, the adjudication completes, and scratch.reused is true (#5150)` — pre-create it with `git worktree add --detach {slotScratchPath(…)} {sha}` plus an untracked file inside; result `eligible: true`, `scratch.reused === true`; only the main checkout registered afterwards.
  - `RF3: a registered slot worktree whose directory is gone is pruned and reused (#5150)` — register it, then `fs.rmSync` its directory; `addWorktree(sha, { slot: 0 })` succeeds with `{ dir: slotScratchPath(…), reused: true }`.
  - `AC7.1: an adjudication with no slot keeps a fresh ct-verify-base-* path (#5150)` — no `takeSlot`; `path.basename(path.dirname(r.scratch.path))` matches `/^ct-verify-base-/`, `reused: false`; and with the fake git, `addWorktree` received `{ slot: null }` (and `{ slot: 0 }` when `takeSlot` returns 0).
  - `RF1: a ct-verify-base root that is a symlink is never removed through — fresh path, one warning (#5150)` (skip on win32) — `tmpdir/ct-verify-base` symlinked to another temp dir holding a file; `addWorktree(sha, { slot: 0 })` returns a `ct-verify-base-*` path, `warn` was called once with the exact fallback prefix, the target's file still exists.
  - `RF2: a wt entry that is a symlink is never followed — fresh path, one warning (#5150)` (skip on win32) — `slot-0/wt` symlinked to an outside dir holding a file; same assertions.
  - `removeWorktree on a slot path removes wt and keeps slot-<index> (#5150)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task4.txt"`
Expected: FAIL after Step 1 — `slotScratchPath is not a function`.

- [ ] **Step 3: Implement** the interfaces and steps above. The signal handlers at `baseline.js:451-452` stay unchanged. `findStaleBaselineWorktrees` stays unchanged: a slot path's parent is `slot-<index>`, so it is never named — its leftover is this slot's to clear on the next run.

- [ ] **Step 4: Run to verify they pass, scans included**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task4-scans.txt"`
Expected: PASS — including `tests/path-guard-conformance.test.js` with `baseline.js` still at `realpathSync: 1, existsSync: 3`.

- [ ] **Step 5: Mutation proof** — delete step 5's `git worktree prune` and rerun the Step 2 command: RF3 must fail; delete step 4's `resolveWithin` guard: RF2 must fail; restore both.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js`, message `Check the baseline out at one stable path per held slot — a killed run's leftover is cleared by the next run on that slot (#5150)`.

### Task 5: verify.js passes the declared values and names a forced-serial run

**Role:** integration

**Files:**
- Modify: `plugin/bin/verify.js:206-220` (`defaultConcurrency`'s `none` gains `reruns: null, timeoutPatterns: []`), `:795-799` (one memoized concurrency read), `:974-991` (pass `concurrency`, `timeoutPatterns`), `:1489` (the stdout line)
- Test: `tests/bin-lib/verify/cli.test.js` — new tests beside the `#3043` `--baseline` block (`baselineRepo` :2774, `headCommit` :2894); the `AC5.1` #5119 test at :3606 takes a slot, so its env gains a private `TMPDIR`/`TMP`/`TEMP`

**Interfaces:**
- Consumes: Task 1's `decl.concurrency`, Task 3's options and `concurrency` result, Task 4's `scratch` result and `slotScratchPath`.
- Produces: stdout line, exact, printed right after `Baseline: adjudicated against …` only when `b.concurrency.reason` starts `timeout-evidence:` or `phase-timeout:`: `Baseline: reruns ran one at a time (declared reruns ${declared}) — ${reason}`.

The concurrency block is read once: `decl ? decl.concurrency : defaultConcurrency(cwd)`, memoized. The slot count keeps its rule (a nested run never reads the default declaration for `suiteSlots`). Adjudication reads the block whether or not the run is nested — `reruns` describes the command, not the machine — and only when adjudication runs, so a run that never adjudicates prints nothing new on stderr.

- [ ] **Step 1: Write the failing tests** (`baselineRepo()` + `headCommit(r)`; the default declaration is written uncommitted to `.claude-tweaks/verify-scope.json` as `{ checks: { tests: 'npm test' }, rules: [{ match: '**', suites: '*', static: false }], concurrency: {...} }`; runs use `r.opts`, which is HELD=1)
  - `AC1.1: with no declaration the adjudication reports default-serial and prints no back-off line (#5150)` — `report.baselineAdjudicated.concurrency` deep-equals `{ declared: null, used: 1, reason: 'default-serial' }`; stdout lacks `Baseline: reruns ran one at a time`.
  - `AC2.1: a declared concurrency.reruns reaches adjudicate() from the default declaration, nested run included (#5150)` — `concurrency: { reruns: 3 }` → `{ declared: 3, used: 3, reason: 'declared' }`.
  - `AC3.1: a declared timeoutPatterns match forces serial reruns and prints one line (#5150)` — `concurrency: { reruns: 4, timeoutPatterns: ['env-specific'] }` (the fixture's own failure text) → `reason: 'timeout-evidence: tests'`, `used: 1`; stdout carries exactly one `Baseline: reruns ran one at a time (declared reruns 4) — timeout-evidence: tests`.
  - `AC7.1: a nested run takes no slot, so its scratch stays a fresh ct-verify-base-* path (#5150)` — `path.basename(path.dirname(report.baselineAdjudicated.scratch.path))` matches `/^ct-verify-base-/`; no `slot` field.
  - In the existing `AC5.1` test (:3606): env `slotEnv(dir, { TMPDIR: t, TMP: t, TEMP: t })` with `t = tmpDir()`; assert `report.baselineAdjudicated.scratch` deep-equals `{ path: path.join(fs.realpathSync(t), 'ct-verify-base', key, 'slot-0', 'wt'), reused: false }` where `key` is `path.basename(path.dirname(path.dirname(slotScratchPath({ tmpdir: t, commonDir: fs.realpathSync.native(path.join(r.repo, '.git')), slot: 0 }))))`, and `fs.readdirSync(t)` has no `ct-verify-base-` entry.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task5.txt"`
Expected: FAIL after Step 1 — `concurrency.declared` is `null` where 3 is declared, and the back-off line is missing.

- [ ] **Step 3: Implement** the memoized read, the two new `adjudicate()` arguments, the widened `none`, and the stdout line.

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS (the whole file).

- [ ] **Step 5: Commit** — `git add plugin/bin/verify.js tests/bin-lib/verify/cli.test.js`, message `Pass concurrency.reruns and timeoutPatterns into baseline adjudication, and name a forced-serial run on stdout (#5150)`.

### Task 6: Skill docs — verification.md and suite-slots.md

**Role:** integration

**Files:**
- Modify: `plugin/skills/test/verification.md` — a new paragraph after the verdict list ending at :174 (`- **attributable** — …`), and the eligible `baselineAdjudicated` field list at :176. Bytes 44,074 of `RAIL_BYTES` 52,500 (8,426 headroom); budget ≤ 1,800 bytes, leaving ≥ 6,600.
- Modify: `plugin/skills/test/suite-slots.md:28` — the declaration paragraph (it says "`suiteSlots` is the only allowed key") becomes the three-key form, plus a short `## Baseline reruns` section. Bytes 7,604 (44,896 headroom).
- Test: `tests/bin-lib/verify/snippet-conformance.test.js` (already reads `verification.md` as `DOC`, :15)

Content each file must state (wording is the implementer's; each fact anchored on a phrase that occurs exactly once in its slice):
- verification.md, Baseline adjudication section: per-file reruns run one at a time in every phase unless the declaration's `concurrency.reruns` allows more (`suite-slots.md` has the block); what counts as timeout evidence (a timed-out check, an inconclusive marker or non-zero cancelled count in its failing region, a declared `timeoutPatterns` substring); evidence on a failing check forces every phase serial, and a rerun that times out forces the later phases serial; the `reason` vocabulary `default-serial`, `declared`, `timeout-evidence: {check}`, `phase-timeout: {phase}`; the stdout line `Baseline: reruns ran one at a time (declared reruns {n}) — {reason}`, presented verbatim in Step 3; the scratch path `<os tmpdir>/ct-verify-base/<repo-key>/slot-<index>/wt` with `<repo-key>` the first 12 hex digits of the sha256 of the git common dir's realpath, used only by a run that took its own slot (a nested run keeps a fresh `ct-verify-base-*` path); a leftover there is this slot's own and is removed first (`scratch.reused`); a path that fails a guard falls back to a fresh path with one stderr line; the reuse contract — a resource the project derives from the checkout path is reused across adjudications at different base commits, so it must tolerate starting from another commit's state, as it already does in an ordinary worktree when HEAD moves. Field list: `concurrency: {declared, used, reason}, scratch: {path, reused}` added to the eligible shape.
- suite-slots.md: the block `{ "concurrency": { "suiteSlots": N, "reruns": N, "timeoutPatterns": ["…"] } }`; allowed keys `suiteSlots`, `reruns`, `timeoutPatterns`, the new messages (`(allowed: suiteSlots, reruns, timeoutPatterns)`, `concurrency.reruns: must be a positive integer`, `concurrency.timeoutPatterns: must be an array of non-empty strings`); `reruns` is per checkout (one run's reruns), not machine-wide like `suiteSlots`, and declaring it above 1 is the opt-in for a test command that tolerates several runs sharing one checkout; `timeoutPatterns` are literal substrings for the project's own runner wording; adjudication reads the block in a nested run too (the existing "a nested run … does not" clause narrows to the slot count); the version floor stated by property, no number: a reader that knows the `concurrency` block but predates these keys rejects the whole declaration over either one, so every machine and cloud sandbox running the project's `verify.js` must be on a release that documents them before the project commits either key.
- Neither file gains an indented `node ".../bin/verify.js" … --baseline` line (`extractBaselineSnippet` at :80-83 requires exactly one).

- [ ] **Step 1: Write the failing test** — `verification.md and suite-slots.md document serial reruns, the timeout back-off and the per-slot scratch path (#5150)`: two fact lists (one per file, the verification.md one sliced from `### Baseline adjudication` to `### Declared pre-existing failures` as the #3511 test at :149-153 does, suite-slots.md read with `readText`) through `missingFactsOf` → `[]`, plus `assertEachPatternGoesRed` over each. Facts include the literals `` `concurrency.reruns` ``, `` `timeoutPatterns` ``, `` `<os tmpdir>/ct-verify-base/<repo-key>/slot-<index>/wt` ``, `Baseline: reruns ran one at a time (declared reruns {n}) — {reason}`, `` `default-serial` ``, `` `timeout-evidence: {check}` ``, `` `phase-timeout: {phase}` ``, `concurrency: {declared, used, reason}`, `scratch: {path, reused}`, the reuse-contract sentence's anchor, and in suite-slots.md `(allowed: suiteSlots, reruns, timeoutPatterns)` and the version-floor sentence's anchor.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task6.txt"`
Expected: FAIL after Step 1 — every #5150 fact missing.

- [ ] **Step 3: Write the prose**, then `wc -c` both files and confirm verification.md stays ≤ 45,874 bytes.

- [ ] **Step 4: Run to verify, with every suite that reads these files**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/5150-task6-pins.txt"`
Expected: PASS — `tests/verify-scope-declaration.test.js` included (AC10.1: the committed declaration, unchanged, still parses with the latest release tag's reader).

- [ ] **Step 5: Commit** — `git add plugin/skills/test/verification.md plugin/skills/test/suite-slots.md tests/bin-lib/verify/snippet-conformance.test.js`, message `Document serial baseline reruns, the timeout back-off and the per-slot scratch path (#5150)`.

### Task 7: ADR 0031 and the maintainer docs

**Role:** integration

**Files:**
- Create: `docs/decisions/0031-baseline-reruns-run-serially-and-reuse-one-scratch-path-per-slot.md` (0030 is the highest today; `ls docs/decisions` first — if a sibling took 0031, use the next free number and say so in the commit)
- Modify: `docs/plugin-structure.md:58` — the `baseline.js (#3043 — …` and `declaration.js (#1922 — …` clauses each gain a #5150 clause (serial phases, back-off, `slotScratchPath`; the two keys)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` Step 11 — "The comparison" bullet (serial reruns, per-slot path), "Interrupting the run" (a slot-holding run's leftover after an uncatchable kill is cleared by the next run on that slot; only `ct-verify-base-*` leftovers are named), and the red flag "A stale `ct-verify-base-*` worktree silently removed…" stays, joined by "a run that holds no slot of its own reusing a per-slot path"

Behavior-change prose sweep (`git grep -n -i -e "ct-verify-base" -e "scratch worktree" -e "only allowed key" -- plugin docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans'`, run at authoring): the hits above and Task 6's two files change; `docs/journeys/queue-verify-runs-behind-a-machine-wide-slot-5119.md:67,83`, `plugin/bin/lib/verify/slot.js:63`, `plugin/skills/test/suite-slots.md:55` and `.claude/skills/node-test-output-evidence/SKILL.md:43,76` stay true and do not change.

ADR content (format of `0030-*`: Status, Date, Context line, then `## Context`, `## Decision`, `## Alternatives considered`, `## Consequences`; it carries the six Step 2 phrases verbatim — `concurrency.reruns`, `teardown command`, `SIGKILL`, `signal handler`, `slots × repositories`, `once-only race`):
- Context: four per-file reruns sharing one checkout's path-derived test resource on a project with many parallel pipeline sessions on one machine and a shared test resource — two simultaneous resets on one resource, one blocked behind the other, producing timeouts that fed more adjudication; and every adjudication minting a new resource from its fresh path (175 of 191 such resources on that machine matched no live worktree).
- Decision 1: reruns run serially unless `concurrency.reruns` declares more, because whether two runs of a test command can share a checkout is a property of the command, and the declaration is where the command lives; timeout evidence forces serial whatever is declared.
- Decision 2: a stable per-slot path over a project-declared teardown command: #3064's removal runs only on catchable exits, so a teardown would be skipped by exactly the uncatchable kills that leak, and it would run project code inside a signal handler that races `process.exit`; the stable path bounds leftovers to slots × repositories even after a SIGKILL, and a project can reclaim them by name.
- Alternatives: a policy key (drifts from the command it describes); keeping 4 with an opt-down; a path per base sha (unbounded across shas); a teardown hook (above).
- Consequences: this repo's own adjudications go serial (its declaration does not adopt `reruns`, pinned by the previous-release reader); the reuse contract; accepted residual risk — the slot module's once-only race (two reclaimers of one dead lock), or two holders of one index under different `CT_TEST_SUITE_SLOT_DIR` values in one repository, can let two adjudications share a path once, and a run in a checkout that vanished underneath it produces no evidence, so it routes to `attributable` or an adjudication error, never a false pass; the slot path is about 13 characters longer than the `mkdtemp` one (a Windows path-length cost); the version floor (the release carrying #5150); revisit if a project needs per-checkout resources reset between base commits.

- [ ] **Step 1: Write the three files.**

- [ ] **Step 2: Verify the ADR states both decisions** (AC9.1)

Run: `grep -c -F -e "concurrency.reruns" -e "teardown command" -e "SIGKILL" -e "signal handler" -e "slots × repositories" -e "once-only race" docs/decisions/0031-baseline-reruns-run-serially-and-reuse-one-scratch-path-per-slot.md`
Expected: a count of at least 6 (the ADR carries each phrase verbatim, on separate lines), and `grep -c '^## ' {same file}` prints 4 (Context, Decision, Alternatives considered, Consequences). Controls, run at authoring: the same grep over `docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md` prints 0, and over a six-line probe holding each phrase once it prints 6.

Record it: write the command, its output and `AC9.1: the ADR exists and states both decisions with their reasoning` to `$PIPELINE_RUN_DIR/evidence/ac9-adr.txt` (`mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, plain Bash redirect), then `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{a scratchpad file holding one line: AC9.1, the grep, its counts, and the evidence path}"`.

- [ ] **Step 3: Commit** — `git add docs/decisions/0031-baseline-reruns-run-serially-and-reuse-one-scratch-path-per-slot.md docs/plugin-structure.md docs/journeys/run-a-deterministic-verification-check.md`, message `Record ADR 0031 — serial baseline reruns and one scratch path per slot (#5150)`.

---

## AC coverage

| AC | Task | Test |
|----|------|------|
| AC1.1 — no `reruns`: at most one call in flight per phase | 3, 5 | `AC1.1, AC1.2: with no reruns declared every phase runs one rerun at a time`; CLI `AC1.1: with no declaration … default-serial` |
| AC1.2 — peak per `cwd`, fails against today's 4 | 3 | same test (per-cwd peaks; Step 2 reads 4) |
| AC2.1 — `reruns: 3`, 6 files, peak 3 per phase | 3, 5 | `AC2.1: reruns 3 with 6 failing files peaks at 3`; CLI `AC2.1: a declared concurrency.reruns reaches adjudicate()` |
| AC3.1 — evidence + `reruns: 4`: peak 1 everywhere, reason names the check | 3, 5 | the four `AC3.1, AC3.2: … — <source>` tests; CLI `AC3.1: a declared timeoutPatterns match forces serial reruns` |
| AC3.2 — one test per evidence source | 2, 3 | `AC3.2: timeoutEvidence names …`; the four per-source adjudicate tests (`timedOut` synthetic — see Spec premises) |
| AC4.1 — base rerun times out: later phases peak 1, `phase-timeout: baseline` | 3 | `AC4.1: a timed-out base rerun runs the isolated and retry phases serially` |
| AC5.1 — two sequential adjudications on slot 0, two shas: same path, no new `ct-verify-base-*` | 4, 5 | `AC5.1: two sequential adjudications holding slot 0 …`; CLI `AC5.1` (#5119 test) scratch assertion |
| AC6.1 — registered leftover removed first, completes, `reused` true | 4 | `AC6.1: a leftover worktree registered at the slot path …`; `RF3` |
| AC7.1 — no slot: fresh `ct-verify-base-*` path | 4, 5 | `AC7.1: an adjudication with no slot keeps a fresh ct-verify-base-* path`; CLI `AC7.1: a nested run takes no slot …` |
| AC8.1 — `reruns` positive integer, `timeoutPatterns` array of non-empty strings | 1 | `AC8.1: reruns: 3 and timeoutPatterns: ["deadline"] parse` |
| AC8.2 — anything else fails; allowed-key list names both | 1 | `AC8.2: other reruns and timeoutPatterns values …`; `AC8.2: CONCURRENCY_KEYS names …` |
| AC9.1 — ADR states both decisions with reasoning | 7 | Step 2 grep + `AC evidence` decisions.md entry |
| AC10.1 — committed declaration readable by the latest release's reader | 6 | `tests/verify-scope-declaration.test.js` `AC2.1: the committed verify-scope.json parses with the latest release tag's declaration reader (#4135)`, run in Task 6 Step 4; the file is untouched by every task |
