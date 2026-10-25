// plugin/bin/lib/console/staged-digest-text.js — what a staged file says, as one line of
// text (#3950). Shared by backfill.js (the claim of a staged finding file with no `Finding:`
// line) and backfill-dispose.js (a digest line's finding text). A leaf module: it requires
// nothing from the backfill modules, which require each other. Pure: no read, no write.
'use strict';

const KEY_VALUE_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,30}:(\s|$)/;
const METADATA_LINE_RE = /^(?:Ledger|Run|Mode|Source|Files):/i;
const TABLE_SEPARATOR_RE = /^\|[\s:|-]*-[\s:|-]*$/;
// Where a patch proposal's diff (or a dream proposal's quoted evidence) begins: nothing from here on
// is digest text. A bare `---` rule and a `- ` bullet are not diff lines.
const DIFF_START_RE = /^(?:diff --git |@@(?: |$)|--- |\+\+\+ |index [0-9a-f]+\.\.|```diff)/;
// A dream proposal's quoted session line (`- Session \`abc\` (…):`); the indented sub-bullets under it go with it.
const SESSION_LINE_RE = /^-\s+Session\s+`/;

// A table data row as its non-numeric, non-empty cells joined by ` — ` (the row number and the
// `—` placeholder cells carry nothing).
function dataRowText(line) {
  const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '' && !/^\d+$/.test(c) && !/^[—–-]$/.test(c));
  return cells.join(' — ');
}

// The first thing worth reading in `lines`: skips headings, blank lines, the leading `Key: value`
// header block (when `skipHeaderBlock`), `**Key:**` lines, metadata lines (Ledger/Run/Mode/Source/Files),
// rules, and a markdown table's header and separator rows; a table data row reads as its cells; a
// prose line reads as itself, or as its whole paragraph when `paragraph`.
function firstContent(lines, { paragraph, skipHeaderBlock }) {
  let inHeader = false;
  let seenContent = false;
  let inSession = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') { inHeader = false; continue; }
    // A quoted session line and the indented sub-bullets under it (its commands, its paths) are evidence, never text.
    if (SESSION_LINE_RE.test(line)) { inSession = true; continue; }
    if (inSession && /^\s/.test(lines[i])) continue;
    inSession = false;
    if (line.startsWith('#')) continue;
    if (DIFF_START_RE.test(line)) return '';
    if (!seenContent) { seenContent = true; inHeader = skipHeaderBlock && KEY_VALUE_RE.test(line) && headerHasContentAfter(lines, i); }
    if (inHeader || /^\*\*[^*]+:\*\*/.test(line) || METADATA_LINE_RE.test(line) || /^-{3,}$/.test(line) || line.startsWith('```')) continue;
    if (line.startsWith('|')) {
      if (TABLE_SEPARATOR_RE.test(line) || TABLE_SEPARATOR_RE.test((lines[i + 1] || '').trim())) continue;
      const row = dataRowText(line);
      if (row) return row;
      continue;
    }
    if (!paragraph) return line;
    const para = [];
    for (let j = i; j < lines.length && lines[j].trim() !== '' && !DIFF_START_RE.test(lines[j].trim()); j++) para.push(lines[j].trim());
    return para.join(' ');
  }
  return '';
}

// A leading `Key: value` run is a header block only when a blank line and more content follow it: a
// file that is nothing but `Note: a sentence` keeps its sentence.
function headerHasContentAfter(lines, from) {
  let j = from;
  while (j < lines.length && lines[j].trim() !== '') j++;
  return lines.slice(j).some((l) => l.trim() !== '');
}

// The `Key: value` lines that open a file (after any headings and blank lines), as { lowercased key: value }.
function leadingHeader(lines) {
  const header = {};
  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!started && (line === '' || line.startsWith('#'))) continue;
    const m = /^([A-Za-z][A-Za-z0-9 _-]{0,30}):[ \t]*(.*)$/.exec(line);
    if (!m) break;
    started = true;
    const key = m[1].toLowerCase();
    if (!Object.hasOwn(header, key)) header[key] = m[2].trim();
  }
  return header;
}

// A staged file's digest text, never a diff line:
//   1. a patch proposal's header block: its `Finding:` value, else `Target: {value}`;
//   2. the first paragraph under a `## Finding` heading;
//   3. a dream proposal's `**Pattern:**` value;
//   4. the first content line.
function digestTextOf(text) {
  const lines = String(text).split(/\r?\n/);
  const header = leadingHeader(lines);
  if (header.finding) return header.finding;
  if (header.target) return `Target: ${header.target}`;
  const start = lines.findIndex((l) => /^##\s+Finding\s*$/i.test(l));
  if (start >= 0) {
    const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    const section = firstContent(lines.slice(start + 1, next < 0 ? lines.length : next), { paragraph: true, skipHeaderBlock: false });
    if (section) return section;
  }
  const pattern = lines.map((l) => /^\*\*Pattern:\*\*[ \t]*(.+)$/.exec(l.trim())).find(Boolean);
  if (pattern && pattern[1].trim()) return pattern[1].trim();
  return firstContent(lines, { paragraph: false, skipHeaderBlock: true });
}

// A patch proposal's `Target:` header value (the file it patches), or null.
function targetOf(text) {
  const target = leadingHeader(String(text).split(/\r?\n/)).target;
  return target ? target : null;
}

module.exports = { digestTextOf, targetOf };
