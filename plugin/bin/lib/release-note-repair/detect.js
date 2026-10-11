// plugin/bin/lib/release-note-repair/detect.js — /tidy Shape 4.5's detection half (#2828): which
// `ready` records' only spec-shape gap is `## Release Note`, judged by compose-record.js --check
// (#2827) so tidy's verdict and /flow's Materialization gate never disagree, plus the Deliverable 2
// bounds on an agent-composed Release Note line. checkCli defaults to compose-record.js's own
// exported run() in-process — the CLI's entry point, so the exit/stderr contract is identical and a
// 100+-record scan pays no spawn per record. Pure except checkBody's per-body tmp file.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sectionText } = require('../issues/materialize-format');

const CHECK_HEADER = 'compose-record.js: body is not spec-shaped:';
const RELEASE_NOTE_GAPS = ['missing section: ## Release Note', 'empty section: ## Release Note'];
// The staged action text: decision-markers.md's `Proposed:` line carries it verbatim, and the
// worklist rule's comment check below matches it word for word.
const PROPOSED_ACTION = 'Fill Release Note (insert one ## Release Note section; labels unchanged)';

// Deliverable 2 bounds, one regex per bound. Any backtick is rejected (stricter than "no code span").
const BOUNDS = [
  { id: 'record-ref', re: /#\d+/ },
  { id: 'path', re: /\S*\/\S*\.[A-Za-z0-9]+/ },
  { id: 'backtick', re: /`/ },
  { id: 'conventional-prefix', re: /^[a-z]+(\(.+\))?!?:/ },
];

function classifyCheckResult({ code, stderr } = {}) {
  if (code === 0) return { verdict: 'conforming', gaps: [] };
  if (code !== 4) return { verdict: 'scan-error', gaps: [] };
  const lines = String(stderr || '').split('\n');
  if (lines[0] !== CHECK_HEADER) return { verdict: 'scan-error', gaps: [] };
  const gaps = lines.slice(1).filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));
  if (gaps.length === 0) return { verdict: 'scan-error', gaps };
  if (gaps.length === 1 && RELEASE_NOTE_GAPS.includes(gaps[0])) return { verdict: 'release-note-only', gaps };
  return { verdict: 'other-gaps', gaps };
}

function defaultCheckCli(file) {
  const { run } = require('../../compose-record');
  let stderr = '';
  const code = run(['--check', file], { stdout: () => {}, stderr: (s) => { stderr += s; } });
  return { code, stderr };
}

function checkBody(body, { checkCli = defaultCheckCli } = {}) {
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-note-'));
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, body);
    const { code, stderr } = checkCli(file);
    return { ...classifyCheckResult({ code, stderr }), code, stderr: String(stderr || '') };
  } catch (err) {
    return { verdict: 'scan-error', gaps: [], code: null, stderr: String((err && err.message) || err) };
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
}

function checkReleaseNoteLine(raw) {
  const line = String(raw == null ? '' : raw).replace(/\r?\n$/, '').trim();
  const violations = [];
  if (!line) violations.push('empty');
  if (/[\r\n]/.test(line)) violations.push('multi-line');
  for (const { id, re } of BOUNDS) if (re.test(line)) violations.push(id);
  return { ok: violations.length === 0, line, violations };
}

function bodySha(body) {
  return crypto.createHash('sha256').update(String(body), 'utf8').digest('hex');
}

function labelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((l) => (typeof l === 'string' ? l : (l && l.name) || ''))
    .filter(Boolean);
}

// Worklist rule, second check (step-1-records.md): an UNRESOLVED tidy decision comment whose
// Proposed: line is this shape's own staged action, word for word.
function hasPendingTidyDecision(comments) {
  return (Array.isArray(comments) ? comments : []).some((c) => {
    const text = String((c && c.body) || '');
    if (!text.includes('<!-- needs-decision: tidy -->') || text.includes('**Resolved:**')) return false;
    return text.split(/\r?\n/).some((l) => l.trim() === `**Proposed:** ${PROPOSED_ACTION}`);
  });
}

function excluded(record, driver) {
  if (driver === 'local-files') return record.facets.needsDefinition === true || record.facets.closed === true;
  if (record.state && String(record.state).toUpperCase() !== 'OPEN') return true;
  if (labelNames(record.labels).some((n) => /^needs:/.test(n))) return true;
  return hasPendingTidyDecision(record.comments);
}

function scanRecords(records, { driver, checkCli } = {}) {
  const candidates = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || !record.facets || record.facets.stage !== 'ready') continue;
    if (excluded(record, driver)) continue;
    const local = driver === 'local-files';
    const base = { ref: local ? record.path : `#${record.number}`, id: local ? record.id : record.number, title: String(record.title || '') };
    if (typeof record.body !== 'string') {
      candidates.push({ ...base, verdict: 'scan-error', code: null, stderr: 'record carries no body field', sha: null, deliverables: null });
      continue;
    }
    const check = checkBody(record.body, { checkCli });
    if (check.verdict === 'release-note-only') {
      candidates.push({ ...base, verdict: check.verdict, gap: check.gaps[0], sha: bodySha(record.body), deliverables: sectionText(record.body, 'Deliverables') });
    } else if (check.verdict === 'scan-error') {
      candidates.push({ ...base, verdict: check.verdict, code: check.code, stderr: check.stderr, sha: null, deliverables: null });
    }
  }
  return candidates;
}

function summaryLine(candidates, outPath) {
  if (!candidates.length) return null;
  const matches = candidates.filter((c) => c.verdict === 'release-note-only').length;
  return `—\t[release-note] ${matches} ready record(s) missing only a Release Note, ${candidates.length - matches} scan error(s) — Fill Release Note (candidates: ${outPath})`;
}

module.exports = {
  CHECK_HEADER, RELEASE_NOTE_GAPS, PROPOSED_ACTION, BOUNDS,
  classifyCheckResult, checkBody, checkReleaseNoteLine, bodySha, labelNames, scanRecords, summaryLine,
};
