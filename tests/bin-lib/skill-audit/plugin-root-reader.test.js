// tests/bin-lib/skill-audit/plugin-root-reader.test.js — pluginRootReader and
// skillsPrefix (#3461). The reader's read semantics are headSide's, moved out
// of load-delta.js. The one deliberate change, the lazy base realpath, is
// pinned by the AC3.2 test.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pluginRootReader, skillsPrefix } = require('../../../plugin/bin/lib/skill-audit/plugin-root-reader');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('reads a regular file inside the base', () => {
  const base = tempDir('plugin-root-reader-');
  writeFile(path.join(base, 'skills', 'a', 'SKILL.md'), '# a\n');
  assert.equal(pluginRootReader(base).readFile('skills/a/SKILL.md'), '# a\n');
});

test('a symlink escaping the base reads as absent', (t) => {
  const base = tempDir('plugin-root-reader-');
  const outside = tempDir('plugin-root-reader-outside-');
  writeFile(path.join(outside, 'secret.md'), 'secret\n');
  fs.mkdirSync(path.join(base, 'skills', 'a'), { recursive: true });
  try {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(base, 'skills', 'a', 'x.md'));
  } catch (err) {
    if (err.code === 'EPERM') return t.skip('symlink creation needs privilege on this platform');
    throw err;
  }
  assert.equal(pluginRootReader(base).readFile('skills/a/x.md'), null);
});

test('a missing file, a directory, and a looping symlink read as absent', (t) => {
  const base = tempDir('plugin-root-reader-');
  fs.mkdirSync(path.join(base, 'skills', 'a', 'dir'), { recursive: true });
  try {
    fs.symlinkSync(path.join(base, 'skills', 'a', 'loop-b.md'), path.join(base, 'skills', 'a', 'loop-a.md'));
    fs.symlinkSync(path.join(base, 'skills', 'a', 'loop-a.md'), path.join(base, 'skills', 'a', 'loop-b.md'));
  } catch (err) {
    if (err.code === 'EPERM') return t.skip('symlink creation needs privilege on this platform');
    throw err;
  }
  const reader = pluginRootReader(base);
  assert.equal(reader.readFile('skills/a/none.md'), null);
  assert.equal(reader.readFile('skills/a/dir'), null);
  assert.equal(reader.readFile('skills/a/loop-a.md'), null);
});

test('listSkillMds lists only skill dirs whose SKILL.md is readable, under the root prefix', () => {
  const base = tempDir('plugin-root-reader-');
  writeFile(path.join(base, 'plug', 'skills', 'a', 'SKILL.md'), '# a\n');
  fs.mkdirSync(path.join(base, 'plug', 'skills', 'b'), { recursive: true });
  assert.deepEqual(pluginRootReader(base, 'plug').listSkillMds(), ['plug/skills/a/SKILL.md']);
});

test('AC3.2: a base already absent at construction degrades to no entries, never a throw', () => {
  // Only an absent-at-construction base separates the lazy realpath from an
  // eager one: an eager reader would throw ENOENT right here.
  const gone = path.join(tempDir('plugin-root-reader-'), 'gone');
  const reader = pluginRootReader(gone);
  assert.deepEqual(reader.listSkillMds(), []);
  assert.equal(reader.readFile('skills/a/SKILL.md'), null);
});

test('a base deleted after construction also degrades to no entries, never a throw', () => {
  const base = tempDir('plugin-root-reader-');
  writeFile(path.join(base, 'skills', 'a', 'SKILL.md'), '# a\n');
  const reader = pluginRootReader(base);
  fs.rmSync(base, { recursive: true });
  assert.deepEqual(reader.listSkillMds(), []);
  assert.equal(reader.readFile('skills/a/SKILL.md'), null);
});

test('listSkillMds returns [] when skills is a regular file (ENOTDIR)', () => {
  const base = tempDir('plugin-root-reader-');
  writeFile(path.join(base, 'skills'), 'not a directory\n');
  assert.deepEqual(pluginRootReader(base).listSkillMds(), []);
});

test('skillsPrefix: the root "." is the repo-level skills/, any other root is nested', () => {
  assert.equal(skillsPrefix('.'), 'skills/');
  assert.equal(skillsPrefix('plugin'), 'plugin/skills/');
});
