---
files:
  - plugin/bin/lib/timing/transcript.js
  - plugin/bin/lib/timing/derive.js
  - plugin/bin/phase-timing.js
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
  - `dispatches: {n} outside the run window excluded`.
- **Should feel:** Every dispatch is either counted or named, with nothing quietly dropped.
- **Should understand:**
  - The run window runs from the run's first to its last `events.jsonl` timestamp, not counting a `worktree-reaped` event (it fires hours after the session ends). Dispatches entirely outside it belong to other work in the same session and are excluded.
  - A run with no events reports the whole session and says `whole session — no run events`.
  - A not-found dispatch carries no numbers in any bucket. An orphan transcript (no meta) still counts, under `unlabelled`.
- **Red flags:** A dispatch that you know ran, appearing in neither a table nor a line.

### 4. Compare against the baseline
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

Built by #3375 (multi-spec run `2026-10-17T144508-spec-3375-3380`) — part of the "Build dispatch cost shape" decomposition from #3229. #3413 (run `2026-10-19T044738-record-3413`) moved the Dispatches render rules out of the three summary templates into `_shared/timing-render.md`, which all three now cite; the rendered output is unchanged.
