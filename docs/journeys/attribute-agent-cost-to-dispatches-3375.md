---
files:
  - plugin/bin/lib/timing/transcript.js
  - plugin/bin/lib/timing/derive.js
  - plugin/bin/phase-timing.js
  - plugin/bin/lib/timing/run-timing.js
  - plugin/bin/lib/driver/lens-workers.js
  - plugin/bin/lib/timing/at-close.js
  - plugin/skills/wrap-up/summary-template.md
  - plugin/skills/flow/summary-template.md
  - plugin/skills/flow/multispec-summary.md
  - plugin/skills/_shared/timing-render.md
  - docs/reference/dispatch-cost-baseline.md
---

# Attribute a Run's Agent Cost to Individual Dispatches

**Persona:** the maintainer reading a `/flow` run's wrap-up summary (or its PR timing comment) who wants to know which subagent dispatches spent the run's agent time and tokens, on which model tier and in which role; and the maintainer of a later cost-shape record (#3377 plan review, #3381 whole-branch-review decision, per-task tiers, task merging) who must show a measured saving against a fixed baseline.
**Goal:** see the run's subagent cost broken down by tier and by role, with every dispatch the reader cannot account for named rather than silently zeroed, and compare it against `docs/reference/dispatch-cost-baseline.md` under the same comparability rule.
**Entry point:** the same Timing command the summary templates already run — `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript` — against a run whose session has a `{sessionId}/subagents/` directory beside its main transcript.
**Success state:** below the phase table and its footnote, a `Dispatches (run window; …):` line followed by a `| Tier | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |` table and, after one blank line, the same columns by `| Role |`. `timing.json` carries a `dispatches` key holding `items`, `byTier`, `byRole`, `scope` and `excludedOutsideWindow`, and every other key is unchanged.

## Steps

### 1. Render the Timing section as before
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript`
- **Action:** Paste the CLI's stdout into the summary verbatim, as the three Timing templates say.
- **Should feel:** The phase table is byte-for-byte what it was before. The Dispatches section is appended below it, never woven into it.
- **Should understand:** Without `--auto-transcript` or `--transcript`, nothing changes at all: no Dispatches section and no `dispatches` key. The section only appears when a transcript was requested, because it is read from the directory beside that transcript.
- **Red flags:** A phase-table number that moved after this change on a main-session-only run. The phase table must be byte-identical; only `/dispatch`'s subagent `--transcript` inputs legitimately changed, because their output tokens used to be undercounted.

### 2. Read cost by tier, then by role
- **URL:** the two tables under `Dispatches (…)`
- **Action:** Read the tier rows (`fast`, `standard`, `capable`, `frontier`, `unmapped`) to see where the expensive models went. Then read the role rows (`implementer`, `task review`, `re-review`, `whole-branch review`, `plan review`, `lens reviewer`, `unlabelled`) to see which kind of seat spent it.
- **Should feel:** A per-seat bill. For example, the whole-branch review is one capable row, while lens reviewers are many cheap rows.
- **Should understand:**
  - `Agent-seconds` sums every dispatch's span, with overlap kept: three parallel dispatches of one minute each read 180.
  - `Elapsed (min)` is the union of those spans in minutes, so the same three read 1.
  - Neither column is comparable to the phase table's minutes, and the Dispatches tokens are never added to the phase table's main-session `Tokens` column.
  - Tier comes from the meta file's model alias when it names one. Otherwise it comes from the transcript's own `claude-…` id. A model matching no family shows as `unmapped (raw: …)` with its name, never guessed.
  - Role comes from the dispatch description. `unlabelled` growing between runs is the drift signal that a dispatch site renamed its descriptions.
  - Agents a workflow script started (`{sessionId}/subagents/workflows/{runId}/`) count here like Task agents, with the label the script gave them as their description; in `timing.json` their items also carry `workflowRunId` and `workflowPhase`, which a Task agent's item omits (#5597).
- **Red flags:**
  - A large `unlabelled` row on a run you know ran per-task SDD reviews: a description shape the patterns do not recognize yet.
  - `Elapsed (min)` times 60 well above `Agent-seconds`: the union rounding regressed.

### 3. Read the lines that say what is missing
- **URL:** the lines after the tables
- **Action:** Check for:
  - `dispatches: subagent transcripts not found (…)` (no `subagents/` directory beside the transcript, one that cannot be listed — the error code is named — one with no `agent-*` files, or a symlinked one, which is never followed; with several transcripts, one line per directory that yielded nothing, below the tables);
  - `dispatch agent-{id}: transcript not found ({code})` (`symlink` when the file is a symlink, which is never followed);
  - `dispatch agent-{id}: transcript has no usage rows`;
  - `dispatch agent-{id}: meta not found (description null)`, or `meta not readable ({code|malformed|symlink}) (description null)` for a meta file that exists but cannot be used;
  - `dispatches: {n} outside the run window excluded`;
  - for a workflow run directory: `workflows/ directory …` or `workflow run directory is a symlink (not followed) at …` / `… not readable ({code}) at …`, `no agent-* transcripts in {run dir}`, and `workflow run {runId}: run file agentCount {n}, {m} agent(s) found in …` when the run's own agent count disagrees with the transcripts found (#5597).
- **Should feel:** Every dispatch is either counted or named, with nothing quietly dropped.
- **Should understand:**
  - The run window runs from the run's first to its last `events.jsonl` timestamp, not counting a `worktree-reaped` event (it fires hours after the session ends). Dispatches entirely outside it belong to other work in the same session and are excluded.
  - A run with no events reports the whole session and says `whole session — no run events`.
  - A not-found dispatch carries no numbers in any bucket. An orphan transcript (no meta) still counts, under `unlabelled`.
  - A dispatched run's `timing.json` written at close (#5647) also reads the `subagents/` directories of its dispatching and resuming sessions. The Task calls whose prompt names the run are left out of these tables, because their tokens are already in `totals.tokens`, so they are not missing dispatches. From a directory reached only through those calls, only the agents they started are kept, so another record's agents in the same session are not counted. The run's own-slug directory keeps the window rule above, minus those Task calls.
- **Red flags:** A dispatch that you know ran, appearing in neither a table nor a line.

### 4. Read headless lens workers beside the subagents
- **URL:** the same two tables, for a run whose run directory holds `worker-dispatches.jsonl` (written by `plugin/bin/review-lens-workers.js`, #6000)
- **Action:** read the `lens reviewer` role row as before; its count now includes the headless `claude -p` workers that ran lens sides, which have no `subagents/` transcript of their own. In `timing.json` their items carry `kind: 'worker'`.
- **Should feel:** a headless lens worker is billed like any other lens reviewer seat, with no separate section to add up.
- **Should understand:**
  - Items come from `worker-dispatches.jsonl` in the run directory, and only records with `launched: true` count; a side no worker started for (`excluded`, `platform`, a launch refusal) is never a dispatch.
  - A worker item's description is `lens {lens} {side}`, which the role patterns book under `lens reviewer`.
  - Its tokens are the worker envelope's usage; a timed-out worker has none, so its tokens come from its own transcript.
  - The same run window applies: a worker whose start is outside it is counted in `dispatches: {n} outside the run window excluded`.
  - A run with no `worker-dispatches.jsonl` renders exactly as before.
  - Items are sorted by start time only when worker items exist; without them the order is unchanged.
  - A run with only worker items still has a `Dispatches` section; the missing `subagents/` directory is named in the lines after the tables.
- **Red flags:** a launched lens worker missing from the `lens reviewer` row; an unlaunched side counted as a dispatch; item order changing on a run with no worker file.

### 5. Compare against the baseline
- **URL:** `docs/reference/dispatch-cost-baseline.md`
- **Action:** Before claiming a cost-shape record saved time or tokens, run the same command form on its run and compare tier and role rows against the baseline's tables.
- **Should feel:** One measured before and one measured after, not an estimate.
- **Should understand:** The comparison is valid only under the baseline's comparability rule:
  - the same model stance and tier policy;
  - a task count within ±50%;
  - SDD per-task dispatch, with the dispatched-to-plan task ratio within ±0.25.

  The baseline's tables are CLI output pasted verbatim. Its session is still live, so only the Dispatches block re-runs byte-identically; the phase table drifts.
- **Red flags:** A comparison made against a run that dispatched every task when the baseline dispatched half of them. The rule excludes it, and the saving it shows is an artifact.

## Origin

Built by #3375 (multi-spec run `2026-10-17T144508-spec-3375-3380`) — part of the "Build dispatch cost shape" decomposition from #3229. #3413 (run `2026-10-19T044738-record-3413`) moved the Dispatches render rules out of the three summary templates into `_shared/timing-render.md`, which all three now cite; the rendered output is unchanged. #5597 (run `2026-11-16T003729-record-5597`) added agents started by a workflow script and their run-directory lines.

#5647 (run `2026-11-21T181802-spec-5647`) scoped a dispatched run's at-close `dispatches` to the Task calls that ran it.

#6000 added Step 4: headless lens workers logged in `worker-dispatches.jsonl` appear as `kind: 'worker'` items under `lens reviewer`; the baseline comparison became Step 5. See `run-review-lenses-as-headless-workers-6000.md`.
