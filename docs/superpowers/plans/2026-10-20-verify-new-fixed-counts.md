# Verify "N new, M fixed" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `verify.js` report "N new, M fixed" for both adjudication paths, the `preExisting` allowlist and `--baseline <ref>`, in `report.json` and on stdout.

**Architecture:** Both adjudication objects gain the same three keys: `new` (failing files the adjudication did not cover), `fixed` (known-failing files that pass this run), and `fixedReason` (present only when `fixed` is `null` because it could not be proven). For `preExisting`, "fixed" is computed from data already at hand: tracked files that match the allowlist and did not fail, in a scope-`full` run only. For `--baseline`, "fixed" needs the base's failing set, and per-file adjudication never measures that. So `adjudicate()` runs each failing check's own full command once at base, in the scratch worktree it already creates. That run happens only when at least one file was already proven to fail at base. Neither verdict, nor the exit code, nor the stamp changes.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T151837-record-3313/work/3313-spec.md` (record #3313)

Scope keywords: fixedReason

Consumer review (done at authoring): every reader of `preExistingAdjudicated`/`baselineAdjudicated` outside the planned files (`tools/windows-regression/file-issue.js`, `plugin/bin/lib/timing/derive.js`, `plugin/bin/lib/verify/stamp.js`, `plugin/bin/lib/verify/report.js`, `plugin/skills/review/code-mode-steps.md`) reads existing keys only — the change is additive, so none needs editing. The only whole-object deep-equal pins are the four `cli.test.js` sites Task 1 Step 4 updates; `report.test.js` pins composeReport's pass-through of a caller object, unaffected.

## Global Constraints

- Contract changes are additive only. Existing keys on `report.json`'s `preExistingAdjudicated` and `baselineAdjudicated` keep their names and meanings, and consumers such as `tools/windows-regression/file-issue.js` and `plugin/bin/lib/timing/derive.js` still read them.
- `fixed` must never affect `verdict`, `effectivePass`, the exit code, the pass stamp, or the `verify` event.
- Exact stdout copy: `Pre-existing: {n} new, {m} fixed` / `Baseline: {n} new, {m} fixed`. When `fixed` is `null`, the line reads `{Label}: {n} new, fixed not computed — {fixedReason}`. Each fixed file gets its own line: `FIXED: {file} — matches the preExisting allowlist but passed this run; consider removing its entry` or `FIXED: {file} — fails at base, passes at HEAD`.
- Commit subject style is `{Verb} {what} — {detail}`, and the body says `refs #3313`, never "closes" or "fixes".
- `plugin/skills/test/verification.md` is 48,742 bytes against `RAIL_BYTES` 52,500, already above the 90% near-ceiling. Remedy: cut bytes. Keep its net growth at or below 600 bytes, and confirm with `wc -c`.

## Review Focus

1. A base full run in a scratch worktree with no `node_modules`: every file there fails to load. A file-level base failure must not count as "fixed" when HEAD resolves dependencies. Test in Task 2.
2. A base full run that times out, cannot be read, or whose log does not account for its failures sets `fixed: null` with a `fixedReason` and leaves the verdict alone. Test in Task 2.
3. A file that fails at base but was deleted on the branch is not "fixed". Test in Task 2.
4. A glob `preExisting` entry that matches several tracked files, one of which still fails: only the passing ones are listed as fixed. Test in Task 1.
5. A narrowed `--scope` run (scoped, tool-scoped, static-only) never claims "fixed". An allowlisted file may simply not have run. Test in Task 1.

---

### Task 1: `preExisting` new/fixed

**Files:**
- Modify: `plugin/bin/lib/verify/pre-existing.js`
- Modify: `plugin/bin/verify.js` (the `preExistingAdjudicated` block, about lines 598-634, and its stdout block, about lines 961-969)
- Test: `tests/bin-lib/verify/pre-existing.test.js`, `tests/bin-lib/verify/cli.test.js`

**Interfaces:**
- Produces: `trackedFiles(cwd: string, execImpl = execFileSync) -> string[] | null` runs `git ls-files -z` in `cwd`, splits on `\0`, drops empty entries, and returns `null` on any throw.
- Produces: `newAndFixed({ verdict, failingFiles, preExisting, mode, listTracked }) -> { new: string[], fixed: string[] | null, fixedReason?: string }`. `verdict` is `matchPreExisting`'s return value. `new` is `[]` when `verdict.eligible`, otherwise the deduped `verdict.unmatched`. When `mode !== 'full'`, `fixed` is `null` with `fixedReason: 'scope mode {mode} did not run every suite'`. When `listTracked()` returns `null`, `fixed` is `null` with `fixedReason: 'git ls-files failed'`. Otherwise `fixed` is the tracked files matching any `preExisting` glob (`globToRegExp`), minus every failing file, in `ls-files` order.

- [ ] **Step 1: Write the failing tests.** Append these to `tests/bin-lib/verify/pre-existing.test.js`:
  - `newAndFixed: allowlisted tracked files that did not fail are fixed; unmatched failing files are new (#3313)`: `verdict = matchPreExisting({failingFiles:['tests/real.test.js'], preExisting:['tests/a.test.js']})`, `mode:'full'`, `listTracked: () => ['src/x.js','tests/a.test.js','tests/real.test.js']`. Expect deepStrictEqual `{ new: ['tests/real.test.js'], fixed: ['tests/a.test.js'] }`.
  - `newAndFixed: a glob entry lists only its matching files that passed (#3313)`: `preExisting:['tests/env/*.test.js']`, `failingFiles:['tests/env/a.test.js']` (eligible), tracked `['tests/env/a.test.js','tests/env/b.test.js','tests/other.test.js']`. Expect `{ new: [], fixed: ['tests/env/b.test.js'] }`.
  - `newAndFixed: a narrowed scope never claims fixed (#3313)`: `mode:'scoped'`. Expect `fixed === null` and `fixedReason === 'scope mode scoped did not run every suite'`, and `listTracked` is never called (it throws if it is).
  - `newAndFixed: an unreadable tracked list is fixed:null, never [] (#3313)`: `listTracked: () => null`. Expect `fixedReason === 'git ls-files failed'`.

  Append to `tests/bin-lib/verify/cli.test.js`, after the preExisting tests:
  - `AC1.1 preExisting: one allowlisted file now passing and one new failure prints 1 new, 1 fixed and lists both in report.json (#3313)`: use `preExistingRepo({ failingFile: 'tests/real.test.js', preExisting: ['tests/known-shallow.test.js'] })`, then write and commit `tests/known-shallow.test.js` (any content). Run `r.args`. Expect code 1, stdout matching `/^Pre-existing: 1 new, 1 fixed$/m` and `/^FIXED: tests\/known-shallow\.test\.js — matches the preExisting allowlist but passed this run; consider removing its entry$/m`, and `report.preExistingAdjudicated` deepStrictEqual `{ declared: ['tests/known-shallow.test.js'], eligible: false, reason: 'unlisted: [tests/real.test.js]', new: ['tests/real.test.js'], fixed: ['tests/known-shallow.test.js'] }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify/pre-existing.test.js`
Expected: FAIL with `newAndFixed is not a function`

- [ ] **Step 3: Implement `trackedFiles` and `newAndFixed` in `pre-existing.js`, then wire them into `verify.js`.** In the non-refusal branch, spread `newAndFixed({ verdict, failingFiles: allFailingFiles, preExisting: decl.preExisting, mode: sel.mode, listTracked: () => trackedFiles(logCwd) })` into both result shapes (`{declared, matched, ...}` and `{declared, eligible:false, reason, ...}`). Leave refusal shapes unchanged. In the stdout block, render the counts line and the `FIXED:` lines, using the Global Constraints copy, directly after the existing `Pre-existing:` line whenever `Array.isArray(preExistingAdjudicated.new)`.

- [ ] **Step 4: Update the four existing deep-equal pins.** These are the return-shape widening sites in `cli.test.js`, at about lines 1727, 1743, 1774, and 1808. The covered pins (1727, 1808) gain `new: [], fixed: []`. The unlisted pin (1743) gains `new: ['tests/real.test.js'], fixed: []`. The refusal pin (1774) is unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/pre-existing.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS, 0 fail

- [ ] **Step 6: Commit** with `git add` naming the four files and the subject `Report new/fixed for preExisting adjudication — allowlisted files that passed are listed for removal`, body `refs #3313`.

### Task 2: `--baseline` new/fixed

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js` (`adjudicate`)
- Modify: `plugin/bin/verify.js` (the eligible `Baseline:` stdout branch, about lines 938-956)
- Test: `tests/bin-lib/verify/baseline.test.js`, `tests/bin-lib/verify/cli.test.js`

**Interfaces:**
- Produces: the eligible `adjudicate()` result gains `new` (the same array as `attributable`), `fixed: string[] | null`, and `fixedReason` (present only when `fixed` is `null`).
- Rule, applied inside the existing `try`, after `work.forEach` classification:
  - When `baselineFailing.length === 0`: `fixed = null` and `fixedReason = 'no failing file also fails at base — base full run skipped'`, with no extra run.
  - Otherwise, for each failing check `c` (keep the checks the first loop accepted, in order):
    - No `c.command` gives `fixedReason = '{c.name} has no command to run at base'`.
    - Otherwise call `runOne({ name: '{c.name}-base-full', command: c.command, logDir, spawnImpl, now, cwd: baseDir, env: envOf(c.name), timeout: timeoutOf(c.name) })`.
    - A non-numeric exit gives `'{c.name} base full run exited without a numeric code'`, plus `' (timed out)'` when `r.timedOut`.
    - An unreadable log gives `'{c.name} base full run log unreadable'`.
    - `accountedFamily(text, at(baseDir)) === null` gives `'{c.name} base full run log does not account for its failures'`.
    - `parseCounts(...).tests === 0` gives `'{c.name} base full run ran no tests'`.
    - Otherwise the base-failing set is `extractFailingFiles(text, family, at(baseDir))`. When `headResolvesDeps || (envOf(c.name) || {}).NODE_PATH`, drop `fileLevelFailures(text, family, at(baseDir))` from that set. Then drop the HEAD-failing files (`failingByCheck[c.name]`), and keep only files where `git.inCheckout(headDir, f)`.
  - The first reason makes `fixed` `null` for the whole run. Otherwise `fixed` is the deduped union.

- [ ] **Step 1: Write the failing tests.** Append to `tests/bin-lib/verify/baseline.test.js` (and, in the same file, extend `fakes()`'s `runOne` so that a name ending in `-base-full` is kind `base-full`, keyed by `base-full:{command}` in `outcomes`/`logs`):
  - `fixed: a file failing in the base full run but not at HEAD is fixed; new mirrors attributable (#3313 AC2.1)`: HEAD log `SPEC(['tests/a.test.js'])`, check `{ name:'tests', command:'npm test', exitCode:1, logPath }`. Outcomes: `baseline:tests/a.test.js: 1`, `base-full:npm test: 1`, with log `SPEC(['tests/a.test.js','tests/fixed.test.js'])`. Expect `r.verdict === 'pass'`, `r.fixed` deepStrictEqual `['tests/fixed.test.js']`, `r.new` deepStrictEqual `[]`, `'fixedReason' in r === false`, and the base-full run's `cwd === '/scratch'`.
  - `fixed: no proven base failure skips the base full run (#3313)`: an attributable-only run. Expect `r.fixed === null`, the skipped reason above, and no `base-full` entry in `calls.runs`.
  - `fixed: a timed-out base full run is fixed:null and never changes the verdict (#3313)`: base-full returns `{exitCode:null, timedOut:true}`. Expect `fixedReason` to end `(timed out)` and `r.verdict === 'pass'`.
  - `fixed: a file-level base failure is not fixed when HEAD resolves dependencies (#3313)`: pass `env: { NODE_PATH: '/x' }`, with a base-full log listing `tests/fixed.test.js` as `FILE_LEVEL`. Expect `r.fixed` deepStrictEqual `[]`.
  - `fixed: a base-failing file absent at HEAD is not fixed (#3313)`: `inCheckout: (dir, rel) => !(dir === '/repo' && rel === 'tests/gone.test.js')`. Expect `gone` not in `r.fixed`.

  Append to `cli.test.js`, after the `--baseline` tests:
  - `AC2.1 --baseline: a base-failing file that passes at HEAD reports as fixed (#3313)`: start from `baselineRepo()` and add a committed failing `tests/fixme.test.js` to a new base commit. Read `baseSha` there, then make `fixme` pass in a HEAD commit. Run `['--cmd', 'tests=node --test --test-reporter=tap tests/env.test.js tests/fixme.test.js tests/ok.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE]` with `r.opts`. Expect code 0, stdout `/^Baseline: 0 new, 1 fixed$/m` and `/^FIXED: tests\/fixme\.test\.js — fails at base, passes at HEAD$/m`, and `report.baselineAdjudicated.fixed` deepStrictEqual `['tests/fixme.test.js']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="#3313" tests/bin-lib/verify/baseline.test.js`
Expected: FAIL (`r.fixed` is `undefined`)

- [ ] **Step 3: Implement the rule in `adjudicate()`, then render it in `verify.js`.** Put the counts line and the `FIXED:` lines (Global Constraints copy) directly after the existing `Baseline: adjudicated against …` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS, 0 fail

- [ ] **Step 5: Commit** with `git add` naming the four files and the subject `Report new/fixed for --baseline adjudication — one full base run per failing check, gated on a proven base failure`, body `refs #3313`.

### Task 3: Document the contract

**Files:**
- Modify: `plugin/skills/test/verification.md` (the `### Baseline adjudication (#3043)` and `### Declared pre-existing failures (#3129)` sections)

- [ ] **Step 1: Record the new keys and stdout lines.**
  - Baseline adjudication: `new`/`fixed`/`fixedReason`, the gated full base run, and its cost (one extra full run per failing check, only when a file fails at base).
  - Declared pre-existing: `new`/`fixed`/`fixedReason`, plus scope-`full` only.
  - Both: the two `{Label}: N new, M fixed` lines and the `FIXED:` lines, presented verbatim in Step 3.
  - Offset the added bytes by tightening wording in the same two sections.

- [ ] **Step 2: Verify size and pins**

Run: `wc -c plugin/skills/test/verification.md` — Expected: at most 49342 bytes
Run: `node --test tests/bin-lib/verify/snippet-conformance.test.js "tests/verification-*.test.js" "tests/bin-lib/skill-audit/*.test.js"` — Expected: PASS (glob form; a bare directory argument fails on Node 22)

- [ ] **Step 3: Verify AC3.1 (existing verify suites stay green)**

Run: `node --test "tests/bin-lib/verify/*.test.js"` — Expected: PASS, 0 fail (the full suite runs centrally at Common Step 5)

- [ ] **Step 4: Commit** with the subject `Document verify new/fixed reporting — both adjudication paths` and body `refs #3313`.
