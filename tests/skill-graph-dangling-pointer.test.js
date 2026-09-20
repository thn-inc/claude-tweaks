// tests/skill-graph-dangling-pointer.test.js
//
// Conformance check for docs/skill-graph.md's stated-once convention (#1705). Record
// #1423's own build (commit fc2160ba2) added a `_shared/dependency-narration-check.md`
// row under `capture` that closed with "see the `## specify` section" — a pointer to a
// row that did not exist there. Nothing mechanically caught it; a second careful read
// did. This suite mechanizes the narrow, precisely-checkable half of that defect class:
// a `_shared/*.md`-target row's "see the `## {section}` section" pointer must resolve to
// a row for the *same target* actually present in that named section's table.
//
// A fully generic "no `_shared/*.md` target may ever appear in more than one section"
// check was investigated and rejected: the live document has ~30 shared files cited
// independently by several skills (each row stating that skill's own distinct
// relationship — not a restatement), which is normal per docs/skill-graph.md's own "How
// to read this" preamble, not a defect. A narrower duplicate-row heuristic (flag a
// target re-appearing under a skill explicitly named as a co-citer in another row's
// "Shared with ... — owned here" clause) was also tried and still produced false
// positives against the live document — two rows sharing a co-citer name but describing
// genuinely different facts about the same file (`_shared/pr-early-run-lifecycle.md`:
// build's row is about phase-checklist pushes, wrap-up's separate row is about
// residue-sweep's unrelated PR reuse). Telling "restated content" from "a different fact
// about the same file" is a semantic judgment, not a mechanical one — the cheaper
// preamble-warning alternative (docs/skill-graph.md's "How to read this") covers that
// half instead; this test covers only the dangling-pointer half, which is fully
// mechanical: the pointer names a specific section and target, and either a matching row
// is there or it isn't.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILL_GRAPH_PATH = path.join(ROOT, 'docs/skill-graph.md');

/**
 * Parses skill-graph.md into `{ sections: Map<sectionName, Array<{target, text, line}>> }`.
 * A "row" is any `| \`target\` | ... |` line immediately under a `## {section}` heading —
 * good enough for this check, which only needs the target cell and the row's raw text.
 */
function parseSkillGraph(text) {
  const lines = text.split('\n');
  const sections = new Map();
  let currentSection = null;
  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^## (.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      if (!sections.has(currentSection)) sections.set(currentSection, []);
      continue;
    }
    const rowMatch = lines[i].match(/^\|\s*`([^`]+)`/);
    if (rowMatch && currentSection) {
      sections.get(currentSection).push({ target: rowMatch[1], text: lines[i], line: i + 1 });
    }
  }
  return sections;
}

const SHARED_TARGET_RE = /(?:^|\/)_shared\/[\w.-]+\.md$/;
// Matches a pointer of the shape: see the `## {section}` section
const SECTION_POINTER_RE = /see the `##\s*([\w-]+)`\s*section/gi;

/**
 * Finds every `_shared/*.md`-target row carrying a "see the `## {section}` section"
 * pointer whose named section's table has no row for the same target.
 */
function findDanglingPointers(sections) {
  const offenders = [];
  for (const [ownerSection, rows] of sections) {
    for (const row of rows) {
      if (!SHARED_TARGET_RE.test(row.target)) continue;
      for (const match of row.text.matchAll(SECTION_POINTER_RE)) {
        const pointedSection = match[1];
        const targetRows = sections.get(pointedSection) || [];
        const hasMatchingRow = targetRows.some((r) => r.target === row.target);
        if (!hasMatchingRow) {
          offenders.push({
            line: row.line,
            target: row.target,
            ownerSection,
            pointedSection,
          });
        }
      }
    }
  }
  return offenders;
}

function formatOffenders(offenders) {
  return offenders
    .map(
      (o) =>
        `docs/skill-graph.md:${o.line} — \`${o.target}\` row under "## ${o.ownerSection}" points ` +
        `to "see the \`## ${o.pointedSection}\` section" but no row for \`${o.target}\` exists there`
    )
    .join('\n');
}

test('docs/skill-graph.md: every "see the `## {section}` section" pointer on a `_shared/*.md` row resolves to a matching row there', () => {
  const text = fs.readFileSync(SKILL_GRAPH_PATH, 'utf8');
  const sections = parseSkillGraph(text);
  assert.ok(sections.size > 0, 'section parser found zero `## ` sections — extraction is broken, not the file');
  const offenders = findDanglingPointers(sections);
  assert.deepStrictEqual(offenders, [], `Dangling section pointer(s):\n${formatOffenders(offenders)}`);
});

// Go-red proof: reproduces the exact fc2160ba2 defect shape — a `_shared/*.md` row
// pointing at a section that carries no row for that same target — through the same
// parse/find pipeline the live-file assertion above uses.
const CLEAN_DOC = [
  '## capture',
  '',
  '| Target | Relationship |',
  '|---|---|',
  '| `_shared/dependency-narration-check.md` | Shared with `/specify` (its own body-edit step) — owned here as the alphabetically-first of the two citing skills. |',
  '',
  '## specify',
  '',
  '| Target | Relationship |',
  '|---|---|',
  '| `/capture` | Some unrelated relationship. |',
].join('\n');

const DANGLING_DOC = [
  '## capture',
  '',
  '| Target | Relationship |',
  '|---|---|',
  '| `_shared/dependency-narration-check.md` | Some relationship — see the `## specify` section. |',
  '',
  '## specify',
  '',
  '| Target | Relationship |',
  '|---|---|',
  '| `/capture` | Some unrelated relationship. |',
].join('\n');

test('go-red proof: a `_shared/*.md` row with no matching pointer is clean', () => {
  const offenders = findDanglingPointers(parseSkillGraph(CLEAN_DOC));
  assert.deepStrictEqual(offenders, [], 'a row with no "see the section" pointer must not be reported');
});

test('go-red proof: a dangling "see the section" pointer with no matching row is caught', () => {
  const offenders = findDanglingPointers(parseSkillGraph(DANGLING_DOC));
  assert.strictEqual(offenders.length, 1, 'the dangling pointer must be reported exactly once');
  assert.strictEqual(offenders[0].target, '_shared/dependency-narration-check.md');
  assert.strictEqual(offenders[0].pointedSection, 'specify');
});

test('go-red proof: a "see the section" pointer resolving to a matching row is not flagged', () => {
  const RESOLVED_DOC = [
    '## capture',
    '',
    '| Target | Relationship |',
    '|---|---|',
    '| `_shared/dependency-narration-check.md` | Some relationship — see the `## specify` section. |',
    '',
    '## specify',
    '',
    '| Target | Relationship |',
    '|---|---|',
    '| `_shared/dependency-narration-check.md` | The reciprocal detail. |',
  ].join('\n');
  const offenders = findDanglingPointers(parseSkillGraph(RESOLVED_DOC));
  assert.deepStrictEqual(offenders, [], 'a pointer resolving to an actual matching row must not be reported');
});
