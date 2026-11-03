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
// resolves pending under. A deferral whose one reason is `needs-human-decision`
// resolves pending under that reason, since the reason itself says a human must
// decide (#4587).
// `UNREADABLE` is decided by the callers that attempted the read (`stagedItems` in
// `console/resolve.js`, `decideConsoleExecute` in `reconcile/console-execute.js`), never by
// `sddRulingDeferralReason`, which only ever sees text (#4049).
const SDD_RULING_REASONS = Object.freeze({
  NO_DEFER_REASON: 'sdd-ruling-deferral-no-defer-reason',
  UNCLASSIFIED: 'sdd-ruling-unclassified',
  UNREADABLE: 'sdd-ruling-unreadable',
  NEEDS_HUMAN_DECISION: 'sdd-ruling-needs-human-decision',
});

// #3942: what ratifying a ruling does. A deferral files the deferred work as a
// backlog record (ledger row `deferred`, `ratified → #{n}`); a settled
// `Defers: no` ruling keeps the `accepted` write-back. Two categories, not one:
// "not auto-ratifiable" is `sddRulingDeferralReason` returning non-null (a human
// must tick it), "not ratifiable" is `sddRulingRatifyAction` returning null (there
// is no readable ruling to act on). Prose twin: the same appendix bullet's ratify
// sentence, which names each value.
const SDD_RULING_RATIFY_ACTIONS = Object.freeze({
  FILE_RECORD: 'file-record',
  ACCEPT: 'accept',
});

// The header's two keys, read once for both exports below. Both header keys match
// case-insensitively; the reason VALUE check stays exact (in sddRulingDeferralReason).
// Every header line beginning `Defers:` is a line, its value the trimmed rest of the
// line: an empty or multi-word value counts too (#3942 amendment (h)), so a
// `Defers: no` plus a stray `Defers:` or `Defers: not sure` is two lines, never one.
// Each match is `[line, value]`, the shape both callers index.
function readHeader(text) {
  const header = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') break;
    header.push(line);
  }
  const defersMatches = header.map((l) => /^defers:(.*)$/i.exec(l)).filter(Boolean).map((m) => [m[0], m[1].trim()]);
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
    if (reasons.length !== 1 || !DEFER_REASONS.includes(reasons[0])) return SDD_RULING_REASONS.NO_DEFER_REASON;
    return reasons[0] === 'needs-human-decision' ? SDD_RULING_REASONS.NEEDS_HUMAN_DECISION : null;
  }
  if (defers === 'no') return null;
  return SDD_RULING_REASONS.UNCLASSIFIED;
}

// What a human ratify of this ruling does. null only when the ruling is not
// ratifiable: no text, or text with no non-whitespace character (nothing to compose
// a record from). accept only for a settled decision: one or more `Defers:` lines,
// every value `no`, and no `Defer-reason:` line (agreeing lines are the same
// decision as one). Everything else readable is file-record, including every
// deferral `sddRulingDeferralReason` withholds from auto-ratify (no reason, several
// or invalid reasons, needs-human-decision, no or conflicting or unknown `Defers:`):
// a human tick files its record while the unattended gate still holds the row.
function sddRulingRatifyAction(text) {
  if (text === null || text === undefined || String(text).trim() === '') return null;
  const { defersMatches, reasons } = readHeader(text);
  const settledNo = defersMatches.length >= 1 && defersMatches.every((m) => m[1].toLowerCase() === 'no') && reasons.length === 0;
  return settledNo ? SDD_RULING_RATIFY_ACTIONS.ACCEPT : SDD_RULING_RATIFY_ACTIONS.FILE_RECORD;
}

module.exports = {
  SDD_RULING_REASONS, sddRulingDeferralReason, SDD_RULING_RATIFY_ACTIONS, sddRulingRatifyAction,
};
