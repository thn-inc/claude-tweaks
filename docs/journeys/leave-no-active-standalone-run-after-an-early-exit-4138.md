---
files:
  - plugin/skills/_shared/run-dir-resolution.md
  - plugin/skills/sweep/SKILL.md
  - plugin/skills/specify/next-mode-closeout.md
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/tidy/SKILL.md
  - plugin/bin/lib/residue/probes/pipeline-runs.js
  - tests/standalone-run-dir-closeout-conformance.test.js
---

# Leave No Active Standalone Run After an Early Exit

**Persona:** A claude-tweaks maintainer who runs hands-off skills (a Routine-fired `/claude-tweaks:dispatch` or `/claude-tweaks:specify` drain, a `/claude-tweaks:sweep` before a dispatch session) and, the next morning, opens a fresh session expecting a clean slate — not a list of "status unknown" standalone runs from firings that found nothing to do.
**Goal:** Every standalone skill run that stopped — finished, found nothing eligible, or hit a firing-ending failure — leaves its own run directory closed, while anything it staged for approval is still approvable.
**Entry point:** Any standalone-minting skill invoked with no parent pipeline run dir: `/claude-tweaks:sweep`, a bare `/claude-tweaks:specify` drain, `/claude-tweaks:dispatch` (bare, `next`, or `#N`), `/claude-tweaks:backlog refine`, standalone-auto `/claude-tweaks:tidy`, `/claude-tweaks:init`, `/claude-tweaks:wrap-up`, `/claude-tweaks:release`, or harness-health's dream pass.
**Success state:** The next session's start shows no `active` `{ISO}-{skill}-standalone` directory left over from those runs; a closed tidy or sweep run that staged items is still the one `/claude-tweaks:tidy --approve` picks up; and a maintainer adding a new minter gets a red suite until that skill states its own close-out.

## Steps

### 1. A standalone firing stops early — terminal
- **URL:** e.g. a Routine firing `/claude-tweaks:dispatch --budget 1` with zero eligible groups, or a bare `/claude-tweaks:specify` drain that finds nothing eligible
- **Action:** Let the firing run to whatever exit it reaches — the nothing-to-do stop, a budget-exhausted close-out, or a firing-ending failure.
- **Should feel:** Quiet — a nothing-to-do firing still prints nothing beyond what it always printed; the close happens without a new line of output.
- **Should understand:** The skill closed the run directory it created (`hooks.js close-run --run …`) because a standalone directory records no owning session: session end never marks it `interrupted`, so left alone it would stay `active` for the next resolution to adopt. A directory the skill was handed by a parent (`$PIPELINE_RUN_DIR`, or a sweep firing) is never closed by the child — the parent owns that close.
- **Red flags:** A nothing-eligible dispatch or specify firing leaving `run-state.json` at `status: active`; a child step under `/claude-tweaks:sweep` closing sweep's shared directory mid-sweep.

### 2. Start the next session — terminal
- **URL:** a fresh Claude Code session at the project checkout
- **Action:** Read the SessionStart notice's run list (or `.claude-tweaks/pipelines/` directly).
- **Should feel:** Like a clean desk — only runs that genuinely still need someone appear.
- **Should understand:** A closed directory is terminal; `/claude-tweaks:tidy`'s residue sweep archives an ordinary closed standalone run on its next `--scope repo` pass.
- **Red flags:** Yesterday's `{ISO}-sweep-standalone` or `{ISO}-backlog-standalone` still listed with status unknown, the 2026-10-24 release session's observed shape.

### 3. Approve what a closed tidy or sweep run staged — terminal
- **URL:** `/claude-tweaks:tidy --approve`
- **Action:** Run it after a sweep or standalone tidy run that staged proposals and then closed its directory.
- **Should feel:** Unchanged from before — closing the run cost nothing; the staged batch is still the one waiting.
- **Should understand:** The residue probe (`bin/lib/residue/probes/pipeline-runs.js`) leaves a closed `*-tidy-standalone*` / `*-sweep-standalone*` directory whose `staged/` still holds items in place instead of auto-archiving it, so `--approve`'s `pipelines/` glob still finds it; `--approve` archives it, and tidy's 30-day Archival compaction is the backstop.
- **Red flags:** `--approve` reporting `no staged tidy proposals found` right after a sweep that staged items — the closed directory was swept into `archive/` by a tidy pass.

### 4. Add a new standalone minter — developer
- **URL:** `npm test` (or `node --test tests/standalone-run-dir-closeout-conformance.test.js`)
- **Action:** **Developer** adds a skill that mints a standalone run dir (a `resolve-run-dir --standalone {name} --create` line, or a new name on `_shared/run-dir-resolution.md` step 4's allowlist) and runs the suite.
- **Should feel:** Caught early and told exactly what is missing, not left to discover the leak in a later session.
- **Should understand:** The suite derives the minter set from the skill corpus, so an un-enumerated minter fails by name; once enumerated, its pin requires the skill to state `**Every exit runs the close-out.**` with a `close-run --run` instruction (and, where it applies, that an inherited directory is never closed).
- **Red flags:** A new mint line passing the suite without any close-out statement; an exempt skill (`/claude-tweaks:capture`) quietly starting to mint.

## Origin
- Created during build of #4138 (refs #3898, which fixed `/claude-tweaks:release` first)
- Steps 1-4 built in this session
- Related records: #3898, #3972, #4312
