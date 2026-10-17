---
files:
  - plugin/bin/lib/skill-audit/bloat.js
  - plugin/skills/harness-health/judge-procedure.md
  - plugin/skills/_shared/harness-health-analysis.md
---

# Read a Size Outlier in the Bloat Scan

**Persona:** A maintainer of a project with its own skills, running `/claude-tweaks:harness-health` (or reading the dimension-9 evidence `/claude-tweaks:wrap-up` and `/claude-tweaks:init` produce through `_shared/harness-health-analysis.md`), who wants to know whether a skill file is doing too much.
**Goal:** See whether the target skill file is much larger than its siblings, measured against that project's own skill corpus rather than a fixed byte limit, and decide whether that size is real bloat.
**Entry point:** `/claude-tweaks:harness-health` on a skill target. Check 9 runs `bloatReport(target, corpus)` over the target's whole skill corpus.
**Success state:** The bloat evidence names the corpus baseline it measured against and, when the file is an outlier, gives its bytes against that threshold. The judge decides whether that is real bloat or a legitimately large entry point. Nothing is filed on size alone.

## Steps

### 1. Read the size baseline line
- **URL:** the check 9 bloat evidence, under `row baseline: …`.
- **Action:** Find the `size baseline:` line.
- **Should feel:** Grounded. The number comes from this project's own files, so the evidence fits the project.
- **Should understand:** There are three forms:
  - `size baseline: p95 39519 B over 441 files`: 20 or more files, nearest-rank 95th percentile.
  - `size baseline: 3× median {t} B over {n} files`: 5–19 files, three times the median.
  - `size baseline: NO BASELINE — {n} files is under the 5-file floor, so the size-outlier signal was not evaluated`.

  Duplicate corpus paths and globs that matched nothing are dropped before counting, so `{n}` is the real number of files.
- **Red flags:**
  - A file count that includes the target twice, or a literal glob path.
  - A `NO BASELINE` line on a corpus of 5 or more files.
  - A baseline line printed for a target the caller suppressed with `{ sizeOutlier: false }`. A suppressed signal prints no baseline line at all.

### 2. Read a size-outlier line
- **URL:** the target file's block in the same report, for example `plugin/skills/flow/SKILL.md`.
- **Action:** Look for `size-outlier: {bytes} B, above the corpus threshold of {threshold} B`.
- **Should feel:** Specific. One line gives the file's bytes and the threshold it crossed.
- **Should understand:** It fires only when the file's bytes are strictly above the threshold; a file exactly at the threshold is not an outlier. In a corpus of 20 or more files, the p95 tier flags roughly the largest 5% by design: on this repo's 441 skill files that is 22 files from 40 KB to 46 KB. This line is evidence the judge weighs, never a finding by itself. The ceiling signal is suppressed at every call site since #3310; #3311 removes it.
- **Red flags:**
  - A `size-outlier:` line under a `NO BASELINE` baseline.
  - An outlier line whose bytes are at or below the stated threshold.
  - A finding filed only because this line appeared.

### 3. Judge whether the size is real
- **URL:** check 9's dimension-9 guard in `harness-health/judge-procedure.md` (the same bullet as in `_shared/harness-health-analysis.md`).
- **Action:** Apply the **Size outliers** guard bullet to the flagged file.
- **Should feel:** Like a judgment call, not a rubber stamp. The guard spells out both the real case and the false one.
- **Should understand:** It is real when the file is far larger than its siblings because it holds several independent procedures. It is not real when an entry point is legitimately the largest because it carries a whole lifecycle from entry to close (`flow/SKILL.md` is a typical example). The fix is never a "read X now" split that moves bytes without cutting them: that lowers the file's size but not what an invocation loads.
- **Red flags:**
  - A proposed fix that only moves a section into a sibling the file then tells the reader to load.
  - A finding on an entry point with no named second procedure.
  - A finding that cites an impression instead of check 9's reported byte count.

## Origin
- Created during build of #3308 (corpus-relative size-outlier signal, the expand step of parent #3305's strangler-fig rollout).
- Related specs: #3310 (cuts every size consumer over to the rail), #3311 (removes `overCeiling`, `headroom`, and the `ceiling` option). Open question for #3310: the p95 tier also flags files in a corpus with no real outlier (ledger row 29).
