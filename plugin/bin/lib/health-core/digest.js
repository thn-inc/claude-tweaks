'use strict';
const { parseMarkerFingerprints } = require('./fingerprint');

// Drain-rate cap + digest mode (#235). When an origin's open-singleton
// finding count is at or above the `health-open-cap` policy value, a
// brand-new finding that would otherwise file its own issue is instead
// appended to a single per-origin digest issue. Below the cap, behavior is
// byte-identical to today's unconditional filing.
//
// Pure — no I/O, no gh calls, no network. The skill's FILE step calls
// decideFilingMode per survivor and, for a 'digest' result, uses the body
// builders below to compose the gh issue create/edit payload itself; this
// module never calls gh.
//
// Dedup continuity (no re-judging, no duplicate digest entries) is achieved
// by folding digest-embedded fingerprints back into the same issue-index
// dedup.js already consults — see expandDigestFingerprints below — rather
// than adding a second, parallel dedup path.

const DIGEST_MARKER_PREFIX = 'digest-fingerprint';

// action: the dedup.js decision for this finding ('file' | 'reopen' | 'skip'
// | 'suppress' | 'remember'). Only a brand-new 'file' decision is subject to
// the cap — a regression ('reopen') is not new inventory and must retain its
// proven drain history (#235 Gotchas), and 'skip'/'suppress'/'remember'
// already avoid filing for reasons unrelated to inventory size.
// openCount: this origin's currently-open *singleton* finding count (the
// caller derives it via countOpenSingletons below — never counts the digest
// issue itself, never counts human-filed issues that merely share the
// origin label).
// cap: the effective `health-open-cap` policy value. A non-positive or
// non-finite cap disables the throttle entirely (today's unconditional
// filing behavior), so an unset policy key is a strict no-op, not a silent
// behavior change.
function decideFilingMode({ action, openCount, cap }) {
  if (action !== 'file') return 'normal';
  if (!Number.isFinite(cap) || cap <= 0) return 'normal';
  if (openCount < cap) return 'normal';
  return 'digest';
}

// rawIssues: the array the skill's GATHER OPEN ISSUES step already builds —
// [{ number, state, labels, fingerprint, body }]. digestLabel: the
// origin-specific label a digest issue carries (e.g. 'code-health:digest').
// A digest issue is excluded from the singleton count; nothing else about
// its labels or fingerprint marker matters here.
function isDigestIssue(issue, digestLabel) {
  return Array.isArray(issue && issue.labels) && issue.labels.includes(digestLabel);
}

function countOpenSingletons(rawIssues, digestLabel) {
  return (rawIssues || []).filter(
    (i) => i && String(i.state).toLowerCase() === 'open' && !isDigestIssue(i, digestLabel),
  ).length;
}

// Returns the first open issue carrying digestLabel, or undefined. Origin
// state is assumed to hold at most one open digest issue at a time — the
// skill's filing loop is responsible for that invariant (reusing the same
// issue on every append rather than creating a second one).
function findOpenDigestIssue(rawIssues, digestLabel) {
  return (rawIssues || []).find(
    (i) => i && String(i.state).toLowerCase() === 'open' && isDigestIssue(i, digestLabel),
  );
}

// A digest issue's body embeds one marker per checklist entry:
//   <!-- digest-fingerprint: <fp> -->
// Extracts every embedded fingerprint from a body string.
function parseDigestFingerprints(body) {
  return parseMarkerFingerprints(body, DIGEST_MARKER_PREFIX);
}

// Expands a digest issue's embedded fingerprints into the same
// { number, state, labels, fingerprint } shape the skill's Step 2 already
// builds for singleton issues, so dedup.js's existing "open issue match ->
// skip" branch (bin/lib/health-core/dedup.js / bin/lib/code-health/dedup.js)
// naturally recognizes an already-digested finding on the next run — no
// separate dedup path, no re-judging, no duplicate digest entries. Callers
// concatenate this module's output onto the raw issue array before building
// the fingerprint index (loadIssueIndex).
function expandDigestFingerprints(rawIssues, digestLabel) {
  const out = [];
  for (const issue of rawIssues || []) {
    if (!issue || !isDigestIssue(issue, digestLabel)) continue;
    for (const fingerprint of parseDigestFingerprints(issue.body)) {
      out.push({
        number: issue.number, state: issue.state, labels: issue.labels, fingerprint,
      });
    }
  }
  return out;
}

function digestEntryLine(finding) {
  const title = String((finding && (finding.title || finding.criterion)) || finding.id || 'untitled').trim();
  return `- [ ] **${title}** <!-- ${DIGEST_MARKER_PREFIX}: ${finding.id} -->`;
}

function initialDigestBody(originLabel) {
  return [
    `Digest of \`${originLabel}\` findings held back by the open-issue cap (\`health-open-cap\`).`,
    '',
    'Each checklist item below is a finding that would otherwise have filed its own issue. To act on '
      + 'one, file it as a real record directly and check it off here — this issue itself is never '
      + '"resolved," only pruned by `/claude-tweaks:tidy` once its entries are stale.',
    '',
  ].join('\n');
}

// Appends one checklist line per finding not already present (matched by
// fingerprint) — fingerprint continuity: a finding already digested on a
// prior run must not produce a second checklist line this run. Findings is
// an array of { id, title?, criterion? } — the same fingerprinted-finding
// shape the skill already holds after Step 8's validate/fingerprint pass.
function appendDigestEntries(body, findings) {
  const existing = new Set(parseDigestFingerprints(body));
  const newLines = (findings || [])
    .filter((f) => f && f.id && !existing.has(f.id))
    .map((f) => digestEntryLine(f));
  if (newLines.length === 0) return { body: body || '', appended: 0 };
  const base = body || '';
  const sep = base && !base.endsWith('\n') ? '\n' : '';
  return { body: `${base}${sep}${newLines.join('\n')}\n`, appended: newLines.length };
}

module.exports = {
  DIGEST_MARKER_PREFIX,
  decideFilingMode,
  isDigestIssue,
  countOpenSingletons,
  findOpenDigestIssue,
  parseDigestFingerprints,
  expandDigestFingerprints,
  digestEntryLine,
  initialDigestBody,
  appendDigestEntries,
};
