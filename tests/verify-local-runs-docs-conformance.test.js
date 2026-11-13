// tests/verify-local-runs-docs-conformance.test.js — pins #5369's documentation: the `localRuns`
// key, `--local` and exit 3 are stated where a reader looks (test/ci-source.md, suite-slots.md,
// stamp-composition.md, docs/plugin-structure.md), the two reason codes are in the reason table,
// and no shipped doc still says a CI-declared suite always falls back to a local run. Every pinned
// clause was added in the same change, so each go-red proof mutates the live text in memory.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');
const { LOCAL_REQUESTED, NOT_CONSULTED } = require('../plugin/bin/lib/verify/ci-source');
const { EXIT_NO_VERDICT } = require('../plugin/bin/lib/verify/args');

const ROOT = path.join(__dirname, '..');
const TEST_SKILL = path.join(ROOT, 'plugin', 'skills', 'test');
const CI_SOURCE = path.join(TEST_SKILL, 'ci-source.md');
const SUITE_SLOTS = path.join(TEST_SKILL, 'suite-slots.md');
const STAMP_COMPOSITION = path.join(TEST_SKILL, 'stamp-composition.md');
const PLUGIN_STRUCTURE = path.join(ROOT, 'docs', 'plugin-structure.md');

const checkFacts = (text, facts, label) => {
  const missing = missingFactsOf(facts);
  assert.deepEqual(missing(text), [], `${label} must state every fact (#5369)`);
  assertEachPatternGoesRed(text, facts, missing);
};

const LOCAL_RUNS_FACTS = [
  [/"localRuns": "on-request"/, 'the declaration line'],
  [/valid only together with a `ci` block/, 'valid only with a ci block'],
  [/exits 3/, 'an unanswered CI suite exits 3'],
  [/never a test failure/, 'exit 3 is never a test failure'],
  [/`--local` never consults CI and runs each selected suite here/, '--local never consults CI and runs each selected suite here'],
  [/exits 2/, 'an unscoped run naming a CI-declared suite exits 2'],
  [/--allow-escape-sequences/, 'the log download passes --allow-escape-sequences'],
  [/names the run URL/, 'a logless red job names the run URL'],
  [/--stamp-suite/, 'a --stamp-suite chunk is covered'],
];

test('ci-source.md: the Local runs on request section states the key, the flag and exit 3', () => {
  checkFacts(sectionOf(readText(CI_SOURCE), '## Local runs on request'), LOCAL_RUNS_FACTS, 'ci-source.md "## Local runs on request"');
});

const REASON_FACTS = [
  [/\| `local-requested` \| `--local` was passed, so CI was not consulted\. \|/, 'the local-requested row'],
  [/\| `not-consulted` \| Under `localRuns`, an earlier suite already left the run with no verdict, so CI was not asked about this one\. \|/, 'the not-consulted row'],
  [/\| `ci-log-unavailable` \|[^\n]*\(without `localRuns`\)/, 'the ci-log-unavailable row is qualified'],
];

test('ci-source.md: the reason table carries local-requested and not-consulted', () => {
  const section = sectionOf(readText(CI_SOURCE), '## Fallback reasons');
  checkFacts(section, REASON_FACTS, 'ci-source.md "## Fallback reasons"');
});

test('twin pins: the exported reason codes are the documented row keys, and exit 3 is the documented code', () => {
  const section = sectionOf(readText(CI_SOURCE), '## Fallback reasons');
  assert.ok(section.includes(`| \`${LOCAL_REQUESTED}\` |`), 'LOCAL_REQUESTED must be a row of the reason table');
  assert.ok(section.includes(`| \`${NOT_CONSULTED}\` |`), 'NOT_CONSULTED must be a row of the reason table');
  assert.strictEqual(EXIT_NO_VERDICT, 3);
  assert.match(sectionOf(readText(CI_SOURCE), '## Local runs on request'), /exits 3/);
});

const CHUNK_FACTS = [
  [/`localRuns: "on-request"`/, 'stamp-composition: names the declaration key'],
  [/needs `--local`/, 'stamp-composition: a chunk of a CI-declared suite needs --local'],
];

test('stamp-composition.md: the chunked verification paragraph states the --local requirement', () => {
  const text = readText(STAMP_COMPOSITION);
  const start = text.indexOf('**Chunked verification (#3002).**');
  assert.notEqual(start, -1, 'the Chunked verification paragraph is missing');
  const end = text.indexOf('\n\n', start);
  assert.notEqual(end, -1, 'the Chunked verification paragraph must end at a blank line');
  checkFacts(text.slice(start, end), CHUNK_FACTS, 'the Chunked verification paragraph');
});

const LANE_FACTS = [
  [/Under `localRuns: "on-request"` \(`ci-source\.md`\) a CI-declared suite runs here only with `--local`\. A run that exits 3 has taken no slot\./, 'suite-slots: the localRuns bullet'],
];

test('suite-slots.md: the Lanes section states the localRuns bullet', () => {
  checkFacts(sectionOf(readText(SUITE_SLOTS), '## Lanes'), LANE_FACTS, 'suite-slots.md "## Lanes"');
});

const VERIFY_LINE_FACTS = [
  [/\[--stamp-suite\] \[--local\]/, 'plugin-structure: the synopsis carries [--local]'],
  [/CI cannot answer exits 3/, 'plugin-structure: exit 3'],
  [/neither `--scope` nor `--local` exits 2/, 'plugin-structure: exit 2'],
];
const CI_ENTRY_FACTS = [
  [/localRuns/, 'plugin-structure: the ci-source.js entry names localRuns'],
  [/--allow-escape-sequences/, 'plugin-structure: the ci-source.js entry names --allow-escape-sequences'],
];

test('docs/plugin-structure.md: the verify.js synopsis and the ci-source.js entry state the key, the flag and exit 3', () => {
  const text = readText(PLUGIN_STRUCTURE);
  checkFacts(lineStartingWith(text, 'node plugin/bin/verify.js'), VERIFY_LINE_FACTS, 'the verify.js line');
  const entryStart = text.indexOf('ci-source.js (#4347');
  assert.notEqual(entryStart, -1, 'the ci-source.js (#4347 entry is missing');
  const entryEnd = text.indexOf('slot.js (#5119', entryStart);
  assert.notEqual(entryEnd, -1, 'the slot.js entry that closes the ci-source.js entry is missing');
  checkFacts(text.slice(entryStart, entryEnd), CI_ENTRY_FACTS, 'the ci-source.js entry');
});

// Retirement sweep: no shipped doc says a CI-declared suite always runs locally when CI cannot answer.
const RETIRED = [
  'Every other outcome runs the suite locally, exactly as selected',
  'and falls back to the local run with a named reason otherwise.',
  'the caller runs verify.js without `--scope`, which never consults `ci`',
  'or returns a named fallback reason and the suite runs locally)',
];

function markdownUnder(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownUnder(full));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

const SWEPT = [
  ...markdownUnder(path.join(ROOT, 'plugin', 'skills')),
  ...markdownUnder(path.join(ROOT, '.claude', 'skills')),
  PLUGIN_STRUCTURE,
];
const collapse = (text) => text.replace(/\s+/g, ' ');
const retiredIn = (text) => RETIRED.filter((sentence) => collapse(text).includes(sentence));

test('retirement sweep: the sweep walks plugin/skills, .claude/skills and docs/plugin-structure.md', () => {
  assert.ok(SWEPT.some((file) => file.includes(`${path.sep}.claude${path.sep}skills${path.sep}`)), 'no .claude/skills file was walked');
  assert.ok(SWEPT.some((file) => file.includes(`${path.sep}plugin${path.sep}skills${path.sep}`)), 'no plugin/skills file was walked');
  assert.ok(SWEPT.includes(PLUGIN_STRUCTURE));
});

test('retirement sweep: no shipped doc still says a CI-declared suite always runs locally', () => {
  const offenders = SWEPT.map((file) => [path.relative(ROOT, file), retiredIn(readText(file))]).filter(([, hits]) => hits.length > 0);
  assert.deepEqual(offenders, [], 'a doc still carries a retired always-falls-back sentence (#5369)');
});

test('retirement sweep: each retired sentence, planted in a doc, is caught', () => {
  const base = readText(CI_SOURCE);
  assert.deepEqual(retiredIn(base), [], 'the control file must start clean');
  for (const sentence of RETIRED) {
    const planted = `${base}\n${sentence.replace(/ /g, '\n')}\n`;
    assert.notEqual(planted, base);
    assert.deepEqual(retiredIn(planted), [sentence], `planting "${sentence}" must turn the sweep red`);
  }
});
