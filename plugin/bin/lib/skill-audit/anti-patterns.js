'use strict';

// Parser and preservation check for a SKILL.md's `## Anti-Patterns` table.
//
// Phase 3 compresses these tables in place and must never evict a row. That
// constraint is unusually load-bearing: an Anti-Pattern row is a negative
// instruction ("don't skip the test gate"), and deleting one degrades SILENTLY
// — nothing observable happens when the model stops being told not to do
// something. There is no failing test for a guardrail that quietly went away.
//
// So the compression needs a check that can actually fail. Two invariants:
//
//   1. Row count per skill is unchanged. Eviction is the failure mode; this
//      catches it outright.
//   2. Every backticked identifier in a row survives somewhere in that row.
//      Identifiers are the concrete anchors a rule hangs on (`TEST_PASSED=true`,
//      `acceptance: pending`, `$PIPELINE_RUN_DIR`); prose around them may be tightened
//      freely, but losing one means the rule no longer names what it governs.
//
// Deliberately NOT checked: prose similarity. Compression is supposed to rewrite
// the prose — a similarity floor would just block the work it is meant to guard.
// Semantic preservation is the reviewer's job; this module covers the two
// failure modes a reviewer reading one row at a time cannot see.

const HEADING = /^##\s+Anti-Patterns\b/;
const NEXT_HEADING = /^##\s/;
const RULE_ROW = /^\|\s*:?-+/;

// Same boundary rule as relationship-rows.js: a missing next heading means the
// section runs to end of file.
function locate(lines) {
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !NEXT_HEADING.test(lines[end])) end += 1;
  return { start, end };
}

function splitCells(line) {
  // A table row is `| a | b |`. Strip the outer pipes, then split. Cells may
  // legitimately contain escaped pipes (`\|`) inside code spans.
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const parts = [];
  let cur = '';
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\' && inner[i + 1] === '|') { cur += '|'; i += 1; continue; }
    if (inner[i] === '|') { parts.push(cur); cur = ''; continue; }
    cur += inner[i];
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

function extractAntiPatternRows(markdown) {
  const lines = markdown.split('\n');
  const span = locate(lines);
  if (!span) return [];
  const rows = [];
  let seenHeader = false;
  for (let i = span.start + 1; i < span.end; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    if (RULE_ROW.test(line.trim())) continue;
    const cells = splitCells(line);
    if (cells.length < 2) continue;
    if (!seenHeader) { seenHeader = true; continue; } // `| Pattern | Why It Fails |`
    rows.push({ line: i + 1, pattern: cells[0], why: cells[1], raw: line });
  }
  return rows;
}

function bodyOutsideSection(markdown) {
  const lines = markdown.split('\n');
  const span = locate(lines);
  if (!span) return markdown;
  return [...lines.slice(0, span.start), ...lines.slice(span.end)].join('\n');
}

// Backticked spans are the anchors. Length floor of 2 keeps single letters out
// while still catching short but real tokens.
function rowIdentifiers(row) {
  const out = new Set();
  for (const m of `${row.pattern} ${row.why}`.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    if (t.length >= 2) out.add(t);
  }
  return out;
}

// Compares two versions of one skill's table, pairing rows by position.
// Returns { countBefore, countAfter, evicted, lostIdentifiers[] }.
function compareTables(beforeRows, afterRows) {
  const lost = [];
  const n = Math.min(beforeRows.length, afterRows.length);
  for (let i = 0; i < n; i += 1) {
    const before = rowIdentifiers(beforeRows[i]);
    const afterText = `${afterRows[i].pattern} ${afterRows[i].why}`;
    for (const id of before) {
      if (!afterText.includes(id)) lost.push({ index: i, identifier: id });
    }
  }
  return {
    countBefore: beforeRows.length,
    countAfter: afterRows.length,
    evicted: beforeRows.length - afterRows.length,
    lostIdentifiers: lost,
  };
}

module.exports = {
  extractAntiPatternRows,
  bodyOutsideSection,
  rowIdentifiers,
  compareTables,
};
