---
files:
  - plugin/bin/lib/tiebreak.js
  - plugin/bin/review-coordination.js
  - plugin/bin/hooks.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/escalate-residue.js
---

# Clear an Archive Refusal for an Untiebroken Finding

**Persona:** a maintainer who closes out a finished pipeline run. They do this either by running `archive-run` themselves or by letting reconcile archive the run once its PR merges.
**Goal:** a run whose review left a finding with no tiebreak verdict is never archived silently. The maintainer can see which finding is missing and how to settle it.
**Entry point:** `node plugin/bin/hooks.js archive-run --run {run-dir}` on a terminal run, or a reconcile sweep over a merged run. Either way, the run dir, or one of its `spec-*` subdirs, holds a `review-findings.json`.
**Success state:**
- Every finding listed in `review-findings.json` has a `tiebreak:{id}` verdict line in `decisions.md`, and the run archives.
- A run with no `review-findings.json` archives exactly as it did before this feature.

## Steps

### 1. See the refusal
- **URL:** the `archive-run` verb's stdout, or the reconcile summary's `skipped` entry
- **Action:** the maintainer archives the run. The run passed every earlier guard: the console is resolved, no auto-merge staged items are pending, and the PR closes its records. But its findings artifact lists a finding with no verdict line, so archival refuses. The verb prints `archival refused — tiebreak-coverage-missing (N listed finding(s) have no tiebreak verdict line: {ids}) — …`. Reconcile skips the run with reason `tiebreak-coverage-missing`, and the skip carries `missing` and `hint`.
- **Should feel:** specific. The refusal names the ids that are missing a verdict and tells the maintainer what to do.
- **Should understand:**
  - The ids are finding ids: 12 hex characters derived from the lens, path, line and claim.
  - A finding inside a `spec-N/` subdir appears as `spec-N/{id}`.
  - A malformed or unreadable artifact refuses under a different reason, `tiebreak-artifact-invalid`, so the two failures are never confused.
  - A merged run stuck on either reason escalates into the reconcile `structurally-stuck` record, which carries a remedy line.
- **Red flags:**
  - the run archives while `review-findings.json` lists an uncovered id
  - the refusal says nothing about which finding is missing
  - a malformed artifact reads as "no artifact" and archives
  - a run with no artifact is refused

### 2. Check coverage without archiving
- **URL:** `node plugin/bin/review-coordination.js check-coverage {run-dir}`
- **Action:** the maintainer runs the coverage check directly. It prints `{ artifactPresent, artifactValid, missing }` as JSON, aggregated over the run dir and every `spec-*` subdir.
- **Should feel:** read-only. It reports the problem and refuses nothing.
- **Should understand:**
  - The command exits 0 even when ids are missing. Refusing is the archive path's job, not this command's.
  - A run dir that does not exist exits 2, so a typo never looks like a clean run.
  - A run dir outside the main checkout (a worktree-local shadow) exits 3 for the same reason.
- **Red flags:**
  - a nonzero exit just because ids are missing
  - a mistyped or shadow run dir reported as `artifactPresent: false` with nothing missing

### 3. Settle the gap
- **URL:** the run's `decisions.md`, or its `review-findings.json`
- **Action:** the maintainer fixes it one of two ways:
  - Re-run the review step's findings writer and tiebreak for the run. Each finding then gets one verdict line through `resolve-tiebreak`, whose output is `logStatus`/`logStep`/`logText`, written via `log-decision.js`.
  - If the run predates the tiebreak, delete `review-findings.json`.

  Then they re-run `archive-run`.
- **Should feel:** finite. Once every listed id has a verdict line, the next archive attempt succeeds.
- **Should understand:**
  - Every verdict line carries the literal `tiebreak:{id}` marker, and only a line in the verdict shape counts. A finding whose lens, path or line holds `tiebreak:` is refused by the findings writer.
  - A tiebreak that never replied still produces a can't-tell verdict line, so every finding can always be covered and no waiver is needed.
  - In a #3947 run, a listed id usually lacks its line because Step 3.7 left it without a verdict on purpose. That happens when `resolve-tiebreak` exited non-zero, which leaves a `STAGED … Tiebreak: lens "{lens}" finding {path}:{line} unconfirmed; resolve-tiebreak exited {exit}, no verdict.` line in `decisions.md`, or when `log-decision.js` failed twice, which the review summary names. Re-running the tiebreak for that one finding settles it.
- **Red flags:**
  - a forged or hand-typed line that mentions `tiebreak:{id}` inside a finding's lens or path is counted as coverage

## Origin
- Created during the build of #3945. This is the first step of the unconfirmed-findings tiebreak project: the resolver, the findings artifact, and the archive coverage check. The review step that writes the artifact and dispatches tiebreak agents is #3947.
- Updated during the build of #3947. `/claude-tweaks:review`'s Step 3.7 (`plugin/skills/review/step3-tiebreak.md`) now writes `review-findings.json` and one verdict line per finding, so step 3's re-run means re-running that step. That flow is covered in `get-a-verdict-on-every-unverified-review-finding-3947.md`.
- Related journeys: `drop-a-refuted-code-is-missing-claim-3329.md` covers how an unconfirmed finding is born. `archive-a-stateless-run-dir-that-still-holds-its-spec.md` covers another archive refusal path.
