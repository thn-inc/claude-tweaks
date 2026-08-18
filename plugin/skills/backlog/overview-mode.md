# Backlog — Overview Mode

Entirely mechanical — no per-record LLM reads, so it scales to the full fetched set cheaply. Renders a funnel decision surface over the open queue and recommends what to build next; the `critical`/`risk-value`/`cleanup`/`trust` lenses are one explicit argument away.

**Narration allowance:** exactly one opening status line at the start of the run, plus a line whenever a check fails or degrades (truncation warning hit, fetch fallback taken, trust fetch skipped) — nothing else. No per-step "running"/"passed" line; each step below restates this allowance in one clause.

## Step 1: Fetch

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

Fetch and facet-parse the full open-issue queue per `_shared/record-queue-fetch.md`, same as `refine-mode.md`'s priority/Related fetch (`{tmp-records-file}` = `/tmp/backlog-overview-open.json`, `{tmp-faceted-file}` = `/tmp/backlog-overview-faceted.json`) — reading through the session-scoped record snapshot, shared with `/capture`/`/specify`/`/help`/`/tidy`/`/visualize` and, within this run, with `refine-mode.md`'s own fetch below. Step 3's recommendation pass needs every candidate's `body` (for `rankNextToBuild`'s internal `parseDependencies` call) — the snapshot's union field set always carries `body`, no `{EXTRA_FIELDS}` request needed, so every candidate's unblocks-count computes correctly rather than silently reading 0 and quietly corrupting the bare-mode recommendation's tie-break order. Under `work-backend: github-issues`, also fold in `unsynced: true` local fallback records the same way (port the retired `/claude-tweaks:review-backlog` skill's old Step 1 unsynced fold-in verbatim):

```bash
node -e "
  const { queryRecords } = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/local-store.js');
  const records = queryRecords('specs', { unsynced: true });
  console.log(JSON.stringify(records));
" > /tmp/backlog-overview-unsynced.json
```

```bash
node -e "
  const { deriveCreatedAtFromGit } = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/backlog.js');
  const records = require('/tmp/backlog-overview-unsynced.json');
  console.log(JSON.stringify(deriveCreatedAtFromGit(records)));
" > /tmp/backlog-overview-unsynced-dated.json
node -e "
  const { mergeUnsyncedRecords } = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/backlog.js');
  const github = require('/tmp/backlog-overview-faceted.json');
  const unsynced = require('/tmp/backlog-overview-unsynced-dated.json');
  console.log(JSON.stringify(mergeUnsyncedRecords(github, unsynced)));
" > /tmp/backlog-overview-faceted.json
```

This last script reads `/tmp/backlog-overview-faceted.json`'s github-only content and overwrites the same path with the fully merged (github + unsynced) set — Step 2 below reads `/tmp/backlog-overview-faceted.json` expecting the merge to already be complete. Tag every fetched record with a **not yet synced** marker wherever `facets.unsynced === true` — this is a display-only tag in `overview` mode; the apply path for unsynced records' priority lives in `refine` mode's Apply step (writing `priority:*` via `writeRecord` when a record has no `$ISSUE`).

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

The full table render moves to the trust lens (Step 2).

## Step 2: Route by lens

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

**Native blocked-by pre-attach (bare mode only, `work-links: native` repos only — refs #563).** Before the funnel-computation script below runs, resolve native `blockedBy` links for the **ready+granted subset only** (`bl.readyGrantedSubset(all)`, `bin/lib/issues/backlog.js`) — the only records whose `granted`/`dispatchable` split this header renders. This is deliberately narrower than Step 3's own buildable subset (`dispatchable` ∪ `granted`, computed only after this script runs) — see that function's own comment for why the two are not interchangeable.

Resolve `work-links` (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links`); skip this subsection entirely on `work-links: body-text` or `work-backend: local-files` repos — `blockersOf`'s existing facets/body-text fallback stands unchanged for them, exactly as it does today.

On `work-links: native`: check field availability via `capabilities-probe.js`'s `probeCapabilities({owner, repo}).dependencies` first. On probe failure or unavailability, skip the fetch entirely (no-op) — funnel computation proceeds below with `r.blockedBy` unset for every candidate, with one failure-only narration line noting the probe was unavailable (matching Step 3's own probe-failure narration below), never a hard stop. On probe success, fetch every `readyGrantedSubset` candidate's blocked-by set as one aliased GraphQL query using `buildNativeDependencyQuery` (`bin/lib/issues/record.js`), chunked at 50 aliases per request (the same chunking Step 3 already uses; a chunk that fails outright is scoped to its own aliases only — the never-coerce rule below applies per alias regardless of which chunk it came from, so one failed chunk never discards another chunk's already-resolved data), then for each candidate whose alias resolved, set `r.blockedBy = nodes.filter(open).map(number)` using `hasOpenNativeBlocker`-equivalent open-state filtering (`record.js`) — a candidate whose alias is missing or errored inside an otherwise-successful batch gets **nothing attached** (never coerced to `[]`), the same never-coerce rule Step 3 already documents. On whole-fetch failure, no-op the same as probe failure, with the same one-line narration. Any of these degrade paths renders the header's fallback behavior correctly — no hard stop, per this file's failure-only narration convention (one line whenever the probe is unavailable, the whole fetch fails, or at least one alias inside an otherwise-successful batch failed, naming the affected ids where applicable).

The funnel-computation script below then reads `all` with these `r.blockedBy` values already attached — `funnelBuckets`'s existing `blockersOf` precedence (top-level `r.blockedBy` first) buckets a now-attached record into `granted` instead of `dispatchable` with no further change.

```bash
node -e "
  const bl = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/backlog.js');
  const all = require('/tmp/backlog-overview-faceted.json');
  console.log(JSON.stringify({
    critical: bl.filterCritical(all),
    riskValue: bl.rankRiskValue(all),
    cleanup: bl.filterCleanup(all),
    split: bl.splitScoredUnscored(all),
    funnel: bl.funnelBuckets(all),
  }));
" > /tmp/backlog-overview-views.json
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
captured ▶ scored ▶ shaped ▶ granted ▶ dispatchable ▶ in flight
  {captured.length}   {scored.length}   {shaped.length}   {granted.length}   {dispatchable.length}   {inFlight.length}

# captured {n} — score them
/claude-tweaks:backlog refine

# scored {n} — shape them (#N is a placeholder — substitute the real record number)
/claude-tweaks:specify #N

# shaped {n} — grant them, or dispatch here with the human gate
/claude-tweaks:backlog grant

# granted {n} — no pointer; waiting on blockers, which appear in the dispatch hand-off

# dispatchable {n} — dispatch the queue, or flow one record (#N is a placeholder)
/claude-tweaks:dispatch
/claude-tweaks:flow #N

# in flight {n} — no pointer; informational, claims honored

└─ needs you: {n}   (human-owed — the one lane no agent can drain)
```

Every category line above stands alone as a `#`-comment — no command text on it. A category with a pointer command (captured, scored, shaped, dispatchable) puts that command on its own following line, with nothing else on the line, so copying just that row yields a runnable command. A category with no pointer (granted, in flight) renders its comment line alone, with no command line beneath it.

The branch line is fed from `funnelBuckets`' `needsYou` overlay; rendered only when non-zero
(dormant repos never render it).

The header ends at `in flight` deliberately even though it is not the most actionable stage: the
header is the process axis read left-to-right; the terminal-tail actionability principle is
satisfied by the report's *body* ending in the hand-off and Next sections, not by the header's last
column. The header replaces the summary counts too — do not re-add a prose counts paragraph above
it; the header *is* the counts. The branch line below the header is a lane annotation, not a
seventh stage column.

Then at most **three annotation lines total**:

- The trust consequence line from Step 1.5, when any applicable cell verdict requires it (all
  non-clean cells collapsed into that single semicolon-separated line — the per-cell phrasing never
  multiplies lines). Nothing when clean.
- `parked {N} · not-planned {M} → /claude-tweaks:tidy owns these` — rendered from
  `.funnel.parked.length` / `.funnel.notPlanned.length`, only when either count is non-zero.
- `parents {N} → close-out via /claude-tweaks:wrap-up's verification brief or /claude-tweaks:demo, not /claude-tweaks:specify` —
  rendered from `.funnel.parents.length`, only when non-zero. A decomposition parent is never
  `ready` and is not agent-sized work (`_shared/work-record.md`'s Decomposition rules); the
  close-out path it points at is `wrap-up/verification-brief.md` (backstopped by
  `/claude-tweaks:tidy`'s `Open parent gate` action) or `/claude-tweaks:demo`'s parent-close branch.

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
node -e "
  const { rankNextToBuild, findUnresolvedDependencyProse } = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/ranking.js');
  const candidates = require('/tmp/backlog-overview-candidates.json'); // [{id, facets, body, keyFiles, hasPlan, blockedBy?}]
  console.log(JSON.stringify({ ranked: rankNextToBuild(candidates), flags: findUnresolvedDependencyProse(candidates) }));
" > /tmp/backlog-overview-ranked.json
```

### Dependency-mismatch detection

- Read the `flags` array from `/tmp/backlog-overview-ranked.json` (computed above, in the same pass as `ranked` — `findUnresolvedDependencyProse`, from `ranking.js`). On any hit, render a loud flag naming the affected ids with their `mention` lines, and **suppress every chain-shaped claim** about them ("unblocks N", dependency-order phrasing) — no corrected chain is drawn (chain rendering is the batch-emitter sub-issue).
- The accepted limitation, verbatim: the check fires only on empty resolved blockers; a *partially* wired record (non-empty `blockedBy` missing some prose-mentioned id) is not flagged — prose mentions have no mechanical ground truth, so partial-coverage checking would guess.
- **False-positive expectation:** the prose regex is deliberately broad (same-line intervening words allowed between "blocked by" and the `#N`), so non-dependency mentions can flag too — e.g. "blocked by the outage, see #12" is not a real dependency but still matches. The rendered `mention` line is exactly the human's evidence to dismiss a false positive at a glance; a false negative here would instead be the silent mis-ranking this detection exists to prevent, so the check accepts occasional over-flagging rather than risk under-flagging.
- **Headline-replacement rule:** when detection fires, the flagged candidates get no mechanical recommendation. Either (a) the output cites explicit dependency evidence it holds — native links on other candidates, the flagged records' own prose — as a **corrected** "Recommended next" with the citation inline, in which case the corrected pick IS the headline and the raw ranker pick demotes to a one-line footnote (never render a recommendation the same output retracts); or (b) when no such evidence resolves an order, the output states plainly that ranking is unreliable for the flagged set and points at `/claude-tweaks:backlog refine`'s dependency repair.
- A worked example tracing the observed #418/#419/#420 failure: three records wired `#420 blocked-by #419 blocked-by #418` in the native graph, bodies carrying only prose mentions ("Hard prerequisites, wired as Blocked by links: …"). Pre-#514: bodies parse as zero-dependency, `rankNextToBuild` recommends #420 (the chain's *last* record) first. Post-#514: the native fetch attaches `#420→blockedBy:[419]`, `#419→blockedBy:[418]`, `#418→blockedBy:[]`; `computeUnblocksCount` then yields `418→1, 419→1, 420→0`, so #420 — the record the old path recommended first — drops to last, while #418 and #419 tie at 1. That residual tie (including the fact that a blocked candidate is not demoted by ranking — #419 is itself blocked by #418, yet ties with it) is left to the batch-emitter sub-issue's chain-aware ordering. Had the fetch failed instead, `findUnresolvedDependencyProse` flags all three (prose mention, empty resolution) and case (b) replaces the headline with the unreliable-ranking statement.

Render the top result (and up to 2 runners-up) as a short "Recommended next" callout above the funnel header, with a one-line rationale derived from which tie-break criterion decided it (e.g. "highest priority, unblocks 2 other records" or "smallest size among same-priority candidates with no file overlap") — except when the dependency-mismatch detection above fired: flagged candidates get no mechanical recommendation, and the headline follows the headline-replacement rule (corrected pick, or the case-(b) unreliable-ranking statement) instead. This section is scoped specifically to *which backlog/ready record deserves attention next* — it does not attempt to replace `/help`'s whole-pipeline status/recommendation role. At precedence level 1 (non-empty `needsYou`, see the Needs-you section's Precedence below), the report's closing `Next:` line and the Next Actions block's recommended line deliberately name the needs-you item instead — this callout stays the build-candidate recommendation regardless, since the two answer different questions (what to build vs. what needs a human decision first).

## Step 4: Batch emitter (bare mode)

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line.)*

Bare mode only — lens runs end at their own table (Step 2) and never reach this step.

**Input precondition:** the dispatch-block candidate set is `funnelBuckets`'s `dispatchable` ∪
`granted` (Step 2's `.funnel` — already filtered; `needs:definition` records are excluded here by
rule (below) — until #471's redirect gate ships, `/claude-tweaks:specify` can still stamp `ready`
on one, so the structural guarantee does not yet hold; the Shape block's own human-owed filtering is the
Shape-block exclusion rule below). The Shape block's population is the `scored` bucket (records shaped next);
the Score line's count is the `captured` bucket.

Compute the batch's graph structure, transitive payout, and file-overlap groups in one pass,
reusing Step 3's candidate set — first with the dependency-mismatch-flagged ids (Step 3's `flags`)
removed. A flagged record's graph data is unreliable by construction (that unreliability is exactly
what triggered the flag), so it must never form a chain; any other candidate that lists a flagged id
as a blocker simply loses that edge once the flagged id is filtered out, and ranks as an independent
unless another in-set edge remains. Rule (e) below renders the flagged records themselves, verbatim,
from the `flags` list — they never re-enter here. The same filtered candidate set also emits the
out-of-set-blocked list (`outOfSetBlocked`) so the "Out-of-set-blocked granted records" rule can read
it directly instead of re-deriving membership ad hoc at render time:

```bash
node -e "
  const { buildChains, transitiveUnblocksCount, blockersOf } = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/ranking.js');
  const { groupByFileOverlap } = require(process.env.CLAUDE_PLUGIN_ROOT + '/bin/lib/issues/grouping.js');
  const flags = require('/tmp/backlog-overview-ranked.json').flags.map((f) => f.id);
  const candidates = require('/tmp/backlog-overview-candidates.json').filter((c) => !flags.includes(c.id));
  const candidateIds = new Set(candidates.map((c) => c.id));
  console.log(JSON.stringify({
    graph: buildChains(candidates),
    payout: Object.fromEntries(transitiveUnblocksCount(candidates)),
    overlapGroups: groupByFileOverlap(candidates.map((c) => ({ id: c.id, keyFiles: c.keyFiles || [] }))),
    outOfSetBlocked: candidates.filter((c) => blockersOf(c).some((b) => !candidateIds.has(b))).map((c) => c.id),
  }));
" > /tmp/backlog-overview-emitter.json
```

Note: `payout` keys are strings after `Object.fromEntries` (plain JS object keys are always
strings) while `graph`'s chain/independent/cycle ids stay numbers — coerce before comparing or
joining the two.

**Ordering rule:** one combined ranking over dependency components and independents alike — sort
key: the component head's `transitiveUnblocksCount` descending, then the head's priority, then the
head's size, ties by id. The component head is the linearized chain's first element (an
independent is its own head, usually with `transitiveUnblocksCount` 0); residual ties among
components resolve on the head's priority/size, never another member's. No
chains-first-then-independents grouping.

**Render:** one fenced paste block per funnel stage that has members, exactly these templates:

```
── Score the rest ──
# {captured-count} records missing risk/size
/claude-tweaks:backlog refine
```

```
── Shape next ──
# Terminal 1 — priority:{tier} — {one-line hook}
/claude-tweaks:specify #{N}
# Terminal 2 — priority:{tier} — {one-line hook}
/claude-tweaks:specify #{M}
# #{N} excluded — needs:definition: yours to decide (see Needs you below)
```

The exclusion line is one line per matching record — absent entirely when none match. `needs:definition` is LIVE (both drivers parse `facets.needsDefinition` since upstream's v6.85.0 taxonomy landed), so this line renders on any repo carrying matching records; it is independent of the unjustified-annotation line below (both are live; see below). It attaches immediately above the Shape block's command lines and applies in ANY paste block a matching record appears in.

```
── Dispatch now ──
# Terminal 1 — chain: #A ─▶ #B ─▶ #C (head unblocks {n})
/claude-tweaks:flow #A,#B,#C
# Terminal 2 — independent
/claude-tweaks:flow #D
# ⚠ #{N} solution:unjustified — one-line evidence call pending
# Terminal {k} — serialized: #A, #B (file overlap: {files})
/claude-tweaks:flow #A,#B
```

The unjustified-annotation line is likewise one line per matching record, absent entirely when none match — `solutionUnjustified` is live on both drivers since #677 renamed `framing:baked` → `solution:unjustified` (the exclusion line above is independently live for `needs:definition`) — it attaches immediately above the command line it annotates, and applies in ANY paste block a matching record appears in (a `solutionUnjustified` record keeps its primary funnel bucket, so it can surface in Shape or Dispatch alike).

Prose rules: the Score line's count is comment-only (`refine` has no count flag); Shape lines are
priority-ordered, one record per terminal; a chain emits as **one** multi-ref
`/claude-tweaks:flow #A,#B,#C` command listing every member in dependency order (one command per
chain, never head-only — flow's multi-ref form runs them as a sequential pipeline); independents
get their own terminals with plain `/claude-tweaks:flow #N`; a file-overlap group merged across
components/independents (per the Overlap serialization integrity rule below) emits as the third
comment form, `# Terminal {k} — serialized: #A, #B (file overlap: {files})`, with the members'
internal order following the combined ranked order and the merged terminal's own rank key taken
from its highest-ranked member. All commands fully qualified. The `─▶` arrows in a chain comment
show execution order, not necessarily a direct dependency edge — a linearized diamond serializes
siblings that have no edge between them.

**Sanitize interpolated record text.** Every record-derived value rendered into a paste block
(`{one-line hook}`, `{files}`, any future field) is flattened to a single line before rendering:
strip newlines, carriage returns, and control characters, and truncate to one comment line — a
`#`-comment never spans lines, so untrusted record content can never escape the comment into an
executable line. Record ids and priority tiers are re-emitted from parsed facets (`#{number}`,
`priority:{tier}`), never copied as raw text.

**Batch integrity rules:** the emitter's exclusion rules operate on populations `funnelBuckets`
already partitioned — the rules below name where each excluded population surfaces, they never
re-derive membership.

- **Shape-block exclusion** — the excluded population is the `scored`-bucket records carrying
  `needsDefinition === true` (`funnelBuckets`'s `needsYou` overlay, kind `definition`). Each is
  excluded from the Shape block's terminals with the `# #{N} excluded — needs:definition: yours to
  decide (see Needs you below)` comment line (Step 4's Shape template above) — never a bare
  `/claude-tweaks:specify #{N}` command, since deciding whether the record needs definition is the
  human's call, not the agent's; counted under rule (c) and surfaced again, with fuller context, in
  the Needs you lane below.
- **(a) Overlap serialization** — scoped to the Dispatch block only (Shape-block records are
  unshaped and carry no `### Key Files`, so file-overlap grouping doesn't apply there). Records
  `groupByFileOverlap` groups together never appear in different concurrent terminal blocks.
  Deciding criterion: members of the same dependency component are already serialized in one
  terminal by construction; a file-overlap group spanning different components/independents
  serializes them into one terminal when they are few (≤3 combined); when a cross-component
  file-overlap group exceeds 3 combined members, only the single top-ranked member stays
  executable — every other member of the group is excluded, each with its own `#`-comment naming
  the conflict (the invariant "overlapping records never appear in different concurrent terminal
  blocks" must hold for any group size, not just the ≤3 case). Group membership is transitive —
  treat membership, not pairwise overlap, as the signal.
- **(b) Claim exclusion** — the excluded population is `.funnel.inFlight` (Step 2's
  `/tmp/backlog-overview-views.json` output — the records `funnelBuckets` already partitioned out
  of the buildable subset by the `bot:in-progress` facet; claim blobs on the claims-registry
  branch are not read by this report). Each excluded record gets one `#`-comment reason (e.g.
  `# #472 skipped — bot:in-progress`), already counted in the funnel's `in flight` stage. The
  claim snapshot is read-only and may go stale between render and paste; that staleness is
  accepted risk, resolved downstream by `/claude-tweaks:dispatch`/`/claude-tweaks:flow`'s own
  claim-taking at execution time — never read this scan as a completeness guarantee, and never
  instruct taking a claim from this report.
- **(c) No silent caps** — anything excluded or truncated is named with a count.
- **(d) No terminal cap** — blocks emit in ranked order; the human takes the top *k*.
- **(e) Flagged records** — records flagged by the dependency-mismatch detection (Step 3's
  `flags`) render as plain independents: no `─▶` arrows, own terminal, with a `#`-comment naming
  the suppressed chain and pointing at `/claude-tweaks:backlog refine`'s dependency repair — never
  silently dropped (dropping would violate rule (c) above).
- **Out-of-set-blocked granted records** — a `granted`-bucket candidate whose id appears in the
  compute block's `outOfSetBlocked` list (already computed above via `blockersOf` — never
  re-derived ad hoc at render time) is definitionally blocked — its blocker is unshaped or
  ungranted, not yet part of this batch. It still renders in the Dispatch block, but as a
  `#`-comment naming the out-of-set blocker and its funnel stage (e.g. `# #521 waiting — blocked by
  #518 (shaped, ungranted)`), never a bare paste-ready command; counted under rule (c). This is what
  keeps #513's header promise (the granted stage's "no pointer — waiting on blockers; the blocker
  itself appears in the dispatch hand-off").
  **Chain vs out-of-set precedence:** when a chain member (not a bare independent) is
  out-of-set-blocked, this rule wins over the chain's normal one-command rendering for that member
  and everything after it in the linearized order — later members depend (directly or
  transitively) on the blocked one, so they cannot run either. The chain's executable
  `/claude-tweaks:flow #A,#B,...` command covers only the topological prefix BEFORE the first
  out-of-set-blocked member; that member and every member after it render as comment-only lines
  each naming the out-of-set blocker, per this rule, instead of joining the executable command. When
  the out-of-set-blocked member is the chain's head (an empty prefix), the whole terminal renders
  comment-only — no executable command for that terminal at all.
- **Cyclic components** — a dependency component `buildChains` returns under `cycles` (never
  partially placed in `chains`) renders as a named `#`-comment block listing every id in the
  component, with a pointer to `/claude-tweaks:backlog refine`'s dependency repair; counted under
  rule (c). A stalled component absorbs its acyclic members too — the whole component is named
  there, never silently dropped into a working terminal.
- **Unsynced records** — `unsynced: true` fallback records never render as `#N` paste commands
  (their ids are local-namespace, not GitHub refs); they are excluded from every paste block with
  one `#`-comment naming the sync gap, counted under rule (c).
- **`needs:definition` records** — a candidate whose `facets.needsDefinition` is true never
  renders an executable command in ANY paste block, whatever bucket it reached — until #471's
  redirect gate ships, `/claude-tweaks:specify` can still stamp `ready` on one, so this
  render-level exclusion is the guard. It renders one `#`-comment
  (`# #{N} excluded — needs:definition: yours to decide (see Needs you below)`, the same format
  the Shape block uses), is counted per rule (c), is skipped when determining the top-ranked
  executable entry, and its Needs-you lane row is where it surfaces for action.

### Needs you (human lane)

Rendered **last before Next Actions**, only when `funnelBuckets`' `needsYou` is non-empty. These are records the batch emitter structurally cannot schedule — the funnel's bottleneck; paste blocks send agents to work, this lane is work only the human can do.

One line per record with an interactive launcher, fully qualified:
- `kind: 'definition'` → `/claude-tweaks:specify #{N}` with a `#`-comment naming the label, waiting-age, and what deciding it releases (e.g. `# needs:definition — waiting {age}; deciding releases {n} records`, or `# needs:definition — waiting {age}; deciding releases nothing tracked` when the count is zero or was skipped — the fallback rule from the Ordering + inputs paragraph above, never a literal `undefined` or `{k}`)
- `kind: 'unjustified'` → `/claude-tweaks:challenge #{N}` (the evidence-or-accept-risk mode — reads the record's `## Gotchas` assumptions, runs a bounded in-repo evidence search, and offers supply-evidence / accept-risk / leave in one call; either resolving choice clears the label) with a `#`-comment naming the one-line call (e.g. `# solution:unjustified — one-line evidence-or-accept-risk call`)
- `unsynced: true` needs-you records never render a `#{N}` launcher (local-namespace ids) — they render one `#`-comment naming the sync gap and pointing at `/claude-tweaks:tidy`, still counted in the branch-line total.

**Ordering + inputs:** `needsYou` stays `{id, kind}` from `funnelBuckets`; the render joins each id back to the faceted record set for `facets.priority` and `createdAt` (already in the overview fetch). Primary sort is priority (high first), then age (oldest first), ties by id — matching the emitter's own convention. Releases-count is an **advisory annotation** on each row, not a sort key — it is computed directly, never sourced from `transitiveUnblocksCount` (that Map is keyed by emitter-candidate id only, and a needs-you record structurally never appears as one of those keys, so a lookup against it can never resolve for this lane; the helper remains the emitter's own chain-payout tool, unchanged in Step 4). The direct computation: one `node -e` pass importing `blockersOf` from `ranking.js`, run over the full faceted set at `/tmp/backlog-overview-faceted.json` (the carrier — the whole open set, not the emitter's filtered candidate subset) — count how many OPEN records in that set resolve the needs-you record's id via `blockersOf`. When that count is zero, or the computation was skipped, render `deciding releases nothing tracked` in place of a number — never a literal `undefined` or a dangling placeholder. This priority-then-age ordering deliberately deviates from the original spec's releases-first ordering: releases is demoted to an advisory annotation, never the sort key, because the count is partial by construction (needs-you records get no blocker attachment and their dependents are mostly outside the buildable set) — the deviation is flagged here in the text, not left implicit in run artifacts alone.

**Cap + pointer:** at most 3 rows named; beyond that, one pointer line: `{M} more human-owed records → /claude-tweaks:backlog attention (when available)` — advisory until that mode ships (#471's decomposition), count always shown. Interim-launcher honesty note, citing #471: until #471's redirect gate ships, `/claude-tweaks:specify #{N}` on a `needs:definition` record still lands in ordinary shaping mode — acceptable interim (the human is present either way); this caveat is removed by #471's own landing.

Needs you stays the last **rendered** section of the report body — the section below is
document-level, not a continuation of this lane.

### Two-channel contract and the Next: line

**Two-channel contract + `Next:` line:** paste blocks carry agent-executable/unattended commands
only; the Next Actions close-out block carries this-session moves only (run refine here, open a
lens, dispatch the top chain here) and is never the delivery channel for other-terminal command
lists — terminal-command lists inside the close-out block are forbidden. The report body ends with a
single `Next:` line: one sentence naming the top-ranked action, always exactly one.

**Precedence (3-level):**
1. When `needsYou` is non-empty → the `Next:` line names the top Needs-you item (per the section's ordering), recomputed fresh every run — no session state, no stored binding.
2. Otherwise → the top-ranked **executable** Dispatch entry — comment-only entries (out-of-set-blocked, cyclic, unsynced, flagged, overlap-excluded) are skipped when determining it (promise F2).
3. When the Dispatch block contains **no executable entry** (empty, or comment-only entries throughout) → the existing fallback ladder (grant → specify → refine, ties by id; `Next: backlog is empty` terminal case).

The close-out block's recommended line MUST match the `Next:` line at every precedence level — unchanged rule, now with a well-defined referent at each level.
