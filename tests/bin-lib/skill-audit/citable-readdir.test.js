'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readdirUnder } = require('../../../plugin/bin/lib/skill-audit/citable-readdir');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citable-readdir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('readdirUnder lists files and directories relative to its base', (t) => {
  const base = tmp(t);
  fs.mkdirSync(path.join(base, 'skills', 's'), { recursive: true });
  fs.writeFileSync(path.join(base, 'skills', 'a.md'), 'a\n');
  const list = readdirUnder(base)('skills');
  assert.deepStrictEqual(
    list.map((e) => [e.name, e.isDirectory]).sort(),
    [['a.md', false], ['s', true]],
  );
});

test('readdirUnder lists a missing directory and a plain file as empty, never throwing', (t) => {
  const base = tmp(t);
  fs.writeFileSync(path.join(base, 'plain'), 'x\n');
  const readdir = readdirUnder(base);
  assert.deepStrictEqual(readdir('absent'), []);
  assert.deepStrictEqual(readdir('plain'), []);
});

test('readdirUnder reports a symlinked directory as a non-directory so a walk never follows it', (t) => {
  const base = tmp(t);
  fs.mkdirSync(path.join(base, 'real'));
  try {
    fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'));
  } catch (err) {
    t.skip(`symlinks unavailable: ${err.code}`);
    return;
  }
  const byName = Object.fromEntries(readdirUnder(base)('.').map((e) => [e.name, e.isDirectory]));
  assert.strictEqual(byName.real, true);
  assert.strictEqual(byName.link, false);
});
