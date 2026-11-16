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
- Guard constants: size floor 100 KB (102,400 bytes), duration ceiling 40,000 ms.
- Commits name files explicitly with `git add <paths>` and end with `Claude-Session: https://claude.ai/code/session_016yg3zo6eTU9wd41H4Npjd5`.
- The refresh (`node tools/run-tests.js --record-durations tools/test-durations.json`) runs the whole suite once, on a machine with no sibling test runs, in the background; wait for the completion notice, never poll.
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

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` (keeps everything before line 2812, i.e. all non-parity tests, importing the helpers)
- Create: `tests/bin-lib/dispatch/queue-pull-helpers.js` (the module-level definitions the parity blocks share: `POOL`, `PARITY_S1`, `ALL_REASONS`, `MATRIX`, `EXTRA`, `FAULTS`, `FILES_FAULTS`, `PAIR_MEMO`, `pairJobs`, `runFaultPool`, `runD1`, `assertEveryJobRan`, `sides`, `groupedIn`, `exclusionsIn`, the scenario builders `S1`/`S2`/`SPortable`, and whatever else the four blocks and the kept tests both reference; find them by grepping each block's identifiers)
- Create: `tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js`, `queue-pull-parity-ac5.test.js`, `queue-pull-parity-ac4.test.js`, `queue-pull-parity-ac7.test.js` (one per `describe`, with the block's own trailing real-writer tests that sit between blocks following the block they follow in the original file)

**Interfaces:**
- Consumes: Task 1's base count `N` and the original file's order.
- Produces: the same set of tests, same names, spread over five files.

- [ ] **Step 1: Extract helpers.** Move the shared definitions into `queue-pull-helpers.js` and export them; the original file and each new file import what they use. Module-level state that must stay one instance per process (`PAIR_MEMO`, the fault pool promise) stays in the helper module. Header comment of the original (lines 1-50) stays on the helper module and is trimmed in the original to a pointer.
- [ ] **Step 2: Move the four `describe` blocks** (and the top-level tests between and after them) into the four new files unchanged, keeping `{ skip: oracleSkip(), timeout: 600_000 }` on every block. A top-level test that pins a list `plugin/bin/lib/dispatch/queue-pull.js` names (its line 1154 comment says `queue-pull.test.js` pins it) stays in `queue-pull.test.js`.
- [ ] **Step 3: Verify the count is equal**

Run: `node --test --test-reporter=spec tests/bin-lib/dispatch/queue-pull*.test.js > <scratchpad>/qp-split.txt 2>&1; echo exit $?`
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

- [ ] **Step 1: Record durations** once, after Tasks 2-4 are committed, with nothing else running:

Run (background): `node tools/run-tests.js --record-durations tools/test-durations.json > <scratchpad>/record.txt 2>&1; echo exit $?`
Expected: exit 0 and `recorded test durations to tools/test-durations.json` in the output. A non-zero exit means a test failed: fix that first, never commit a map from a red run.
- [ ] **Step 2: Add the two real-map assertions** to `tests/run-tests-shard.test.js`: one `test('every test file of 100 KB or more has a recorded duration (refresh: node tools/run-tests.js --record-durations tools/test-durations.json)')` feeding `durationsCoverageGaps` the `git ls-files` test list, the parsed committed map and an `fs.statSync(...).size` lookup that returns `null` on ENOENT; one `test('no recorded duration exceeds 40,000 ms — split that test file by describe into sibling files')` over `durationsOverCeiling`. Each asserts `[]` and puts the offender list in the message.
- [ ] **Step 3: Run**

Run: `node --test tests/run-tests-shard.test.js`
Expected: PASS. If the ceiling test names a file, apply the follow-up below before continuing.

**Follow-up when a file is still over the ceiling (known candidate: `queue-pull-parity-ac4.test.js`, which pools the gh and files fault rows).** Split its fault pool by family (the `FAULTS` rows in one file, `FILES_FAULTS` rows in another), keeping any assertion that needs both families in the file that runs the smaller pool, re-run Task 3 Step 3 for the test-count equality, re-run Step 1, and repeat until the ceiling test passes. If a file cannot get under the ceiling without dropping a test, stop with status NEEDS_CONTEXT naming the file and its time: never raise the ceiling.
- [ ] **Step 4: Check the balance** — no shard prints `unmeasured`, and the estimates are within 10% of their mean:

Run: `node -e "const r=require('./tools/run-tests.js'),fs=require('fs');const d=r.readDurations(fs.readFileSync('tools/test-durations.json','utf8'));const f=r.listTestFiles();const s=r.assignShards(f,d,4);const m=s.reduce((a,x)=>a+x.ms,0)/4;console.log(JSON.stringify(s.map(x=>({n:x.files.length,ms:Math.round(x.ms),unmeasured:x.unmeasured}))),'mean',Math.round(m),'maxOverMean',(Math.max(...s.map(x=>x.ms))/m).toFixed(3))"`
Expected: every `unmeasured` is `0` and `maxOverMean` is at most `1.100`.
- [ ] **Step 5: Commit**

```bash
git add tools/test-durations.json tests/run-tests-shard.test.js
git commit -m "Refresh the test durations map and pin its coverage and ceiling

Refs #5756

Claude-Session: https://claude.ai/code/session_016yg3zo6eTU9wd41H4Npjd5"
```

### Task 6: Whole-suite verification and the PR before/after

**Files:**
- Modify: none (the PR description is edited through `gh`)

- [ ] **Step 1: Full suite**

Run: `npm test --silent -- --full > <scratchpad>/full.txt 2>&1; echo exit $?`
Expected: exit 0. Quote the `# tests`, `# pass`, `# fail` lines in the report.
- [ ] **Step 2: Push and read the PR's own `test.yml` run** with `gh run list --branch worktree-record-5756 --workflow test.yml --limit 1 --json databaseId` then `gh run view <id> --json jobs`, taking the "Run this shard of the suite" step seconds per shard. Expected: every shard at or under 120 s and the slowest-minus-fastest spread at or under 45 s. A result just over the line is re-run once with `gh run rerun <id>` and the criterion is judged on the re-run's numbers too, both reported.
- [ ] **Step 3: Write the before/after table** into the PR description: before = the 12 green runs on 2026-11-16 (slow shard 120-200 s, others 55-90 s, rotating; shard 1 median 77 s), after = this run's four numbers.
