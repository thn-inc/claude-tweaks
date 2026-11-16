# Rebalance the PR test shards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the slowest of the PR gate's four test shards land near 100 s by giving every large test file a recorded duration, splitting the one suite no partition can balance, and guarding both against regressing.

**Architecture:** `tools/run-tests.js`'s `assignShards` is sound and stays unchanged; its input, `tools/test-durations.json`, is stale and one file (`tests/bin-lib/dispatch/queue-pull.test.js`) outweighs a shard's fair share. The fix is data (a refreshed map), a mechanical split of that suite into sibling files over one shared helper module, and two pure guard functions exported from `tools/run-tests.js` and asserted in `tests/run-tests-shard.test.js`.

**Tech Stack:** Node 20 built-in `node --test`, no npm dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T152154-record-5756/work/5756-spec.md` (record #5756).

Scope keywords: tools/test-durations.json, queue-pull.test, run-tests-shard

## Global Constraints

- Test names in the split files stay byte-identical to the originals (the test-impact map and `#5227` references key on them).
- Do not change `assignShards`, `PER_FILE_OVERHEAD_MS` or the `--shard` partition rules.
- Guard constants: size floor 100 KB (102,400 bytes), duration ceiling 100,000 ms. Amended during the build (user decision, spec `## Plan Review Clarifications`): the ceiling was 40,000 ms until the CI recording showed `queue-pull` files at 180 s / 121 s / 104 s; wherever a task below says 40,000 or 40 s, read 100,000 ms. Task 5b (below) carries the follow-up split.
- Commits name files explicitly with `git add <paths>` and end with `Claude-Session: https://claude.ai/code/session_016yg3zo6eTU9wd41H4Npjd5`.
- The refresh (`node tools/run-tests.js --record-durations <out>`) runs the whole suite once and is recorded on the CI runner (a temporary `.github/workflows/record-durations.yml` on this PR branch, removed in the same change that commits the map), not on this machine: it runs under a load average above 90 on 12 cores from sibling sessions, which inflated one queue-pull run from about 125 s in CI to 905 s here. The map exists to balance CI's shards, so CI hardware is the right place to measure it. Ruling taken during execution; the controller runs it, and waits for the completion notice, never polls.
- No scratch file under the repo root is committed; scratch output goes under the session scratchpad.

## Review Focus

- A split file that imports the helper module but loses the shared `PAIR_MEMO` reuse recomputes the AC1 matrix pairs it used to reuse; the AC4 file must still pass and its measured time decides whether it needs the Task 3 follow-up.
- `oracleSkip()` on win32 and bash < 4 must still skip every moved describe block, not only the first.
- A win32 checkout lists test files with backslashes: the coverage guard must look files up by posix path, as `assignShards` does.
- A test file in `git ls-files` that was deleted from the working tree must not crash the size lookup.
- The 100 KB floor must be inclusive of exactly 102,400 bytes (a file of that size needs an entry).

---

### Task 1: Capture the base facts (no commit)

**Files:**
- Create (scratch only, not committed): `<scratchpad>/qp-base.txt`

**Interfaces:**
- Produces: the base test count and per-describe timings Task 3 compares against.

- [ ] **Step 1: Record the base test count and timings**

Run: `node --test --test-reporter=spec tests/bin-lib/dispatch/queue-pull.test.js > <scratchpad>/qp-base.txt 2>&1; echo exit $?`
Expected: exit 0. Read the `ℹ tests N`, `ℹ pass N` and `ℹ skipped N` totals and the four `#5227 parity (...)` describe durations from the file, and write them into your report (they are Task 3's equality target and the "before" local timings).

- [ ] **Step 2: Record the base line numbers**

Run: `git grep -n "^describe(" -- tests/bin-lib/dispatch/queue-pull.test.js`
Expected: four lines, the four `#5227 parity (...)` blocks at 2812, 2988, 3294, 3413.

### Task 2: Guard functions and their fixture tests

**Files:**
- Modify: `tools/run-tests.js` (add and export two pure functions and two constants next to `assignShards`)
- Test: `tests/run-tests-shard.test.js`

**Interfaces:**
- Produces: `DURATIONS_SIZE_FLOOR_BYTES = 102400`, `DURATIONS_CEILING_MS = 40000`, `durationsCoverageGaps(files: string[], durations: Map<string, number>, sizeOf: (file: string) => number | null): string[]` (the files at or above the floor with no entry, sorted, looked up by posix path; a `null` size is skipped) and `durationsOverCeiling(durations: Map<string, number>, ceilingMs?: number): string[]` (entries above the ceiling, sorted, formatted `"<path> <ms> ms"`).

- [ ] **Step 1: Write the failing fixture tests** in `tests/run-tests-shard.test.js`, one `test()` each:
  - `durationsCoverageGaps names a file at the floor that has no entry`: fixture files `a.test.js` (102,400 bytes, no entry), `b.test.js` (102,399 bytes, no entry), `c.test.js` (200,000 bytes, with entry), `gone.test.js` (`sizeOf` returns `null`); assert the result is exactly `['a.test.js']`.
  - `durationsCoverageGaps matches a win32-separated path to its posix entry`: file `tests\\x.test.js` with entry `tests/x.test.js`; assert `[]`.
  - `durationsOverCeiling names an entry above the ceiling and not one at it`: entries 40,001 and 40,000; assert only the 40,001 one is named, and its text contains `40001`.
- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/run-tests-shard.test.js`
Expected: FAIL with the three new tests reporting `durationsCoverageGaps is not a function` / `durationsOverCeiling is not a function`.

- [ ] **Step 3: Implement** both functions and constants in `tools/run-tests.js` beside `assignShards`, add them to `module.exports`, and import them in the test file's existing destructured `require(RUNNER)`. Reuse `posixKey` for the lookup.
- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/run-tests-shard.test.js`
Expected: PASS, no failures (the two real-map assertions arrive in Task 5).
- [ ] **Step 5: Commit**

```bash
git add tools/run-tests.js tests/run-tests-shard.test.js
git commit -m "Add the durations coverage and ceiling guard functions — pure, fixture-tested

Refs #5756

Claude-Session: https://claude.ai/code/session_016yg3zo6eTU9wd41H4Npjd5"
```

### Task 3: Split `queue-pull.test.js` over one helper module

**Review risk:** high — it moves module-level shared state (`PAIR_MEMO`, the fault-pool promise) and the two top-level `after` cleanup hooks (at `queue-pull.test.js:2730` and `:3287`) across module boundaries, and the `before` hooks race to start the pool.

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` (keeps everything before line 2812 and the `#5230` in-process tests after the last describe, lines 3528-3734, i.e. all non-parity tests, importing the helpers)
- Create: `tests/bin-lib/dispatch/queue-pull-helpers.js` (the module-level definitions the parity blocks share: `POOL`, `PARITY_S1`, `ALL_REASONS`, `MATRIX`, `EXTRA`, `FAULTS`, `FILES_FAULTS`, `PAIR_MEMO`, `pairJobs`, `runFaultPool`, `runD1`, `assertEveryJobRan`, `sides`, `groupedIn`, `exclusionsIn`, the scenario builders `S1`/`S2`/`SPortable`, and whatever else the four blocks and the kept tests both reference; find them by grepping each block's identifiers)
- Create: `tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js`, `queue-pull-parity-ac5.test.js`, `queue-pull-parity-ac4.test.js`, `queue-pull-parity-ac7.test.js` (one per `describe`, with the block's own trailing real-writer tests that sit between blocks following the block they follow in the original file)

Unchanged and reused: `tests/bin-lib/dispatch/queue-pull-fixtures.js`, `tests/bin-lib/dispatch/queue-pull-oracle.js`, `tests/bin-lib/dispatch/queue-pull-clock-stub.js` (the split files import them exactly as the original does).

Other test files only mention `queue-pull.test.js` in comments naming tests that sit before line 2812 and so stay in it (`tests/dispatch-*-fixture.test.js`, `tests/specify-near-duplicate-prose.test.js`, `tests/bin-lib/express/queue.test.js`, `tests/bin-lib/stage-item/cli.test.js`, `tests/bin-lib/dispatch/queue-pull-shims.test.js`, `tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js`); `tests/run-tests-default-run.test.js` and `tests/verify-scope-declaration.test.js` use the path as a fixture string. Do not edit them; if the move relocates one of the named tests, repoint that comment in Task 4.

**Interfaces:**
- Consumes: Task 1's base count `N` and the original file's order.
- Produces: the same set of tests, same names, spread over five files.

- [ ] **Step 1: Extract helpers.** Move the shared definitions into `queue-pull-helpers.js` and export them; the original file and each new file import what they use. Module-level state that must stay one instance per process (`PAIR_MEMO`, the fault pool promise) stays in the helper module. Header comment of the original (lines 1-50) stays on the helper module and is trimmed in the original to a pointer.
- [ ] **Step 2: Move the four `describe` blocks** (and the top-level tests that sit between them, lines 2812-3527) into the four new files unchanged, each test following the block it follows in the original, keeping `{ skip: oracleSkip(), timeout: 600_000 }` on every block. The `#5230` in-process tests after the last describe (lines 3528-3734) stay in `queue-pull.test.js`; other test files' comments name them there.

  Decide per file what its fault pool runs, because each file is now its own process and the shared `PAIR_MEMO` and one-pool promise no longer span them: the AC1 and AC5 files run their own matrix pairs; the AC4 file runs the fault pool plus its own copies of the matrix bases it used to reuse from the AC1 matrix (`S1-gh-miss`, `S1-gh-hit`, `S2-gh-miss`, and the files bases); the AC7 file (`runFaultPool()` at `:3416`) runs only the files rows, the files bases and D1 that its assertions read, never the gh fault rows. State the choice per file in a header comment. A top-level test that pins a list `plugin/bin/lib/dispatch/queue-pull.js` names (its line 1154 comment says `queue-pull.test.js` pins it) stays in `queue-pull.test.js`.
- [ ] **Step 3: Verify the count is equal**

Run: `node --test --test-reporter=spec tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js tests/bin-lib/dispatch/queue-pull-parity-ac5.test.js tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull-parity-ac7.test.js > <scratchpad>/qp-split.txt 2>&1; echo exit $?` (the five files by name, never a glob: `queue-pull-shims.test.js` would join it)
Expected: exit 0, and the `ℹ tests`, `ℹ pass` and `ℹ skipped` totals equal Task 1's `N`. Also run `git diff --stat -M origin/main -- tests/bin-lib/dispatch/` and confirm no test body changed beyond the move.
- [ ] **Step 4: Prove every moved block still skips without the oracle.** Statically: `git grep -n "^describe(" -- tests/bin-lib/dispatch/queue-pull-parity-*.test.js` prints four lines, and every one of them contains `skip: oracleSkip()` and `timeout: 600_000`.
- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-helpers.js tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js tests/bin-lib/dispatch/queue-pull-parity-ac5.test.js tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull-parity-ac7.test.js
git commit -m "Split the queue-pull parity suite into one file per describe — same tests, shared helper module

Refs #5756

Claude-Session: https://claude.ai/code/session_016yg3zo6eTU9wd41H4Npjd5"
```

### Task 4: Repoint references and document the guards

**Files:**
- Modify: `docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md` (frontmatter line 8 and the URL line 50: list the new files)
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (comments only, lines 36, 65, 1154 — name the file each referenced test now lives in)
- Modify: `docs/plugin-structure.md` (the directory row, only if it lists `queue-pull.test.js`)
- Modify: `docs/journeys/ci-test-gate.md` (step 6: one line naming the two guards and the split rule)

- [ ] **Step 1: Find every live reference.** Run `git grep -n "queue-pull.test" -- docs plugin tests tools ':!tools/test-durations.json'`; update each hit that names a test now in a new file. A hit in `.claude-tweaks/pipelines/archive/` is history and stays.
- [ ] **Step 2: Add the doc line** in `docs/journeys/ci-test-gate.md` step 6: `tests/run-tests-shard.test.js` fails when a test file of 100 KB or more has no entry in the durations file, or when an entry exceeds 40,000 ms; split such a file by `describe` into sibling files.
- [ ] **Step 3: Verify** with `git grep -n "queue-pull.test.js" -- plugin docs/journeys` and read each hit; then run the conformance suites that read these paths: `node --test tests/*queue-pull*.test.js tests/*plugin-structure*.test.js tests/*journey*.test.js` and expect exit 0 (if a glob matches nothing, drop it, never pass a bare directory).
- [ ] **Step 4: Commit**

```bash
git add docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md docs/journeys/ci-test-gate.md plugin/bin/lib/dispatch/queue-pull.js docs/plugin-structure.md
# plus any test file whose comment Step 1 repointed, added by explicit path
git commit -m "Repoint the queue-pull test references and document the shard guards

Refs #5756

Claude-Session: https://claude.ai/code/session_016yg3zo6eTU9wd41H4Npjd5"
```

(Drop `docs/plugin-structure.md` from `git add` when Step 1 found nothing to change in it.)

### Task 5: Refresh the durations map and pin it

**Files:**
- Modify: `tools/test-durations.json` (regenerated)
- Modify: `tests/run-tests-shard.test.js` (two real-map assertions)

**Interfaces:**
- Consumes: Task 2's `durationsCoverageGaps`, `durationsOverCeiling`, the constants.

- [ ] **Step 1: Record durations on CI** once, after Tasks 2-4 are committed (the controller does this step, not an implementer):
  1. Add `.github/workflows/record-durations.yml`: `on: pull_request` with `paths: ['.github/workflows/record-durations.yml']`; one `ubuntu-latest` job (`timeout-minutes: 60`) with `test.yml`'s shard-job `env` block, checkout (`fetch-depth: 0`), `setup-node` 20, the zsh install step, then `node tools/run-tests.js --record-durations "$RUNNER_TEMP/test-durations.json"`, then an `upload-artifact` step (`if: always()`, `if-no-files-found: error`) uploading that file as `test-durations`. Commit it by explicit path, push, and wait for the run.
  2. Download the artifact with `gh run download <id> -n test-durations -D <scratchpad>/durations` and copy `test-durations.json` to `tools/test-durations.json`. The run must be green for the recorded file to be used: a red run's file is discarded, the failure is fixed first.
  3. Delete `.github/workflows/record-durations.yml` in the same commit that adds the map.
  Expected: the map names every committed test file, including the new `queue-pull-parity-*.test.js` files.
- [ ] **Step 2: Add the two real-map assertions** to `tests/run-tests-shard.test.js`: one `test('every test file of 100 KB or more has a recorded duration (refresh: node tools/run-tests.js --record-durations tools/test-durations.json)')` feeding `durationsCoverageGaps` the `git ls-files` test list, the parsed committed map and an `fs.statSync(...).size` lookup that returns `null` on ENOENT; one `test('no recorded duration exceeds 40,000 ms — split that test file by describe into sibling files')` over `durationsOverCeiling`. Each asserts `[]` and puts the offender list in the message.
- [ ] **Step 3: Run**

Run: `node --test tests/run-tests-shard.test.js`
Expected: PASS. If the ceiling test names a file, apply the follow-up below before continuing.

**Follow-up when a file is still over the ceiling (known candidates: `queue-pull-parity-ac4.test.js`, which pools the gh and files fault rows, and `queue-pull-parity-ac7.test.js`).** Decided at plan review (spec `## Plan Review Clarifications`): the ceiling stays. Split the file's fault pool by family (the `FAULTS` rows in one file, `FILES_FAULTS` rows in another). AC4.2 (`:3344`, iterates `[FAULTS, FILES_FAULTS]`) and AC4.3 (`:3371`, iterates `[...FAULTS, ...FILES_FAULTS]`) become one test per family, with identical assertions; those two tests' names and the total count change by exactly that, so re-run Task 3 Step 3 and expect `N` plus the number of extra family tests, stating the delta in the report. Re-run Step 1 and repeat until the ceiling test passes. If a file cannot get under the ceiling without dropping an assertion, stop with status NEEDS_CONTEXT naming the file and its time: never raise the ceiling.
- [ ] **Step 4: Check the balance** — no shard prints `unmeasured`, and the estimates are within 10% of their mean:

Run: `node -e "const r=require('./tools/run-tests.js'),fs=require('fs');const d=r.readDurations(fs.readFileSync('tools/test-durations.json','utf8'));const f=r.listTestFiles().map((x)=>require('path').relative(process.cwd(),x));const s=r.assignShards(f,d,4);const m=s.reduce((a,x)=>a+x.ms,0)/4;console.log(JSON.stringify(s.map(x=>({n:x.files.length,ms:Math.round(x.ms),unmeasured:x.unmeasured}))),'mean',Math.round(m),'maxOverMean',(Math.max(...s.map(x=>x.ms))/m).toFixed(3))"`
Expected: every `unmeasured` is `0` and `maxOverMean` is at most `1.100`.
- [ ] **Step 5: Commit**

```bash
git add tools/test-durations.json tests/run-tests-shard.test.js
git commit -m "Refresh the test durations map and pin its coverage and ceiling

Refs #5756

Claude-Session: https://claude.ai/code/session_016yg3zo6eTU9wd41H4Npjd5"
```

### Task 5b: Bring every queue-pull file under the 100 s ceiling (added during the build)

**Review risk:** high — it restructures the shared oracle pool across files, as Task 3 did.

**Files:**
- Modify: `tools/run-tests.js` (`DURATIONS_CEILING_MS` to `100000`), `tests/run-tests-shard.test.js` (the ceiling fixtures: 100,001 and 100,000), `docs/journeys/ci-test-gate.md` (its two "40,000 ms" mentions)
- Modify/Create: the `tests/bin-lib/dispatch/queue-pull*.test.js` files and `queue-pull-helpers.js` as the split needs

**Facts (CI recording run 43912061736, Node 24, four files at a time):** `queue-pull-parity-ac4.test.js` 180,032 ms; `queue-pull.test.js` 121,230 ms (the oracle cross-check tests: 29.5 s `#5227 oracle cross-check: the S1 and SFast fixtures…`, 16.3 s `…S1 full gives the oracle the same groups…`, 14.7 s `#5227 oracle: queue-pull-script.md runs whole…`, 6.9 s, 6.8 s, 2.8 s, 2.7 s…); `queue-pull-parity-ac7.test.js` 104,471 ms; `queue-pull-parity-ac1.test.js` 37,896 ms; `queue-pull-parity-ac5.test.js` 35,190 ms. All other files are under 24 s.

- [ ] **Step 1:** Set the ceiling constant and its fixtures and docs to 100,000 ms.
- [ ] **Step 2:** Split `parity-ac4` by fault family (`FAULTS` rows in one file, `FILES_FAULTS` rows in another), AC4.2 and AC4.3 becoming one test per family with identical assertions (the user's clarification); move the oracle-heavy tests out of `queue-pull.test.js` into a new file so it falls under the ceiling; split `parity-ac7` or merge its pool with the files family so no file reruns a pool another file already pays for. Estimate each resulting file's time from the CI log and keep each at or under about 90 s.
- [ ] **Step 3:** Verify every moved test's name and body, and that the summed test count equals Task 1's `N` plus exactly the added per-family tests.
- [ ] **Step 4:** Commit by explicit paths. The controller then re-records on CI and repeats Step 2 for any file still over the ceiling.

### Task 6: Whole-suite verification and the PR before/after

**Files:**
- None modified; the PR description is edited through the GitHub CLI.

- [ ] **Step 1: Full suite**

Run: `npm test --silent -- --full > <scratchpad>/full.txt 2>&1; echo exit $?`
Expected: exit 0. Quote the `# tests`, `# pass`, `# fail` lines in the report.
- [ ] **Step 2: Push and read the PR's own `test.yml` run** with `gh run list --branch worktree-record-5756 --workflow test.yml --limit 1 --json databaseId` then `gh run view <id> --json jobs`, taking the "Run this shard of the suite" step seconds per shard. Expected: every shard at or under 120 s and the slowest-minus-fastest spread at or under 45 s. A result just over the line is re-run once with `gh run rerun <id>` and the criterion is judged on the re-run's numbers too, both reported.
- [ ] **Step 3: Write the before/after table** into the PR description: before = the 12 green runs on 2026-11-16 (slow shard 120-200 s, others 55-90 s, rotating; shard 1 median 77 s), after = this run's four numbers.
