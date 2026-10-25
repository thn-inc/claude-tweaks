// bin/lib/console/sdd-ruling.js — the sdd-ruling defer-reason check (#3880/#4049),
// held in its own leaf (#4060): its only require is issues/record, so a caller
// that needs only these names (reconcile/console-execute.js) does not load
// console/resolve.js and through it wrap-up/pack.js. resolve.js re-exports both.
'use strict';

const { DEFER_REASONS } = require('../issues/record');

// #3880: an `sdd-ruling-*` proposal that defers work must carry a valid defer
// reason before it may auto-ratify. The header is the lines before the first
// blank line; a Defer-reason: key anywhere else (the Ruling: line, the body)
// never counts. Prose twin: wrap-up/review-console-appendix.md's sdd-ruling-*
// bullet. Returns null when the item may resolve as today, else the reason it
// resolves pending under.
// `UNREADABLE` is decided by the callers that attempted the read (`stagedItems` in
// `console/resolve.js`, `decideConsoleExecute` in `reconcile/console-execute.js`), never by
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

module.exports = { SDD_RULING_REASONS, sddRulingDeferralReason };
