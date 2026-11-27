'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { slugFor, findFolder } = require('../../../plugin/bin/lib/design-session/folder');

test('slugFor maps issue refs', () => {
  assert.strictEqual(slugFor('#6352'), 'issue-6352');
  assert.strictEqual(slugFor('6352'), 'issue-6352');
});

test('slugFor normalizes text', () => {
  assert.strictEqual(slugFor('  Ordering: Café & Tea!  '), 'ordering-cafe-tea');
});

test('slugFor caps at 50 on a word boundary', () => {
  const s = slugFor('word '.repeat(24));
  assert.ok(s.length <= 50);
  assert.ok(!s.endsWith('-'));
  assert.ok(s.split('-').every((w) => w === 'word'));
  const long = slugFor('abcdefghi '.repeat(12));
  assert.ok(long.length <= 50 && !long.endsWith('-'));
  assert.ok(long.split('-').every((w) => w === 'abcdefghi'));
});

test('slugFor throws on an empty topic', () => {
  assert.throws(() => slugFor('!!!'), /empty topic/);
});

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'design-folder-'));
}

test('slug match is exact, not prefix', () => {
  const dir = tmp();
  try {
    for (const d of ['2026-11-01-ordering', '2026-11-20-ordering', '2026-11-20-ordering-v2']) {
      fs.mkdirSync(path.join(dir, d));
    }
    fs.writeFileSync(path.join(dir, '2026-11-25-ordering'), 'x');
    const r = findFolder({ specsDir: dir, slug: 'ordering', today: '2026-11-27' });
    assert.deepStrictEqual(r, { folder: path.join(dir, '2026-11-20-ordering'), existing: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findFolder on an empty dir names a new folder and creates nothing', () => {
  const dir = tmp();
  try {
    const r = findFolder({ specsDir: dir, slug: 'ordering', today: '2026-11-27' });
    assert.deepStrictEqual(r, { folder: path.join(dir, '2026-11-27-ordering'), existing: false });
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
