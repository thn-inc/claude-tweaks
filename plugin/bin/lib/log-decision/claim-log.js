// The /flow Step 2.8 claim-log line (`flow/claim-targets.md`'s "Log the
// claim", #2492) — its shape, stated once. Two readers consume it:
// bin/lib/flow/preflight.js (a decisions.md holding only these lines is still
// a fresh mint, #2861) and bin/lib/hooks/pre-tool-use.js's hasLoggedClaim
// (#2526). tests/bin-lib/log-decision/claim-log.test.js pins these constants
// to the argv claim-targets.md documents.
'use strict';

const { parseEntry } = require('./append');

const CLAIM_LOG_SECTION = '/flow';
const CLAIM_LOG_STEP = 'Step 2.8';
const STEP_SRC = CLAIM_LOG_STEP.replace(/\./g, '\\.');
// One line per target (the documented form), or the single batch summary a
// real multi-record run writes instead (#2636).
const BATCH_ACTION_SRC = 'Claimed all \\d+ targets under run\\b';
const BATCH_LOG_RE = new RegExp(`${STEP_SRC}: ${BATCH_ACTION_SRC}`);
// isClaimLogEntry matches the WHOLE action, end-anchored, including the
// `Reversibility:` suffix formatEntry always appends: a truncated line, or a
// claim prefix with anything else riding behind it, is not a claim entry.
const SINGLE_FULL_SRC = 'claimed #\\d+ \\(bin/claim-targets\\.js, transport: [a-z-]+\\)';
const BATCH_FULL_SRC = `${BATCH_ACTION_SRC} \\S+ \\([^()]*\\)`;
const ACTION_RE = new RegExp(`^(?:${SINGLE_FULL_SRC}|${BATCH_FULL_SRC})\\. Reversibility: [^.\\s][^.]*\\.$`);
const SECTION_HEADING = `## ${CLAIM_LOG_SECTION}`;

// The --text value claim-targets.md dictates for one claimed target.
function claimLogText(n, transport) {
  return `claimed #${n} (bin/claim-targets.js, transport: ${transport})`;
}

function isClaimLogEntry(line) {
  const entry = parseEntry(line);
  if (!entry || entry.status !== 'AUTO') return false;
  if (entry.location.replace(/^spec #\d+ — /, '') !== CLAIM_LOG_STEP) return false;
  return ACTION_RE.test(entry.action);
}

// Whole-file search, unanchored — hasLoggedClaim's long-standing semantics:
// the exact number (word-bounded, so #7 never matches #700), or the batch
// form, which covers every record in an all-or-abort group claim.
function hasClaimLogFor(body, n) {
  const text = String(body || '');
  if (new RegExp(`${STEP_SRC}: claimed #${n}\\b`).test(text)) return true;
  return BATCH_LOG_RE.test(text);
}

// decisions.md text (null = file absent) -> 'absent' | 'empty' |
// 'claim-log-only' | 'content'. 'claim-log-only' needs at least one claim
// entry and nothing else but blank lines and the section heading the writer
// itself adds. Every line this cannot positively recognise is 'content' — a
// parse failure never reads as "only claim lines".
function classifyDecisions(text) {
  if (text === null || text === undefined) return 'absent';
  const str = String(text);
  if (!str.trim()) return 'empty';
  let claims = 0;
  for (const raw of str.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === SECTION_HEADING) continue;
    if (!isClaimLogEntry(line)) return 'content';
    claims += 1;
  }
  return claims > 0 ? 'claim-log-only' : 'content';
}

module.exports = {
  CLAIM_LOG_SECTION, CLAIM_LOG_STEP, claimLogText, isClaimLogEntry, hasClaimLogFor, classifyDecisions,
};
