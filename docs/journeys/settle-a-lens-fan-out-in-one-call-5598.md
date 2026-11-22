---
files:
  - plugin/bin/review-coordination.js
  - plugin/bin/lib/lens-reply.js
  - plugin/bin/lib/status-line.js
  - plugin/bin/lib/reproduction-log.js
---

# Settle a Lens Fan-Out in One Call

**Persona:** a review session (or a maintainer driving one by hand) that has just collected every lens reviewer's reply text from a `/claude-tweaks:review` Step 3 fan-out — the shape #5599's workflow script returns — and wants the pairs settled and logged without transcribing a single table row.
**Goal:** one `settle-lens-replies` call per write reads every reply, pairs each lens whose two reviewers both answered usably, logs the pair lines, and names every lens it could not settle and why.
**Entry point:** a result file `{ lenses: [{ lens, reviewers }], reviewers: [{ lens, side, text, failed }] }` (bare, or under a top-level `result` key) and a pipeline run directory.
**Success state:** `decisions.md`'s `## /review` holds the same pair lines `categorise-reproduction --run` would have written for each settled lens, and every other lens is listed under `needsSession` with each reviewer's state and, for a usable reviewer, its findings file.

## Steps

### 1. Write the confirmed lines for the whole fan-out — the review session
- **URL:** `node review-coordination.js settle-lens-replies "{result.json}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only confirmed`
- **Action:** run the call once. It parses each reply (a findings table or `No findings.`, then a trailing `STATUS:` line), gives each reviewer exactly one state (`failed`, `not-done`, `unparseable`, `status-missing`, `status-misplaced`, `ok`), pairs every lens whose two reviewers are both usable, appends their `reproduced` lines, and prints one JSON line `{settled, needsSession, violations, overflow, skipped}`.
- **Should feel:** one step where there used to be a path call, two writes and a pairing call per lens.
- **Should understand:**
  - A reviewer whose text is null, blank, or flagged `failed` is never read as an empty table: its lens goes to `needsSession`, never to `settled` with `confirmed: []`.
  - A reply with a table but no trailing status line may have been cut off, so `status-missing` is not usable; `status-misplaced` is usable and listed under `violations`.
  - A row the parser drops (no location, an off-scale severity, a control character in the path) is counted under `skipped`, never silently lost.
- **Red flags:**
  - Exit 2 for anything a reply says — reply text is untrusted content and never makes the call refuse; exit 2 is only for a malformed result file, flag set, lens name or `--ctx-id`.
  - A settled lens whose lines differ from what `categorise-reproduction --run` writes for the same two findings arrays.

### 2. Write the unconfirmed lines after the absence check — the review session
- **URL:** the same call with `--only unconfirmed`, plus `--hold "{hold.json}"` (a JSON array of `{ lens, ...finding }`, each matching exactly one unconfirmed finding of a settled lens)
- **Action:** run the absence-claim check and, at `medium`, the corroboration pass first, then make the call. Held findings get no line; the rest get `not reproduced` or share-a-location lines.
- **Should feel:** the same as the per-pair second call, for every lens at once.
- **Should understand:** the verb does not de-duplicate across calls — call it once per `--only` value; a repeated call writes the lines again and rewrites each findings file with the same content.
- **Red flags:** a hold entry naming an unsettled lens, or matching zero or several findings, is accepted (it must exit 2 and write nothing).

### 3. Finish the lenses it could not settle — the review session
- **URL:** each `needsSession` entry's `findingsPath` (`review-{ctx-id}-lens-{LENS}-agent{A|B}.json` in the session temp directory)
- **Action:** for a `single-reviewer` lens or a `reviewer-unusable` lens, continue with the existing per-pair steps from the written findings file; for a `not-done` reviewer, act on the stated reason in its returned `text`.
- **Should feel:** a short, named remainder — never a guess about which lenses still need work.
- **Should understand:** `findingsPath: null` means that file could not be written (one stderr line names it); the call still logged every settled lens and exited 0.
- **Red flags:** a lens from the roster that appears in neither `settled` nor `needsSession`.

## Origin
- Created during the build of #5598, which added `plugin/bin/lib/lens-reply.js` (the reply parser), moved the status-line patterns into `plugin/bin/lib/status-line.js`, and added `review-coordination.js settle-lens-replies`. No skill prose calls the verb until #5599 wires the workflow review path; the Task-dispatch path keeps its per-pair steps.
- Related journeys: `log-reproduction-lines-through-the-pairing-command-5595.md` (the per-pair command and line composer this verb loops around).
