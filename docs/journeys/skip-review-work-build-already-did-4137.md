---
files:
  - plugin/skills/build/SKILL.md
  - plugin/skills/build/docs-sync.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/step3-doc-freshness-lens.md
  - plugin/skills/review/review-summary-template.md
---

# Skip Review Work /build Already Did

**Persona:** A claude-tweaks maintainer running a hands-off `/claude-tweaks:flow #N`. They want `/review` to judge the change rather than repeat `/build`'s simplify pass and doc-freshness check on a tree nobody has touched since.
**Goal:** `/review` does no simplify re-run and raises no "doc not updated" flag when `/build` already did that work on the same source. When the source has moved since `/build`'s pass, `/review` still runs both.
**Entry point:** `/build` reaches Common Step 3 (simplify) and Common Step 6.5 (docs sync) inside a pipeline run, with `$PIPELINE_RUN_DIR` set.
**Success state:** `/review` Step 5 logs `SKIP … Step 5 simplify (skipped)` instead of re-dispatching the simplifier. Lens 3i logs `SKIP … Lens 3i doc freshness (skipped)` and emits no finding for each doc `/build` cleared. The review summary reads `Simplification skipped — /build simplified at {sha}`.

## Steps

### 1. Let /build log the simplified tree
- **URL:** `{run-dir}/decisions.md`, under `## /build`.
- **Action:** After `/claude-tweaks:simplify` reports `Verification: pass` (changes committed) or `No simplifications needed`, on the branch's whole own-work scope, `/build` writes `- SCANNED {time} — Common Step 3: simplify: scope simplified at {sha}. Reversibility: n/a.`
- **Should feel:** Like the same Common Step 3 as before. No new prompt and no stop, and the Review Console shows nothing new to revert.
- **Should understand:** A BLOCKED or STAGED simplify, or one run on a narrower scope, writes no line, so `/review` simplifies as it always did.
- **Red flags:** A line written after simplify went BLOCKED. A line logged as `AUTO`, which lands in the console's "override = revert" section.

### 2. Let /build log each doc it found nothing stale in
- **URL:** `{run-dir}/decisions.md`, under `## /build`.
- **Action:** For each registry-matched doc whose read turned up nothing the change makes stale, `/build` writes one line: `- SCANNED {time} — Common Step 6.5: docs sync: {doc} assessed at {sha}, no stale text. Reversibility: n/a.`
- **Should feel:** Mechanical. One line per doc, using the doc path as `docs/REGISTRY.md` writes it.
- **Should understand:** A doc build updated inline, or deferred to the ledger, gets no such line. That doc goes through lens 3i exactly as before.
- **Red flags:** One prose line summarising seven docs, which no reader can match per doc.

### 3. Watch /review Step 5 skip the simplify re-run
- **URL:** `/claude-tweaks:review` Step 5 (Simplify Changed Code), reading `$PIPELINE_RUN_DIR/decisions.md`.
- **Action:** Review takes the last `Common Step 3: simplify: scope simplified at {sha}` line whose `{sha}` is 7-40 hex characters and checks two things. First, that `git merge-base --is-ancestor {sha} HEAD` exits 0. Second, that `git diff --name-only {sha}` (the working tree) and `git ls-files --others --exclude-standard` both exit 0 and neither lists an in-scope source file. When both hold, it logs `SKIP … Step 5 simplify (skipped): condition: build Common Step 3 simplified this scope at {sha}, no in-scope source file changed since → fallback: /claude-tweaks:simplify not re-run.` and moves on.
- **Should feel:** Like a correct shortcut. The pipeline carries on with no simplifier dispatch.
- **Should understand:** A build fix or review fix to an in-scope source file, committed or not, puts the simplify re-run back. So does a rebased branch, a `{sha}` that is not 7-40 hex characters, a listing command that exits non-zero, or a run whose `/build` predates this change and wrote free-form prose.
- **Red flags:** A skip after an uncommitted Fix-now edit to a source file. A skip with no `SKIP` line in `decisions.md`.

### 4. Watch lens 3i drop the docs /build already cleared
- **URL:** `/claude-tweaks:review` lens 3i (`step3-doc-freshness-lens.md` step 4).
- **Action:** For each registry entry whose doc was not updated in this work's commits, review looks for the matching `docs sync: {doc} assessed at {sha}, no stale text` line. If that `{sha}` is 7-40 hex characters and in `HEAD`'s history, and no file matching the entry's Auto-detect patterns has changed since (working tree plus untracked, both listing commands exiting 0), review emits no finding for it. It then logs one `SKIP … Lens 3i doc freshness (skipped)` line listing the dropped docs.
- **Should feel:** Quieter. A doc `/build` already read against the same source no longer shows up as a "Review in wrap-up" row.
- **Should understand:** A doc whose matched sources changed after `/build`'s check, or whose check failed, is still flagged. Build's verdict covered the old source, not the new one.
- **Red flags:** A doc dropped even though a review fix touched its matched source file. Docs dropped with no `SKIP` trace naming them.

### 5. Read the review summary
- **URL:** The review summary: the compact PASS `**Status:**` line, or the full form's `### Code Simplification` section.
- **Action:** Read `Simplification skipped — /build simplified at {sha}` where a re-run would have said `none needed`.
- **Should feel:** Honest. The summary says the step was skipped and why. It does not claim simplify ran and found nothing.
- **Should understand:** The `{sha}` is where to check what `/build`'s pass covered.
- **Red flags:** `Simplification none needed` on a run whose Step 5 skipped.

## Origin
- Created during build of #4137. Run `2026-10-24T121146-spec-4048` skipped both steps by judgment, with a logged rationale that departed from the written procedure. This build made that skip the procedure. It added canonical `/build` writer lines and the `/review` readers, pinned together by `tests/review-skip-build-handled-work-conformance.test.js`.
- Related: #3767 (the same `/build`-writes, `/review`-reads `decisions.md` pattern for plan steps not run).
