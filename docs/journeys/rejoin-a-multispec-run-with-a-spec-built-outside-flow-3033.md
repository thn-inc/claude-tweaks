---
files:
  - plugin/skills/flow/multi-spec.md
  - plugin/skills/wrap-up/SKILL.md
---

# Rejoin a Multi-Spec Run With a Spec Built Outside /flow

**Persona:** a maintainer on one feature branch who started `/claude-tweaks:flow #A,#B` in `auto` mode, let spec A build inside the pipeline, then implemented spec B by running `superpowers:subagent-driven-development` directly against a plan file, and now wants both merged without losing the deferred consolidated wrap-up.
**Goal:** get B tested and reviewed, get one consolidated wrap-up and one merge for the whole branch, and never close the parent run before that wrap-up has run.
**Entry point:** `plugin/skills/flow/multi-spec.md`'s `## Mixed execution (a spec built outside /flow)` section, reached directly or from `plugin/skills/wrap-up/SKILL.md`'s detect-from-context pointer when a standalone `/claude-tweaks:wrap-up` sees two records on one branch.
**Success state:** B's tail run has passed `test` and `review` without a wrap-up. The parent's manifest shows B `not-run`. The parent's consolidated pass has rendered one console naming B in its Not run / Failed footer, and its terminal decision merged the shared PR (or left it open for a human). `close-run` happened last, from the pass itself. B's record, which does not close on that merge, has been closed by hand.

## Steps

### 1. Run B's tail against the parent run directory, stopping before wrap-up
- **URL:** `plugin/skills/flow/multi-spec.md`, Mixed execution step 1
- **Action:** From inside the shared worktree, run `PIPELINE_RUN_DIR="{parent-run-dir}" /claude-tweaks:flow #{B} test,review,polish`. Step 2.8's self-owned skip-guard passes because the parent already holds B's claim, and Step 3 adopts the parent directory.
- **Should feel:** Like resuming, not starting over. There is no claim contest, no second run directory, and no merge prompt, because the tail never reaches `wrap-up`.
- **Should understand:** Both halves of the command are load-bearing. Without `PIPELINE_RUN_DIR`, Step 2.8 mints a fresh run directory and contests B's live claim, so the call stops before Step 3. With `wrap-up` in the step list, that wrap-up's cleanup would `close-run` and archive the adopted parent directory.
- **Red flags:** A "Claim contested" card naming the parent run, which means `PIPELINE_RUN_DIR` was omitted. A tail run that renders its own Review Console or merge prompt, which means `wrap-up` crept into the step list.

### 2. Record B `not-run` in the parent manifest
- **URL:** `plugin/skills/flow/multi-spec.md`, Mixed execution step 2
- **Action:** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" spec-status --run "{parent-run-dir}" --spec {B} --status not-run --phase build`, then remove B's `auto:build` grant.
- **Should feel:** Like a short bookkeeping step with consequences stated up front, not discovered later.
- **Should understand:** A `not-run` spec stays off the merge's issue list, its `Fixes` line becomes `Refs`, and its claim releases `never-started:` with grants kept. B's commits ship in the merge, but B's record does not close on it. The grant removal stops a `/claude-tweaks:dispatch` firing from rebuilding B once the claim releases.
- **Red flags:** B still carrying `auto:build` when the consolidated pass runs. A `spec-status` refusal (`no-manifest`), which means the parent run never created `manifest.yml`.

### 3. Let the parent's consolidated pass make the single merge
- **URL:** `plugin/skills/flow/multi-spec.md`, Mixed execution step 3; `plugin/skills/flow/multispec-review-console.md`
- **Action:** The parent `/claude-tweaks:flow` session continues to its batch curation pass and its consolidated Review Console. The maintainer picks "Approve all + merge", or "Approve all, leave PR open" to hand the merge to a human.
- **Should feel:** Like the one wrap-up the run was deferring all along. A single console covers both specs, and B's changed files are inside the batch pass's merge-base diff.
- **Should understand:** B's own `/claude-tweaks:review` Key Learnings are not seeded into the batch pass, because it seeds only from completed specs. If the parent session has already ended, no documented step re-runs this pass, and the run is treated as already closed (step 5).
- **Red flags:** Two consoles for the same branch. A merge that happened from B's tail run instead of from this console.

### 4. `close-run` comes last, from the pass itself
- **URL:** `plugin/skills/flow/multi-spec.md`, Mixed execution step 4 and "Never close the parent first."
- **Action:** Leave `close-run` to the pass. On a merge, the console's Shared teardown runs it. Under "leave PR open", the reconciler completes cleanup once the PR merges. Afterwards, close B's record by hand.
- **Should feel:** Hands-off. The maintainer never types `close-run` against the parent.
- **Should understand:** Closing the parent before the pass forfeits the per-spec Reflect, curation engine and Review Console of every spec that ran under `MULTISPEC_CURATION_DEFER=1` and `MULTISPEC_REVIEW_DEFER=1`. Nothing in `close-run` checks whether the pass ran.
- **Red flags:** A manual `hooks.js close-run` on the parent while the consolidated pass is still pending, which is exactly the incident #3033 records.

### 5. Already closed: fall back to per-record wrap-up
- **URL:** `plugin/skills/flow/multi-spec.md`, "Already closed?"; `plugin/skills/wrap-up/SKILL.md`, "If no arguments, detect from context"
- **Action:** When the parent was closed before its consolidated pass, run `/claude-tweaks:wrap-up #{n}` once per record instead of a bare `/claude-tweaks:wrap-up` that would infer the work from the conversation.
- **Should feel:** Honest about the loss. Each record gets its own Reflect, curation and Review Console back, and the run-level batch pass stays lost.
- **Should understand:** Nothing re-runs a forfeited consolidated pass. The per-record fallback is record-scoped and cannot recover the run-level batch pass.
- **Red flags:** A bare `/claude-tweaks:wrap-up` on a two-record branch quietly reconstructing the work from conversation context.

## Origin
- Created during #3033's build (run 2026-10-17T215318-record-3033): the Mixed execution section in `multi-spec.md`, the detect-from-context pointer in `wrap-up/SKILL.md`, and `tests/flow-mixed-execution-convention.test.js`.
- Related: `handle-a-failed-multispec-preflight-3351.md` (another multi-spec stop path) and #3035 (`hooks.js manifest-init`, which made step 2's `spec-status` call possible).
