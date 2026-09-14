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
// candidate that is itself `ready` with an in-flight build.
'use strict';

const { extractKeyFiles } = require('./grouping');
const { normalizeLabelNames } = require('./record');

// Jaccard similarity over lowercased word tokens, at or above this
// threshold, is the title-similarity signal (#2 below). A screen, not a
// merge decision (memory: similarity scores are normalization-sensitive) —
// ship the tokenizer with fixtures rather than tuning this in prose.
const DEFAULT_TITLE_SIMILARITY_THRESHOLD = 0.5;

// Common function words plus this repo's own generic record-vocabulary
// filler — stripped before tokenizing a title so two titles that only share
// scaffolding words ("Add a check for X" / "Add a check for Y") don't
// spuriously clear the Jaccard threshold on scaffolding alone.
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

// Extracts every backticked span (a named symbol or file path, by this
// record contract's own convention — `spec-template.md`'s `### Key Files`
// bullets and prose both use backticks for exactly this) found under a
// body's `## Current State` section, stopping at the next heading of any
// level. Returns a Set; empty when the body has no such section.
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
      if (value) anchors.add(value);
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
// Returns [{ number, title, score, signals }], sorted by score descending
// then number ascending — score is the count of signals that fired (1-3);
// a record with zero fired signals is never included.
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
    let anchorOverlap = false;
    for (const anchor of recordAnchors) {
      if (subjectAnchors.has(anchor)) { anchorOverlap = true; break; }
    }
    if (anchorOverlap) signals.push('body-anchor-overlap');

    if (signals.length > 0) {
      results.push({ number: record.number, title: record.title, score: signals.length, signals });
    }
  }

  results.sort((a, b) => b.score - a.score || a.number - b.number);
  return results;
}

module.exports = {
  findNearDuplicates,
  tokenizeTitle,
  jaccard,
  extractCurrentStateAnchors,
  isReconcileResidueTitle,
  DEFAULT_TITLE_SIMILARITY_THRESHOLD,
};
