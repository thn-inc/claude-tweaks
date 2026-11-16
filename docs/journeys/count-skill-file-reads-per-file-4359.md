---
files:
  - plugin/bin/lib/timing/turn-class.js
  - plugin/bin/lib/timing/transcript.js
  - plugin/bin/lib/timing/derive.js
  - plugin/bin/phase-timing.js
  - tools/efficiency-report.js
  - plugin/skills/review/SKILL.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/step3-lens-dispatch.md
---

# Count Skill-File Reads per File, and Compare Runs Before and After a Procedure Change

**Persona:** the maintainer who has just replaced piecewise reads of a large skill file with a composed bundle, and who wants to check that the reads actually fell. A "the bundle exists" answer is not enough.
**Goal:** see how many times each skill file was read, per phase, for one run. Recount older archived runs the same way, so a pre-change baseline and a post-change measurement use one counter.
**Entry point:** `node tools/efficiency-report.js --recount --json` (maintainer-side), plus the per-run `{run-dir}/timing.json` that `phase-timing.js` writes.
**Success state:**
- Every `timing.json` phase, `unattributed` and `totals` carries `procedureFiles: { "skills/…/x.md": n, "context/…md": n }`.
- `efficiency-report.js` prints a `## Review-phase skill-file reads` table.
- `--recount` prints `runs recounted: N (skipped: M, no review: K[, failed: F])` and a per-file median, mean and total table.

## Steps

### 1. Read one run's per-file counts
- **URL:** `{run-dir}/timing.json`, each `phases[i].procedureFiles`
- **Action:** Find the review phase and read how often `skills/review/code-mode-steps.md` and `skills/review/step3-lens-dispatch.md` were read.
- **Should feel:** The count names the file and the phase. You don't need a transcript script to get it.
- **Should understand:**
  - A Read-tool call counts 1 for its file.
  - A Bash `cat`/`sed`/`grep`/`head`/`tail`/`awk`/`rg`/`wc` counts 1 per skill path it names. Output-redirect targets, globs, grep patterns and heredoc bodies are not reads. `timeout` and `xargs` wrappers are seen through.
  - The repo path, the worktree path and the installed plugin-cache path all fold to the same `skills/…` key.
  - A composed bundle read (`{run}/context/review-code-mode.md`) counts under its own `context/…` key, never as a skill-file read.
  - Subagent reads book to the phase where each read happened.
- **Red flags:**
  - A `context/…` key read many times per run: the bundle is being read piecewise, which defeats it.
  - A skill path counted twice for one Read call.

### 2. See the review phase across runs
- **URL:** `node tools/efficiency-report.js` (`--json` optional)
- **Action:** Read the `## Review-phase skill-file reads` section.
- **Should feel:** One table that says whether review's procedure reads are falling.
- **Should understand:**
  - Only runs whose review phase actually ran (a span, not an unattributed placeholder) and whose `timing.json` carries `procedureFiles` are counted.
  - When no run qualifies, the report prints `no run carries per-file read data`.
- **Red flags:** `runs with per-file data: 0` on an archive of post-change runs means the producer is not writing `procedureFiles`.

### 3. Recount the archive for a baseline
- **URL:** `node tools/efficiency-report.js --recount [--since YYYY-MM-DD] [--json]`
- **Action:** Read the counts line and the per-file table. Use `--since {release date}` for the post-change runs.
- **Should feel:** Old runs measured with the new counter, and the archive left untouched.
- **Should understand:**
  - A run is recounted from its own listed transcripts, using the run's phase windows. Reads count over all phases, with unattributed rows left out.
  - Nothing is written into the archive.
  - `skipped` means no listed transcript is left on disk.
  - `no review` means the run never reached review.
  - A run whose rebuild throws goes to `failed`, gets a stderr line, and makes the tool exit 1 unless every failure is an unreadable `events.jsonl`.
  - #4359's pre-ship baseline: 34 runs, with `code-mode-steps.md` at median 1.5 / mean 3.1 and `step3-lens-dispatch.md` at median 1 / mean 3.6. #5636 carries the post-ship check.
- **Red flags:** Exit 1 with `failed` rows. That is a code defect in the rebuild, not missing data, so don't re-run with the failing runs filtered out.

### 4. Read the procedure once, as a bundle
- **URL:** `/claude-tweaks:review` inside a `/flow` run
- **Action:** Watch the reviewer compose `--step review-code-mode` and `--step review-lens-procedure` and read each bundle whole.
- **Should feel:** One read per bundle, not a run of `sed -n` slices.
- **Should understand:**
  - Standalone `/review`, with no run dir, still reads the raw files.
  - A bundle is re-read whole only after a context compaction.
  - Step 6.7's body lives in `review/late-findings-routing.md`, read whole only when that step runs.
- **Red flags:** `context/review-code-mode.md` read more than about twice per run.

## Origin

Built by #4359 (run `2026-11-16T000452-record-4359`). It extends the turn-class and procedure-byte axes from `see-where-a-runs-turns-went-and-catch-budget-regressions-4029.md`.
