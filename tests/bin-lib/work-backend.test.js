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

test('parseWorkBackend: no line / non-string → null', () => {
  assert.equal(parseWorkBackend('# P\n'), null);
  assert.equal(parseWorkBackend(''), null);
  assert.equal(parseWorkBackend(undefined), null);
  assert.equal(parseWorkBackend(null), null);
});

test('readWorkBackend: reads root/CLAUDE.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backend-'));
  try {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'work-backend: local-files\n');
    assert.equal(readWorkBackend(root), 'local-files');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readWorkBackend: absent CLAUDE.md → null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backend-'));
  try {
    assert.equal(readWorkBackend(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readWorkBackend: CLAUDE.md is a directory → null (does not throw)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backend-'));
  try {
    fs.mkdirSync(path.join(root, 'CLAUDE.md'));
    assert.equal(readWorkBackend(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readWorkBackend: injected readFile that throws → null', () => {
  const readFile = () => { throw new Error('EACCES'); };
  assert.equal(readWorkBackend('/nonexistent', { readFile }), null);
});

test('AC2.1: the work-backend regex source appears only in plugin/bin/lib/work-backend.js', () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        if (fs.readFileSync(full, 'utf8').includes('work-backend:\\s')) {
          hits.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
        }
      }
    }
  };
  walk(path.join(REPO_ROOT, 'plugin', 'bin'));
  assert.deepEqual(hits.sort(), ['plugin/bin/lib/work-backend.js']);
});
