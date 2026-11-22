---
files:
  - plugin/bin/review-lens-select.js
  - plugin/bin/lib/review-lens/facts.js
  - plugin/bin/lib/review-lens/select.js
  - plugin/bin/lib/review-lens/selection-record.js
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/review/step3-lens-selection.md
  - plugin/skills/review/step3-lens-dispatch.md
---

# Select Review Lenses From Diff Facts and Lens Yield

**Persona:** a maintainer whose `/claude-tweaks:review` runs dispatch every lens of the tier on every diff, including a docs-only change that no shell-heavy lens can find anything in, and who wants lenses with a proven low yield to sit out diffs no fact calls them for, without ever losing a lens on the diffs where it matters; then the `/claude-tweaks:review` session inside a pipeline run that applies that choice at Step 3.
**Goal:** under `review-lens-selection: adaptive`, each review dispatches only the tier lenses the diff's facts and each lens's confirmed-finding history call for, a below-floor lens still runs every third review so its history keeps moving, and every skip and every fallback is written down where a later reader can see it.
**Entry point:** `.claude-tweaks/policy.yml` without a `review-lens-selection` line (the default, `tier`), a pipeline run directory (`$PIPELINE_RUN_DIR`), the review's resolved tier and merge base, and the record's `Risk-flags:` line if it has one.
**Success state:** the review dispatches exactly the CLI's `selected` lenses on both the Task path and the workflow path; `lens-selection.json` sits beside `lens-dispatch.json`; `decisions.md` holds one `SKIP` line per skipped lens naming its share, floor and streak, or one `AUTO` line naming why the whole tier set ran.

## Steps

### 1. Opt in — the maintainer
- **URL:** `.claude-tweaks/policy.yml` → `review-lens-selection: adaptive`
- **Action:** add the line, after checking the build replay's evidence for this repository (the PR that shipped the selector quotes it). The key is an enum, `tier | adaptive`, default `tier`.
- **Should feel:** a deliberate opt-in with its risk stated up front, not a default that quietly started skipping lenses.
- **Should understand:**
  - At `tier`, nothing changes: Step 3 never reads `step3-lens-selection.md` and dispatches the tier's whole set.
  - The tier's lens set stays the ceiling under `adaptive`; selection only removes lenses, never adds one the tier excludes.
  - This repository's own opt-in waits for a retune: the build replay lost one held-out medium 3d finding, so the zero-loss bar was missed.
- **Red flags:**
  - A value other than `tier` or `adaptive` resolving to anything but the default.
  - Any lens skipped while the key is unset.

### 2. Select the lenses — the review session
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/review-lens-select.js" --run "$PIPELINE_RUN_DIR" --tier {tier} --base {base} [--risk-flags "{risk-flags}"]`
- **Action:** run the call once per review, after Step 2.5 resolves the tier and before any lens dispatch. Quote the `Risk-flags:` value, and leave the flag out when the record has none. The CLI computes the diff facts from `{base}...HEAD`, reads each lens's history and skip streak, writes `lens-selection.json`, logs its own `SKIP` and `AUTO` lines, and prints one JSON line, `{ tier, selected, skipped, fallback }`.
- **Should feel:** one mechanical call whose answer is a list to dispatch, not a judgment the session has to make lens by lens.
- **Should understand:**
  - A lens whose history is still `insufficient` (fewer than 20 qualifying runs) always runs.
  - A lens at or above the share floor runs on every diff it applies to or that a fact calls it for; below the floor it runs only when a fact calls for it, or on the third review since it last ran.
  - `Risk-flags: none` or an empty value means no flags; a value with characters outside lowercase letters, digits, `-`, `,` and spaces goes in as `"malformed"`, which counts as flagged.
  - Standalone (no run directory) skips the CLI and dispatches the whole tier set, saying so in the report.
  - Multi-spec member runs (`spec-N/`) count toward skip streaks the same as top-level runs.
- **Red flags:**
  - A docs-only diff at `high` dispatching 3d while 3d is below the floor and not forced.
  - The same diff plus a `git` call inside a per-file loop in `plugin/bin/` not selecting 3d.
  - A prose-only change to a protected path at `high` skipping 3b, 3c or 3e because their share is high.
  - The session writing its own `SKIP` line for a lens the CLI skipped.

### 3. Fall back to the full tier set — the review session
- **URL:** the CLI's JSON line (`fallback` non-null), or its exit code 1 or 2
- **Action:** when `fallback` is non-empty, dispatch the `selected` list, which the CLI already set to the full tier set. When the CLI exits 1 or 2 or prints output that does not parse as one JSON line, dispatch the full tier set and log one `AUTO` line with `log-decision.js` (`review-lens-select exit {n}: full tier set dispatched`).
- **Should feel:** failure costs extra lenses, never a missed one.
- **Should understand:**
  - Any single fact that cannot be computed (an unresolvable base, a failed `git diff`, an unreadable policy file) selects the full tier set and names the fact. It is never read as "no facts call for anything".
  - An unreadable history root or archive selects the full tier set too, because the 20-run window would not be the real one; a single unreadable run only drops that run.
- **Red flags:**
  - A `SKIP` line for any lens on a fallback review.
  - A fallback with no `AUTO` line naming its reason.

### 4. Dispatch exactly the selected lenses — the review session
- **URL:** Step 3's Task dispatch, or the `lenses` argument of the workflow in `step3-workflow-dispatch.md`
- **Action:** dispatch the lenses in `selected` and no others. Lens 3h still goes through its own QA-data gate. Each dispatched lens is still recorded with `review-coordination.js record-lens-dispatch`, which feeds the history the next selection reads.
- **Should feel:** the prose filter and the CLI never disagree, because under `adaptive` only the CLI decides.
- **Should understand:** the "skip a lens if it doesn't apply to this change type" prose and the `low`-tier no-executable-content skip do not apply under `adaptive`; the CLI's facts replace them, and the workflow path's Task fallback reads the same output without running the CLI again.
- **Red flags:**
  - A lens in `skipped` producing findings.
  - The CLI run a second time in one review.

## Origin
- Created during the build of #6001 (Phase 10 of the pipeline economy design), which added `plugin/bin/review-lens-select.js`, `plugin/bin/lib/review-lens/facts.js`, `select.js` and `selection-record.js`, the `review-lens-selection` policy key, and `plugin/skills/review/step3-lens-selection.md`.
- Related journeys: `record-lens-dispatches-and-read-lens-history.md` (the dispatch record and history reader this selector reads) and `run-review-lenses-through-a-workflow-5599.md` (the workflow path whose `lenses` this selection sets).
