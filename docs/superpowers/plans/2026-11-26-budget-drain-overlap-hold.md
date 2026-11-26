# drive.js --budget drain-overlap hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `drive.js --budget` keeps its own list of the PRs it opened and hands it (plus the latest pull's near-duplicate pairs) to every record it drives, so the merge step's existing drain-overlap hold applies to a budget run.

**Architecture:** `runBudget` (budget.js) owns an in-memory array of `{ number }` entries, rewrites `dispatch-drain-prs.json` in its session temp directory after every append, and sets `shared.inFlightPrsFile` / `shared.nearDupPairsFile` before each `driveOne`. A failed write or a record with no final line makes the list sticky-broken: `shared.inFlightPrsFile` then points at a sibling path that does not exist, which `merge.js` already maps to `in-flight-unreadable`. `merge.js` is unchanged.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T051448-record-6117/work/6117-spec.md` (record #6117)

## Global Constraints

- Every effect goes through `deps`: budget.js makes no file call and spawns nothing (budget.js header). Use `deps.writeFile`, `deps.mkdirSync`, `deps.lstatType` (all already in run.js `realDeps`; no `realDeps` change is needed). Never `fs.existsSync` (path-guard conformance scan, `tests/path-guard-conformance.test.js`).
- The session directory is `sessionTmpRoot(sessionId)` from `plugin/bin/lib/session-tmp.js` (pure path, the same root `sessionTmpPath` — which the queue pull uses for `dispatch-near-dup-pairs.json` — joins under). budget.js creates it with `deps.mkdirSync(root, { recursive: true })` instead of calling `sessionTmpPath`, which would `fs.mkdirSync` itself and break the no-file-call rule.
- File names, exact: `dispatch-drain-prs.json` (the list), `dispatch-drain-prs.missing.json` (the never-written sibling used once the list is broken), `dispatch-near-dup-pairs.json` (the pull's pairs file).
- The list file's shape is an array of `{ "number": <pr> }` only.
- `--in-flight-prs` / `--near-dup-pairs` stay refused beside `--budget` (exit 2); `parseArgs` is unchanged.
- Governing skill `.claude/skills/driver-step-addition/SKILL.md`, "A loop above the record", quoted verbatim: "**Facts from the record's ctx, never parsed from its event lines.** `driveRecord` returns the final event plus `outcome`, `claimed` and `claimExit`." — the append reads the returned `facts.final.pr`, never stdout. Also: "**stdout only.** The loop's event sink is never bound to a run directory" — the new stderr lines go through `deps.stderr`, never the event sink; no new event field and no new step name.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Project maturity is `established`: before changing `runBudget`, the existing `tests/bin-lib/driver/budget.test.js` suite is the characterization of current behavior and must stay green.

## Review Focus

- A record whose `final` is present but `final.pr` is `null`/absent (refused, blocked before PR) — appends nothing and does not break the list.
- `deps.lstatType` returning a non-`missing` type for the pairs path that is not a readable file (`unreadable`, `directory`) — set the path anyway so `merge.js` fails closed, never `null`.
- Two records breaking the list (a failed write, then a null final) — exactly one stderr line, from the first.
- The pairs file present on pull 1 and gone on pull 2 — `shared.nearDupPairsFile` goes back to `null` on pull 2.
- `driveOne` throwing — the list is marked broken before the throw propagates (the throw still ends the run as before).

---

### Task 1: The budget loop's drain-PR list

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/budget.js`
- Test: `tests/bin-lib/driver/budget.test.js`
- Waived `plugin/bin/lib/session-tmp.js`: read only, for `sessionTmpRoot` (Step 3 imports it).
- Waived `plugin/bin/lib/driver/merge.js`: read only, its `merge(ctx, deps)` is called unchanged by Step 1's test helper; the hold (`overlapHold`) reads `ctx.inFlightPrsFile` / `ctx.nearDupPairsFile`, which `steps.js` copies from `ctx.shared` (steps.js ~line 1787).

**Interfaces:**
- Consumes: `sessionTmpRoot(sessionId) -> string|null` (session-tmp.js); `merge(ctx, deps) -> Promise<{ outcome, reason, ... }>` (merge.js); `deps.writeFile(p, s)`, `deps.mkdirSync(p, opts)`, `deps.lstatType(p) -> { type, code }`.
- Produces: exported constants `DRAIN_PRS_FILE = 'dispatch-drain-prs.json'`, `DRAIN_PRS_MISSING_FILE = 'dispatch-drain-prs.missing.json'`, `NEAR_DUP_PAIRS_FILE = 'dispatch-near-dup-pairs.json'` from budget.js (added to `module.exports`).

- [ ] **Step 1: Extend the fake and write the failing tests**

In `tests/bin-lib/driver/budget.test.js`:
- Give `fake()` an in-memory filesystem: a `files` Map; `deps.writeFile(p, s)` (records into `calls.writeFile` and sets `files`; throws when an optional `writeFile` hook says so), `deps.readFile(p)` (returns `files.get(p)` or throws an `ENOENT` Error), `deps.mkdirSync()` (no-op, recorded), `deps.lstatType(p)` (`{ type: files.has(p) ? 'file' : 'missing', code: null }`). Expose `files` on the returned object. The session root is `sessionTmpRoot('drive-2026-11-13T090807-4242')` from session-tmp.js (the fixture's date and pid).
- Add a `mergeDriveOne(f, shared, { prs, prViews, supplierCalls })` helper: a `driveOne` that, for record `n`, builds a merge ctx `{ record: n, pr: prs[n], repo: 'o/r', branch: `drive-${n}`, base: 'main', head: 'a'.repeat(40), runDir, runRoot, mainCheckout, worktree, summaryLogged: true, widenedBy: [], inFlightPrsFile: shared.inFlightPrsFile, nearDupPairsFile: shared.nearDupPairsFile }` (a real temp dir for `runDir`, as merge.test.js's `fixture()` makes one), calls the real `merge(ctx, mergeDeps)` and returns `{ final: { pr: prs[n], outcome: r.outcome, merge: { reason: r.reason, detail } }, outcome: r.outcome, claimed: true, claimExit: 0 }`. `mergeDeps` is the minimal set merge.test.js's `defaultMergeScript` uses to reach the hold: `ghAvailable: () => true`; `gh` answering `issue view` with labels `auto:build`, `auto:merge`; `resolvePolicyCore` answering `integration-model` with `pr-first` and `merge-verification` with `merge-when-green` (merge.test.js's `modelReply` / `leverReply` shapes); `readFile` answering `run-state.json` with `{ pr: { number: prs[n] } }` and every other path from `f.deps.readFile` (the in-memory fs); `ghBatch` answering `pr view {pr} --json …` from `prViews[pr]` (`{ state, files: [{ path }], closingIssuesReferences: [{ number }] }`); `node` returning `{ code: 0, stdout: '', stderr: '' }` (log-decision.js); `writeFile` no-op; `emit` recording `{ step, status, detail }`; `judgments` recording a call into `supplierCalls` then returning `{ mergeCheck: { verdict: 'needs-human' }, acceptance: { completed: true } }` (the supplier is reached, then stops `verdict-not-confirmed`, so no merge path beyond it is needed); `now`, `interrupted: () => null`, `env`.

Tests (names carry the AC clause ids):
- `AC1.1, AC1.2, AC5.1, AC5.2: the second record's merge holds drain-overlap on the first record's open PR; the first runs with [] and reaches the supplier` — queue of singletons `[1]`, `[2]`, `prs = { 1: 101, 2: 102 }`, `prViews` 101 `OPEN` with `a.js`, 102 with `a.js`. Assert: the list file read by record 1's hold parsed as `[]` (capture `JSON.parse(files.get(listPath))` inside driveOne before merge for n=1); record 1's merge reason is `verdict-not-confirmed` and `supplierCalls` contains record 1; record 2's `final.merge.reason === 'drain-overlap'`, its detail matches `/in-flight PR 101/`, and `supplierCalls` does not contain record 2; final file content is `[{"number":101},{"number":102}]`.
- `AC2.1, AC2.2: a first PR no longer OPEN does not hold the second record` — same, `prViews[101].state = 'MERGED'`; record 2 reaches the supplier (`verdict-not-confirmed`).
- `AC3.1, AC3.2: a strong pair in the pull's dispatch-near-dup-pairs.json holds the second record near-duplicate` — the fake queuePull writes `files.set(pairsPath, JSON.stringify([{ records: [1, 2] }]))` on every pull; PR 101 `OPEN`, disjoint files (`a.js` vs `b.js`), `closingIssuesReferences: [{ number: 1 }]`; record 2's reason is `near-duplicate`. Also assert `shared.nearDupPairsFile === pairsPath` while driving.
- `pairs file absent: shared.nearDupPairsFile is null, and goes back to null when a later pull leaves no file` — pull 1 writes the pairs file, pull 2 deletes it (`files.delete`) before returning; assert the value seen by driveOne for record 1 is the path and for record 2 is `null`.
- `AC4.1, AC4.2: a failed append makes every later driven record hold in-flight-unreadable` — the injected `writeFile` throws on its second call (the first append; the first call is the `[]` write); queue `[1]`, `[2]`, `[3]`. Assert records 2 and 3 have reason `in-flight-unreadable`; `shared.inFlightPrsFile` ends as `path.join(root, DRAIN_PRS_MISSING_FILE)`; exactly one stderr line matching `/drive\.js: drain-PR list .*failed/` (match `listPath` in it). A second variant throws on the first (`[]`) write: record 1 holds `in-flight-unreadable` too.
- `AC8.1, AC8.2: a driven record returning no final line makes every later record hold in-flight-unreadable` — `driveOne` for record 1 returns `{ final: null, outcome: null, claimed: true, claimExit: 0 }` (no merge call); records 2 and 3 hold `in-flight-unreadable`; exactly one stderr line matching `/#1 .*no final line/`.
- `a final line with no pr appends nothing and keeps the list healthy` — record 1's final `{ pr: null }`; record 2 not held; file content `[{"number":102}]`; no stderr line matching `drain-PR list`.
- `driveOne throwing marks the list broken before the throw propagates` — `assert.rejects(run(f))` with the thrown error; the stderr line names `#1`.
- In the existing AC6.3 test, add an assertion that `f.calls.writeFile` holds exactly one write, `'[]'` to `listPath` (the initial write sits after the `express-driver` check and before the loop, so an empty queue still writes it). Keep the policy tests' "no write" assertions true: add `f.calls.writeFile.length` `0` to the two policy tests' zero-count arrays.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/driver/budget.test.js`
Expected: FAIL — the new cases red (no list file is written, record 2 is never held), existing cases green.

- [ ] **Step 3: Implement the list in `runBudget(budget, shared, deps, { driveOne, steps })` in `plugin/bin/lib/driver/budget.js`**

- After `sessionId` is minted: `root = sessionTmpRoot(sessionId)`, `listPath = path.join(root, DRAIN_PRS_FILE)`, `missingPath = path.join(root, DRAIN_PRS_MISSING_FILE)`, `pairsPath = path.join(root, NEAR_DUP_PAIRS_FILE)`. A loop-level `drainPrs = []` and a sticky `listBroken = false`.
- `breakList(why)`: on the first call only, set `listBroken`, write one `deps.stderr` line `drive.js: ${why}; every later driven record holds as in-flight-unreadable\n`; later calls are silent.
- `writeList(what)`: `deps.mkdirSync(root, { recursive: true })` then `deps.writeFile(listPath, JSON.stringify(drainPrs))`; on a throw `breakList(`drain-PR list ${what} failed (${listPath}): ${errorText(err)}`)`. Skipped once `listBroken`.
- Call `writeList('first write')` once before the `for (;;)` loop.
- After each successful `checkedPull`: `shared.nearDupPairsFile = pairsPresent ? pairsPath : null`, where present means `deps.lstatType(pairsPath).type !== 'missing'`; a throwing `lstatType` counts as present (fail closed: merge.js then reads and holds).
- Before each `driveOne(n)`: `shared.inFlightPrsFile = listBroken ? missingPath : listPath` (never cleared between records).
- `driveOne(n)` in a `try`; on a throw `breakList(`#${n} threw before returning its final line`)` and rethrow. After it returns: no `facts.final` → `breakList(`#${n} returned no final line`)`; else a positive safe-integer `facts.final.pr` → push `{ number: pr }` and `writeList(`append for #${n}`)`. This happens before the existing interrupt check and counting.
- Update the module header's "Every effect goes through `deps`" paragraph to name the list file and the pairs path, and why (one or two sentences).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/budget.test.js`
Expected: PASS, every case.

- [ ] **Step 5: Prove the new tests discriminate (AC7.1, AC7.2)**

Never `git stash`. Copy the edited budget.js aside (`cp -p plugin/bin/lib/driver/budget.js "{scratchpad}/budget.js.new"`), restore the pre-change file with `git show HEAD:plugin/bin/lib/driver/budget.js > plugin/bin/lib/driver/budget.js`, run `node --test tests/bin-lib/driver/budget.test.js` and record which new cases fail (every new case must fail; the pre-existing ones may fail only where they reference the new exports), then restore with `cp -p "{scratchpad}/budget.js.new" plugin/bin/lib/driver/budget.js` and re-run to green.
Expected: every new case red on the reverted file; all green after restoring.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/budget.js tests/bin-lib/driver/budget.test.js
git commit -m "Give drive.js --budget its own drain-PR list — the merge step's drain-overlap hold now applies to a budget run (refs #6117)"
```

### Task 2: Say so in the usage, header and docs

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/run.js` (USAGE lines only)
- Modify: `plugin/bin/drive.js` (header comment only)
- Modify: `docs/driver.md` ("Picking records: `--budget`" and the merge step's "**The drain-overlap hold.**" paragraph)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: Task 1's file names (`dispatch-drain-prs.json`, `dispatch-near-dup-pairs.json`).
- Produces: nothing code-facing.

- [ ] **Step 1: Write the failing test**

In `tests/bin-lib/driver/run.test.js`, beside `#5232 the hold flags are in the usage text`, add `#6117 USAGE says --budget applies the hold with its own list`: `assert.match(USAGE, /--budget[^\n]*holds the merge[^\n]*own list/)` and `assert.match(USAGE, /not with --budget or --check/)`. The existing `['--budget', '2', '--in-flight-prs', 'f.json']` exit-2 row (AC6.1, AC6.2) stays as is.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "6117|5232" tests/bin-lib/driver/run.test.js`
Expected: FAIL on the new case only.

- [ ] **Step 3: Edit the prose**

- `run.js` USAGE: the `--budget` line gains that each driven record's merge holds on a PR this run opened earlier (its own list, `dispatch-drain-prs.json` in the run's session temp directory, plus the latest pull's `dispatch-near-dup-pairs.json`); the `--in-flight-prs` line's "with no --in-flight-prs no hold is applied" becomes scoped to a named record, and keeps "not with --budget or --check", adding why: the loop builds both inputs itself.
- `drive.js` header: the same two edits on its mirrored lines (14, 16) and the "--in-flight-prs is the one flag whose absence…" paragraph (lines 19-21) names `--budget` as the second caller that applies the hold.
- `docs/driver.md`: a bullet in "Picking records: `--budget`" stating the list, its file, the pairs file read after each pull, the fail-closed rule (a failed write or a record with no final line makes every later record hold `in-flight-unreadable`), and that only this run's own PRs are listed (Non-Goals); the `**The drain-overlap hold.**` paragraph names `--budget` beside dispatch's driver route; line 21's "refused with `--budget`" gains "because the loop builds both itself".

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/run.js plugin/bin/drive.js docs/driver.md tests/bin-lib/driver/run.test.js
git commit -m "Document the --budget drain-overlap hold — usage, header and driver docs (refs #6117)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverables 1-5 | Task 1 Step 3 |
| Deliverable 6 | Task 2 |
| AC1-AC5, AC8 | Task 1 Step 1 |
| AC6 | existing `run.test.js` row, Task 2 Step 1 |
| AC7 | Task 1 Step 5 |
| Gotcha: set fields before each driveOne, never clear | Task 1 Step 3 |
| Gotcha: append only after driveOne returns | Task 1 Step 3 |
| Gotcha: re-check the pairs file after each pull | Task 1 Step 3, pairs-absent test |
| Gotcha: open records touching the same files (#5884, #5661, #5659, #5653, #5657) | checked at plan time 2026-11-26: all still OPEN, nothing merged to rebase onto |
