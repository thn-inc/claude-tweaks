---
files:
  - plugin/bin/ci-health.js
  - plugin/bin/lib/ci-health/constants.js
  - plugin/bin/lib/ci-health/fetch.js
  - plugin/bin/lib/ci-health/stats.js
  - plugin/bin/lib/ci-health/billing.js
  - plugin/bin/lib/ci-health/thresholds.js
  - plugin/bin/lib/ci-health/render.js
  - plugin/skills/harness-health/ci-health-check.md
  - plugin/skills/harness-health/SKILL.md
---

# See CI Run Health in a Harness-Health Report

**Persona:** Maintainer of a plugin-managed repository whose CI suite has grown over months. A merge now sometimes parks because checks are still pending after the merge gate's 15-minute watch, and the Actions budget is closer to its hard stop than they realised. Nothing in their sweeps reads workflow-run history, so they only learn about it from a parked merge or a billing email.
**Goal:** Each harness-health firing tells them, in a few lines, which workflows are slow or getting slower, how many runs were wasted on superseded commits, which push workflows run on every push, and how much Actions budget is left — and files one issue when a threshold is crossed, without ever showing a spend amount.
**Entry point:** A `/claude-tweaks:harness-health` firing (scheduled or by hand), whose Step 1 reads `ci-health-check.md` and runs `bin/ci-health.js --file`.
**Success state:** Step 8's SUMMARIZE report carries `ci health:` lines: one per workflow with run count, p50 and p90, trend, superseded and cancelled counts, and a billing line with the headroom percentage against the floor. A workflow whose p90 exceeds the watch shows a ` — over the 900s merge-gate watch` suffix. When a breach exists, one issue titled `CI health: workflow p90 duration or Actions budget headroom breaches a threshold` is open, and a later firing does not file a duplicate. The maintainer should feel informed, not alarmed: the numbers are evidence about the watch and the budget, never a verdict and never a bill.

## Steps

### 1. Harness-health runs the CI check — `harness-health/ci-health-check.md`
- **URL:** —
- **Action:** Step 1 reads the sub-file and runs `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-health.js" --file` (with `--root {dir}` when harness-health's `--root` names another checkout, so that checkout's origin and `work-types` are read). Under `--dry-run` it writes only `ci health: skipped (--dry-run never calls gh)`.
- **Should feel:** Routine: one more deterministic check beside the composed-bytes and cost-efficiency checks, with no question asked.
- **Should understand:** The check reports and files only. It never edits a workflow and never changes the merge gate's watch, whatever p90 it measures.
- **Red flags:** The check skipped on a nothing-due firing; a `--dry-run` firing that calls `gh`.

### 2. The report shows per-workflow run statistics — `ci-health.js`, `fetch.js`, `stats.js`, `render.js`
- **URL:** —
- **Action:** The CLI reads the last 30 days of workflow runs one 7-day range at a time (up to 10 pages per range, 50 pages in all) and prints one line per workflow, its name and path in code spans, for example ``` `ci.yml` (`.github/workflows/ci.yml`): 5 runs, p50 800s, p90 1300s — over the 900s merge-gate watch, trend rising 1.5, superseded 2 (0.5), cancelled 1 ```.
- **Should feel:** Readable at a glance: the slow workflow stands out, and the trend says whether it is getting worse.
- **Should understand:** p90 is run duration (`updated_at` minus `run_started_at`) and excludes queue wait, so it is advisory evidence for the watch. Skipped (`conclusion: skipped`) runs count in `runs` but not in the percentiles. A trend with too few runs reads `insufficient`. A busy repository past 1,000 runs in the window is still read whole; only a week that itself hits the 1,000-run cap, or that the 50-page read budget leaves unread, is named, on one line such as `window truncated: 1 of 5 weeks hit the 1000-run cap or the read budget (2026-11-03..2026-11-10 cap); figures for those weeks are partial`.
- **Red flags:** A negative or zero-second duration in the figures; a push-only workflow carrying the watch suffix; a truncated window with no truncation line; a workflow name that renders as a link, a mention, or a line of its own.

### 3. The billing line shows headroom, never an amount — `billing.js`
- **URL:** —
- **Action:** For an organisation-owned repository the CLI reads the org's budgets and usage summary and prints `billing: Actions budget headroom {h}% (floor 10%)`. A user-owned repository, or no Actions budget, prints `billing: no Actions budget to compare`. An unreadable endpoint prints `billing unavailable ({status})`.
- **Should feel:** Safe to paste anywhere: a percentage and a floor, nothing that reveals what the organisation spends.
- **Should understand:** A token without `admin:org` gets a 404, which reads as unavailable, never as "no budget". The legacy billing endpoint is never called. Budgets are read one page only, so a `(first page of budgets only)` note means the headroom may be overstated.
- **Red flags:** A currency amount in any line; "no budget" printed for a 403/404/410.

### 4. A breach files one issue, once — `thresholds.js`
- **URL:** —
- **Action:** Under `--file`, a `pull_request` workflow with at least 5 completed runs whose p90 exceeds 900 s, or headroom below the floor, files one typed issue labelled `by:harness-health`, `risk:low`, `size:low`. The report prints `filed #{n}: {title}`.
- **Should feel:** Proportionate: one issue listing every current breach, not one per workflow or per firing.
- **Should understand:** Dedup is an exact title match against open issues only, so closing the issue lets a later firing file again while the breach remains. A truncated window or a failed runs read never files (`not filed: window truncated` / `not filed: runs read failed`); an open issue with the same title prints `not filed: open issue exists`.
- **Red flags:** A second open issue with the same title; an issue filed from a partially read window; an amount in the issue body.

### 5. A sandbox without `gh` reports unavailable, never clean — `ci-health-check.md`, `fetch.js`
- **URL:** —
- **Action:** In a `gh`-absent cloud sandbox the report reads `runs unavailable (gh absent)` and `billing unavailable (gh absent)`, or `ci health: failed (…)` when the origin is a proxy remote that cannot be resolved.
- **Should feel:** Honest: the maintainer can tell "nothing to report" from "could not look".
- **Should understand:** The MCP transport covers record CRUD, not workflow-run or billing reads, so there is no fallback read there.
- **Red flags:** A `no workflow runs` line or a headroom figure in a sandbox that has no `gh`.

## Origin
- Created during the build of #5161 (report CI run duration, superseded runs and Actions spend from harness-health), the second unit of the CI cost visibility design from #5154.
- Related: `stop-the-issue-tracking-workflow-billing-every-push-5152.md`, `read-where-a-pipeline-run-spent-its-minutes-1928.md` (CI wall time at the merge gate, #5160), `harness-health-premise-check.md`.
