---
files:
  - plugin/skills/build/dispatch.md
  - plugin/bin/write-run-artifact.js
---

# Measure What SDD's Final Whole-Branch Review Caught on a Finished Run

**Persona:** A claude-tweaks maintainer collecting evidence for #3381 (does `/flow` need both SDD's final whole-branch review and `/claude-tweaks:review`?). They have a finished `/flow` run directory and want to know what SDD's final reviewer found, against which commit, and what its fix wave changed. SDD deleted its own workspace at Finish, so none of that can be read from SDD itself.
**Goal:** Read SDD's final-review record from the run directory, re-run `/claude-tweaks:review`'s lenses on the exact range the final reviewer saw, and score the overlap, using the build's SDD rulings in the run ledger as context.
**Entry point:** A completed `/flow` run under `.claude-tweaks/pipelines/{run-id}/` (multi-spec: `{run-id}/spec-{N}/`) whose build ran `/superpowers:subagent-driven-development` through its final whole-branch review.
**Success state:** For that run the maintainer has: the final reviewer's findings with severities, the reviewed range (package base..reviewed SHA), the fix-wave range and re-review verdicts, and a `/review` pass over the same pre-fix-wave range. Each finding is classified as found by both, by SDD only, or by `/review` only, and that row is ready to add to #3381's measurement.

## Steps

### 1. Find the record, or confirm it should not exist
- **URL:** `{run-dir}/sdd-final-review.md` (multi-spec: `{run-dir}/spec-{N}/sdd-final-review.md`)
- **Action:** Open the file. If it is missing, check the run's `config.yml` (`ceremony-profile: fast-lane`) and `decisions.md` (a `SKIP … Whole-branch review skipped: fast-lane, single-task plan` line under `## /build`) for the single-task fast-lane skip, the one case in a `/flow` run where SDD dispatched no final review and nothing is written. A standalone `/build` also writes nothing, but it has no run directory to open, so it never reaches this step.
- **Should feel:** Like a lookup, not a hunt. One file per spec, always in the same place, with an absolute run-directory path even when SDD ran inside a worktree.
- **Should understand:** The file is maintainer evidence, not a gate. No skill blocks on it, so a missing file means the fast-lane skip applied, SDD ignored the instruction, or the writer (`bin/write-run-artifact.js`) refused with a non-zero exit. It never means the run failed.
- **Red flags:** A copy under the worktree's `.claude-tweaks/pipelines/` instead of the main checkout's (a relative-path shadow, `[IL-127]`). A controller ruling or workaround note about writing the file from a worktree: since #3496 it goes through `bin/write-run-artifact.js --name sdd-final-review.md`, so a harness refusal means `dispatch.md` was not followed. A missing file whose `## /build` decisions log has a `SKIP … — SDD final review dispatched but sdd-final-review.md absent` line: the review ran, but its findings were not captured.

### 2. Read the findings and the commits they belong to
- **URL:** the file's header fields and its findings section
- **Action:** Note the reviewed commit SHA (HEAD when the review package was built), the package's base commit, and every finding with its severity, quoted verbatim.
- **Should feel:** Self-contained. The file holds the reviewer's own words and names both ends of the reviewed range, so no git archaeology is needed.
- **Should understand:** On a multi-spec shared branch the base is not `git merge-base main`. Each spec reviews its own slice of the branch, which is why the base is recorded separately from the SHA.
- **Red flags:** Findings that have been paraphrased or summarized instead of quoted. A reviewed SHA without a base.

### 3. Run `/review`'s lenses on the pre-fix-wave range
- **URL:** a scratch checkout of the reviewed SHA, then `/claude-tweaks:review` scoped to `{base}..{reviewed SHA}`
- **Action:** Review exactly the range SDD's final reviewer saw, not the branch after the fix wave, and save `/review`'s findings beside the SDD list.
- **Should feel:** Like a controlled comparison: same code, same range, two reviewers.
- **Should understand:** Reviewing the post-fix HEAD instead would credit `/review` with nothing SDD's wave already fixed and undercount the overlap. The fix range (`FIX_BASE..HEAD`) shows exactly which commits to leave out.
- **Red flags:** A `/review` run on the branch tip. A scratch checkout left behind in the shared stash or worktree registry.

### 4. Score the overlap
- **URL:** the two finding lists side by side, plus the file's fix-wave range and re-review verdicts
- **Action:** Mark each finding as caught by both, by SDD only, or by `/review` only, and record whether SDD's fix wave resolved it according to the re-review verdict (`ADDRESSED` or not).
- **Should feel:** Mechanical once the two lists exist. The verdicts are already per finding.
- **Should understand:** "no fix wave" means the final reviewer had nothing to fix, and "no re-review" follows from it. That is a clean SDD pass and still a valid data point, not missing data.
- **Red flags:** Counting severity mismatches as misses. Scoring from memory rather than from the file.

### 5. Cross-check the build's SDD rulings in the run ledger
- **URL:** `docs/plans/{date}-{slug}-ledger.md`, phase `build` rows with status `observation` (SDD parked findings), `deferred` (SDD deferred minors), or — since #3401 — the ruling rows themselves: `open` until the Review Console ratifies (`accepted`) or reverses (`deferred`, `reversed → #{n}`) them, each with a `staged/sdd-ruling-{N}.md` back-reference. `/build`'s carry-forward writes the text after the marker as the Item for minors and parked lines; a ruling row's Item reads `SDD ruling — {one-liner}: ratify or reverse at the Review Console (staged/sdd-ruling-{N}.md)`
- **Action:** Read the rulings the controller made instead of stopping, such as fix-wave scope, deferred-minor triage and ranges reviewed, next to the findings they settle.
- **Should feel:** Like reading the reviewer's margin notes: why a finding was accepted, deferred or folded into one wave.
- **Should understand:** Since #3386, `/build` copies SDD 6.3.0+ `Ruling:` lines into the run ledger; since #3401 a line whose first marker match is `Ruling:` lands as an `open` row plus a staged `sdd-ruling-{N}.md` the Review Console surfaces for ratify or reverse (`docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md`), so the console's disposition is part of the evidence here too.
- **Red flags:** A final-review finding with no matching ruling or fix commit, meaning it was dropped silently. Ledger rows still citing SDD's "Cleanup step", which is `## Finish`.

## Origin
- Created during build of #3386 (persist SDD's final whole-branch review findings, reviewed commit and fix range to the run directory), part of the "Build dispatch cost shape" decomposition (parent #3374).
- Live example: run `2026-10-17T111000-spec-3376-3386`'s `spec-3386/sdd-final-review.md` (reviewed 71b6bda2f from base 7dbd57189, fix wave 71b6bda2f..c0f85208d, all re-review verdicts ADDRESSED).
- Updated during build of #3496: SDD now writes the record through `bin/write-run-artifact.js` (resolve a session-tmp scratch path, Write it, persist), so a worktree-isolated session no longer hits the harness's cross-checkout refusal. Live example: run `2026-10-19T195822-record-3496`'s `sdd-final-review.md`, persisted from its own worktree.
- Related: `docs/journeys/repin-an-upstream-plugin-dependency-3376.md`; `docs/journeys/write-the-ac-forwarding-sample-from-a-worktree-3044.md` (the same writer, for the AC-forwarding sample); #3381 consumes this measurement.
