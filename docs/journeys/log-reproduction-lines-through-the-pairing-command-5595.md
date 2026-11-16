---
files:
  - plugin/bin/review-coordination.js
  - plugin/bin/lib/reproduction-log.js
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/step3-cross-lens-corroboration.md
  - plugin/bin/lib/timing/pair-lines.js
---

# Log Reproduction Lines Through the Pairing Command

**Persona:** a maintainer who runs `/claude-tweaks:review` inside `/claude-tweaks:flow` at `medium` effort, then reads the run's `decisions.md` and the Wrap-Up Review Console to see which findings both agents of a reproduction pair reported.
**Goal:** every per-finding reproduction line in `decisions.md` has one fixed wording, written by code, so the Console, the archive guard and the step-yield reader always parse it.
**Entry point:** `/claude-tweaks:review #{n}`, or the `review` phase of `/claude-tweaks:flow #{n}`, with a pipeline run directory.
**Success state:** `## /review` in `decisions.md` holds one `Reproduction:` line per finding (two for the sides of a coincidence), each byte-identical to `plugin/bin/lib/reproduction-log.js`'s composed form, and none typed by the session.

## Steps

### 1. Let the pair's first call write the confirmed lines — the review session
- **URL:** `node review-coordination.js categorise-reproduction "{path-A}" "{path-B}" --lens "{lens}" --run "$PIPELINE_RUN_DIR" --only confirmed`
- **Action:** after both agents of a lens's pair return, run the call. It appends the `reproduced` lines under `## /review` and prints `{confirmed, unconfirmed, entries, unlocated, logged}`.
- **Should feel:** mechanical. No template to copy, no wording to choose.
- **Should understand:**
  - When `unconfirmed` is empty no second call is needed, but the lens 3f vacuity check and the `severityContested`/`nearLocation` routing duties still apply to the confirmed findings.
  - `logged: false` means nothing was written: repeat the call once, then write the printed `entries` with `log-decision.js --entries`.
- **Red flags:**
  - A line under `## /review` that differs from the composer's wording (a typed line).
  - The call exits 2 because `--lens`, `--run` or `--only` was left off.

### 2. Make the second call after the absence check — the review session
- **URL:** the same call with `--only unconfirmed`, plus `--hold "{path-H}"` when the absence check refuted, or at `medium` corroboration promoted, a finding
- **Action:** run the absence-claim ground-truth check, wait for the corroboration pass at `medium`, then run the call. Held findings get no line; every other unconfirmed finding gets a `not reproduced` line, or a share-a-location line for a coincidence.
- **Should feel:** settled. A refuted or promoted finding never lands in the Console's low-confidence list.
- **Should understand:**
  - The hold file is a JSON array of whole `unconfirmed` entries copied from the first call's output. An entry that matches no finding, or more than one, exits 2 and writes nothing.
  - Judged lines (an absence claim refuted, a lens 3f vacuity downgrade or reconfirmation) go through `review-coordination.js log-reproduction-judgment` with a one-object file; any other `kind` exits 2.
- **Red flags:**
  - A refuted absence claim still gets a `not reproduced` line.
  - A vacuity downgrade is accepted with no earlier `reproduced` line for that location.

### 3. Read the result — the Wrap-Up Review Console
- **URL:** the Console's Low-confidence section, and `.claude-tweaks/pipelines/{run-id}/decisions.md`
- **Action:** check that each staged reproduction line produced one Console item and each confirmed line produced none.
- **Should feel:** trustworthy. The item list matches the lines, with no unparsed or duplicated entries.
- **Should understand:** a session on an older plugin release still types these lines by hand; the wording is unchanged by a byte, so every reader handles either run directory.
- **Red flags:**
  - A reproduction line the Console cannot key (it shows up under no item and settles nothing).
  - The archive guard (`aggregate-reproduction.js`) refuses a composed line.

## Origin
- Created during the build of #5595, which moved the seven per-finding reproduction line forms out of `step3-lens-dispatch.md` into `plugin/bin/lib/reproduction-log.js` and had `categorise-reproduction --run` and the new `log-reproduction-judgment` verb write them.
- Related journeys: `drop-a-refuted-code-is-missing-claim-3329.md` (the absence check), `trust-a-defect-several-review-lenses-flagged-3604.md` (cross-lens corroboration), `count-skill-file-reads-per-file-4359.md` (the step-yield reader).
