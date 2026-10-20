# Ledger Creation After Draft-PR Open (#3289) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `/flow`-parented single-spec open-items ledger (`build/worktree-setup.md` Step 4.6) from being silently skipped under `integration-model: pr-first`, and pin the corrected sequencing with a `node --test` conformance assertion.

**Architecture:** `/flow` Step 4.2 commits `work/{n}-spec.md` before invoking `/build`. From that commit on, `checkBookkeepingStampsGate` (`plugin/bin/lib/hooks/pre-tool-use.js`) denies every covered write, the ledger's `Write` included, until `run-state.json` carries a `pr` stamp. But Step 4.6 is sequenced before Step 6 (the draft-PR open), so under pr-first its write is always denied. An agent that follows the deny's remedy (open the PR) then moves on, and the ledger never gets created: the #3289 ledger half. The fix is a prose sequencing change: Step 4.6 runs right after Step 6 records the PR (or logs its `SKIP`). It stays numbered 4.6 so existing citations keep working. A conformance test pins it.

**Tech Stack:** Markdown skill prose; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-20T072842-record-3289/work/3289-spec.md`

## Global Constraints

- Do not edit `plugin/skills/build/SKILL.md` (47.6 KB of the 50 KB ceiling).
- Keep the literal `4.6. **Create the open-items ledger (`/flow` single-spec runs, #3036)**` marker and its position after `4.5. **Record the assignment**`. `tests/flow-ledger-creation-timing-conformance.test.js` pins both.
- Keep `Open the draft PR (`integration-model: pr-first` only)` and the `_shared/pr-early-run-lifecycle.md` citation in Step 6 (`tests/pr-early-run-lifecycle.test.js`).
- Release Note: N/A (internal tooling correctness).

## Review Focus

- `local-merge` runs: Step 6 is a `SKIP` there. The new sequencing must still create the ledger (after the SKIP), not drop it. The test asserts the SKIP clause.
- Multi-spec runs: their one ledger is created at `flow/multi-spec.md`'s "Shared worktree" step 1, before any materialize commit, so they are untouched. The test asserts Step 4.6 still excludes `MULTISPEC_SHARED_WORKTREE` (already pinned).
- A resumed run whose ledger already exists: Step 4.6 still defers to ledger Create's "At a post-worktree creation point" paragraph (already pinned).

---

### Task 1: Sequence Step 4.6 after Step 6 and pin it

**Files:**
- Modify: `plugin/skills/build/worktree-setup.md` (Step 4.6 at ~line 151, Step 6 at ~line 155-165)
- Test: `tests/flow-ledger-creation-timing-conformance.test.js`

**Interfaces:**
- Consumes: none.
- Produces: the prose phrases the test pins (below).

- [ ] **Step 1: Write the failing test.** Append to `tests/flow-ledger-creation-timing-conformance.test.js`:
  - `test('#3289: Step 4.6 runs after Step 6 records the draft PR, not in numbered order', ...)` reads `build/worktree-setup.md` (whitespace-collapsed via the file's `read`) and asserts:
    - `/\*\*Sequencing \(#3289\):\*\* run this step right after Step 6 records the draft PR \(or logs its `SKIP`\)/`
    - `/`checkBookkeepingStampsGate` denies the ledger `Write` until `run-state\.json` carries the `pr` stamp/`
    - the Step 6 slice (from `6. **Open the draft PR` to `## Cherry-pick source-branch PR check`) matches `/then run Step 4\.6 if it is still pending \(#3289\)/`
  - `test('go-red proof: the pre-#3289 Step 4.6 text fails the sequencing assertion', ...)` uses `assert.throws(() => assert.match(OLD, SEQ))` where `OLD` is the pre-change sentence `'This is the first point a `docs/plans/` write can land under `worktree-always` (the reason `materialize.md` writes the spec after worktree creation), and it precedes every build task.'` and `SEQ` is the first regex above (hoisted to a module const).

- [ ] **Step 2: Run the test to verify it fails.**
  Run: `node --test tests/flow-ledger-creation-timing-conformance.test.js`
  Expected: FAIL, because the `#3289: Step 4.6 runs after Step 6` test does not match the current prose.

- [ ] **Step 3: Edit `plugin/skills/build/worktree-setup.md`.**
  - In Step 4.6, replace the sentence `This is the first point a `docs/plans/` write can land under `worktree-always` (the reason `materialize.md` writes the spec after worktree creation), and it precedes every build task.` with a `**Sequencing (#3289):**` sentence. It says to run this step right after Step 6 records the draft PR (or logs its `SKIP`), not in numbered order. The reason: `/flow` Step 4.2 commits the materialize file before `/build` runs, and from then on `checkBookkeepingStampsGate` (`docs/hooks.md`) denies the ledger `Write` until `run-state.json` carries the `pr` stamp. Close with a note that it still precedes every build task.
  - In Step 6, append after the lifecycle citation: `Once the PR is recorded (or this step's `SKIP` is logged), then run Step 4.6 if it is still pending (#3289).`

- [ ] **Step 4: Run the test to verify it passes.**
  Run: `node --test tests/flow-ledger-creation-timing-conformance.test.js tests/pr-early-run-lifecycle.test.js`
  Expected: PASS, with 0 failures.

- [ ] **Step 5: Commit.**
  ```bash
  git add plugin/skills/build/worktree-setup.md tests/flow-ledger-creation-timing-conformance.test.js
  git commit -m "Sequence the flow single-spec ledger after the draft-PR open — the bookkeeping gate denied Step 4.6's write under pr-first, refs #3289"
  ```

### Task 2: Write up the root cause (AC1.1, AC2.1)

**Files:** none in the repo. Output is a comment on GitHub issue #3289.

- [ ] **Step 1: Post the write-up** via `gh issue comment 3289 --body-file <scratch file>`. It covers three things:
  - **(a) The #2999/#3000 incident.** That run's first call never invoked `/claude-tweaks:flow` through the Skill tool. In the archived `events.jsonl`, the only first-call `skill_invoked` is `claude-tweaks:test` (18:20Z); `flow` first appears in the second call (19:28Z). Its claim landed only after a `claim-log` `bookkeeping-stamp-deny` (18:18:40Z). This is #3212's full-bypass class on the pre-#3224 Standard profile, so config.yml was never written because Step 3 never ran. That half is now covered by #3224 (Capable first call), #3225 (dispatch-config commit gate), #3226 (repair-then-continue) and #2837 (post-hoc first-call artifact check).
  - **(b) A live, independent ledger defect,** fixed by Task 1's commit, which the comment names.
  - **(c) Why the mechanical assertion is the Task 1 conformance test** plus the existing `tests/dispatch-config-gate-conformance.test.js` / `tests/hooks-pre-tool-use.test.js` coverage, not a new runtime gate.
- Verification: `gh issue view 3289 --comments` shows the comment.
