'use strict';

const { isTrustedComment, untrustedSkipNote } = require('./comment-trust');

// Pure: decides whether a record's `auto:merge-pending` grant (#309) has
// matured into `auto:merge`, is still inside its veto window, or was never
// pending in the first place (including a permanent veto — a human removing
// `auto:merge-pending` before maturation, with nothing re-adding it — see
// `_shared/work-record.md`'s Grant semantics maturation carve-out).
//
// Called at the two Auto-merge gate Authorization layers that already exist —
// dispatch's group gate (`skills/dispatch/settle-and-merge.md`) and wrap-up's
// singleton short-circuit (`skills/wrap-up/auto-merge-short-circuit.md`) — at
// their normal merge-consult checkpoint, never a separate scheduled job, per
// `docs/donts.md`'s [IL-94].

// Mirrors skills/backlog/refine-headless.md's audit-comment marker, narrowed to the
// `pending` variant and capturing its date. `fleet-counters.js`'s
// GRANT_AUDIT_RE matches the same marker family for a different purpose.
const PENDING_GRANT_MARKER_RE = /<!--\s*grant-mode-audit:\s*date=(\S+)\s+auto-merge=pending\s*-->/g;

// Non-global twin of the /g literal above: `.test` on a /g regex carries
// lastIndex from one call to the next, so two consecutive matching comments
// would see the second one missed.
const PENDING_GRANT_MARKER_TEST_RE = new RegExp(PENDING_GRANT_MARKER_RE.source);

// The `grant-veto-window-hours` schema default (`bin/lib/policy-schema.js`),
// restated here only as a belt-and-braces fallback for a caller that passes an
// absent or invalid value; the resolver supplies it normally.
const DEFAULT_VETO_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

// commentBodies: string[] — an issue's fetched comment bodies (any order).
// Returns the Date of the LATEST `auto-merge=pending` grant-mode-audit
// marker found, or null when none is present. Markers with `auto-merge=true`
// or `auto-merge=false` are ignored — only a pending grant has a maturation
// clock to read.
function extractPendingGrantedAt(commentBodies) {
  const bodies = Array.isArray(commentBodies) ? commentBodies : [];
  let latest = null;
  for (const body of bodies) {
    if (typeof body !== 'string') continue;
    // matchAll clones the regex, so the module-level /g literal's lastIndex is
    // never carried between bodies (an exec loop would need resetting).
    for (const match of body.matchAll(PENDING_GRANT_MARKER_RE)) {
      const parsed = new Date(match[1]);
      if (Number.isNaN(parsed.getTime())) continue;
      if (!latest || parsed.getTime() > latest.getTime()) latest = parsed;
    }
  }
  return latest;
}

// comments: an issue's fetched comment objects (`gh issue view --json comments`
// shape). The grant timestamp is a trust decision (#3358) -- a `grant-mode-audit`
// marker is plantable by anyone who can comment, and a backdated one would mature
// a pending grant -- so only an owner/member/collaborator comment's body may reach
// extractPendingGrantedAt. Returns { bodies, skippedUntrusted }: bodies are the
// trusted comments' bodies (feed them to extractPendingGrantedAt); skippedUntrusted
// holds one note per untrusted comment whose body carries the pending-grant marker
// (a non-marker untrusted comment is irrelevant and stays silent). A bare string has no
// association to attest it, so isTrustedComment fails it closed, but it is still tested
// for the marker so a pending-grant marker inside one is named rather than dropped silently.
function partitionGrantComments(comments) {
  const bodies = [];
  const skippedUntrusted = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    const body = typeof c === 'string' ? c : (c && typeof c.body === 'string' ? c.body : '');
    if (isTrustedComment(c)) bodies.push(body);
    else if (PENDING_GRANT_MARKER_TEST_RE.test(body)) skippedUntrusted.push(untrustedSkipNote(c));
  }
  return { bodies, skippedUntrusted };
}

// hasPendingLabel/hasMergeLabel: booleans from a fresh `gh issue view
// --json labels` read. pendingSince: Date | null — normally
// extractPendingGrantedAt's return value. vetoWindowHours: the resolved
// grant-veto-window-hours policy value (DEFAULT_VETO_WINDOW_HOURS when absent
// or invalid). now: Date | epoch-ms (injected clock for tests).
//
// Returns { mature, state, reason, ageHours?, windowHours? }. `state` is one of:
//   'already-mature'     — auto:merge is already present; nothing to do.
//   'not-pending'        — no auto:merge-pending label (never granted, or a
//                          human vetoed it — both read identically here).
//   'unknown-age'        — pending label present but no discoverable grant
//                          timestamp; treated as not yet matured (fail safe).
//   'within-veto-window' — pending, timestamped, but still younger than the
//                          veto window.
//   'matured'            — pending, timestamped, and past the veto window —
//                          the caller should promote it now.
function evaluateMaturation({ hasPendingLabel, hasMergeLabel, pendingSince, vetoWindowHours, now } = {}) {
  if (hasMergeLabel === true) {
    return { mature: true, state: 'already-mature', reason: 'auto:merge already present' };
  }
  if (hasPendingLabel !== true) {
    return { mature: false, state: 'not-pending', reason: 'no auto:merge-pending label present (never granted, or vetoed by a human removing it)' };
  }
  if (!(pendingSince instanceof Date) || Number.isNaN(pendingSince.getTime())) {
    return { mature: false, state: 'unknown-age', reason: 'pending grant timestamp could not be determined from the audit trail — treated as not yet matured' };
  }

  const windowHours = Number.isFinite(vetoWindowHours) && vetoWindowHours > 0
    ? vetoWindowHours
    : DEFAULT_VETO_WINDOW_HOURS;

  let nowMs = Date.now();
  if (now instanceof Date) nowMs = now.getTime();
  else if (typeof now === 'number') nowMs = now;
  const ageHours = (nowMs - pendingSince.getTime()) / HOUR_MS;

  if (ageHours < windowHours) {
    return { mature: false, state: 'within-veto-window', reason: `pending grant is ${ageHours.toFixed(1)}h old, veto window is ${windowHours}h`, ageHours, windowHours };
  }
  return { mature: true, state: 'matured', reason: `pending grant is ${ageHours.toFixed(1)}h old, past the ${windowHours}h veto window`, ageHours, windowHours };
}

module.exports = { evaluateMaturation, extractPendingGrantedAt, partitionGrantComments, PENDING_GRANT_MARKER_RE };
