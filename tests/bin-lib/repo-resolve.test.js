'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRepo, ghAvailable } = require('../../plugin/bin/lib/repo-resolve');

test('parseRepo: SSH remote URL', () => {
  assert.deepEqual(parseRepo('git@github.com:o/r.git'), { owner: 'o', repo: 'r' });
});

test('parseRepo: HTTPS remote URL', () => {
  assert.deepEqual(parseRepo('https://github.com/o/r.git'), { owner: 'o', repo: 'r' });
});

test('parseRepo: HTTPS remote URL without .git suffix', () => {
  assert.deepEqual(parseRepo('https://github.com/o/r'), { owner: 'o', repo: 'r' });
});

test('parseRepo: an owner/name string wrapped as github.com/owner/name (the --repo CLI flag shape)', () => {
  assert.deepEqual(parseRepo('github.com/o/r'), { owner: 'o', repo: 'r' });
});

test('parseRepo: non-GitHub or malformed URL -> null', () => {
  assert.equal(parseRepo('https://gitlab.com/o/r.git'), null);
  assert.equal(parseRepo(''), null);
  assert.equal(parseRepo(null), null);
  assert.equal(parseRepo(undefined), null);
});

test('ghAvailable: injected runner succeeds -> true', () => {
  const calls = [];
  const result = ghAvailable({
    execFileSync: (cmd, args, opts) => { calls.push([cmd, args, opts]); return 'gh version 2.0.0\n'; },
  });
  assert.equal(result, true);
  assert.deepEqual(calls.length, 1);
  assert.deepEqual(calls[0][0], 'gh');
  assert.deepEqual(calls[0][1], ['--version']);
  assert.equal(typeof calls[0][2].timeout, 'number');
  assert.ok(calls[0][2].timeout > 0);
});

test('ghAvailable: injected runner throws ENOENT (gh absent) -> false', () => {
  const result = ghAvailable({
    execFileSync: () => { const e = new Error('spawnSync gh ENOENT'); e.code = 'ENOENT'; throw e; },
  });
  assert.equal(result, false);
});

test('ghAvailable: injected runner throws a generic error (non-zero exit) -> false', () => {
  const result = ghAvailable({
    execFileSync: () => { throw new Error('gh: some other failure'); },
  });
  assert.equal(result, false);
});

test('ghAvailable: no deps passed -> defaults to the real execFileSync (does not throw at call time)', () => {
  // Not asserting the boolean result (depends on whether `gh` is on this
  // machine's PATH) -- only that the zero-arg call shape used by every
  // pre-existing direct importer (fetch-sub-issues.js, backlog-grant-gate.js,
  // etc.) still resolves without throwing.
  assert.doesNotThrow(() => ghAvailable());
});

const fs = require('fs');
const pathModule = require('path');

test("'--version' appears in plugin/bin only inside repo-resolve.js's ghAvailable()", () => {
  const binDir = pathModule.join(__dirname, '..', '..', 'plugin', 'bin');
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = pathModule.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const content = fs.readFileSync(p, 'utf8');
        content.split('\n').forEach((line, i) => {
          if (line.includes("'--version'")) hits.push(`${pathModule.relative(binDir, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(binDir);
  assert.deepEqual(hits, [`lib${pathModule.sep}repo-resolve.js:31`]);
});
