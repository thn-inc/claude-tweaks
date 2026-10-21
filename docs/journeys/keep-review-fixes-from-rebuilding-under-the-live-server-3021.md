---
files:
  - plugin/skills/review/step3-routing.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/_shared/dev-url-detection.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
---

# Keep Review Fixes From Rebuilding Under the Live Server

**Persona:** a developer on a Next.js (or any build-then-serve) project running `/claude-tweaks:flow #{n}`. Earlier in the run, `/stories` or `/visual-review` started an ephemeral `next start` for this worktree and recorded it in the server record (`{run-dir}/ephemeral-server.txt`, or `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in a multi-spec run). Review then applies fixes (AUTO, Fix now, a parallel fix dispatch, `/reflect`'s "Change now", `/simplify`, or Step 6.7's late findings) and re-verifies with a suite whose e2e step runs `next build`.
**Goal:** no browser step after a fix wave is served a build that the wave's re-verify replaced. The server is stopped before the rebuild and comes back, with a new pid recorded, only when a browser step needs it.
**Entry point:** the `review` phase of `/claude-tweaks:flow #{n}` (or `/claude-tweaks:review #{n}` inside a pipeline run) on a diff that draws at least one fix.
**Success state:** `ephemeral-server.txt` either names the server started after the last rebuild, or is gone because no later step needed a browser. Wrap-up's Section D stops exactly that server, and no pre-rebuild `next start` is left running.

## Steps

### 1. Review applies its first fix wave — pipeline run, server live
- **URL:** the `review` phase of `/claude-tweaks:flow #{n}`, Step 3 Routing (or Step 4 before `/reflect`, Step 5 before `/simplify`, Step 6.7's routing wave)
- **Action:** let review route a finding to AUTO or Fix now, or dispatch 3+ parallel fix agents.
- **Should feel:** deliberate. The run's server goes quiet before anything rebuilds, rather than being swapped out silently under the browser.
- **Should understand:** `review/step3-routing.md`'s Fix-wave server coordination reads the server record that `_shared/dev-url-detection.md`'s Ephemeral server start item 4 defines: `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in a multi-spec run, `{run-dir}/ephemeral-server.txt` otherwise. It compares the worktree root (everything between the port and the trailing `detached:` token, so a path with spaces still matches) against `git rev-parse --show-toplevel`. On a match, it stops the server with wrap-up Section D's steps 2-4, which delete the record. A server recorded for another worktree is left alone. Each parallel fix agent's prompt carries the `FIX AGENT:` line, so agents edit and report but never run suites, builds, or servers. Only the dispatcher re-verifies.
- **Red flags:** the re-verify's `next build` runs while the recorded pid still answers on its port. A fix agent's reply mentions starting `next dev` or running the e2e suite. A sibling worktree's server gets killed.

### 2. Re-verify, then reach the next browser step
- **URL:** Step 6's visual review (full mode) or Step 6.7 item 4's QA re-run
- **Action:** let the re-verify finish, then let review continue to its next browser step.
- **Should feel:** like any first use of the server: one cold start, once, not one per finding.
- **Should understand:** the coordination starts nothing itself. The browser step resolves its URL through `_shared/dev-url-detection.md`. If the re-verify's own QA already started a server on the post-build app, detection reuses it. Otherwise it finds no server for this checkout and starts one through its Ephemeral server start, which writes the new pid to the main checkout's run dir with a plain Bash redirect.
- **Red flags:** two servers for the same worktree, one of them unrecorded. A browser step serves pages from before the fix. `ephemeral-server.txt` is written under the worktree's own `.claude-tweaks/` path instead of the main checkout's run dir.

### 3. End the run — wrap-up cleanup
- **URL:** `/claude-tweaks:wrap-up` Section D (in the run's `review,polish,wrap-up` call)
- **Action:** let wrap-up tear down the ephemeral server.
- **Should feel:** clean. One server is stopped, and the port is free afterwards.
- **Should understand:** Section D reads whatever `ephemeral-server.txt` currently names: the server started after the last rebuild, or nothing at all when no later step needed a browser. The record was deleted at the stop, so there is never a dead pid to kill. If a stop ever fails for real (for example, access denied), or the port is still held after the kill, the record is kept so Section D still sees the server, and the review logs a `SKIP` line naming the condition and notes that later browser results may reflect the replaced build, rather than blocking the wave. A record that cannot be parsed (fewer than four fields, a pid or port that is not a positive integer, no trailing `detached:` token) is left alone the same way: a `SKIP` line, no process signalled. Section D applies the same two rules at end of run. It validates the record before step 2 signals anything, so an unparseable record gets a `SKIP` line and no kill. When the port is still held after its own kill, Section D keeps `ephemeral-server.txt`, logs a `SKIP` line, and reports a cleanup failure naming the recorded pid and the port, so the survivor is never forgotten.
- **Red flags:** a `next start` from before the fix wave is still listening after wrap-up. `decisions.md` shows a failed stop with no `SKIP` line. Wrap-up deletes `ephemeral-server.txt` while the recorded port still answers. A record with pid `0`, `-1` or a non-numeric pid reaches a `kill`.

## Origin
- Created during build of #3021. On plugin 6.136.0, review Step 6.7 AUTO-applied four visual and design findings. The fixer's e2e verification ran `next build`, which rewrote `.next` in the shared worktree while the run's ephemeral `next start` kept serving it to QA and visual review. Nothing failed loudly. The fix adds review's Fix-wave server coordination (stop before the rebuild, lazy restart at the next browser step) and the `FIX AGENT:` no-build line.
- Related journeys: `keep-review-lenses-from-running-suites-3001.md` (the read-only lens counterpart), `trust-the-qa-line-after-a-review-fix-wave-3047.md` (Step 6.7's QA re-run, which now restarts the server).
- Updated during build of #3664: wrap-up's Section D now validates the record before signalling anything, and keeps the record and reports a cleanup failure when the port survives the kill. These rules are the same ones the fix-wave coordination already guarded on its own side.
- Known gaps, filed: #3657 (Section D's own `detached:` parse with spaced paths).
- Updated during build of #3656: a multi-spec run now keeps one server record at the parent run dir, so a later spec's fix wave finds and stops the server an earlier spec started. See `keep-a-multispec-runs-shared-server-tracked-3656.md`.
