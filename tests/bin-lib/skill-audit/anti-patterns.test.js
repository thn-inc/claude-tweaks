'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  extractAntiPatternRows,
  bodyOutsideSection,
  rowIdentifiers,
  compareTables,
} = require('../../../plugin/bin/lib/skill-audit/anti-patterns.js');
const { listSkillDirs, KNOWN_SKILLS } = require('../../../plugin/bin/lib/skill-audit/skill-catalog.js');
const { readText } = require('../../helpers/read-skill');
const { assertLastBump } = require('../../helpers/last-bump');

const SAMPLE = [
  '# Some skill',
  '',
  '## Anti-Patterns',
  '',
  '| Pattern | Why It Fails |',
  '|---------|-------------|',
  '| Skipping the test gate | `TEST_PASSED=true` is the contract `/review` reads |',
  '| Bulk-resolving items | Each needs a per-item decision |',
  '',
  '## Relationship to Other Skills',
  '',
  '| Skill | Relationship |',
].join('\n');

test('extracts rows, skipping the header and rule rows', () => {
  const rows = extractAntiPatternRows(SAMPLE);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].pattern, 'Skipping the test gate');
  assert.strictEqual(rows[1].why, 'Each needs a per-item decision');
});

test('stops at the next ## heading', () => {
  const rows = extractAntiPatternRows(SAMPLE);
  assert.ok(rows.every((r) => !r.pattern.startsWith('Skill')));
});

test('runs to end of file when no heading follows', () => {
  const noTail = SAMPLE.split('\n## Relationship')[0];
  assert.strictEqual(extractAntiPatternRows(noTail).length, 2);
});

test('returns empty for a file with no Anti-Patterns section', () => {
  assert.deepStrictEqual(extractAntiPatternRows('# Nothing here\n\ntext'), []);
});

test('bodyOutsideSection removes the section', () => {
  const body = bodyOutsideSection(SAMPLE);
  assert.ok(!body.includes('Skipping the test gate'));
  assert.ok(body.includes('## Relationship to Other Skills'));
});

test('splitCells handles an escaped pipe inside a cell', () => {
  const md = [
    '## Anti-Patterns',
    '| Pattern | Why It Fails |',
    '|---|---|',
    '| Using `a \\| b` syntax | Breaks the table |',
  ].join('\n');
  const rows = extractAntiPatternRows(md);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].pattern, 'Using `a | b` syntax');
  assert.strictEqual(rows[0].why, 'Breaks the table');
});

test('rowIdentifiers picks up backticked anchors from both cells', () => {
  const rows = extractAntiPatternRows(SAMPLE);
  const ids = rowIdentifiers(rows[0]);
  assert.ok(ids.has('TEST_PASSED=true'));
  assert.ok(ids.has('/review'));
});

// ── The guard itself. Each of these must FAIL on the damage it describes, or it
// is not a check (IL-78). Every case below is the "damaged" direction.

test('compareTables reports a clean compression as lossless', () => {
  const before = extractAntiPatternRows(SAMPLE);
  const compressed = SAMPLE.replace(
    '| Skipping the test gate | `TEST_PASSED=true` is the contract `/review` reads |',
    '| Skipping the test gate | `TEST_PASSED=true` is what `/review` reads |',
  );
  const result = compareTables(before, extractAntiPatternRows(compressed));
  assert.strictEqual(result.evicted, 0);
  assert.deepStrictEqual(result.lostIdentifiers, []);
});

test('compareTables CATCHES an evicted row', () => {
  const before = extractAntiPatternRows(SAMPLE);
  const gutted = SAMPLE.replace(
    '| Bulk-resolving items | Each needs a per-item decision |\n',
    '',
  );
  const result = compareTables(before, extractAntiPatternRows(gutted));
  assert.strictEqual(result.countBefore, 2);
  assert.strictEqual(result.countAfter, 1);
  assert.strictEqual(result.evicted, 1, 'an evicted row must be reported');
});

test('compareTables CATCHES a dropped identifier inside a surviving row', () => {
  const before = extractAntiPatternRows(SAMPLE);
  // The row survives and still reads plausibly — but no longer names the
  // contract it governs. This is the failure a per-row reviewer waves through.
  const vague = SAMPLE.replace(
    '| Skipping the test gate | `TEST_PASSED=true` is the contract `/review` reads |',
    '| Skipping the test gate | The gate exists for a reason |',
  );
  const result = compareTables(before, extractAntiPatternRows(vague));
  assert.strictEqual(result.evicted, 0, 'row count is unchanged — count alone would pass');
  const lost = result.lostIdentifiers.map((l) => l.identifier).sort();
  assert.deepStrictEqual(lost, ['/review', 'TEST_PASSED=true']);
});

test('every shipped skill has a parseable Anti-Patterns table', () => {
  const skillsDir = path.join(__dirname, '..', '..', '..', 'plugin', 'skills');
  // listSkillDirs resolves `skills/` directly beneath the root it is given —
  // that root is the plugin payload root (`plugin/`), not the repo root.
  const pluginRoot = path.join(__dirname, '..', '..', '..', 'plugin');
  const names = listSkillDirs(pluginRoot);
  // Directory-derived, not a hard-coded `33` -- see skill-catalog.js.
  assert.ok(names.length >= 30, `expected the whole skill corpus, found ${names.length}`);
  for (const known of KNOWN_SKILLS) {
    assert.ok(names.includes(known), `corpus is missing a known skill: ${known}`);
  }

  let total = 0;
  for (const name of names) {
    const md = readText(path.join(skillsDir, name, 'SKILL.md'));
    const rows = extractAntiPatternRows(md);
    assert.ok(rows.length > 0, `${name}/SKILL.md has no Anti-Pattern rows`);
    for (const row of rows) {
      assert.ok(row.pattern.length > 0, `${name}:${row.line} has an empty Pattern cell`);
      assert.ok(row.why.length > 0, `${name}:${row.line} has an empty Why cell`);
    }
    total += rows.length;
  }
  assertLastBump(__filename);
  // Live corpus measurement. This total changes only with a recorded reason (a
  // row added or removed on purpose). Re-derive it by running this parser on the
  // working tree, never by adding a delta to the old number ([IL-99]). Each bump
  // rewrites the line below; the full history is `git log -L` on the assertion.
  // Last bump: 444 -> 445, #6353
  assert.strictEqual(total, 445);
});
