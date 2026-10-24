# Backlog — Overview Mode

Entirely mechanical — no per-record LLM reads, so it scales to the full fetched set cheaply. Renders a funnel decision surface over the open queue and recommends what to build next; the `critical`/`risk-value`/`cleanup`/`trust` lenses are one explicit argument away.

**Narration allowance:** exactly one opening status line at the start of the run, plus a line whenever a check fails or degrades (truncation warning hit, fetch fallback taken, trust fetch skipped) — nothing else. No per-step "running"/"passed" line; each step below restates this allowance in one clause.

## Step 1: Fetch

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

Every temp file this mode writes below resolves through `bin/lib/session-tmp.js`'s `sessionTmpPath`, per `_shared/session-tmp-root.md`'s session-scoped temp-root convention (cited once here, not restated per script).

Fetch and facet-parse the full open-issue queue per `_shared/record-queue-fetch.md`, same as `refine-mode.md`'s priority/Related fetch (`{tmp-records-file}` = `session-scoped backlog-overview-open.json`, `{tmp-faceted-file}` = `session-scoped backlog-overview-faceted.json`) — reading through the session-scoped record snapshot, shared with `/capture`/`/specify`/`/help`/`/tidy`/`/visualize` and, within this run, with `refine-mode.md`'s own fetch below. Step 3's recommendation pass needs every candidate's `body` (for `rankNextToBuild`'s internal `parseDependencies` call) — the snapshot's union field set always carries `body`, no `{EXTRA_FIELDS}` request needed, so every candidate's unblocks-count computes correctly rather than silently reading 0 and quietly corrupting the bare-mode recommendation's tie-break order. Under `work-backend: github-issues`, also fold in `unsynced: true` local fallback records the same way (port the retired `/claude-tweaks:review-backlog` skill's old Step 1 unsynced fold-in verbatim):

```bash
ST_BACKLOG_OVERVIEW_UNSYNCED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-unsynced.json)"
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const records = queryRecords('specs', { unsynced: true });
  console.log(JSON.stringify(records));
" > "$ST_BACKLOG_OVERVIEW_UNSYNCED"
```

```bash
ST_BACKLOG_OVERVIEW_UNSYNCED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-unsynced.json)"
ST_BACKLOG_OVERVIEW_UNSYNCED_DATED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-unsynced-dated.json)"
ST_BACKLOG_OVERVIEW_FACETED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-faceted.json)"
ST_BACKLOG_OVERVIEW_FACETED_MERGED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-faceted-merged.json)"
node -e "
  const { deriveCreatedAtFromGit } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/backlog.js');
  const records = require('$ST_BACKLOG_OVERVIEW_UNSYNCED');
  console.log(JSON.stringify(deriveCreatedAtFromGit(records)));
" > "$ST_BACKLOG_OVERVIEW_UNSYNCED_DATED"
node -e "
  const { mergeUnsyncedRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/backlog.js');
  const github = require('$ST_BACKLOG_OVERVIEW_FACETED');
  const unsynced = require('$ST_BACKLOG_OVERVIEW_UNSYNCED_DATED');
  console.log(JSON.stringify(mergeUnsyncedRecords(github, unsynced)));
" > "$ST_BACKLOG_OVERVIEW_FACETED_MERGED"
mv "$ST_BACKLOG_OVERVIEW_FACETED_MERGED" "$ST_BACKLOG_OVERVIEW_FACETED"
```

This last script reads `session-scoped backlog-overview-faceted.json`'s github-only content, writes the fully merged (github + unsynced) set to a **distinct** path, then moves that path over the original once the `node -e` process has exited — never read-and-redirect-write the same path in one shell command, since `>` truncates its target before the reading process even opens it. Step 2 below reads `session-scoped backlog-overview-faceted.json` expecting the merge to already be complete. Tag every fetched record with a **not yet synced** marker wherever `facets.unsynced === true` — this is a display-only tag in `overview` mode; the apply path for unsynced records' priority lives in `refine` mode's Apply step (writing `priority:*` via `writeRecord` when a record has no `$ISSUE`).

## Step 1.5: Trust table (read-only)

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

*(Omit this entire step under `work-backend: local-files` — see `_shared/trust-table.md`'s
framing note; `demo:approved`/`demo:changes-requested` are a `github-issues` concept and there is
nothing to fetch.)*

The trust fetch/computation still runs **once per invocation**, independent of which lens (or
none) was requested, per `_shared/trust-table.md`'s Fetch section verbatim (including its
`work-links` resolution sub-section — skipping it and taking the first-listed `body-text` branch
on a `native` repo silently returns zero sub-issues, and every decomposed sub-issue re-enters
`cell.total` as ungraded evidence) — unchanged from before.

**Bare mode renders only a single collapsed consequence line**, never the table: one line, all
non-clean cells folded in semicolon-separated, e.g. `trust: clean, except human:human|low (mixed)
→ merges below stay PR-gated`. The consequence line renders for cells whose verdict is neither
`clean` nor `insufficient-evidence` (with `trust.js`'s current vocabulary that means exactly the
`mixed` cells). When no cell's verdict requires it, render **nothing at all** — no "trust: clean"
line. `insufficient-evidence` cells render nothing in bare mode — their table is one lens away.

The verdict vocabulary is read verbatim from `bin/lib/issues/trust.js`'s row verdicts as
`_shared/trust-table.md` defines them — nothing new is invented here.

```bash
ST_BACKLOG_OVERVIEW_TRUST_ROWS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-trust-rows.json)"
```

Capture the Fetch script's printed rows to `"$ST_BACKLOG_OVERVIEW_TRUST_ROWS"` — the consequence
line renders from it, and bare mode's Machine-grant outlook (Step 2) re-reads the same file rather
than re-fetching.

The full table render moves to the trust lens (Step 2).

## Step 2: Route by lens

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

**Native blocked-by pre-attach (bare mode only, `work-links: native` repos only — refs #563).** Before the funnel-computation script below runs, resolve native `blockedBy` links for the **ready+granted subset only** (`bl.readyGrantedSubset(all)`, `bin/lib/issues/backlog.js`) — the only records whose `granted`/`dispatchable` split this header renders. This is deliberately narrower than Step 3's own buildable subset (`dispatchable` ∪ `granted`, computed only after this script runs) — see that function's own comment for why the two are not interchangeable.

Resolve `work-links` (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links`); skip this subsection entirely on `work-links: body-text` or `work-backend: local-files` repos — `blockersOf`'s existing facets/body-text fallback stands unchanged for them, exactly as it does today.

On `work-links: native`: check field availability via `capabilities-probe.js`'s `probeCapabilities({owner, repo}).dependencies` first. On probe failure or unavailability, skip the fetch entirely (no-op) — funnel computation proceeds below with `r.blockedBy` unset for every candidate, with one failure-only narration line noting the probe was unavailable (matching Step 3's own probe-failure narration below), never a hard stop. On probe success, fetch every `readyGrantedSubset` candidate's blocked-by set as one aliased GraphQL query using `buildNativeDependencyQuery` (`bin/lib/issues/record.js`), chunked at 50 aliases per request (the same chunking Step 3 already uses; a chunk that fails outright is scoped to its own aliases only — the never-coerce rule below applies per alias regardless of which chunk it came from, so one failed chunk never discards another chunk's already-resolved data), then for each candidate whose alias resolved, set `r.blockedBy = nodes.filter(open).map(number)` using `hasOpenNativeBlocker`-equivalent open-state filtering (`record.js`) — a candidate whose alias is missing or errored inside an otherwise-successful batch gets **nothing attached** (never coerced to `[]`), the same never-coerce rule Step 3 already documents. On whole-fetch failure, no-op the same as probe failure, with the same one-line narration. Any of these degrade paths renders the header's fallback behavior correctly — no hard stop, per this file's failure-only narration convention (one line whenever the probe is unavailable, the whole fetch fails, or at least one alias inside an otherwise-successful batch failed, naming the affected ids where applicable).

The funnel-computation script below then reads `all` with these `r.blockedBy` values already attached — `funnelBuckets`'s existing `blockersOf` precedence (top-level `r.blockedBy` first) buckets a now-attached record into `granted` instead of `dispatchable` with no further change.

```bash
ST_BACKLOG_OVERVIEW_FACETED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-faceted.json)"
ST_BACKLOG_OVERVIEW_VIEWS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-views.json)"
node -e "
  const bl = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/backlog.js');
  const all = require('$ST_BACKLOG_OVERVIEW_FACETED');
  console.log(JSON.stringify({
    critical: bl.filterCritical(all),
    riskValue: bl.rankRiskValue(all),
    cleanup: bl.filterCleanup(all),
    split: bl.splitScoredUnscored(all),
    funnel: bl.funnelBuckets(all),
  }));
" > "$ST_BACKLOG_OVERVIEW_VIEWS"
```

**`critical`** — render `.critical` as a table (`| # | Record | Priority | Age |`), capped at `--budget` rows (default 20) with an overflow note. Note the excluded unscored count from `.split.unscored.length` ("N unscored records not risk-assessed yet — run bare mode for a judgment pass"). Then stop — render Next Actions; lens runs never reach the batch emitter (Step 4 is bare-mode only).

**`risk-value`** — render `.riskValue.ranked` as the primary ranked table, then `.riskValue.unscored` as a trailing "not yet scored" group, same capping. Add a `Tier` column reading `facets.ceremony` directly (`fast-lane`/`standard`), `—` for records scored before ceremony-tiering shipped. Then stop — render Next Actions; lens runs never reach the batch emitter (Step 4 is bare-mode only).

**`cleanup`** — render `.cleanup` as a table, grouped for a batch sweep, same capping. Then stop — render Next Actions; lens runs never reach the batch emitter (Step 4 is bare-mode only).

**`trust`** — renders the full trust table per `_shared/trust-table.md`'s Render section verbatim
(uncapped — that contract's "never cap or truncate the row count" rule applies unchanged), using
the computation Step 1.5 already ran. Then stop — render Next Actions; lens runs never reach the
batch emitter (Step 4 is bare-mode only). Under `work-backend: local-files` the lens reports that
the trust table is not applicable (same omission rationale as Step 1.5).

**Bare (no lens)** — render the funnel header from `.funnel` (`funnelBuckets` output), then
continue to Step 3. The header is populations + verbs only — **no record ids, and no
Critical/Risk-Value/Cleanup tables** (those remain one lens away). Template:

```
captured ▶ prioritized ▶ specified ▶ granted ▶ dispatchable ▶ in flight
  {captured.length}   {prioritized.length}   {specified.length}   {granted.length}   {dispatchable.length}   {inFlight.length}

# captured {n} — prioritize them
/claude-tweaks:backlog refine

# prioritized {n} — specify them; see the Specify next block below for the real ids

# specified {n} — grant them, or dispatch here with the human gate
/claude-tweaks:backlog refine

# granted {n} — no pointer; blockers surface at /claude-tweaks:dispatch's own execution time

# dispatchable {n} — dispatch the queue
/claude-tweaks:dispatch

# in flight {n} — no pointer; informational, claims honored

└─ needs you: {n}   (human-owed — the one lane no agent can drain)
```

Every category line above stands alone as a `#`-comment — no command text on it. A category with a pointer command (captured, specified, dispatchable) puts that command on its own following line, with nothing else on the line, so copying just that row yields a runnable command. A category with no pointer (prioritized, granted, in flight) renders its comment line alone, with no command line beneath it — `prioritized`'s own real, pasteable ids render in Step 4's Shape block instead of a substitutable placeholder here.

### Machine-grant outlook (config-aware stage annotations)

Resolve `autonomy` and `grant-origination-enabled` once —
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values autonomy grant-origination-enabled fleet-daily-grant-cap`.
When `autonomy` is not `unattended`, or `grant-origination-enabled` is not `true`, or
`work-backend` is `local-files` (the outlook needs Step 1.5's trust rows — same omission rationale
as Step 1.5 itself), skip: render the template exactly as above, no extra lines. Otherwise read
`machine-grant-outlook.md` in this skill's directory and add its two advisory `#`-comment
annotation lines to the header — why the `specified` and `captured` stages aren't self-draining on
a repo that configured them to.

The branch line is fed from `funnelBuckets`' `needsYou` overlay; rendered only when non-zero
(dormant repos never render it).

The header ends at `in flight` deliberately even though it is not the most actionable stage: the
header is the process axis read left-to-right; the terminal-tail actionability principle is
satisfied by the report's *body* ending in the hand-off and Next sections, not by the header's last
column. The header replaces the summary counts too — do not re-add a prose counts paragraph above
it; the header *is* the counts. The branch line below the header is a lane annotation, not a
seventh stage column.

Then at most **two annotation lines total**:

- The trust consequence line from Step 1.5, when any applicable cell verdict requires it (all
  non-clean cells collapsed into that single semicolon-separated line — the per-cell phrasing never
  multiplies lines). Nothing when clean.
- `parked {N} · not-planned {M} → /claude-tweaks:tidy owns these` — rendered from
  `.funnel.parked.length` / `.funnel.notPlanned.length`, only when either count is non-zero.

A decomposition parent is never `ready` and is not agent-sized work (`_shared/work-record.md`'s
Decomposition rules); `.funnel.parents` no longer gets an annotation line here — its count and a
paste-ready batch render in Step 4's Sign-off stage instead, pointing at
`/claude-tweaks:demo` (backstopped by `wrap-up/verification-brief.md`'s Parent-Gate Procedure and
`/claude-tweaks:tidy`'s `Open parent gate` action).

Every record appears exactly once across the header's populations (`funnelBuckets` is mutually
exclusive by construction) — never re-list a record in a second stage or an extra summary — the
`needs you` branch line is the deliberate exception: an overlay over the stages above, its members
counted twice by design.

## Step 3 (bare only): Recommend what to build next

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

Restricted to the buildable subset — `funnelBuckets` output `dispatchable` ∪ `granted` (Step 2's
`.funnel` view) — one predicate, owned by `funnelBuckets`, so the header's counts and this
recommendation's population can never drift apart. Step 2's own native `blockedBy` pre-attach
(above, refs #563) now covers the ready+granted subset this header renders, so the header and this
step's recommendation read the same blocker data for the population both touch — this step's own
fetch below still runs independently over its own (differently-scoped) buildable candidate set,
since the two subsets are not identical (see Step 2's pre-attach note for why). For each candidate, compute the three inputs `ranking.js`'s `rankNextToBuild` needs but doesn't compute itself:

- `keyFiles` — extract the `### Key Files` subsection from the body, the same extraction `/help`'s Conflict detection sub-section already performs.
- `hasPlan` — `true` if `docs/superpowers/plans/` contains a file whose name references this record's id/slug (a simple filename-pattern check, not a content read).
- `body` — already present from Step 1's fetch (needed for `blockersOf`'s body-text `parseDependencies` fallback, used when no `blockedBy` is attached).
- `blockedBy` — resolved per `work-links`/`work-backend`:
  - **`work-links: native`** (resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links`): fetch every candidate's blocked-by set as **one aliased GraphQL query** using `buildNativeDependencyQuery` (`bin/lib/issues/record.js`) — one alias per candidate issue, chunked at 50 aliases per request (buildable candidate sets are small, so one chunk is the norm) — and attach `blockedBy: [ids]` (the open blockers' numbers from each alias's `blockedBy.nodes`). A candidate whose node is missing or errored inside an otherwise-successful batch response gets **nothing attached** for that id only — never coerce a failed node to `[]`, since an empty array means "confirmed no blockers" and the mismatch detection below runs on exactly that distinction. When any alias in an otherwise-successful batch failed, render one failure-only narration line naming exactly those ids (e.g. `blocker data incomplete for #12, #40 — node fetch failed; they rank on body-text fallback this run`) — same failure-only narration rule, per-node granularity, so a prose-less native record hit by a per-node failure doesn't degrade silently. Before the fetch, check field availability via `capabilities-probe.js`'s `probeSchema` (the `blockedBy` field itself — its count-only sibling `issueDependenciesSummary` is insufficient); probe unavailability or whole-fetch failure degrades to the body-text fallback with one failure-only narration line (per this file's failure-only narration rule), never a hard stop.
  - **`work-backend: local-files`**: attach `facets.blockedBy` as the `blockedBy` array — it is already native-shaped data (and `blockersOf`'s own `facets.blockedBy` tier makes this attachment a no-op safety net rather than load-bearing).
  - **`work-links: body-text`**: attach nothing — `blockersOf`'s `parseDependencies` fallback stands.
  - **`unsynced: true` fallback records** (any driver): attach nothing, and their own `facets.blockedBy` is deliberately not consulted — those ids live in the local-record namespace and must never cross-match GitHub issue numbers in the merged set (parent #512 promise F1; `funnelBuckets` applies the same rule).

```bash
ST_BACKLOG_OVERVIEW_CANDIDATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-candidates.json)"
ST_BACKLOG_OVERVIEW_RANKED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-ranked.json)"
node -e "
  const { rankNextToBuild, findUnresolvedDependencyProse } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/ranking.js');
  const candidates = require('$ST_BACKLOG_OVERVIEW_CANDIDATES'); // [{id, facets, body, keyFiles, hasPlan, blockedBy?}]
  console.log(JSON.stringify({ ranked: rankNextToBuild(candidates), flags: findUnresolvedDependencyProse(candidates) }));
" > "$ST_BACKLOG_OVERVIEW_RANKED"
```

### Dependency-mismatch detection

Read `dependency-mismatch-detection.md` in this skill's directory and follow it — the flag
detection over `session-scoped backlog-overview-ranked.json`'s `flags` array, the
headline-replacement rule, and the worked #418/#419/#420 example.

Render the top result (and up to 2 runners-up) as a short "Recommended next" callout above the funnel header, with a one-line rationale derived from which tie-break criterion decided it (e.g. "highest priority, unblocks 2 other records" or "smallest size among same-priority candidates with no file overlap") — except when the dependency-mismatch detection above fired: flagged candidates get no mechanical recommendation, and the headline follows the headline-replacement rule (corrected pick, or the case-(b) unreliable-ranking statement) instead. This section is scoped specifically to *which backlog/ready record deserves attention next* — it does not attempt to replace `/help`'s whole-pipeline status/recommendation role. At precedence level 1 (non-empty `needsYou`, see the Needs-you section's Precedence below), the report's closing `Next:` line and the Next Actions block's recommended line deliberately name the needs-you item instead — this callout stays the build-candidate recommendation regardless, since the two answer different questions (what to build vs. what needs a human decision first).

## Step 4: Batch emitter (bare mode)

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

Bare mode only — lens runs end at their own table (Step 2) and never reach this step.

Three stages, each one paste-ready command block instead of one terminal per record or chain:
**Shape** (`/claude-tweaks:specify #a,#b,...` chunks over the `prioritized` bucket),
**Dispatch** (one bare `/claude-tweaks:dispatch` line), and **Sign-off**
(`/claude-tweaks:demo #a,#b,...` chunks over the `parents` bucket). Neither of the first two stages
computes a dependency graph any more — `docs/skill-graph.md`'s `## backlog` → `/dispatch` row is
the canonical statement of what moved to that skill and why; not restated here. **Score** and **Grant** both point at `/claude-tweaks:backlog refine` — the merged command's
single sweep covers the Priority/Related lanes at the captured stage and the Grant lane at the
specified stage — keeping their existing one-command pointers from the Prioritize/Specify template
lines above.

### Shape stage — specify the prioritized bucket in chunks

**Input:** the `prioritized` bucket (`.funnel.prioritized`, Step 2's `session-scoped
backlog-overview-views.json`) — the same population the funnel header's `prioritized` column
already counts and the pre-rewrite Specify block used.

**Exclusions run first, each named with a count when non-zero:**
- `needs:definition` records (`facets.needsDefinition === true`) — they already surface in the
  Needs-you lane below, and `/claude-tweaks:specify`'s comma-list batch hard-fails its ENTIRE
  batch when any pasted element carries the label, so one leaked record would break every chunk
  it landed in, not just its own.
- `unsynced: true` records (`facets.unsynced === true`) — their ids are local-namespace, never a
  pasteable GitHub `#N` ref. A record carrying both facets counts once, under `needs:definition` —
  the same dominance `funnelBuckets`' `needsYou` overlay already applies.

**Ordering:** the remaining specify-eligible set sorts by priority (high first), then age (oldest
first), ties broken by id — the same convention the Needs-you lane's own ordering states inline.

**Chunking:** sliced into chunks of 10, ALL chunks emitted — no cap on chunk count. A 500-record
specify-eligible set emits 50 one-line commands; a deliberate, documented trade-off (the whole set
stays drainable from one report instead of truncating at an arbitrary top-*k*, the way the old
per-record terminal architecture had to).

```bash
ST_BACKLOG_OVERVIEW_VIEWS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-views.json)"
ST_BACKLOG_OVERVIEW_SHAPE="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-shape.json)"
node -e "
  const { priorityBandOf } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/ranking.js');
  const prioritized = require('$ST_BACKLOG_OVERVIEW_VIEWS').funnel.prioritized;
  const needsDefinition = prioritized.filter((r) => r.facets.needsDefinition === true);
  const unsynced = prioritized.filter((r) => r.facets.unsynced === true && r.facets.needsDefinition !== true);
  const eligible = prioritized
    .filter((r) => r.facets.needsDefinition !== true && r.facets.unsynced !== true)
    .sort((a, b) => priorityBandOf(a) - priorityBandOf(b) || new Date(a.createdAt) - new Date(b.createdAt) || (a.number ?? a.id) - (b.number ?? b.id));
  const chunks = [];
  for (let i = 0; i < eligible.length; i += 10) chunks.push(eligible.slice(i, i + 10).map((r) => r.number ?? r.id));
  console.log(JSON.stringify({ eligibleCount: eligible.length, needsDefinitionCount: needsDefinition.length, unsyncedCount: unsynced.length, chunks }));
" > "$ST_BACKLOG_OVERVIEW_SHAPE"
```

**Render:** one paste block when `.funnel.prioritized` is non-empty (the same "one fenced paste
block per funnel stage that has members" rule the Prioritize/Dispatch blocks already follow) — a
header count line, then one `/claude-tweaks:specify #a,#b,...` command per chunk, all chunks:

```
── Specify next ──
# {eligibleCount} specify-eligible — {needsDefinitionCount} excluded: needs:definition; {unsyncedCount} excluded: unsynced
/claude-tweaks:specify #a,#b,#c,#d,#e,#f,#g,#h,#i,#j
/claude-tweaks:specify #k,#l,#m,...
```

Each exclusion clause (`{n} excluded: needs:definition`, `{n} excluded: unsynced`) renders only
when its count is non-zero; drop the whole ` — ...` suffix when both are zero. When
`eligibleCount` is 0 (every prioritized record was excluded), the block still renders its header
line — the count ledger the no-silent-caps rule requires — with no `/claude-tweaks:specify` line
beneath it. All commands fully qualified. The script above emits bare numeric ids in `chunks` —
the `#` sigil shown in the template is applied at render time, per `work-backend`: under
`github-issues` (the default, and this repo's own setting) prefix each id with `#` as shown;
under `local-files`, drop it and render each chunk as bare comma-joined ids (`{a},{b},...`)
instead, matching `/claude-tweaks:specify`'s own Input table's backend-specific comma-list syntax
(`specify/SKILL.md`) — never the `#`-prefixed form there, which fails to parse as a record
reference under that backend. This file's Step 2 funnel header still hardcodes the `#`-prefixed
form on every one of its own placeholder lines regardless of `work-backend`; that gap predates
this rewrite and is out of scope here.

### Dispatch stage — one queue-consumer pointer

**Input:** `funnelBuckets`'s `dispatchable` ∪ `granted` (`.funnel.dispatchable`/`.funnel.granted`,
the same session-scoped views file the Shape stage reads) — Step 2's own funnel output is the
emptiness signal; no graph computation runs here.

**Render:** exactly one paste block, rendered only when `dispatchable.length + granted.length >
0` — no per-record lines, no chain arrows, no file-overlap annotation (the intro above names
where that logic lives now):

```
── Dispatch now ──
# {dispatchable-count} dispatchable + {granted-count} granted — /claude-tweaks:dispatch picks the order, claims, and serializes file overlap
/claude-tweaks:dispatch
```

When the union is empty, render nothing for this stage — not even the header line.

### Sign-off stage — parents in a paste-ready batch

**Input:** `funnelBuckets`'s `parents` bucket (`.funnel.parents`, the same session-scoped views
file the Shape and Dispatch stages read).

**Exclusion:** `unsynced: true` records (`facets.unsynced === true`) — same reasoning as the Shape
stage's own `unsynced` exclusion: those ids are local-namespace, never a pasteable GitHub `#N` ref.
No `needs:definition` exclusion here — unlike `/claude-tweaks:specify`'s comma-list batch, which
hard-fails its entire batch on one such element, `/claude-tweaks:demo`'s batch reports and skips a
malformed or unresolvable element and keeps running the rest (`demo/SKILL.md`'s `## Input`), so
there is no equivalent whole-batch hazard to guard against here.

**Ordering:** same convention as the Shape stage — priority (high first), then age (oldest first),
ties by id.

**Chunking:** sliced into chunks of 10, ALL chunks emitted — no cap on chunk count, same rationale
as the Shape stage.

```bash
ST_BACKLOG_OVERVIEW_VIEWS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-views.json)"
ST_BACKLOG_OVERVIEW_SIGNOFF="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-signoff.json)"
node -e "
  const { priorityBandOf } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/ranking.js');
  const parents = require('$ST_BACKLOG_OVERVIEW_VIEWS').funnel.parents;
  const unsynced = parents.filter((r) => r.facets.unsynced === true);
  const eligible = parents
    .filter((r) => r.facets.unsynced !== true)
    .sort((a, b) => priorityBandOf(a) - priorityBandOf(b) || new Date(a.createdAt) - new Date(b.createdAt) || (a.number ?? a.id) - (b.number ?? b.id));
  const chunks = [];
  for (let i = 0; i < eligible.length; i += 10) chunks.push(eligible.slice(i, i + 10).map((r) => r.number ?? r.id));
  console.log(JSON.stringify({ eligibleCount: eligible.length, unsyncedCount: unsynced.length, chunks }));
" > "$ST_BACKLOG_OVERVIEW_SIGNOFF"
```

**Render:** one paste block when `.funnel.parents` is non-empty (the same "one fenced paste block
per funnel stage that has members" rule the other two stages follow) — a header count line, then
one `/claude-tweaks:demo #a,#b,...` command per chunk, all chunks:

```
── Sign-off ──
# {eligibleCount} decomposition parents — {unsyncedCount} excluded: unsynced — close out via /claude-tweaks:demo (or /claude-tweaks:wrap-up's verification brief), never /claude-tweaks:specify
/claude-tweaks:demo #a,#b,#c,#d,#e,#f,#g,#h,#i,#j
/claude-tweaks:demo #k,#l,#m,...
```

The ` — {unsyncedCount} excluded: unsynced` clause renders only when non-zero; drop it entirely
when zero. When `eligibleCount` is 0 (every parent was excluded), the block still renders its
header line — the count ledger the no-silent-caps rule requires — with no `/claude-tweaks:demo`
line beneath it. Same `#`-sigil / bare-id rendering split by `work-backend` as the Shape stage.

This stage stays outside the `Next:` line's precedence ladder (below) — the `parents` bucket was
never part of it before this rewrite either, since a decomposition parent is never buildable work.

### Retired from Step 4

The per-record terminal architecture these rules guarded is gone; none has a successor here — the
population each named is either already partitioned by `funnelBuckets` (nothing left to comment
on) or now belongs to `/claude-tweaks:dispatch`'s own execution-time logic:

- **Overlap serialization** (former rule (a)) — file-overlap grouping across concurrent
  terminals; there is one Dispatch line, not one terminal per group, so nothing to serialize
  here (`docs/skill-graph.md`'s `/dispatch` row names where the grouping itself now lives).
  **Not carried forward: the old rule's >3-combined-members size cap**
  (only the top-ranked member stayed executable beyond it, every other member excluded as
  comment-only). No dispatch-side equivalent exists, and porting the old mechanism verbatim isn't
  possible: dispatch's own group-claim rule is unconditionally atomic — "claiming a single member
  of a group alone is forbidden" (`SKILL.md`'s `#N` form) — so silently dropping members past a
  cap would violate the invariant the cap itself depended on. A large cross-component overlap
  group is now offered whole, with no fallback; this is a real, larger blast radius per dispatch
  batch than before, accepted here rather than fixed, since resolving it needs a genuinely new
  dispatch-side policy (warn, refuse, or split a bundle above some size) — a product decision, not
  a mechanical port. `SKILL.md`'s bare-mode batch table still shows full bundle membership before
  a human selects one; the `next` (headless) form has no such review and is where this gap bites
  hardest.
- **Claim exclusion** (former rule (b)) — `bot:in-progress` records were already partitioned into
  `.funnel.inFlight` before this step ever saw them; there is no per-record comment line left to
  write.
- **No terminal cap** (former rule (d)) — there is exactly one Dispatch line now; "the human takes
  the top *k*" no longer applies.
- **Flagged-records rendering** (former rule (e)) — Step 3's dependency-mismatch detection and its
  headline-replacement rule are untouched (unchanged, above); a flagged record simply has no
  per-record Dispatch line left to suppress.
- **Out-of-set-blocked granted records**, and its **chain-vs-out-of-set precedence** clause — both
  annotated one terminal's partially-executable command; `/claude-tweaks:dispatch` reports a
  blocked pick at claim time instead of this report annotating it in advance.
- **Cyclic components** — `buildChains`'s `cycles` output is no longer read here; a stalled
  component surfaces via `/claude-tweaks:dispatch` (or Step 3's own recommendation pass, which
  still reads the same ranking data) instead of a named comment block in this step.

The Shape-block `needs:definition` exclusion (the old unlettered Specify-block-exclusion rule) and
the general `needs:definition` records rule (the old unlettered rule after Cyclic components)
collapse into the Shape stage's single `needs:definition` exclusion above, now chunk-level rather
than per-record. The **unsynced records** rule likewise collapses into the Shape stage's
`unsynced` exclusion above. **No silent caps** (former rule (c)) stays live, satisfied by the two
named exclusion counts plus the funnel header itself — already a complete count ledger of every
record's stage. The **sanitize rule** for record-derived text stays live too, scoped to whatever
record-derived text either remaining block interpolates: today that's nothing (both templates
above interpolate integer counts and facet-derived `#N` refs, never free record text), but the
rule remains the guard should a future line add one.

### Needs you (human lane)

Rendered **last before Next Actions**, only when `funnelBuckets`' `needsYou` is non-empty. These are records the batch emitter structurally cannot schedule — the funnel's bottleneck; paste blocks send agents to work, this lane is work only the human can do.

One line per record with an interactive launcher, fully qualified:
- `kind: 'definition'` → `/claude-tweaks:specify #{N}` with a `#`-comment naming the label, waiting-age, and what deciding it releases (e.g. `# needs:definition — waiting {age}; deciding releases {n} records`, or `# needs:definition — waiting {age}; deciding releases nothing tracked` when the count is zero or was skipped — the fallback rule from the Ordering + inputs paragraph above, never a literal `undefined` or `{k}`)
- `kind: 'unjustified'` → `/claude-tweaks:challenge #{N}` (the evidence-or-accept-risk mode — reads the record's `## Gotchas` assumptions, runs a bounded in-repo evidence search, and offers supply-evidence / accept-risk / leave in one call; either resolving choice clears the label) with a `#`-comment naming the one-line call (e.g. `# solution:unjustified — one-line evidence-or-accept-risk call`)
- `unsynced: true` needs-you records never render a `#{N}` launcher (local-namespace ids) — they render one `#`-comment naming the sync gap and pointing at `/claude-tweaks:tidy`, still counted in the branch-line total.

**Ordering + inputs:** `needsYou` stays `{id, kind}` from `funnelBuckets`; the render joins each id back to the faceted record set for `facets.priority` and `createdAt` (already in the overview fetch). Primary sort is priority (high first), then age (oldest first), ties by id — matching the emitter's own convention. Releases-count is an **advisory annotation** on each row, not a sort key — it is computed directly, never sourced from `transitiveUnblocksCount` — that payout map only ever keyed on the old per-record batch emitter's candidate ids, which never included a needs-you record in the first place, and the emitter no longer computes it at all (Step 4's Retired section above). The direct computation: one `node -e` pass importing `blockersOf` from `ranking.js`, run over the full faceted set at `session-scoped backlog-overview-faceted.json` (the carrier — the whole open set, not the emitter's filtered candidate subset) — count how many OPEN records in that set resolve the needs-you record's id via `blockersOf`. When that count is zero, or the computation was skipped, render `deciding releases nothing tracked` in place of a number — never a literal `undefined` or a dangling placeholder. This priority-then-age ordering deliberately deviates from the original spec's releases-first ordering: releases is demoted to an advisory annotation, never the sort key, because the count is partial by construction (needs-you records get no blocker attachment and their dependents are mostly outside the buildable set) — the deviation is flagged here in the text, not left implicit in run artifacts alone.

**Cap + pointer:** at most 3 rows named; beyond that, one pointer line: `{M} more human-owed records → /claude-tweaks:backlog attention (when available)` — advisory until that mode ships (#471's decomposition), count always shown. Interim-launcher honesty note, citing #471: until #471's redirect gate ships, `/claude-tweaks:specify #{N}` on a `needs:definition` record still lands in ordinary shaping mode — acceptable interim (the human is present either way); this caveat is removed by #471's own landing.

Needs you stays the last **rendered** section of the report body — the section below is
document-level, not a continuation of this lane.

### Two-channel contract and the Next: line

**Two-channel contract + `Next:` line:** paste blocks carry agent-executable/unattended commands
only; the Next Actions close-out block carries this-session moves only (run refine here, open a
lens, run dispatch here) and is never the delivery channel for other-terminal command
lists — terminal-command lists inside the close-out block are forbidden. The report body ends with a
single `Next:` line: one sentence naming the top-ranked action, always exactly one.

**Precedence (3-level):**
1. When `needsYou` is non-empty → the `Next:` line names the top Needs-you item (per the section's ordering), recomputed fresh every run — no session state, no stored binding.
2. Otherwise → the Dispatch line when it rendered (`dispatchable ∪ granted` non-empty), else the first Shape chunk when any chunk rendered (the specify-eligible set non-empty) — retires the old "top-ranked executable Dispatch entry" wording along with the per-record entries it used to rank.
3. When neither the Dispatch line nor any Shape chunk rendered → the existing fallback ladder (grant → specify → refine, ties by id; `Next: backlog is empty` terminal case) fires unchanged.

The close-out block's recommended line MUST match the `Next:` line at every precedence level — unchanged rule, now with a well-defined referent at each level (level 2's referent is the Dispatch line or the first Shape chunk, never a ranked per-record pick).
