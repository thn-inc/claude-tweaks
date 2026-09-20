// bin/lib/issues/backlog.js
// Mechanical filter/sort/split/merge logic for /claude-tweaks:backlog's
// overview mode (scored records, unlimited scale — critical/risk-value/cleanup
// lenses, plus funnelBuckets powering overview's bare-mode funnel decision
// surface over the whole open queue) and refine mode's bounded LLM synthesis
// pass over unscored records. `selectBudgetSlice` also bounds refine mode's
// grant-check pass over ready+ungranted records — it's population-agnostic, just an oldest-first
// slice with a `remaining` count. Records are expected to already carry
// `.facets` (via record.js's parseRecordFacets or local-store.js's
// readRecord/queryRecords) and, where sorting depends on it, a `.createdAt` ISO
// string. Every function except `deriveCreatedAtFromGit` is pure — no network, no
// fs — mirroring record.js's purity contract; `deriveCreatedAtFromGit` is the one
// deliberate exception (it shells out to `git log`), with its side effect isolated
// behind an injectable `execFn` so callers (and tests) don't have to touch a real
// git repo to exercise it.
'use strict';

const { execSync } = require('child_process');
const { LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');
const { PRIORITIES, TIERS, parseRecordFacets } = require('./record');
const { blockersOf } = require('./ranking');
const { evaluateGrantGate } = require('./grant-gate');
const { isBotParked } = require('./record-buckets');

// Urgency order shared by both bands (high first). Values are validated
// against record.js's canonical PRIORITIES/TIERS vocabulary before this
// lookup — local-store.js's frontmatter parser accepts priority:/risk:
// values verbatim with no enum check, so a hand-edited or future-taxonomy
// record can carry an out-of-vocabulary value; treating that like the null/
// absent case (band 3) instead of looking it up unconditionally avoids an
// `undefined - 0 = NaN` comparator silently corrupting sort order.
const RANK = { high: 0, medium: 1, low: 2 };
const bandOf = (r) => (r.facets.priority && PRIORITIES.includes(r.facets.priority) ? RANK[r.facets.priority] : 3);
const riskBandOf = (r) => (r.facets.risk && TIERS.includes(r.facets.risk) ? RANK[r.facets.risk] : 3);
const byCreatedAtAsc = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
// The sort both single-axis lenses (filterCritical, filterCleanup) use once
// they've filtered: priority band first, then oldest-createdAt-first.
const byPriorityThenAge = (a, b) => bandOf(a) - bandOf(b) || byCreatedAtAsc(a, b);

// records[] -> { scored: records[], unscored: records[] }. Scored = carries both
// risk:* and size:* (the two labels /specify's shaping and the health skills'
// born-ready filing always stamp together). Order within each bucket is preserved
// from the input array — callers sort afterward per mode.
function splitScoredUnscored(records) {
  const scored = [];
  const unscored = [];
  for (const r of records) {
    if (r.facets.risk && r.facets.size) scored.push(r);
    else unscored.push(r);
  }
  return { scored, unscored };
}

// records[] -> records[] filtered to risk:high, sorted by priority band then
// oldest-createdAt-first. Only scored records ever carry risk:*, so this is safe
// to call on a mixed scored+unscored array directly.
function filterCritical(records) {
  return records.filter((r) => r.facets.risk === 'high').sort(byPriorityThenAge);
}

// records[] -> { ranked: records[], unscored: records[] }. ranked is the scored
// bucket sorted by priority band, then risk band (both high-first), then
// oldest-createdAt-first; unscored is the trailing "not yet scored" group,
// oldest-first for the same staleness-first bias.
function rankRiskValue(records) {
  const { scored, unscored } = splitScoredUnscored(records);
  const ranked = scored
    .slice()
    .sort((a, b) => bandOf(a) - bandOf(b) || riskBandOf(a) - riskBandOf(b) || byCreatedAtAsc(a, b));
  return { ranked, unscored: unscored.slice().sort(byCreatedAtAsc) };
}

// records[] -> records[] filtered to size:low, sorted by priority band then
// oldest-createdAt-first.
function filterCleanup(records) {
  return records.filter((r) => r.facets.size === 'low').sort(byPriorityThenAge);
}

// (unscored records[], budget) -> { selected: records[], remaining: number }.
// Oldest-createdAt-first — surfaces the longest-neglected records first, same
// staleness bias /tidy already uses. No silent truncation: `remaining` is exactly
// how many unscored records this pass didn't read.
function selectBudgetSlice(unscored, budget) {
  const sorted = unscored.slice().sort(byCreatedAtAsc);
  return {
    selected: sorted.slice(0, budget),
    remaining: Math.max(0, sorted.length - budget),
  };
}

// (githubRecords[], unsyncedRecords[]) -> records[]. Concatenates both, tagging
// every record's facets.unsynced explicitly (record.js's parseRecordFacets never
// sets this key at all; local-store.js's facets already carry it truthfully).
// GitHub records come first, preserving their original relative order; unsynced
// records follow, also in their original relative order.
function mergeUnsyncedRecords(githubRecords, unsyncedRecords) {
  const tag = (r, unsynced) => ({ ...r, facets: { ...r.facets, unsynced } });
  return [
    ...githubRecords.map((r) => tag(r, !!r.facets.unsynced)),
    ...unsyncedRecords.map((r) => tag(r, true)),
  ];
}

// Sentinel byte prefixing each commit's date line in the batched `git log`
// output below — a control character that can never appear at the START of
// a real relative file path, so it unambiguously distinguishes "this line is
// a commit-date marker" from "this line is a filename" without relying on
// git's own (format-dependent, easy to mis-parse) blank-line conventions.
const COMMIT_DATE_MARKER = '\x01';

// (records[], { execFn? }) -> records[]. Derives `createdAt` for every record
// from its own last-commit date — used for records whose driver carries no
// timestamp facet (local-files backend, and any unsynced-fallback record),
// the same approach /tidy's Step 1 staleness clock already uses. Resolves
// every record from a SINGLE `git log --name-only` walk of the whole
// repository history (newest commit first, git log's default order) instead
// of one `git log -1 -- <path>` subprocess per record: for each path, the
// FIRST commit encountered while walking newest-to-oldest is by construction
// the most recent commit touching it, so a single pass building a
// path->date map answers every record's lookup. A record whose path never
// appears in that map (git failure — no history, not a git repo — or a path
// with no commits yet) falls back to the current time, matching the two
// duplicated inline scripts this replaces (skills/backlog/overview-mode.md's
// Step 1). `execFn` defaults to `child_process.execSync` and is injectable so
// tests never need a real git repo.
function deriveCreatedAtFromGit(records, { execFn = execSync } = {}) {
  if (records.length === 0) return [];

  const dateByPath = {};
  try {
    const out = execFn(`git log --name-only --format=${COMMIT_DATE_MARKER}%cI`, {
      encoding: 'utf8',
      maxBuffer: LARGE_MAX_BUFFER_BYTES,
    });
    let currentDate = null;
    for (const rawLine of out.split('\n')) {
      if (rawLine.startsWith(COMMIT_DATE_MARKER)) {
        currentDate = rawLine.slice(COMMIT_DATE_MARKER.length);
        continue;
      }
      const p = rawLine.trim();
      if (p !== '' && currentDate && !(p in dateByPath)) dateByPath[p] = currentDate;
    }
  } catch {
    // Degrade to every record falling back to now() below — same contract
    // as the previous per-record implementation's catch branch.
  }

  return records.map((r) => ({ ...r, createdAt: dateByPath[r.path] || new Date().toISOString() }));
}

// records[] -> the ready+granted subset only — the exact candidate set
// overview-mode.md Step 2's native blockedBy pre-attach fetch must target
// (refs #563). NOT the same as Step 3's buildable subset (dispatchable ∪
// granted) — this runs BEFORE funnelBuckets has produced those buckets, so
// "granted" here is computed independently of the in-set-blockers split
// that native resolution is meant to correct. It also doesn't exclude
// `isParentIssue` records, which funnelBuckets routes to `parents` rather than
// `granted`/`dispatchable` — harmless, since a parent is never `ready`
// (`_shared/work-record.md`'s Decomposition rules), so this stays the
// buildable candidate set on any conforming repo.
function readyGrantedSubset(records) {
  return records.filter((r) => r.facets.stage === 'ready' && (r.facets.grants.build || r.facets.grants.merge));
}

// records[] -> { captured, prioritized, specified, granted, dispatchable,
// inFlight, botParked, parked, notPlanned, parents, needsYou }. The ten stage
// keys (captured..parents) are mutually exclusive buckets over the post-merge
// faceted set (github + unsynced); needsYou is a separate overlay, not a
// bucket — see the overlay loop's comment below. Together they form the funnel
// decision surface /claude-tweaks:backlog overview's bare mode renders. First
// match wins, in this order for the ten stage keys; the precedence
// rationale: bot-state outranks stage labels because live work reflects current
// reality (a record simultaneously bot:in-progress and parked/ready resolves
// toward what is actually happening right now), and granted is checked before
// dispatchable so a blocked grant can never render as go-now. `botParked`
// (the merge-verification-gate `bot:parked` facet, distinct from the
// workflow-stage `parked` bucket below) sits at the same bot-state tier as
// `inFlight` — a parked record keeps its `auto:*` grants intact, but must
// never render as buildable via `granted`/`dispatchable` while parked. Blocker
// resolution — including the unsynced-namespace short-circuit (parent #512
// promise F1) — is delegated to ranking.js's `blockersOf`, the single owner
// of precedence (unsynced → top-level `r.blockedBy` → `facets.blockedBy` →
// body-text `parseDependencies` fallback), shared with rankNextToBuild so
// both consumers agree on the same blocker for the same record (refs #514).
// Only ids within the open input set count as blockers, since an out-of-set
// blocker cannot be acted on from this report. `prioritized` keys on
// f.priority ALONE — priority is refine's triage verdict, and the stage is
// named for it. A record carrying only risk/size with no priority and no
// `ready` stage is an anomaly (specify stamps risk/size and `ready` in one
// atomic write, so its records never land here), and it falls to `captured`
// so the funnel re-points it at refine rather than parking it in a stage
// whose name it doesn't satisfy. Distinct from splitScoredUnscored, whose
// `scored` means risk AND size — the lens views' "enough signal to rank on".
function funnelBuckets(records) {
  const buckets = {
    captured: [], prioritized: [], specified: [], granted: [],
    dispatchable: [], inFlight: [], botParked: [], parked: [], notPlanned: [], parents: [],
  };
  const openIds = new Set(records.map((r) => r.number ?? r.id).filter((n) => n != null));
  for (const r of records) {
    const f = r.facets;
    const granted = f.grants.build || f.grants.merge;
    // Blocker precedence, INCLUDING the unsynced-namespace short-circuit, is
    // owned by ranking.js's blockersOf — one decision, shared with
    // rankNextToBuild (refs #514).
    const inSetBlockers = blockersOf(r).filter((id) => openIds.has(id));
    if (f.bot.inProgress) buckets.inFlight.push(r);
    else if (isBotParked(r)) buckets.botParked.push(r);
    else if (f.stage === 'parked') buckets.parked.push(r);
    else if (f.notPlanned) buckets.notPlanned.push(r);
    else if (f.isParentIssue) buckets.parents.push(r);
    else if (f.stage === 'ready' && granted && inSetBlockers.length > 0) buckets.granted.push(r);
    else if (f.stage === 'ready' && granted) buckets.dispatchable.push(r);
    else if (f.stage === 'ready') buckets.specified.push(r);
    else if (f.priority) buckets.prioritized.push(r);
    else buckets.captured.push(r);
  }
  // needsYou is an OVERLAY, never an eleventh stage: every record above keeps its
  // one primary bucket (exclusivity and sum-to-total invariants untouched).
  // Both needs-facets are LIVE on both drivers (record.js for github-issues,
  // local-store.js for local-files): needsDefinition since the needs:definition
  // taxonomy shipped, solutionUnjustified since record #677 renamed
  // framing:baked -> solution:unjustified. A record carrying both facets yields
  // one entry with kind 'definition' — the hard gate dominates. needs:definition
  // exclusion from the Specify paste block happens at RENDER, never here.
  const needsYou = [];
  for (const r of records) {
    const f = r.facets;
    // The human lane covers records still in play — a bot is actively
    // building an inFlight record, and parked/not-planned records are
    // /tidy's domain; surfacing them as the session's recommended move would
    // invert the lane's premise. A decomposition parent is skipped too: it
    // routes to the `parents` bucket above, never `dispatchable`, and its
    // needs-you launcher would misroute to `/specify #N` on a parent
    // (#616's defect class, reappearing on this overlay surface — #766).
    // Skip before the facet checks below.
    if (f.bot.inProgress || f.stage === 'parked' || f.notPlanned === true || f.isParentIssue) continue;
    const id = r.number ?? r.id;
    if (f.needsDefinition === true) needsYou.push({ id, kind: 'definition' });
    else if (f.solutionUnjustified === true) needsYou.push({ id, kind: 'unjustified' });
  }
  buckets.needsYou = needsYou;
  return buckets;
}

// (specifiedRecords, policy, trustRowsArray) -> the machine-grant outlook
// overview's bare mode renders as the `specified` stage's config-aware
// annotation. When `policy.ceiling === 'unattended' && policy.
// grantOriginationEnabled === true`, a human-filed record (facets.origin
// null/undefined) is pre-filtered OUT before the gate chain runs at all —
// mirroring refine-headless.md's own Step 1 "cheap pre-pass on the same gate-3
// condition" (skills/backlog/refine-headless.md), itself only reached once that
// mode's own Step 0 ceiling/opt-in gate has passed (see the caller
// precondition documented at the top of machine-grant-outlook.md) — so a
// human-filed record is never counted under refused here, exactly as
// the grant chain's own candidate fetch drops it before the chain. Origin is the
// only axis this pre-filter aligns: funnelBuckets routes a ready, ungranted
// record into `specified` regardless of open blockers, while the grant chain's
// Step 1 candidate fetch drops blocked records — so `eligible` can still
// exceed the grant chain's candidate count by that blocked population.
// Without the pre-filter, a human-filed record whose class trust
// ALSO happens to be non-clean gets misattributed to refused.trust by
// evaluateGrantGate's gate order (gate 2 runs before gate 3, so gate
// 3/origin never individually fires for it) even though the grant chain's own
// candidate fetch would never have considered it in the first place — this
// was #1387's reported discrepancy between overview's reported refusal
// counts and the grant chain's own candidate-set size for the same backlog
// state. Excluded records are counted via `excludedOrigin` rather than
// folded into `refused`, so a reader can reconcile the funnel header's
// `specified N` total against `eligible.length + refused-total +
// excludedOrigin`. Outside that policy shape, every record — human- and
// agent-filed alike — is refused under `ceiling` or
// `grant-origination-opt-in` before gates 2/3 ever run, so the
// misattribution bug structurally cannot occur there; this call falls back
// to running evaluateGrantGate for every record with no pre-filter at all,
// exactly preserving pre-fix behavior for that policy shape (`excludedOrigin`
// stays 0). When the pre-filter is active, this runs evaluateGrantGate's
// FIRST PHASE only (gates 1-3 — ceiling, opt-in, needs:definition, class
// trust — gate 3/origin is now structurally unreachable inside this call,
// since the pre-filter already removed every record it would have refused):
// gate 4's grant-check is an LLM judgment overview must never run, per its
// "entirely mechanical" contract. So `eligible` means "will reach the grant
// unit's own grant-check on a future firing", never "will be granted" —
// gates 4-5 can still refuse. policy is evaluateGrantGate's own policy shape
// ({ ceiling, grantOriginationEnabled } suffices for phase 1);
// trustRowsArray is trustRows() output (bin/lib/issues/trust.js), keyed into
// the Map shape the gate expects. Returns { eligible: [ids], refused:
// { [failedKey]: [ids] }, excludedOrigin: count }, ids in input order.
function machineGrantOutlook(records, policy, trustRowsArray) {
  const rows = Array.isArray(trustRowsArray) ? trustRowsArray : [];
  const trustVerdicts = new Map(rows.map((row) => [row.key, row]));
  const eligible = [];
  const refused = {};
  let excludedOrigin = 0;
  const applyOriginPrefilter =
    policy && policy.ceiling === 'unattended' && policy.grantOriginationEnabled === true;
  for (const r of records) {
    const id = r.number ?? r.id;
    const facets = r.facets || parseRecordFacets(r.labels);
    if (applyOriginPrefilter && (facets.origin === null || facets.origin === undefined)) {
      excludedOrigin += 1;
      continue;
    }
    const result = evaluateGrantGate({
      record: { number: id, labels: r.labels, body: r.body, facets },
      policy,
      trustVerdicts,
    });
    if (result.needsGrantCheck === true) {
      eligible.push(id);
    } else {
      (refused[result.failedKey] = refused[result.failedKey] || []).push(id);
    }
  }
  return { eligible, refused, excludedOrigin };
}

// ({ allRows, readyRows, priorityBudget, grantBudget }) -> the refine sweep's
// mechanical prelude in one pass. allRows = the merged faceted open set;
// readyRows = the grant fetch's rows, already origin-filtered by the caller —
// defaults to [] for work-backend: local-files, where the grant fetch never
// runs (Preflight skips it), so fresh/blocked/inProgress and grantSlice.selected
// all come back empty while missingPriority/missingRiskSize/prioritySlice still
// compute from allRows. prioritySlice keys on missingPriority — the population
// Step 2's sweep actually stamps (refs #460); grantSlice keys on fresh, unchanged.
function refineWorklist({ allRows, readyRows = [], priorityBudget, grantBudget }) {
  const worklist = readyRows.filter((r) => !r.facets.grants.build && !r.facets.grants.merge);
  const blocked = worklist.filter((r) => r.facets.bot.blocked);
  const inProgress = worklist.filter((r) => !r.facets.bot.blocked && r.facets.bot.inProgress);
  const fresh = worklist.filter((r) => !r.facets.bot.blocked && !r.facets.bot.inProgress);
  const missingPriority = allRows.filter((r) => r.facets.priority == null);
  const missingRiskSize = allRows.filter((r) => !(r.facets.risk && r.facets.size));
  return {
    fresh,
    blocked,
    inProgress,
    missingPriority,
    missingRiskSize,
    prioritySlice: selectBudgetSlice(missingPriority, priorityBudget),
    grantSlice: selectBudgetSlice(fresh, grantBudget),
    counts: {
      fresh: fresh.length,
      blocked: blocked.length,
      inProgress: inProgress.length,
      missingPriority: missingPriority.length,
      missingRiskSize: missingRiskSize.length,
    },
  };
}

module.exports = {
  splitScoredUnscored,
  filterCritical,
  rankRiskValue,
  filterCleanup,
  selectBudgetSlice,
  mergeUnsyncedRecords,
  deriveCreatedAtFromGit,
  funnelBuckets,
  machineGrantOutlook,
  readyGrantedSubset,
  refineWorklist,
};
