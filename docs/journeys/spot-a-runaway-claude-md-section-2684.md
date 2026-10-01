---
files:
  - plugin/skills/harness-health/judge-procedure.md
  - plugin/skills/_shared/harness-health-analysis.md
  - plugin/skills/init/claude-md-template.md
---

# Spot a Runaway CLAUDE.md Section

**Persona:** A maintainer whose CLAUDE.md has stayed under its line budget while one section, often a commands block or a pipeline description, has quietly grown until it is most of the file.
**Goal:** Learn that one section dominates the always-loaded file before it becomes the 86,630-character section an audit finds later, and get a pointer to where that content belongs.
**Entry point:** `/claude-tweaks:harness-health`, run by hand or by a scheduled Routine, with CLAUDE.md as the audited target.
**Success state:** Either no finding (every section is at most 40% of the file's lines and bytes), or one medium-confidence `template-conformance` finding naming the section and both shares.

## Steps

### 1. The audit reaches check 4
- **URL:** N/A (slash command)
- **Action:** The judge runs check 4's line budget as before, then splits CLAUDE.md at its `##` headings (ignoring headings inside code fences) and computes each section's share of lines and bytes with check 4's snippet in `_shared/harness-health-analysis.md` — the procedure the default `--budget 1` run reads directly, and the one `/claude-tweaks:wrap-up`'s CLAUDE.md & rules row also applies. Under `--budget > 1`, each dispatched agent gets the same snippet inlined from `judge-procedure.md`, that procedure's verbatim distillation.
- **Should feel:** Routine. This runs in the same pass as the line-budget check, with no extra flag.
- **Should understand:** Bytes count as well as lines, because a section written as a few very long lines can hold most of the file while its line share looks small.
- **Red flags:** A file under 50 lines is flagged, or a heading inside a fenced example splits a section.

### 2. Read the finding
- **URL:** N/A
- **Action:** A section over 40% on either measure produces a `template-conformance` finding at `medium` confidence, naming the section and both shares.
- **Should feel:** Like a colleague's review note, not a failed gate.
- **Should understand:** A large section can be legitimate. The usual fix is to move the detail into a skill or a linked doc, and to write each remaining rule so it names the failure it prevents, per `init`'s CLAUDE.md template.
- **Red flags:** The finding is reported as a hard failure, or the line budget (default 150) has changed.

## Origin
- Created during build of #2684 (runaway-section signal plus the specific-past-failure authoring principle), 2026-09-30
