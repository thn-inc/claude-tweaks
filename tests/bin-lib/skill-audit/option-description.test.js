'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  extractDescriptionFields,
  flagQuestionMarks,
  listMarkdownFiles,
} = require('../../../plugin/bin/lib/skill-audit/option-description.js');
const { listSkillDirs } = require('../../../plugin/bin/lib/skill-audit/skill-catalog.js');
const { readText } = require('../../helpers/read-skill');

const SAMPLE = [
  '- Option 1 — `label`: `"Quick"`, `description`: `"~2-5 min, 5+ sources"`',
  '- Option 2 — `label`: `"Standard (Recommended)"`, `description`: `"~5-10 min, 10+ sources"`',
  '- Option 2 — `label`: `"Verify mode (Recommended)"`, `description`: `"Run the bare-topic web survey on the literal topic \\"verify\\"."`',
].join('\n');

test('extractDescriptionFields finds every description field with its 1-indexed line', () => {
  const fields = extractDescriptionFields(SAMPLE);
  assert.strictEqual(fields.length, 3);
  assert.strictEqual(fields[0].line, 1);
  assert.strictEqual(fields[0].text, '~2-5 min, 5+ sources');
  assert.strictEqual(fields[1].line, 2);
  assert.strictEqual(fields[1].text, '~5-10 min, 10+ sources');
});

test('extractDescriptionFields does not terminate early on an escaped quote', () => {
  const fields = extractDescriptionFields(SAMPLE);
  assert.strictEqual(fields[2].line, 3);
  assert.strictEqual(
    fields[2].text,
    'Run the bare-topic web survey on the literal topic \\"verify\\".',
  );
});

test('extractDescriptionFields returns empty for text with no description fields', () => {
  assert.deepStrictEqual(extractDescriptionFields('# Nothing here\n\ntext'), []);
});

// ── The guard itself. Must FAIL on the damage it describes (IL-78 shape). ──

test('flagQuestionMarks CATCHES a description containing a literal ?', () => {
  const withQuestion = SAMPLE.replace(
    '`description`: `"~2-5 min, 5+ sources"`',
    '`description`: `"Mark ready + merge? No — see body"`',
  );
  const fields = extractDescriptionFields(withQuestion);
  const flagged = flagQuestionMarks(fields);
  assert.strictEqual(flagged.length, 1, 'a description containing "?" must be flagged');
  assert.ok(flagged[0].text.includes('Mark ready + merge?'));
});

test('flagQuestionMarks reports a clean corpus as lossless (no false positives)', () => {
  const fields = extractDescriptionFields(SAMPLE);
  const flagged = flagQuestionMarks(fields);
  assert.deepStrictEqual(flagged, []);
});

test('listMarkdownFiles walks recursively and includes both SKILL.md and sub-files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'option-description-'));
  try {
    fs.mkdirSync(path.join(tmp, 'build'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'build', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'build', 'SKILL.md'), '# build');
    fs.writeFileSync(path.join(tmp, 'build', 'sub', 'nested.md'), '# nested');
    fs.writeFileSync(path.join(tmp, 'build', 'notes.txt'), 'ignored');
    const files = listMarkdownFiles(tmp).map((f) => path.relative(tmp, f)).sort();
    assert.deepStrictEqual(files, [
      path.join('build', 'SKILL.md'),
      path.join('build', 'sub', 'nested.md'),
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Corpus-wide scan — the actual conformance gate. ──

test('no shipped skills/**/*.md file has an AskUserQuestion option description containing a literal ?', () => {
  const pluginRoot = path.join(__dirname, '..', '..', '..', 'plugin');
  const skillsDir = path.join(pluginRoot, 'skills');
  const names = listSkillDirs(pluginRoot);
  assert.ok(names.length >= 30, `expected the whole skill corpus, found ${names.length}`);

  const files = listMarkdownFiles(skillsDir);
  assert.ok(files.length >= names.length, 'expected at least one file per skill');

  const violations = [];
  for (const file of files) {
    const md = readText(file);
    const fields = extractDescriptionFields(md);
    for (const flagged of flagQuestionMarks(fields)) {
      violations.push(`${path.relative(skillsDir, file)}:${flagged.line} — "${flagged.text}"`);
    }
  }
  assert.deepStrictEqual(
    violations,
    [],
    `AskUserQuestion option description(s) contain deliberation (a literal "?") instead of stating the consequence:\n${violations.join('\n')}`,
  );
});
