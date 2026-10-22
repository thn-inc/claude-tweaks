// bin/lib/tiebreak.js — finding identity and the tiebreak-reply parser (#3945).
// Pure: no fs, no process (file reads go through the injected readFile). The
// resolver at the bottom maps a parsed reply to a ruling.
//
// findingId({ lens, path, line, claim }): the first 12 hex chars of
// sha1([lens, path, String(line), normClaim].join('\n')), where normClaim is
// the claim with whitespace runs collapsed to one space and trimmed. The claim
// is part of the id, so two findings at the same lens and path:line with
// different claims get different ids.
//
// Reply grammar (parseTiebreakReply). Lines are trimmed; each field line is
// `Field: value`, the field name matched case-insensitively:
//   Verdict: confirmed | refuted | cant-tell        value lowercased
//   Evidence: {path}:{line} {quote}                 quote = everything after the
//       first whitespace following path:line; one wrapping pair of backticks or
//       double quotes is stripped. An empty quote, a line below 1, or anything
//       else gives evidence: null.
//   Severity: {sev}                                 lowercased; a value outside
//       SEVERITIES gives severity: null.
//   Recommendation: file | drop [(— | - | :) reason]   a reason without a
//       separator, or any other value, gives recommendation: null.
//   STATUS: {WORD}                                  uppercased; MUST be the
//       last non-empty line of the reply (narration after it is a failure).
// The first line of a field wins, except Verdict: a Verdict line outside the
// set, or two Verdict lines that disagree, is not a usable verdict.
//
// Parse signal (parse-signal discipline): `parse` is 'could-not-parse' for an
// empty reply, no valid Verdict, or no trailing STATUS line — every field is
// null then, so a caller cannot read a verdict out of an unparsed reply. A
// reply that parses with any STATUS (BLOCKED, NEEDS_CONTEXT, …) is 'ok'; mapping
// a non-DONE status to can't-tell is the resolver's job, not the parser's.
'use strict';

const crypto = require('node:crypto');
const { severityRank, LINE_TOLERANCE_REPRODUCTION_WIDE } = require('./coordination');

const VERDICTS = ['confirmed', 'refuted', 'cant-tell'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function findingId({ lens, path, line, claim }) {
  const normClaim = String(claim).replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1')
    .update([lens, path, String(line), normClaim].join('\n'))
    .digest('hex')
    .slice(0, 12);
}

const FIELD_RE = /^(verdict|evidence|severity|recommendation)\s*:\s*(.*)$/i;
const STATUS_RE = /^status\s*:\s*([A-Za-z_]+)$/i;
const EVIDENCE_RE = /^(\S+):(\d+)(?:\s+([\s\S]*))?$/;

function unparsed() {
  return {
    parse: 'could-not-parse', verdict: null, evidence: null, severity: null,
    recommendation: null, recommendationReason: null, status: null,
  };
}

function stripWrapper(s) {
  if (s.length >= 2 && ((s[0] === '`' && s.endsWith('`')) || (s[0] === '"' && s.endsWith('"')))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseEvidence(value) {
  const m = EVIDENCE_RE.exec(value);
  if (!m) return null;
  const line = Number(m[2]);
  const quote = stripWrapper((m[3] || '').trim());
  if (line < 1 || quote === '') return null;
  return { path: m[1], line, quote };
}

function parseRecommendation(value) {
  const m = /^(file|drop)(?=$|\s|:|—)(.*)$/i.exec(value);
  if (!m) return { recommendation: null, recommendationReason: null };
  const rest = m[2].trim();
  if (rest === '') return { recommendation: m[1].toLowerCase(), recommendationReason: null };
  const sep = /^(?:—|-|:)\s*([\s\S]*)$/.exec(rest);
  if (!sep) return { recommendation: null, recommendationReason: null };
  return { recommendation: m[1].toLowerCase(), recommendationReason: sep[1].trim() || null };
}

function parseTiebreakReply(text) {
  if (typeof text !== 'string') return unparsed();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) return unparsed();

  const statusMatch = STATUS_RE.exec(lines[lines.length - 1]);
  if (!statusMatch) return unparsed();

  const fields = {};
  const verdicts = [];
  for (const line of lines.slice(0, -1)) {
    const m = FIELD_RE.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (name === 'verdict') verdicts.push(m[2].trim().toLowerCase());
    else if (!(name in fields)) fields[name] = m[2].trim();
  }

  if (verdicts.length === 0 || verdicts.some((v) => !VERDICTS.includes(v)) || new Set(verdicts).size > 1) {
    return unparsed();
  }

  const severity = fields.severity === undefined ? null : fields.severity.toLowerCase();
  const rec = fields.recommendation === undefined
    ? { recommendation: null, recommendationReason: null }
    : parseRecommendation(fields.recommendation);

  return {
    parse: 'ok',
    verdict: verdicts[0],
    evidence: fields.evidence === undefined ? null : parseEvidence(fields.evidence),
    severity: SEVERITIES.includes(severity) ? severity : null,
    recommendation: rec.recommendation,
    recommendationReason: rec.recommendationReason,
    status: statusMatch[1].toUpperCase(),
  };
}

// ---- resolveTiebreak (#3945 Task 2) ----
//
// resolveTiebreak(finding, replyText, { readFile, now }) -> { id, outcome,
// severity, evidence, recommendation, reason, logLine, listInConsole, parse }.
// Fail toward scrutiny (IL-50): only a literal confirmed/refuted verdict, status
// DONE, and evidence verified against the file leave can't-tell. outcome is
// 'confirmed' | 'drop' | 'digest' | 'console'; digest/console are can't-tell,
// split by the higher of the reporter's and tiebreak's severities (low/info ->
// digest, medium+ -> console; neither known -> medium).

function knownSeverity(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  return SEVERITIES.includes(v) ? v : null;
}

function higher(a, b) {
  if (a && b) return severityRank(a) >= severityRank(b) ? a : b;
  return a || b || null;
}

function lower(a, b) {
  if (a && b) return severityRank(a) <= severityRank(b) ? a : b;
  return a || b || null;
}

function reporterSeverityOf(finding) {
  if (finding.kind === 'contested' && Array.isArray(finding.positions)) {
    const known = finding.positions.map((p) => knownSeverity(p && p.severity)).filter(Boolean);
    if (known.length > 0) return known.reduce((a, b) => higher(a, b));
  }
  return knownSeverity(finding.reporterSeverity);
}

// An integer, a numeric string, or "a-b" resolves to its first number; anything
// else (or a number below 1) is null.
function firstLine(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 1 ? raw : null;
  if (typeof raw !== 'string') return null;
  const m = /^\s*(\d+)(?:\s*[-–—]\s*\d+)?\s*$/.exec(raw);
  const n = m ? Number(m[1]) : null;
  return n !== null && n >= 1 ? n : null;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// Returns null when the evidence checks out against the file, else the reason.
function evidenceProblem(evidence, finding, line, readFile) {
  if (evidence.path !== finding.path) return 'evidence-path-mismatch';
  if (typeof readFile !== 'function') return 'evidence-unverified';
  let text;
  try { text = readFile(finding.path); } catch { return 'evidence-unverified'; }
  if (typeof text !== 'string') return 'evidence-unverified';
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (evidence.line > lines.length) return 'evidence-unverified';
  const lo = Math.max(1, line - LINE_TOLERANCE_REPRODUCTION_WIDE);
  const hi = Math.min(lines.length, line + LINE_TOLERANCE_REPRODUCTION_WIDE);
  const window = squash(lines.slice(lo - 1, hi).join(' '));
  return window.includes(squash(evidence.quote)) ? null : 'evidence-unverified';
}

function stamp(now) {
  const d = now instanceof Date ? now : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// resolve.js supersedes a STAGED line on a later AUTO line carrying the
// case-sensitive word Confirmed; a quote, lens, or path that happens to contain
// it must never make a non-confirmed line do that.
function neutralize(text) {
  return text.replace(/\bConfirmed\b/g, 'confirmed');
}

function resolveTiebreak(finding, replyText, { readFile, now } = {}) {
  const parsed = parseTiebreakReply(replyText);
  const id = findingId(finding);
  const t = stamp(now);
  const line = firstLine(finding.line);
  const shownLine = line !== null ? line : String(finding.line ?? 'unknown');
  const reporterSev = reporterSeverityOf(finding);
  const tiebreakSev = parsed.severity;
  const where = `lens "${finding.lens}" finding ${finding.path}:${shownLine}`;
  const result = (fields) => ({
    id, evidence: null, recommendation: parsed.recommendation, listInConsole: false, parse: parsed.parse, ...fields,
  });

  // Why this cannot be a confirmed/drop, in the order the causes are checked.
  let reason;
  if (parsed.parse === 'could-not-parse') reason = 'could-not-parse';
  else if (parsed.status !== 'DONE') reason = `status:${parsed.status}`;
  else if (parsed.verdict === 'cant-tell') reason = 'verdict:cant-tell';
  else if (!parsed.evidence) reason = 'no-evidence';
  else if (line === null) reason = 'no-line';
  else reason = evidenceProblem(parsed.evidence, finding, line, readFile);

  if (reason) {
    const sev = higher(reporterSev, tiebreakSev) || 'medium';
    const outcome = severityRank(sev) >= severityRank('medium') ? 'console' : 'digest';
    const text = outcome === 'console'
      ? `STAGED ${t} — Tiebreak tiebreak:${id}: ${where} console: ${reason}. Severity: ${sev}. Recommendation: ${parsed.recommendation ?? 'none'}. Reversibility: high.`
      : `AUTO ${t} — Tiebreak tiebreak:${id}: ${where} digested: ${reason}. Severity: ${sev}. Reversibility: high.`;
    return result({ outcome, severity: sev, reason, logLine: neutralize(text) });
  }

  const ev = parsed.evidence;
  if (parsed.verdict === 'confirmed') {
    return result({
      outcome: 'confirmed',
      severity: lower(reporterSev, tiebreakSev) || 'medium',
      evidence: ev,
      reason: 'confirmed by tiebreak',
      logLine: `AUTO ${t} — Reproduction: ${where} confirmed by tiebreak:${id}. Confirmed. Reversibility: high.`,
    });
  }
  const sev = higher(reporterSev, tiebreakSev) || 'medium';
  const text = `AUTO ${t} — Tiebreak tiebreak:${id}: ${where} dropped: refuted by tiebreak. Evidence: ${ev.path}:${ev.line} "${ev.quote}". Severity: ${sev}. Reversibility: high.`;
  return result({
    outcome: 'drop', severity: sev, evidence: ev, reason: 'refuted by tiebreak',
    listInConsole: sev === 'high' || sev === 'critical', logLine: neutralize(text),
  });
}

module.exports = { findingId, parseTiebreakReply, resolveTiebreak, VERDICTS, SEVERITIES };
