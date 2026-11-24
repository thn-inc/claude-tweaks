'use strict';
// tools/ does not ship (docs/decisions/0015-*), so nothing under plugin/ may name tools/review-replay.
// The matcher is a plain substring over each file's text, comments included: a mention in a comment is still a naming.
// A symlink is not followed (lstat via Dirent) and a file that cannot be read is an offender, not a skip.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('../helpers/read-skill');

const PLUGIN = path.join(__dirname, '..', '..', 'plugin');
const NEEDLE = 'tools/review-replay';

const walk = (dir, out) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
};

const scan = (dir) => {
  const files = walk(dir, []);
  const offenders = [];
  for (const file of files) {
    let text;
    try { text = readText(file); } catch (e) { offenders.push(`${file}: unreadable (${e.code || e.message})`); continue; }
    if (text.includes(NEEDLE)) offenders.push(file);
  }
  return { files: files.length, offenders };
};

const findOffenders = (dir) => scan(dir).offenders;

test('AC12.1: no file under plugin/ names tools/review-replay', () => {
  const { files, offenders } = scan(PLUGIN);
  assert.ok(files >= 500, `walked ${files} files under plugin/; fewer than 500 means the walk stopped covering the tree, not that the tree shrank`);
  assert.deepEqual(offenders, []);
});

test('AC12.1 self-test: findOffenders returns a file that holds the string, in a comment too, and not a clean one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-replay-scan-'));
  try {
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    const hit = path.join(dir, 'nested', 'a.js');
    fs.writeFileSync(hit, `// see ${NEEDLE}.js\nmodule.exports = 1;\n`);
    fs.writeFileSync(path.join(dir, 'clean.md'), 'nothing here\n');
    fs.writeFileSync(path.join(dir, 'node_modules', 'skipped.js'), NEEDLE);
    assert.deepEqual(findOffenders(dir), [hit]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
