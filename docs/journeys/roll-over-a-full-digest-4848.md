---
files:
  - plugin/bin/digest-rollover.js
  - plugin/bin/lib/health-core/materiality-digest.js
  - plugin/skills/tidy/digest-sweep.md
  - plugin/skills/tidy/step-1-records.md
  - plugin/skills/specify/next-mode.md
  - plugin/skills/_shared/materiality-floor.md
---

# Roll Over a Full Digest

**Persona:** A maintainer whose rolling `digest` issue has reached 100 comments, approving what `/claude-tweaks:tidy`'s digest sweep staged.
**Goal:** Move to a fresh container with no finding lost: every live entry keeps clustering and expiring, every promoted or expired finding stays suppressed, and a failure anywhere leaves something that can simply be re-run.
**Entry point:** `/claude-tweaks:tidy --scope=github`, which proposes the `Rollover digest container` action at 100 comments or for an unfinished rollover.
**Success state:** A replacement holds the `digest` label and the pin, its comments hold every trusted live entry with its original date and a marker-only tombstone for everything else, and the old issue is closed with a summary naming both carried counts.

## Steps

### 1. Approve the staged rollover — `/claude-tweaks:tidy`
- **URL:** the Stage row `Rollover digest container` in the tidy report
- **Action:** Approve it. The sweep re-lists for a replacement, creates one when no trusted match exists, and titles it `{old title} (continues #{old})` with `<!-- digest-rollover-of: {old} -->` as its body's first line.
- **Should feel:** Deliberate and low-stakes. Nothing has closed, and the old issue still holds the label and every entry.
- **Should understand:** The marker line from a trusted author is the replacement's identity. The title is for humans.
- **Red flags:** A second replacement on a retry. An issue merely titled like a replacement getting the label. The report staying silent when the running identity is untrusted.

### 2. Carry and verify — `digest-rollover.js carry`
- **URL:** `node plugin/bin/digest-rollover.js carry --old {old} --new {replacement}`
- **Action:** The sweep runs it, posts each printed body to the replacement, applies each printed edit, and runs it again until `verified` is `true`.
- **Should feel:** Mechanical. Two counts match or nothing moves on.
- **Should understand:** A live line moves whole and keeps its original date through a `materiality-first-seen` marker. A promoted or expired finding moves as markers only, so dedup still suppresses it and it never rejoins the active set. A short, paged or malformed read is a refusal, never an empty plan.
- **Red flags:** `live: 0` on an issue with live entries. A planted line carried. An expired entry's age restarting from the new comment. A finding that was suppressed before the rollover routing as new after it.

### 3. Move the label and close — digest-sweep.md steps 4 to 6
- **URL:** `plugin/skills/tidy/digest-sweep.md`'s Container rollover
- **Action:** The sweep clears any extra replacement while the label is still on, removes `digest` from the old issue, adds it to the replacement, pins it, catches late appends, posts the summary and closes the old issue. It then re-reads the count and carries anything posted after the last read.
- **Should feel:** Uneventful. Routing skills find one open `digest` issue throughout.
- **Should understand:** Two open `digest` issues never exist, so bootstrap-race repair has nothing to merge. The closed issue's history stays the archive.
- **Red flags:** Two open `digest` issues at any point. A close before `verified` is `true`. A summary comment posted twice on a re-run.

### 4. Recover an interrupted rollover — the next sweep
- **URL:** `node plugin/bin/digest-rollover.js verdict --old {old} --candidates {n},{n}`, run by the next `/claude-tweaks:tidy`
- **Action:** Read the verdict. `resume` proposes finishing, whatever the comment count. `stalled` names both issues and the one command to run after clearing any bootstrapped issue. `finished` re-checks the closed issue and proposes finishing only when something is missing.
- **Should feel:** Safe to walk away from. Re-approving posts only what is missing.
- **Should understand:** Between steps, both issues are exempt from `/specify`'s drain and from `/tidy`'s staleness shape, on the verdict rather than on the title or the bare marker line. A later generation's closed pair reads `none`.
- **Red flags:** A half-moved old issue shaped as a record or recommended for deletion. A false stalled report for an earlier generation. A marker from an untrusted author displacing the real replacement.
