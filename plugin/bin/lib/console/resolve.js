// plugin/bin/lib/console/resolve.js — one-process resolution of an
// `unattended` Review Console (#1932). Pure through `deps`: reads the run
// dir's decisions.md, staged/ items, engine-state.json, the fact pack's
// member list, and member grants via an injected reader, into ONE snapshot,
// then maps each item to the stance `wrap-up/review-console.md`'s
// "Auto-resolution short-circuit" states. Computes the merge half; never
// executes it. The CLI (bin/console-resolve.js) owns every write.
'use strict';

const path = require('path');
const { evaluateMaturation } = require('../issues/grant-maturation');
const { resolveRecords } = require('../wrap-up/pack');
const { DEFER_REASONS } = require('../issues/record');

// Section names exactly as the console renders them (console-template.md;
// engine-render.js's SECTION_SPECS for the five curation sections).
const SECTIONS = {
  AUTO: 'Auto-applied',
  PENDING: 'Pending review',
  LOW: 'Low-confidence findings',
  CONTESTED: 'Contested findings',
  SKILL: 'Skill updates',
  DOC: 'Documentation updates',
  JOURNEY: 'Journey updates',
  CONFIG: 'Configuration updates',
  REF: 'Reference repairs',
  CLEANUP: 'Cleanup actions',
  QUEUE: 'Queue writes',
  MEMORY: 'Memory updates',
  UPSTREAM: 'Upstream feedback',
  INSIGHTS: 'Reflection insights',
  REFUSED: 'Refused — no defer reason',
};

// Ordered: first match wins. Keyed on the staged file's id prefix — the
// `--id <kind>-<n>` stage-item.js wrote, or the filename a skill names.
// Verified against every `staged/…` prefix the skill corpus names (#1932
// plan, decision 6). An unknown prefix is NOT in this table on purpose:
// classifyStagedItem maps it to Pending review with reason 'unmapped-prefix'
// so a new producer can never slip past the console. A row's optional third
// element is a classification reason: a matched item carrying one resolves to
// `pending` regardless of its section's stance.
//
// A sweep-shadow collision copy — `bin/lib/hooks/sweep-shadow.js` names them
// `{preferred}.shadow-dup` / `{preferred}.shadow-dup-{n}` — is handled before
// this table is ever consulted (see SHADOW_DUP_RE below), not as a row here:
// classifying it needs the anchor file's own content, which no other row
// needs and which this table has no way to carry.
const SECTION_MAP = [
  [/^review-unconfirmed-/, SECTIONS.LOW],
  [/^review-(contested|debate)-/, SECTIONS.CONTESTED],
  [/\.patch$/, SECTIONS.PENDING],
  [/^(polish-suggestion|visual-review|design-decision|build-deviation|simplify|deepen|sdd-ruling)-/, SECTIONS.PENDING],
  // sibling-premise-disproof- (#3488): bin/materialize.js stages it as a note for a
  // human to read, not a change to apply — so it resolves pending.
  [/^sibling-premise-disproof-/, SECTIONS.PENDING, 'sibling-premise-disproof-note'],
  // plan-citation- (#3488): wrap-up/cleanup-procedures.md stages a kept-plan citation
  // proposal for a human to decide; the reason pins it pending so nothing auto-applies.
  [/^plan-citation-/, SECTIONS.PENDING, 'cited-plan-kept'],
  // translation- (#3488): flow/multi-spec.md stages a translated brief that the
  // consolidated console shows under "Translated briefs"; a human reads it, so it resolves pending.
  [/^translation-/, SECTIONS.PENDING, 'translated-brief'],
  [/^(wrap-up-skill|skills)(-|\b)/, SECTIONS.SKILL],
  // release-backfill- retired #2257 (git describe --contains replaced the
  // staged-backfill mechanism entirely — nothing stages that prefix anymore).
  [/^(wrap-up-doc|tidy-doc|docs)-/, SECTIONS.DOC],
  // wrap-up-claude-md-/wrap-up-adr- (#2773): the curation engine's `claude-md`
  // and `decision-records` registry rows (bin/lib/wrap-up/registry.js) stage
  // their proposals under these prefixes — claude-md-curation.md and
  // adr-curation.md name the exact filenames. Routes to the same
  // SECTIONS.CONFIG the engine-row path (ENGINE_ROW_SECTIONS below) already
  // uses for an `applied` finding from either registry row.
  [/^(wrap-up-claude-md|wrap-up-adr)-/, SECTIONS.CONFIG],
  [/^(wrap-up-journey|journeys)(-|\b)/, SECTIONS.JOURNEY],
  // premise-satisfied- (#3488): bin/materialize.js stages a proposal to close a record
  // whose premise check already passes; closing is a human call, so it resolves pending.
  [/^premise-satisfied-/, SECTIONS.QUEUE, 'premise-satisfied-close-proposal'],
  [/^(reflect|digest-promotion|leftover|ledger-record|upstream-unfiled|red-team|specify-overlap|specify-redteam|flaky-allowlist|tidy|plan-retention|feedback-drafts|review-followup|build-followup|reconcile-live-run-archived|wrap-up-cleanup-ordering)(-|\b)/, SECTIONS.QUEUE],
  [/^wrap-up-memory-/, SECTIONS.MEMORY],
  [/^wrap-up-upstream-/, SECTIONS.UPSTREAM],
  // upstream-draft- (#3488): feedback/upstream-draft.md's hand-off draft. The console
  // must never file it, so it resolves pending (a filed stance would auto-file it).
  [/^upstream-draft-/, SECTIONS.UPSTREAM, 'hand-off-draft'],
  // wrap-up-reflect- (#3926): reflect/full-mode.md's staged insights table
  // (wrap-up-reflect-insights.md). Its executor is review-console.md "On approval"
  // step 10, which applies each row's recommended destination (D4/D5 rows stay
  // informational), so it resolves without a human like every other section.
  [/^wrap-up-reflect-/, SECTIONS.INSIGHTS],
];

// One literal string per alternative of every non-`.patch` SECTION_MAP row,
// each with the trailing `-` its regex requires (a `(-|\b)` row still lists
// the `-` form). stage-item.js's unmapped-prefix warning (#3370) suggests the
// nearest of these. MUST list every alternative of every non-`.patch` row.
// resolve.test.js expands each row's regex source into its alternatives and
// fails when one is missing here; a new row shape its parser does not
// recognise fails loudly there too.
const CANONICAL_PREFIXES = [
  'review-unconfirmed-',
  'review-contested-', 'review-debate-',
  'polish-suggestion-', 'visual-review-', 'design-decision-', 'build-deviation-', 'simplify-', 'deepen-', 'sdd-ruling-',
  'sibling-premise-disproof-', 'plan-citation-', 'translation-',
  'wrap-up-skill-', 'skills-',
  'wrap-up-doc-', 'tidy-doc-', 'docs-',
  'wrap-up-claude-md-', 'wrap-up-adr-',
  'wrap-up-journey-', 'journeys-',
  'reflect-', 'digest-promotion-', 'leftover-', 'ledger-record-', 'upstream-unfiled-', 'red-team-',
  'specify-overlap-', 'specify-redteam-', 'flaky-allowlist-', 'tidy-', 'plan-retention-', 'feedback-drafts-',
  'review-followup-', 'build-followup-', 'reconcile-live-run-archived-', 'wrap-up-cleanup-ordering-',
  'premise-satisfied-',
  'wrap-up-memory-',
  'wrap-up-upstream-',
  'upstream-draft-',
  'wrap-up-reflect-',
];

// Staged-id prefixes whose run never reaches this console, so no SECTION_MAP row
// maps them and stage-item.js's unmapped-prefix warning skips them (#3488). Each
// entry is [pattern over the id without its extension, why the console never sees it].
// An id on this list must NOT also classify mapped (resolve.test.js pins the disjointness).
const STAGING_EXEMPTIONS = Object.freeze([
  [/^release-held(\.|$)/, "/claude-tweaks:release's standalone run dir; surfaced by release's own Step 4 console (release/console.md), never by wrap-up's console-resolve.js"],
  [/^dispatch-target-missing-/, "/claude-tweaks:dispatch's `*-dispatch-standalone` run dir (queue-pull-script.md); dispatch renders no Review Console"],
  [/^shipped-close-/, "the same dispatch-standalone firing run dir (queue-pull-script.md's #1984 shipped-candidate pass); no Review Console"],
  [/^dream-proposal-/, "harness-health's `*-dream-standalone` run dir (dream-pass.md); report-only, `report.md` is its surface"],
].map((entry) => Object.freeze(entry)));

// The exemption reason for a staged id (with or without its one trailing
// extension), or null when the id is not exempt.
function stagingExemption(id) {
  const stem = id.slice(0, id.length - path.extname(id).length);
  const hit = STAGING_EXEMPTIONS.find(([re]) => re.test(stem));
  return hit ? hit[1] : null;
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// The `n` canonical prefixes closest to the start of `id`: Levenshtein
// distance between the prefix and the same-length head of `id`, divided by the
// prefix length. Raw distance would rank 5-7 character prefixes (`tidy-`,
// `deepen-`) above a long prefix that shares a long stem with a typo'd id
// (`review-13-record` vs `review-debate-`). Ties keep CANONICAL_PREFIXES order.
function nearestCanonicalPrefixes(id, n = 3) {
  return CANONICAL_PREFIXES
    .map((prefix, i) => ({ prefix, i, d: levenshtein(prefix, id.slice(0, prefix.length)) / prefix.length }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .slice(0, n)
    .map((x) => x.prefix);
}

// `{preferred}.shadow-dup` / `{preferred}.shadow-dup-{n}` — bin/lib/hooks/
// sweep-shadow.js's name for a collision copy when the preferred destination
// was already taken. Checked before SECTION_MAP so it always wins over
// whatever prefix the copied name still carries; never auto-applied. A
// `.shadow-dup` file is not always a duplicate of its anchor (#2773) — a
// clobbering write can leave two real, different proposals behind — so
// classifyStagedItem compares the shadow copy's own text against its
// anchor's (when both are readable) instead of guessing: byte-identical
// reports `shadow-dup-duplicate`, anything else reports
// `shadow-dup-divergent`. Either side unreadable — `siblingText` absent (no
// anchor found, or its content couldn't be read) or the shadow copy's own
// `text` itself couldn't be read — falls back to the conservative
// `shadow-dup-collision` — "can't tell" is a distinct outcome from
// "confirmed a duplicate," never guessed as one.
const SHADOW_DUP_RE = /^(.*)\.shadow-dup(?:-\d+)?$/;

// The short-circuit's stances, verbatim from review-console.md:
// - every batch section resolves as "Approve all" — Pending review patches
//   apply (after git apply --check), curation rows approve;
// - Low-confidence / Contested rows have no pre-checked default ("the user
//   decides whether to apply, ignore, or escalate") — Approve-all applies
//   nothing, so they stay staged (never auto-applied);
// - Q#/M# resolve to Apply, their pre-checked default;
// - U# resolves to FILED — the one point where unattended diverges from an
//   interactive Approve all (#347's Decision Rationale).
const SECTION_STANCES = {
  [SECTIONS.AUTO]: { resolution: 'applied', reason: 'already in commits — override = revert' },
  [SECTIONS.PENDING]: { resolution: 'apply', reason: 'Approve-all default (patch validated with git apply --check first)' },
  [SECTIONS.LOW]: { resolution: 'keep-staged', reason: 'unconfirmed finding — no Approve-all default; never auto-applied' },
  [SECTIONS.CONTESTED]: { resolution: 'keep-staged', reason: 'debate inconclusive — no Approve-all default; never auto-applied' },
  [SECTIONS.SKILL]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.DOC]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.JOURNEY]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.CONFIG]: { resolution: 'approve', reason: 'Approve-all default (stage-only row — the write happens at execution, never silently)' },
  [SECTIONS.REF]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.CLEANUP]: { resolution: 'approve', reason: 'Approve-all default — cleanup-procedures.md items run as planned' },
  [SECTIONS.QUEUE]: { resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
  [SECTIONS.MEMORY]: { resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
  [SECTIONS.UPSTREAM]: { resolution: 'filed', reason: 'unattended files upstream feedback like M#/Q# (#347)' },
  [SECTIONS.INSIGHTS]: { resolution: 'approve', reason: 'Approve-all default — review-console.md step 10 applies each row\'s recommended destination; D4/D5 rows stay informational' },
  [SECTIONS.REFUSED]: { resolution: 'refused', reason: 'no default; excluded from Approve all and from consoleAutoResolve (refused-proposals.md)' },
};

const ENGINE_ROW_SECTIONS = { skills: SECTIONS.SKILL, docs: SECTIONS.DOC, journeys: SECTIONS.JOURNEY, 'claude-md': SECTIONS.CONFIG, 'decision-records': SECTIONS.CONFIG, references: SECTIONS.REF };

// `**Category:** {value}` — the header line `reflect/SKILL.md` (and any other producer sharing
// this convention) writes on a staged finding. `null` when the text carries no such line —
// including every caller that passes no text at all (unknown by design; never routed off it).
function parseCategory(text) {
  if (!text) return null;
  const m = /^\*\*Category:\*\*\s*(\S+)/m.exec(text);
  return m ? m[1] : null;
}

// #3880: an `sdd-ruling-*` proposal that defers work must carry a valid defer
// reason before it may auto-ratify. The header is the lines before the first
// blank line; a Defer-reason: key anywhere else (the Ruling: line, the body)
// never counts. Prose twin: wrap-up/review-console-appendix.md's sdd-ruling-*
// bullet. Returns null when the item may resolve as today, else the reason it
// resolves pending under.
// `UNREADABLE` is decided by the callers that attempted the read (`stagedItems` here,
// `decideConsoleExecute` in `reconcile/console-execute.js`), never by
// `sddRulingDeferralReason`, which only ever sees text (#4049).
const SDD_RULING_REASONS = Object.freeze({
  NO_DEFER_REASON: 'sdd-ruling-deferral-no-defer-reason',
  UNCLASSIFIED: 'sdd-ruling-unclassified',
  UNREADABLE: 'sdd-ruling-unreadable',
});

function sddRulingDeferralReason(text) {
  if (text === null || text === undefined) return SDD_RULING_REASONS.UNCLASSIFIED;
  const header = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') break;
    header.push(line);
  }
  // Both header keys match case-insensitively; the reason VALUE check below stays exact. More than one
  // `Defers:` line fails closed (the first line must not silently win).
  const defersMatches = header.map((l) => /^defers:[ \t]*(\S+)$/i.exec(l)).filter(Boolean);
  if (defersMatches.length > 1) return SDD_RULING_REASONS.UNCLASSIFIED;
  const defers = defersMatches.length ? defersMatches[0][1].toLowerCase() : null;
  // Every header line beginning with `Defer-reason:` is a reason line, whatever its value looks like
  // (#3880 fix round 1): a malformed one must fail closed, not fall through as if it were absent.
  const reasons = header.map((l) => /^defer-reason:(.*)$/i.exec(l)).filter(Boolean).map((m) => m[1].trim());
  if (defers === 'yes' || reasons.length > 0) {
    return reasons.length === 1 && DEFER_REASONS.includes(reasons[0]) ? null : SDD_RULING_REASONS.NO_DEFER_REASON;
  }
  if (defers === 'no') return null;
  return SDD_RULING_REASONS.UNCLASSIFIED;
}

// `text` is the staged file's own content, when the caller has it (readSnapshot loads it for
// every `.md`/`.patch` staged item). Only the QUEUE bucket's un-reasoned row reads it: that
// bucket's contract (`reflect/SKILL.md`'s Auto mode routing table) reserves an actual Queue
// write (a `gh issue create` candidate, resolution `apply`) for `Category: tangential` findings
// — `convention`/`observation` findings share the same filename prefix but carry no
// `Title:`/`Type:`/`Labels:` header for record creation to read, so routing them into Queue
// writes/`apply` the same as a tangential finding would attempt to file a malformed issue
// (#2473). A `Category:` value other than `tangential` reroutes to Pending review via the
// existing reason-forces-pending mechanism below; a file with no `Category:` line at all (every
// other QUEUE-bucket producer — `digest-promotion-*`, `leftover-*`, etc. — none of which carry
// this field) is unaffected and keeps today's Queue writes/`apply` classification.
function classifyStagedItem(filename, text, siblingText) {
  if (SHADOW_DUP_RE.test(filename)) {
    if (siblingText === undefined || siblingText === null || text === undefined || text === null) {
      return { section: SECTIONS.PENDING, reason: 'shadow-dup-collision' };
    }
    return { section: SECTIONS.PENDING, reason: text === siblingText ? 'shadow-dup-duplicate' : 'shadow-dup-divergent' };
  }
  for (const [re, section, reason] of SECTION_MAP) {
    if (!re.test(filename)) continue;
    if (section === SECTIONS.QUEUE && !reason) {
      const category = parseCategory(text);
      if (category && category.toLowerCase() !== 'tangential') {
        return { section: SECTIONS.PENDING, reason: `non-tangential-category:${category}` };
      }
    }
    return reason ? { section, reason } : { section };
  }
  return { section: SECTIONS.PENDING, reason: 'unmapped-prefix' };
}

function readText(deps, file) {
  try { return deps.readFile(file); } catch { return null; }
}

function readJson(deps, file) {
  const text = readText(deps, file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Members: the fact pack's resolved record list when a pack exists (#1930
// gathers it before the console), else pack.js's shared resolveRecords
// ladder (run dir's own headers, the worktree mirror, a parent multi-spec
// run's manifest.yml + spec-*/work/ headers — #2028).
function readMembers(deps, runDir) {
  const pack = readJson(deps, path.join(runDir, 'wrap-up-pack.json'));
  const fromPack = pack && pack.inputs && Array.isArray(pack.inputs.records) ? pack.inputs.records.map(Number).filter(Number.isFinite) : [];
  if (fromPack.length) return fromPack;
  const state = readJson(deps, path.join(runDir, 'run-state.json'));
  const worktree = state && typeof state.worktree === 'string' ? state.worktree : null;
  return resolveRecords(deps, runDir, worktree).records;
}

function parseInvariant(patchText) {
  const m = /^Invariant:\s*(.+)$/m.exec(patchText || '');
  return m ? m[1].trim() : null;
}

// Only `.patch` / `.md` / shadow-dup entries are read. `readError` is true only when such an attempted
// read threw (#4049), so a caller can tell an unreadable file from one that was never read at all.
function readStagedEntry(deps, stagedDir, name) {
  const file = path.join(stagedDir, name);
  const entry = { name, path: file, text: null, readError: false };
  if (!(name.endsWith('.patch') || name.endsWith('.md') || SHADOW_DUP_RE.test(name))) return entry;
  try {
    entry.text = deps.readFile(file);
  } catch {
    entry.readError = true;
  }
  return entry;
}

// Everything resolveAll reads, read once. No resolution is computed here.
function readSnapshot({ runDir, deps }) {
  const decisions = readText(deps, path.join(runDir, 'decisions.md')) || '';
  const stagedDir = path.join(runDir, 'staged');
  const staged = deps.readdir(stagedDir).filter((n) => !n.startsWith('.')).sort().map((name) => readStagedEntry(deps, stagedDir, name));
  const engineState = readJson(deps, path.join(runDir, 'engine-state.json'));
  const members = readMembers(deps, runDir);
  let grants = null;
  let grantsError = null;
  if (members.length) {
    try { grants = deps.readGrants(members) || {}; } catch (err) { grantsError = err; }
  }
  // A re-derived patch (#3290) applies only on top of its earlier patch, so when the caller supplies
  // a stacked check the verdicts come from ONE walk over the .patch entries in apply order; without
  // it, each patch is checked alone against the unmodified worktree.
  const patchItems = staged.filter((item) => item.name.endsWith('.patch'));
  const patchChecks = deps.checkPatchStack
    ? deps.checkPatchStack(patchItems.map((item) => item.path))
    : Object.fromEntries(patchItems.map((item) => [item.name, deps.gitApplyCheck(item.path)]));
  return { decisions, staged, engineState, members, grants, grantsError, patchChecks };
}

function decisionLines(decisions) {
  return decisions.split('\n').filter((l) => /^- (AUTO|STAGED|SKIP|KEPT-PROMPT|SCANNED|REFUSED|FAILED) /.test(l));
}

// `refused-proposals.md`'s refused row, logged as
// `REFUSED {time} — Queue write {Q#}: no valid Defer-reason on {staged path};
// kept staged.` — the staged path it names IS the item. Extension-anchored the
// same way coordinationItems is, so trailing punctuation never joins the name.
function refusedStagedNames(decisions) {
  const out = new Set();
  for (const line of decisionLines(decisions)) {
    if (!/^- REFUSED /.test(line)) continue;
    const m = /staged\/([A-Za-z0-9_-]+\.(?:md|patch))/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

function needsHumanVerdict(decisions) {
  return decisionLines(decisions).find((l) => /needs-human/i.test(l) && /merge-check|assess-agent-autonomy/i.test(l)) || null;
}

// The Auto-merge gate's own drain-PR-overlap hold (dispatch/drain-pr-overlap.md
// Step 6, #1985) logs this line when this group's PR overlaps a still-open PR
// opened earlier by the same drain firing. Unlike needsHumanVerdict's carve-out
// (an assess-agent-autonomy verdict, permanent), this hold is explicitly NOT
// persisted — drain-pr-overlap.md re-reads the overlapping PR's live state every
// time the Auto-merge gate runs and self-heals once that PR merges or closes.
// A historical decisions.md line alone is therefore not enough to resolve
// leave-open forever after — mergeResolution re-verifies every named PR's
// current state (below) before trusting it. A group can be held by more than
// one hold line at once (drain-pr-overlap.md Step 6: "Any hit whose
// overlapping drain PR is still open holds this group back") — e.g. two
// distinct overlapping drain PRs, or the same group held more than once
// across retries — so every distinct PR named across all hold lines is
// returned; the group only clears once EVERY one of them is confirmed
// merged/closed. The "held" keyword is the load-bearing discriminator against
// Step 4's differently-worded advisory-only line (`AUTO … group [{issues}]
// overlaps drain PR #{pr}`, no "held"; STAGED before #3520), which must never
// match this regex.
const DRAIN_OVERLAP_HOLD_RE = /held\s*[-—]\s*overlaps drain PR #(\d+)/i;

function drainOverlapHoldPrs(decisions) {
  const found = new Set();
  for (const line of decisionLines(decisions)) {
    const m = DRAIN_OVERLAP_HOLD_RE.exec(line);
    if (m) found.add(Number(m[1]));
  }
  return [...found];
}

function mergeResolution(snapshot, deps) {
  const verdict = needsHumanVerdict(snapshot.decisions);
  if (verdict) return { resolution: 'leave-open', reason: `merge-check verdict needs-human takes precedence: ${verdict.replace(/^- /, '')}` };
  for (const holdPr of drainOverlapHoldPrs(snapshot.decisions)) {
    let state;
    try {
      state = deps.checkPrState(holdPr);
    } catch (err) {
      return { resolution: 'leave-open', reason: `drain-overlap hold: could not re-verify PR #${holdPr}'s current state (${err && err.message ? err.message : err}) — failing closed, same posture as grants-unreadable` };
    }
    // Fail closed on anything other than a confirmed MERGED/CLOSED — an
    // unrecognized state (a future gh output shape, undefined, etc.) must
    // never be treated as "hold cleared, proceed to merge."
    if (state !== 'MERGED' && state !== 'CLOSED') {
      const stateDesc = state === 'OPEN' ? 'still open' : `in an unrecognized state (${state === undefined ? 'undefined' : JSON.stringify(state)})`;
      return { resolution: 'leave-open', reason: `drain-overlap hold: PR #${holdPr} is ${stateDesc} — merge order is a human call (re-checked live against current PR state, not a persisted hold — see dispatch/drain-pr-overlap.md Step 6)` };
    }
    // state is MERGED or CLOSED for this PR: self-healed — keep checking any other named hold PR.
  }
  if (!snapshot.members.length) return { resolution: 'leave-open', reason: 'members-unresolved' };
  if (snapshot.grantsError) return { resolution: 'leave-open', reason: 'grants-unreadable' };
  for (const n of snapshot.members) {
    const g = snapshot.grants[n] || { labels: [], pendingSince: null };
    const labels = g.labels || [];
    const mat = evaluateMaturation({
      hasMergeLabel: labels.includes('auto:merge'),
      hasPendingLabel: labels.includes('auto:merge-pending'),
      pendingSince: g.pendingSince || null,
      vetoWindowHours: deps.vetoWindowHours,
      now: deps.now(),
    });
    if (!mat.mature) {
      // #3358: name the untrusted marker comments ghReadGrants passed over, so an
      // unknown-age grant is not mistaken for "never granted".
      const passedOver = Array.isArray(g.skippedUntrusted) && g.skippedUntrusted.length ? ` — ${g.skippedUntrusted.join('; ')}` : '';
      return { resolution: 'leave-open', reason: `#${n} lacks auto:merge and a matured auto:merge-pending (${mat.reason})${passedOver}` };
    }
  }
  return { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' };
}

function stagedItems(snapshot) {
  // Refusal is a decisions.md fact about the item, not a fact about its name —
  // so it is decided before SECTION_MAP ever runs and outranks every stance.
  const refused = refusedStagedNames(snapshot.decisions);
  // Anchor lookup for the shadow-dup divergence check: `{preferred}.shadow-dup`
  // compares against `{preferred}`'s own text, when that anchor is also a
  // staged item in this same snapshot.
  const textByName = new Map(snapshot.staged.map((s) => [s.name, s.text]));
  return snapshot.staged.map((s) => {
    if (refused.has(s.name)) return { id: s.name, section: SECTIONS.REFUSED, ...SECTION_STANCES[SECTIONS.REFUSED] };
    const anchorMatch = SHADOW_DUP_RE.exec(s.name);
    const siblingText = anchorMatch && textByName.has(anchorMatch[1]) ? textByName.get(anchorMatch[1]) : undefined;
    const { section, reason } = classifyStagedItem(s.name, s.text, siblingText);
    if (reason) return { id: s.name, section, resolution: 'pending', reason };
    if (/^sdd-ruling-/.test(s.name)) {
      const r = s.readError ? SDD_RULING_REASONS.UNREADABLE : sddRulingDeferralReason(s.text);
      if (r) return { id: s.name, section, resolution: 'pending', reason: r };
    }
    const stance = SECTION_STANCES[section];
    if (s.name.endsWith('.patch')) {
      const check = snapshot.patchChecks[s.name] || { ok: false, error: 'not checked' };
      if (!check.ok) {
        const inv = parseInvariant(s.text);
        return { id: s.name, section, resolution: 'stale', reason: `git apply --check failed (${check.error || 'unknown'}) — re-derive from Invariant: ${inv || '(no Invariant: line)'}` };
      }
    }
    return { id: s.name, section, resolution: stance.resolution, reason: stance.reason };
  });
}

// engine-state.json: { results: { <rowId>: { result, target?, findings: [{targetPath, action, commit?, stagePath?}] } } }
// (engine-render.js's worklistRows/collectFindings shape). The id names the
// finding's targetPath; legacy findings carry `target` instead, and a finding
// with neither takes the row-level `target`. A staged finding whose stagePath
// names a staged/ file is the same item as that file.
function engineItems(snapshot, stagedIds) {
  const out = [];
  const results = (snapshot.engineState && snapshot.engineState.results) || {};
  for (const [rowId, section] of Object.entries(ENGINE_ROW_SECTIONS)) {
    const entry = results[rowId];
    if (!entry || entry.result !== 'findings') continue;
    for (const f of entry.findings || []) {
      const label = f.targetPath || f.target || entry.target;
      if (f.action === 'staged') {
        const base = f.stagePath ? path.basename(f.stagePath) : null;
        if (base && stagedIds.has(base)) continue; // already an item via staged/
        out.push({ id: `${rowId}:${label}`, section, resolution: SECTION_STANCES[section].resolution, reason: SECTION_STANCES[section].reason });
      } else if (f.action === 'applied') {
        out.push({ id: `${rowId}:${label}`, section, resolution: 'applied', reason: `applied (${f.commit || 'commit unknown'})` });
      }
    }
  }
  return out;
}

// decisions.md STAGED lines from review coordination that have no staged/
// file of their own (single-read unconfirmed findings). A line naming a
// staged/ path that exists is the same item as that file.
//
// A STAGED line is superseded (no item) when a LATER `- AUTO` line in the same
// decisions.md carries the same finding key (lens + first path:line) and the
// producer's `Confirmed` sentence — review step 3 stages a finding as
// low-confidence, then logs the elevation as AUTO once reproduced (#3772).
// Case-sensitive so `not confirmed` never matches; a keyless line is never
// superseded.
function findingKey(line) {
  const lens = /\blens\s+"?([A-Za-z0-9_-]+)"?/i.exec(line);
  const loc = /([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/.exec(line);
  return lens && loc ? `${lens[1]}|${loc[1]}:${loc[2]}` : null;
}

function coordinationItems(snapshot, stagedIds) {
  const out = [];
  const lines = decisionLines(snapshot.decisions);
  const confirmedAfter = (i, key) => lines.slice(i + 1).some((l) => /^- AUTO /.test(l) && /\bConfirmed\b/.test(l) && findingKey(l) === key);
  for (const [i, line] of lines.entries()) {
    if (!/^- STAGED /.test(line)) continue;
    const key = findingKey(line);
    if (key && confirmedAfter(i, key)) continue;
    // Extension-anchored so trailing sentence punctuation (a period ending
    // the decisions.md line right after ".md") is never captured into the
    // filename — `.` is deliberately excluded from the body class.
    const named = /staged\/([A-Za-z0-9_-]+\.(?:md|patch))/.exec(line);
    if (named && stagedIds.has(named[1])) continue;
    let section = null;
    if (/low-confidence|not directly verified|unconfirmed/i.test(line)) section = SECTIONS.LOW;
    else if (/contested|debate/i.test(line)) section = SECTIONS.CONTESTED;
    if (section) out.push({ id: `decision:${line.slice(2, 60)}`, section, resolution: 'keep-staged', reason: SECTION_STANCES[section].reason });
  }
  return out;
}

// Every cell is escaped, ids included: a staged filename is producer-supplied
// text, so an unescaped `|` in one silently splits the row.
function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function renderRows({ items, cleanup, merge, intro }) {
  const lines = ['### Wrap-Up Review Console (auto-resolved at unattended)', '', intro, '', '| # | Section | Item | Resolution | Reason |', '|---|---|---|---|---|'];
  items.forEach((it, i) => lines.push(`| ${i + 1} | ${cell(it.section)} | ${cell(it.id)} | AUTO-RESOLVED: ${cell(it.resolution)} | ${cell(it.reason)} |`));
  lines.push(`| ${items.length + 1} | Cleanup actions | cleanup-procedures.md items | AUTO-RESOLVED: ${cell(cleanup.resolution)} | ${cell(cleanup.reason)} |`);
  lines.push('', `Merge: **${merge.resolution}** — ${merge.reason}`);
  return lines.join('\n');
}

function renderTable(result) {
  const autoCount = decisionLines(result.snapshot.decisions).filter((l) => /^- AUTO /.test(l)).length;
  return renderRows({ items: result.items, cleanup: result.sections.cleanup, merge: result.merge, intro: `Auto-applied entries in decisions.md: ${autoCount} (already in commits — override = revert).` });
}

// The idempotent re-render: a console.json already carrying `resolved: true`
// is re-shown verbatim (#1932 I3) — no snapshot is read and nothing is
// re-resolved, so the stored items ARE the table. Two item shapes reach here:
// this CLI's own ({section, resolution, reason}) and `_shared/console-on-pr.md`'s
// ({kind, summary, stagedHash, commentId}) once the reconciler has executed a
// PR-rendered console. Every column falls back per field so the second shape
// renders as recorded data rather than a row of `undefined`.
function renderStoredTable(consoleJson) {
  const cj = consoleJson || {};
  const items = (Array.isArray(cj.items) ? cj.items : []).map((it) => ({
    id: it.id || it.kind || '—',
    section: it.section || '—',
    resolution: it.resolution || 'recorded',
    reason: it.reason || it.summary || '',
  }));
  return renderRows({
    items,
    cleanup: SECTION_STANCES[SECTIONS.CLEANUP],
    merge: cj.merge || { resolution: 'unknown', reason: 'not recorded in console.json' },
    intro: `Already resolved at ${cj.at || 'an unrecorded time'} — re-rendered from console.json; nothing re-resolved.`,
  });
}

function resolveAll({ runDir, policy, deps }) {
  if (policy !== 'console-auto') throw new RangeError(`unsupported policy: ${policy} (expected console-auto)`);
  const snapshot = readSnapshot({ runDir, deps });
  const stagedIds = new Set(snapshot.staged.map((s) => s.name));
  const items = [...stagedItems(snapshot), ...engineItems(snapshot, stagedIds), ...coordinationItems(snapshot, stagedIds)];
  const sections = { cleanup: { ...SECTION_STANCES[SECTIONS.CLEANUP] } };
  const merge = mergeResolution(snapshot, deps);
  const result = { ceiling: 'unattended', items, sections, merge, snapshot };
  result.table = renderTable(result);
  return result;
}

module.exports = { SECTIONS, SECTION_MAP, CANONICAL_PREFIXES, STAGING_EXEMPTIONS, stagingExemption, nearestCanonicalPrefixes, SECTION_STANCES, ENGINE_ROW_SECTIONS, SDD_RULING_REASONS, sddRulingDeferralReason, classifyStagedItem, readSnapshot, resolveAll, renderTable, renderStoredTable, drainOverlapHoldPrs };
