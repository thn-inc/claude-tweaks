---
files:
  - plugin/bin/lib/calibration/aggregate.js
  - plugin/bin/calibration-report.js
  - plugin/skills/tidy/scan-procedures.md
---

# Read the Calibration Read-out Over Your Most Recent Runs

**Persona:** a claude-tweaks maintainer running `/claude-tweaks:tidy` on a repo whose `.claude-tweaks/pipelines/archive/` has collected months of runs under several id shapes. It holds hyphenated `2026-10-…` ids, compact `20260911T…` ids, legacy `spec-N` telemetry ids that exist only in `wrap-up-outcomes.tsv`, and a non-run `unresolved-provenance` dir. The maintainer is deciding whether a gate is still earning its keep.
**Goal:** the calibration read-out's "last N runs" figures describe the N most recent runs. They should not describe whichever ids happen to sort last as text.
**Entry point:** `/claude-tweaks:tidy`'s calibration read-out row (`plugin/skills/tidy/scan-procedures.md`), which runs `node plugin/bin/calibration-report.js` and renders its output verbatim. The maintainer can also run the CLI directly with `--runs N` or `--json`.
**Success state:** the header reads `Window: last 20 archived run(s); 34 run ids without a timestamp excluded.` The window is the 20 newest timestamped runs. Finished runs that are not yet archived contribute their real `decisions.md`/`events.jsonl`. The console, reversibility and friction figures come from current runs, not August-era leftovers.

## Steps

### 1. Open the read-out: tidy's calibration row
- **URL:** `/claude-tweaks:tidy` → calibration read-out row, or `node plugin/bin/calibration-report.js [--runs N] [--json]` from the main checkout
- **Action:** `calibration-report.js` loads every archive dir, adds a stub for each `wrap-up-outcomes.tsv` run id that has no archive dir (#917), and calls `aggregate()`.
- **Should feel:** like reading this week's numbers. Nothing in the report should need a mental "ignore the old stuff" correction.
- **Should understand:** an archive entry and a TSV-only id both count as candidate runs, but only ones whose id starts with a timestamp can be placed in time.
- **Red flags:** the window list (`--json`'s `window.runIds`) holds `spec-…` or `unresolved-provenance` entries.

### 2. Read the window header: which runs, and what was left out
- **URL:** the `Window:` line at the top of the text report, or `--json`'s `window.runIds` / `window.excluded`
- **Action:** `aggregate()` parses each run id's leading timestamp with `runIdTimestamp`. It accepts the hyphenated `YYYY-MM-DDTHHMMSS-`, the minute-precision `YYYY-MM-DDTHHMM-` and the compact `YYYYMMDDTHHMMSS-` shapes. It orders the dated runs by that time (ties broken by run id), drops ids with no timestamp, and keeps the last N. The header names the dropped count: `…; {x} run id(s) without a timestamp excluded.`
- **Should feel:** transparent. The maintainer can see how much history the window ignored without opening the archive.
- **Should understand:** an undated id is never placed in the window, even when fewer than N dated runs exist. The excluded count covers TSV-only telemetry ids as well as non-run archive dirs, so it is a count of run ids, not of archive directories.
- **Red flags:**
  - the header says "last 20" while the window holds a September run and newer October runs exist;
  - the excluded count is nonzero but the line is missing;
  - the excluded count is described as archive entries.

### 3. Read the distributions: console, reversibility, friction
- **URL:** the `### Console terminal-decision distribution`, `### Reversibility distribution` and `### Friction events` sections
- **Action:** each window run contributes its `decisions.md` lines and `events.jsonl` kinds. For a TSV-only run whose id is a single path segment, the stub reads its live dir `.claude-tweaks/pipelines/{runId}/` (a finished run awaiting archival). A stub with no live dir, or whose id has a path separator, stays empty.
- **Should feel:** proportionate. Reversibility counts reflect the dozens of `Reversibility:` lines current runs carry, not an all-zero distribution.
- **Should understand:** an `unlogged` console bucket still means the run's `decisions.md` carries no `Review Console: terminal decision` line. That is a logging gap, separate from window selection.
- **Red flags:**
  - the newest window runs show zero reversibility lines although their live `decisions.md` has many;
  - a TSV id such as `2026-…/../x` causes a file outside `.claude-tweaks/pipelines/` to be read.

## Origin
- Created during build of #4464
- Steps 2-3 are the change. Step 1 is the existing load path (#917's TSV stub synthesis) that the change builds on.
- Related specs: #901 (calibration read-out), #917 (stubs for TSV-only run ids), #4186 (friction-count test-denial filter, `keep-test-suite-denials-out-of-the-friction-counts-4186.md`)
