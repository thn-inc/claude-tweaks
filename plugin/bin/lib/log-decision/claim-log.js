// The /flow Step 2.8 claim-log line (`flow/claim-targets.md`'s "Log the
// claim", #2492) — its shape, stated once. Two readers consume it:
// bin/lib/flow/preflight.js (a decisions.md holding only these lines is still
// a fresh mint, #2861) and bin/lib/hooks/pre-tool-use.js's hasLoggedClaim
// (#2526). tests/bin-lib/log-decision/claim-log.test.js pins these constants
// to the argv claim-targets.md documents. hasClaimLogFor also accepts a line
// the model worded in its own words (paraphrasedClaimNumbers, #3012); the
// isClaimLogEntry shape check stays exact. classifyDecisions also accepts a
// complete paraphrased claim line and Step 2.8's own bookkeeping lines (#3665).
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
// Paraphrase recognition (#3012): a model-worded Step 2.8 claim line ("claimed
// issue #827 for this run", "both #1447 and #1446 claimed successfully") still
// records the claim. A negated ("never itself claimed #N") or contested line
// does not, and a bare number needs the line to name the claim step.
const AUTO_LINE_RE = /^\s*-\s+AUTO\b/;
const CONTESTED_RE = /\bcontested\b/i;
const FAILED_RE = /\bFAILED\b/;
const REVERSIBILITY_SPLIT_RE = /\sReversibility:/;
const CLAIM_ANCHOR_RE = /\bStep 2\.8\b|\bclaim-targets\b|\bclaims-registry\b|\bissue-claims\b/i;
const NEGATED_SRC = String.raw`(?<!(?:\b(?:not|never|no|would|could|should|might|another|other|sibling)\b|n't)(?:\s+[\w'-]+){0,2}\s+)`;
const NUM_LIST_SRC = String.raw`#?\d+(?:(?:\s*,\s*|\s+and\s+|\s+)#?\d+)*`;
const HASH_LIST_SRC = String.raw`#\d+(?:(?:\s*,\s*|\s+and\s+|\s+)#\d+)*`;
const LIST_END_SRC = String.raw`(?![\w#/:-]|\.\d)`;
// "claimed [both|group|the] [issue(s)|target(s)|record(s)] <list>"
const FORWARD_RE = new RegExp(`${NEGATED_SRC}\\bclaimed\\s+(?:(?:both|group|the)\\s+)?(?:(?:issues?|targets?|records?)\\s+)?(${NUM_LIST_SRC})${LIST_END_SRC}(?!\\s*(?:targets?|issues?|records?|members?|of)\\b)`, 'gi');
// "<#list> [were|was|both|all|each|successfully] claimed" — never "claimed by"
const BACKWARD_RE = new RegExp(`(${HASH_LIST_SRC})${LIST_END_SRC}\\s+(?:(?:were|was|both|all|each|successfully)\\s+)*claimed\\b(?!\\s+by\\b)`, 'gi');

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

// A complete entry: the `Reversibility: <value>.` suffix formatEntry always
// appends closes the line (a qualifier such as "n/a (informational)" is fine).
const COMPLETE_RE = /\sReversibility: [^.\s][^.]*\.$/;
const BOOKKEEPING_LOCATION_RE = /^Step 2\.8 (?:file-overlap (?:warning|check)|bot:in-progress projection)\b/;
const BOOKKEEPING_STATUSES = new Set(['AUTO', 'SKIP', 'SCANNED']);

// Step 2.8's own non-claim lines (#3665): the file-overlap warning/check and the
// bot:in-progress projection. claim-targets.md documents two SKIP shapes
// ("Step 2.8 file-overlap warning (skipped)", "Step 2.8 bot:in-progress
// projection (degraded)"); a model words the same notes as AUTO/SCANNED lines
// ("Step 2.8 file-overlap warning: ...", "Step 2.8 file-overlap check: ..."). The
// match is anchored on the entry's location — a `log-decision:`-located line
// that merely mentions Step 2.8 is not bookkeeping — and on a complete entry.
function isClaimStepBookkeepingEntry(line) {
  const entry = parseEntry(line);
  if (!entry || !BOOKKEEPING_STATUSES.has(entry.status)) return false;
  if (!BOOKKEEPING_LOCATION_RE.test(entry.location.replace(/^spec #\d+ — /, ''))) return false;
  return COMPLETE_RE.test(String(line));
}

// The record numbers one decisions.md line positively records as claimed
// (empty when none). Only the text before the `Reversibility:` suffix counts.
function paraphrasedClaimNumbers(line) {
  const text = String(line || '');
  if (!AUTO_LINE_RE.test(text) || CONTESTED_RE.test(text) || FAILED_RE.test(text)) return [];
  const cut = text.search(REVERSIBILITY_SPLIT_RE);
  const head = cut === -1 ? text : text.slice(0, cut);
  const anchored = CLAIM_ANCHOR_RE.test(head);
  const found = new Set();
  for (const m of head.matchAll(FORWARD_RE)) {
    for (const tok of m[1].matchAll(/(#?)(\d+)/g)) {
      if (tok[1] || anchored) found.add(Number(tok[2]));
    }
  }
  if (anchored) {
    for (const m of head.matchAll(BACKWARD_RE)) {
      for (const tok of m[1].matchAll(/#(\d+)/g)) found.add(Number(tok[1]));
    }
  }
  return [...found];
}

// Whole-file search, unanchored — hasLoggedClaim's long-standing semantics:
// the exact number (word-bounded, so #7 never matches #700), or the batch
// form, which covers every record in an all-or-abort group claim. A line
// that paraphrases the claim also counts (#3012).
function hasClaimLogFor(body, n) {
  const text = String(body || '');
  if (hasCanonicalClaimLogFor(text, n)) return true;
  if (BATCH_LOG_RE.test(text)) return true;
  const want = Number(n);
  return text.split(/\r?\n/).some((line) => paraphrasedClaimNumbers(line).includes(want));
}

// The exact per-target Step 2.8 line only — no batch form, no paraphrase.
// For a check that must confirm the line claim-targets.md dictates was
// actually written (verify-run-bookends.js, #2912), where hasClaimLogFor's
// lenient readers would accept a line a later parser cannot classify.
function hasCanonicalClaimLogFor(body, n) {
  return new RegExp(`${STEP_SRC}: claimed #${n}\\b`).test(String(body || ''));
}

// A complete, model-worded claim line that names the claim step (#3665) —
// paraphrasedClaimNumbers alone also takes a bare "#N claimed" line anywhere.
// The anchor must belong to the entry's LOCATION (the step or script that wrote
// the line), not just its text: a later-step line that merely mentions the claim
// ("Step 3: ... claims-registry shows #7 claimed") is content. A line written
// with no --step carries the `log-decision` location formatEntry defaults to, so
// its head text is the only anchor there; a line parseEntry cannot split (the
// timestamp-less #3012 shape) falls back to the head-text anchor too.
function isAnchoredParaphrasedClaim(line) {
  if (!COMPLETE_RE.test(line) || paraphrasedClaimNumbers(line).length === 0) return false;
  const headAnchored = CLAIM_ANCHOR_RE.test(line.slice(0, line.search(REVERSIBILITY_SPLIT_RE)));
  const entry = parseEntry(line);
  if (!entry) return headAnchored;
  const location = entry.location.replace(/^spec #\d+ — /, '');
  if (location === 'log-decision') return headAnchored;
  return CLAIM_ANCHOR_RE.test(location);
}

// decisions.md text (null = file absent) -> 'absent' | 'empty' |
// 'claim-log-only' | 'content'. 'claim-log-only' needs at least one claim
// entry and nothing else but blank lines, the section heading the writer
// itself adds, and Step 2.8's own bookkeeping lines (#3665). A claim entry is
// the exact canonical line, or a complete paraphrased one that is also
// claim-anchored (names Step 2.8 / claim-targets / claims-registry /
// issue-claims in the entry's location — an unanchored "claimed #N" elsewhere is
// content) (#3665). The "nothing rides behind the claim" guarantee on the
// ACTION_RE comment above is isClaimLogEntry-only: a paraphrase such as
// "Step 2.8: claimed #7 and also wrote config.yml by hand" is accepted here, a
// documented consequence of accepting model-worded claims. Every line this
// cannot positively recognise is 'content' — a parse failure never reads as
// "only claim lines".
function classifyDecisions(text) {
  if (text === null || text === undefined) return 'absent';
  const str = String(text);
  if (!str.trim()) return 'empty';
  let claims = 0;
  for (const raw of str.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === SECTION_HEADING) continue;
    if (isClaimLogEntry(line) || isAnchoredParaphrasedClaim(line)) {
      claims += 1;
    } else if (!isClaimStepBookkeepingEntry(line)) {
      return 'content';
    }
  }
  return claims > 0 ? 'claim-log-only' : 'content';
}

module.exports = {
  CLAIM_LOG_SECTION, CLAIM_LOG_STEP, claimLogText, isClaimLogEntry, isClaimStepBookkeepingEntry, hasClaimLogFor, hasCanonicalClaimLogFor, paraphrasedClaimNumbers, classifyDecisions,
};
