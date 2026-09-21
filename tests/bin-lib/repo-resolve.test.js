'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRepo, ghAvailable, repoSlug } = require('../../plugin/bin/lib/repo-resolve');

test('parseRepo: SSH remote URL', () => {
  assert.deepEqual(parseRepo('git@github.com:o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: HTTPS remote URL', () => {
  assert.deepEqual(parseRepo('https://github.com/o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: HTTPS remote URL without .git suffix', () => {
  assert.deepEqual(parseRepo('https://github.com/o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: an owner/name string wrapped as github.com/owner/name (the --repo CLI flag shape)', () => {
  assert.deepEqual(parseRepo('github.com/o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: SSH remote on a GitHub Enterprise Server host', () => {
  assert.deepEqual(parseRepo('git@ghe.example.com:acme/widget.git'), { host: 'ghe.example.com', owner: 'acme', repo: 'widget' });
});

test('parseRepo: HTTPS remote on a GitHub Enterprise Server host', () => {
  assert.deepEqual(parseRepo('https://ghe.example.com/acme/widget'), { host: 'ghe.example.com', owner: 'acme', repo: 'widget' });
});

test('parseRepo: malformed URL (no host/owner/repo structure) -> null', () => {
  assert.equal(parseRepo('not-a-url'), null);
  assert.equal(parseRepo(''), null);
  assert.equal(parseRepo(null), null);
  assert.equal(parseRepo(undefined), null);
});

test('parseRepo: existing callers that destructure only { owner, repo } still see the same shape', () => {
  const { owner, repo } = parseRepo('git@github.com:o/r.git');
  assert.deepEqual({ owner, repo }, { owner: 'o', repo: 'r' });
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

// repoSlug is the one composer of the `gh --repo` value shared by
// apply-refine-labels.js, compose-subject.js, materialize.js, and
// release-claim.js — each of which hand-rolled the same host ternary.
test('repoSlug: a github.com spec stays the bare owner/repo slug', () => {
  assert.equal(repoSlug({ host: 'github.com', owner: 'acme', repo: 'widget' }), 'acme/widget');
});

test('repoSlug: a GitHub Enterprise Server spec is host-qualified', () => {
  assert.equal(repoSlug({ host: 'ghe.example.com', owner: 'acme', repo: 'widget' }), 'ghe.example.com/acme/widget');
});

test('repoSlug: a missing host reads as github.com (materialize.js threads host as an optional 4th arg)', () => {
  assert.equal(repoSlug({ owner: 'acme', repo: 'widget' }), 'acme/widget');
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
  // #2567 shifted this line by 2 (a shared-primitives require + its updated
  // comment above GH_TIMEOUT_MS's own former definition).
  assert.deepEqual(hits, [`lib${pathModule.sep}repo-resolve.js:38`]);
});
