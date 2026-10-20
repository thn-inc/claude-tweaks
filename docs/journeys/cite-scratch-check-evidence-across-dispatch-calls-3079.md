---
files:
  - plugin/skills/build/plan-authoring-checks.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/dispatch/task-prompt.md
---

# Cite Scratch-Check Evidence Across Dispatch Calls

**Persona:** A `/claude-tweaks:dispatch`-driven pipeline, plus the maintainer auditing its run directory afterward. Call 1 (`build,test`) verifies an acceptance criterion with a scratch, uncommitted check, such as an audit script or a rendered-page sweep. Call 2 (`review,polish,wrap-up`) is a fresh Task call that shares only the run directory.
**Goal:** Call 2's review marks that criterion `met` by citing call 1's recorded result, not by re-running the check.
**Entry point:** `/claude-tweaks:build` Spec Step 3, while running `plugin/skills/build/plan-authoring-checks.md`'s checks on a plan whose task verifies a criterion only with a scratch check.
**Success state:** After call 1, the run's `decisions.md` holds one `AC evidence` entry for the criterion, naming the criterion, the exact command shape, and the pass/fail counts. `$PIPELINE_RUN_DIR/evidence/{name}.txt` holds the full output. Call 2's review checks the entry against that log and cites it, with no second execution.

## Steps

### 1. The plan names the evidence destination
- **URL:** `plugin/skills/build/plan-authoring-checks.md`, the **AC-evidence persistence check** paragraph.
- **Action:** The plan task that runs the scratch check names its run-dir destination:
  - one `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence"` call, with a single-quoted `--text`;
  - the full output, written with a plain Bash redirect to `$PIPELINE_RUN_DIR/evidence/{name}.txt` after `mkdir -p`.
- **Should feel:** Routine bookkeeping, the same writer every other decision line uses.
- **Should understand:**
  - "Scratch checks stay scratch" governs whether the check's *code* is committed, not whether its *result* is recorded.
  - A build with no run directory (design mode) still reports the result in the handoff.
- **Red flags:**
  - A plan that routes the result into the conversational build handoff.
  - A `decisions.md` mention ("the AC2 audit") with no counts or log path. That is #3079's original incident: call 2 re-ran 68 page renders.

### 2. Call 1 runs the check and records the result
- **URL:** the run directory: `decisions.md` and `evidence/`.
- **Action:** The implementer runs the scratch check once, redirects its output into `evidence/{name}.txt`, and writes the `AC evidence` line. The line renders as `- AUTO {hh:mm:ss} — AC evidence: {AC id and wording}: {command shape} — {N} pass / {M} fail; log: {path}. Reversibility: n/a.`
- **Should feel:** Durable. The result outlives the Task call that produced it.
- **Should understand:**
  - The log is the raw artifact the entry summarizes. Without it, the entry is only a claim.
- **Red flags:**
  - An entry whose log path does not exist.
  - A relative path, which shadows the anchored run directory.

### 3. Call 2's review cites the entry instead of re-running
- **URL:** `plugin/skills/review/code-mode-steps.md` Step 1, check 2 (Acceptance Criteria), and `plugin/skills/dispatch/task-prompt.md`'s second-call template.
- **Action:** Before marking the criterion `not met` for lack of code or test evidence, review reads `decisions.md` for an `AC evidence` entry naming it. When the entry's `evidence/` log is present and matches it, review cites the entry as the criterion's evidence.
- **Should feel:** Like checking a receipt against its source, not trusting a note.
- **Should understand:**
  - The second-call template's CRITICAL rule still holds: re-derive from raw artifacts. The `evidence/` log is that artifact, and the template's carve-out line says so.
  - A recorded result is evidence, not proof. An entry that looks inconsistent with the diff may still be re-run. This removes the forced re-run; it does not forbid one.
  - Standalone review (no `$PIPELINE_RUN_DIR`) is unchanged.
- **Red flags:**
  - Review re-running the whole check when a matching log exists.
  - Review citing an entry whose log is missing.

## Origin
- Created during build of #3079 (filed via `/claude-tweaks:feedback`). A dispatched two-call run's call 2 had to re-run a 68-render contrast audit because call 1 recorded the result nowhere durable.
- Pinned by `tests/plan-authoring-ac-evidence-prose.test.js` and `tests/review-ac-evidence-citation-prose.test.js`.
- Related: `clear-the-two-call-gate-for-a-dispatched-group-2775.md` and `confirm-call-1-bookends-before-done-2912.md`, the other halves of the two-call handoff.
