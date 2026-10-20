# Dispatch-call discriminator (#3711) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wrap-up's auto-merge short-circuit treats a call as one of `/claude-tweaks:dispatch`'s Task calls only when `run-state.json` carries `dispatched: true` AND its stamped `sessionId` equals the current `CLAUDE_CODE_SESSION_ID`. A human-run `/flow`, and a human resuming a dispatched run, no longer match.

**Architecture:** add a pure predicate plus a never-throwing run-dir reader in `plugin/bin/lib/dispatch/task-call.js`. The skill prose calls the reader through a single `node -e`, replacing the claim-blob read. The branch is renamed "Dispatch-claim branch" → "Dispatch-call branch" and every live citation is swept.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T152758-spec-3711/work/3711-spec.md`

Scope keywords: Dispatch-claim, dispatch-claim

## Global Constraints

- The predicate is true only when `runState` is a plain object, `runState.dispatched === true` (boolean), `runState.sessionId` is a non-empty string, and it `===` a non-empty-string `sessionId` argument. Every other input is false, and nothing throws.
- A missing or unreadable `run-state.json` counts as `false`. A `false` result means a genuine human-run session, which falls through to the direct-merge path.
- New heading text, exactly: `**Dispatch-call branch — check this before merging anything.**`
- Frozen `PRE_CHANGE` / `PRE_CHANGE_EXCERPT` constants in existing tests are never edited (they are pre-change history).
- Leave historical run artifacts under `.claude-tweaks/pipelines/` and `docs/journeys/` untouched.
- `plugin/bin/hooks.js` and `plugin/skills/flow/claim-targets.md` are read-only references and are not modified.

## Build-time corrections to the spec (logged to decisions.md)

- **Premise reversed:** the spec's Gotcha says two tests "anchor ordering assertions" on the old heading. `tests/auto-merge-short-circuit-ledger-deletion.test.js:36` and `tests/auto-merge-short-circuit-verdict-backstop.test.js:37` quote it only inside frozen pre-change excerpts, which stay byte-identical. Only the verdict-backstop test's live label strings (`test('local-merge: the backstop precedes the merge, and the dispatch-claim relay'…` and its `'dispatch-claim local-merge relay ordering'` label) are renamed. AC4.1's `tests/` grep therefore exempts those two frozen-excerpt lines.
- **Confirmed:** a Task subagent's `CLAUDE_CODE_SESSION_ID` equals the dispatching session's. This was a live probe in an interactive session: the subagent and parent both printed `e498d0be-8816-4667-91ab-f8e7f90c0cb7`.
- **Mechanism (behavioral-claim check):**
  - `sessionId` is written by `plugin/bin/hooks.js` `record-worktree` (`patch.sessionId = process.env.CLAUDE_CODE_SESSION_ID`, ~line 697).
  - `dispatched: true` is written by the same call under `--dispatch` (~line 702).
  - A dispatched Task call re-runs `record-worktree` at build Common Step 1 Step 4.5 with the same shared id.
  - A human resume with a `review,polish,wrap-up` step list never reaches Step 4.5, so the stamp keeps the dispatching session's id, and a different human session mismatches.
- **Fail-safe claim:** a Task call that is wrongly classified as human-run reaches the local-merge direct-merge first call. Its guard (`auto-merge-short-circuit.md` ~line 271, `CURRENT=$(git branch --show-current)` vs `{integration-branch}`) sees the worktree's feature branch and aborts. Task 2 makes that abort take the documented console fallback in so many words.

- **Beneficial deviation (final whole-branch review, /build Common Step 4.5):**
  - **The gap:** the plan's mechanism note missed a path. `_shared/run-resume-freshness.md`'s probe re-runs `record-worktree` on a resume, and that overwrites `sessionId` with the resumer's id. A `sessionId`-only predicate therefore still let a human resume pose as a Task call.
  - **The fix:** scope was widened to `plugin/bin/hooks.js`.
    - `record-worktree --dispatch` also stamps `dispatchSessionId`, and plain re-stamps never write it.
    - `isDispatchTaskCall` compares against `dispatchSessionId`, falling back to `sessionId` only when the field is absent, for run-states from older builds.
    - The fallback's removal condition is recorded inline in `task-call.js`.
  - **Docs:** `docs/hooks.md`, `docs/skill-graph.md`, `dispatch/sibling-session-check.md`, `_shared/run-resume-freshness.md` and the #3225 journey were updated to match (620f95790).

## Review Focus

1. A `run-state.json` that is present but malformed JSON must classify as human-run without the snippet crashing. Pinned in Task 1 (`AC2.1` reader test) and Task 2 (snippet run).
2. Both session ids empty or absent must never compare equal (`'' === ''`, `undefined === undefined`). Pinned in Task 1.
3. `dispatched: 'true'` (string), as from a hand-edited file, must not count. Pinned in Task 1.
4. The prose snippet must actually execute with the plugin root substituted, not just name the helper. Pinned in Task 2 by extracting and running the fenced snippet.
5. A human resuming a dispatched run in a new session must take the direct-merge path. Pinned in Task 1 (mismatch case) and Task 2 (snippet against a fixture with a foreign id).

---

### Task 1: `task-call.js` predicate and reader

**Files:**
- Create: `plugin/bin/lib/dispatch/task-call.js`
- Test: `tests/bin-lib/dispatch/task-call.test.js`

**Interfaces:**
- Produces: `isDispatchTaskCall({ runState, sessionId }) -> boolean` and `isDispatchTaskCallForRun(runDir, sessionId) -> boolean`. The second reads `path.join(runDir, 'run-state.json')` via `readRunState` from `plugin/bin/lib/hooks/context.js`, which already returns `null` on any read or parse failure. It returns `false` for a non-string or empty `runDir` and never throws.

- [ ] **Step 1: Write the failing test** `tests/bin-lib/dispatch/task-call.test.js`. Use `node:test` + `node:assert`, in the header-comment style of `tests/bin-lib/dispatch/merge-verdict.test.js` (`'use strict';`, a `// #3711:` line naming what the module decides).
  - `test('AC1.1: dispatched run, matching session -> true')`: `isDispatchTaskCall({ runState: { dispatched: true, sessionId: 'S' }, sessionId: 'S' }) === true`.
  - `test('AC2.1: false for every non-matching shape')`: table-driven, each asserting `=== false`:
    - `{dispatched:true, sessionId:'S'}` vs `'T'` (human resume)
    - `{sessionId:'S'}` vs `'S'` (human-run /flow, the bug)
    - `{dispatched:true}` vs `'S'` (sessionId absent)
    - `{dispatched:true, sessionId:'S'}` vs `undefined`
    - `{dispatched:true, sessionId:''}` vs `''` (both empty)
    - `{dispatched:true}` vs `undefined` (both absent)
    - `runState: null`
    - `runState: 'x'`
    - `runState: []`
    - `{dispatched:'true', sessionId:'S'}` vs `'S'`
  - Also in AC2.1: a reader test using a temp dir. `isDispatchTaskCallForRun` is true for a dir whose `run-state.json` is `{"dispatched":true,"sessionId":"S"}` with `'S'`. It is false for:
    - a missing file
    - a file containing `{not json`
    - `runDir` `''`
    - `runDir` `undefined`
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --test tests/bin-lib/dispatch/task-call.test.js`. Expected: FAIL, "Cannot find module".
- [ ] **Step 3: Implement both exports** in `plugin/bin/lib/dispatch/task-call.js`: `'use strict'`, `module.exports = { isDispatchTaskCall, isDispatchTaskCallForRun }`, with a header comment naming the two writers (`hooks.js record-worktree`, the `--dispatch` flag) and why a per-run marker alone is not enough.
- [ ] **Step 4: Run the test and confirm it passes.** Same command, expected PASS.
- [ ] **Step 5: Discrimination (AC3.1).** AC3.2: temporarily replace `isDispatchTaskCall`'s body with `return true;` and re-run. The `human-run` and `human resume` rows must fail. AC3.3: then use `return !!(runState && runState.dispatched === true);`, re-run, and the `human resume` row must fail. Restore the implementation and confirm the suite is green again. Quote all three raw outputs in the task report.
- [ ] **Step 6: Commit** both files (`git add` by path), message `Add isDispatchTaskCall predicate for wrap-up's dispatch-call branch — refs #3711`.

### Task 2: Rewrite the branch in `auto-merge-short-circuit.md`

**Files:**
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` (the Dispatch-claim paragraph ~171-180; the pr-first/local-merge sub-branch openers ~182-192; the "Everything from here…" paragraph ~194-196; the "If the merge conflicts" paragraph ~308-311; the closing paragraph ~329-338)
- Modify: `tests/auto-merge-short-circuit-verdict-backstop.test.js` (live labels only, ~line 111 and ~118; never `PRE_CHANGE`)
- Test: `tests/auto-merge-short-circuit-dispatch-call.test.js` (new)

**Interfaces:**
- Consumes: `isDispatchTaskCallForRun` from Task 1.

- [ ] **Step 1: Write the failing conformance test** `tests/auto-merge-short-circuit-dispatch-call.test.js`. Follow `tests/auto-merge-short-circuit-verdict-backstop.test.js`'s pattern: live-corpus read, whitespace collapsed, and a frozen `PRE_CHANGE` excerpt holding the current Dispatch-claim paragraph and the current "If the merge conflicts" paragraph verbatim. An `assertPinned(pattern, label)` helper requires a match in live prose and no match in `PRE_CHANGE`. Tests:
  - `AC4.2: the Dispatch-call branch heading is present`: pattern `/\*\*Dispatch-call branch — check this before merging anything\.\*\*/`.
  - `AC6.1: the branch names run-state.json, CLAUDE_CODE_SESSION_ID and bin/lib/dispatch/task-call.js`. Each is pinned within the branch paragraph, sliced from the heading to the next `**\`integration-model: pr-first\`:**`.
  - `AC6.2: a non-true result falls through to the direct-merge path`: pins the sentence fragment `any other output` … `genuine top-level, human-run session` inside the same slice.
  - The claim-blob read is gone: within the slice, `doesNotMatch(/claims\/issue-/)` and `doesNotMatch(/runId/)`. Guard it with a go-red assertion that `PRE_CHANGE` does match `/runId/`.
  - `AC7.1: the branch-guard abort takes the console fallback`: pins `/the branch guard aborts[\s\S]{0,200}?fall back to rendering the console normally/`.
  - The closing paragraph no longer says `a session standing in for one`.
  - **Snippet run (Review Focus 4, 1, 5):**
    - Extract the first fenced `bash` block inside the branch slice.
    - Assert that it contains `isDispatchTaskCallForRun`.
    - Substitute `${CLAUDE_PLUGIN_ROOT}` → `<repo>/plugin`.
    - Run it with `execFileSync('bash', ['-c', snippet])` with `PIPELINE_RUN_DIR` pointing at a temp dir.
    - Assert stdout trimmed is `true` for `{dispatched:true,sessionId:'S'}` with env `CLAUDE_CODE_SESSION_ID=S`.
    - Assert `false` for a foreign id `T`, for no `run-state.json`, and for `{not json`.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --test tests/auto-merge-short-circuit-dispatch-call.test.js`. Expected: FAIL on the heading test.
- [ ] **Step 3: Rewrite the prose.**
  - **(a)** Replace the Dispatch-claim paragraph with a `**Dispatch-call branch — check this before merging anything.**` paragraph. It does five things:
    - Says the question is whether *this call* is one of dispatch's own Task() calls, which are cwd-pinned to the worktree they inherited and have no path to the main checkout.
    - Gives the one-call fenced snippet: `node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/task-call.js').isDispatchTaskCallForRun(process.argv[1], process.env.CLAUDE_CODE_SESSION_ID))" "$PIPELINE_RUN_DIR"`.
    - Says `true` means a dispatch Task call (`run-state.json` `dispatched: true` and its `sessionId` equals this session's `CLAUDE_CODE_SESSION_ID`, both stamped by `hooks.js record-worktree --dispatch`, which a Task call shares). Any other output, including a non-zero exit, means a genuine top-level, human-run session, which falls through to the direct-merge path below, and that includes a human resuming a dispatched run from a new session.
    - States the fail-safe: a Task call misread as human-run (for example after a failed bind) reaches the local-merge first call's branch guard, sees the feature branch, and aborts into the console fallback. It never merges into a wrong checkout.
    - Keeps the existing sentence about routing a dispatched **singleton** through this file instead of `settle-and-merge.md`.
  - **(b)** Rename every remaining `dispatch-claim branch` in the file to `dispatch-call branch`: the pr-first opener, "Everything from here…", and the closing paragraph.
  - **(c)** Closing paragraph: replace `(or, per the dispatch-claim branch above, a session standing in for one)` with a clause saying a human resuming a dispatched run is itself a human-run session here.
  - **(d)** Widen `**If the merge conflicts:**` to `**If the composer call exits non-zero, the merge conflicts, or the branch guard aborts:**`. Keep its body, `git merge --abort` only if a merge is actually in progress, and add one sentence that `close-run` already ran, so the parked run is no longer E1-protected. Mirror `dispatch/settle-and-merge.md`'s accepted-residual wording.
  - **(e)** In `tests/auto-merge-short-circuit-verdict-backstop.test.js`, rename the test title's `dispatch-claim relay` → `dispatch-call relay` and the label `'dispatch-claim local-merge relay ordering'` → `'dispatch-call local-merge relay ordering'`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test tests/auto-merge-short-circuit-dispatch-call.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js`. Expected: all PASS.
- [ ] **Step 5: Check headroom.** `wc -c plugin/skills/wrap-up/auto-merge-short-circuit.md` must stay under 52,500 (27,208 B today).
- [ ] **Step 6: Commit** the three files by path, message `Key wrap-up's dispatch-call branch on run-state session identity — refs #3711`.

### Task 3: Sweep citations to the old name and condition

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (~436: `wrap-up/review-console.md`'s dispatch-claim branch → dispatch-call branch)
- Modify: `plugin/skills/_shared/github-pr-scan.md` (~389: `its own dispatch-claim branch` → `its own dispatch-call branch`)
- Modify: `plugin/skills/flow/SKILL.md` (~61, `pre-authorize-merge` row: delete the parenthetical clause `under \`integration-model: pr-first\`; a human-run \`/flow\` under \`local-merge\` still stops at \`ready-to-merge\`, a pre-existing gap in wrap-up's Dispatch-claim branch` and leave `(under \`integration-model: pr-first\` or \`local-merge\`)`)
- Modify: `docs/skill-graph.md` (~231: `its dispatch-claim branch (matched when a live claim's \`runId\` equals \`basename($PIPELINE_RUN_DIR)\`)` → `its dispatch-call branch (matched when \`run-state.json\` carries \`dispatched: true\` and its \`sessionId\` equals this session's \`CLAUDE_CODE_SESSION_ID\` — \`bin/lib/dispatch/task-call.js\`)`)

- Modify: `docs/plugin-structure.md` (~105, wrap-up row: `the dispatch-claim branch` → `the dispatch-call branch`)

- [ ] **Step 1: Apply the five edits** in place.
- [ ] **Step 2: Verify the sweep (AC4.1, AC5.1).** Run each in its own call:
  - `grep -rn -i "dispatch-claim" plugin docs/skill-graph.md docs/plugin-structure.md`, expected no output.
  - `grep -rn -i "dispatch-claim" tests`, expected exactly two lines: the frozen-excerpt lines `tests/auto-merge-short-circuit-ledger-deletion.test.js:36` and `tests/auto-merge-short-circuit-verdict-backstop.test.js:37`.
  - `grep -n "pre-existing gap" plugin/skills/flow/SKILL.md`, expected no output.
  - `grep -n "Dispatch-call branch" plugin/skills/wrap-up/auto-merge-short-circuit.md`, expected the heading line.
- [ ] **Step 3: Run the prose suites that read these files.** Run `node --test tests/argument-hint-mirrors.test.js tests/skill-conventions.test.js` if present (the flow `## Input` table changed). Expected PASS.
- [ ] **Step 4: Commit** the five files by path, message `Sweep citations to wrap-up's dispatch-call branch — refs #3711`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (helper) / AC1.1, AC2.1 | Task 1 |
| Deliverables 2-4 (branch rewrite, stands-in wording, guard fallback) / AC4.2, AC6.1, AC6.2, AC7.1 | Task 2 |
| Deliverable 5 (citation sweep) / AC4.1, AC5.1 | Task 3 |
| Deliverables 6-7 (tests, prose assertion) | Tasks 1-2 |
| AC3.1, AC3.2, AC3.3 (discrimination) | Task 1 Step 5 |
| Not modified, though Check B lists them: `docs/journeys/trust-a-singleton-auto-merge-to-refuse-without-a-verdict-2941.md` (historical journey), `tests/auto-merge-short-circuit-ledger-deletion.test.js` (old name only in a frozen excerpt), this run's ledger | — |
| AC8.1 (`npm test`) | Common Step 5, run centrally |

Waived AC8.1: the full suite runs at /build Common Step 5, centrally, not inside a task.
