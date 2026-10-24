---
files:
  - plugin/skills/review/review-effort-derivation.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/step3-debate-and-refutation.md
  - plugin/bin/lib/review-context/build.js
---

# Run a Review from a Worktree-Isolated Session

**Persona:** a developer whose `/claude-tweaks:review` runs inside a session isolated to a linked worktree — the review call of `/claude-tweaks:dispatch`'s two-call handoff, or any `worktree-always` project — with a pipeline run directory anchored in the main checkout.
**Goal:** the review's Step 2.5 effort derivation, Step 3 reproduction pairs and cross-lens overlap check run to completion without a single refused file write.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) with `$PIPELINE_RUN_DIR` set, from a worktree-isolated session.
**Success state:** every lens pair is categorised and, at `high`+, overlap detection runs, with zero "Edit the worktree copy of this file instead" or "too complex to verify" refusals in the transcript.

## Steps

### 1. Read the record's risk/size labels — worktree-isolated session
- **URL:** `/claude-tweaks:review #{n}` with no effort token, Step 2.5 (Derive Review Effort), `work-backend: github-issues`
- **Action:** the orchestrator mints `{ctx-dir}` with `build-review-context.js mint --print-dir`, then runs one command, `gh issue view {n} --json labels | node -e "…parseRecordFacets…"`, and reads the `{risk, size}` JSON line it prints.
- **Should feel:** a single read. No intermediate file, no refused redirect, and the resolved tier comes from the record's own labels rather than the diff-heuristic fallback.
- **Should understand:** the labels pass through stdin, so nothing is written under `{ctx-dir}`. Under `--run`, `{ctx-dir}` is in the main checkout, where a worktree-isolated session is refused both a shell redirect and `Write`. The minted `{ctx-dir}` is still reused by Step 3's `build --dir {ctx-dir}`.
- **Red flags:** a `gh issue view … > {ctx-dir}/record-{n}.json` redirect attempted (and refused); a labelled record whose tier silently fell through to the diff heuristic because the label read failed.

### 2. Categorise a lens reproduction pair — worktree-isolated session
- **URL:** `/claude-tweaks:review #{n}` at `review-effort` `medium` or above, Step 3 reproduction dispatch
- **Action:** both agents of a lens pair return; the orchestrator resolves `review-{ctx-id}-lens-{LENS}-agentA.json` / `…-agentB.json` with one plain `session-tmp-resolve.js` call, `Write`s each `findings` array to the printed path, and passes both paths to `review-coordination.js categorise-reproduction`.
- **Should feel:** uneventful. No refused tool call, no improvised workaround path, no retry.
- **Should understand:** these coordination inputs live in the session-scoped temp dir (`_shared/session-tmp-root.md`), outside every checkout, not in `{ctx-dir}`. Under `--run`, `{ctx-dir}` is `{run}/review-ctx` inside the main checkout, where a worktree-isolated session is refused both `Write` and a heredoc redirect. `{ctx-id}` is `{ctx-dir}`'s parent basename joined to its own basename, so two concurrent reviews in one session (dispatched subagents share `CLAUDE_CODE_SESSION_ID`) never share a filename.
- **Red flags:** a `Write` refused with "Edit the worktree copy of this file instead"; a Bash heredoc refused as "too complex to verify"; a filename without the `{ctx-id}` segment, such as a bare `lens-3a-agentA.json` in the temp dir.

### 3. Detect cross-lens overlap — `high` effort and above
- **URL:** Step 3.5 Cross-Lens Debate, step 1 (Detect overlap)
- **Action:** the orchestrator writes the `{lensName: [findings...]}` object to the resolved `review-{ctx-id}-findings-by-lens.json` path and calls `review-coordination.js detect-overlap` on it.
- **Should feel:** the same as step 2 — no refusal, no detour.
- **Should understand:** `{ctx-dir}` still holds the context bundle and the pre/post-fan-out status snapshots; only the orchestrator-written coordination inputs moved. The fan-out leftover sweep's `{ctx-dir}` exclusion no longer names `lens-*.json` or `findings-by-lens.json`, because they are no longer there.
- **Red flags:** `detect-overlap` invoked on a `{ctx-dir}/findings-by-lens.json` path; the leftover sweep reporting a findings JSON file as a fan-out leftover.

### 4. Capture the pre-dispatch baselines — worktree-isolated session
- **URL:** Step 3's `build-review-context.js build --run "$PIPELINE_RUN_DIR"` call, before any lens dispatch
- **Action:** the orchestrator runs the one `build` command and reads its JSON line. `baselinePath` names `{ctx-dir}/pre-dispatch-status.txt`, and `listenersPath` names `{ctx-dir}/pre-dispatch-listeners.txt` (or is `null` when `lsof` is unavailable). The post-fan-out sweep diffs against those files.
- **Should feel:** a single command. The orchestrator makes no follow-up redirect, needs no scratchpad copy of the baseline, and gets no refusal.
- **Should understand:** the CLI writes both baselines itself, running `git status --porcelain --untracked-files=all` at the worktree's toplevel, so untracked files that already existed are in the baseline and never reported as leftovers. The reviewer never writes a file under `{ctx-dir}` by hand.
- **Red flags:** a `git status … > {ctx-dir}/pre-dispatch-status.txt` redirect attempted (and refused); a baseline kept in a scratchpad because the documented file never existed; a pre-existing untracked file reported as a fan-out leftover.

## Origin
- Created during build of #2956. On plugin 6.133.0, an unattended `/claude-tweaks:flow` review step in a worktree-isolated session hit 3 refused tool calls (about 2 minutes) writing `{ctx-dir}/lens-*.json` under the main-checkout run directory, and only finished by writing the JSON elsewhere by hand. The fix moves the orchestrator-written inputs to per-review names in the session temp dir; `review-coordination.js` and `build-review-context.js` are unchanged.
- Step 3 added during build of #3302. #2783's review hit the same refusal for the pre-dispatch status baseline, and the reviewer kept the baseline in its own scratchpad. `build-review-context.js build` now writes both baselines and reports them as `baselinePath`/`listenersPath`.
- Step 1 added during build of #3744. #3302's whole-branch review found that `review-effort-derivation.md`'s Step 2.5 label read still hand-wrote `{ctx-dir}/record-{n}.json`, the same refusal. It now pipes `gh issue view {n} --json labels` straight into the `parseRecordFacets` one-liner.
- Related journeys: `confirm-coverage-findings-across-reproduction-pairs-3049.md` (the same reproduction pairs' matcher), `keep-review-lenses-from-running-suites-3001.md` (the same fan-out's leftover sweep).
