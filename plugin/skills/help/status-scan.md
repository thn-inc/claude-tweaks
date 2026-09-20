# Help — Pipeline Status Scan

Stage-by-stage scan procedure run by `/claude-tweaks:help` (default invocation, or `status` argument). Lazy-loaded from `SKILL.md` Section 2.

## Execution model

Stages split by cost. Stages 1, 4.5, 4.6, 4.7, and 4.8 each do real `gh` work over an independent data source and carry substantial inlined `_shared/` fragments, so each earns a Task agent — Stage 4.8 returns a bespoke data table rather than the shared Template A findings row (see its own section for why). Stages 0, 2, 5, 6, and 7 are a file read, a glob, or a grep apiece — dispatching those as agents would pay the full inherited `CLAUDE.md` cost to execute what amounts to a single `Read`/`Glob`, so they run directly in the main thread instead.

> **Parallel execution:** Dispatch Stages 1, 4.5, 4.6, 4.7, and 4.8 as parallel Task agents — each stage scans an independent data source and returns counts, flags, and recommendations. The orchestrator assembles the dashboard after all agents complete.
>
> **Contract:** Each agent follows `_shared/subagent-output-contract.md` — minimal input (scope + path + literal output template, no conversation), status line first (`DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`), then `_shared/subagent-dispatch-core.md`'s Template A for Stages 1/4.5/4.6/4.7; Stage 4.8 defines its own format (below) per the contract's "Not every consumer uses A/B/C" clause. Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies.
>
> **Model profile:** [Use: Fast] — each stage scan is a mechanical `gh`/facet-parse over a single data source (the open work-record queue, current PR via gh, the trust-table fetch). No synthesis at the per-stage level; the orchestrator assembles the dashboard. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" fast` (contract § Model Selection).
>
> **Output template (Stages 1, 4.5, 4.6, 4.7 must follow exactly):**
>
> ```markdown
> OUTPUT FORMAT (required):
> Return ONLY a markdown table, no preamble:
>
> | Severity | Path:Line | Finding | Evidence |
> |---|---|---|---|
> | medium | (work records) | Backlog: 14, 3 stale | 3 records' `updatedAt` are older than the `record-staleness-weeks` threshold |
>
> Severity scale: critical / high / medium / low / info
> If no findings: return literal text "No findings."
> Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
> Do not add narration, headers, or summaries before or after the table.
> ```
>
> Stage 4.8 is deliberately exempt from this template — a trust-table row carries no severity, and its row count is held down by `provenance.js`'s normalization rather than by the 15-row cap (the `side-effect:{source}` half of the provenance axis is free text, so the taxonomy has no formal ceiling; see `_shared/trust-table.md`'s Render section for what actually bounds it). Capping it would hide exactly the Undispositioned count this feature exists to surface. See Stage 4.8's own section for what it returns instead.

> **Parallel execution:** Use parallel tool calls aggressively — all `Read`/`Glob`/`Grep` operations in Stages 0, 2, 5, and 6 are independent and should run concurrently.

Issue those Stage 0/2/5/6 tool calls in the same message that dispatches the agent batch above — they depend on neither it nor each other, so the whole batch overlaps. Being in the main thread, they need no status line and no agent envelope; they contribute findings to the dashboard using the same column mapping as the agents.

**Stage 7 runs last, in the main thread**, only once the agent batch and the Stage 0/2/5/6 calls have all returned. Several of its signals are derived from their output (Stage 1's backlog count, Stage 2's unspecified-design-doc count, Stage 4.5's stale-PR count); the rest are cheap local checks of its own. It must never be made concurrent with its own inputs. Stage 4.8's trust table is never one of these derived signals — it is display-only and feeds no recommendation.

**Dispatcher column mapping (status-scan use):** Severity = recommendation urgency (`info` for nothing-to-do, `low` for routine, `medium` for needs-attention, `high` for blocking). Path:Line = the artifact (`#{n}` / the local record path under `work-backend: local-files`, `docs/journeys/checkout.md`, etc.). Finding = the count or flag (`14 items, 3 stale`). Evidence = the specific items or signals. Stage 4.8 does not use this mapping — see its own section. Stage 0 does not use this mapping either — it renders a single version line, not a finding row.

## Stage 0: Plugin Version

*(Main thread — a single file read, no `gh` call. Runs concurrently with the agent batch and Stages 2/5/6.)*

Read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`. Its `version` field is the sole source of truth for the installed claude-tweaks version — never hardcode it, and never infer it from install metadata (`claude plugin update` is version-string-only and doesn't reflect the running build). If the file is missing or unreadable, or `CLAUDE_PLUGIN_ROOT` is unset or points at a broken/partial install, do not guess or fall back to a hardcoded version — render the version line as `claude-tweaks — version unknown ({reason})` instead of a version number, naming the path attempted.

## Stage 1: Work Records (backlog / parked / ready / authorized / building / blocked)

Replaces the former INBOX scan, Deferred-Work scan, Specs-Ready-to-Build scan, and Specs-In-Progress scan — all four read `specs/backlog/*.md` frontmatter or the old spec index and `specs/*.md` files directly. The record store is the current landscape now; there is no separate index file or backlog directory to read (`_shared/work-record.md`). One list call + one facet parse computes every count below.

Resolve this stage's session-scoped temp paths once, per `_shared/session-tmp-root.md` (cited throughout this file rather than restated), via `eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_RECORDS=help-records.json HELP_RECORDS_FACETED=help-records-faceted.json)"` — a Task agent that cannot see `$CLAUDE_CODE_SESSION_ID` degrades to the unscoped path per that file's Degrade rule; nothing breaks either way. Fetch and facet-parse the queue per `_shared/record-queue-fetch.md` — the dispatcher inlines that file's `work-backend` resolution, both drivers' fetch commands (including the Session-scoped record snapshot section, so this fetch shares one `gh issue list --state all` pull per session with `/backlog`/`/capture`/`/specify`/`/tidy`/`/visualize` instead of paying for its own), and the Staleness clock and Threshold resolution sections into this agent's prompt (the same pattern already used for `_shared/github-pr-scan.md`), with `{tmp-records-file}` = `$HELP_RECORDS`, `{tmp-faceted-file}` = `$HELP_RECORDS_FACETED` — `body` rides along on the shared snapshot's union field set (no `{EXTRA_FIELDS}` to request anymore) because this same fetch also feeds Conflict detection below, instead of opening a second round-trip just for that.

**Fail-open behavior** (`work-backend: github-issues` only): if the `gh issue list` fetch fails — `gh` unavailable, unauthenticated, or the repo has no GitHub remote — Stage 1 fails open, the same posture as Stages 4.5/4.6/4.7 below: emit a single info row (`Work-record scan skipped — {reason}`) instead of BLOCKED. All six counts and the Conflict-detection sub-section are treated as unavailable for this run, and the dashboard's Work Records and Ready-to-Build sections are omitted (same omission convention already used for an empty pipeline) rather than rendering zeros. `work-backend: local-files` has no equivalent failure mode — its fetch reads the local record store directly, not `gh`.

Both drivers land in the same faceted-record shape (`{ ..., facets }`) at this stage's session-scoped `$HELP_RECORDS_FACETED` path. The six-bucket classification below is `/help`'s own consumer-specific logic, described once here and run identically against either driver's output. Re-resolve the path first (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the fetch fence's shell variable):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_RECORDS_FACETED=help-records-faceted.json)"
WEEKS="${RECORD_STALENESS_WEEKS:-4}"
export STALENESS_WEEKS="$WEEKS"
node -e "
  const { isBacklog, isParked, isBotBlocked, isBotInProgress, classifyStaleness } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-buckets.js');
  const records = require('$HELP_RECORDS_FACETED');
  const now = Date.now();
  const thresholdMs = Number(process.env.STALENESS_WEEKS) * 7 * 24 * 60 * 60 * 1000;
  const blocked = records.filter((r) => isBotBlocked(r));
  const building = records.filter((r) => !isBotBlocked(r) && isBotInProgress(r));
  const authorized = records.filter((r) => !isBotBlocked(r) && !isBotInProgress(r) && r.facets.stage === 'ready' && (r.facets.grants.build || r.facets.grants.merge));
  const ready = records.filter((r) => !isBotBlocked(r) && !isBotInProgress(r) && r.facets.stage === 'ready' && !r.facets.grants.build && !r.facets.grants.merge);
  const parked = records.filter((r) => !isBotBlocked(r) && !isBotInProgress(r) && isParked(r));
  const backlog = records.filter((r) => !isBotBlocked(r) && !isBotInProgress(r) && isBacklog(r));
  const stale = backlog.filter((r) => r.updatedAt && classifyStaleness(now - Date.parse(r.updatedAt), thresholdMs) === 'stale');
  const wakeReady = parked.filter((r) => r.milestone && r.milestone.dueOn && Date.parse(r.milestone.dueOn) < now);
  console.log(JSON.stringify({
    backlog: backlog.length, backlogStale: stale.length,
    parked: parked.length, parkedWakeReady: wakeReady.length,
    ready: ready.length, authorized: authorized.length,
    building: building.length, blocked: blocked.length,
  }));
"
```

`building` and `blocked` are always 0 under `local-files` — the local driver carries no bot state (`_shared/work-record.md`). `authorized` still counts: grants are recorded as frontmatter for isomorphism even though no headless consumer acts on them under this driver (`backlog/SKILL.md`'s Preflight). `local-files` records carry no `updatedAt`/`milestone` field, so this script's `backlogStale`/`parkedWakeReady` naturally come back 0 for that driver — see "Staleness clock" and "Wake-ready sub-count" below for what this driver reports instead.

**Staleness clock** (backlog sub-count): per `_shared/record-queue-fetch.md`'s Staleness clock and Threshold resolution sections — `github-issues` uses the query's own `updatedAt`, as computed above; `local-files` uses the record file's own last-commit date, applied per backlog record here.

**Wake-ready sub-count** (parked, milestone due in the past) is a cheap heuristic, not full trigger evaluation — a `local-files` parked record's trigger lives as body prose (`**Trigger:**`/`**Watched paths:**` lines), too expensive to read per-record on a dashboard pass. Omit the sub-count under this driver and report the bare `parked` count only. Full trigger evaluation (including watched-path `git log` checks on both drivers) stays `/claude-tweaks:tidy`'s job — this is a maintenance signal, not a substitute.

**Justification flag:** flag every `backlog`-bucket record carrying an unjustified-solution verdict — under `work-backend: github-issues` the `solution:unjustified` label (or its pre-rename spelling `framing:baked`), under `work-backend: local-files` `facets.solutionUnjustified === true` (already present on the fetched record above — no extra call either way) — the verdict `/claude-tweaks:specify` stamped via `/claude-tweaks:challenge`'s `framing-check` mode when it shaped the record. Flag matches in the Needs Attention table with a pointer to read the record's `## Gotchas`, where framing-check wrote the surfaced assumptions, and the live remedy: `/claude-tweaks:challenge #{n}` — the human-invoked evidence-or-accept-risk mode that supplies evidence or accepts the risk and clears the label in one step.

**Definition flag:** flag every `backlog`-bucket record carrying `needs:definition` — under `work-backend: github-issues` the label, under `work-backend: local-files` `facets.needsDefinition === true` (already present on the fetched record above — no extra call either way) — stamped by `/claude-tweaks:capture` or `/claude-tweaks:feedback` at filing time when the record names an open choice with no tradeoff made yet. Flag matches in the Needs Attention table with the concrete next step: `run /claude-tweaks:specify {ref} to route through brainstorming`.

**Sampling flag** (`work-backend: github-issues` only — no local-files equivalent exists, the same omission `_shared/trust-table.md` states for its own `demo:*` reads). `bin/lib/issues/trust.js`'s `MIN_VERDICTS` counts merged-and-unreverted outcomes toward promotion (#267), so a trust class can promote purely on operational survival signal without ever collecting a real `/demo` verdict. This flag is the sampling floor that keeps forcing some of that evidence in (#310): among every closed record still carrying `demo:pending` (the acceptance-labeling step applies it to every `auto:merge`'d record regardless of who granted it — `wrap-up/auto-merge-short-circuit.md`), flag the ones whose position in the full machine-granted-merge history — ordered by `closedAt`, machine-origin detected by `fleet-counters.js`'s `isMachineGrant` audit-comment marker, never the `auto:merge` label alone (a human can grant that label too) — lands on a `grant-sampling-every` boundary. Computed from the same session-scoped `$HELP_RECORDS_FACETED` snapshot Stage 1 already fetched (`--state all`, so closed records are already present) — no extra `gh` call. Re-resolve the path first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_RECORDS_FACETED=help-records-faceted.json)"
export GRANT_SAMPLING_EVERY="$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values grant-sampling-every)"
node -e "
  const { sampledForDemo } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grant-sampling.js');
  const records = require('$HELP_RECORDS_FACETED');
  const merges = records
    // stateReason !== 'NOT_PLANNED' excludes a granted-but-declined record
    // (closed without ever merging) from the machine-granted-merge count —
    // the same signal trust.js's own notPlanned tracking reads off this
    // fetch's stateReason field, mirroring fleet-counters.js's viaMergeCommit
    // gate on its own merges input.
    .filter((r) => r.state === 'CLOSED' && r.stateReason !== 'NOT_PLANNED' && r.facets.grants && r.facets.grants.merge)
    .map((r) => ({ number: r.number, closedAtIso: r.closedAt, commentBodies: (r.comments || []).map((c) => c.body) }));
  const flaggedOrdinals = new Map(sampledForDemo(merges, process.env.GRANT_SAMPLING_EVERY).map((f) => [f.number, f.ordinal]));
  const pending = records.filter((r) => flaggedOrdinals.has(r.number) && r.facets.acceptance === 'pending');
  console.log(JSON.stringify(pending.map((r) => ({ number: r.number, ordinal: flaggedOrdinals.get(r.number) }))));
"
```

Each result flags in the Needs Attention table: `{ref} — sampling floor: the {ordinal}th machine-granted merge on record, still awaiting a verdict — /claude-tweaks:demo {ref}`. `{ordinal}` is the record's position in the full, unbounded machine-granted-merge history — there is no reset; ordinal 40 always means the 40th one ever, not "40 since some earlier checkpoint." An empty result means nothing sampled this run — omit the flag entirely rather than rendering a zero row, same convention as the Justification/Definition flags above. A record already resolved (`facets.acceptance` is `approved` or `changes-requested`) never appears here even if its ordinal lands on a boundary — sampling only ever asks for a verdict that hasn't been given yet, it never re-flags a settled one.

### PR-state join (in-flight runs and tombstones)

`work-backend: github-issues` only (`local-files` has no PR concept — skip this sub-section
entirely for that driver). One additional bounded call, shared across every record in the
`ready`/`authorized`/`building` buckets rather than one call per record — the
never-`gh issue list --search` rule (`_shared/github-write-transport.md`'s eventually-consistent
search index anti-pattern) applies here too, so this is a plain list, filtered client-side.
Resolve this fence's session-scoped destination first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_PRS=help-prs.json)"
gh pr list --repo {owner}/{repo} --state all --limit 100 --json number,url,state,isDraft,body,updatedAt > "$HELP_PRS"
```

Filter to PRs whose body starts with `<!-- claude-tweaks-run:` (`_shared/pr-early-run-lifecycle.md`'s
marker — the plugin-created signal), then match each surviving PR to a record via its `Fixes #{n}`
line(s). Join against Stage 1's `ready`/`authorized`/`building` buckets:

- **`state: OPEN`** → the record has a visible in-flight run. Note the PR URL; no flag needed —
  this is the expected case for a `building` record under `pr-first`.
- **`state: CLOSED` (unmerged)** → a prior attempt's run ended without merging — most likely a
  tombstone (`_shared/pr-run-comments.md`'s failure path), possibly a manually-closed draft
  (`/claude-tweaks:tidy` Step 4.8's `repo-wide` scope is the precise source for that distinction —
  it also checks the `failure`-kind marker comment, which this cheaper dashboard join does not).
  Flag the record in the Needs Attention table either way — a human deciding whether to retry
  doesn't need the marker check to know a closed PR is worth a look: `{ref} — closed run (PR
  #{number}, {url}), likely tombstoned — retry via /claude-tweaks:dispatch or
  /claude-tweaks:flow {ref}`, reusing the same table the conflict/Justification flags already render
  into rather than a new section.
- **`state: MERGED`**, or no matching PR at all → nothing to flag; the record's own bucket
  (backlog/ready/etc.) already reflects its real state.

A record can have more than one matching PR across its history (retries that recreated rather
than reopened — `_shared/pr-early-run-lifecycle.md`'s reopen-fails fallback); use the
most-recently-`updatedAt` match only.

**Fail-open**: a failed `gh pr list` here degrades the same way Stage 1's own fetch does — emit
`PR-state join skipped — {reason}` and omit the tombstone flags for this run, never BLOCKED.

### Conflict detection (file overlap)

Feeds from open **in-flight** records — any record with `facets.stage === 'ready'` (covers the ready, authorized, building, and blocked sub-states alike: the `ready` label persists for a record's entire life once shaped, and is never removed by `/claude-tweaks:dispatch`, `/claude-tweaks:build`, `/claude-tweaks:flow`, or `/claude-tweaks:wrap-up` — `_shared/work-record.md`'s permission matrix). Backlog and parked records are never spec-shaped, so they carry no `### Key Files` subsection and would contribute nothing to the map — same reasoning `/claude-tweaks:specify`'s Step 1 File Reference Map documents — so skip them.

`work-backend: github-issues`: filter Stage 1's already-fetched `$HELP_RECORDS_FACETED` (session-scoped, `_shared/session-tmp-root.md` — re-resolved below) to `facets.stage === 'ready'` — its `body` field (fetched in Stage 1's `gh issue list` call above) is already populated, so no second `gh issue list --state open` call is needed:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_RECORDS_FACETED=help-records-faceted.json HELP_INFLIGHT_BODIES=help-inflight-bodies.json)"
node -e "
  const records = require('$HELP_RECORDS_FACETED');
  const inFlight = records.filter((r) => r.facets.stage === 'ready');
  console.log(JSON.stringify(inFlight));
" > "$HELP_INFLIGHT_BODIES"
```

`work-backend: local-files`:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_INFLIGHT_BODIES=help-inflight-bodies.json)"
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  console.log(JSON.stringify(queryRecords('specs', { stage: 'ready' })));
" > "$HELP_INFLIGHT_BODIES"
```

Extract the `### Key Files` subsection (under `## Technical Approach`, per `spec-template.md`'s record body template) from every returned body — the same extraction `/claude-tweaks:specify` Step 1 performs — to build this stage's session-scoped `help-records-key-files.json` as `[{id, keyFiles}]` (`id` is the issue number, or the local record id). Never let the raw record bodies re-enter the model's context for this step — call the existing extractor and redirect its output:

`work-backend: github-issues` (`extractKeyFiles` reads each record's raw `body`/`labels`, so origin-header records — code-health, harness-health, etc. — extract correctly alongside `/specify`-shaped ones). Re-resolve both session-scoped paths first (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variable):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_INFLIGHT_BODIES=help-inflight-bodies.json HELP_RECORDS_KEY_FILES=help-records-key-files.json)"
node -e "
  const { extractKeyFiles, expectsKeyFilesSection } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const inFlight = require('$HELP_INFLIGHT_BODIES');
  const items = inFlight.map((r) => ({ id: r.number, keyFiles: extractKeyFiles(r) }));
  for (const [i, item] of items.entries()) {
    if (item.keyFiles.length === 0 && expectsKeyFilesSection(inFlight[i])) {
      console.error('Warning: ' + inFlight[i].facets.stage + ' record #' + item.id + ' has no ### Key Files subsection — overlap detection disabled for it.');
    }
  }
  console.log(JSON.stringify(items));
" > "$HELP_RECORDS_KEY_FILES"
```

`work-backend: local-files` (no `by:*` origin labels to key off — extract straight from `### Key Files`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_INFLIGHT_BODIES=help-inflight-bodies.json HELP_RECORDS_KEY_FILES=help-records-key-files.json)"
node -e "
  const { extractKeyFilesSection } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const inFlight = require('$HELP_INFLIGHT_BODIES');
  const items = inFlight.map((r) => ({ id: r.id, keyFiles: extractKeyFilesSection(r.body) }));
  for (const [i, item] of items.entries()) {
    if (item.keyFiles.length === 0) {
      console.error('Warning: record ' + item.id + ' has no ### Key Files subsection — overlap detection disabled for it.');
    }
  }
  console.log(JSON.stringify(items));
" > "$HELP_RECORDS_KEY_FILES"
```

Then call the shared grouping primitive, re-resolving this stage's session-scoped path once more (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_RECORDS_KEY_FILES=help-records-key-files.json)"
node -e "
  const { groupByFileOverlap } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const items = require('$HELP_RECORDS_KEY_FILES');
  const conflicts = groupByFileOverlap(items).filter((g) => g.length > 1);
  console.log(JSON.stringify(conflicts));
"
```

A record appearing in any group of size > 1 shares files with another open in-flight record — flag it in the Needs Attention table, listing the other group members as the conflicting records.

> **Algorithm shared with `/claude-tweaks:specify`:** both skills call the same `groupByFileOverlap` (`bin/lib/issues/grouping.js`) — `/claude-tweaks:specify` runs it at creation time; `/claude-tweaks:help` re-runs it at dashboard time to catch new conflicts from records that started building since then.

**Ranking `ready` + `authorized` records for the render below.** For each candidate — Stage 1's `ready` and `authorized` buckets combined — compute the two inputs `ranking.js`'s `rankNextToBuild` needs but doesn't compute itself: `keyFiles` (extract the `### Key Files` subsection from the body, the same extraction Conflict detection above performs) and `hasPlan` (`true` if `docs/superpowers/plans/` contains a file whose name references the record's id/slug — a filename-pattern check, not a content read). `body` is already present from Stage 1's fetch.

Resolve this fence's session-scoped working file first (`_shared/session-tmp-root.md`) — the same path this run's own candidate-composition step (immediately above) wrote `[{id, facets, body, keyFiles, hasPlan}]` to:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HELP_READY_AUTH_CANDIDATES=help-ready-authorized-candidates.json)"
node -e "
  const { rankNextToBuild } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/ranking.js');
  const candidates = require('$HELP_READY_AUTH_CANDIDATES'); // [{id, facets, body, keyFiles, hasPlan}]
  console.log(JSON.stringify(rankNextToBuild(candidates)));
"
```

The table below renders in this ranked order, not the fetch's own order.

Emit one Template A row for the six counts (Finding: `backlog {N} ({M} stale) / parked {N} ({M} wake-ready) / ready {N} / authorized {N} / building {N} / blocked {N}`), plus one row per conflict group, one row per `solution:unjustified` backlog record, one row per `needs:definition` backlog record, and one row carrying the ranked `ready`+`authorized` order computed above (Finding: the ordered `{ref}` list) so the Ready to Build table can render in that order.

There is no Stage 1.5, Stage 3, or Stage 4 — they merged into Stage 1 above (their data sources — `specs/backlog/*.md`, the old spec index, and `specs/*.md` frontmatter — are retired). The rest of the numbering (Stage 2, 4.5, 4.6, 4.7, 5, 6, 7) is unchanged, so existing cross-references — including this file's own later stages and `SKILL.md`'s Priority Order — keep pointing at the right stage.

## Stage 2: Design Docs (`docs/superpowers/specs/*-design.md`)

*(Main thread — one `Glob` plus a heading check per hit. Runs concurrently with the agent batch.)*

- Find design docs that still exist (full decomposition deletes the doc, so any surviving doc is either un-decomposed or partially decomposed)
- For each surviving doc, check whether it has `## Phase N:` headings:
  - No phase headings → never decomposed, waiting for `/claude-tweaks:specify`
  - Has phase headings but at least one lacks a matching `## Phase N: Specified` marker → partially decomposed, the unmarked phases are still waiting for `/claude-tweaks:specify`
- These are brainstorming outputs waiting for `/claude-tweaks:specify`

## Stage 4.5: Current PR (GitHub)

Scan per `_shared/github-pr-scan.md`, **`current-pr`** scope. The dispatcher inlines `_shared/forge-detection.md`'s Detection Ladder plus that file's `current-pr` scope section and Output Contract into this agent's prompt — subagents cannot read sibling files.

- Detection ladder runs first — any failure emits a single info row (`GitHub scan skipped — {reason}`) and the stage completes normally (fail-open, never BLOCKED)
- Current branch's PR: review decision, failing/pending CI checks, unresolved review-thread count, linked issues
- Repo-wide stale-PR count (total open, count stale) — routed to Stage 7's maintenance signals, not the Current PR dashboard section
- No PR on the branch → single info row (`No open PR for current branch`); the dashboard omits the Current PR section

## Stage 4.6: Triage Queue (GitHub)

Cheap counts only — detail stays `/claude-tweaks:backlog`'s and `/tidy`'s job,
not `/help`'s. Skip silently (same fail-open detection ladder as Stage 4.5)
when `gh` is unavailable, unauthenticated, or the repo has no GitHub remote.

Scan per `_shared/github-pr-scan.md`, **`triage-queue`** scope. The dispatcher inlines `_shared/forge-detection.md`'s Detection Ladder plus that file's `triage-queue` scope section and the three-line render format into this agent's prompt — subagents cannot read sibling files. This is the single source for these three counts; this stage does not compute them independently (previously it did, and its own version double-counted `status:blocked` issues inside "pending authorization" — the shared scope excludes them). Origin-agnostic: every `ready` record counts toward pending authorization regardless of origin (health-filed, captured, or human-filed, with or without a `by:*` label) — matching `/claude-tweaks:backlog refine`'s own origin-agnostic `ready`-queue pull, which tiers no health-skill origin specially.

## Stage 4.7: Acceptance Queue

Cheap list only — the walkthrough stays `/claude-tweaks:demo`'s job, not `/help`'s. `/demo` no
longer sweeps the `demo:pending` backlog itself (it resolves only the items you name — this
session's own recall-detected work, one explicit `#N`, or an explicit `#N,#M` list taken one at
a time — never a scan), so this stage is the sole discovery surface for which records are
outstanding, on either driver.

`work-backend: github-issues`: skip silently (same fail-open detection ladder as Stage 4.5/4.6)
when `gh` is unavailable, unauthenticated, or the repo has no GitHub remote. Scan per
`_shared/github-pr-scan-acceptance.md`, **`acceptance-queue`** scope (extracted from
`_shared/github-pr-scan.md` — #204). The dispatcher inlines `_shared/forge-detection.md`'s
Detection Ladder plus that file's `acceptance-queue` scope section and one-line render format into
this agent's prompt — subagents cannot read sibling files.

`work-backend: local-files`: no Detection Ladder or `gh` call — read the local record store
directly, the same `queryRecords` (`bin/lib/issues/local-store.js`) primitive Stage 1's Conflict
detection sub-section already uses. `demo:pending` (`facets.acceptance === 'pending'`) persists
independent of open/closed state, exactly as it does under `github-issues`, so this needs the same
open-plus-closed merge `tidy/step-1-records.md`'s Shape 7/8 already use for the same reason:
`queryRecords`'s default is open-only, and `{ closed: true }` does not mean "open and closed" —
it means "closed only" (`bin/lib/issues/local-store.js`'s own comment on this behavior) — so both
calls run and their results merge:

```bash
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const records = [
    ...queryRecords('specs', { acceptance: 'pending' }),
    ...queryRecords('specs', { acceptance: 'pending', closed: true }),
  ];
  console.log(JSON.stringify(records.map((r) => ({ id: r.id, title: r.title }))));
"
```

Render as the same one-line format as the `github-issues` scope: `Awaiting sign-off: **{N}
records** — #{id1} ({title1}), #{id2} ({title2}), ... — run /demo #{id1},#{id2},... to review them
all` (a single ref when `{N}` is 1: `run /demo #{id1}`) — omit entirely when the count is 0.

## Stage 4.8: Trust Table (GitHub)

Read-only report of `bin/lib/issues/trust.js`'s per-class evidence — it never grants, changes a
label, merges anything, or recommends an autonomous action; see `_shared/trust-table.md`'s
framing note for why. Omit this stage entirely under `work-backend: local-files` — no Detection
Ladder or `gh` call runs in that case, and the dashboard's Trust Table section is omitted. Under
`github-issues`, skip silently (same fail-open Detection Ladder as Stage 4.5/4.6/4.7) when `gh` is
unavailable, unauthenticated, or the repo has no GitHub remote.

Run the same three-check Detection Ladder as Stage 4.5/4.6/4.7 (`_shared/forge-detection.md` —
the dispatcher inlines it into this agent's prompt) before the fetch
below. On the first failing check, return the status line plus the literal text `GitHub scan
skipped — {reason}` and stop.

Scan per `_shared/trust-table.md`. The dispatcher inlines that file's Fetch and Render sections
into this agent's prompt — subagents cannot read sibling files. **The Fetch section's
`work-links` resolution sub-section is part of what gets inlined**, not an optional preamble: the
parent-issue fetch has a `body-text` and a `native` branch, and an agent that cannot resolve
`work-links` cannot choose between them (picking the first-listed one on a `native` repo silently
returns zero sub-issues and re-inflates every cell's `total`). Agent output format (status line
first, per the Execution model's Contract above, then exactly one of):

```markdown
GitHub scan skipped — {reason}
```

or the markdown produced by `_shared/trust-table.md`'s Render section — the full table, or its
all-insufficient collapse line, with no narration before or after either form.

## Stage 5: Specs Awaiting Review

*(Main thread — runs concurrently with the agent batch.)*

- Find specs that appear fully implemented but haven't been reviewed yet
- These need `/claude-tweaks:review` before `/claude-tweaks:wrap-up`

## Stage 6: Specs Awaiting Wrap-Up

*(Main thread — runs concurrently with the agent batch.)*

- Find specs that have been reviewed (review commits/artifacts exist) but not wrapped up

## Stage 7: Maintenance Signals

*(Main thread, and last — this stage reads other stages' output, so it runs only after the agent batch and Stages 2/5/6 have all returned. See the Execution model above.)*

- Backlog has 10+ records → suggest `/claude-tweaks:tidy`
- Stage 4.5 reports stale open PRs (>4 weeks without updates) → suggest `/claude-tweaks:tidy` (Step 4.8 audits the PR backlog)
- Plans older than 4 weeks with no matching spec progress → flag
- More than 3 design docs unspecified → suggest a `/claude-tweaks:specify` session
- Doc registry exists but has stale entries or gaps → suggest `/claude-tweaks:tidy` (Step 4.6 audits registry health)
- No doc registry exists but `docs/` has files → suggest `/claude-tweaks:init update` to create registry

## Present Dashboard

```markdown
## Workflow Status

claude-tweaks v{version} (Stage 0 — see its own section for the missing/unreadable fallback line)

### Pipeline
| Stage | Count | Action |
|-------|-------|--------|
| Design docs unspecified | {N} | `/claude-tweaks:specify {topic}` |
| Specs awaiting review | {N} | `/claude-tweaks:review {number}` |
| Specs awaiting wrap-up | {N} | `/claude-tweaks:wrap-up {number}` |

### Work Records (backlog / parked / ready / authorized / building / blocked)

*(Omit this section entirely when the work-record scan was skipped (Stage 1's fail-open case), or when all six counts are 0 — an empty pipeline, matching the Triage Queue section's own omission convention.)*

- Backlog: **{N}** ({M} stale, untouched longer than the configured `record-staleness-weeks` threshold) — `/claude-tweaks:capture` to add, `/claude-tweaks:tidy` to review stale ones
- Parked: **{N}** ({M} wake-ready — milestone due) — `/claude-tweaks:tidy` to re-evaluate triggers
- Ready (pending authorization): **{N}** — `/claude-tweaks:backlog refine` to review and grant
- Authorized: **{N}** — `/claude-tweaks:dispatch` (headless) or `/claude-tweaks:build #{n}` (direct)
- Building: **{N}** — resume `/claude-tweaks:build`/`/claude-tweaks:flow`, or check status
- Blocked (`bot:blocked`): **{N}** — `/claude-tweaks:backlog refine` to re-authorize

### Current PR — #{N} {title}

*(Omit this section when Stage 4.5 reports no open PR or the GitHub scan was skipped.)*

| Signal | State | Action |
|--------|-------|--------|
| Review decision | {APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED} | {Address review threads / —} |
| CI checks | {N failing, M pending} | {Fix before merge / —} |
| Unresolved threads | {N} | {Address or resolve / —} |
| Linked issues | {#12, #14} | Closed on merge |

### Triage Queue

*(Omit this section entirely when the GitHub scan was skipped, or when all three counts are 0.)*

- Pending authorization: **{N} records awaiting your decision** — run `/claude-tweaks:backlog refine` (omit this line when N is 0)
- Blocked: **{N} records hit their retry ceiling** — run `/claude-tweaks:backlog refine` to review (omit this line when N is 0)
- Auto-merged this week: **{N} auto-merges** on the default branch in the last 7 days (omit this line when N is 0)

### Acceptance Queue

*(Omit this section entirely when the GitHub scan was skipped, or the count is 0.)*

- Awaiting sign-off: **{N} records** — #{n1} ({title1}), #{n2} ({title2}), ... — run `/claude-tweaks:demo #N` on any of these

### Trust Table

*(Omit this section entirely under `work-backend: local-files`, or when Stage 4.8's GitHub scan
was skipped.)*

{Stage 4.8's returned markdown, inserted verbatim — either the full per-class table or its
all-insufficient collapse line, per `_shared/trust-table.md`'s Render section. Read-only: this
section reports what evidence exists and never recommends acting on it.}

### Ready to Build (priority order)

*(Omit this section entirely when the work-record scan was skipped (Stage 1's fail-open case), or when both buckets are 0.)*

| Record | Title | Risk / Size | Status | Has Plan? |
|--------|-------|----------------|--------|-----------|
| {ref} | {title} | {risk}/{size} | ready / authorized | {yes/no} |

`{ref}` is `#{n}` under `work-backend: github-issues`, the bare record id under `local-files`. Rows come from Stage 1's `ready` and `authorized` buckets, ordered per `SKILL.md` Section 3's Tie-Breaking rules, capped at `--budget` rows (default 10 — see `SKILL.md`'s `## Input` section). If more rows exist than the budget allows, append one line below the table: "`{remaining}` more ready/authorized records exist beyond this run's `--budget {N}` — re-run `/claude-tweaks:help --budget {N}` to see more."

### Needs Attention
| Item | Issue | Suggested Action |
|------|-------|-----------------|
| {item} | {issue} | {action} |

Capped at `--budget` rows (default 10), same overflow-note convention as Ready to Build above. Order flagged items by severity (high → low, using the same scale from the dispatch contract above) before truncating, so the most actionable items survive the cap.
```
