---
files:
  - plugin/skills/_shared/dev-url-detection.md
  - plugin/skills/review/step3-routing.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
  - plugin/skills/flow/multispec-review-console.md
  - plugin/skills/dispatch/task-prompt.md
---

# Keep a Multi-Spec Run's Shared Server Tracked

**Persona:** a developer on a build-then-serve web project (Next.js, say) who runs `/claude-tweaks:flow #A,#B,#C`, or lets `/claude-tweaks:dispatch` bundle those records. The first spec's `/stories` or `/visual-review` starts an ephemeral dev server for the run's shared worktree. The later specs reuse it by port probe instead of starting their own.
**Goal:** every spec's review fix wave stops that one shared server before rebuilding, and the end of the run kills it. No server from this run is still listening after the run finishes.
**Entry point:** the `review` phase of the second (or any later) spec in a multi-spec `/claude-tweaks:flow` run, on a diff that draws at least one fix.
**Success state:** the run has exactly one server record, `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in the parent run dir. It either names the server started after the last rebuild or is gone. The consolidated Review Console's teardown leaves the recorded port free.

## Steps

### 1. The first spec starts the shared server
- **URL:** spec #A's `/claude-tweaks:stories` or `/claude-tweaks:visual-review` step, inside the run's shared worktree
- **Action:** let the browser step resolve its URL. No server answers for this checkout, so it starts one.
- **Should feel:** invisible: one cold start for the whole run, not one per spec.
- **Should understand:** `_shared/dev-url-detection.md`'s Ephemeral server start item 4 writes the server record. With `MULTISPEC_PARENT_DIR` set, as it is for every per-spec invocation in a multi-spec run, that record is `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in the parent run dir, not spec #A's own `{parent}/spec-A/` dir. A dispatched bundle's first call writes to `{minted-run-dir}/ephemeral-server.txt`, which is that same parent dir.
- **Red flags:** the record shows up under `spec-A/` instead of the parent dir. A second record appears when spec #B reuses the server.

### 2. A later spec's review applies a fix wave
- **URL:** spec #B's `review` phase, Step 3 Routing (or Step 4, Step 5, or Step 6.7's routing wave)
- **Action:** let review route a finding to AUTO or Fix now.
- **Should feel:** the same as in a single-spec run. The server goes quiet before the re-verify's build.
- **Should understand:** `review/step3-routing.md`'s Fix-wave server coordination reads the server record, the parent one, so it finds the server spec #A started. It stops it with wrap-up Section D's steps 2-4 before the re-verify, and the next browser step restarts it lazily, rewriting the same parent record.
- **Red flags:** spec #B's re-verify runs `next build` while the recorded pid still answers. `decisions.md` shows the coordination skipping with "no server record" while a server is live for this worktree.

### 3. The consolidated Review Console tears the server down
- **URL:** the multi-spec consolidated Review Console's Shared teardown, step 1 (Cleanup actions row 15)
- **Action:** approve the console, or let it auto-resolve under `unattended`.
- **Should feel:** clean. One kill, and the port is free afterwards.
- **Should understand:** in auto/hybrid runs each spec's wrap-up defers Section D under `MULTISPEC_REVIEW_DEFER=1`, so the shared server stays up across specs. Console step 1 then runs Section D steps 2-4 against `$MULTISPEC_PARENT_DIR/ephemeral-server.txt`, the path the writer used. In interactive multi-spec mode nothing is deferred: each spec's wrap-up stops the shared record, and the next browser step restarts it. A single-spec run keeps `{run-dir}/ephemeral-server.txt`, exactly as before.
- **Red flags:** a dev server from this run still listens after the console finishes. The console reports nothing to tear down while a `spec-{N}/ephemeral-server.txt` exists.

## Origin
- Created during build of #3656. In a multi-spec run each spec's `PIPELINE_RUN_DIR` is `{parent}/spec-{N}/`, so the record landed in whichever spec started the server. Later specs' fix waves found no record and skipped the stop (the #3021 defect again), and the consolidated teardown read `{parent-run-dir}/ephemeral-server.txt`, a path nothing wrote. The fix makes the parent run dir the one record location and pins writer and readers together in `tests/multispec-ephemeral-server-record-conformance.test.js`.
- Related journeys: `keep-review-fixes-from-rebuilding-under-the-live-server-3021.md` (the single-spec fix-wave coordination this extends), `multi-spec-review-console.md` (the consolidated console).
- Parallel-wave members (`flow/multispec-parallel-waves.md`) run without `MULTISPEC_PARENT_DIR`, so a member's server is recorded under its own `spec-{N}/`. The wave's merge-back stops any such record before the member worktree is removed (Section D steps 2-4), so no member server outlives the run either.
