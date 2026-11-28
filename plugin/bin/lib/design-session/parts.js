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
//     filed or re-marked again; `left for …` counts as marked, not as filed,
//     except in the run of the repository it names, where it is still to file.
//     The cell is empty, `—`, or a mark naming the row's own Repository
//     (`{Repository}#N` or `left for {Repository}`); anything else (`#7001`,
//     `TBD`, a mark naming another repository) is a row error, so no part ever
//     falls outside planFiling.
// The part that makes the order visible to a user is the last row.
//
// `## Approval` holds a `Status:` line and exactly one status line
//   `Approved: {YYYY-MM-DD} — digest sha256:{64 lowercase hex}`   (approvalLine)
// outside a fence; none, or more than one, is not approved.
// The digest is sha256 over three blocks joined with `\n`: `## Frame` and
// `## Approaches` (each its heading line, then its section lines without
// `Status:` lines) and `## Parts` (its heading line, then each data row's first
// five cells, trimmed, joined with ` | `); every line is right-trimmed. Issue
// marks and the Estimate line are outside it, so filing never invalidates it.
//
// The worth-it measure is `## Frame`'s first `Measure:` line outside a fence, read verbatim; the
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
const { sectionLines } = require('./design-md');

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
// GitHub owner/name is case-insensitive: the one comparison of two repositories.
const sameRepository = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const FILED_RE = new RegExp(`^(${REPO})#\\d+$`);
const LEFT_RE = new RegExp(`^left for (${REPO})$`);
const EXTERNAL_RE = new RegExp(`^(?:${REPO})?#\\d+$`);
const NONE_VALUES = ['', '—', '–', '-'];
const SEPARATOR_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const APPROVED_RE = /^Approved: (\d{4}-\d{2}-\d{2}) — digest sha256:([0-9a-f]{64})$/;
// design-md.js sectionField's `{key}:` line rule, read here over unfenced lines only.
const MEASURE_RE = new RegExp(`^\\s*${MEASURE_KEY}:\\s*(.*?)\\s*$`, 'i');

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

// -> { lines, body: [full-text line index of each section line, with
// `fenced` marking those inside a fence] } for `## {heading}`, or null when
// the section is absent. The section's bounds are sectionLines'.
function sectionIndices(designText, heading) {
  const lines = splitLines(designText);
  const body = sectionLines(designText, heading);
  if (!body) return null;
  const fenced = fencedLineMask(lines);
  const start = lines.findIndex((l, i) => !fenced[i] && H2_RE.test(l) && l.replace(/^##\s+/, '').trim() === heading);
  const indices = [];
  for (let i = start + 1; i <= start + body.length; i++) indices.push(i);
  return { lines, indices, fenced };
}

// The section's lines outside a fence; null when the section is absent.
function unfencedSectionLines(designText, heading) {
  const s = sectionIndices(designText, heading);
  return s && s.indices.filter((i) => !s.fenced[i]).map((i) => s.lines[i]);
}

// -> { lines, present, header: index|null, rows: [line index] } for the
// `## Parts` table in the full text.
function locateTable(designText) {
  const s = sectionIndices(designText, PARTS_HEADING);
  if (!s) return { lines: splitLines(designText), present: false, header: null, rows: [] };
  const { lines, indices, fenced } = s;
  const isRow = (i) => !fenced[i] && lines[i].trim().startsWith('|');
  let header = null;
  const rows = [];
  for (const i of indices) {
    if (header === null) {
      if (isRow(i)) header = i;
    } else if (isRow(i)) rows.push(i);
    else break;
  }
  return { lines, present: true, header, rows };
}

// Why an Issue cell is malformed for a row of `repository`, or null when it is fine.
function issueProblem(issue, repository) {
  if (noneValue(issue)) return null;
  const repo = markRepository(issue);
  if (repo === null) return `Issue '${issue}' is not empty, 'owner/name#N' or 'left for owner/name'`;
  if (!sameRepository(repo, repository)) return `Issue '${issue}' names another repository than the part's own '${repository}'`;
  return null;
}

// The `owner/name` an `owner/name#N` or `left for owner/name` mark names; null for anything else.
function markRepository(mark) {
  const m = FILED_RE.exec(mark) || LEFT_RE.exec(mark);
  return m ? m[1] : null;
}

// The `owner/name` a `left for owner/name` mark names; null for anything else.
function leftForRepository(mark) {
  const m = LEFT_RE.exec(mark);
  return m ? m[1] : null;
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
    const issueWhy = issueProblem(issue, repository);
    if (issueWhy) why.push(issueWhy);
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
  for (const line of unfencedSectionLines(designText, FRAME_HEADING) || []) {
    const m = MEASURE_RE.exec(line);
    if (m) return m[1];
  }
  return null;
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
  const approvals = (unfencedSectionLines(designText, APPROVAL_HEADING) || [])
    .map((l) => APPROVED_RE.exec(l.trim())).filter(Boolean);
  if (approvals.length !== 1) return out('not-approved', errors);
  return out(approvals[0][2] === digest ? 'approved' : 'digest-mismatch', errors);
}

function estimate(parts) {
  const bySize = Object.fromEntries(SIZES.map((s) => [s, parts.filter((p) => p.size === s).length]));
  const count = parts.length;
  const sizes = SIZES.map((s) => `${bySize[s]} ${s}`).join(', ');
  const line = `Estimate: ${count} ${count === 1 ? 'part' : 'parts'} — ${sizes}. Tokens: not estimated — ${ESTIMATE_BASIS}`;
  return { count, bySize, tokens: null, basis: ESTIMATE_BASIS, line };
}

// Rewrites only the Issue cell of each named row: an empty cell, a `left for …`
// cell, or one already holding the same mark. A cell holding anything else, or
// a mark naming another repository than the row's, is a conflict and stays as
// it is.
function markFiled(designText, marks) {
  const { lines, rows } = locateTable(designText);
  const eol = String(designText).includes('\r\n') ? '\r\n' : '\n';
  const byName = new Map(rows.slice(1).map((i) => [cellsOf(lines[i])[1], i]));
  const unknown = [];
  const conflicts = [];
  const marked = [];
  for (const [name, mark] of Object.entries(marks)) {
    const markRepo = markRepository(mark);
    if (markRepo === null) {
      throw new TypeError(`markFiled: '${mark}' for '${name}' is not an 'owner/name#N' or 'left for owner/name' mark`);
    }
    const i = byName.get(name);
    if (i === undefined) {
      unknown.push(name);
      continue;
    }
    const segs = lines[i].split('|');
    const current = (segs[ISSUE_COL + 1] || '').trim();
    if (!sameRepository(markRepo, cellsOf(lines[i])[3])) {
      conflicts.push(name);
      continue;
    }
    if (sameRepository(current, mark)) continue;
    if (!noneValue(current) && !LEFT_RE.test(current)) {
      conflicts.push(name);
      continue;
    }
    segs[ISSUE_COL + 1] = ` ${mark} `;
    lines[i] = segs.join('|');
    marked.push(name);
  }
  return { text: lines.join(eol), marked, unknown, conflicts };
}

// A blocker on a part left for another repository: its name and that part's
// Repository cell, spelled as the table spells it. The earlier run writes it as
// `Blocked by: {ref}`; the later run's writeBack `line` is that same text.
const symbolicRef = (name, repository) => `${name} (left for ${repository})`;

// What one filing run from `thisRepository` does with the parts table. Takes
// parts from a parse with no errors; a Waits for name matching no part, or a
// this-repository part that is neither fileable nor filed, throws.
function planFiling(parts, thisRepository) {
  const filed = (p) => p.issue !== null && FILED_RE.test(p.issue) && sameRepository(markRepository(p.issue), p.repository);
  const file = parts.filter((p) => sameRepository(p.repository, thisRepository)
    && (p.issue === null || (LEFT_RE.test(p.issue) && sameRepository(markRepository(p.issue), thisRepository))));
  for (const p of parts) {
    if (sameRepository(p.repository, thisRepository) && !file.includes(p) && !filed(p)) {
      throw new Error(`planFiling: part '${p.name}' of ${thisRepository} is neither fileable nor filed (Issue '${p.issue}')`);
    }
  }
  const fileNames = new Set(file.map((p) => p.name));
  const byName = new Map(parts.map((p) => [p.name, p]));
  const blocker = (w) => {
    if (EXTERNAL_RE.test(w)) return { kind: 'issue', ref: w };
    if (fileNames.has(w)) return { kind: 'sibling', ref: w };
    const p = byName.get(w);
    if (!p) throw new Error(`planFiling: Waits for names unknown part '${w}'`);
    if (filed(p)) return { kind: 'issue', ref: p.issue };
    return { kind: 'symbolic', ref: symbolicRef(w, p.repository) };
  };
  const writeBack = [];
  for (const p of parts) {
    if (sameRepository(p.repository, thisRepository) || !filed(p)) continue;
    for (const w of p.waitsFor) {
      if (fileNames.has(w)) writeBack.push({ issue: p.issue, waitsOn: w, line: `Blocked by: ${symbolicRef(w, byName.get(w).repository)}` });
    }
  }
  return {
    file: file.map((p) => ({ ...p, blockers: p.waitsFor.map(blocker) })),
    skipped: parts.filter(filed).map((p) => p.name),
    leftFor: parts.filter((p) => !sameRepository(p.repository, thisRepository) && !filed(p))
      .map((p) => ({ name: p.name, repository: p.repository })),
    writeBack,
  };
}

module.exports = {
  PARTS_HEADING, APPROVAL_HEADING, FILING_HEADING, FRAME_HEADING, APPROACHES_HEADING, WORTH_IT_HEADING,
  MEASURE_KEY, TABLE_HEADER, SIZES, REPO_RE, sameRepository,
  markRepository, leftForRepository, parseParts, partsDigest, approvalLine, checkApproval, estimate, measure, unitSlug, designSlug, markFiled,
  planFiling,
};
