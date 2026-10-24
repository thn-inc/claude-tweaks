'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// The shared comment stripper (tests/helpers/strip-comments.js) is called per file by
// the source-scan conformance tests. Its header names those callers, and
// parse-signal-discipline item 15 names them again. Both hand-written lists must equal
// the tree's callers in both directions, or a new caller goes unlisted and a removed one
// stays listed. This file must not require the helper itself, or it would count as a
// caller; fixture text that would form such a require is built by concatenation.
const REPO = path.join(__dirname, '..');
const TESTS_DIR = path.join(REPO, 'tests');
const HELPER_REL = 'tests/helpers/strip-comments.js';
const EXCLUDED = new Set([HELPER_REL, 'tests/helpers-strip-comments.test.js']);
const HELPER_SRC = readText(path.join(REPO, HELPER_REL));
const SKILL_SRC = readText(path.join(REPO, '.claude', 'skills', 'parse-signal-discipline', 'SKILL.md'));
const ANCHOR = 'by test-file stem:';
const REQUIRE_RE = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const SCRATCH_CALLER = 'const s = req' + "uire('./helpers/strip-comments');";
const SCRATCH_COMMENT_ONLY = '// const s = req' + "uire('./helpers/strip-comments');";

function liveTestFiles() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith('.js')) {
        out.push({
          rel: path.relative(REPO, abs).split(path.sep).join('/'),
          text: readText(abs),
        });
      }
    }
  };
  walk(TESTS_DIR);
  return out;
}

const LIVE_TEST_FILES = liveTestFiles();

function requireSpecs(text) {
  return [...text.matchAll(REQUIRE_RE)].map((m) => m[2]);
}

function resolveSpec(rel, spec) {
  let p = path.posix.join(path.posix.dirname(rel), spec);
  if (!p.endsWith('.js')) p += '.js';
  return p;
}

function treeCallers(files = LIVE_TEST_FILES) {
  const stems = new Map();
  for (const { rel, text } of files) {
    if (EXCLUDED.has(rel)) continue;
    const code = text
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .map((line) => line.replace(/\s\/\/.*$/, ''))
      .join('\n');
    const callsHelper = requireSpecs(code).some(
      (spec) => spec.startsWith('.') && resolveSpec(rel, spec) === HELPER_REL,
    );
    if (!callsHelper) continue;
    const stem = path.posix.basename(rel).replace(/\.test\.js$/, '').replace(/-conformance$/, '');
    assert.ok(
      !stems.has(stem),
      `two tree callers map to the stem "${stem}": ${stems.get(stem)} and ${rel}`,
    );
    stems.set(stem, rel);
  }
  return [...stems.keys()].sort();
}

function proseList(text, label) {
  const hits = text.split(ANCHOR).length - 1;
  assert.ok(
    hits === 1,
    `${label}: the caller list could not be found (anchor "${ANCHOR}" occurs ${hits} times, expected 1)`,
  );
  const after = text.slice(text.indexOf(ANCHOR) + ANCHOR.length);
  const end = after.indexOf('.');
  assert.ok(end >= 0, `${label}: the caller list could not be found (no period ends it)`);
  const span = after.slice(0, end);
  const names = [...span.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const leftover = span
    .replace(/`[^`\n]+`/g, '')
    .replace(/\band\b/g, '')
    .replace(/[\s,]/g, '');
  assert.equal(leftover, '', `${label}: the caller list holds text other than backticked names, commas and "and": "${leftover}"`);
  assert.ok(names.length > 0, `${label}: the caller list is empty`);
  return names;
}

function headerText(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((line) => line.startsWith('//'));
  assert.ok(start >= 0, 'helper header: no leading // comment block found');
  let end = start;
  while (end < lines.length && lines[end].startsWith('//')) end++;
  return lines
    .slice(start, end)
    .map((line) => line.replace(/^\/\/ ?/, ''))
    .join(' ');
}

function item15Text(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((line) => line.startsWith('15. '));
  const end = lines.findIndex((line, i) => i > start && line.startsWith('16. '));
  assert.ok(start >= 0 && end > start, 'parse-signal-discipline: item 15 or item 16 line not found');
  return lines.slice(start, end).join('\n');
}

function assertTwin(tree, prose, label) {
  const missingFromProse = tree.filter((s) => !prose.includes(s));
  const missingFromTree = prose.filter((s) => !tree.includes(s));
  assert.deepStrictEqual(
    [...prose].sort(),
    [...tree].sort(),
    `${label} must list exactly the tree's callers. Missing from the prose list: ${
      missingFromProse.join(', ') || 'none'
    }. Not in the tree: ${missingFromTree.join(', ') || 'none'}.`,
  );
}

test('the tree derivation is non-empty and still excludes the helper suite', () => {
  const helperSuite = LIVE_TEST_FILES.find((f) => f.rel === 'tests/helpers-strip-comments.test.js');
  assert.ok(helperSuite, 'tests/helpers-strip-comments.test.js must exist');
  assert.ok(
    requireSpecs(helperSuite.text).includes('./helpers/strip-comments'),
    'the require regex must match the excluded helper suite, so the exclusion cannot go stale silently',
  );
  const tree = treeCallers();
  assert.ok(tree.length > 0, 'the tree must have at least one caller');
  assert.ok(!tree.includes('helpers-strip-comments'), 'the helper suite must not count as a caller');
});

test('the helper header lists exactly the tree callers', () => {
  assertTwin(treeCallers(), proseList(headerText(HELPER_SRC), 'helper header'), 'helper header');
});

test('parse-signal-discipline item 15 lists exactly the tree callers', () => {
  assertTwin(
    treeCallers(),
    proseList(item15Text(SKILL_SRC), 'parse-signal-discipline item 15'),
    'parse-signal-discipline item 15',
  );
});

test('go-red: a scratch caller missing from both lists fails the twin', () => {
  const files = [...LIVE_TEST_FILES, { rel: 'tests/zz-scratch.test.js', text: SCRATCH_CALLER }];
  assert.throws(
    () => assertTwin(treeCallers(files), proseList(headerText(HELPER_SRC), 'helper header'), 'helper header'),
    /zz-scratch/,
  );
});

test('go-red: a header list with one backticked name removed fails the twin', () => {
  const header = headerText(HELPER_SRC);
  const damaged = header.replace('`path-guard`, ', '');
  assert.notEqual(damaged, header, 'the control must actually remove a name');
  assert.throws(
    () => assertTwin(treeCallers(), proseList(damaged, 'helper header'), 'helper header'),
    /path-guard/,
  );
});

test('go-red: item 15 without its anchor makes the list unparseable', () => {
  const item = item15Text(SKILL_SRC);
  assert.ok(item.includes(ANCHOR), 'the control needs the anchor present in the live text');
  assert.throws(
    () => proseList(item.replace(ANCHOR, ''), 'parse-signal-discipline item 15'),
    /could not be found/,
  );
});

test('go-red: a require on a // comment line is not a caller', () => {
  const live = treeCallers();
  const withComment = treeCallers([
    ...LIVE_TEST_FILES,
    { rel: 'tests/zz-comment-only.test.js', text: SCRATCH_COMMENT_ONLY },
  ]);
  assert.deepStrictEqual(withComment, live);
});

test('go-red: a require after a trailing // or on a * comment line is not a caller', () => {
  const live = treeCallers();
  const withComments = treeCallers([
    ...LIVE_TEST_FILES,
    { rel: 'tests/zz-trailing-comment.test.js', text: 'const a = 1; ' + SCRATCH_COMMENT_ONLY },
    { rel: 'tests/zz-star-comment.test.js', text: ' * const s = req' + "uire('./helpers/strip-comments');" },
  ]);
  assert.deepStrictEqual(withComments, live);
});
