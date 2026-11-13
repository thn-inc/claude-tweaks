'use strict';

// Pure: the gate chain `/claude-tweaks:backlog refine`'s headless posture (the headless
// machine-grant chain) evaluates per candidate record. Five floors, ALL must hold, evaluated in
// a fixed order with the first failure short-circuiting into a logged skip — the
// order is load-bearing (see skills/backlog/refine-headless.md and this record's own
// #269 Deliverables). Callers apply labels/comments; this module only decides.
//
// Two-phase call, because gate 4 (assess-agent-autonomy grant-check) is a
// content-aware LLM judgment this pure module cannot make itself (IL-63 — a
// spawned/pure module cannot invoke a Skill call). Call once with `grantCheck`
// omitted: if gates 1-3 pass, the result carries `needsGrantCheck: true` and no
// `failedKey` — the caller then runs grant-check and calls again with the result
// folded in to get the final decision (which re-walks gates 1-3 too, cheaply,
// since they're pure).
//
// Was docs/superpowers/specs/2026-08-09-self-maintaining-fleet-design.md —
// decomposed into #265 + #267-#276 (bc1de29d) — and #269 (refine's headless posture:
// headless machine-grant unit behind the unattended ceiling).

const { normalizeLabelNames, parseRecordFacets } = require('./record.js');
const { resolveProvenance } = require('./provenance.js');
const { riskBand, describeMixedReasons, followUpRatePercent } = require('./trust.js');
const { permittedGrants } = require('./autonomy.js');
const { isSensitivePath } = require('./blast-radius.js');
const { exceedsOversightFloor } = require('./oversight-floor.js');

function deny(failedKey, reason, snapshot) {
  return { grant: false, autoMerge: false, failedKey, reason, snapshot: snapshot || {} };
}

// record: { number, labels (string[] | {name}[]), body, facets? (parseRecordFacets
//   output — computed from labels when omitted), keyFiles? (string[] — the
//   record's own '### Key Files' list; [] when the body has none) }
// policy: { ceiling, grantOriginationEnabled, dailyGrantCap? (positive integer;
//   absent/undefined = uncapped, per '#269's Deliverables "optional-when-absent"
//   contract), grantsIssuedToday? (count; ignored when dailyGrantCap is absent),
//   sensitivePaths? (string[] globs — merge-sensitive-paths, [] default),
//   riskFloor?, sizeFloor? (resolved risk-floor/size-floor policy values, passed
//   straight through to exceedsOversightFloor — undefined defaults to 'high') }
// trustVerdicts: Map<classKey, row> — classKey is 'kind:source|band', row is one
//   of trustRows()'s rows (bin/lib/issues/trust.js). Absent class = no cell yet,
//   graded 'insufficient-evidence' the same way a missing row reads everywhere
//   else in this codebase (refine-mode.md's Trust Signal table, trust.js itself).
// grantCheck: undefined (gates 1-3 only, first phase) | { clear: boolean,
//   rationale?: string } (second phase, after the caller ran grant-check).
//
// Returns { grant, autoMerge, failedKey, reason, snapshot } or, on the first
// phase with gates 1-3 clear, { grant: false, autoMerge: false, failedKey: null,
// needsGrantCheck: true, snapshot }.
function evaluateGrantGate({ record, policy, trustVerdicts, grantCheck } = {}) {
  const rec = record || {};
  const pol = policy || {};
  const names = normalizeLabelNames(rec.labels);
  const facets = rec.facets || parseRecordFacets(rec.labels);

  // Gate 1a: ceiling must resolve to 'unattended'.
  const ceiling = pol.ceiling;
  if (ceiling !== 'unattended') {
    return deny('ceiling', `autonomy ceiling is ${ceiling || 'supervised'} — must be unattended for a machine-originated grant`);
  }

  // Gate 1b: the reserved second opt-in (skills/_shared/autonomy-ceiling.md) —
  // 'unattended' alone never authorizes a machine-originated grant.
  if (pol.grantOriginationEnabled !== true) {
    return deny('grant-origination-opt-in', 'ceiling is unattended, but grant-origination-enabled is not set — machine-originated grants need their own explicit opt-in');
  }

  // Gate 1c: needs:* — cheapest possible per-record disqualifier (no
  // trustVerdicts row lookup, independent of origin), so it runs first among the
  // per-record checks, before any trust-row computation is spent on a record
  // this gate would refuse anyway. Generalized (#1488) to match the worklist rule
  // in `_shared/work-record.md` (see '### Worklist rule'). needs:definition keeps
  // its own named failedKey for backward compatibility with existing callers; any
  // other needs:* label denies under the generic 'needs-label' key.
  if (facets.needsDefinition === true) {
    return deny('needs-definition', 'record carries needs:definition — an open choice has not been decided yet; run /claude-tweaks:specify to route through brainstorming first');
  }
  const needsLabel = names.find((n) => n.startsWith('needs:'));
  if (needsLabel) {
    return deny('needs-label', `record carries ${needsLabel} — a headless unit is waiting on a human decision; see the record's newest unresolved decision comment`);
  }

  // Gate 2: record class trust reads 'clean'.
  const { kind, source } = resolveProvenance({ labels: names, body: rec.body });
  const band = riskBand(names);
  const classKey = `${kind}:${source}|${band}`;
  const row = trustVerdicts instanceof Map ? trustVerdicts.get(classKey) : undefined;
  // 'no-cell' (no closed record for this class at all) is distinct from a
  // present row whose own computed verdict is 'insufficient-evidence' (some
  // closed records, but too few dispositioned outcomes to grade) — same
  // two-state convention refine-mode.md's own Trust Signal script uses
  // ('no-cell' vs the module's real verdict values). Both deny here; the
  // string is what the audit log names, so it must not conflate them.
  const verdict = row ? row.verdict : 'no-cell';
  if (verdict !== 'clean') {
    // A mixed row names why (reasons) and how far from the bar (rate vs max);
    // a bare hand-built row has neither, so each segment drops independently.
    // The rate is stated once, in the trailing segment, in plain words: the
    // follow-up-rate entry is left out of the parenthesized reasons.
    let detail = '';
    if (verdict === 'mixed') {
      const otherReasons = Array.isArray(row.mixedReasons)
        ? row.mixedReasons.filter((r) => r !== 'follow-up-rate')
        : row.mixedReasons;
      const reasons = describeMixedReasons({ ...row, mixedReasons: otherReasons });
      const rate = followUpRatePercent(row);
      if (reasons) detail += ` (${reasons})`;
      if (rate !== null) detail += ` — follow-up rate ${rate}% (max ${row.followUpRateMaxPercent}%)`;
    }
    return deny('trust', `class ${classKey} verdict is ${verdict}${detail} — only a clean class earns a machine-originated grant`, { classKey, verdict });
  }

  // Gate 3: record carries a by:* sweep origin (agent-filed) — a human-filed
  // record is refused even with every other key satisfied (its own AC, not
  // folded into the trust check above).
  if (facets.origin === null || facets.origin === undefined) {
    return deny('origin', 'record carries no by:* sweep origin — human-filed records are never machine-granted', { classKey, verdict });
  }

  // Gate 4: assess-agent-autonomy grant-check — content-aware, invoked by the
  // caller between the two phases (see header comment).
  if (grantCheck === undefined) {
    return { grant: false, autoMerge: false, failedKey: null, needsGrantCheck: true, snapshot: { classKey, verdict, band, origin: facets.origin } };
  }
  if (!grantCheck || grantCheck.clear !== true) {
    return deny('grant-check', (grantCheck && grantCheck.rationale) || 'grant-check did not clear', { classKey, verdict });
  }

  // Gate 5: floors, fixed sub-order — merge-sensitive-paths (against the
  // record's own Key Files list; grant time has no diff), the shared
  // risk/size oversight floor, then the fleet daily grant cap.
  const keyFiles = Array.isArray(rec.keyFiles) ? rec.keyFiles : [];
  const sensitivePaths = Array.isArray(pol.sensitivePaths) ? pol.sensitivePaths : [];
  const sensitiveHit = keyFiles.find((f) => isSensitivePath(f, sensitivePaths));
  if (sensitiveHit) {
    return deny('merge-sensitive-paths', `Key Files entry "${sensitiveHit}" matches a configured merge-sensitive-paths glob`, { classKey, verdict });
  }
  const floorResult = exceedsOversightFloor(facets, { riskFloor: pol.riskFloor, sizeFloor: pol.sizeFloor });
  if (floorResult.exceeds) {
    return deny('oversight-floor', `record exceeds the oversight floor (reason: ${floorResult.reason}) — a human review is required`, { classKey, verdict });
  }
  // Provenance-aware floor (#969): a record no human reviewed (shaped:headless,
  // #968) is additionally evaluated against a fixed medium floor on both axes —
  // stricter than the configured floor above, never looser. This branch may only
  // ever narrow auto-granting, never widen it: it runs after the configured-floor
  // deny (so that key keeps winning when both would fire, #969 AC4) and never
  // short-circuits a later deny into a pass. Human-shaped records (no
  // shapedHeadless facet) are untouched by this branch.
  if (facets.shapedHeadless === true) {
    const provenanceFloor = exceedsOversightFloor(facets, { riskFloor: 'medium', sizeFloor: 'medium' });
    if (provenanceFloor.exceeds) {
      return deny('shaped-headless-floor', `record was shaped headlessly (no human review) and exceeds the fixed medium provenance floor (reason: ${provenanceFloor.reason}) — run /claude-tweaks:backlog refine to grant it`, { classKey, verdict, risk: facets.risk, size: facets.size, floorReason: provenanceFloor.reason });
    }
  }
  const hasCap = typeof pol.dailyGrantCap === 'number' && pol.dailyGrantCap > 0;
  if (hasCap) {
    const issuedToday = typeof pol.grantsIssuedToday === 'number' ? pol.grantsIssuedToday : 0;
    if (issuedToday >= pol.dailyGrantCap) {
      return deny('daily-grant-cap', `fleet-daily-grant-cap (${pol.dailyGrantCap}) already reached today (${issuedToday} grants issued)`, { classKey, verdict });
    }
  }

  // All floors clear. auto:merge eligibility is exactly permittedGrants'
  // grants.bornAuthorized for this class — no separate criteria (IL-32: reuse the one
  // decision table rather than reimplementing the mapping). Every input this
  // call needs was already independently verified by gates 1-3 above, so this
  // call is confirmatory, not a new judgment.
  const permitted = permittedGrants({ ceiling, row, grantOriginationEnabled: pol.grantOriginationEnabled });
  // NOTE (#309): this boolean means "this class of record earns merge trust" —
  // it does NOT decide which label carries it. The caller (backlog/refine-headless.md
  // Step 4) applies `auto:merge-pending`, never `auto:merge` directly; the
  // promotion happens later, at dispatch's Auto-merge gate.
  let autoMerge = permitted.grants.bornAuthorized.granted === true;

  // Global merge-lane circuit breaker (#311) — a second, independent,
  // additive floor checked AFTER every gate above already cleared. It never
  // routes through deny() (which denies `grant` too): tripped state gates
  // origination of new auto:merge grants only, leaving `grant` (auto:build
  // origination) exactly as gates 1-5 already decided. See
  // bin/lib/issues/merge-lane-breaker.js and
  // skills/_shared/autonomy-ceiling.md's "Revocation" section.
  const breakerTripped = pol.mergeLaneBreakerTripped === true;
  if (breakerTripped) autoMerge = false;

  return {
    grant: true,
    autoMerge,
    failedKey: null,
    reason: 'all floors clear',
    snapshot: {
      ceiling,
      grantOriginationEnabled: pol.grantOriginationEnabled,
      classKey,
      verdict,
      band,
      origin: facets.origin,
      risk: facets.risk,
      size: facets.size,
      grantCheckRationale: grantCheck.rationale,
      keyFilesChecked: keyFiles.length,
      dailyGrantCap: hasCap ? pol.dailyGrantCap : null,
      grantsIssuedToday: hasCap ? (pol.grantsIssuedToday || 0) : null,
      ...(breakerTripped ? { mergeLaneBreakerTripped: true } : {}),
    },
  };
}

module.exports = { evaluateGrantGate };
