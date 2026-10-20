---
files:
  - plugin/bin/lib/code-health/candidates-dead-code.js
  - plugin/bin/lib/code-health/focus-generators.js
  - plugin/bin/lib/code-health/source-scan.js
  - plugin/skills/code-health/SKILL.md
  - plugin/skills/code-health/focus-mode.md
---

# Code-Health Focus Sweep

**Persona:** Developer maintaining the claude-tweaks plugin who wants a dedicated pass over dead code across the whole repository, not whatever directory the generalist sweep's rotation cursor happens to land on today.
**Goal:** Run a `focus=dead-code` code-health sweep and get genuine dead-code findings filed as deduplicated GitHub issues.
**Entry point:** Typing `/claude-tweaks:code-health focus=dead-code` in a session, or a scheduled Routine firing with the same argument — `/claude-tweaks:routine fleet on` provisions four focus-scoped routines (dead-code, test-hygiene, abstraction-police, experiment-cleanup) exactly this way (`plugin/skills/routine/fleet.md`'s composition table).
**Success state:** Either the sweep reports "no candidates this firing" honestly (with scanned/skipped counts, so a silent skip is distinguishable from a genuinely clean repo), or genuine dead-code findings reach the judge and get filed.

## Steps

### 1. Kick off the sweep — CLI invocation
- **URL:** N/A (slash command)
- **Action:** Developer types `/claude-tweaks:code-health focus=dead-code`.
- **Should feel:** Deliberate — this is a different mode from the everyday generalist sweep, and the argument makes that explicit rather than implicit.
- **Should understand:** `focus=dead-code` swaps only the *scoping* strategy (candidate-driven instead of `next-slice` directory rotation) — everything downstream (criterion, judge, verify gate, dedup, filing) is unchanged. SKILL.md's Step 1 hands off to `plugin/skills/code-health/focus-mode.md` for the full focus-mode procedure.
- **Red flags:** An unrecognized `focus=` value should fail loud, naming the known values — never silently fall back to the generalist sweep.

### 2. Candidate generation runs
- **URL:** N/A
- **Action:** The skill resolves the generator from `focus-generators.js`'s shared registry (where `candidatesDeadCode` registers itself under `dead-code`) and runs it deterministically against the whole repo (`git ls-files`-based, gitignore-respecting) — no LLM involved yet. **Check:** look for the `scannedFiles: N` / `skippedFiles: M` line in the terminal output before the next step starts.
- **Should feel:** Fast and mechanical — this step is plain code, not judgment.
- **Should understand:** The generator is conservative by design: it prefers missing a dead export/orphan file over flagging a live one as dead. That means real dead code can be missed, but a live file should never be wrongly reported.
- **Red flags:** Zero candidates should read as a clean no-op, never an error — but only when the `scannedFiles`/`skippedFiles` line shows non-zero counts. A `scannedFiles: 0` result signals something is broken (non-git root, `git` unavailable), not a clean repo.

### 3. Open-issues context is gathered before judging
- **URL:** N/A
- **Action:** SKILL.md's Step 2 (GATHER OPEN ISSUES) runs unchanged, populating the dedup context every other code-health mode already relies on. **Check:** re-run the sweep a second time on an unchanged repo — a genuine finding from the first run should not be refiled as a second GitHub issue.
- **Should feel:** Invisible — this step exists purely so step 5 doesn't refile the same issue on every run.
- **Should understand:** Nothing to do here; this is infrastructure, not a decision point.
- **Red flags:** If this step were silently skipped (as it originally was in this feature's first cut), the same finding would get refiled as a new GitHub issue on every firing — especially damaging for a scheduled Routine, whose local dedup cache resets every container.

### 4. Candidates are read and judged
- **URL:** N/A
- **Action:** Up to the read budget (60 KB by default), candidate files are read in full and handed to the LLM judge against the existing `dead-code` criterion — the same judge every other code-health mode uses. **Check:** compare the candidate count from step 2 against the read-budget line in the output — if candidates exceed the budget, the report should say so explicitly rather than silently going quiet about the rest.
- **Should feel:** Trustworthy — a candidate the judge rejects should file nothing.
- **Should understand:** On a repo with many candidates, the budget is very likely to be exhausted well before every candidate is read — candidates sort alphabetically by file, so which ones get read (and which get silently deferred) depends on where they sort, not on how likely they are to be genuinely dead.
- **Red flags:** On a large enough repo, genuine (non-noise) candidates can still exhaust the read budget before the judge reaches all of them — the deferred tail is alphabetical, not low-value. Test files matching this repo's own `*.test.js`/`*.spec.js` naming convention are excluded from orphan-file candidacy (they're loaded by `node --test`'s glob discovery, never `require`d/`import`ed by name — see `isGlobDiscoveredTestFile` in `source-scan.js`), which is what fixed the ~99%-test-file-noise problem originally observed here; a target repo using a different test-discovery convention could still see similar noise.

### 5. Findings are deduplicated and filed
- **URL:** N/A
- **Action:** Verify gate, staleness re-check, fingerprinting, dedup, and GitHub issue filing all run exactly as they do for the generalist sweep — untouched by this feature. **Check:** for a filed finding, look up the resulting GitHub issue and confirm its labels match the same `by:code-health` scoring-label convention any generalist-sweep finding gets.
- **Should feel:** Consistent — a finding from a focus sweep should look and behave identically to one from a generalist sweep once it reaches this point.
- **Should understand:** The same real-world finding can, in a minority of cases, fingerprint differently depending on which mode found it (a directory-shaped `areaId` mismatch for files inside a small recursive slice) — a known, low-severity residual, tracked as a follow-up.
- **Red flags:** A `wontfix`-suppressed finding from the generalist path resurfacing as a "new" issue when found via focus mode (or vice versa) would indicate the `areaId` residual above is worse than measured.

## Origin
- Created during build of #271 (code-health focus mode: candidate-driven scoping with a dead-code candidate generator)
- All 5 steps built in this session
- Related specs: #265 (parent — self-maintaining fleet design), #260 (routine preamble regeneration, referenced by the routine-template `focus` field)
- Updated during build of #3478: the shared discovery helpers (`isGlobDiscoveredTestFile`, `listTrackedFiles`) moved to the leaf `source-scan.js`; no step's behavior changed
