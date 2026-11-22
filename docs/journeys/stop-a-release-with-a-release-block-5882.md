---
files:
  - plugin/bin/release-block.js
  - plugin/skills/_shared/release-block.md
  - plugin/skills/release/SKILL.md
  - plugin/skills/release/console.md
  - plugin/skills/release/disposition.md
---

# Stop a Release With a Release Block, Then Clear It

**Persona:** Maintainer of a GitHub-backed service who found a Critical regression after the last review and does not want any teammate, scheduled firing or their own muscle memory to ship over it; a second maintainer later owns clearing it.
**Goal:** Make "do not release" a durable fact on a record rather than a remembered conversation, see a release stop on it, and lift it with one plain act.
**Entry point:** A record carrying the `release-block` label (added by hand, or stamped by `/claude-tweaks:release` Step 8 on a critical/high finding it filed), then `/claude-tweaks:release`.
**Success state:** The blocked run printed `release: blocked — 1 open release-block record(s): #412 …` and moved nothing; after the record was closed or the label removed, the next `/claude-tweaks:release` reached the console and shipped.

## Steps

### 1. Block — label a record
- **URL:** the record on GitHub, or `node plugin/bin/release-block.js stamp --record 412 --finding "missing guard at src/pay.ts:40"`
- **Action:** The maintainer adds the `release-block` label, or stamps it. The stamp adds the label, then a comment starting `**Release block:**` that says to close the record or remove the label to clear it.
- **Should feel:** Like pinning a note to the release door: one label, no config to edit, visible to everyone who opens the record.
- **Should understand:** Only an open record blocks; the label on a closed record does nothing.
- **Red flags:** A stamp that leaves a comment but no label; a stamp attempted against a PR number or a local-files record number that appears to succeed.

### 2. Release stops at the gate
- **URL:** `/claude-tweaks:release` (also `--dry-run` and `--train`)
- **Action:** Step 1.5 runs `release-block.js check` before any review or suite work. Exit 1 prints the blocked line naming each open record, stages `release-held.md`, and ends `HELD`. No question is asked, and `--allow-blocking` does not lift it. Step 4 re-reads the label before anything merges, so a block added during the review also stops the run.
- **Should feel:** Immediate and unarguable — it stops in seconds, before a 15-minute suite run, and says exactly which records to deal with.
- **Should understand:** `HELD` means nothing moved, and every firing re-checks, so a train firing cannot ship past a block.
- **Red flags:** A review or whole-suite run started before the check; a `HELD` summary with no record list; an unreadable label list (failed call, a full 100-row list, gh absent) reported as "no block" instead of `failed` with `release-block state unreadable`.

### 3. Clear the block
- **URL:** the blocking record
- **Action:** A maintainer closes the record or removes the `release-block` label, optionally with a comment saying why. No reason is required.
- **Should feel:** Lightweight — the same act that resolves the underlying problem also lifts the gate.
- **Should understand:** There is no separate override; clearing is closing or unlabelling.
- **Red flags:** Needing a flag or policy edit to release after the record is closed.

### 4. Release again
- **URL:** `/claude-tweaks:release`
- **Action:** Step 1.5's check exits 0, logs `none open`, and the run continues to the review and console as in the standard release.
- **Should feel:** As if the block had never been there — no stale held state carried over.
- **Should understand:** The check reads live state each time, never yesterday's `release-held.md`.
- **Red flags:** A cleared block still holding the release; yesterday's held file read as today's verdict.

## Origin
- Created during build of #5882 (the `release-block` label, `bin/release-block.js`, and `/release` Steps 1.5, 4 and 8)
- Complements `release-a-version.md`, which carries the `HELD` gloss for this gate
