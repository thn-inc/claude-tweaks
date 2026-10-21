---
files:
  - plugin/bin/lib/flow/consolidated-pass.js
  - plugin/bin/lib/hooks/run-integrity.js
  - plugin/bin/lib/hooks/session-residue.js
  - plugin/bin/lib/hooks/session-start.js
  - plugin/bin/lib/work-backend.js
  - plugin/skills/flow/multispec-review-console.md
  - plugin/skills/flow/steps-and-gates.md
  - plugin/skills/flow/multi-spec.md
---

# Finish a Multi-Spec Run After the Parent Session Ended

**Persona:** a maintainer who started `/claude-tweaks:flow #A,#B` in `auto` mode, watched both specs build, test and review inside the pipeline, and then lost the parent session (closed terminal, crash, or an exhausted context) before the run's deferred consolidated wrap-up rendered its console. They open a fresh session on the same machine the next morning.
**Goal:** run the deferred batch curation pass and the one consolidated Review Console the ended session never reached, then merge the shared branch, without closing the parent run first or redoing work that already finished.
**Entry point:** the SessionStart unfinished-run banner in the new session, whose line for the parent run ends with ` — consolidated pass never ran: PIPELINE_RUN_DIR="{parent-run-dir}" /claude-tweaks:flow #A,#B review-console`, with the full run directory filled in.
**Success state:** the re-entry's eligibility check returned `eligible`. The batch pass ran when the parent held no `engine-state.json`, one consolidated console covered both specs, and its terminal decision merged the shared PR or left it open for a human. Shared teardown ran `close-run` last, from the pass itself. When the run was not eligible instead, the session stopped with one line naming the reason and the command that applies.

## Steps

### 1. Spot the re-entry command on the banner — terminal
- **URL:** SessionStart banner, "unfinished pipeline run(s) detected"; produced by `plugin/bin/lib/hooks/session-residue.js` `collectStaleRuns`, relayed per `plugin/bin/lib/hooks/session-start.js`'s relay directive
- **Action:** Read the parent run's line. Along with the run name, the line carries a suffix holding the complete re-entry command, run directory included. The session's first reply relays that command, not a `close-run` command, and never runs it itself.
- **Should feel:** Like being handed the exact next step. The maintainer does not have to work out which of the two specs, or which run, is waiting.
- **Should understand:** The ids in the command follow the project's record grammar. The banner reads the main checkout's CLAUDE.md through the shared reader in `plugin/bin/lib/work-backend.js`. Under `work-backend: local-files` the ids print bare (`A,B`), the form that backend resolves. Under `github-issues`, an unknown value, or an unreadable CLAUDE.md, they keep the `#` sigil (`#A,#B`). The suffix is offline evidence only. It appears when the run is unarchived, not closed, ran in `auto` or `hybrid` mode, has no `console.json`, has no `pending` or `running` spec, is not owned by a live session, and has no merge evidence. A squash-merged branch can still show the suffix, because offline git evidence can prove that a branch landed but never that it did not. The re-entry's own check settles that.
- **Red flags:** The relayed line offers only `close-run` for a run whose banner line carries the suffix (the relay directive in `session-start.js` was ignored). A `local-files` project whose suffix still shows `#`-prefixed ids, which its backend will not resolve as written. The suffix on a run whose parent session is visibly still running elsewhere (the worktree-lock liveness check failed to fire).

### 2. Re-enter with the parent run directory named — terminal
- **URL:** `plugin/skills/flow/multispec-review-console.md`, "Re-entry after the parent session ended"; `plugin/skills/flow/steps-and-gates.md`'s `review-console` row
- **Action:** Paste the banner's command as it stands: `PIPELINE_RUN_DIR="{parent-run-dir}" /claude-tweaks:flow #A,#B review-console`, with the run directory already filled in.
- **Should feel:** Like resuming one run, not starting a new one. No second run directory appears, no claim is contested, and no build starts.
- **Should understand:** `PIPELINE_RUN_DIR` names the parent explicitly, so the most-recent-matching-slug heuristic never chooses between two runs for the same ids. A `review-console`-only step list never reaches Step 2.8's claiming, so the ended parent's claims stay as they are. If the parent `decisions.md` already logs a `Review Console: terminal decision stop`, this is a Halt resume instead: the console is re-presented and the eligibility check is skipped.
- **Red flags:** A fresh run directory created for `#A,#B` (the step list or `PIPELINE_RUN_DIR` was wrong). A build or test phase starting.

### 3. Read the eligibility verdict — terminal
- **URL:** the `checkPassReentry(process.argv[1], { online: true, sessionId })` call in that same section, which takes the run directory as an argument and treats a non-zero exit or non-JSON output as a stop; `plugin/bin/lib/flow/consolidated-pass.js`, whose offline merge evidence comes from `plugin/bin/lib/hooks/run-integrity.js`'s `checkBranchLanded`
- **Action:** Let the check run. With `eligible`, the pass continues to the next step. With any other `reason`, the session stops with one line naming `reason` and `detail`, and the maintainer follows the command that line names.
- **Should feel:** Decisive. Either the pass runs, or one line says why not and what to run instead. There is never a half-run console.
- **Should understand:** This check is the authoritative gate, because it also asks GitHub about the recorded PR: `MERGED` means `landed`, and an `OPEN` PR counts as not landed. `archived`, `closed` and `landed` point at `/claude-tweaks:wrap-up #{n}` once per record. That fallback gives each record its Reflect and curation back, but the run-level batch pass stays lost. `spec-unfinished` names the specs still `pending` or `running`, with `spec-status` corrections for a manifest left stale. `parent-live` means another session still owns the run. `console-exists` means the console already rendered, so it is resolved where it lives.
- **Red flags:** A pass that proceeds past an `online PR check unavailable` detail without first confirming the PR is unmerged, which is how an already squash-merged run gets a second console. A `spec-unfinished` stop offering only `--status complete` for a spec that never ran (marking it complete would flip its `Refs` line to a closing `Fixes`).

### 4. Approve the consolidated console the ended session never reached — `AskUserQuestion`
- **URL:** `plugin/skills/flow/multispec-batch-curation.md`, then `plugin/skills/flow/multispec-review-console.md`'s "When to run the consolidated console"
- **Action:** The resuming session exports `MULTISPEC_PARENT_DIR`, treats the run as `MULTISPEC_CURATION_DEFER=1` and `MULTISPEC_REVIEW_DEFER=1`, and runs the batch curation pass first when the parent holds no `engine-state.json`. The maintainer then answers the console's terminal decision: "Approve all + merge (Recommended)", "Approve all, leave PR open", "Override specific items", or "Stop and re-engage". The rest of that decision is documented in `multi-spec-review-console.md`.
- **Should feel:** Like the same wrap-up the original run was deferring, rendered a day late, not a cut-down substitute.
- **Should understand:** The batch pass seeds from the completed specs' `/claude-tweaks:review` Key Learnings. Those may not survive the ended session (they lived in its transcript or in the PR verdict comment), so the Reflect can be thinner than the original run's would have been.
- **Red flags:** A batch pass that runs again on a parent that already holds `engine-state.json`. A console that omits one of the two specs.

### 5. Let the pass close the run — terminal
- **URL:** `plugin/skills/flow/multispec-review-console.md`'s Shared teardown; `plugin/skills/flow/multi-spec.md`, "Never close the parent first."
- **Action:** Leave `close-run` to the pass. On a merge, Shared teardown runs it. Under "leave PR open", the reconciler completes cleanup once the PR merges.
- **Should feel:** Hands-off, and final. The next session's banner no longer lists the run.
- **Should understand:** A manual `close-run` on the parent before this re-entry would have made the run `closed`, so the check would answer `closed` and only the per-record fallback would remain. That is the forfeiture the banner suffix exists to prevent.
- **Red flags:** The run still listed with the suffix after a merged console (teardown did not archive it). The maintainer typing `close-run` against the parent at any point in this journey.

## Origin
- Created during build of #3497 ("Consolidated-pass re-entry via review-console", run 2026-10-19T034326-spec-3497): the ended-parent re-entry in `multispec-review-console.md`, `checkPassReentry` in `plugin/bin/lib/flow/consolidated-pass.js`, `checkBranchLanded` in `run-integrity.js`, and the SessionStart banner suffix.
- Steps 1-5 built in this session.
- Updated during build of #3554 (run 2026-10-21T055740-record-3554): step 1's banner ids follow `work-backend` — bare under `local-files`, `#` otherwise — read via the shared `plugin/bin/lib/work-backend.js` reader.
- Related: `rejoin-a-multispec-run-with-a-spec-built-outside-flow-3033.md` (its step 5 covers the same re-entry for a spec built outside `/flow`), `multi-spec-review-console.md` (the console itself), #3033 (the forfeited-pass incident).
