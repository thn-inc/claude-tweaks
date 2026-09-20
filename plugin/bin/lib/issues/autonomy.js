'use strict';

// Pure: the autonomy ceiling. Resolves which tier is in force and maps a trust
// row to the concrete permissions that tier allows for that class. Policy sets
// the ceiling; evidence sets the level — this module is where the two meet, and
// it grants nothing on its own. Callers apply the labels.
// Was docs/superpowers/specs/2026-08-07-earned-autonomy-tier-design.md, Phase
// 3 — deleted (bdb2f4f6): all 4 phases shipped, v6.50.0-6.59.0.
//
// #647 shipped the per-grant `grants.{bornReady,bornAuthorized}.{granted,reason}`
// shape to fix a bug in the old flat `bornReady`/`bornAuthorized`/`reason` keys:
// a flat single `reason` could pair a granted bornReady with the other grant's
// denial text. #666 removed the flat keys once every consumer (capture/SKILL.md,
// backlog/trust-signal.md — renamed from refine-mode.md since #647) read only
// `grants.*`.

// record.js requires only ./facet-shape; this import is one-directional by
// contract (autonomy -> record, never record -> autonomy) so the two never cycle.
const { DEFER_REASONS } = require('./record');

// Ordered least to most permissive. Index comparison is the tier test, so the
// order is load-bearing, not cosmetic.
const CEILINGS = ['supervised', 'trusted', 'unattended'];

// The kinds provenance.js emits that name a real class: 'producer' (a by:*
// label), 'side-effect' (an Origin: body line), 'human' (absence of both). Its
// fourth kind, 'unstructured', is the classifier reporting it could not reduce
// a record to a class at all, and is absent here deliberately — trust.js already
// pins that kind's verdict to 'insufficient-evidence', and a redundant deny means
// neither module can open the bucket on its own.
//
// An allowlist, not a denylist naming 'unstructured'. The design's Phase 3 note
// warns that "a consumer switching over three kinds silently drops" the fourth;
// a denylist inverts that failure rather than fixing it — it would grant to any
// fifth kind a later provenance change introduces, and to a row whose `kind` is
// an empty string. Both were reachable and both granted before this became an
// allowlist. Unrecognized input must deny, which is only true if recognition is
// what is being tested.
const GRADABLE_KINDS = new Set(['producer', 'side-effect', 'human']);

// Of those, the ones that describe work an AGENT filed. Born-`ready` authorizes
// an agent to file spec-shaped, so a class whose records a human filed has no
// agent whose filing could be authorized — its verdict says something real about
// how that work turned out, but nothing about an agent's filing discipline.
// Granting on it would license agent filings using evidence generated entirely by
// human ones, and it is not a corner case: `human:human|elevated` (50 records) and
// `human:human|low` (40) are this repo's two largest cells and the first likely to
// clear both floors.
const AGENT_FILED_KINDS = new Set(['producer', 'side-effect']);

function isCeiling(value) {
  return typeof value === 'string' && CEILINGS.includes(value);
}

// Precedence per _shared/auto-mode-contract.md: CLI arg > run config > project
// policy > skill default. An unrecognized value at any level is skipped rather
// than honored or thrown on — a typo must never resolve to a tier nobody named,
// and falling through to the next source lands on 'supervised' in the worst case.
function resolveCeiling(sources) {
  const { cliArg, runConfig, policy } = sources || {};
  for (const candidate of [cliArg, runConfig, policy]) {
    if (isCeiling(candidate)) return candidate;
  }
  return 'supervised';
}

function atLeast(ceiling, minimum) {
  return CEILINGS.indexOf(ceiling) >= CEILINGS.indexOf(minimum);
}

// Both grants share one `reason` here deliberately, not as a residue of the
// flat-key pairing bug #647/#666 fixed: every DENY() call site denies both
// grants for the identical cause (no trust row, unclassifiable kind, ceiling
// supervised, verdict not clean, class human-filed), so the shared text is
// accurate for both, unlike the old bug where a *granted* bornReady could
// inherit the *other* grant's denial text.
const DENY = (reason) => ({
  grants: {
    bornReady: { granted: false, reason },
    bornAuthorized: { granted: false, reason },
  },
});

// Shared shape for the two `bornAuthorized`-denied-but-`bornReady`-may-still-be-
// granted outcomes below: only the reason text differs between them.
const DENY_AUTHORIZED = (bornReady, reason) => ({
  grants: {
    bornReady: { granted: bornReady, reason: '' },
    bornAuthorized: { granted: false, reason },
  },
});

// `row` is one of trustRows()'s rows. `grantOriginationEnabled` is the separate,
// explicit opt-in described below — never inferred from the ceiling.
function permittedGrants(input) {
  // `|| {}` rather than a default parameter: defaults fire only on `undefined`,
  // so `= {}` left an explicit null throwing while resolveCeiling(null) returned
  // a value. A caller sweeping a record list should not crash on one bad entry.
  const { ceiling, row, grantOriginationEnabled } = input || {};
  const tier = isCeiling(ceiling) ? ceiling : 'supervised';

  if (!row || typeof row !== 'object' || typeof row.verdict !== 'string' || typeof row.kind !== 'string') {
    return DENY('no trust row for this class — nothing has been measured');
  }
  if (!GRADABLE_KINDS.has(row.kind)) {
    return DENY(`class is unclassifiable (kind ${JSON.stringify(row.kind)}) — provenance could not reduce these records to a class this module recognizes`);
  }
  if (tier === 'supervised') {
    return DENY('autonomy ceiling is supervised — trust is recorded and displayed, never acted on');
  }
  if (row.verdict !== 'clean') {
    return DENY(`class verdict is ${row.verdict} — only a clean class earns anything`);
  }

  // At `trusted`, a class that has earned it may file spec-shaped work directly
  // as `ready`. That skips the human shaping round-trip, not the grant: `ready` asserts
  // shape, and _shared/work-record.md's human gate at /claude-tweaks:backlog
  // refine still stands between `ready` and any autonomous build. Agent-filed
  // classes only — see AGENT_FILED_KINDS.
  const bornReady = atLeast(tier, 'trusted') && AGENT_FILED_KINDS.has(row.kind);
  if (!bornReady) {
    return DENY(`class ${row.kind} is human-filed — born-ready authorizes an agent's filing, and there is no agent filing here`);
  }

  // `auto:build` is the actual authorization, and originating one from machinery
  // contradicts work-record.md's standing invariant that auto:* labels are only
  // ever added by an interactive human session. That invariant was written after
  // a real run treated a low-risk, well-scoped, `ready` record as license to run
  // a full build-to-close lifecycle on its own judgment
  // (evals/scenarios/backlog-refine-permission-matrix-compliance.yaml exists
  // because of it, though what that scenario can actually assert is the
  // local-files boundary — its own description says the grant path is untestable
  // in the sandbox, so it is the incident and not the eval that carries the
  // weight here). The tier is defined so the ceiling is complete; the grant path
  // stays behind its own opt-in until that invariant is deliberately amended, and
  // reaching the top tier is never by itself that amendment.
  if (!atLeast(tier, 'unattended')) {
    return DENY_AUTHORIZED(bornReady, `class is clean and the ceiling is ${tier}`);
  }
  if (grantOriginationEnabled !== true) {
    return DENY_AUTHORIZED(bornReady, 'ceiling is unattended, but machine-originated grants need their own explicit opt-in');
  }
  // Positive rationale populated into both per-grant `reason` fields, not
  // dropped: the old flat `reason` carried this text and nothing else would
  // reproduce it once removed (#666's own conflation-residue decision —
  // `granted: true` alone doesn't explain *why*, and a future reader tracing
  // a grant back should not have to reconstruct it from the conditions above).
  const rationale = 'class is clean, ceiling is unattended, grant origination opted in';
  return {
    grants: {
      bornReady: { granted: bornReady, reason: rationale },
      bornAuthorized: { granted: true, reason: rationale },
    },
  };
}

// Floor-check predicate for the autonomy ceiling's ledger-narrowing bookkeeping
// capability. Decides whether an item's "why not fixed now" reason is one of the
// categories skills/_shared/deferral-gate.md's floor mapping marks as clearing
// the floor -- the only categories bookkeeping narrowing is allowed to auto-route
// without asking. Single path: a structured Defer-reason: value (exact member of
// DEFER_REASONS) resolves from the mapping table below; anything else denies.
// Was docs/superpowers/specs/2026-07-16-unattended-tier-design.md — deleted (652a97c4).
// This once had a free-prose regex-fallback path for reasons predating the
// structured vocabulary; removed at #696 once every deferral-gate consumer
// stamped a structured Defer-reason: and the conformance test shipped clean
// for a release.

// Structured verdicts, per deferral-gate.md's floor mapping: blocked-external <->
// the external-state group, needs-human-decision <-> the product/design group,
// blocked-dependency <-> not-yet-built, genuinely-larger <-> scope expansion;
// tangential and pre-existing-outside-diff map to no group.
const STRUCTURED_FLOOR = Object.freeze({
  'tangential': false,
  'needs-human-decision': true,
  'pre-existing-outside-diff': false,
  'genuinely-larger': true,
  'blocked-external': true,
  'blocked-dependency': true,
});

function clearsFloor(blockerReason) {
  if (typeof blockerReason !== 'string' || blockerReason.trim() === '') return false;
  return DEFER_REASONS.includes(blockerReason) && STRUCTURED_FLOOR[blockerReason] === true;
}

// The bookkeeping capabilities the retired unattended-tier lever used to gate
// as one on/off boolean, now unlocked individually by the merged autonomy
// ceiling: ledger Phase 2 narrowing and queue-write auto-file at 'trusted'+;
// ops-ack auto-acknowledge, console auto-resolve, refine auto-apply, and
// ledger route-remainder held back to 'unattended' (see
// skills/_shared/autonomy-ceiling.md for what each one does). An unrecognized
// ceiling falls through to 'supervised' -- same handling as permittedGrants,
// so a typo denies everything rather than granting it.
function bookkeepingPermissions(ceiling) {
  const tier = isCeiling(ceiling) ? ceiling : 'supervised';
  return {
    ledgerNarrowing: atLeast(tier, 'trusted'),
    queueWriteAutoFile: atLeast(tier, 'trusted'),
    opsAckAutoAcknowledge: atLeast(tier, 'unattended'),
    consoleAutoResolve: atLeast(tier, 'unattended'),
    refineAutoApply: atLeast(tier, 'unattended'),
    ledgerRouteRemainder: atLeast(tier, 'unattended'),
  };
}

module.exports = { CEILINGS, resolveCeiling, permittedGrants, clearsFloor, bookkeepingPermissions };
