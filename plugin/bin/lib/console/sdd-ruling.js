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

// #3942: what ratifying a ruling does. A deferral files the deferred work as a
// backlog record (ledger row `deferred`, `ratified → #{n}`); a settled
// `Defers: no` ruling keeps the `accepted` write-back. Prose twin: the same
// appendix bullet's ratify sentence, which names each value.
const SDD_RULING_RATIFY_ACTIONS = Object.freeze({
  FILE_RECORD: 'file-record',
  ACCEPT: 'accept',
});

// The header's two keys, read once for both exports below. Both header keys match
// case-insensitively; the reason VALUE check stays exact (in sddRulingDeferralReason).
function readHeader(text) {
  const header = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') break;
    header.push(line);
  }
  const defersMatches = header.map((l) => /^defers:[ \t]*(\S+)$/i.exec(l)).filter(Boolean);
  // Every header line beginning with `Defer-reason:` is a reason line, whatever its value looks like
  // (#3880 fix round 1): a malformed one must fail closed, not fall through as if it were absent.
  const reasons = header.map((l) => /^defer-reason:(.*)$/i.exec(l)).filter(Boolean).map((m) => m[1].trim());
  return { defersMatches, reasons };
}

function sddRulingDeferralReason(text) {
  if (text === null || text === undefined) return SDD_RULING_REASONS.UNCLASSIFIED;
  const { defersMatches, reasons } = readHeader(text);
  // More than one `Defers:` line fails closed (the first line must not silently win).
  if (defersMatches.length > 1) return SDD_RULING_REASONS.UNCLASSIFIED;
  const defers = defersMatches.length ? defersMatches[0][1].toLowerCase() : null;
  if (defers === 'yes' || reasons.length > 0) {
    return reasons.length === 1 && DEFER_REASONS.includes(reasons[0]) ? null : SDD_RULING_REASONS.NO_DEFER_REASON;
  }
  if (defers === 'no') return null;
  return SDD_RULING_REASONS.UNCLASSIFIED;
}

// null when the ruling is not ratifiable (sddRulingDeferralReason names a gap);
// otherwise file-record for a deferral (`Defers: yes`, or any `Defer-reason:`
// header line), else accept.
function sddRulingRatifyAction(text) {
  if (sddRulingDeferralReason(text) !== null) return null;
  const { defersMatches, reasons } = readHeader(text);
  const defers = defersMatches.length ? defersMatches[0][1].toLowerCase() : null;
  return defers === 'yes' || reasons.length > 0 ? SDD_RULING_RATIFY_ACTIONS.FILE_RECORD : SDD_RULING_RATIFY_ACTIONS.ACCEPT;
}

module.exports = {
  SDD_RULING_REASONS, sddRulingDeferralReason, SDD_RULING_RATIFY_ACTIONS, sddRulingRatifyAction,
};
