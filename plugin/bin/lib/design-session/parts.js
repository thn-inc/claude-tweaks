// bin/lib/design-session/parts.js — the one definition of a /claude-tweaks:design
// order's parts: the `## Parts` table, the `## Approval` status line and the
// digest it carries, the worth-it measure, and the cross-repository filing
// plan. Skill prose cites this header; it never restates the grammar. No I/O.
//
// `## Parts` sits in design.md after `## Builder check` and before
// `## Decisions`. It holds a `Status:` line, the parts table, and an
// `Estimate:` line (estimate().line). The table's header row is exactly
// TABLE_HEADER, in that order, followed by a separator row; the table is the
// first run of `|` lines in the section outside a fence. Each data row:
//   - `#`: 1-based and consecutive (row N holds N).
//   - Part: non-empty, unique by unitSlug, and never slugging to `parent`.
//   - Size: one of SIZES (the repository's own size labels).
//   - Repository: `owner/name`.
//   - Waits for: `—` (or empty) for none, else comma-separated entries, each a
//     Part name from an earlier row, an `owner/name#N`, or a `#N`.
//   - Issue: ignored by the approval; written only by markFiled. A filed part's
//     mark is `owner/name#N` (N the issue number, or the record id under
//     `work-backend: local-files`); a part this run did not file is marked
//     `left for owner/name`. A part marked `owner/name#N` is filed and is never
//     filed or re-marked again; `left for …` counts as marked, not as filed.
// The part that makes the order visible to a user is the last row.
//
// `## Approval` holds a `Status:` line and the status line
//   `Approved: {YYYY-MM-DD} — digest sha256:{64 lowercase hex}`   (approvalLine)
// The digest is sha256 over three blocks joined with `\n`: `## Frame` and
// `## Approaches` (each its heading line, then its section lines without
// `Status:` lines) and `## Parts` (its heading line, then each data row's first
// five cells, trimmed, joined with ` | `); every line is right-trimmed. Issue
// marks and the Estimate line are outside it, so filing never invalidates it.
//
// The worth-it measure is `## Frame`'s `Measure:` line, read verbatim; the
// parent issue carries it under a `## Worth-it measure` heading. `## Filing`
// (after `## Approval`) records the filing run.
//
// unitSlug: lowercase; every run of characters other than `a-z0-9` becomes one
// `-`; trimmed of `-`. designSlug: the design folder name without its leading
// `YYYY-MM-DD-`. A part's fingerprint is `{design-doc-slug}:{unit-slug}`.
'use strict';

const crypto = require('node:crypto');
const { fencedLineMask } = require('../markdown-blocks');
const { H2_RE, STATUS_RE, splitLines } = require('./notes');
const { sectionLines, sectionField } = require('./design-md');

const PARTS_HEADING = 'Parts';
const APPROVAL_HEADING = 'Approval';
const FILING_HEADING = 'Filing';
const FRAME_HEADING = 'Frame';
const APPROACHES_HEADING = 'Approaches';
const WORTH_IT_HEADING = 'Worth-it measure';
const MEASURE_KEY = 'Measure';
const TABLE_HEADER = ['#', 'Part', 'Size', 'Repository', 'Waits for', 'Issue'];
const SIZES = ['size:low', 'size:medium', 'size:high'];
const ISSUE_COL = TABLE_HEADER.indexOf('Issue');
const ESTIMATE_BASIS = 'v6 records no per-size token use in its timing or model-profile data.';

const REPO = '[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+';
const REPO_RE = new RegExp(`^${REPO}$`);
const FILED_RE = new RegExp(`^${REPO}#\\d+$`);
const LEFT_RE = new RegExp(`^left for (${REPO})$`);
const EXTERNAL_RE = new RegExp(`^(?:${REPO})?#\\d+$`);
const NONE_VALUES = ['', '—', '–', '-'];
const SEPARATOR_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const APPROVED_RE = /^Approved: (\d{4}-\d{2}-\d{2}) — digest sha256:([0-9a-f]{64})$/;

function unitSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function designSlug(folderName) {
  return String(folderName).replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function cellsOf(line) {
  let s = line.trim().slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

// -> { lines, present, header: index|null, rows: [line index] } for the
// `## Parts` table in the full text.
function locateTable(designText) {
  const lines = splitLines(designText);
  const body = sectionLines(designText, PARTS_HEADING);
  if (!body) return { lines, present: false, header: null, rows: [] };
  const fenced = fencedLineMask(lines);
  const start = lines.findIndex((l, i) => !fenced[i] && H2_RE.test(l) && l.replace(/^##\s+/, '').trim() === PARTS_HEADING);
  const isRow = (i) => !fenced[i] && lines[i].trim().startsWith('|');
  let header = null;
  const rows = [];
  for (let i = start + 1; i <= start + body.length; i++) {
    if (header === null) {
      if (isRow(i)) header = i;
    } else if (isRow(i)) rows.push(i);
    else break;
  }
  return { lines, present: true, header, rows };
}

function noneValue(cell) {
  return NONE_VALUES.includes(cell);
}

// -> { present, parts: Part[], errors: string[] }
function parseParts(designText) {
  const { lines, present, header, rows } = locateTable(designText);
  if (!present) return { present, parts: [], errors: [] };
  if (header === null) return { present, parts: [], errors: ['no parts table in ## Parts'] };
  const headerCells = cellsOf(lines[header]);
  if (headerCells.join('\u0000') !== TABLE_HEADER.join('\u0000')) {
    return { present, parts: [], errors: [`header row: expected '| ${TABLE_HEADER.join(' | ')} |'`] };
  }
  if (!rows.length || !SEPARATOR_RE.test(lines[rows[0]].trim())) {
    return { present, parts: [], errors: ['header row: not followed by a separator row'] };
  }
  const dataRows = rows.slice(1);
  if (!dataRows.length) return { present, parts: [], errors: ['no part rows in the parts table'] };

  const names = dataRows.map((i) => cellsOf(lines[i])[1] || '');
  const slugs = new Map();
  const parts = [];
  const errors = [];
  dataRows.forEach((lineIdx, k) => {
    const n = k + 1;
    const cells = cellsOf(lines[lineIdx]);
    if (cells.length !== TABLE_HEADER.length) {
      errors.push(`row ${n}: expected ${TABLE_HEADER.length} cells, found ${cells.length}`);
      return;
    }
    const [num, name, size, repository, waits, issue] = cells;
    const why = [];
    if (num !== String(n)) why.push(`'#' is '${num}', expected ${n}`);
    const slug = unitSlug(name);
    if (!name) why.push('empty Part cell');
    else if (!slug) why.push(`Part '${name}' has no slug`);
    else if (slug === 'parent') why.push(`Part '${name}' slugs to the reserved 'parent'`);
    else if (slugs.has(slug)) why.push(`Part '${name}' has the same slug '${slug}' as row ${slugs.get(slug)}`);
    else slugs.set(slug, n);
    if (!SIZES.includes(size)) why.push(`Size '${size}' is not one of ${SIZES.join(', ')}`);
    if (!REPO_RE.test(repository)) why.push(`Repository '${repository}' is not owner/name`);
    const waitsFor = noneValue(waits) ? [] : waits.split(',').map((w) => w.trim());
    for (const w of waitsFor) {
      if (EXTERNAL_RE.test(w)) continue;
      const at = names.indexOf(w);
      if (!w) why.push('empty Waits for entry');
      else if (at === k) why.push(`waits for itself ('${w}')`);
      else if (at > k) why.push(`waits for '${w}', a later row`);
      else if (at === -1) why.push(`waits for unknown part '${w}'`);
    }
    if (why.length) errors.push(`row ${n}: ${why.join('; ')}`);
    parts.push({ n, name, slug, size, repository, waitsFor, issue: noneValue(issue) ? null : issue });
  });
  return { present, parts, errors };
}

function block(heading, bodyLines) {
  return [`## ${heading}`, ...bodyLines].map((l) => l.replace(/\s+$/, ''));
}

// 64-char lowercase hex sha256 of the approval's input; null when Frame,
// Approaches or Parts is missing.
function partsDigest(designText) {
  const frame = sectionLines(designText, FRAME_HEADING);
  const approaches = sectionLines(designText, APPROACHES_HEADING);
  const { lines, present, rows } = locateTable(designText);
  if (!frame || !approaches || !present) return null;
  const notStatus = (l) => !STATUS_RE.test(l);
  const rowText = rows.slice(1).map((i) => cellsOf(lines[i]).slice(0, ISSUE_COL).join(' | '));
  const input = [
    ...block(FRAME_HEADING, frame.filter(notStatus)),
    ...block(APPROACHES_HEADING, approaches.filter(notStatus)),
    ...block(PARTS_HEADING, rowText),
  ].join('\n');
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function approvalLine(date, digest) {
  return `Approved: ${date} — digest sha256:${digest}`;
}

function measure(designText) {
  return sectionField(designText, FRAME_HEADING, MEASURE_KEY);
}

// reason precedence: no-parts -> invalid-parts -> not-approved -> digest-mismatch -> approved.
function checkApproval(designText) {
  const { present, parts, errors: parseErrors } = parseParts(designText);
  const digest = partsDigest(designText);
  const out = (reason, errors) => ({
    approved: reason === 'approved', reason, parts, errors, measure: measure(designText), digest,
  });
  if (!present) return out('no-parts', []);
  const errors = [...parseErrors];
  for (const h of [FRAME_HEADING, APPROACHES_HEADING]) {
    if (!sectionLines(designText, h)) errors.push(`missing ## ${h} section`);
  }
  if (errors.length) return out('invalid-parts', errors);
  const approved = (sectionLines(designText, APPROVAL_HEADING) || [])
    .map((l) => APPROVED_RE.exec(l.trim())).find(Boolean);
  if (!approved) return out('not-approved', errors);
  return out(approved[2] === digest ? 'approved' : 'digest-mismatch', errors);
}

function estimate(parts) {
  const bySize = Object.fromEntries(SIZES.map((s) => [s, parts.filter((p) => p.size === s).length]));
  const count = parts.length;
  const sizes = SIZES.map((s) => `${bySize[s]} ${s}`).join(', ');
  const line = `Estimate: ${count} ${count === 1 ? 'part' : 'parts'} — ${sizes}. Tokens: not estimated — ${ESTIMATE_BASIS}`;
  return { count, bySize, tokens: null, basis: ESTIMATE_BASIS, line };
}

// Rewrites only the Issue cell of each named row: an empty cell, a `left for …`
// cell, or one already holding the same mark. A cell holding anything else is
// a conflict and stays as it is.
function markFiled(designText, marks) {
  const { lines, rows } = locateTable(designText);
  const eol = String(designText).includes('\r\n') ? '\r\n' : '\n';
  const byName = new Map(rows.slice(1).map((i) => [cellsOf(lines[i])[1], i]));
  const unknown = [];
  const conflicts = [];
  for (const [name, mark] of Object.entries(marks)) {
    if (!FILED_RE.test(mark) && !LEFT_RE.test(mark)) {
      throw new TypeError(`markFiled: '${mark}' for '${name}' is not an 'owner/name#N' or 'left for owner/name' mark`);
    }
    const i = byName.get(name);
    if (i === undefined) {
      unknown.push(name);
      continue;
    }
    const segs = lines[i].split('|');
    const current = (segs[ISSUE_COL + 1] || '').trim();
    if (current === mark) continue;
    if (!noneValue(current) && !LEFT_RE.test(current)) {
      conflicts.push(name);
      continue;
    }
    segs[ISSUE_COL + 1] = ` ${mark} `;
    lines[i] = segs.join('|');
  }
  return { text: lines.join(eol), unknown, conflicts };
}

// What one filing run from `thisRepository` does with the parts table.
function planFiling(parts, thisRepository) {
  const filed = (p) => p.issue !== null && FILED_RE.test(p.issue);
  const file = parts.filter((p) => p.repository === thisRepository
    && (p.issue === null || p.issue === `left for ${thisRepository}`));
  const fileNames = new Set(file.map((p) => p.name));
  const byName = new Map(parts.map((p) => [p.name, p]));
  const blocker = (w) => {
    if (EXTERNAL_RE.test(w)) return { kind: 'issue', ref: w };
    if (fileNames.has(w)) return { kind: 'sibling', ref: w };
    const p = byName.get(w);
    if (filed(p)) return { kind: 'issue', ref: p.issue };
    return { kind: 'symbolic', ref: `${w} (left for ${p.repository})` };
  };
  const writeBack = [];
  for (const p of parts) {
    if (p.repository === thisRepository || !filed(p)) continue;
    for (const w of p.waitsFor) if (fileNames.has(w)) writeBack.push({ issue: p.issue, waitsOn: w });
  }
  return {
    file: file.map((p) => ({ ...p, blockers: p.waitsFor.map(blocker) })),
    skipped: parts.filter(filed).map((p) => p.name),
    leftFor: parts.filter((p) => p.repository !== thisRepository && !filed(p))
      .map((p) => ({ name: p.name, repository: p.repository })),
    writeBack,
  };
}

module.exports = {
  PARTS_HEADING, APPROVAL_HEADING, FILING_HEADING, FRAME_HEADING, APPROACHES_HEADING, WORTH_IT_HEADING,
  MEASURE_KEY, TABLE_HEADER, SIZES,
  parseParts, partsDigest, approvalLine, checkApproval, estimate, measure, unitSlug, designSlug, markFiled,
  planFiling,
};
