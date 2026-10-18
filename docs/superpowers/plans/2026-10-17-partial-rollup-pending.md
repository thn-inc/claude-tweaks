# Partial-Rollup Pending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PR whose `statusCheckRollup` is all SUCCESS/SKIPPED but which still has a workflow run for its head sha that has not completed classifies as **pending**, never green — in the classifier code twin, in the shared PR-check reader, and in the merge gate's prose (initial classification and the bounded watch's `RC=0` branch).

**Architecture:** `classifyRollup` (`plugin/bin/lib/pr-checks/classify.js`, the code twin of `_shared/pr-first-merge.md` Step 2.5) gains an optional `headRuns` input — the `gh run list --commit {headRefOid}` rows for the PR head. A head run with a failing conclusion is red; a head run whose status is not `completed` is pending. `bin/pr-checks.js` fetches those rows and passes them. Step 2.5's prose states the same cross-check, adds it to the bounded watch's green exit, and records the PR #3390 capture in its Signatures list.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183739-record-3405/work/3405-spec.md`

Scope keywords: classifyRollup, pr-checks.js

Consumers reviewed, no edit (each cites Step 2.5's classification rather than restating it, or reads the rollup for display/hygiene, not a merge decision — they inherit the cross-check through the citation): `plugin/skills/dispatch/resume-confirmation.md`, `plugin/skills/release/execute.md`, `plugin/skills/wrap-up/review-console-interactive.md`, `plugin/skills/dispatch/settle-parked.md`, `plugin/skills/dispatch/close-out.md`, `plugin/skills/tidy/actions-github-issues.md`, `plugin/skills/_shared/github-pr-scan.md`, `plugin/bin/lib/wrap-up/pack.js`, `tests/bin-lib/wrap-up/pack.test.js`, `tests/sweep-backstop.test.js`, `docs/journeys/ci-test-gate.md`, `docs/journeys/learn-of-a-windows-regression-after-merge.md`, `docs/journeys/stop-a-run-on-its-own-red-pr-check-3013.md`, `docs/superpowers/plans/2026-10-17-windows-regression-guard-3316.md`, `plugin/skills/review/code-mode-steps.md` and `docs/skill-graph.md` (route on `pr-checks.js`'s `state`, which keeps its vocabulary).

## Global Constraints

- `headRuns` is optional: omitted (`undefined`) → today's behavior exactly. Supplied but not an array → `read-failed` (reason `malformed-head-runs`), never green.
- Head-run rows are `gh run list --json` shape: lowercase `status` (`queued`, `in_progress`, `completed`, `waiting`, `requested`, `pending`) and lowercase `conclusion` (`success`, `failure`, `skipped`, `cancelled`, …, `""` while running). Compare case-insensitively against `FAILING_CONCLUSIONS` (uppercase).
- `gh run list --commit` needs the **full 40-char sha** — an abbreviated sha returns `[]` (captured 2026-10-17 on PR #3425). Always pass `headRefOid` as read, with `--limit 100`.
- Order stays red first: rollup failing OR head-run failing → red; then rollup pending OR head-run not completed → pending; then the empty-rollup rule; then green.
- An empty `headRuns` array adds nothing (the rollup rules decide) — external, non-Actions CI has no runs.
- Commit style `{Verb} {what} — {detail}`, body `refs #3405` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01GPVFrDtrFKL7j22WMcW6Mf`.

## Review Focus

- A completed head run with conclusion `cancelled` (concurrency-superseded) must not read red or pending — Task 1 test `a cancelled completed head run is neither red nor pending`.
- A head run listed under `name` with no `workflowName` must still produce a named pending/failing entry — Task 1 test `pending entries are named by workflowName, falling back to name`.
- `gh run list` failing (network) in `pr-checks.js` must be `read-failed`, never green — Task 2 test.
- Rollup red and head runs pending together → red (red wins) — Task 1 test.
- Empty rollup + empty head runs + PR CI → still pending (empty-rollup rule unchanged) — Task 1 test.

---

### Task 1: `classifyRollup` cross-checks head-sha workflow runs

**Files:**
- Modify: `plugin/bin/lib/pr-checks/classify.js`
- Test: `tests/bin-lib/pr-checks/classify.test.js`

**Interfaces:**
- Produces: `classifyRollup({ rollup, headRefOid, localHead, hasPrCi, headRuns? }) -> { state, failing:[{name,url}], pending:[name], headRefOid, reason? }` (shape unchanged). New export `normalizeHeadRun(row) -> { name, url, status, conclusion }` with `status`/`conclusion` uppercased (`''`/missing conclusion → `null`), `name` = `row.workflowName || row.name || null`, `url` = `row.url || null`.

- [ ] **Step 1: Write the failing tests** (covers AC1.1, AC2.1; append to `classify.test.js`; helper `hr = (workflowName, status, conclusion) => ({ name: workflowName, workflowName, status, conclusion, url: `https://ci.example/runs/${workflowName}`, event: 'pull_request' })`):
  - `a green rollup with a head run still in_progress is pending (PR #3390 shape)`: rollup `[run('label-fix-branch','COMPLETED','SUCCESS'), run('cleanup-fix-labels','COMPLETED','SKIPPED')]`, `headRuns: [hr('test','in_progress',''), hr('Track issue fixes across branches','completed','success')]` → `state === 'pending'`, `pending` deep-equals `['test']`.
  - `every head run completed and successful is green`: same rollup, `headRuns: [hr('test','completed','success'), hr('Track issue fixes across branches','completed','success')]` → `'green'`.
  - `the pending assertion discriminates: classifying without headRuns reads the same rollup green` — same rollup, `headRuns` omitted → `'green'` (documents the bug the cross-check closes).
  - `a completed head run with a failing conclusion is red`: green rollup, `headRuns: [hr('test','completed','failure')]` → `'red'`, `failing` deep-equals `[{ name: 'test', url: 'https://ci.example/runs/test' }]`.
  - `rollup red wins over a pending head run`: rollup `[run('test','COMPLETED','FAILURE')]`, `headRuns: [hr('lint','queued','')]` → `'red'`.
  - `a cancelled completed head run is neither red nor pending`: green rollup, `headRuns: [hr('test','completed','cancelled')]` → `'green'`.
  - `pending entries are named by workflowName, falling back to name`: `normalizeHeadRun({ name: 'job', status: 'queued', conclusion: '' })` deep-equals `{ name: 'job', url: null, status: 'QUEUED', conclusion: null }`.
  - `an empty headRuns array leaves the rollup rules in charge`: rollup `[]`, `headRuns: []`, `hasPrCi: true` → `'pending'`; green rollup + `headRuns: []` → `'green'`.
  - `a non-array headRuns is read-failed, never green`: green rollup, `headRuns: null` → `state 'read-failed'`, `reason 'malformed-head-runs'`.
  - `stale still wins over head runs`: `headRefOid` ≠ `localHead`, `headRuns: [hr('test','in_progress','')]` → `'stale'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: FAIL after Step 1 — the in_progress-head-run test reads `green`, `normalizeHeadRun` is not a function.

- [ ] **Step 3: Implement** `normalizeHeadRun` and the `headRuns` branch in `classifyRollup`. Check `headRuns !== undefined && !Array.isArray(headRuns)` alongside the existing malformed-rollup check (before `stale`). Merge normalized head-run failing entries into `failing` and non-`COMPLETED` head runs into `pending`, after the rollup's own entries, in the existing red-then-pending order. Update the file's header comment to name the head-run cross-check (#3405) as part of the twin.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: PASS, all tests (old and new).

- [ ] **Step 5: Commit** `classify.js` + `classify.test.js` — `Cross-check head-sha workflow runs in classifyRollup — a run not yet completed reads pending, not green`.

### Task 2: `pr-checks.js` feeds head runs to the classifier

**Files:**
- Modify: `plugin/bin/pr-checks.js`
- Modify: `plugin/skills/_shared/pr-check-gate.md` (Classification authority paragraph)
- Modify: `docs/plugin-structure.md:42` and `:170` (what the CLI reads)
- Modify: `docs/journeys/stop-a-run-on-its-own-red-pr-check-3013.md` (step 1's Action line names what the read fetches — add the head-sha workflow runs)
- Test: `tests/bin-lib/pr-checks/cli.test.js`

**Interfaces:**
- Consumes: `classifyRollup({ ..., headRuns })` from Task 1.
- Produces: same stdout JSON shape; a failed or unparseable `gh run list` → `state: 'read-failed'`, `reason` starting `gh run list failed:`.

- [ ] **Step 1: Write the failing tests.** Teach `makeDeps`'s fake `gh` to answer `args[0] === 'run' && args[1] === 'list'` with `'[]'` by default (overridable), so every existing test keeps passing. New tests:
  - `a green rollup plus an in_progress head run is pending`: `pr view` returns a SUCCESS/SKIPPED rollup at `HEAD`; `run list` returns `[{ name:'test', workflowName:'test', status:'in_progress', conclusion:'', url:'https://ci.example/r/1' }]` → JSON `state 'pending'`, `pending` `['test']`; and the recorded `run list` call's args include `'--commit', HEAD` and `'--limit', '100'`.
  - `a failing gh run list is read-failed, never green`: `run list` throws → `state 'read-failed'`, `reason` matches `/^gh run list failed:/`, exit 0.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/cli.test.js`
Expected: FAIL after Step 1 — the new pending test reads `green`.

- [ ] **Step 3: Implement.** After the `pr view` parse, call `deps.gh(['run', 'list', '--commit', headRefOid, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url'])`, parse it, and pass the array as `headRuns`. Skip the call when `headRefOid` is not a non-empty string (the classifier already reports `read-failed`). On throw/unparseable → `report(deps, { state: 'read-failed', pr: n, localHead, reason: `gh run list failed: …` })`. Update the CLI header comment. In `pr-check-gate.md`'s Classification authority paragraph, add one sentence: the reader also lists the workflow runs for the PR head (`gh run list --commit {headRefOid}`) and applies Step 2.5's head-run cross-check, and a failed runs read is `read-failed`. Update both `docs/plugin-structure.md` lines to say the CLI also reads the head sha's workflow runs (#3405).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/cli.test.js tests/pr-check-gate-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** the five files — `Feed head-sha workflow runs into pr-checks.js — the test/review gate sees a not-yet-reported run as pending`.

### Task 3: Merge gate prose — Step 2.5 cross-check, watch green exit, #3390 signature

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 2.5: state-read bullets, bounded-watch block and its `RC=0` bullet, Signatures list)
- Test: `tests/merge-verification-gate-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's rule (red on a failing head run, pending on a not-completed head run, empty runs adds nothing).

- [ ] **Step 1: Write the failing test** (covers AC3.1) — new test `the gate cross-checks head-sha workflow runs before reading green (#3405)`: within the Step 2.5 section (same slice as the existing section test), assert it includes `gh run list`, `--commit {headRefOid}`, `--limit 100`; assert the bounded-watch code block's `0)` branch runs `gh run list` (slice from `DEADLINE=` to the closing fence and match `/0\)[\s\S]*gh run list/`); assert the Signatures list includes `#3390` and `39042323352`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/merge-verification-gate-conformance.test.js`
Expected: FAIL after Step 1 — `gh run list` absent from Step 2.5.

- [ ] **Step 3: Edit Step 2.5.**
  1. After the four-field `gh pr view` read, add the head-run read: `gh run list --repo {owner}/{repo} --commit {headRefOid} --limit 100 --json name,workflowName,status,conclusion,url` — full sha (abbreviated returns `[]`). A failed or unparseable runs read is the `state-read-failed` report, same as the first bullet.
  2. Red bullet: also red when a head run is `completed` with a conclusion in the same list (case-insensitive — run conclusions are lowercase).
  3. Pending bullet: also pending when any head run's `status` is not `completed` — "a partial rollup (some workflows reported, others not yet registered) is not green". Note an empty runs list adds nothing.
  4. Green bullet: "every rollup entry SUCCESS/NEUTRAL/SKIPPED **and** every head run completed without a failing conclusion".
  5. Name the code twin once: `bin/lib/pr-checks/classify.js`'s `classifyRollup` (with `headRuns`) applies the same order.
  6. Bounded watch: in the `0)` case, count head runs not completed (`gh run list … --json status --jq '[.[] | select(.status != "completed")] | length'`, a failed read → `RC=2; break`); `0` → `break`; otherwise fall through to the deadline check and `sleep 30` like `8)`. `RC=0` bullet: "green — every reported check passed **and** every head run completed"; its existing re-read also re-runs the head-run read, a failing head run taking the Red path with reason `check-failed:{names}`.
  7. Signatures: add `(e)` — PR #3390 (#3316 wrap-up, 2026-10-17): right after a push the rollup and `gh pr checks` held only `label-fix-branch` (SUCCESS) and `cleanup-fix-labels` (SKIPPED); the `pull_request` `test` run 39042323352 for the same head existed with status `pending` but was not yet in the rollup; `gh pr checks` exited 0. Re-captured on PR #3425: `gh run list --commit {full sha}` lists the `test` run `in_progress` alongside the completed `push` run; an abbreviated sha returns `[]`.
  8. Measure: `wc -c plugin/skills/_shared/pr-first-merge.md` stays well under 50 KB (31 KB today; the `merge` composed bundle was 44,746 B of 51,200 B).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/merge-verification-gate-conformance.test.js tests/pr-check-gate-conformance.test.js tests/context-cost-report-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — `State the head-run cross-check in the merge-verification gate — a partial rollup waits, PR #3390 captured`.
