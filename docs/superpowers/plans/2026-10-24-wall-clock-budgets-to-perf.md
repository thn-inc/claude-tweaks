# Move the 12 pinned wall-clock budgets to perf/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every wall-clock budget `tests/wall-clock-budget-conformance.test.js` pins on its ALLOWLIST moves to a `perf/*.test.js` file with the same input and bound, the functional assertions stay in `tests/`, and ALLOWLIST ends empty.

**Architecture:** One task per source test file (two small files share a task where that keeps a task at five files or fewer). Each task removes the file's ALLOWLIST entry first, which turns the conformance scan red on the still-present budget, then splits the test: the timing assertion goes to a new flat `perf/{topic}.test.js` that carries its own copy of the fixture it needs (precedent: `perf/statusline-render.test.js` keeps its own fixture copy). Where the budget was the test's only proof of a property that can be checked without a clock (probe concurrency, budget-exhausted skipping, no false query candidate), the `tests/` copy gains a deterministic assertion for it. The last task replaces the ALLOWLIST's role as the scan's floor: the conformance suite pins each moved site's text in its perf/ file instead.

**Tech Stack:** Node 18+, `node:test`, `node:assert`. No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T061252-record-3939/work/3939-spec.md`

## Global Constraints

- `npm test` never runs `perf/`; `npm run test:perf` (`node tools/run-tests.js perf`) does, recursively.
- Each moved budget keeps **the same input and the same bound** as its `tests/` original.
- Each new perf file opens with the header shape `perf/closing-keyword-linearity.test.js` uses: `// {what} budget (#{issue}) — deliberately NOT part of \`npm test\`.`, blank `//`, `// Run with: npm run test:perf`, blank `//`, then 2-5 lines naming what the budget catches and why it lives outside tests/ (a wall-clock assertion flakes under sibling-suite load). Then `'use strict';`.
- Perf files require source as `../plugin/bin/lib/...`; never require a `tests/**/*.test.js` file (requiring one registers its tests).
- A perf file that builds git fixtures uses `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, never the repo cwd.
- Each moved comparison is written in perf/ with **the exact source text it had in tests/** (Task 8 pins those texts). The table below is the contract.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3939`, trailer `Claude-Session: https://claude.ai/code/session_01N7tLKSQeKABx7pmF6ri9BZ`. Never `closes`/`fixes`.

| Task | tests/ file | New perf file | Moved site text(s), as the scan reports them |
|---|---|---|---|
| 1 | `tests/bin-lib/code-health/candidates-scale-readiness.test.js` | `perf/scale-readiness-linearity.test.js` | `elapsed < 1000`, `elapsed < 1000` |
| 2 | `tests/bin-lib/dream/scan.test.js` | `perf/dream-redact-latency.test.js` | `Date.now() - started < 500` |
| 2 | `tests/bin-lib/gif/palette.test.js` | `perf/gif-quantize-latency.test.js` | `elapsedMs < 5000` |
| 3 | `tests/bin-lib/git-retry.test.js` | `perf/git-retry-bounded-wait.test.js` | `elapsed < 1000` |
| 3 | `tests/bin-lib/health-core/premise-self-check.test.js` | `perf/premise-self-check-timeout.test.js` | `Date.now() - start < 4000` |
| 4 | `tests/bin-lib/model-profiles/session-failures.test.js` | `perf/session-failures-lock-wait.test.js` | `Date.now() - start < 2000`, `Date.now() - start < 2000` |
| 5 | `tests/bin-lib/flow/preflight.test.js` | `perf/flow-preflight-concurrency.test.js` | `Date.now() - t0 < 600` |
| 6 | `tests/bin-lib/wrap-up/pack.test.js` | `perf/wrap-up-pack-concurrency.test.js` | `wall < 600` (plus the scan-invisible `pack.durationMs < 600`) |
| 7 | `tests/reconcile.test.js` | `perf/reconcile-time-bounds.test.js` | `elapsed < 2500`, `Date.now() - start < 1000` |

**Decision (Deliverable 3):** `pack.durationMs < 600` in `tests/bin-lib/wrap-up/pack.test.js:689` moves to perf/ too. It is the same wall-clock budget as `wall < 600` on the same run, measured inside `gatherPack` (`pack.durationMs = now() - start`), so it flakes under the same load; the scan misses it only because of its known limit 1. Keeping it in tests/ would leave the exact flake the record exists to remove.

## Review Focus

1. A perf file that silently passes because its fixture copy drifted from the original (a probe that now throws inside the fake reads as a degraded field, not a failure) — each perf test keeps the original's functional assertions alongside the bound, so a broken fixture fails on them.
2. A `tests/` test left with no assertion after its timing line is removed (the dotted-chain scan in Task 1, reconcile AC2 in Task 7) — each gets a deterministic assertion in its task.
3. Moved site text that differs from the original (renamed variable, reflowed expression) — Task 8 pins the exact texts, so drift fails `npm test`.
4. A perf file writing into the real checkout (reconcile, preflight fixtures) — every fixture lives under `os.tmpdir()`.
5. ALLOWLIST emptied while the matcher is blind — Task 8's per-file pin of moved texts in perf/ fails if the matcher stops seeing them.

---

### Task 1: scale-readiness linearity budgets

**Files:**
- Modify: `tests/bin-lib/code-health/candidates-scale-readiness.test.js:918-940`
- Create: `perf/scale-readiness-linearity.test.js`
- Modify: `tests/wall-clock-budget-conformance.test.js` (ALLOWLIST entry `tests/bin-lib/code-health/candidates-scale-readiness.test.js`)

**Interfaces:**
- Consumes: `scanScaleReadiness(root)` from `plugin/bin/lib/code-health/candidates-scale-readiness.js`.
- Produces: perf file `perf/scale-readiness-linearity.test.js` with sites `elapsed < 1000` ×2 (Task 8).

- [ ] **Step 1: Delete the `candidates-scale-readiness` ALLOWLIST entry** in `tests/wall-clock-budget-conformance.test.js`.

- [ ] **Step 2: Run the scan to verify it fails**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL after Step 1 — two offender lines `tests/bin-lib/code-health/candidates-scale-readiness.test.js:923: elapsed < 1000 — a wall-clock budget under tests/ flakes under load; move it to perf/ …` and the same at `:935`.

- [ ] **Step 3: Split the two tests.** In the tests/ file, for `the "use server" check is linear in leading slashes…` drop the `start`/`elapsed` lines and the `elapsed < 1000` assertion, keep `assert.equal(r.notApplicable, true)` and the directive half. For `the Prisma receiver-chain match is linear…` drop the timing lines and replace the bare `scanScaleReadiness(dotted);` with:

```js
const r = scanScaleReadiness(dotted);
assert.deepEqual(r.candidates.filter((c) => c.kind === 'unbounded-list-query'), []);
```

(Probed 2026-10-24: the dotted fixture yields only a `no-monitoring` candidate.) Create `perf/scale-readiness-linearity.test.js` with both tests' slash/dotted halves, the same inputs (`'/'.repeat(200)` under `next ^15, react ^19`; `'a.'.repeat(20000)` under `express ^4, @prisma/client ^5`), the same `const start = Date.now(); … const elapsed = Date.now() - start; assert.ok(elapsed < 1000, …)` shape, and the slash test's `assert.equal(r.notApplicable, true)`. Copy the four fixture helpers it needs (`tmpGitRepo`, `write`, `pkg`, `repoWith`) into the perf file. Header issue reference: `#3412` is the regex-linearity precedent; name the quadratic-backtracking regressions these catch.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: PASS (AC1.1 offenders gone; AC3.1 functional tests green).
Run: `node --test perf/scale-readiness-linearity.test.js`
Expected: PASS, 2 tests (AC2.1).

- [ ] **Step 5: Commit**

```bash
git add tests/wall-clock-budget-conformance.test.js tests/bin-lib/code-health/candidates-scale-readiness.test.js perf/scale-readiness-linearity.test.js
git commit -m "Move scale-readiness linearity budgets to perf/ — functional checks stay in tests/" -m "refs #3939" -m "Claude-Session: https://claude.ai/code/session_01N7tLKSQeKABx7pmF6ri9BZ"
```

### Task 2: dream redact and gif quantize latency budgets

**Files:**
- Modify: `tests/bin-lib/dream/scan.test.js:279-286`
- Modify: `tests/bin-lib/gif/palette.test.js:70-83`
- Create: `perf/dream-redact-latency.test.js`
- Create: `perf/gif-quantize-latency.test.js`
- Modify: `tests/wall-clock-budget-conformance.test.js` (entries `tests/bin-lib/dream/scan.test.js`, `tests/bin-lib/gif/palette.test.js`)

**Interfaces:**
- Consumes: `redact(text)` from `plugin/bin/lib/dream/scan.js`; `quantize(frames, maxColors) -> { palette, index }` from `plugin/bin/lib/gif/palette.js`.
- Produces: perf sites `Date.now() - started < 500` and `elapsedMs < 5000` (Task 8).

- [ ] **Step 1: Delete both ALLOWLIST entries.**

- [ ] **Step 2: Run the scan to verify it fails**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL after Step 1 — offenders at `tests/bin-lib/dream/scan.test.js:284: Date.now() - started < 500` and `tests/bin-lib/gif/palette.test.js:82: elapsedMs < 5000`.

- [ ] **Step 3: Split both tests.** dream: tests/ keeps the `huge` input, `redact(huge)` and `assert.ok(out.startsWith('TOKEN'), …)`; drop `started` and the bound. gif: tests/ keeps the 400x300 frame build, `quantize`, `index`, `palette.length / 3 <= 256` and `idx.length === w * h`; drop `start`/`elapsedMs` and the bound. Each perf file carries the full original test (input, functional assertions, and the bound with its original message). Header: dream names the uncapped-SECRET_NAME backtracking the original test's comment describes (~2 s at 120k chars), with no issue number unless `git log -S "TOKEN'.repeat(24000)" -- tests/bin-lib/dream/scan.test.js` names one; gif cites `#2758`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/bin-lib/dream/scan.test.js tests/bin-lib/gif/palette.test.js`
Expected: PASS (AC1.1, AC3.1).
Run: `node --test perf/dream-redact-latency.test.js perf/gif-quantize-latency.test.js`
Expected: PASS (AC2.1).

- [ ] **Step 5: Commit** (same message shape: `Move dream redact and gif quantize latency budgets to perf/ — …`).

### Task 3: git-retry and premise-self-check bounded-wait budgets

**Files:**
- Modify: `tests/bin-lib/git-retry.test.js:93-111`
- Modify: `tests/bin-lib/health-core/premise-self-check.test.js:68-73`
- Create: `perf/git-retry-bounded-wait.test.js`
- Create: `perf/premise-self-check-timeout.test.js`
- Modify: `tests/wall-clock-budget-conformance.test.js` (entries `tests/bin-lib/git-retry.test.js`, `tests/bin-lib/health-core/premise-self-check.test.js`)

**Interfaces:**
- Consumes: `withIndexLockRetry(runner, { attempts, sleep })` from `plugin/bin/lib/git-retry.js`; `premiseReadsUnresolved(command, { root, timeoutMs })` from `plugin/bin/lib/health-core/premise-self-check.js`.
- Produces: perf sites `elapsed < 1000` and `Date.now() - start < 4000` (Task 8).

- [ ] **Step 1: Delete both ALLOWLIST entries.**

- [ ] **Step 2: Run the scan to verify it fails**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL after Step 1 — offenders at `tests/bin-lib/git-retry.test.js:110: elapsed < 1000` and `tests/bin-lib/health-core/premise-self-check.test.js:72: Date.now() - start < 4000`.

- [ ] **Step 3: Split both tests.** git-retry: tests/ keeps the throws assertion, `callCount === 4` and `sleeps.length === 3` (the injected-sleep proof); drop `start`/`elapsed` and the bound. premise-self-check: tests/ keeps `premiseReadsUnresolved('sleep 5', { root: dir, timeoutMs: 100 }) === false` — that alone proves the kill path, since an un-killed `sleep 5` exits 0 and reads `true` — and drops `start` and the bound. Each perf file carries the full original test; the premise perf file copies `tmpWithSpace()` (a temp dir whose name contains a space). Header issue references: git-retry `#2346`; premise-self-check `#1829`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/bin-lib/git-retry.test.js tests/bin-lib/health-core/premise-self-check.test.js`
Expected: PASS (AC1.1, AC3.1).
Run: `node --test perf/git-retry-bounded-wait.test.js perf/premise-self-check-timeout.test.js`
Expected: PASS (AC2.1).

- [ ] **Step 5: Commit** (`Move git-retry and premise-self-check bounded-wait budgets to perf/ — …`).

### Task 4: session-failures lock-wait budgets

**Files:**
- Modify: `tests/bin-lib/model-profiles/session-failures.test.js:158-200`
- Create: `perf/session-failures-lock-wait.test.js`
- Modify: `tests/wall-clock-budget-conformance.test.js` (entry `tests/bin-lib/model-profiles/session-failures.test.js`)

**Interfaces:**
- Consumes: `failurePath(id)`, `readFailedModels(id)`, `recordFailure(id, model, { lockTimeoutMs, lockPollMs })` from `plugin/bin/lib/model-profiles/session-failures.js`.
- Produces: perf sites `Date.now() - start < 2000` ×2 (Task 8).

- [ ] **Step 1: Delete the ALLOWLIST entry.**

- [ ] **Step 2: Run the scan to verify it fails**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL after Step 1 — offenders at `:179` and `:194`, both `Date.now() - start < 2000`.

- [ ] **Step 3: Split both tests.** tests/ keeps each test's setup (held lock dir, the spawned releaser in the first), the `recordFailure` call (`assert.doesNotThrow` in the second), the `readFailedModels` assertions and the cleanup; drop `start` and both bounds. The perf file carries both original tests verbatim, including `cleanup(id)`; give its session ids a distinct prefix (`sf-perf-lock-contend-${process.pid}`, `sf-perf-lock-timeout-${process.pid}`) so a concurrent `npm test` never shares a lock dir with it. Header: these are the timing half of the lock's wait/degrade contract; the functional half (model recorded either way) stays in tests/.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/bin-lib/model-profiles/session-failures.test.js`
Expected: PASS (AC1.1, AC3.1).
Run: `node --test perf/session-failures-lock-wait.test.js`
Expected: PASS, 2 tests (AC2.1).

- [ ] **Step 5: Commit** (`Move session-failures lock-wait budgets to perf/ — …`).

### Task 5: flow preflight concurrency budget

**Files:**
- Modify: `tests/bin-lib/flow/preflight.test.js:163-178`
- Create: `perf/flow-preflight-concurrency.test.js`
- Modify: `tests/wall-clock-budget-conformance.test.js` (entry `tests/bin-lib/flow/preflight.test.js`)

**Interfaces:**
- Consumes: `gatherPreflight({ runDir, steps, cwd, mainRoot, deps })` from `plugin/bin/lib/flow/preflight.js`.
- Produces: perf site `Date.now() - t0 < 600` (Task 8).

- [ ] **Step 1: Delete the ALLOWLIST entry.**

- [ ] **Step 2: Run the scan to verify it fails**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL after Step 1 — offender `tests/bin-lib/flow/preflight.test.js:177: Date.now() - t0 < 600`.

- [ ] **Step 3: Replace the timing with an overlap count in tests/.** In `one probe throwing degrades only its field, and the probes run concurrently (#1931)`, drop `t0` and the bound; wrap the slowed `execFileAsync` so it tracks in-flight calls:

```js
let inFlight = 0;
let maxInFlight = 0;
// execFileAsync: async (cmd, args) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); try { return await slow(d.execFile(cmd, args)); } finally { inFlight--; } }
assert.strictEqual(maxInFlight, 3, 'the three subprocess probes overlap');
```

(Probed 2026-10-24: 3 calls, 3 in flight at once; a serial gather reads 1.) Keep the freshness and pr assertions. The perf file carries the original test verbatim (bound included), with its own copies of `mainRoot`, `deps`, `seedCase1`, `STAMP`, `CHANGED`, `PR_BODY`. Header issue reference: `#1931`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/bin-lib/flow/preflight.test.js`
Expected: PASS (AC1.1, AC3.1).
Run: `node --test perf/flow-preflight-concurrency.test.js`
Expected: PASS (AC2.1).

- [ ] **Step 5: Commit** (`Move flow preflight concurrency budget to perf/ — tests/ counts overlapping probes instead`).

### Task 6: wrap-up pack concurrency budgets

**Files:**
- Modify: `tests/bin-lib/wrap-up/pack.test.js:677-690`
- Create: `perf/wrap-up-pack-concurrency.test.js`
- Modify: `tests/wall-clock-budget-conformance.test.js` (entry `tests/bin-lib/wrap-up/pack.test.js`)

**Interfaces:**
- Consumes: `gatherPack({ runDir, cwd, deps })` from `plugin/bin/lib/wrap-up/pack.js`.
- Produces: perf site `wall < 600` (Task 8); `pack.durationMs < 600` moves too (scan-invisible).

- [ ] **Step 1: Delete the ALLOWLIST entry.**

- [ ] **Step 2: Run the scan to verify it fails**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL after Step 1 — offender `tests/bin-lib/wrap-up/pack.test.js:688: wall < 600`.

- [ ] **Step 3: Replace both timings with an overlap count in tests/.** Retitle the test `gatherPack runs the probes concurrently — the slowed probes overlap (#1930 AC4)`. Route the three slowed deps (`execFile`, `computeBlastRadius`, `readClaimBlob`) through one tracker that increments `inFlight`, records `maxInFlight`, sleeps 200 ms, then decrements, and assert:

```js
assert.strictEqual(maxInFlight, 7, 'seven of the nine slowed calls run at once; a serial pack reads 1');
```

(Probed 2026-10-24: 9 slowed calls, 7 in flight at once.) Drop `t0`, `wall`, and both bounds. The perf file carries the original test verbatim under its original title (both `wall < 600` and `pack.durationMs < 600`), with its own copies of `fixtureRunDir`, `okDeps`, `DEFAULT_POLICY`, `policyFake`, `readFileFake`. Header names the Deliverable 3 decision: `pack.durationMs` is the same budget measured inside `gatherPack`, invisible to the scan (its known limit 1), and moves with `wall`. Header issue reference: `#1930`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/bin-lib/wrap-up/pack.test.js`
Expected: PASS (AC1.1, AC3.1).
Run: `node --test perf/wrap-up-pack-concurrency.test.js`
Expected: PASS (AC2.1).

- [ ] **Step 5: Commit** (`Move wrap-up pack concurrency budgets to perf/ — tests/ counts overlapping probes instead`).

### Task 7: reconcile time bounds

**Files:**
- Modify: `tests/reconcile.test.js:2487-2534`
- Create: `perf/reconcile-time-bounds.test.js`
- Modify: `tests/wall-clock-budget-conformance.test.js` (entry `tests/reconcile.test.js`)

**Interfaces:**
- Consumes: `reconcile({ cwd, checks })`, `ALL_CHECKS` from `plugin/bin/lib/reconcile`; monkeypatch seams `require('…/reconcile/preflight').ghHealthCheck`, `require('…/reconcile/budget').createBudget`.
- Produces: perf sites `elapsed < 2500`, `Date.now() - start < 1000` (Task 8).

- [ ] **Step 1: Delete the ALLOWLIST entry.**

- [ ] **Step 2: Run the scan to verify it fails**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL after Step 1 — offenders at `tests/reconcile.test.js:2508: elapsed < 2500` and `:2533: Date.now() - start < 1000`.

- [ ] **Step 3: Split both tests.** AC1 in tests/ keeps the `r.skipped` and `r.mirror` deepEquals; drop `start`/`elapsed` and the bound. AC2 had no functional assertion — capture the result and assert the budget skip it guards:

```js
const r = await reconcile({ cwd: mainDir, checks: require('../plugin/bin/lib/reconcile').ALL_CHECKS });
assert.deepEqual(r.skipped, [{ check: 'mirror,red-tip,console,release,archive,archive-branches,remote-prune,reap', reason: 'budget-exceeded' }]);
```

(Probed 2026-10-24 against this fixture shape.) Go-red check (scratch, not committed): set the fake's `exceeded: () => false`, run, see the deepEqual fail, restore. The perf file carries both original tests (bounds included, plus AC1's functional deepEquals), with its own copies of `git`, `pairedFixture`, `writePolicyViaSeedAndPull`, and restores each monkeypatch in `finally` exactly as the originals do. Header issue reference: `#820`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/reconcile.test.js`
Expected: PASS (AC1.1, AC3.1).
Run: `node --test perf/reconcile-time-bounds.test.js`
Expected: PASS, 2 tests (AC2.1).

- [ ] **Step 5: Commit** (`Move reconcile time bounds to perf/ — AC2 now asserts the budget-exceeded skip`).

### Task 8: pin moved sites in perf/ as the scan's new floor

**Files:**
- Modify: `tests/wall-clock-budget-conformance.test.js` (header comment's floor sentence; the comment above `ALLOWLIST`; the `AC2.1: perf/ budgets are real matches but are never scanned` test)

**Interfaces:**
- Consumes: the perf file names and site texts in Global Constraints' table (Tasks 1-7); `findBudgetAssertions(src)` in this file.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test.** Add, after the existing AC2.1 test:

```js
// Each budget moved out of tests/ by #3939, by its perf/ file and comparison text.
// With ALLOWLIST empty, these are the scan's floor: a blinded matcher drops them.
const MOVED_TO_PERF = {
  'perf/scale-readiness-linearity.test.js': ['elapsed < 1000', 'elapsed < 1000'],
  'perf/dream-redact-latency.test.js': ['Date.now() - started < 500'],
  'perf/gif-quantize-latency.test.js': ['elapsedMs < 5000'],
  'perf/git-retry-bounded-wait.test.js': ['elapsed < 1000'],
  'perf/premise-self-check-timeout.test.js': ['Date.now() - start < 4000'],
  'perf/session-failures-lock-wait.test.js': ['Date.now() - start < 2000', 'Date.now() - start < 2000'],
  'perf/flow-preflight-concurrency.test.js': ['Date.now() - t0 < 600'],
  'perf/wrap-up-pack-concurrency.test.js': ['wall < 600'],
  'perf/reconcile-time-bounds.test.js': ['elapsed < 2500', 'Date.now() - start < 1000'],
};

test('#3939 AC2.1: every budget moved out of tests/ is a real match in its perf/ file', () => {
  for (const [rel, sites] of Object.entries(MOVED_TO_PERF)) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.deepEqual(findBudgetAssertions(src).map((h) => h.text), sites, rel);
  }
});
```

- [ ] **Step 2: Run to verify it fails, then passes.** Before Tasks 1-7 land the perf files this test fails with ENOENT; after them:

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: PASS. Go-red check (scratch, not committed): change one perf file's bound (e.g. `wall < 600` → `wall < 601`), re-run, see this test fail naming that file; restore.

- [ ] **Step 3: Update the prose.** ALLOWLIST is now `{}`: replace the comment above it with one saying it is empty since #3939 moved every pinned budget to perf/, and that an entry is for a timing that is inseparable from a functional assertion (`{ sites, reason }`, reason says why). In the header comment, replace "The pinned texts are this scan's floor: a dead or blinded matcher drops sites, and the live-tree test fails on the stale pins." with a sentence saying the floor is `MOVED_TO_PERF`: the moved budgets' texts must still match in perf/, so a dead or blinded matcher fails there.

- [ ] **Step 4: Full verification**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: PASS (AC1.1 with ALLOWLIST empty).
Run: `npm run test:perf`
Expected: PASS — the 3 pre-existing perf files plus the 9 new ones (AC2.1).

- [ ] **Step 5: Commit** (`Pin moved wall-clock budgets in perf/ as the scan's floor — ALLOWLIST is now empty`).

## Spec coverage map

| Spec item | Task(s) |
|---|---|
| Deliverable 1 — split each of the 12 sites, same input and bound | 1-7 |
| Deliverable 2 — remove each moved site from ALLOWLIST | 1-7 (entry deletes), 8 (empty-state prose) |
| Deliverable 3 — decide `pack.durationMs < 600` | Global Constraints decision; Task 6 |
| AC1.1 — npm test passes with ALLOWLIST empty | 1-8 Step 4, final in Task 8 |
| AC2.1 — npm run test:perf runs every moved budget and passes | 1-7 Step 4 per file; Task 8 Step 4 whole run; Task 8's `MOVED_TO_PERF` pin |
| AC3.1 — each tests/ file still passes and still asserts the behaviour the budget guarded | 1-7 Step 4; new deterministic assertions in Tasks 1, 5, 6, 7 |

Waived go-red for Tasks 5-6's overlap counters: they can only go red on a `Promise.all` → sequential regression in the module source, and a scratch source edit is out of scope for a test relocation; the counts were probed against the real modules (3 and 7, serial reads 1).

## Architecture alignment (build, Common Step 4.5)

Both deviations below are classified Beneficial and kept as built:

1. **Five deterministic tests/ assertions, not four.** The whole-branch review found that the dream redact test's remaining `startsWith('TOKEN')` cannot detect the cap being removed. It now also asserts `out.length === 2048`, the uncapped run was confirmed to fail (`1de1777f8`), and its title now names the cap. Go-red checks also ran for the Task 5/6 counters, in scratch copies (`1 !== 3`, `1 !== 7`), which supersedes the waiver above.
2. **Work beyond the deliverable list, done in the same pass.**
   - `docs/journeys/act-on-a-red-wall-clock-budget-scan-3491.md` now describes the post-move state: ALLOWLIST is empty, the floor is `MOVED_TO_PERF`, and a pin is only for a timing that is inseparable from its assertion.
   - Seven tests/ titles that promised timing were reworded to say what each test now asserts.
   - The `MOVED_TO_PERF` failure message names the map it pins (`1de1777f8`).
