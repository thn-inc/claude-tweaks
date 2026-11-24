'use strict';
// The run tally (#5933): one appended line per agent-raised file verdict, counted
// by non-empty lines. Each test owns its scratch dir.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TALLY_FILE, readTallyCount, appendTally } = require('../../../plugin/bin/lib/deferral-route/tally');
const { scratchDir, removeScratchDir } = require('../../helpers/tmp-dir');

function withDir(fn) {
  const dir = scratchDir('ct-tally-', { realpath: true });
  try {
    return fn(dir);
  } finally {
    removeScratchDir(dir);
  }
}

test('absent tally counts 0', () => {
  withDir((dir) => assert.equal(readTallyCount(dir), 0));
});

test('appendTally writes one tab-separated line; readTallyCount counts it', () => {
  withDir((dir) => {
    const now = new Date('2026-11-19T07:00:00.000Z');
    appendTally(dir, { reason: 'genuinely-larger', rule: 'not-low', now });
    assert.equal(
      fs.readFileSync(path.join(dir, TALLY_FILE), 'utf8'),
      '2026-11-19T07:00:00.000Z\tgenuinely-larger\tnot-low\n',
    );
    assert.equal(readTallyCount(dir), 1);
    appendTally(dir, { reason: 'tangential', rule: 'tangential', now });
    assert.equal(readTallyCount(dir), 2);
  });
});

test('review focus 4: blank lines and CRLF are not counted, arbitrary text is', () => {
  withDir((dir) => {
    fs.writeFileSync(path.join(dir, TALLY_FILE), 'a\r\n\r\n\n  \nb\nnot a tally line\n');
    assert.equal(readTallyCount(dir), 3);
  });
});

test('a tally that cannot be read throws, never reads as 0', () => {
  withDir((dir) => {
    fs.mkdirSync(path.join(dir, TALLY_FILE));
    assert.throws(() => readTallyCount(dir), (err) => {
      assert.notEqual(err.code, 'ENOENT');
      if (process.platform !== 'win32') assert.equal(err.code, 'EISDIR');
      return true;
    });
  });
});

// Windows reports a path under a regular file as ENOENT, so the real fixture cannot produce ENOTDIR there.
const NO_REAL_ENOTDIR = process.platform === 'win32' && 'win32 reports a path under a file as ENOENT';

test('a run dir that is a regular file throws ENOTDIR on read, never reads as 0', { skip: NO_REAL_ENOTDIR }, () => {
  withDir((dir) => {
    const notADir = path.join(dir, 'file');
    fs.writeFileSync(notADir, 'x');
    assert.throws(() => readTallyCount(notADir), (err) => err.code === 'ENOTDIR');
  });
});

test('an ENOTDIR from the read is rethrown, not read as 0 (every platform)', () => {
  const err = Object.assign(new Error('x'), { code: 'ENOTDIR' });
  const fsImpl = { readFileSync() { throw err; } };
  assert.throws(() => readTallyCount('/any', { fsImpl }), (e) => e === err);
});

test('an append into a missing run dir throws ENOENT', () => {
  withDir((dir) => {
    assert.throws(
      () => appendTally(path.join(dir, 'missing'), { reason: 'r', rule: 'x' }),
      (err) => err.code === 'ENOENT',
    );
  });
});

test('an injected fsImpl whose appendFileSync throws propagates the error', () => {
  const boom = new Error('disk full');
  const fsImpl = { appendFileSync() { throw boom; } };
  assert.throws(
    () => appendTally('/any', { reason: 'r', rule: 'x' }, { fsImpl }),
    (err) => err === boom,
  );
});
