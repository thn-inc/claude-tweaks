// tests/list-claims-cli.test.js — in-process tests for bin/list-claims.js's
// run(argv, deps), mirroring tests/resolve-blockers-cli.test.js's
// deps-injection style. Covers argument parsing, repo resolution, and the
// names/json output shapes; listClaimEntries' own Git Trees API call shape
// and truncation handling already have coverage in
// tests/bin-lib/issues/claim-store.test.js and are not re-verified here —
// this file fakes listClaimEntries itself, never gh.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/list-claims');
const { parseRepo, repoSlug } = require('../plugin/bin/lib/repo-resolve');

function fakeDeps(overrides = {}) {
  const calls = { listClaimEntries: [], stdout: [], stderr: [] };
  return {
    calls,
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    parseRepo,
    repoSlug,
    ghApi: () => { throw new Error('ghApi must never be called directly — listClaimEntries is faked'); },
    listClaimEntries: (ghApi, slug) => {
      calls.listClaimEntries.push(slug);
      return { entries: [{ name: 'issue-7.json', sha: 'sha7' }, { name: 'issue-9.json', sha: 'sha9' }], failure: null };
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

test('--help prints usage, exit 0, gh never probed', () => {
  const deps = fakeDeps({ ghAvailable: () => { throw new Error('should not be called'); } });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: list-claims\.js/);
});

test('unknown flag is a malformed invocation — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['--bogus'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /unknown argument: --bogus/);
});

test('an invalid --format value is a malformed invocation — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['--format', 'xml'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /--format must be one of: names\|json/);
});

test('gh absent -> exit 2, listClaimEntries never called', () => {
  const deps = fakeDeps({ ghAvailable: () => false });
  const code = run([], deps);
  assert.equal(code, 2);
  assert.equal(deps.calls.listClaimEntries.length, 0);
  assert.match(deps.calls.stderr.join(''), /gh CLI not found/);
});

test('no --repo and no readable origin remote -> exit 2', () => {
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('no such remote'); } });
  const code = run([], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not resolve owner\/repo/);
});

test('--format names (default): one filename per line, in listClaimEntries\' own order', () => {
  const deps = fakeDeps();
  const code = run([], deps);
  assert.equal(code, 0);
  assert.deepEqual(deps.calls.stdout, ['issue-7.json\n', 'issue-9.json\n']);
  assert.deepEqual(deps.calls.listClaimEntries, ['acme/widgets']);
});

test('--format json: one JSON line carrying the full {name, sha} entries', () => {
  const deps = fakeDeps();
  const code = run(['--format', 'json'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.stdout.length, 1);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), [
    { name: 'issue-7.json', sha: 'sha7' }, { name: 'issue-9.json', sha: 'sha9' },
  ]);
});

test('an explicit --repo overrides the remote — remoteUrl never called', () => {
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('should not be called'); } });
  const code = run(['--repo', 'other/repo'], deps);
  assert.equal(code, 0);
  assert.deepEqual(deps.calls.listClaimEntries, ['other/repo']);
});

test('a zero-claim registry is success, not an error — exit 0, no output lines', () => {
  const deps = fakeDeps({ listClaimEntries: () => ({ entries: [], failure: null }) });
  const code = run([], deps);
  assert.equal(code, 0);
  assert.deepEqual(deps.calls.stdout, []);
});

test('listClaimEntries failure "truncated" surfaces as exit 3, named on stderr — never a silent partial list', () => {
  const deps = fakeDeps({ listClaimEntries: () => ({ entries: [], failure: 'truncated' }) });
  const code = run([], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /truncated/);
});

test('listClaimEntries failure "network-failure" surfaces as exit 3', () => {
  const deps = fakeDeps({ listClaimEntries: () => ({ entries: [], failure: 'network-failure' }) });
  const code = run([], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /network-failure/);
});
