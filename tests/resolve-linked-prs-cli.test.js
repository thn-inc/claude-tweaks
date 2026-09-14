// tests/resolve-linked-prs-cli.test.js — in-process tests for
// bin/resolve-linked-prs.js's run(argv, deps), mirroring
// tests/resolve-blockers-cli.test.js's deps-injection style (never a
// spawnSync-a-real-process style, since this CLI's whole point is a
// `gh api graphql` call that must never be live in a test — a fake runner
// in deps.runner stands in for it). Covers argument parsing and the
// number-keyed {openPR} output shape; the GraphQL query-building logic
// itself (buildLinkedPRQuery) already has coverage in
// tests/bin-lib/issues/record.test.js and is not re-verified here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/resolve-linked-prs');

function fakeDeps(overrides = {}) {
  const calls = { runner: [], stdout: [], stderr: [] };
  return {
    calls,
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    runner: (args) => {
      calls.runner.push(args);
      return JSON.stringify({
        data: {
          repository: {
            i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [{ number: 1572, state: 'OPEN' }] } },
          },
        },
      });
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

// --- argument parsing ---------------------------------------------------

test('missing <n> is a malformed invocation — exit 1, usage on stderr, gh never probed', () => {
  const deps = fakeDeps({ ghAvailable: () => { throw new Error('should not be called'); } });
  const code = run([], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing <n> argument/);
  assert.match(deps.calls.stderr.join(''), /usage: resolve-linked-prs\.js/);
});

test('non-integer <n> is malformed — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['abc'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /malformed <n>/);
});

test('non-positive <n> is malformed — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['0'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /malformed <n>/);
});

test('a comma list with one malformed entry is malformed — exit 1, no network call', () => {
  const deps = fakeDeps({ ghAvailable: () => { throw new Error('should not be called'); } });
  const code = run(['1224,abc,257'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /malformed <n>/);
});

test('unknown flag is a malformed invocation — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['1224', '--bogus'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /unknown argument: --bogus/);
});

test('trailing --repo with no value is malformed — exit 1, no network call', () => {
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['1224', '--repo'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing value for --repo/);
  assert.deepStrictEqual(deps.calls.runner, []);
});

test('--repo owner/name (well-formed) is unaffected', () => {
  const deps = fakeDeps();
  const code = run(['1224', '--repo', 'acme/widgets'], deps);
  assert.equal(code, 0);
});

test('--help prints usage and exits 0 without touching gh/git', () => {
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: resolve-linked-prs\.js/);
});

// --- gh / repo resolution ------------------------------------------------

test('`gh` absent — exit 2, no attempt to resolve owner/repo', () => {
  const deps = fakeDeps({
    ghAvailable: () => false,
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['1224'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /`gh` is required/);
});

test('no --repo and no resolvable origin remote — exit 2', () => {
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('no remote'); } });
  const code = run(['1224'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not resolve owner\/repo/);
});

test('--repo owner/name overrides the git remote', () => {
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('should not be called'); } });
  const code = run(['1224', '--repo', 'someone/else'], deps);
  assert.equal(code, 0);
  const q = deps.calls.runner[0].join(' ');
  assert.match(q, /-f owner=someone -f repo=else/);
});

// --- success / output shape ----------------------------------------------

test('success: one runner call, a number-keyed JSON line on stdout, exit 0', () => {
  const deps = fakeDeps();
  const code = run(['1224'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.runner.length, 1, 'exactly one gh api graphql call');
  assert.equal(deps.calls.stderr.length, 0, 'success path writes nothing to stderr');
  assert.equal(deps.calls.stdout.length, 1, 'exactly one stdout write');
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 1224: { openPR: 1572, mentions: [] } });
});

test('success: owner/repo parsed from the origin remote when --repo is absent', () => {
  const deps = fakeDeps();
  run(['1224'], deps);
  const q = deps.calls.runner[0].join(' ');
  assert.match(q, /-f owner=acme -f repo=widgets/);
});

test('success: no linked PR reports openPR null', () => {
  const deps = fakeDeps({
    runner: (args) => JSON.stringify({
      data: { repository: { i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [] } } } },
    }),
  });
  const code = run(['1224'], deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 1224: { openPR: null, mentions: [] } });
});

test('success: a merged (not open) linked PR reports openPR null', () => {
  const deps = fakeDeps({
    runner: (args) => JSON.stringify({
      data: { repository: { i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [{ number: 900, state: 'MERGED' }] } } } },
    }),
  });
  const code = run(['1224'], deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 1224: { openPR: null, mentions: [] } });
});

test('success: a comma list of numbers resolves in ONE runner call, one key per requested number', () => {
  const deps = fakeDeps();
  deps.runner = (args) => {
    deps.calls.runner.push(args);
    return JSON.stringify({
      data: {
        repository: {
          i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [{ number: 1572, state: 'OPEN' }] } },
          i257: { number: 257, closedByPullRequestsReferences: { nodes: [] } },
        },
      },
    });
  };
  const code = run(['1224,257'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.runner.length, 1, 'one aliased call covers the whole list, never one call per number');
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), {
    1224: { openPR: 1572, mentions: [] },
    257: { openPR: null, mentions: [] },
  });
});

// --- GraphQL failure propagation -----------------------------------------

test('a thrown GraphQL failure (missing data.repository) surfaces as exit 3, not a crash', () => {
  const deps = fakeDeps({ runner: () => JSON.stringify({ data: { repository: null } }) });
  const code = run(['1224'], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /missing repository/);
  assert.equal(deps.calls.stdout.length, 0);
});
