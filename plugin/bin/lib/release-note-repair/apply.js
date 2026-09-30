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
// An opener is optional leading whitespace (a fence indented under a list item, common in
// Acceptance Criteria) plus a run of 3+ backticks or 3+ tildes — the info string, if any, is
// ignored. A fence closes only on a line whose run of the SAME character is at least as long as
// the opener's, followed by nothing but whitespace to end of line: a shorter run, the other
// character, or one followed by more text (an info string, prose) never closes it. This is what
// lets a longer fence (e.g. ````) hold a shorter one (```) as literal content instead of being
// prematurely closed by it.
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

// Lines keep their own terminators so every untouched byte round-trips exactly.
const splitKeepingEol = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (line) => line.replace(/\r?\n$/, '');

// Fence state per line, computed only over the authored region (before ## Original request):
// true when a line sits inside — or is itself a delimiter of — a fenced code block, so a
// `## `-looking line typed into a fenced markdown example is never mistaken for a real heading,
// however that example is indented or nested. An unterminated fence (opened, never closed, before
// the insert point) leaves `open` non-null — callers refuse to guess a boundary past that point.
function fenceInfo(authoredLines) {
  const inFence = [];
  let open = null; // { ch, len } | null
  for (const raw of authoredLines) {
    const l = bare(raw);
    if (open) {
      inFence.push(true);
      const m = FENCE_CLOSE.exec(l);
      if (m && m[1][0] === open.ch && m[1].length >= open.len) open = null;
    } else {
      const m = FENCE_OPEN.exec(l);
      if (m) {
        inFence.push(true);
        open = { ch: m[1][0], len: m[1].length };
      } else {
        inFence.push(false);
      }
    }
  }
  return { inFence, unterminated: open !== null };
}

function applyReleaseNote(body, rawLine) {
  const text = String(body);
  const line = String(rawLine).trim();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitKeepingEol(text);
  const originalAt = lines.findIndex((l) => ORIGINAL_REQUEST.test(bare(l)));
  const authoredEnd = originalAt === -1 ? lines.length : originalAt;
  const { inFence, unterminated } = fenceInfo(lines.slice(0, authoredEnd));
  if (unterminated) throw new RepairError('an unterminated fenced code block precedes the insert point');
  const nextH2 = (from) => {
    for (let k = from; k < lines.length; k += 1) if (!inFence[k] && H2.test(lines[k])) return k;
    return lines.length;
  };
  const terminate = (k) => { if (k >= 0 && !lines[k].endsWith('\n')) lines[k] += eol; };

  const rn = lines.slice(0, authoredEnd).findIndex((l, idx) => !inFence[idx] && RN_HEADING.test(bare(l)));
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
  const ac = lines.slice(0, authoredEnd).findIndex((l, idx) => !inFence[idx] && AC_HEADING.test(bare(l)));
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

// verifyWritten's labels-only problem prefix: release-note-repair.js routes a lone problem
// starting with it to exit 8 instead of 7, so the wording lives in one place.
const LABELS_CHANGED = 'the label set changed';

function verifyWritten({ before, after, line, checkCli } = {}) {
  const body = after && typeof after.body === 'string' ? after.body : null;
  if (body === null) return ['the post-write read carries no body'];
  const problems = [];
  if (checkBody(body, { checkCli }).verdict !== 'conforming') problems.push('the live body fails compose-record.js --check');
  if (sectionText(body, 'Release Note') !== String(line).trim()) problems.push('the live ## Release Note section does not carry the composed line');
  const beforeBody = before && typeof before.body === 'string' ? before.body : null;
  if (beforeBody !== null && !onlyReleaseNoteAdded(beforeBody, body, line)) {
    problems.push('the post-write diff shows more than the Release Note section changed');
  }
  const was = labelNames(before && before.labels).sort();
  const now = labelNames(after.labels).sort();
  if (!isDeepStrictEqual(was, now)) problems.push(`${LABELS_CHANGED}: before [${was.join(', ')}], after [${now.join(', ')}]`);
  return problems;
}

module.exports = { RepairError, LABELS_CHANGED, applyReleaseNote, onlyReleaseNoteAdded, prepareRepair, verifyWritten };
