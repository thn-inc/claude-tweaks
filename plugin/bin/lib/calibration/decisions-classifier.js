'use strict';

// Closed vocabulary the terminal-decision log line writes (Task 3 adds the
// writer in wrap-up/review-console-interactive.md and flow/multispec-review-console.md;
// this array is the single source both prose and this parser cite).
const TERMINAL_DECISION_VALUES = ['approve-all', 'approve-all-merge', 'leave-pr-open', 'override', 'stop'];

const { DECISION_STATUSES } = require('../log-decision/append.js');

// The calibration reader's entry shape (a dashed status line), unchanged since before the
// step yield existed: classifyDecisionLine keeps it, so calibration counts over archived
// runs never move.
const KIND_RE_STRICT = /^-\s+(AUTO|STAGED|KEPT-PROMPT|REFUSED|SCANNED|SKIP|FAILED)\b/;
// The lenient reading, opt-in (classifyDecisionLineLenient, isStructuralLine; the step
// yield only): the leading dash is optional, because archived logs carry status-led lines
// without it.
const STATUS_ALT = DECISION_STATUSES.join('|');
// Whitespace must follow the status: `AUTO-merge was declined` is prose, not an entry.
const KIND_RE = new RegExp(`^(?:-\\s+)?(${STATUS_ALT})(?=\\s)`);
const CLOCK_RE = new RegExp(
  `^(?:-\\s+)?(?:${STATUS_ALT})\\s+(?:(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z)|(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)(?=\\s|$)`,
);
const CONFIG_KEY_RE = /^(?:-\s+)?[a-z][a-z0-9-]*:(?:\s|$)/;
const TERMINAL_RE = new RegExp(
  `Review Console: terminal decision (${TERMINAL_DECISION_VALUES.join('|')})\\.`,
);
const REVERSIBILITY_RE = /Reversibility:\s*(high|med|low|n\/a)/;

function classifyWith(kindRe, line) {
  const kindMatch = kindRe.exec(line);
  if (!kindMatch) return { kind: 'other' };
  const result = { kind: kindMatch[1] };
  const terminalMatch = TERMINAL_RE.exec(line);
  if (terminalMatch) result.terminalDecision = terminalMatch[1];
  const reversibilityMatch = REVERSIBILITY_RE.exec(line);
  if (reversibilityMatch) result.reversibility = reversibilityMatch[1];
  if (/auto-resolved/.test(line)) result.autoResolved = true;
  return result;
}

// The calibration reader's classification: a dashed status line only.
function classifyDecisionLine(line) { return classifyWith(KIND_RE_STRICT, line); }

// Opt-in lenient reading for the step yield: the dash after the status is optional and
// `AUTO-merge` prose is not an entry. Calibration never calls it.
function classifyDecisionLineLenient(line) { return classifyWith(KIND_RE, line); }

// The time token after the status: { h, m, s } for HH:MM[:SS], { iso } for an ISO
// timestamp, null when the line carries no readable time.
function entryClock(line) {
  const match = CLOCK_RE.exec(line);
  if (!match) return null;
  if (match[1]) return { iso: match[1] };
  return { h: Number(match[2]), m: Number(match[3]), s: match[4] === undefined ? 0 : Number(match[4]) };
}

// Lines a decisions.md carries that are not log entries: blanks, headings, the
// Manifesto's config snapshot block and its key: value bullets, continuations.
function isStructuralLine(line) {
  if (line.trim() === '') return true;
  if (/^\s/.test(line)) return true;
  if (line.startsWith('#')) return true;
  if (line.startsWith('Pipeline config snapshot:')) return true;
  if (KIND_RE.test(line)) return false;
  return CONFIG_KEY_RE.test(line);
}

module.exports = { classifyDecisionLine, classifyDecisionLineLenient, entryClock, isStructuralLine, DECISION_STATUSES, TERMINAL_DECISION_VALUES };
