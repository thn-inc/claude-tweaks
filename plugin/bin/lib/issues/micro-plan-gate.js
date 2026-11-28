'use strict';

// The /build micro-plan applicability gate (skills/build/micro-plan.md "Applicability gate"),
// as a pure predicate: no I/O, no label parsing. The prose gate and /specify's plan-lane
// predicate read the same rule from here instead of each restating it.
//
// All four conditions must hold (MICRO_PLAN_CONDITIONS, cheapest first, risk last):
//   fast-lane-ceremony        ceremony facet is 'fast-lane'
//   low-size                  size facet is 'low'
//   implementation-file-limit the spec's `### Key Files` names at most MAX_IMPLEMENTATION_FILES
//                             implementation files
//   no-risk-flag              parseRiskFlags reads no flag from the body
// `ceremony` and `size` arrive as facet strings (or null), never labels: the predicate derives
// them from the record's labels, /build from the materialized header, whose ceremony can come
// from a ceremony-check verdict when the record has no `ceremony:*` label. null or any other
// value fails its condition.
//
// Counting rule (condition 3). Every listed path counts as an implementation file except one
// under `tests/`, one matching `*.test.*`/`*.spec.*`, a `*.md` path that is not prompt prose
// (markdown under `skills/`, `agents/`, or `commands/` counts as implementation), or a top-level
// `docs/plans/*.html` diagram — the same test/docs exclusion computeDiffFacts applies to a
// diff, read here against the spec's own file list. Zero implementation files still qualifies
// (a docs-only or test-only record): the gate is "at most MAX_IMPLEMENTATION_FILES", not
// "exactly that many". The express lane builds up to EXPRESS_MAX_KEY_FILES Key Files with no
// plan at all, and the micro-plan path keeps the task review and the review lenses, so it needs
// no stricter bound; it stays a separate constant because the express lane counts every Key File
// while this gate counts implementation files only.
//
// Read-only entries (#3696). An entry whose own note marks it read-only is not counted: the
// build reads it and changes nothing, so it adds no task structure. A note marks it read-only,
// in any case, only through `read only` or `read-only`, or through a `no change` or `no changes`
// that ends the note or a clause (followed by `)`, `,`, `.`, `;` or the note's end). Any other
// phrasing counts the entry: `(modify — no change to callers)` is an edit. #3696's one-file
// fix went through the full writing-plans path because
// `check-staged-stack.js — CLI exit path (read only, no change)` was counted as a second file.
//
// Parse-signal discipline: an absent or partly unparsed Key Files section (keyFileEntries null,
// or unparsed > 0) and a Risk-flags line that cannot be read (or a non-string body) are reported as `unreadable`, never
// folded into a pass or into a failed condition. An unreadable input cannot be judged, so its
// condition is left out of `failed`; `passes` is false either way.

const { computeDiffFacts } = require('../dispatch/ceremony-derive');
const { parseRiskFlags } = require('./record-risk-flags');

const MICRO_PLAN_CONDITIONS = Object.freeze(['fast-lane-ceremony', 'low-size', 'implementation-file-limit', 'no-risk-flag']);
const MAX_IMPLEMENTATION_FILES = 3;
// The header's read-only rule; it fails closed, so a phrasing it does not name counts the entry.
const READ_ONLY_NOTE_RE = /\bread[ -]only\b|\bno changes?\b\s*(?:[),.;]|$)/i;

// entries: [{path, note}] (extractKeyFileEntries's shape) -> number of implementation files.
function countImplementationFiles(entries) {
  const paths = (entries || [])
    .filter((e) => !READ_ONLY_NOTE_RE.test(e.note || ''))
    .map((e) => ({ path: e.path, additions: 0, deletions: 0 }));
  return computeDiffFacts(paths).implFiles;
}

// -> {passes, failed, unreadable}. `failed` lists every evaluable failing condition id in
// MICRO_PLAN_CONDITIONS order; `unreadable` is null, 'key-files' or 'risk-flags'.
function evaluateMicroPlanGate({ ceremony, size, keyFileEntries, body } = {}) {
  const keyFilesReadable = !!keyFileEntries && Array.isArray(keyFileEntries.entries) && keyFileEntries.unparsed === 0;
  const risk = parseRiskFlags(body);
  const riskReadable = typeof body === 'string' && risk.status !== 'unknown';

  const holds = {
    'fast-lane-ceremony': () => ceremony === 'fast-lane',
    'low-size': () => size === 'low',
    'implementation-file-limit': () => !keyFilesReadable || countImplementationFiles(keyFileEntries.entries) <= MAX_IMPLEMENTATION_FILES,
    'no-risk-flag': () => !riskReadable || risk.flags.length === 0,
  };
  const failed = MICRO_PLAN_CONDITIONS.filter((id) => !holds[id]());
  let unreadable = null;
  if (!keyFilesReadable) unreadable = 'key-files';
  else if (!riskReadable) unreadable = 'risk-flags';
  return { passes: failed.length === 0 && unreadable === null, failed, unreadable };
}

module.exports = { MICRO_PLAN_CONDITIONS, MAX_IMPLEMENTATION_FILES, countImplementationFiles, evaluateMicroPlanGate };
