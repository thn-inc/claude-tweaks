---
files:
  - plugin/skills/build/dispatch.md
  - plugin/bin/write-run-artifact.js
  - plugin/bin/lib/run-artifact/write.js
---

# Write, Verify, and Delete the AC-Forwarding Sample From a Worktree Session

**Persona:** The `/claude-tweaks:build` orchestrating agent, running `/superpowers:subagent-driven-development` inside a worktree-isolated session (a `/claude-tweaks:dispatch` group, or any `worktree-always` run). Behind it is a plugin maintainer who later reads `decisions.md` to see whether #496's standing AC-forwarding check actually ran.
**Goal:** Persist the first composed per-task reviewer prompt into the run directory, read it back after SDD returns, and log `AC-forwarding verified`. The agent never hits the harness's cross-checkout Edit/Write refusal and never needs to record a ruling for a workaround.
**Entry point:** `plugin/skills/build/dispatch.md`'s "Standing AC-forwarding verification (#496)" sentences, reached from `/build` Common Step 2 with `$PIPELINE_RUN_DIR` set to a run directory anchored at the main checkout.
**Success state:** `$PIPELINE_RUN_DIR/sdd-dispatch-sample.txt` is written through `bin/write-run-artifact.js` with no refusal. It is read back from that same path, and `decisions.md` gains `AUTO … — AC-forwarding verified: …` under `## /build`. The sample is then removed with `--delete`.

## Steps

### 1. Resolve a session-scoped scratch path
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SDD_SAMPLE=sdd-dispatch-sample-{run-id}.txt`, where `{run-id}` is `basename "$PIPELINE_RUN_DIR"`
- **Action:** Run it as one plain command, with no `eval`, and copy the printed `SDD_SAMPLE="<path>"` value as a literal.
- **Should feel:** Like asking for an address, not setting up state. One call, one printed path.
- **Should understand:** A shell variable set in this Bash call is gone by the next one. The literal path is the only thing that carries into the Write and persist steps.
- **Red flags:** An `eval "$(…)"` form, or a later step that refers to `$SDD_SAMPLE` instead of the printed path. Either way the writer receives an empty `--file` and exits 2.

### 2. Write the composed reviewer prompt to the scratch path
- **URL:** the Write tool, targeting the literal path from step 1
- **Action:** For SDD's first per-task review dispatch only, write the reviewer prompt verbatim, Acceptance Criteria excerpt included, before sending it.
- **Should feel:** Ordinary. The scratch path is outside the repo, so nothing guards it.
- **Should understand:** The run directory itself is never the Write target. The harness's tool-level pinning refuses Edit/Write to a main-checkout path from a worktree session (`_shared/pipeline-run-dir.md`'s tool-level pinning note).
- **Red flags:** A Write straight to `$PIPELINE_RUN_DIR/sdd-dispatch-sample.txt`, which is the #3044 refusal. A sample written for a single-task plan, which has no per-task review to sample.

### 3. Persist it with the sanctioned writer
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-dispatch-sample.txt --file "{sample-path}"`
- **Action:** Substitute the literal scratch path for `{sample-path}`, then run it. Exit 0 prints the anchored run-dir path that was written.
- **Should feel:** Like the sibling writers (`log-decision.js`, `stage-item.js`, `set-config.js`, `set-verify-expectations.js`): one command and a printed path, with no harness prompt.
- **Should understand:** Exit 2 means a malformed invocation or a `--name` outside the allowlist; only `sdd-dispatch-sample.txt`, `sdd-final-review.md` and `review-findings.json` are allowlisted today. Exit 3 means the run directory is missing, sits in a worktree-local shadow, or the file could not be written. A non-zero exit never blocks the dispatch. Send the review anyway, and the "No sample file at all" branch logs the gap later.
- **Red flags:** A sample file appearing under the worktree's own `.claude-tweaks/pipelines/` (a shadow, `[IL-127]`). A retry loop on exit 3 instead of moving on.

### 4. Read it back and log the verdict
- **URL:** the Read tool on `$PIPELINE_RUN_DIR/sdd-dispatch-sample.txt`, which is the same path step 3 echoed
- **Action:** When SDD returns, before Common Step 3, check that the file contains the forwarded Acceptance Criteria excerpt. If it does, log `AUTO {time} — AC-forwarding verified: sdd-dispatch-sample.txt contains the forwarded Acceptance Criteria excerpt.` via `log-decision.js`. If the excerpt is missing, file a fix record via `/claude-tweaks:capture`. If there is no file at all, log the SKIP line.
- **Should feel:** Decisive: one of three logged outcomes, never silence.
- **Should understand:** Reading a main-checkout path from a worktree session is not refused; only writes are. That is why the read uses the run-dir path directly and needs no writer.
- **Red flags:** A `Ruling:` line in the SDD ledger explaining a workaround for the sample. That is the friction this flow exists to remove.

### 5. Delete the sample
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-dispatch-sample.txt --delete`
- **Action:** Run it after the Present branch logs its verdict. The evidence now lives in `decisions.md`.
- **Should feel:** Safe to repeat. A second run prints the path plus `(already absent)` and still exits 0.
- **Should understand:** Deletion goes through the same writer because an `rm` built from a runtime path variable is the shape the worktree Bash guard refuses.
- **Red flags:** A leftover `sdd-dispatch-sample.txt` at archive time with an `AC-forwarding verified` line already logged.

## Origin
- Created during the build of #3044, which gave `/build`'s AC-forwarding sample a sanctioned writer reachable from a worktree session. It follows #3040's run, where the controller had to write the sample to a worktree mirror and record a ruling.
- Live example: run `2026-10-17T221758-record-3044`. It was dogfooded from its own worktree session: the delete, and a full resolve → Write → persist → Read → delete probe, all ran with no harness refusal.
- Related: `docs/journeys/measure-sdd-final-review-value-3386.md`. Its `sdd-final-review.md` write now goes through the same writer, `bin/write-run-artifact.js` (#3496).
