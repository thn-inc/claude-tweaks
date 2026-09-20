---
files:
  - plugin/skills/flow/multispec-freshness.md
  - plugin/skills/flow/multi-spec.md
  - plugin/skills/flow/multispec-batch-curation.md
  - plugin/skills/_shared/auto-mode-contract.md
---

# Respond to Multi-Spec Boundary Drift

**Persona:** Operator running a long multi-spec `/claude-tweaks:flow` batch (three or more specs, hours of wall-clock) on a repo where sibling sessions and merged PRs keep moving `origin/main` mid-run — the #856 situation, where a structural restructuring once merged cleanly under an in-flight batch and invalidated the remaining specs' assumed paths.
**Goal:** Recognize the per-spec boundary freshness check's three outcomes (silent no-op, logged auto-merge, drift gate), answer the Boundary-drift gate deliberately when it fires, and finish the batch with a curation diff that isn't polluted by the mid-run merges.

## Steps

1. **Start the batch** — Type `/claude-tweaks:flow #A,#B,#C worktree`.
   - **Action:** The run creates one shared worktree with the creation-time catch-up (`multi-spec.md` Shared-worktree Step 1), then, before every spec from spec 2 onward — whether the prior spec completed, failed, or was skipped under `MULTISPEC_KEEP_GOING` — runs the boundary freshness check per `multispec-freshness.md` (`multi-spec.md`'s Execution bullet, ordered before the per-spec scaffold step).
   - **Check:** Spec 1 gets no boundary check (the creation-time catch-up just ran). A boundary where `git rev-list --count HEAD..origin/{integration-branch}` is zero writes nothing to `decisions.md` — silence is the log-only-when-changed convention, not a skipped check. A failed fetch is the one loud silence: it writes the distinct `check skipped this boundary` entry so "checked, clean" and "check didn't run" stay distinguishable.

2. **Read a trivial-drift auto-merge entry** — After a boundary where origin moved but nothing overlapped, open the parent run directory's `decisions.md`.
   - **Action:** The check computed the incoming file set (three-dot `--name-status`, rename entries contributing both paths) against the run's own side (`git merge-base --end-of-options HEAD "origin/{integration-branch}"`, never `manifest.yml`'s `baseSha`) and the remaining specs' Key Files, found no intersection, and merged.
   - **Check:** One `AUTO {time} — Boundary freshness check (before spec {N}): shared branch advanced from {before} to {after} ({K} commit(s) from origin/{integration-branch})…` entry per merging boundary, in the **parent** `decisions.md` — not a per-spec subdirectory, and never a "sweep clean" entry for quiet boundaries.

3. **Answer the Boundary-drift gate when it fires** — A boundary whose incoming diff overlaps run-modified paths or a remaining spec's Key Files (or whose merge conflicts) stops the pipeline with a three-option `AskUserQuestion`.
   - **Action:** The gate presents *Merge + re-validate premises* (Recommended), *Merge and continue as-is*, and *Stop the run* (per `multispec-failure-handling.md`; completed specs' commits stay). It opens on a clean tree — an overlap escalates before merging, and a conflicted trivial merge is `git merge --abort`ed first.
   - **Check:** The gate fires even in `auto` mode — it is enumerated in `_shared/auto-mode-contract.md`'s "What `auto` does NOT silence" HARD-GATE row — and `MULTISPEC_KEEP_GOING` does not bypass it: keep-going skips past a failed spec, while drift invalidates every remaining spec equally. A clean `git merge` alone is never treated as proof the premises hold — overlap, not merge success, is the signal (#856 merged clean).
   - **Unattended default (autonomy: unattended only):** a narrower overlap — the incoming diff touches only run-modified paths, never reaching a remaining spec's `### Key Files` — auto-selects option 1 on a conflict-free merge instead of raising this `AskUserQuestion`: no operator answers, and a single combined `AUTO` entry in the parent `decisions.md` covers both the branch advance and the gate resolution. `supervised`/`trusted` are unaffected — the prompt still fires exactly as above. A remaining-spec-Key-Files overlap, or a merge conflict, still stops at this `AskUserQuestion` regardless of `autonomy`. See `multispec-freshness.md`'s "Unattended default" subsection.

4. **Choose re-validation and read its verdicts** — Pick option 1 unless you already know the drift is benign.
   - **Action:** The run merges, then re-reads each remaining spec's `### Key Files` and stated assumptions against the new tip (re-deriving Key Files via `bin/preflight-records.js` when the pre-flight collection has left context), writing one verdict line per remaining spec to the parent `decisions.md`.
   - **Check:** When something broke, the same open gate presents the follow-up decision (fix the spec / skip it / stop the run) — no new stop class appears later. Both log entries exist for an overlap-resolved merge: the boundary-merge `AUTO` entry and the gate-resolution entry per `_shared/auto-decision-log.md`'s schema.

5. **Finish the batch with an unpolluted curation diff** — Let the run reach the consolidated Review Console and batch curation.
   - **Action:** `multispec-batch-curation.md`'s batch scope derives from `git merge-base --end-of-options HEAD "origin/{integration-branch}"` to `HEAD`, so the upstream commits the boundary merges brought in are excluded from the batch diff.
   - **Check:** With zero boundary merges, the merge-base equals `manifest.yml`'s `baseSha` — the diff is byte-identical to the old behavior. `baseSha` itself still appears in `manifest.yml` as diagnostic provenance (the batch's true starting commit); nothing reads it as a diff base anymore.

## Outcome

The operator's long batch survives an active `origin/main`: quiet boundaries stay quiet, trivial drift lands as logged fast-forwards, and the one drift that would have silently invalidated the remaining specs' premises stops the run at a registered HARD-GATE with a clean tree and a recommended re-validation path — while the end-of-run curation pass still sees only the batch's own work, exactly as if the drift had never happened.

_Origin: record #1076 (multispec boundary freshness), built 2026-08-20._
- Updated during build of #2541 ("flow multi-spec: boundary freshness HARD-GATE has no unattended default") — Step 3 gained the `autonomy: unattended` carve-out bullet: a run-modified-only, conflict-free overlap now auto-resolves with no `AskUserQuestion`.
