# Close Dead Runs in Report-Only Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure run-disposition function (close / leave / orphan) that reconcile evaluates in report-only mode, skip every archive path for a `live` run, narrow the SessionStart banner to dead orphaned runs with an overflow line, and make SessionEnd archive the session's own ad hoc run.

**Architecture:** `plugin/bin/lib/run-liveness/disposition.js` is pure (the spec's 14-row table); `facts.js` next to it gathers its inputs through injectable git/PR runners and maps every failed probe to the "cannot determine" value. `archiveMerged` computes one liveness verdict per run at the top of its main loop (skip on `live`), then — after both archive loops — evaluates the disposition for every remaining non-clean run and returns `runDispositions`; reconcile persists it to `reconcile-cache.json`, renders it in the summary, and the SessionStart banner reads the cached `orphaned` list offline. SessionEnd archives an own ad hoc run (archive first, close the archived copy second — the same moves-first/close-last order archive-merged.js's `abandoned-interrupted` path uses).

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T222042-record-3977/work/3977-spec.md` (record #3977)

## Global Constraints

- Report-only: the new rows write nothing to any run directory (no `run-state.json` change, no `decisions.md` line, no archive move, no staged drop). The only new writes are reconcile's summary and `reconcile-cache.json`.
- `RUN_AUTO_CLOSE_REPORT_ONLY = true`, a module constant in `plugin/bin/lib/reconcile/archive-merged.js`, read at exactly one site.
- A probe error / missing fact is the "cannot determine" value, never a value that closes: `pr: 'unknown'`, `uniqueCommits: null`, `dirty: null`, verdict `unknown` all yield `leave`.
- Never treat a missing `owner` block as dead; `runLiveness` is the only judge.
- Banner stays network-free; nothing is listed before the first reconcile pass writes the cache.
- SessionEnd close: own-run attribution only (`ctx.ownedRun`, never `ctx.runDir`), never under `attribution: 'fallback'`, never for a nested session (`isNestedSession`).
- Terminal SessionEnd reasons (verified against Claude Code 2.1.311's hook-input enum `["clear","resume","logout","prompt_input_exit","other"]`): `logout`, `prompt_input_exit`, `other`. `clear`, `resume` and any unlisted value are non-terminal.
- Row 12's quiet floor is `STALE_INTERRUPTED_TTL_MS` (24 h), reused, not a new constant.
- Review findings are the `review-unconfirmed-`, `review-contested-`, `review-debate-` staged prefixes; `dropFindings` uses reason vocabulary `run-abandoned` (report only).
- Hooks never break a session: every new hook-side call is inside `try/catch`.

## Spec drift resolved at build (recorded as `premise reversed` in decisions.md)

- `abandoned-interrupted` no longer uses a bare 24 h recency test: #4421 already routes it through `defaultRunVerdict` (the spec's #3979 replacement landed). The loop-top `live` skip still applies to it; nothing else about it changes.
- A sixth kind, `adhoc-session-ended` (#4179), exists; it gets the `live` skip too.
- `classifyRunDir` already takes a `liveness` *function* (#4179). The precomputed verdict is passed as `ctx.runLivenessResult` (`{ verdict, evidence }`), and `abandoned-interrupted` reuses it instead of calling `runVerdict` a second time.
- The summary renders the dispositions through dedicated formatter lines (`would close ...`, `unknown liveness: N run dirs`) rather than a `CATEGORIES` row: `CATEGORIES` counts action-tagged entries inside an array field and cannot render per-run evidence lines.
- SessionEnd archives first and closes the archived copy second (not close-then-archive): a failed archive must leave the run non-terminal and retryable, the invariant `archiveRunDir`'s own header states.
- The clean-status sweep (`iterCleanRunDirs`) gets no `live` skip: a clean run is wrap-up's own just-closed run, archived post-merge by the session that is still alive.

## Review Focus

1. A formal run whose PR lookup failed (gh absent, GraphQL blocked, network) must never read as `none` — Task 3 test `facts: a pr lookup failure maps to unknown`.
2. A staged dir that cannot be read must count as "other staged" (fail toward orphan, never close) — Task 1 test `unreadable staged entry is other staged`.
3. A run dir with no `run-state.json` must be `unknown` at the loop-top guard (not runLiveness's legacy `dead`) — Task 4 test `no run-state.json reads unknown at the guard`.
4. A cached orphan whose run dir has since been archived or deleted must not be listed — Task 7 test `banner drops a cached orphan whose dir is gone`.
5. SessionEnd archive refusal must fall back to today's `interrupted` stamp, never leave a half-closed run — Task 8 test `archive refusal falls back to the interrupted stamp`.

---

### Task 1: Pure disposition function

**Files:**
- Create: `plugin/bin/lib/run-liveness/disposition.js`
- Test: `tests/bin-lib/run-liveness/disposition.test.js`

**Interfaces:**
- Produces: `disposition({ shape, verdict, pr, prNumber, prDraft, branch, worktree, staged, quietMs }) -> { action: 'close'|'leave'|'orphan', reason: string, evidence: object, dropFindings: string[] }`
  - `shape`: `'adhoc' | 'standalone' | 'formal'`; `verdict`: `'live'|'dead'|'unknown'`; `pr`: `'merged'|'closed-unmerged'|'open'|'none'|'unknown'`; `prNumber`: integer|null; `prDraft`: boolean|null; `branch`: `{ name, localExists, remoteExists, uniqueCommits }` (`uniqueCommits` integer|null); `worktree`: `{ path, exists, dirty }` (`dirty` boolean|null); `staged`: string[] (relative entries as `listStagedItems` returns them); `quietMs`: ms since the last owner-attributed event (or run-id time), or null.
  - `shapeOf(runDir) -> 'adhoc'|'standalone'|'formal'` — `-adhoc-standalone` suffix → adhoc; any other basename containing `-standalone` → standalone; else formal.
  - `isReviewFinding(entry) -> boolean` — basename matches `/^review-(unconfirmed|contested|debate)-/`; an `(unreadable: ...)` entry is never a finding.
  - Exports `CLOSE_REASONS` (frozen Set: `'adhoc-dead'`, `'standalone-dead'`, `'pr-closed-unmerged'`, `'nothing-to-resume'`), `STAGED_OUTCOME_REASON = 'staged items need an outcome'`, `DROP_REASON = 'run-abandoned'`.
- Reasons by row (first match wins, default `leave` / reason `default`): 1 `live`→leave `live`; 2 `unknown`→leave `verdict-unknown`; 3 adhoc dead staged-ok→close `adhoc-dead`; 4 adhoc dead other→orphan `staged items need an outcome`; 5 standalone dead staged empty→close `standalone-dead`; 6 standalone dead staged non-empty→leave `standalone-staged`; 7 formal `merged`→leave `pr-merged`; 8 formal closed-unmerged staged-ok→close `pr-closed-unmerged` + `dropFindings`; 9 → orphan staged; 10 formal open→orphan `draft PR #N, session gone` (prDraft true) or `PR #N open, session gone`; 11 formal `none` and (`uniqueCommits > 0` → `unpushed commits on {branch.name}`, else `dirty === true` → `uncommitted changes in {worktree.path}`); 12 formal `none`, (`!localExists && !remoteExists` or `uniqueCommits === 0`), (`!worktree.exists` or `dirty === false`), `quietMs > STALE_INTERRUPTED_TTL_MS`, staged ok → close `nothing-to-resume` + `dropFindings`; 13 → orphan staged; 14 anything else (any `unknown`/`null` fact) → leave `default`.
- Rows 11/12 must check `uniqueCommits === null` and `dirty === null` before deciding: a null in a fact the row reads falls to row 14. `localExists`/`remoteExists` are only trusted as booleans (anything else → row 14).

- [ ] **Step 1: Write the failing tests** — one test per row 1-14 asserting `action` and `reason` (row 8/12 also assert `dropFindings` equals the review-finding entries and `evidence.verdict`); plus: `verdict unknown leaves every shape` (adhoc/standalone/formal with otherwise-closing facts); `pr unknown leaves even when every other fact says close`; `uniqueCommits null leaves`; `dirty null leaves`; `unreadable staged entry is other staged` (`'staged/ (unreadable: EACCES)'` → row 4 orphan for adhoc); `quiet under 24h leaves` (row 12 facts with `quietMs = STALE_INTERRUPTED_TTL_MS`); `CLOSE_REASONS lists exactly the close reasons` (every row returning close has its reason in the set).
- [ ] **Step 2: Add the fault-injection tests (AC3).** In the same file, build two faulty variants by wrapping the real function: `failOpenVerdict = (f) => disposition({ ...f, verdict: f.verdict === 'unknown' ? 'dead' : f.verdict })` and `failOpenPr = (f) => disposition({ ...f, pr: f.pr === 'unknown' ? 'none' : f.pr })`. Collect the `unknown`-verdict and `pr: 'unknown'` cases from Step 1 into two arrays of `{ facts, expected }`, and assert with a helper `assertCase(fn, c)` that the real function passes all of them and that each faulty variant fails at least one (`assert.throws(() => cases.forEach((c) => assertCase(failOpenVerdict, c)))`).
- [ ] **Step 3: Run** `node --test tests/bin-lib/run-liveness/disposition.test.js` — Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `disposition.js` (require `STALE_INTERRUPTED_TTL_MS` is not possible without a cycle into reconcile — define `QUIET_FLOOR_MS = 24 * 60 * 60 * 1000` here and, in Task 5, assert in a test that it equals `archive-merged.js`'s `STALE_INTERRUPTED_TTL_MS`). No I/O, no `Date.now()`.
- [ ] **Step 5: Run** the test — Expected: PASS.
- [ ] **Step 6: Commit** `Add run disposition table for report-only auto-close — refs #3977`.

### Task 2: Carry `isDraft` on the PR-state join

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js` (`PR_LIST_ARGS`, `PR_VIEW_JSON_FIELDS`, `buildBulkQuery`'s node selection)
- Modify: `plugin/bin/lib/reconcile/pr-state-batch.js` (`PR_FIELDS`, the node mapping near line 61)
- Test: `tests/bin-lib/reconcile/pr-state.test.js`, `tests/bin-lib/reconcile/pr-state-batch.test.js`

**Interfaces:** Produces `prState.isDraft` (boolean, absent on answers cached before this change — consumers treat anything but `true` as not draft).

- [ ] **Step 1:** Add tests: the `gh pr list` / `gh pr view` argv each name `isDraft`; the bulk query text contains `isDraft`; the batch mapping copies `isDraft: true` from a node.
- [ ] **Step 2:** Run both files — Expected: FAIL.
- [ ] **Step 3:** Add `isDraft` to the four field lists and the batch mapping.
- [ ] **Step 4:** Run both files plus `tests/bin-lib/reconcile/pr-state-cache.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `Carry isDraft on reconcile's PR-state join — refs #3977`.

### Task 3: Facts gatherer

**Files:**
- Create: `plugin/bin/lib/run-liveness/facts.js`
- Test: `tests/bin-lib/run-liveness/facts.test.js`

**Interfaces:**
- Consumes: Task 1 `shapeOf`; `listStagedItems` (archive-merged.js — inject it as `deps.listStaged` to avoid a require cycle; default lazily requires `../reconcile/archive-merged`); `ownEventRecency` + `runIdMs` (run-liveness).
- Produces: `gatherFacts({ root, dir, state, branch, integration, prState, now, deps }) -> { shape, pr, prNumber, prDraft, branch, worktree, staged, quietMs }` — the Task 1 input minus `verdict`.
  - `prFact(prState) -> { pr, prNumber, prDraft }`: object with `state` `MERGED`→merged, `CLOSED`→closed-unmerged, `OPEN`→open; `null`→none; any string (`'gh-absent'`, `'network-failure'`, `'pr-not-found'`, `'invalid-arguments'`) or `undefined` (not looked up — the SessionStart fast path) → unknown.
  - `deps.git(args, cwd) -> { stdout, failure }` (default: `hooks/git-exec.js`'s `runGit`). Branch: `rev-parse --verify --quiet refs/heads/{b}` and `refs/remotes/origin/{b}` (exit 1 with no output → false; any other failure → null); `uniqueCommits = rev-list --count origin/{integration}..refs/heads/{b}` when local exists, `0` when neither ref exists, else null; failure → null. No branch name → `{ name: null, localExists: null, remoteExists: null, uniqueCommits: null }`.
  - Worktree: `state.worktree` absent → `{ path: null, exists: false, dirty: false }`; `lstatType` missing → `exists: false, dirty: false`; present → `git -C {wt} status --porcelain` (empty → false, non-empty → true, failure → null); an lstat error → `exists: null, dirty: null`.
  - `quietMs`: `now - (lastOwnMs ?? runIdMs(dir))` when `ownEventRecency(dir).readable`, else null.
  - Never throws: any thrown error inside returns the facts with every field at its unknown value.

- [ ] **Step 1:** Tests with a fake `deps.git` (map of argv-joined → result) and tmp dirs: `facts: a pr lookup failure maps to unknown` (each failure string and `undefined`); `prFact maps MERGED/CLOSED/OPEN/null`; `prDraft true only when isDraft === true`; `branch absent everywhere yields uniqueCommits 0`; `rev-list failure yields uniqueCommits null`; `git status failure yields dirty null`; `missing worktree path yields exists false`; `staged lists top-level and spec-N entries`; `unreadable events log yields quietMs null`; `a throwing dep yields all-unknown facts`.
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `Add the disposition facts gatherer — refs #3977`.

### Task 4: `live` skip at the top of archiveMerged's main loop

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveMerged` main loop ~line 2288; `classifyRunDir` `abandoned-interrupted` branch ~line 1837)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `runVerdict` (existing injectable, default `defaultRunVerdict(dir, now)`).
- Produces: `classifyRunDir` ctx key `runLivenessResult` (`{ verdict, evidence }`): when present, `abandoned-interrupted` uses it instead of calling `runVerdict`. archiveMerged keeps a per-pass `Map<dir, {verdict, evidence}>` (`verdicts`) Task 5 reuses.
- Guard (first statement of the loop body, before `isArchivedPendingTrackedMove`): `state === null` → `{ verdict: 'unknown', evidence: [] }` without asking; otherwise `runVerdict(dir, now)` in try/catch (throw → unknown). `verdict === 'live'` → `skipped.push({ runDir: dir, reason: 'live' })`, `continue` (not tracked toward structurally-stuck).

- [ ] **Step 1:** Tests (inject `runVerdict`): one per path — `live skips the merged path`, `live skips orphaned-mint` (a stale config-less dir with a run-state.json), `live skips adhoc-superseded`, `live skips adhoc-session-ended`, `live skips abandoned-interrupted` (the #3845 shape: status `interrupted`, owner pid alive — use a real live-PID fixture: `owner: { pid: process.pid, ... }` with `pidStartedAt` from `run-liveness/process-probe.js`'s `pidStartTime(process.pid)`, and *no* `runVerdict` injection, so the real verdict is exercised); `unknown still acts on merged, orphaned-mint and adhoc-superseded` (inject unknown); `no run-state.json reads unknown at the guard` (spy `runVerdict` is never called for that dir); `the verdict is computed once per run` (spy count equals the number of non-clean dirs).
- [ ] **Step 2:** Run the file — Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the guard and `runLivenessResult`.
- [ ] **Step 4:** Run `node --test tests/bin-lib/reconcile/` and `tests/reconcile.test.js`. An existing fixture that now reads `live` only because its worktree carries a seconds-old commit gets `runVerdict: () => ({ verdict: 'unknown', evidence: [] })` injected in that test — never loosen the guard. List every such fixture in the commit body.
- [ ] **Step 5: Commit** `Skip every archive path for a live run — refs #3977`.

### Task 5: Report-only disposition pass

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js`
- Test: `tests/bin-lib/reconcile/archive-merged-dispositions.test.js` (new, so the 5.9k-line file does not grow), `tests/bin-lib/reconcile/report-only-constant.test.js` (source scan)

**Interfaces:**
- Consumes: Task 1 `disposition`, `shapeOf`; Task 3 `gatherFacts`; Task 4 `verdicts` map; `resolveRunPrState`, `runDirBranch`.
- Produces: `RUN_AUTO_CLOSE_REPORT_ONLY` (exported); `reportRunDispositions({ root, worktrees, verdicts, exclude, prStates, integration, now, runVerdict, deps }) -> { reportOnly: true, wouldClose: [{ runId, runDir, reason, evidence, dropFindings }], orphaned: [{ runId, runDir, reason, pr }], unknown: number }` — iterates `iterRunDirsWithState(root)` (dirs this pass archived are excluded by `exclude`, a Set of the `archived` list, so a dry run does not double-report them), skips ad hoc dirs only where the table says so (never — ad hoc rows 3/4 apply), reuses `verdicts.get(dir)` (computes it the Task 4 way when absent), counts `unknown` verdicts. `orphaned` and `wouldClose` sorted by run id, newest first. `pr` is the PR number or null. Evidence: `{ verdict, pr, prNumber, uniqueCommits, dirty, staged: n }`.
- archiveMerged's return gains `runDispositions` — the one read of the constant: `const runDispositions = RUN_AUTO_CLOSE_REPORT_ONLY ? reportRunDispositions(...) : null;` with a comment that #3978 replaces the `null` arm with the act path and deletes the constant. Errors inside the pass are caught and return `{ reportOnly: true, wouldClose: [], orphaned: [], unknown: 0, error: message }`.

- [ ] **Step 1:** Source-scan test: strip comments with `tests/helpers/strip-comments.js` (use its stripper-verdict check as `tests/bin-lib/exit-code-conformance.test.js` does), count `RUN_AUTO_CLOSE_REPORT_ONLY` reads in `plugin/bin/**/*.js` excluding its declaration and the `module.exports` line — Expected exactly 1; include a go-red self-test feeding a synthetic source with two reads.
- [ ] **Step 2:** Fixture tests (real git repo via the archive test helpers; inject `runVerdict` dead/live per dir and a fake `prStates` with `byNumber`/`byBranch`): AC4 `three dead runs yield three would-close lines and leave the tree byte-identical` (dead ad hoc, dead closed-unmerged formal, dead no-PR formal with nothing to resume and quiet >24h; snapshot every file's bytes + the dir list before/after a **non-dry-run** pass); AC5 `open draft PR and unpushed commits are orphan, not would-close`; AC6 `non-review staged item orphans with staged reason` and `review-only staged closed-unmerged run lists dropFindings and drops none`; `live and unknown runs appear in neither list` + `unknown is counted`; `QUIET_FLOOR_MS equals STALE_INTERRUPTED_TTL_MS`.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run both new files plus `tests/bin-lib/reconcile/archive-merged.test.js` — PASS.
- [ ] **Step 6: Commit** `Evaluate run dispositions in report-only mode — refs #3977`.

### Task 6: Persist and render the report

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (result init line 149, archive block ~545, `overBudget` ~414, `finalize` ~665), `plugin/bin/lib/reconcile/cache.js` (`readCache`, new `applyRunDispositions`), `plugin/bin/lib/reconcile/format-summary.js`, `plugin/bin/hooks.js` (the `reconcile-threw` fallback object, line ~1715)
- Test: `tests/bin-lib/reconcile/cache.test.js`, `tests/reconcile.test.js` (or the format-summary suite — grep `formatSummary` under `tests/`)

**Interfaces:**
- `result.runDispositions` (null when archive did not run) — added to both the index.js init object and hooks.js's fallback object.
- `applyRunDispositions(cache, report, nowMs) -> cache` (pure): sets `wouldClose` (`[{ runId, runDir, reason, evidence }]`), `orphaned` (`[{ runId, runDir, reason, pr }]`), `reportOnlyPassAt` (ISO of `nowMs`). Written only on a real (non-dry) pass, in `finalize` and in `overBudget` (same pattern as `applyOwnerlessNonClean`), and only when `runDispositions` has no `error`.
- `readCache` keeps `wouldClose`/`orphaned` only as arrays of objects with a string `runId` and `reason`, and `reportOnlyPassAt` only as a parseable date string.
- Summary lines (after the ownerless line): one `would close {runId} ({reason}, evidence: {k=v, ...})` per entry (append `, would drop {n} finding(s): run-abandoned` when `dropFindings` is non-empty); `orphaned: N run dirs` when N > 0; `unknown liveness: N run dirs` when N > 0.

- [ ] **Step 1:** Tests: `applyRunDispositions stamps reportOnlyPassAt and both lists`; `readCache drops malformed wouldClose/orphaned entries`; `formatSummary renders one would-close line per entry with evidence`; `formatSummary renders the unknown count, never for 0`; `a dry run writes no dispositions to the cache` (index-level, via the existing reconcile test harness).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run `node --test tests/bin-lib/reconcile/ tests/reconcile.test.js tests/hooks-dispatcher.test.js` — PASS.
- [ ] **Step 5: Commit** `Persist and render the report-only disposition pass — refs #3977`.

### Task 7: Banner lists only dead orphaned runs

**Files:**
- Modify: `plugin/bin/lib/hooks/session-residue.js` (`collectStaleRuns`), `plugin/bin/lib/hooks/session-start.js` (lines 165-178), `plugin/bin/hooks.js` (`runCheckSessionResidue`, ~1528)
- Test: `tests/bin-lib/hooks/session-residue.test.js`, `tests/hooks-session-start.test.js`

**Interfaces:**
- Consumes: Task 6 cache `orphaned`; `defaultRunVerdict` (archive-merged.js) as the default `liveness` option.
- Produces: `collectStaleRuns(cwd, { cache, exclude, pluginRoot, liveness, readCache }) -> Array<{ dir, state, line }>` — unchanged element shape; when more than `MAX_REPORTED` rows pass the filter, one extra trailing element `{ dir: null, state: null, overflow: N, line }` with `line = ORPHANED_OVERFLOW_LINE(N, root)` = `` `- … and ${N} more orphaned run(s) (newest ${MAX_REPORTED} shown): node "${root}/bin/hooks.js" reconcile --dry-run --json --checks archive` ``. Exports `ORPHANED_OVERFLOW_LINE`.
- Filter: a non-clean, non-ad-hoc, non-excluded dir (from `iterRunDirsWithState`) is listed only when the cached `orphaned` list (read via `reconcile/cache.js`'s `readCache(mainCheckoutRoot(cwd) || cwd)`) names its run id AND `liveness(dir).verdict === 'dead'` now. Newest run id first.
- Row text: the existing shipped-unclosed / consolidated-pass text when it applies (unchanged code paths); otherwise `` `${base} — ${reason}: resume with PIPELINE_RUN_DIR="${dir}" /claude-tweaks:flow ${ids}` `` where `ids` is the run's record set (`runRecordSet` from archive-merged.js, sigil per work-backend as today); a run whose slug names no record ends `` `— ${reason}: list with node "${root}/bin/hooks.js" reconcile --dry-run --json --checks archive` ``.
- session-start.js: drop the "Say with it that only the session owning a run should close it..." sentence; reword the banner header to `claude-tweaks: orphaned pipeline run(s) whose session is gone, under .claude-tweaks/pipelines/:` and the trailer to "Relay this list once ... one line per run naming its resume command — never run it yourself." (keep the relay directive's shape). hooks.js check-session-residue: its `resolve with:` trailer names the resume command instead of close-run.

- [ ] **Step 1:** Tests (inject `liveness` and write `reconcile-cache.json` in the tmp project): AC7 `five dead orphans print three rows and one overflow line naming 2 and the listing command`; `three dead orphans print no overflow line`; `live, unknown, would-close-only or no cache print nothing`; `a cached orphan whose verdict is now live is dropped`; `banner drops a cached orphan whose dir is gone`; AC8 `each row names its reason and a resume command`; in `tests/hooks-session-start.test.js`: `session-start.js no longer carries the owning-session warning` (grep the source for `only the session owning a run should close it` — absent).
- [ ] **Step 2:** Migrate the existing `collectStaleRuns` tests (session-residue.test.js lines 31-74 and 359-448, and any in hooks-session-start.test.js): each now seeds the cache `orphaned` entry and injects a `dead` liveness so it keeps testing what it tested (cap, exclude, ad-hoc skip, shipped-unclosed text, consolidated-pass suffix and its sigil variants).
- [ ] **Step 3:** Run — new tests FAIL. **Step 4:** Implement. **Step 5:** Run `node --test tests/bin-lib/hooks/session-residue.test.js tests/hooks-session-start.test.js tests/hooks-dispatcher.test.js` — PASS.
- [ ] **Step 6: Commit** `Narrow the unfinished-runs banner to dead orphaned runs — refs #3977`.

### Task 8: SessionEnd archives the session's own ad hoc run

**Files:**
- Modify: `plugin/bin/lib/hooks/session-end.js`, `plugin/bin/lib/hooks/close-run-state.js` (`closedBy` option)
- Test: `tests/hooks-session-end.test.js` (new)

**Interfaces:**
- `closeRunState(runDir, { ..., closedBy })` — when a non-empty string, the patch also carries `closedBy`.
- session-end.js exports `TERMINAL_SESSION_END_REASONS = Object.freeze(['logout', 'prompt_input_exit', 'other'])` and `run(ctx, deps)` (`deps.archiveRunDir`, `deps.closeRunState`, `deps.listStagedItems` injectable; defaults lazily required from archive-merged.js / close-run-state.js).
- Flow: unchanged early returns (no owned dir, nested session). Close path when ALL hold: `owned.attribution !== 'fallback'`, `isAdHocRunDir(owned.dir)`, `status !== 'clean'`, `TERMINAL_SESSION_END_REASONS.includes(ctx.input.reason)`, every `listStagedItems(owned.dir)` entry `isReviewFinding`. Then: `appendEvent(session-end)` → `archiveRunDir(path.resolve(owned.dir, '..', '..', '..'), owned.dir)` → on `ok`, `closeRunState(archiveDir, { explicit: true, callerIdentity: { sessionId: ctx.input.session_id, cwd: ctx.cwd }, treatCleanAsAlreadyClosed: false, closedBy: 'session-end' })`; no write to `owned.dir` after the archive. On refusal or throw: stamp `{ status: 'interrupted', lastEvent: 'session-end' }` on `owned.dir` if it still exists (the event is already appended). Every other case: today's stamp-then-append, byte for byte.

- [ ] **Step 1:** Tests (tmp main checkout with `git init`, `.claude-tweaks/pipelines/{id}-adhoc-standalone/` with run-state + events.jsonl; build `ctx` by hand): AC9 one test per terminal reason (`logout`, `prompt_input_exit`, `other`) — archived dir exists, live dir gone, archived `run-state.json` has `status: 'clean'` and `closedBy: 'session-end'`, archived `events.jsonl` ends with the `session-end` event, live dir not recreated; `clear` and `resume` and an unlisted reason stamp `interrupted`; `a non-review staged item keeps the interrupted stamp`; `review-only staged items still close`; `a formal run stamps interrupted as before`; `fallback attribution touches nothing new` (no archive, no stamp — today's behaviour: appends the event only); `archive refusal falls back to the interrupted stamp` (inject a refusing `archiveRunDir`).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run the new file plus `tests/hooks-run-attribution.test.js tests/hooks-dispatcher.test.js` — PASS.
- [ ] **Step 5: Commit** `Archive a session's own ad hoc run at SessionEnd — refs #3977`.

### Task 9: Documentation

**Files:**
- Modify: `docs/reconcile-checks.md` (new section after the #4421 section: "Run dispositions in report-only mode (#3977)" — the 14-row table verbatim from the spec, the `live` skip, `RUN_AUTO_CLOSE_REPORT_ONLY` as a release step not a policy key, deleted by the record that enables closing (#3978), the cache keys `wouldClose`/`orphaned`/`reportOnlyPassAt`, and that a false positive is reported through `/claude-tweaks:feedback`); `docs/hooks.md` (session-end's ad hoc close in the run-state/lifecycle paragraph; the stale-run banner now lists dead orphaned runs from the cache); `docs/journeys/finish-a-multispec-run-after-the-parent-session-ended.md` line 24 (banner name).

- [ ] **Step 1:** Edit. **Step 2:** `grep -n "report-only" docs/reconcile-checks.md` shows the switch sentence; `grep -rn "only the session owning a run" plugin docs` returns nothing outside the incident log.
- [ ] **Step 3: Commit** `Document report-only run dispositions — refs #3977`.

### Not a build task: hand review of this repository's report-only output

Deliverable 8 needs the maintainer's agreement on every formal-run `would close` line. The build runs `node plugin/bin/hooks.js reconcile --dry-run --json --checks archive` once after Task 9, records its `runDispositions` in the PR body, and seeds an `ops` ledger row (`reason-not-auto: requires-human-judgment`) for the maintainer's sign-off — the enabling record (#3978) is blocked on it, not this one.
