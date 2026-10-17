'use strict';

// The single source of truth for every skill-size number (#3306, parent
// #3305). Constants plus two pure helpers — no I/O, and no `require`, so every
// later unit can import it without a cycle.
//
// A size limit blocks CI only where it guards a real platform limit: the Read
// tool's 25,000-token and 2,000-line caps. The rails sit AT those caps
// (RAIL_RATIO 1.0). The margin is BYTES_PER_TOKEN itself: the lowest ratio
// measured, taken from the densest real file, where typical skill prose runs
// ~2.65 B/token. An 80% rail was specified first; at the measured ratio it
// landed at 42,000 B, under 17 shipped files, and was set to the cap at the
// build's plan-validation gate.
//
// Calibration (Task 0) — 2026-10-17, `claude --version`: 2.1.302 (Claude Code).
// Three scratchpad samples, each read with the Read tool and no offset/limit:
//   (a) `git ls-files 'plugin/skills/*.md' 'plugin/skills/**/*.md'`, LC_ALL=C
//       ascending, joined by \n, 8 files:  121,252 B, 1,194 lines → N = 45,241 tokens (2.680 B/token)
//   (b) the same, descending, 9 files:     135,953 B, 1,597 lines → N = 51,251 tokens (2.653 B/token)
//   (c) dispatch/queue-pull-script.md ×3: 138,746 B, 2,013 lines → N = 65,782 tokens (2.109 B/token)
// BYTES_PER_TOKEN = the lowest, 2.109, rounded down to one decimal: 2.1.
//
// Non-token failure messages: none — Read 2.1.302 no longer fails over the
// cap. It returns a paged partial view instead; N is that view's total. (a)'s,
// verbatim (scratchpad path elided):
//   [Truncated: PARTIAL view — …/calib/sample-a.md: showing lines 1-560 of 1194
//   total (45241 tokens, cap 25000). Call Read with offset=561 limit=560 for the
//   next page, or Grep to find a specific section. Do NOT answer from this page
//   alone if the answer may be further in the file.]
// A file over the cap still cannot be read in one call, so the rail still
// guards a real limit.
//
// A point-in-time snapshot: re-run the calibration when a Claude Code release
// changes the Read limits or the tokenizer (#3304 tracks those drift checks).

const READ_TOKEN_CAP = 25000; // Read tool default cap (Claude Code 2.1.302)
const READ_LINE_CAP = 2000; // Read returns up to 2,000 lines without offset/limit
// Bash inline output cap — informational, NOT a rail. Skill prose instructs
// the Read tool, never `cat`; #611's 34.3 KB "truncation" was this cap, not a
// single-read ceiling, and a 30,000-char rail would sit below files shipping today.
const BASH_OUTPUT_CAP_CHARS = 30000;
const RAIL_RATIO = 1.0;
const RAIL_TOKENS = Math.floor(READ_TOKEN_CAP * RAIL_RATIO);
const RAIL_LINES = Math.floor(READ_LINE_CAP * RAIL_RATIO);
const BYTES_PER_TOKEN = 2.1; // calibrated above, rounded down to one decimal
const RAIL_BYTES = Math.floor(RAIL_TOKENS * BYTES_PER_TOKEN);
// skillListingMaxDescChars default. The CLI counts description characters
// exactly — no estimate to absorb, so no margin.
const DESCRIPTION_MAX_CHARS = 1536;
const LISTING_BUDGET_FRACTION = 0.01; // skillListingBudgetFraction default
const LISTING_CHARS_PER_TOKEN = 4;

function listingBudgetChars(contextTokens) {
  return Math.floor(contextTokens * LISTING_CHARS_PER_TOKEN * LISTING_BUDGET_FRACTION);
}

// Entries over the byte rail, or over the line rail when they carry `lines`.
// An entry without a `lines` field (a composed bundle) is judged on bytes only.
function overRail(entries) {
  return entries.filter((e) => e.bytes > RAIL_BYTES || (typeof e.lines === 'number' && e.lines > RAIL_LINES));
}

module.exports = {
  READ_TOKEN_CAP,
  READ_LINE_CAP,
  BASH_OUTPUT_CAP_CHARS,
  RAIL_RATIO,
  RAIL_TOKENS,
  RAIL_LINES,
  BYTES_PER_TOKEN,
  RAIL_BYTES,
  DESCRIPTION_MAX_CHARS,
  LISTING_BUDGET_FRACTION,
  LISTING_CHARS_PER_TOKEN,
  listingBudgetChars,
  overRail,
};
