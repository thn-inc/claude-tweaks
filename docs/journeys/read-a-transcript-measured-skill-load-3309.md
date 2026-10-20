---
files:
  - plugin/bin/skill-load-report.js
  - plugin/bin/lib/skill-audit/transcript-load.js
  - plugin/skills/harness-health/SKILL.md
---

# Read a Transcript-Measured Skill Load

**Persona:** A claude-tweaks plugin maintainer reading a `/claude-tweaks:harness-health` firing's SUMMARIZE report, or holding a `by:harness-health` record titled "Skill load exceeds its static closure: {skill}".
**Goal:** See how much skill prose real sessions on this machine actually load per invocation, and tell whether a skill reads more than its citations account for.
**Entry point:** The Skill-load lines in harness-health's Step 8 report, or a direct run of `node plugin/bin/skill-load-report.js --cwd "<repo dir>" --plugin-root plugin`.
**Success state:** The maintainer knows which transcript directory was read, which skills load the most (median and max bytes per invocation, against each one's static closure), and whether an open over-closure record should stay open. They also know a `no-data` result means nothing was measured, not that load was zero.

## Steps

### 1. Read the Skill-load lines in the report
- **URL:** harness-health's Step 8 SUMMARIZE output, or the CLI's one JSON line.
- **Action:** Read `transcriptDir`, then the top 10 `rows`: `skill`, `invocations`, `median`, `max`, `closure`.
- **Should feel:** Grounded. The report names the exact directory it read, and every number is bytes a real session paid for: the injected skill body plus every skill-file Read until the next invocation.
- **Should understand:**
  - Rows cover the 20 newest main transcripts for this directory (`--sessions <n>` changes it) plus each one's `subagents/*.jsonl`.
  - A worktree session's transcripts live under the worktree's own directory, so running from the main checkout does not count them.
  - `(main, unattributed)` and `(subagent, unattributed)` hold skill-file Reads with no invocation before them. Most subagent work lands there, because a dispatched agent rarely invokes a skill itself.
  - `closure: null` means the load model knows no such skill, for example another plugin's skill or a project-local skill when only `${CLAUDE_PLUGIN_ROOT}` was passed.
  - `unreadable` counts transcript files that could not be read.
- **Red flags:**
  - `status: "no-data"` read as "zero load". It means no transcript was found here, as in a cloud sandbox or a fresh clone.
  - Transcript text appearing anywhere in the report. Only skill names and byte counts belong there.
  - The same project-local skill split across two rows. A `.claude/worktrees/{x}:` prefix should be folded into the bare name.

### 2. Act on an over-closure record
- **URL:** the `by:harness-health` issue titled "Skill load exceeds its static closure: {skill}".
- **Action:** Re-run the CLI for the same directory and compare the skill's `max` against its `closure`. The CLI reports byte totals, not paths, so find the extra reads in a recent session where the skill ran: compare the skill files it Read against the ones its `SKILL.md` cites, directly or through files it cites (no CLI lists closure files today; a file-set report is a staged follow-up). Then add the missing citation or remove the stray read.
- **Should feel:** Like a lead, not a verdict. The record says this skill's real sessions read more skill prose than its static closure contains, which means #3307's citation grammar is missing a reference this skill makes.
- **Should understand:**
  - The closure is transitive and usually large (about 6 MB for this plugin's skills, since a bare-name citation that names exactly one file now resolves, #3634), so a record is rare. Each time one is filed, it points at a real blind spot.
  - The record carries the skill name, `max`, `median`, `closure`, `invocations` and `sessions`, never transcript excerpts.
  - A deliberately uncited read can be fine. The record exists so the gap is a decision, not an accident.
- **Red flags:**
  - A record titled with a worktree path instead of a skill name.
  - Two open records with the same title. The check dedups on the exact title.

### 3. Watch it close itself
- **URL:** the same issue, on a later harness-health firing.
- **Action:** Nothing. Once a firing with `status: "ok"` observes the skill again with `max ≤ closure`, harness-health comments and closes the record.
- **Should feel:** Self-maintaining. The comment reads `Back within its static closure: max {max} B ≤ closure {closure} B over {sessions} sessions`.
- **Should understand:**
  - A `no-data` firing, a firing where the skill was not invoked, or a skill whose closure is `null` never closes anything.
  - Under `--dry-run` nothing is filed or closed. The firing only prints what it would do.
- **Red flags:**
  - A record closed on a `no-data` firing.
  - A record closed while its skill does not appear in that firing's rows.

## Origin
- Created during build of #3309 (transcript-measured skill load, parent #3305's visibility mechanism for skill-size creep).
- Related:
  - `read-a-skill-load-delta-at-review-3307.md`: the static floor/closure model this measurement is compared against.
  - `act-on-a-red-read-limit-rail-3306.md`: the hard per-file limit.
  - `read-a-size-outlier-in-the-bloat-scan-3308.md`: the advisory corpus-relative size signal.
