// bin/lib/tiebreak.js — finding identity and the tiebreak-reply parser (#3945).
// Pure: no fs, no process. Task 2's resolver maps a parsed reply to a ruling.
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

module.exports = { findingId, parseTiebreakReply, VERDICTS, SEVERITIES };
