// plugin/bin/lib/release-note-repair/apply.js — /tidy Shape 4.5's repair half (#2828): insert (or
// fill) exactly one `## Release Note` section, prove by line diff that nothing else changed, and
// verify a written body. Headings are matched line-anchored and only before the verbatim
// `## Original request` section; every gate verdict goes through detect.js's checkBody, so a body
// the insert gets wrong is caught by the gate's own post-check rather than written.
'use strict';

const { isDeepStrictEqual } = require('util');
const { sectionText } = require('../issues/materialize-format');
const { checkBody, checkReleaseNoteLine, bodySha, labelNames } = require('./detect');

class RepairError extends Error {}

const AC_HEADING = /^## Acceptance Criteria[ \t]*$/;
const RN_HEADING = /^## Release Note[ \t]*$/;
const ORIGINAL_REQUEST = /^## Original request[ \t]*$/;
const H2 = /^## /;

// Lines keep their own terminators so every untouched byte round-trips exactly.
const splitKeepingEol = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (line) => line.replace(/\r?\n$/, '');

function applyReleaseNote(body, rawLine) {
  const text = String(body);
  const line = String(rawLine).trim();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitKeepingEol(text);
  const originalAt = lines.findIndex((l) => ORIGINAL_REQUEST.test(bare(l)));
  const authoredEnd = originalAt === -1 ? lines.length : originalAt;
  const nextH2 = (from) => {
    for (let k = from; k < lines.length; k += 1) if (H2.test(lines[k])) return k;
    return lines.length;
  };
  const terminate = (k) => { if (k >= 0 && !lines[k].endsWith('\n')) lines[k] += eol; };

  const rn = lines.slice(0, authoredEnd).findIndex((l) => RN_HEADING.test(bare(l)));
  if (rn !== -1) {
    const end = nextH2(rn + 1);
    if (lines.slice(rn + 1, end).some((l) => bare(l).trim() !== '')) {
      throw new RepairError('the existing ## Release Note section is not empty');
    }
    terminate(rn);
    const fill = end < lines.length ? [eol, line + eol, eol] : [eol, line + eol];
    lines.splice(rn + 1, end - (rn + 1), ...fill);
    return { body: lines.join(''), mode: 'filled' };
  }
  const ac = lines.slice(0, authoredEnd).findIndex((l) => AC_HEADING.test(bare(l)));
  if (ac === -1) throw new RepairError('no line-anchored ## Acceptance Criteria heading to insert after');
  const at = nextH2(ac + 1);
  if (at < lines.length) {
    lines.splice(at, 0, `## Release Note${eol}`, eol, line + eol, eol);
  } else {
    terminate(lines.length - 1);
    lines.push(eol, `## Release Note${eol}`, eol, line + eol);
  }
  return { body: lines.join(''), mode: 'inserted' };
}

// Common prefix + common suffix; the removed middle must be blank-only, and the added middle's
// non-blank lines must be exactly [heading, line] (insert) or [line] under an existing heading (fill).
function onlyReleaseNoteAdded(original, repaired, rawLine) {
  const line = String(rawLine).trim();
  const a = String(original).split(/\r?\n/);
  const b = String(repaired).split(/\r?\n/);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  if (a.slice(p, a.length - s).some((l) => l.trim() !== '')) return false;
  const added = b.slice(p, b.length - s).filter((l) => l.trim() !== '');
  if (added.length === 2) return RN_HEADING.test(added[0]) && added[1] === line;
  if (added.length !== 1 || added[0] !== line) return false;
  for (let k = p - 1; k >= 0; k -= 1) if (b[k].trim() !== '') return RN_HEADING.test(b[k]);
  return false;
}

function prepareRepair({ liveBody, expectSha, line, checkCli } = {}) {
  if (typeof liveBody !== 'string') return { outcome: 'stale', reason: 'the live read carries no body' };
  if (bodySha(liveBody) !== expectSha) return { outcome: 'stale', reason: 'the record body changed since the scan' };
  const bounds = checkReleaseNoteLine(line);
  if (!bounds.ok) return { outcome: 'bounds', violations: bounds.violations };
  const pre = checkBody(liveBody, { checkCli });
  if (pre.verdict === 'scan-error') return { outcome: 'failed', reason: `compose-record.js --check could not judge the live body (${pre.stderr.trim() || `exit ${pre.code}`})` };
  if (pre.verdict !== 'release-note-only') return { outcome: 'stale', reason: `the live body is no longer Release-Note-only (${pre.verdict})` };
  let applied;
  try {
    applied = applyReleaseNote(liveBody, bounds.line);
  } catch (err) {
    if (err instanceof RepairError) return { outcome: 'failed', reason: err.message };
    throw err;
  }
  const post = checkBody(applied.body, { checkCli });
  if (post.verdict !== 'conforming') {
    return { outcome: 'failed', reason: `the repaired body still fails compose-record.js --check (${post.gaps.join('; ') || post.stderr.trim() || post.verdict})` };
  }
  if (!onlyReleaseNoteAdded(liveBody, applied.body, bounds.line)) {
    return { outcome: 'failed', reason: 'the line diff shows more than the Release Note section' };
  }
  return { outcome: 'ready', body: applied.body, mode: applied.mode, line: bounds.line };
}

function verifyWritten({ before, after, line, checkCli } = {}) {
  const body = after && typeof after.body === 'string' ? after.body : null;
  if (body === null) return ['the post-write read carries no body'];
  const problems = [];
  if (checkBody(body, { checkCli }).verdict !== 'conforming') problems.push('the live body fails compose-record.js --check');
  if (sectionText(body, 'Release Note') !== String(line).trim()) problems.push('the live ## Release Note section does not carry the composed line');
  const was = labelNames(before && before.labels).sort();
  const now = labelNames(after.labels).sort();
  if (!isDeepStrictEqual(was, now)) problems.push(`the label set changed: before [${was.join(', ')}], after [${now.join(', ')}]`);
  return problems;
}

module.exports = { RepairError, applyReleaseNote, onlyReleaseNoteAdded, prepareRepair, verifyWritten };
