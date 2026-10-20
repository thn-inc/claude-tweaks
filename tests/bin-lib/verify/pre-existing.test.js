'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { matchPreExisting, newAndFixed, trackedFiles } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'pre-existing.js'));

const PRE_EXISTING = ['tests/a.test.js', 'tests/b.test.js'];

test('matchPreExisting: every failing file covered by the allowlist is eligible, matched deduped (#3129)', () => {
  const verdict = matchPreExisting({ failingFiles: ['tests/b.test.js', 'tests/a.test.js', 'tests/a.test.js'], preExisting: PRE_EXISTING });
  assert.deepStrictEqual(verdict, { eligible: true, matched: ['tests/b.test.js', 'tests/a.test.js'] });
});

test('matchPreExisting: any uncovered failing file is not eligible, and the reason names every uncovered file (#3129)', () => {
  const verdict = matchPreExisting({ failingFiles: ['tests/a.test.js', 'tests/real.test.js', 'tests/other.test.js'], preExisting: PRE_EXISTING });
  assert.strictEqual(verdict.eligible, false);
  assert.strictEqual(verdict.reason, 'unlisted: [tests/real.test.js, tests/other.test.js]');
  assert.deepStrictEqual(verdict.unmatched, ['tests/real.test.js', 'tests/other.test.js']);
});

test('matchPreExisting: empty failingFiles is no-parse — never adjudicated as covered (#3129)', () => {
  assert.deepStrictEqual(matchPreExisting({ failingFiles: [], preExisting: PRE_EXISTING }), { eligible: false, reason: 'no-parse' });
});

test('matchPreExisting: an empty or absent allowlist is not-declared — never silently waives anything (#3129)', () => {
  assert.deepStrictEqual(matchPreExisting({ failingFiles: ['tests/a.test.js'], preExisting: [] }), { eligible: false, reason: 'not-declared' });
  assert.deepStrictEqual(matchPreExisting({ failingFiles: ['tests/a.test.js'], preExisting: null }), { eligible: false, reason: 'not-declared' });
  assert.deepStrictEqual(matchPreExisting({ failingFiles: ['tests/a.test.js'] }), { eligible: false, reason: 'not-declared' });
});

test('matchPreExisting: entries are globs, reusing the same engine rules[].match/flaky.files use (#3129)', () => {
  // '**' spans path segments.
  const globAllowlist = ['tests/known-shallow/**'];
  const globVerdict = matchPreExisting({ failingFiles: ['tests/known-shallow/new-file.test.js'], preExisting: globAllowlist });
  assert.strictEqual(globVerdict.eligible, true);

  // An entry with no glob metacharacter still matches only itself.
  const exactVerdict = matchPreExisting({ failingFiles: ['tests/a.test.js', 'tests/c.test.js'], preExisting: PRE_EXISTING });
  assert.strictEqual(exactVerdict.eligible, false);
  assert.deepStrictEqual(exactVerdict.unmatched, ['tests/c.test.js']);

  // '*' stays segment-bound — it does not match a nested file.
  const segmentBound = ['tests/*.test.js'];
  const nestedVerdict = matchPreExisting({ failingFiles: ['tests/known-shallow/nested.test.js'], preExisting: segmentBound });
  assert.strictEqual(nestedVerdict.eligible, false);
  assert.deepStrictEqual(nestedVerdict.unmatched, ['tests/known-shallow/nested.test.js']);
});

test('newAndFixed: allowlisted tracked files that did not fail are fixed; unmatched failing files are new (#3313)', () => {
  const failingFiles = ['tests/real.test.js'];
  const preExisting = ['tests/a.test.js'];
  const verdict = matchPreExisting({ failingFiles, preExisting });
  const out = newAndFixed({ verdict, failingFiles, preExisting, mode: 'full', allRan: true, listTracked: () => ['src/x.js', 'tests/a.test.js', 'tests/real.test.js'] });
  assert.deepStrictEqual(out, { new: ['tests/real.test.js'], fixed: ['tests/a.test.js'] });
});

test('newAndFixed: a glob entry lists only its matching files that passed (#3313)', () => {
  const failingFiles = ['tests/env/a.test.js'];
  const preExisting = ['tests/env/*.test.js'];
  const verdict = matchPreExisting({ failingFiles, preExisting });
  const out = newAndFixed({
    verdict, failingFiles, preExisting, mode: 'full', allRan: true,
    listTracked: () => ['tests/env/a.test.js', 'tests/env/b.test.js', 'tests/other.test.js'],
  });
  assert.deepStrictEqual(out, { new: [], fixed: ['tests/env/b.test.js'] });
});

test('newAndFixed: a non-test file an allowlist glob covers is never fixed — only a suite can fail a test file (#3313)', () => {
  const failingFiles = ['tests/env/a.test.js'];
  const preExisting = ['tests/env/**'];
  const verdict = matchPreExisting({ failingFiles, preExisting });
  const out = newAndFixed({
    verdict, failingFiles, preExisting, mode: 'full', allRan: true,
    listTracked: () => ['tests/env/a.test.js', 'tests/env/b.test.js', 'tests/env/fixtures/x.json', 'tests/env/helper.js'],
  });
  assert.deepStrictEqual(out, { new: [], fixed: ['tests/env/b.test.js'] });
});

test('newAndFixed: a narrowed scope never claims fixed (#3313)', () => {
  const failingFiles = ['tests/a.test.js'];
  const preExisting = ['tests/a.test.js'];
  const verdict = matchPreExisting({ failingFiles, preExisting });
  const out = newAndFixed({
    verdict, failingFiles, preExisting, mode: 'scoped',
    listTracked: () => { throw new Error('listTracked must not be called for a narrowed scope'); },
  });
  assert.deepStrictEqual(out.new, []);
  assert.strictEqual(out.fixed, null);
  assert.strictEqual(out.fixedReason, 'scope mode scoped did not run every suite');
});

test('newAndFixed: an unreadable tracked list is fixed:null, never [] (#3313)', () => {
  const failingFiles = ['tests/a.test.js'];
  const preExisting = ['tests/a.test.js'];
  const verdict = matchPreExisting({ failingFiles, preExisting });
  const out = newAndFixed({ verdict, failingFiles, preExisting, mode: 'full', allRan: true, listTracked: () => null });
  assert.strictEqual(out.fixed, null);
  assert.strictEqual(out.fixedReason, 'git ls-files failed');
});

test('newAndFixed: a fail-fast skipped check means nothing is claimed passed — fixed:null, tracked list never read (#3313)', () => {
  const failingFiles = ['tests/a.test.js'];
  const preExisting = ['tests/a.test.js', 'tests/b.test.js'];
  const verdict = matchPreExisting({ failingFiles, preExisting });
  const out = newAndFixed({
    verdict, failingFiles, preExisting, mode: 'full', allRan: false,
    listTracked: () => { throw new Error('listTracked must not be called when a check was skipped'); },
  });
  assert.deepStrictEqual(out.new, []);
  assert.strictEqual(out.fixed, null);
  assert.strictEqual(out.fixedReason, 'a check was skipped (fail-fast)');
});

test('trackedFiles: splits git ls-files -z on NUL, drops empties, and returns null on any throw (#3313)', () => {
  const calls = [];
  const ok = trackedFiles('/repo', (cmd, args, opts) => { calls.push([cmd, args, opts.cwd, opts.maxBuffer]); return args.includes('--deleted') ? '' : 'a.js\0b dir/c.js\0'; });
  assert.deepStrictEqual(ok, ['a.js', 'b dir/c.js']);
  assert.deepStrictEqual(calls.map((c) => c.slice(0, 3)), [['git', ['ls-files', '-z', '--deleted'], '/repo'], ['git', ['ls-files', '-z'], '/repo']]);
  assert.ok(calls.every((c) => c[3] >= 64 * 1024 * 1024), 'a big checkout must not overflow the default exec buffer');
  assert.strictEqual(trackedFiles('/repo', () => { throw new Error('not a repo'); }), null);
});

test('trackedFiles: lists an unmerged path once and drops tracked files deleted from the working tree (#3313)', () => {
  const listing = (cmd, args) => (args.includes('--deleted') ? 'gone.test.js\0' : 'a.test.js\0conflict.test.js\0conflict.test.js\0conflict.test.js\0gone.test.js\0');
  assert.deepStrictEqual(trackedFiles('/repo', listing), ['a.test.js', 'conflict.test.js']);
});
