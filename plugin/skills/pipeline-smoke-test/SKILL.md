---
name: pipeline-smoke-test
description: Use when you want to verify claude-tweaks' own capture->specify->backlog->dispatch pipeline end-to-end against live git/gh state, including the claim-race path, via isolated sessions. Keywords - smoke test, integration test, claim race, cross-session.
argument-hint: "[stop-before-build] [cleanup-only]"
---

# Pipeline Smoke Test — Cross-Session Integration Test of claude-tweaks' Own Pipeline

Lifecycle: standalone diagnostic — not part of the capture → specify → build → wrap-up chain it tests; invoked deliberately, by a human, when the claim-ref/label-taxonomy/ceremony-tier machinery underneath that chain needs re-verifying end-to-end.

Fires `/claude-tweaks:capture` → `/claude-tweaks:specify` → `/claude-tweaks:backlog` (grant) → `/claude-tweaks:dispatch` (claim) through **genuinely separate `claude` CLI processes** — not simulated within one conversation — against one throwaway, clearly-labeled test record, deliberately exercising the claim-race path (two concurrent claim attempts on the same record), verifying every outcome against live `git`/`gh` state, and cleaning up every artifact it created, with that cleanup itself verified by re-querying for absence rather than trusted from the cleanup step's own exit code.

## When to Use

- The capture → specify → backlog → dispatch machinery (claim refs, `bot:in-progress`, ceremony tiers, label taxonomy) has just taken a round of fixes, and you want to re-verify it end-to-end rather than trusting the fix in isolation
- Before a release that touches `bin/lib/issues/claim-store.js`, `_shared/issue-claims.md`, or any of the four pipeline skills' record-creation/claim paths
- Periodically, as a standing confidence check — this machinery has no other end-to-end coverage; `npm test`'s unit suites exercise each module in isolation, never the live cross-process claim race a real concurrent dispatch produces

### When NOT to Use

- As part of an automated, unattended `/flow` or `/dispatch` run — this skill files a real (throwaway) GitHub issue and holds real claim state against the live repo for the duration of the test; it needs a human present to review the cleanup verification report, and must never be the thing an autonomous batch decides to run on its own
- When you only need to check that individual modules behave correctly in isolation — that's what the unit suites in `tests/bin-lib/issues/` already do; this skill is for the cross-process interaction those suites cannot reach

## Input

`$ARGUMENTS` is parsed as `[stop-before-build] [cleanup-only]`:

- **`stop-before-build`** (default — always active; the token exists for explicit invocations that want it named) — the test record never reaches an actual `/claude-tweaks:build`. The pipeline is exercised through the claim step only: a real build landing from a smoke test would leave permanent, unwanted repository changes, which is exactly the blast-radius risk this skill exists to cap. There is currently no non-capped mode; the token is accepted as a no-op for forward compatibility with a future opt-in.
- **`cleanup-only`** — skip stages 1-4 below and run only Step 5 (Cleanup) plus Step 6 (Verify cleanup) against the most recent smoke-test record this session can find (by the `[pipeline-smoke-test]` title prefix, below). Use after an interrupted run left artifacts behind.

## Isolation mechanism (the design decision this skill's own record named)

**Genuinely separate `claude` CLI processes**, one per pipeline stage, each spawned via `execFileSync`/`spawn` from this skill's own orchestrating session — not a `Skill()` inline call (shares this session's context) and not a `Task` dispatch (a subagent still shares this session's conversation history and model context window). A separate OS process has none of that: its own memory, its own fresh context, no visibility into this orchestrating session's transcript. This is the "real terminals or equivalent" bar the 2026-07-22 ad hoc test met by literally using separate terminals — a separate process is the automatable equivalent, not a weaker substitute.

```bash
claude --print --permission-mode acceptEdits "$STAGE_PROMPT" > "$STAGE_LOG" 2>&1
```

Each stage's prompt is a single, self-contained instruction (no conversation history to carry — the whole point of genuine isolation) naming the exact command to run and the test record's identifier once one exists. Capture each process's exit code and stdout/stderr to `$STAGE_LOG`, but **never trust stage narration as the verification** — Step 4 (Verify) reads live `gh`/`git` state independently of what any stage process reported about itself.

## Blast-radius capping

- **Test payload**: the capture stage files a real GitHub issue whose title is prefixed `[pipeline-smoke-test]` and whose body opens with `<!-- pipeline-smoke-test: {run-id} -->` (a run-id timestamp, collision-safe the same way a pipeline run directory is) — unambiguous at a glance in the issue list, and grep-able for cleanup.
- **Stop-before-build**: per Input above, the test never reaches `/claude-tweaks:build` — the furthest stage is `/claude-tweaks:dispatch`'s claim step, which writes a claim comment and `bot:in-progress` label but starts no worktree, no branch, no code change.
- **No real backlog pollution**: the test record is closed (never left open) at Step 5 regardless of outcome, so it never lingers in `/claude-tweaks:backlog overview`'s counts or `/claude-tweaks:help`'s dashboard past the run.

## Workflow

### Step 1: Announce and mint a run-id

Generate `$RUN_ID` the same way a pipeline run directory does (`date -u +%Y-%m-%dT%H%M%S`) suffixed `-smoke`, so every artifact this run creates is traceable to one identifier and never collides with a concurrent real run or a concurrent second smoke test.

### Step 2: Capture (stage 1 process)

Spawn a `claude` process instructed to run `/claude-tweaks:capture` filing the test payload above (title, body, marker) as a plain, unscored idea — no `ready`, no scoring, matching an ordinary human capture. Read the created issue number back from the process's stdout, then **immediately verify it independently**: `gh issue view {n} --json title,body,labels` and confirm the title prefix and body marker actually landed — a stage process reporting success is not evidence; the live issue is.

### Step 3: Specify (stage 2 process)

Spawn a `claude` process instructed to run `/claude-tweaks:specify #{n}` against the captured test record, shaping it to `ready` with `risk:low`/`size:low` (a trivial payload — e.g. "add a one-line comment to a scratch file" — never anything that could plausibly reach real code). Verify independently: `gh issue view {n} --json labels` shows `ready` plus scoring labels.

### Step 4: Claim race (stages 3a/3b — the deliberate concurrency exercise)

Spawn **two** `claude` processes concurrently (background, not sequential — the whole point is genuine concurrency, not two sequential attempts that never actually race), each instructed to run `/claude-tweaks:dispatch #{n}` against the same shaped test record. Wait for both to exit, then verify independently — never from either process's own narration:

1. Read the record's live claim state per `_shared/issue-claims.md`'s "Reading claim state" (the claim comment / label).
2. Exactly one of the two processes' run identities holds the live claim; the other's attempt is reflected as `contested` in that process's own log, but the *proof* is the single live claim, not the log.
3. `bot:in-progress` is present exactly once (GitHub labels are set-valued — this also catches a double-apply bug, not only a double-claim bug).

`bin/lib/smoke-test/verify-claim-race.js`'s `verifyClaimRaceOutcome(attemptRunIds, liveClaim, inProgressLabelCount)` is this verdict's mechanical reference implementation — pass only when exactly one of the two known attempt run ids holds the live claim and `bot:in-progress` is present exactly once. A run where both processes report success, or where neither holds a live claim afterward, is a **failing** smoke test — the claim-race protection this run exists to verify has a hole. Report it as a failure, not a shrug; this is the scenario the whole skill was built to catch.

### Step 5: Cleanup

Regardless of Step 4's outcome (a failing race result still needs cleanup — the point was to observe it, not to leave it live):

- Release the claim (`bin/release-claim.js {n} --run "{claiming-run-id}" --reason "smoke-test cleanup" --remove-in-progress`).
- Close the test issue (`gh issue close {n} --comment "pipeline-smoke-test cleanup — {RUN_ID}"`) — closed, not deleted, so the run leaves an auditable trail exactly like a real record would.
- Remove any worktree either stage process's `dispatch` claim path may have created (`git worktree list --porcelain` filtered to a branch/path containing `$RUN_ID`, then `git worktree remove` on each match).

### Step 6: Verify cleanup (never trust Step 5's own exit code)

Re-query every artifact Step 5 claims to have removed:

- `gh issue view {n} --json state` reads `CLOSED`.
- The claim-state read from Step 4 now shows no live claim for `{n}` (tombstoned or absent).
- `git worktree list --porcelain` no longer contains `$RUN_ID`.

`bin/lib/smoke-test/verify-cleanup.js`'s `verifyCleanupTable(rows)`/`renderCleanupTable(rows)` compute and render this exactly: `| Artifact | Cleanup claimed | Verified absent |` — a row where `claimed` is `yes` but `verifiedAbsent` is `no` is the failure condition Acceptance Criteria names explicitly ("verified by checking their absence afterward, not merely by the cleanup step reporting success"), and stops the skill with a **BLOCKED** card naming the leaked artifact for manual removal, rather than reporting a clean pass.

## Output

A pass/fail report per stage (capture, specify, claim-race, cleanup), the two claim-race process logs' paths (for a human to read if the race outcome is surprising), and the Step 6 verification table. On any stage failure or any Step 6 mismatch, the report is BLOCKED, not a partial pass — this skill's whole value is that a green report means the machinery genuinely works, not that most of it did.

## Next Actions

- **`/claude-tweaks:pipeline-smoke-test`** — re-run after a fix to the machinery this test covers (recommended)
- `/claude-tweaks:pipeline-smoke-test cleanup-only` — recover from an interrupted run that left artifacts behind

## Component-Skill Contract

`/claude-tweaks:pipeline-smoke-test` is a **standalone-only** diagnostic — it is never invoked by a parent skill (see When NOT to Use above: an unattended `/flow`/`/dispatch` run must never trigger it). There is no `PIPELINE_RUN_DIR` signal to check; the `## Next Actions` block always renders.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Simulating the claim race within one conversation (two sequential tool calls narrating "session A" and "session B") | Not a race at all — sequential calls in one context can never reproduce a genuine concurrent-write conflict; this is exactly the weaker substitute the record's Acceptance Criteria forbids |
| Trusting a stage process's own stdout as verification | The whole design principle of this skill — a stage process can misreport its own outcome (a bug in the stage itself, or in this skill's own prompt to it); only a live `git`/`gh` read counts |
| Running this as part of an unattended `/flow`/`/dispatch` firing | Files a real issue and holds real claim state against the live repo for the run's duration — needs a human present, per When NOT to Use above |
| Reporting cleanup success from Step 5's exit code alone | Step 6 exists because "the cleanup command didn't error" and "the artifact is actually gone" are different claims — GitHub API calls can partially fail |
| Leaving the test issue open after a failed run "for debugging" | Close it regardless of outcome (Step 5 runs unconditionally) — the process logs already carry everything needed to debug a failure; an open smoke-test issue pollutes the real backlog the next time anyone runs `/claude-tweaks:backlog overview` |
