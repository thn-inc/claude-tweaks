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
// A finding is { lens, path, line, claim, reporterSeverity, kind, positions?, vacuity?, severityFloor? }:
// kind is 'unconfirmed' | 'contested'; positions ([{ severity }], optional,
// contested only) are the two sides' severities. A contested finding's reporter
// severity is the higher known position severity; buildFindingsArtifact stores
// it as reporterSeverity, since the artifact does not keep positions. vacuity
// (boolean, optional) marks a lens 3f "this test cannot fail" finding: only
// resolveTiebreakChunk reads it (see its comment), the artifact does not keep it,
// and a non-boolean value is refused rather than silently ignored. severityFloor
// (a severity, optional) is the severity a Standard judge raised the finding to
// (#5541): only resolveTiebreak reads it, and only where the Capable judge
// settled no verdict (a finding field refused as bad-finding-field, could-not-parse,
// a non-DONE status, can't-tell, no verified evidence, a finding with no line):
// there it settles at the higher of what it computes and the floor, so a failed
// re-judge still reaches the console at the raised severity. A confirm or refute
// settles on its own verdict and ignores it. It is not part of the finding's id,
// the artifact does not keep it, and an absent, null or unknown value changes
// nothing.
//
// Reply grammar (parseTiebreakReply). Lines are trimmed; each field line is
// `Field: value`, the field name matched case-insensitively:
//   Verdict: confirmed | refuted | cant-tell        value lowercased
//   Evidence: {path}:{line} {quote}                 the path:line token may sit in
//       one backtick pair (`{path}`:{line} or `{path}:{line}`), which is
//       stripped. With a findingPath option (resolveTiebreak passes the finding's
//       path), that exact path, even one holding whitespace, is also read as the
//       literal prefix of the same three spellings. quote = everything after the
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

// The finding's own path, when it holds whitespace, cannot be read by
// EVIDENCE_RE's \S+ path; so the three path:line spellings are matched as a
// literal prefix (exact string comparison, no regex built from the path) and the
// tail is read by the same line/quote rule. Null when no spelling matches.
const LINE_TAIL_RE = /^(\d+)(?:\s+([\s\S]*))?$/;
function findingPathTail(value, findingPath) {
  if (value.startsWith(`${findingPath}:`)) return LINE_TAIL_RE.exec(value.slice(findingPath.length + 1));
  if (value.startsWith(`\`${findingPath}\`:`)) return LINE_TAIL_RE.exec(value.slice(findingPath.length + 3));
  if (value.startsWith(`\`${findingPath}:`)) return /^(\d+)`(?:\s+([\s\S]*))?$/.exec(value.slice(findingPath.length + 2));
  return null;
}

function parseEvidence(value, findingPath) {
  const known = typeof findingPath === 'string' && findingPath !== '' ? findingPathTail(value, findingPath) : null;
  let m;
  if (known) m = [null, findingPath, known[1], known[2]];
  else {
    const w = WRAPPED_TOKEN_RE.exec(value);
    m = EVIDENCE_RE.exec(w ? (w[3] || w[1] + w[2]) + value.slice(w[0].length) : value);
  }
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

function parseTiebreakReply(text, options) {
  const { findingPath } = options || {};
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
    evidence: fields.evidence == null ? null : parseEvidence(fields.evidence, findingPath),
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
// Chunked replies (one agent, up to CHUNK_MAX findings) are split and resolved
// by splitChunkReply / resolveTiebreakChunk below; the grammar is documented there.

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

function canonicalFindingPath(findingPath, evidencePath) {
  if (findingPath.startsWith('plugin/')) return findingPath;
  const skillPath = `plugin/skills/${findingPath}`;
  return evidencePath === skillPath ? skillPath : findingPath;
}

// Returns null when the evidence checks out against the file, else the reason.
// The cited line must sit within ±LINE_TOLERANCE_REPRODUCTION_WIDE of the
// finding's line, and the quote must carry content (three or more consecutive
// word characters), so `}` or `c` can never verify against a window.
// A legacy skill-relative Location matches its `plugin/skills/` Evidence path and is read through that path.
function evidenceProblem(evidence, finding, line, readFile) {
  const readPath = canonicalFindingPath(finding.path, evidence.path);
  if (evidence.path !== readPath) return 'evidence-path-mismatch';
  const quote = squash(evidence.quote);
  if (!/[A-Za-z0-9_]{3,}/.test(quote)) return 'evidence-unverified';
  if (Math.abs(evidence.line - line) > LINE_TOLERANCE_REPRODUCTION_WIDE) return 'evidence-unverified';
  // One guard for both: an absent or non-function reader throws here too.
  let text;
  try { text = readFile(readPath); } catch { return 'evidence-unverified'; }
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
  const id = findingId(finding);
  const parsed = parseTiebreakReply(replyText, { findingPath: finding.path });
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
    // An escalation re-judge carries the severity the Standard judge raised the finding to (#5541).
    // The floor applies only here, where the Capable judge settled no verdict; a confirm or refute settles on its own.
    const unsettledSev = higher(higherSev, knownSeverity(finding.severityFloor));
    const outcome = severityRank(unsettledSev) >= severityRank('medium') ? 'console' : 'digest';
    const log = outcome === 'console'
      ? entry('STAGED', tiebreakStep, neutralize(`${where} console: ${reason}. Severity: ${unsettledSev}. Recommendation: ${parsed.recommendation ?? 'none'}.`))
      : entry('AUTO', tiebreakStep, neutralize(`${where} digested: ${reason}. Severity: ${unsettledSev}.`));
    return result({ outcome, severity: unsettledSev, reason, ...log });
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

// ---- chunked replies (#5540) ----
//
// One judge agent settles up to CHUNK_MAX findings and answers once. Chunk reply
// grammar (splitChunkReply): lines are trimmed; a block starts at a line
// `Id: {12 hex}` (the id optionally in one backtick pair, name and id matched
// case-insensitively) whose id is one of the chunk's ids, and runs to the next
// line of that shape or to the end of the reply, excluding the reply's final
// non-empty line when that line matches STATUS_RE. `status` is that final line
// (verbatim, trimmed) or null. A block's text is its lines after the header
// joined with `\n`, then `\n` + status when status is non-null, so it parses
// exactly as a one-finding reply does. An id with no header is `missing`; an id
// with two or more headers is `duplicate`; both carry text ''. Lines before the
// first header, and any block under an id outside the chunk, belong to no finding.
// resolveTiebreakChunk settles each finding whose block is present exactly once
// through resolveTiebreak, so its verdict line is the one-finding call's line
// for the same entry and block; every other finding is reported unsettled with
// nothing resolved for it, and the caller re-dispatches it alone.
//
// Judge tiers (#5541): a finding's tier follows its severity. `info` is judged at
// Standard, everything else — low, medium, high, critical, and a null, missing
// or unknown severity — at Capable, because a cheaper judge is only trusted
// where a wrong verdict costs least. A contested finding's unknown-position check
// reads its raw `positions`, because positionSeverity (and the artifact's
// reporterSeverity built from it) drops an unknown position: a contested finding
// with any null or unknown position severity is Capable even when every known
// position is info. The tier never reads severityFloor.
// planChunks groups entries by tier (TIERS order, entry order within a tier,
// CHUNK_MAX per chunk, a repeated finding id kept once at its first index), so
// a chunk never mixes tiers. escalation is the guard on the cheap tier: a
// Standard judge that raises a finding to medium or higher has not settled it,
// and resolveTiebreakChunk reports it in `escalated` with no result so the
// caller judges it again at Capable. Only a reply that parses ok with STATUS
// DONE can escalate; an unparsed or non-DONE block resolves as can't-tell, as
// at any tier. At 'capable' (the default) nothing escalates.
// resolveTiebreakChunk returns { results, unsettled, escalated }; `escalated` is
// the entries a Standard judge raised, always [] at Capable.

const CHUNK_MAX = 8;
const CHUNK_HEADER_RE = /^id\s*:\s*`?([0-9a-f]{12})`?$/i;
const CONFIRMED_VERDICT_RE = /^verdict\s*:\s*confirmed\s*$/i;

function splitChunkReply(replyText, ids) {
  const wanted = new Set(ids.map((id) => id.toLowerCase()));
  const lines = typeof replyText === 'string'
    ? replyText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
    : [];
  let status = null;
  if (lines.length > 0 && STATUS_RE.test(lines[lines.length - 1])) status = lines.pop();

  const found = new Map(); // id -> [lines of each header's block]
  let current = null;
  for (const line of lines) {
    const header = CHUNK_HEADER_RE.exec(line);
    if (!header) {
      if (current) current.push(line);
      continue;
    }
    const id = header[1].toLowerCase();
    if (!wanted.has(id)) {
      current = null;
      continue;
    }
    if (!found.has(id)) found.set(id, []);
    current = [];
    found.get(id).push(current);
  }

  const blocks = new Map();
  for (const id of ids) {
    const occurrences = found.get(id.toLowerCase()) || [];
    if (occurrences.length === 0) {
      blocks.set(id, { state: 'missing', text: '' });
    } else if (occurrences.length > 1) {
      blocks.set(id, { state: 'duplicate', text: '' });
    } else {
      blocks.set(id, { state: 'ok', text: [...occurrences[0], ...(status === null ? [] : [status])].join('\n') });
    }
  }
  return { status, blocks };
}

const TIERS = ['capable', 'standard'];

function judgeTier(finding) {
  if (finding && finding.kind === 'contested' && Array.isArray(finding.positions) && finding.positions.length > 0) {
    if (finding.positions.some((p) => knownSeverity(p && p.severity) === null)) return 'capable';
  }
  return reporterSeverityOf(finding) === 'info' ? 'standard' : 'capable';
}

function planChunks(findings) {
  const ids = buildFindingsArtifact(findings).map((a) => a.id);
  const seen = new Set();
  const byTier = new Map(TIERS.map((tier) => [tier, []]));
  findings.forEach((finding, index) => {
    if (seen.has(ids[index])) return;
    seen.add(ids[index]);
    byTier.get(judgeTier(finding)).push(index);
  });
  const chunks = [];
  for (const tier of TIERS) {
    const indexes = byTier.get(tier);
    for (let i = 0; i < indexes.length; i += CHUNK_MAX) chunks.push({ tier, indexes: indexes.slice(i, i + CHUNK_MAX) });
  }
  return chunks;
}

function escalation(finding, replyText, tier) {
  if (tier !== 'standard') return null;
  const parsed = parseTiebreakReply(replyText, { findingPath: finding.path });
  if (parsed.parse !== 'ok' || parsed.status !== 'DONE' || parsed.severity === null) return null;
  return severityRank(parsed.severity) >= severityRank('medium') ? { reason: 'raised', severity: parsed.severity } : null;
}

function resolveTiebreakChunk(findings, replyText, opts) {
  if (!Array.isArray(findings)) throw new TypeError('resolveTiebreakChunk: findings must be an array');
  const ids = findings.map((f) => findingId(f));
  if (new Set(ids).size !== ids.length) throw new TypeError('resolveTiebreakChunk: two entries share a finding id');
  const tier = opts && opts.tier !== undefined ? opts.tier : 'capable';
  if (!TIERS.includes(tier)) throw new TypeError(`resolveTiebreakChunk: tier must be one of ${TIERS.join(', ')}`);
  if (tier === 'standard' && findings.some((f) => judgeTier(f) === 'capable')) {
    throw new TypeError('resolveTiebreakChunk: a Capable-tier finding cannot be judged at standard');
  }
  const { blocks } = splitChunkReply(replyText, ids);
  const results = [];
  const unsettled = [];
  const escalated = [];
  findings.forEach((finding, index) => {
    const id = ids[index];
    const block = blocks.get(id);
    if (block.state !== 'ok') {
      unsettled.push({ id, index, reason: block.state === 'missing' ? 'missing' : 'duplicated' });
      return;
    }
    // Lens 3f's vacuity rule (step3-lens-dispatch.md): a claim that a test cannot fail needs an
    // executed run, so reading code never confirms it. The one-finding form leaves that rewrite
    // to the dispatcher's prose; the chunk form does it here because only code splits a chunk
    // reply and the dispatcher never edits one (record #5540, Decision Q1).
    const text = finding.vacuity === true
      ? block.text.split('\n').map((l) => (CONFIRMED_VERDICT_RE.test(l) ? 'Verdict: cant-tell' : l)).join('\n')
      : block.text;
    const raised = escalation(finding, text, tier);
    if (raised) {
      escalated.push({ id, index, ...raised });
      return;
    }
    results.push({ ...resolveTiebreak(finding, text, opts), id, index });
  });
  return { results, unsettled, escalated };
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
// marker quoted inside another line's text never counts. The matcher in
// console/resolve.js keys on lens + path:line — a verdict's whole path, a
// STAGED line's longest candidate path a verdict names (#4632) — and is
// coarser than the id: two findings that differ only in claim share a key but
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
    if (f.vacuity !== undefined && typeof f.vacuity !== 'boolean') throw new TypeError(`finding ${i} vacuity must be a boolean`);
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

// The resolver-written tail every verdict line ends on. console/resolve.js
// anchors its verdict regexes on this same constant, so the archive coverage
// gate and the console agree on what counts as a verdict line (#4632).
const VERDICT_LINE_END = '(?: Mode: inline\\.)?(?: Reversibility: \\S+\\.)?\\s*$';

// The decisions.md line log-decision.js writes for a resolveTiebreak verdict
// (`- {AUTO|STAGED} {HH:MM:SS} — {step}: {text}`). `id` is 12-hex validated,
// so it needs no escaping. The confirmed line is anchored on VERDICT_LINE_END,
// as console/resolve.js's TIEBREAK_CONFIRMED_RE is, so text after `Confirmed.`
// is not a verdict to either (#4632).
function verdictLineRe(id) {
  return new RegExp(`^- (?:AUTO|STAGED) \\d{2}:\\d{2}:\\d{2} — (?:Tiebreak tiebreak:${id}:|Reproduction: .* confirmed by tiebreak:${id}\\. Confirmed\\.${VERDICT_LINE_END})`);
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
  VERDICT_LINE_END, CHUNK_MAX, splitChunkReply, resolveTiebreakChunk,
  TIERS, judgeTier, planChunks, escalation,
};
