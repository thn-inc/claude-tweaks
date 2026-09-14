// tests/resolve-blockers-cli.test.js — in-process tests for
// bin/resolve-blockers.js's run(argv, deps), mirroring
// tests/materialize-run-dir-anchoring.test.js's deps-injection style (never
// tests/resolve-policy-cli.test.js's spawnSync-a-real-process style, since
// this CLI's whole point is a `gh api graphql` call that must never be live
// in a test — a fake runner in deps.runner stands in for it). Covers
// argument parsing and the number-keyed {blockedBy, openBlocker, openBlockerIds}
// output shape; the GraphQL query-building logic itself
// (buildNativeDependencyQuery) already has coverage in
// tests/bin-lib/issues/record.test.js and is not re-verified here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/resolve-blockers');

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
            i720: { number: 720, blockedBy: { nodes: [{ number: 700, state: 'OPEN' }] } },
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
  assert.match(deps.calls.stderr.join(''), /usage: resolve-blockers\.js/);
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
  const code = run(['720,abc,730'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /malformed <n>/);
});

test('an empty comma segment (trailing comma) is malformed — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['720,'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /malformed <n>/);
});

test('unknown flag is a malformed invocation — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['720', '--bogus'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /unknown argument: --bogus/);
});

test('trailing --repo with no value is malformed — exit 1, no network call', () => {
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['720', '--repo'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing value for --repo/);
  assert.deepStrictEqual(deps.calls.runner, []);
});

test('--repo followed by another flag is rejected as missing a value, not treated as the value', () => {
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['720', '--repo', '--help'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing value for --repo/);
});

test('--repo owner/name (well-formed) is unaffected', () => {
  const deps = fakeDeps();
  const code = run(['720', '--repo', 'acme/widgets'], deps);
  assert.equal(code, 0);
});

test('--help prints usage and exits 0 without touching gh/git', () => {
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: resolve-blockers\.js/);
});

// --- gh / repo resolution ------------------------------------------------

test('`gh` absent — exit 2, no attempt to resolve owner/repo', () => {
  const deps = fakeDeps({
    ghAvailable: () => false,
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['720'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /`gh` is required/);
});

test('no --repo and no resolvable origin remote — exit 2', () => {
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('no remote'); } });
  const code = run(['720'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not resolve owner\/repo/);
});

test('--repo owner/name overrides the git remote', () => {
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('should not be called'); } });
  const code = run(['720', '--repo', 'someone/else'], deps);
  assert.equal(code, 0);
  const q = deps.calls.runner[0].join(' ');
  assert.match(q, /-f owner=someone -f repo=else/);
});

// #2240: a GitHub Enterprise Server origin remote threads --hostname onto
// the one gh call this CLI makes (the --repo flag always resolves against
// github.com by this codebase's existing convention — only the auto-detected
// remote can carry a non-github.com host).
test('#2240: a GitHub Enterprise Server origin remote passes --hostname on the graphql call', () => {
  const deps = fakeDeps({ remoteUrl: () => 'https://ghe.example.com/acme/widgets.git' });
  const code = run(['720'], deps);
  assert.equal(code, 0);
  const q = deps.calls.runner[0];
  assert.deepEqual(q.slice(-2), ['--hostname', 'ghe.example.com']);
});

test('#2240: a plain github.com remote omits --hostname', () => {
  const deps = fakeDeps();
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.doesNotMatch(deps.calls.runner[0].join(' '), /--hostname/);
});

// --- success / output shape ----------------------------------------------

test('success: one runner call, a number-keyed JSON line on stdout, exit 0', () => {
  const deps = fakeDeps();
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.runner.length, 1, 'exactly one gh api graphql call');
  assert.equal(deps.calls.stderr.length, 0, 'success path writes nothing to stderr');
  assert.equal(deps.calls.stdout.length, 1, 'exactly one stdout write');
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 720: { blockedBy: [700], openBlocker: true, openBlockerIds: [700] } });
});

test('success: owner/repo parsed from the origin remote when --repo is absent', () => {
  const deps = fakeDeps();
  run(['720'], deps);
  const q = deps.calls.runner[0].join(' ');
  assert.match(q, /-f owner=acme -f repo=widgets/);
});

test('success: no open blockers reports openBlocker false, blockedBy []', () => {
  const deps = fakeDeps({
    runner: (args) => JSON.stringify({
      data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } },
    }),
  });
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 720: { blockedBy: [], openBlocker: false, openBlockerIds: [] } });
});

test('success: a comma list of numbers resolves in ONE runner call, one key per requested number', () => {
  const deps = fakeDeps();
  deps.runner = (args) => {
    deps.calls.runner.push(args);
    return JSON.stringify({
      data: {
        repository: {
          i720: { number: 720, blockedBy: { nodes: [{ number: 700, state: 'OPEN' }] } },
          i730: { number: 730, blockedBy: { nodes: [] } },
        },
      },
    });
  };
  const code = run(['720,730'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.runner.length, 1, 'one aliased call covers the whole list, never one call per number');
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), {
    720: { blockedBy: [700], openBlocker: true, openBlockerIds: [700] },
    730: { blockedBy: [], openBlocker: false, openBlockerIds: [] },
  });
});

// --- GraphQL failure propagation -----------------------------------------

test('a thrown GraphQL failure (missing data.repository) surfaces as exit 3, not a crash', () => {
  const deps = fakeDeps({ runner: () => JSON.stringify({ data: { repository: null } }) });
  const code = run(['720'], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /missing repository/);
  assert.equal(deps.calls.stdout.length, 0);
});
