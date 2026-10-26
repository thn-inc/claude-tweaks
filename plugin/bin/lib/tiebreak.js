// bin/lib/tiebreak.js — finding identity and the tiebreak-reply parser (#3945).
// The parser and resolver are pure: no fs, no process (file reads go through the
// injected readFile). Only the findings-artifact reader and coverage check at the
// bottom touch the filesystem.
//
// findingId({ lens, path, line, claim }): the first 12 hex chars of
// sha1([lens, path, String(line), normClaim].join('\n')), where normClaim is
// the claim with whitespace runs collapsed to one space and trimmed. The claim
// is part of the id, so two findings at the same lens and path:line with
// different claims get different ids. A non-object finding, or a lens, path or
// claim that is not a string, throws a TypeError rather than hashing `undefined`.
//
// A finding is { lens, path, line, claim, reporterSeverity, kind, positions? }:
// kind is 'unconfirmed' | 'contested'; positions ([{ severity }], optional,
// contested only) are the two sides' severities. A contested finding's reporter
// severity is the higher known position severity; buildFindingsArtifact stores
// it as reporterSeverity, since the artifact does not keep positions.
//
// Reply grammar (parseTiebreakReply). Lines are trimmed; each field line is
// `Field: value`, the field name matched case-insensitively:
//   Verdict: confirmed | refuted | cant-tell        value lowercased
//   Evidence: {path}:{line} {quote}                 the path:line token may sit in
//       one backtick pair (`{path}`:{line} or `{path}:{line}`), which is
//       stripped. quote = everything after the
//       first whitespace following path:line; one wrapping pair of double
//       quotes, or a Markdown code span (any equal backtick run, padding
//       spaces dropped), is stripped. An empty or whitespace-only quote, a line
//       below 1, or anything else gives evidence: null.
//   Severity: {sev}                                 lowercased; a value outside
//       SEVERITIES gives severity: null.
//   Recommendation: file | drop [(— | – | - | : | ,) reason]   a reason without a
//       separator, or any other value, gives recommendation: null.
//   STATUS: {WORD}                                  uppercased; MUST be the
//       last non-empty line of the reply (narration after it is a failure).
// A field repeated with the same value is fine. Repeated with different values,
// it is not usable: two disagreeing Verdict lines (or one outside the set) leave
// no verdict, and disagreeing Evidence, Severity or Recommendation lines make
// that field null — a quoted fragment can never silently win.
//
// Parse signal (parse-signal discipline): `parse` is 'could-not-parse' for an
// empty reply, no valid Verdict, or no trailing STATUS line — every field is
// null then, so a caller cannot read a verdict out of an unparsed reply. A
// reply that parses with any STATUS (BLOCKED, NEEDS_CONTEXT, …) is 'ok'; mapping
// a non-DONE status to can't-tell is the resolver's job, not the parser's.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { severityRank, LINE_TOLERANCE_REPRODUCTION_WIDE } = require('./coordination');

const VERDICTS = ['confirmed', 'refuted', 'cant-tell'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function findingId(finding) {
  if (!finding || typeof finding !== 'object') throw new TypeError('findingId: finding must be an object');
  for (const key of ['lens', 'path', 'claim']) {
    if (typeof finding[key] !== 'string') throw new TypeError(`findingId: finding ${key} must be a string`);
  }
  const { lens, path, line, claim } = finding;
  const normClaim = claim.replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1')
    .update([lens, path, String(line), normClaim].join('\n'))
    .digest('hex')
    .slice(0, 12);
}

const FIELD_RE = /^(verdict|evidence|severity|recommendation)\s*:\s*(.*)$/i;
const STATUS_RE = /^status\s*:\s*([A-Za-z_]+)$/i;
const EVIDENCE_RE = /^(\S+):(\d+)(?:\s+([\s\S]*))?$/;
// A path:line token wrapped in one backtick pair: `path`:line or `path:line`.
const WRAPPED_TOKEN_RE = /^`([^`\s]+)`(:\d+)(?=\s|$)|^`([^`\s]+:\d+)`(?=\s|$)/;

function unparsed() {
  return {
    parse: 'could-not-parse', verdict: null, evidence: null, severity: null,
    recommendation: null, recommendationReason: null, status: null,
  };
}

// A Markdown code span: equal backtick runs on both ends, and one padding space
// dropped from each side when both are present (how a quote that itself starts
// or ends with a backtick is written). Unequal runs strip one backtick pair.
function stripWrapper(s) {
  if (s.length >= 2 && s[0] === '`' && s.endsWith('`')) {
    const open = /^`+/.exec(s)[0].length;
    const close = /`+$/.exec(s)[0].length;
    if (open !== close || s.length <= 2 * open) return s.slice(1, -1);
    const inner = s.slice(open, -close);
    return /^ [\s\S]* $/.test(inner) && inner.trim() !== '' ? inner.slice(1, -1) : inner;
  }
  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function parseEvidence(value) {
  const w = WRAPPED_TOKEN_RE.exec(value);
  const m = EVIDENCE_RE.exec(w ? (w[3] || w[1] + w[2]) + value.slice(w[0].length) : value);
  if (!m) return null;
  const line = Number(m[2]);
  const quote = stripWrapper((m[3] || '').trim());
  if (line < 1 || quote.replace(/\s+/g, ' ').trim() === '') return null;
  return { path: m[1], line, quote };
}

function parseRecommendation(value) {
  const m = /^(file|drop)(?=$|\s|:|,|—|–)(.*)$/i.exec(value);
  if (!m) return { recommendation: null, recommendationReason: null };
  const rest = m[2].trim();
  if (rest === '') return { recommendation: m[1].toLowerCase(), recommendationReason: null };
  const sep = /^(?:—|–|-|:|,)\s*([\s\S]*)$/.exec(rest);
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
    const value = m[2].trim();
    if (name === 'verdict') verdicts.push(value.toLowerCase());
    else if (!(name in fields)) fields[name] = value;
    else if (fields[name] !== value) fields[name] = null;
  }

  if (verdicts.length === 0 || verdicts.some((v) => !VERDICTS.includes(v)) || new Set(verdicts).size > 1) {
    return unparsed();
  }

  const severity = fields.severity == null ? null : fields.severity.toLowerCase();
  const rec = fields.recommendation == null
    ? { recommendation: null, recommendationReason: null }
    : parseRecommendation(fields.recommendation);

  return {
    parse: 'ok',
    verdict: verdicts[0],
    evidence: fields.evidence == null ? null : parseEvidence(fields.evidence),
    severity: SEVERITIES.includes(severity) ? severity : null,
    recommendation: rec.recommendation,
    recommendationReason: rec.recommendationReason,
    status: statusMatch[1].toUpperCase(),
  };
}

// ---- resolveTiebreak (#3945 Task 2) ----
//
// resolveTiebreak(finding, replyText, { readFile, now }) -> { id, outcome,
// severity, evidence, recommendation, reason, logLine, logStatus, logStep,
// logText, listInConsole, parse }. logStatus ('AUTO' | 'STAGED'), logStep and
// logText are what bin/log-decision.js (the sanctioned decisions.md writer)
// takes: its formatEntry({ status: logStatus, now, step: logStep, text: logText,
// reversibility: 'high' }) renders exactly '- ' + logLine, because logLine is
// derived from the same three fields.
// Fail toward scrutiny (IL-50): only a literal confirmed/refuted verdict, status
// DONE, and evidence verified against the file leave can't-tell. outcome is
// 'confirmed' | 'drop' | 'digest' | 'console'; digest/console are can't-tell,
// split by the higher of the reporter's and tiebreak's severities (low/info ->
// digest, medium+ -> console; neither known -> medium). A lens, path, or string
// line holding a line break (LINE_BREAK_RE) or the `tiebreak:` marker
// (MARKER_RE) is can't-tell with reason bad-finding-field, so a finding field
// can never forge a second decisions.md line or echo another finding's marker;
// the logLine is also whitespace-collapsed to one line.

const LINE_BREAK_RE = /[\r\n\u2028\u2029]/;
const MARKER_RE = /tiebreak:/i;
// The finding fields every verdict line echoes back.
const ECHOED_FIELDS = ['lens', 'path', 'line'];
function badEchoedField(finding, key) {
  const value = finding[key];
  return typeof value === 'string' && (LINE_BREAK_RE.test(value) || MARKER_RE.test(value));
}

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

// A contested finding's higher known position severity; null when the finding
// is not contested or no position carries a known severity. Shared by the
// resolver and buildFindingsArtifact, so the artifact keeps the severity the
// resolver would read from the positions it drops.
function positionSeverity(finding) {
  if (finding.kind !== 'contested' || !Array.isArray(finding.positions)) return null;
  const known = finding.positions.map((p) => knownSeverity(p && p.severity)).filter(Boolean);
  return known.length > 0 ? known.reduce((a, b) => higher(a, b)) : null;
}

function reporterSeverityOf(finding) {
  return positionSeverity(finding) || knownSeverity(finding.reporterSeverity);
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
// The cited line must sit within ±LINE_TOLERANCE_REPRODUCTION_WIDE of the
// finding's line, and the quote must carry content (three or more consecutive
// word characters), so `}` or `c` can never verify against a window.
function evidenceProblem(evidence, finding, line, readFile) {
  if (evidence.path !== finding.path) return 'evidence-path-mismatch';
  const quote = squash(evidence.quote);
  if (!/[A-Za-z0-9_]{3,}/.test(quote)) return 'evidence-unverified';
  if (Math.abs(evidence.line - line) > LINE_TOLERANCE_REPRODUCTION_WIDE) return 'evidence-unverified';
  // One guard for both: an absent or non-function reader throws here too.
  let text;
  try { text = readFile(finding.path); } catch { return 'evidence-unverified'; }
  if (typeof text !== 'string') return 'evidence-unverified';
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (evidence.line > lines.length) return 'evidence-unverified';
  const lo = Math.max(1, line - LINE_TOLERANCE_REPRODUCTION_WIDE);
  const hi = Math.min(lines.length, line + LINE_TOLERANCE_REPRODUCTION_WIDE);
  const window = squash(lines.slice(lo - 1, hi).join(' '));
  return window.includes(quote) ? null : 'evidence-unverified';
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
  const higherSev = higher(reporterSev, tiebreakSev) || 'medium';
  const where = `lens "${finding.lens}" finding ${finding.path}:${shownLine}`;
  const result = (fields) => ({
    id, evidence: null, recommendation: parsed.recommendation, listInConsole: false, parse: parsed.parse, ...fields,
  });
  const entry = (status, step, text) => {
    const log = { logStatus: status, logStep: squash(step), logText: squash(text) };
    return { ...log, logLine: squash(`${log.logStatus} ${t} — ${log.logStep}: ${log.logText} Reversibility: high.`) };
  };
  const tiebreakStep = `Tiebreak tiebreak:${id}`;

  // Why this cannot be a confirmed/drop, in the order the causes are checked.
  const badField = ECHOED_FIELDS.some((k) => badEchoedField(finding, k));
  let reason;
  if (badField) reason = 'bad-finding-field';
  else if (parsed.parse === 'could-not-parse') reason = 'could-not-parse';
  else if (parsed.status !== 'DONE') reason = `status:${parsed.status}`;
  else if (parsed.verdict === 'cant-tell') reason = 'verdict:cant-tell';
  else if (!parsed.evidence) reason = 'no-evidence';
  else if (line === null) reason = 'no-line';
  else reason = evidenceProblem(parsed.evidence, finding, line, readFile);

  if (reason) {
    const outcome = severityRank(higherSev) >= severityRank('medium') ? 'console' : 'digest';
    const log = outcome === 'console'
      ? entry('STAGED', tiebreakStep, neutralize(`${where} console: ${reason}. Severity: ${higherSev}. Recommendation: ${parsed.recommendation ?? 'none'}.`))
      : entry('AUTO', tiebreakStep, neutralize(`${where} digested: ${reason}. Severity: ${higherSev}.`));
    return result({ outcome, severity: higherSev, reason, ...log });
  }

  const ev = parsed.evidence;
  if (parsed.verdict === 'confirmed') {
    return result({
      outcome: 'confirmed',
      severity: lower(reporterSev, tiebreakSev) || 'medium',
      evidence: ev,
      reason: 'confirmed by tiebreak',
      ...entry('AUTO', 'Reproduction', `${where} confirmed by tiebreak:${id}. Confirmed.`),
    });
  }
  const text = `${where} dropped: refuted by tiebreak. Evidence: ${ev.path}:${ev.line} "${ev.quote}". Severity: ${higherSev}.`;
  return result({
    outcome: 'drop', severity: higherSev, evidence: ev, reason: 'refuted by tiebreak',
    listInConsole: higherSev === 'high' || higherSev === 'critical', ...entry('AUTO', tiebreakStep, neutralize(text)),
  });
}

// ---- findings artifact and verdict coverage (#3945 Task 3) ----
//
// review-findings.json (a run-dir artifact, in run-artifact/write.js's
// ARTIFACT_NAMES) lists every finding the review handed to tiebreak, each with
// its findingId. Every resolveTiebreak logLine carries the literal
// `tiebreak:{id}`, so coverage is "does decisions.md hold a verdict line for
// each listed id" — matched on the verdict line's own shape (verdictLineRe:
// the `Tiebreak tiebreak:{id}:` step, or the confirmed line's `confirmed by
// tiebreak:{id}. Confirmed.`), never on the marker anywhere in a line, so a
// marker quoted inside another line's text never counts. The #3772 matcher in
// console/resolve.js (findingKey: lens + first path:line) is unchanged and
// coarser than the id — two findings that differ only in claim share a key but
// need two verdict lines here.
//
// A present-but-bad artifact is never absent and never valid: readFindingsArtifact
// reports { present: true, valid: false } so archival can refuse with its own
// reason. "Bad" is malformed (not JSON, wrong shape) or unreadable (any read
// error but ENOENT, or a path that lstat cannot prove missing — fail closed).
// Only a missing file is { present: false, valid: true } (nothing enforced).
// A valid entry has a 12-lowercase-hex id (the findingId shape) and non-empty
// string lens and path. buildFindingsArtifact refuses a line break in lens,
// path, claim, or a string line, and the `tiebreak:` marker in lens, path, or a
// string line (the fields a verdict line echoes).

const FINDINGS_ARTIFACT = 'review-findings.json';
const FINDING_KINDS = ['unconfirmed', 'contested'];

function buildFindingsArtifact(findings) {
  if (!Array.isArray(findings)) throw new TypeError('findings must be an array');
  return findings.map((f, i) => {
    if (!f || typeof f !== 'object') throw new TypeError(`finding ${i} is not an object`);
    for (const key of ['lens', 'path', 'claim']) {
      if (typeof f[key] !== 'string' || f[key].trim() === '') throw new TypeError(`finding ${i} is missing ${key}`);
    }
    for (const key of ['lens', 'path', 'claim', 'line']) {
      if (typeof f[key] === 'string' && LINE_BREAK_RE.test(f[key])) throw new TypeError(`finding ${i} ${key} contains a line break`);
    }
    for (const key of ECHOED_FIELDS) {
      if (typeof f[key] === 'string' && MARKER_RE.test(f[key])) throw new TypeError(`finding ${i} ${key} contains the tiebreak: marker`);
    }
    if (!FINDING_KINDS.includes(f.kind)) throw new TypeError(`finding ${i} kind must be one of ${FINDING_KINDS.join(', ')}`);
    return {
      id: findingId(f), lens: f.lens, path: f.path, line: f.line, claim: f.claim,
      reporterSeverity: positionSeverity(f) ?? f.reporterSeverity ?? null, kind: f.kind,
    };
  });
}

function readFindingsArtifact(dir) {
  const file = path.join(dir, FINDINGS_ARTIFACT);
  const invalid = { present: true, valid: false, findings: null };
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // Any read error but ENOENT is present and unreadable: fail closed, never absent.
    if (!err || err.code !== 'ENOENT') return invalid;
    // A dangling symlink also reads ENOENT, but it is present, not absent; only
    // an lstat ENOENT proves the file is missing.
    try { fs.lstatSync(file); return invalid; } catch (e) {
      return e && e.code === 'ENOENT' ? { present: false, valid: true, findings: null } : invalid;
    }
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return invalid; }
  if (!Array.isArray(parsed)) return invalid;
  const wellFormed = parsed.every((e) => e && typeof e === 'object'
    && ['id', 'lens', 'path'].every((k) => typeof e[k] === 'string' && e[k] !== '')
    && /^[0-9a-f]{12}$/.test(e.id));
  return wellFormed ? { present: true, valid: true, findings: parsed } : invalid;
}

// The decisions.md line log-decision.js writes for a resolveTiebreak verdict
// (`- {AUTO|STAGED} {HH:MM:SS} — {step}: {text}`). `id` is 12-hex validated,
// so it needs no escaping.
function verdictLineRe(id) {
  return new RegExp(`^- (?:AUTO|STAGED) \\d{2}:\\d{2}:\\d{2} — (?:Tiebreak tiebreak:${id}:|Reproduction: .* confirmed by tiebreak:${id}\\. Confirmed\\.)`);
}

function checkTiebreakCoverage(dir) {
  const art = readFindingsArtifact(dir);
  if (!art.present || !art.valid) return { artifactPresent: art.present, artifactValid: art.valid, missing: [] };
  let decisions = '';
  try { decisions = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'); } catch { /* absent or unreadable: no lines */ }
  const lines = decisions.split(/\r?\n/);
  const missing = art.findings
    .filter((f) => !lines.some((l) => verdictLineRe(f.id).test(l)))
    .map((f) => f.id);
  // A duplicated id is listed once, first-seen order kept.
  return { artifactPresent: true, artifactValid: true, missing: [...new Set(missing)] };
}

// specDirs are basenames such as `spec-3945` (the caller derives them, so this
// module never requires reconcile/archive-merged.js).
function checkRunTiebreakCoverage(runDir, specDirs) {
  const targets = [{ dir: runDir, prefix: '' }, ...(specDirs || []).map((s) => ({ dir: path.join(runDir, s), prefix: `${s}/` }))];
  const out = { artifactPresent: false, artifactValid: true, missing: [] };
  for (const { dir, prefix } of targets) {
    const r = checkTiebreakCoverage(dir);
    if (r.artifactPresent) out.artifactPresent = true;
    if (!r.artifactValid) out.artifactValid = false;
    out.missing.push(...r.missing.map((id) => `${prefix}${id}`));
  }
  return out;
}

module.exports = {
  findingId, parseTiebreakReply, resolveTiebreak, VERDICTS, SEVERITIES,
  FINDINGS_ARTIFACT, buildFindingsArtifact, readFindingsArtifact, checkTiebreakCoverage, checkRunTiebreakCoverage,
};
