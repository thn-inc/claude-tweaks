// bin/lib/issues/near-duplicate.js
// Pure: a candidate finder for near-duplicate open records — screens a
// subject record against a pool of others (typically the session's already-
// fetched open-record snapshot, `_shared/record-queue-fetch.md`) for three
// independent signals: shared Key Files, similar titles, and shared body
// anchors under `## Current State`. Used at /specify shaping time
// (`specify/shaping-mode.md`) and by /dispatch's cross-group check
// (`dispatch/queue-pull-script.md`). No network, no I/O.
//
// This is a SCREEN, not a verdict (#1944) — a candidate surfaced here is
// worth a human's (or the shaper's own) attention, never grounds for an
// automatic close on its own. The one exception the caller (shaping-mode.md)
// applies on top of this module's output is narrow and documented there: a
// title-similar candidate that is itself `ready` with an in-flight build, and
// that carries at least MIN_REFUSAL_SCORE signals — `shapingRefusal` below
// (#3141, #3366).
'use strict';

const { extractKeyFiles } = require('./grouping');
const { normalizeLabelNames, partitionByOpenLinkedPR } = require('./record');
const { classifyClaimBlob } = require('./claims');

// Jaccard similarity over lowercased word tokens, at or above this
// threshold, is the title-similarity signal (#2 below). A screen, not a
// merge decision (memory: similarity scores are normalization-sensitive) —
// ship the tokenizer with fixtures rather than tuning this in prose.
//
// #2331: distinct from coordination.js's SUBSTANCE_SIMILARITY_MIN by design,
// not oversight — same Jaccard-over-tokens primitive, but tuned against a
// different input domain (short imperative record titles here vs. free-text
// finding descriptions there), each threshold calibrated for its own
// domain's false-positive rate. Consolidating the constants would risk
// silently shifting one or both call sites' behavior; see tokenizeTitle
// below vs. coordination.js's tokenizeSubstance for the matching
// preprocessing difference (#N record-ref stripping vs. path:line
// stripping).
const DEFAULT_TITLE_SIMILARITY_THRESHOLD = 0.5;

// Common function words plus this repo's own generic record-vocabulary
// filler — stripped before tokenizing a title so two titles that only share
// scaffolding words ("Add a check for X" / "Add a check for Y") don't
// spuriously clear the Jaccard threshold on scaffolding alone.
//
// #2331: kept separate from coordination.js's SUBSTANCE_STOP_WORDS — this
// list is tuned for short imperative titles (needs filler words like
// "should"/"will"/"again" that rarely appear in finding text), not the
// longer free-text finding descriptions that list targets. Merging the
// lists risks changing which words get filtered for either caller.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with',
  'from', 'into', 'onto', 'over', 'under', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'had', 'do', 'does', 'did', 'not', 'no', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'than', 'then', 'so', 'if', 'when', 'while', 'before', 'after', 'about',
  'via', 'per', 'vs', 'both', 'each', 'own', 'same', 'such', 'only', 'also', 'can', 'will',
  'would', 'should', 'up', 'down', 'out', 'off', 'again', 'once', 'here', 'there', 'all', 'any',
]);

// Strips a leading "#N" record-reference token (e.g. "#refs" — a title
// occasionally opens with a cross-reference), all bare "#123" spans, numbers,
// and punctuation (hyphens kept as word separators), then filters stop words
// and empty tokens.
function tokenizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/#\d+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !STOP_WORDS.has(t));
}

// Jaccard similarity of two token arrays (as sets): |intersection| / |union|.
// Two empty token sets are defined as 0 similarity (nothing in common to
// match on), never divide-by-zero.
function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

const CURRENT_STATE_HEADING_RE = /^#{2,4}[ \t]+Current State[ \t]*$/;
const ANY_HEADING_RE = /^#{1,6}[ \t]/;

// #3141: backticked spans that are generic vocabulary, not identity
// anchors — widely cited across unrelated records, so a shared one says
// nothing about two records describing the same work. Four shapes:
// a flag (`--run-dir`, `-x`, optionally followed by ONE value token such
// as `<dir>` or `"$VAR"` — a flag followed by prose, like an error
// phrase, stays an anchor); a skill invocation (`/plugin:skill` with
// optional trailing arguments, or a bare `/skill` with none, #3366 — a
// colon-less word followed by prose, like `/settings page 500`, stays an
// anchor, and so does a multi-segment repo path like `/usr/bin/node`);
// any `family:value` token — label names, but also namespaced agent ids
// like `superpowers:using-git-worktrees` — whose family has no `.` or
// `/` and whose value has no `/` or `\`, so a `file.js:42` location or
// a `c:\path` stays an anchor; or a bare stage label.
const FLAG_ANCHOR_RE = /^--?[A-Za-z][\w-]*(?:[ =]\S+)?$/;
const SKILL_ANCHOR_RE = /^\/[\w-]+(?:(?::[\w-]+)+(?:\s.*)?)?$/;
const LABEL_ANCHOR_RE = /^[a-z][a-z0-9-]*:[^\s/\\]+$/;
const STAGE_LABELS = new Set(['ready', 'parked']);

function isGenericAnchor(value) {
  return FLAG_ANCHOR_RE.test(value) || SKILL_ANCHOR_RE.test(value)
    || LABEL_ANCHOR_RE.test(value) || STAGE_LABELS.has(value);
}

// Extracts every backticked span (a named symbol or file path, by this
// record contract's own convention — `spec-template.md`'s `### Key Files`
// bullets and prose both use backticks for exactly this) found under a
// body's `## Current State` section, stopping at the next heading of any
// level. Returns a Set; empty when the body has no such section.
// Generic vocabulary spans (isGenericAnchor) are skipped (#3141).
function extractCurrentStateAnchors(body) {
  const lines = (body || '').split('\n');
  const start = lines.findIndex((line) => CURRENT_STATE_HEADING_RE.test(line));
  if (start === -1) return new Set();
  const anchors = new Set();
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ANY_HEADING_RE.test(lines[i])) break;
    const matches = lines[i].match(/`([^`]+)`/g) || [];
    for (const m of matches) {
      const value = m.slice(1, -1).trim();
      if (value && !isGenericAnchor(value)) anchors.add(value);
    }
  }
  return anchors;
}

// Reconcile-filed residue records share titles by construction
// ("reconcile: structurally-stuck on …") — excluded from the title-
// similarity signal only (not from Key Files or body-anchor signals),
// per this record's own Gotchas, so a drain doesn't flag every reconcile
// residue record against every other one.
function isReconcileResidueTitle(title) {
  return /^reconcile:/i.test((title || '').trim());
}

// subject, records: issue-shaped objects — { number, title, body, labels }.
// opts.titleSimilarityThreshold overrides the default (0.5) for tests.
// Returns [{ number, title, score, signals, sharedAnchors }], sorted by score descending
// then number ascending — score is the count of signals that fired (1-3);
// a record with zero fired signals is never included. sharedAnchors (#3520)
// is the sorted Signal 3 intersection — [] when body-anchor-overlap did not fire.
function findNearDuplicates(subject, records, opts = {}) {
  const titleThreshold = opts.titleSimilarityThreshold ?? DEFAULT_TITLE_SIMILARITY_THRESHOLD;
  const subjectNumber = subject && subject.number;
  const subjectKeyFiles = extractKeyFiles(subject);
  const subjectKeyFilesSet = new Set(subjectKeyFiles);
  const subjectTokens = tokenizeTitle(subject && subject.title);
  const subjectAnchors = extractCurrentStateAnchors(subject && subject.body);

  const results = [];
  for (const record of records || []) {
    if (!record || record.number === subjectNumber) continue;
    const names = normalizeLabelNames(record.labels);
    if (names.includes('parent-issue') || names.includes('parked')) continue;

    const signals = [];

    // Signal 1: Key Files overlap — 2+ shared paths, or 1 shared path when
    // either side's own list has at most 2 entries (a small list makes a
    // single shared path proportionally significant).
    const recordKeyFiles = extractKeyFiles(record);
    const shared = [...new Set(recordKeyFiles.filter((f) => subjectKeyFilesSet.has(f)))];
    if (shared.length >= 2 || (shared.length === 1 && (subjectKeyFiles.length <= 2 || recordKeyFiles.length <= 2))) {
      signals.push('key-files-overlap');
    }

    // Signal 2: title similarity (Jaccard >= threshold), skipped for
    // reconcile-residue titles per the Gotcha above.
    if (!isReconcileResidueTitle(record.title)) {
      const similarity = jaccard(subjectTokens, tokenizeTitle(record.title));
      if (similarity >= titleThreshold) signals.push('title-similarity');
    }

    // Signal 3: the same named symbol/file path appears in both bodies'
    // `## Current State` sections.
    const recordAnchors = extractCurrentStateAnchors(record.body);
    const sharedAnchors = [...recordAnchors].filter((a) => subjectAnchors.has(a)).sort();
    if (sharedAnchors.length > 0) signals.push('body-anchor-overlap');

    if (signals.length > 0) {
      results.push({ number: record.number, title: record.title, score: signals.length, signals, sharedAnchors });
    }
  }

  results.sort((a, b) => b.score - a.score || a.number - b.number);
  return results;
}

// #3366: a refusal needs a score of at least MIN_REFUSAL_SCORE — a
// title-similarity hit alone (score 1) is surfaced, not refused.
const MIN_REFUSAL_SCORE = 2;

// #3520: one constant bounds both counts of a strong near-duplicate — shared
// Current State anchors or fired signals. Calibrated on real pairs: the
// conflicting #3417/#3419 shared 3 anchors, the clean #3417/#3012 shared 1.
const STRONG_NEAR_DUPLICATE_MIN = 2;

function isStrongNearDuplicate(hit) {
  if (!hit || typeof hit !== 'object') return false;
  const anchors = Array.isArray(hit.sharedAnchors) ? hit.sharedAnchors.length : 0;
  return anchors >= STRONG_NEAR_DUPLICATE_MIN || hit.score >= STRONG_NEAR_DUPLICATE_MIN;
}

// #3141: the refusal decision /specify shaping applies on top of the
// finder's screen (shaping-mode.md's Near-duplicate candidate check).
// stateByNumber[n]: { ready, liveClaim, claimRunId, openLinkedPR } — built
// by buildShapingState below. Returns the first hit (in the given order)
// whose signals include title-similarity, whose score is at least
// MIN_REFUSAL_SCORE, AND whose candidate is ready AND in flight (a live claim
// or an open linked PR); null otherwise. File and anchor overlap alone never
// refuse — they are build-collision signals, which /flow and /dispatch already
// handle. bot:in-progress is not read.
function shapingRefusal(hits, stateByNumber) {
  for (const hit of Array.isArray(hits) ? hits : []) {
    if (!hit || !Array.isArray(hit.signals) || !hit.signals.includes('title-similarity')) continue;
    if (hit.signals.length < MIN_REFUSAL_SCORE) continue;
    const state = stateByNumber && stateByNumber[hit.number];
    if (!state || state.ready !== true) continue;
    if (state.liveClaim === true || state.openLinkedPR) return hit;
  }
  return null;
}

// #3141: pure assembly of shapingRefusal's stateByNumber from raw reads —
// labels (the session snapshot), claim blob content (claims/issue-{n}.json
// on claims-registry; null/undefined = absent or unread), and the
// linked-PR GraphQL repository{} object (record.js's buildLinkedPRQuery
// shape; null = query failed or not run). Every missing or failed input
// degrades to "not in flight" — the finder is a screen, so a read failure
// must never cause a refusal.
function buildShapingState({ numbers, labelsByNumber, claimContentByNumber, linkedPRRepoData, now }) {
  const list = Array.isArray(numbers) ? numbers : [];
  const { excludedByOpenPR } = partitionByOpenLinkedPR(list.map((number) => ({ number })), linkedPRRepoData || null);
  const prByNumber = new Map(excludedByOpenPR.map((e) => [e.number, e.pr]));
  // A non-finite `now` makes isStale answer false for every claim, which
  // would read an expired claim as live — so liveness needs a real clock.
  const clockOk = Number.isFinite(now);
  const state = {};
  for (const n of list) {
    const labels = labelsByNumber && labelsByNumber[n];
    const ready = normalizeLabelNames(Array.isArray(labels) ? labels : []).includes('ready');
    const content = claimContentByNumber ? claimContentByNumber[n] : null;
    const liveClaim = clockOk && classifyClaimBlob(content, now).state === 'live';
    let claimRunId = null;
    if (liveClaim) {
      try { claimRunId = JSON.parse(content).runId || null; } catch { claimRunId = null; }
    }
    state[n] = { ready, liveClaim, claimRunId, openLinkedPR: prByNumber.get(n) ?? null };
  }
  return state;
}

module.exports = {
  findNearDuplicates,
  tokenizeTitle,
  jaccard,
  extractCurrentStateAnchors,
  isReconcileResidueTitle,
  isGenericAnchor,
  shapingRefusal,
  buildShapingState,
  MIN_REFUSAL_SCORE,
  STRONG_NEAR_DUPLICATE_MIN,
  isStrongNearDuplicate,
  DEFAULT_TITLE_SIMILARITY_THRESHOLD,
};
