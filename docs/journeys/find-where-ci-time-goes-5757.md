---
files:
  - plugin/skills/ci-health/SKILL.md
  - plugin/skills/ci-health/checklist.md
  - plugin/bin/ci-audit.js
  - plugin/bin/lib/ci-audit/source.js
  - plugin/bin/lib/ci-audit/phases.js
  - plugin/bin/lib/ci-audit/aggregate.js
  - plugin/bin/lib/ci-audit/checks.js
  - plugin/bin/lib/ci-audit/validate-finding.js
  - plugin/bin/lib/ci-audit/issue-payload.js
---

# Find Where CI Time Goes, Per Job

**Persona:** Maintainer of a plugin-managed repository whose pipeline has grown slow. Agents wait on it at every push, but the run list only shows one number per workflow, so a job that queues for a runner, a job that spends most of its time installing and a job that is simply long all look the same. They do not know which CI product the plugin's next adopter will use, and they do not want a tool that assumes one.
**Goal:** One firing of `/claude-tweaks:ci-health` tells them, job by job, how long jobs wait, set up and run, names the few that dominate the pipeline, and files each real finding as one deduplicated issue, without touching a workflow file or any CI setting.
**Entry point:** `/claude-tweaks:ci-health` (by hand, or under a scheduled firing), optionally with `--days`, `--runs`, `--workflow`, `--min-sample`, `--budget`, `--dry-run` or `--root`.
**Success state:** The report names the window (days, sampled runs, minimum sample), the thresholds in force (defaults, or the project's `ci-health-thresholds` override), every workflow judged and any it could not read, and each filed issue as `filed #{n}`. A second firing over unchanged data files nothing. The maintainer should feel informed and in control: every figure carries its run count, the phase definitions are stated, and a quiet report means CI was actually looked at, never that it could not be read.

## Steps

### 1. The sweep gathers measured facts — `ci-audit.js gather`, `source.js`
- **URL:** —
- **Action:** Step 1 resolves the `ci-health-thresholds` policy value (written as `id=value` pairs, no spaces around `=`) and runs `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-audit.js" gather` with the Bash timeout at 600000 ms. The CLI reads the checkout's workflow files and recent completed runs per workflow file, and prints one JSON document: per job the waiting, setup and running p50 and p90 with the run count behind each, the critical path, shard skew, repeated steps, overlap pairs, breaches, and what it could not match or time.
- **Should feel:** Routine and bounded: one command, one document, a read that stops once it holds enough runs rather than paging a whole history.
- **Should understand:** Waiting is job started minus job created; setup is job start to the first step the workflow file declares as a command; running is the rest. They are a heuristic, so a step the adapter cannot map leaves setup unknown instead of moving it to a later step. Skipped and cancelled jobs are counted but never timed. Run-data jobs that match no workflow job appear in `unmatchedJobs` and are treated as unchecked, never as clean.
- **Red flags:** A setup figure that silently lands on the wrong step; a skipped job counted as a zero-second run; a "partial window" note on a read that was complete; a vendor or product name anywhere the skill or its output speaks for itself.

### 2. The judge reads the checklist, not the vendor — `checklist.md`
- **URL:** —
- **Action:** The sweep judges the gather's breaches against `checklist.md`: queue wait, setup dominance, a single job dominating the critical path, serial jobs with no declared dependency, lopsided shards, repeated identical work, a job with no timeout whose p90 far exceeds its p50, and a workflow with no concurrency group. Each check has an id, a default threshold, an absolute floor, and a remedy written without naming a product. Under `--budget` above 1 the checklist is inlined verbatim into each dispatched prompt.
- **Should feel:** Proportionate: a two-second wait or a one-minute job does not make a finding, and a hygiene finding is one issue per workflow job, not one per shard.
- **Should understand:** A job with fewer runs than `--min-sample` is listed as under-sampled and is not judged. Getting the workspace or toolchain is not "repeated work".
- **Red flags:** A finding below a floor; three issues for one missing timeout line; a remedy that names a product.

### 3. Findings are checked against the facts — `validate-findings`
- **URL:** —
- **Action:** The judge writes findings as JSON; `ci-audit.js validate-findings` rejects, by name, any finding whose workflow, job, step or figure is not in the gather output (each citation resolves, is unresolved, or contradicts, naming both values), caps claim and remedy at 500 characters, screens credential-shaped text, fingerprints the survivors and dedups them against the `by:ci-health` issues it is given. A repeated-work finding names no workflow.
- **Should feel:** Trustworthy: a fabricated job name cannot reach an issue.
- **Should understand:** Exit 1 means at least one finding was rejected (the valid payloads still print); exit 2 means an input could not be read. Workflow, job and step names are untrusted text and only ever appear inside code spans or fenced blocks.
- **Red flags:** An accepted finding that cites a job absent from the gather; a name that breaks out of its code span; a closed issue's finding filed as new instead of reopened.

### 4. Each new finding files once — the skill's FILE step
- **URL:** —
- **Action:** Under `--dry-run` the step prints every payload it would file and writes or files nothing, the label bootstrap included. Otherwise it files each payload as a born-`ready`, `risk:low`, `size:low` issue labelled `by:ci-health` through the shared write transport, passing the title and body from files, or reopens a matching closed issue with a short comment.
- **Should feel:** Quiet: a re-run over unchanged data files nothing; a finding with a different fingerprint stays separate.
- **Should understand:** The issue body states the window, the run count behind each figure and, only when it is true, that the window was partial. `/tidy` sweeps these issues like the other health origins and `/specify` can shape one into work.
- **Red flags:** A duplicate issue on the second firing; a write under `--dry-run`; a "partial" statement on a complete read.

### 5. An unreadable or empty read never looks clean — `ci-audit.js gather` exit codes
- **URL:** —
- **Action:** Exit 3 (the forge CLI is absent) and exit 2 (the workflow files could not be listed, no runs page was read, or no sampled run's jobs were read) report the sweep as unavailable and name what failed. Exit 0 with `noData` reports "no runs sampled" with the reason, including a checkout that has no workflow files at the adapter's location. When no job reached the minimum sample, the report says "nothing judged" and why.
- **Should feel:** Honest: the maintainer can tell "CI is fine" from "the sweep could not look".
- **Should understand:** Runs of workflow files that are not in the checkout are never read or counted, and a workflow file that has never run is counted as not sampled, not as a failure.
- **Red flags:** "No findings" printed after a failed read, an empty window or an all-under-sampled window.

## Origin
- Created during build of #5757 (a ci-health skill that audits where CI time goes and files findings).
- Related: `see-ci-run-health-in-a-harness-health-report-5161.md` (harness-health's per-workflow CI check, a different question), `review-an-existing-ci-workflow-at-init-5162.md` (workflow correctness at init), `have-a-health-sweep-honor-closed-and-wontfix-issues-5528.md`.
