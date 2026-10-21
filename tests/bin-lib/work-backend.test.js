'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseWorkBackend, readWorkBackend } = require('../../plugin/bin/lib/work-backend');

const REPO_ROOT = path.join(__dirname, '..', '..');

test('parseWorkBackend: value from a work-records block', () => {
  assert.equal(parseWorkBackend('# P\n\n## Work records\n\nwork-backend: local-files\nwork-types: labels\n'), 'local-files');
});

test('parseWorkBackend: padded value', () => {
  assert.equal(parseWorkBackend('work-backend:   github-issues   \n'), 'github-issues');
});

test('parseWorkBackend: a blank work-backend line does not borrow the next line', () => {
  assert.equal(parseWorkBackend('work-backend:\n\n---\n'), null);
  assert.equal(parseWorkBackend('work-backend:   \nlocal-files\n'), null);
  assert.equal(parseWorkBackend('work-backend:\n'), null);
});

test('parseWorkBackend: CRLF line endings and tab padding still resolve the value', () => {
  assert.equal(parseWorkBackend('# P\r\nwork-backend: local-files\r\nwork-types: labels\r\n'), 'local-files');
  assert.equal(parseWorkBackend('work-backend:\tgithub-issues\t\n'), 'github-issues');
});

test('parseWorkBackend: no line / non-string → null', () => {
  assert.equal(parseWorkBackend('# P\n'), null);
  assert.equal(parseWorkBackend(''), null);
  assert.equal(parseWorkBackend(undefined), null);
  assert.equal(parseWorkBackend(null), null);
});

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backend-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('readWorkBackend: reads root/CLAUDE.md', () => {
  withTempRoot((root) => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'work-backend: local-files\n');
    assert.equal(readWorkBackend(root), 'local-files');
  });
});

test('readWorkBackend: absent CLAUDE.md → null', () => {
  withTempRoot((root) => {
    assert.equal(readWorkBackend(root), null);
  });
});

test('readWorkBackend: CLAUDE.md is a directory → null (does not throw)', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'CLAUDE.md'));
    assert.equal(readWorkBackend(root), null);
  });
});

test('readWorkBackend: injected readFile that throws → null', () => {
  const readFile = () => { throw new Error('EACCES'); };
  assert.equal(readWorkBackend('/nonexistent', { readFile }), null);
});

test('AC2.1: the work-backend regex source appears only in plugin/bin/lib/work-backend.js', () => {
  // Both spellings: the original `\s` form (a copy pasted from an old branch) and the
  // horizontal-whitespace form the shared reader itself uses.
  const needles = ['work-backend:\\s', 'work-backend:[ \\t]'];
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const text = fs.readFileSync(full, 'utf8');
        if (needles.some((needle) => text.includes(needle))) {
          hits.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
        }
      }
    }
  };
  walk(path.join(REPO_ROOT, 'plugin', 'bin'));
  assert.deepEqual(hits.sort(), ['plugin/bin/lib/work-backend.js']);
});
