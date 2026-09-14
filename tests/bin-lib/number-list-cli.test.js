// tests/bin-lib/number-list-cli.test.js — factory tests for
// plugin/bin/lib/number-list-cli.js's makeNumberListCli, mirroring
// tests/resolve-blockers-cli.test.js's deps-injection style. Covers the
// factory's own parse/exit-code contract once (malformed list, --repo
// missing value, unknown flag, gh absent, unresolvable repo, fetch throw,
// --help) — the two concrete CLIs (resolve-blockers.js, resolve-linked-prs.js)
// keep their own existing test files unmodified, since they just exercise
// this same contract through a configured instance.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeNumberListCli } = require('../../plugin/bin/lib/number-list-cli');

function buildCli(overrides = {}) {
  return makeNumberListCli({
    name: 'fake-cli.js',
    usage: 'usage: fake-cli.js <n>[,<n2>,...] [--repo owner/name] [--help]\n',
    fetch: ({ numbers }) => new Map(numbers.map((n) => [n, `fetched-${n}`])),
    mapResult: (n, byNumber) => byNumber.get(n),
    ...overrides,
  });
}

function fakeDeps(overrides = {}) {
  const calls = { runner: [], stdout: [], stderr: [] };
  return {
    calls,
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    runner: (args) => { calls.runner.push(args); return '{}'; },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

test('missing <n> — exit 1, usage on stderr', () => {
  const { run } = buildCli();
  const deps = fakeDeps({ ghAvailable: () => { throw new Error('should not be called'); } });
  const code = run([], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing <n> argument/);
  assert.match(deps.calls.stderr.join(''), /usage: fake-cli\.js/);
});

test('malformed <n> — exit 1', () => {
  const { run } = buildCli();
  const deps = fakeDeps();
  const code = run(['abc'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /malformed <n>/);
});

test('trailing --repo with no value — exit 1, no network call', () => {
  const { run } = buildCli();
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['720', '--repo'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing value for --repo/);
  assert.deepStrictEqual(deps.calls.runner, []);
});

test('unknown flag — exit 1', () => {
  const { run } = buildCli();
  const deps = fakeDeps();
  const code = run(['720', '--bogus'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /unknown argument: --bogus/);
});

test('--help — exit 0, usage on stdout, no gh/git probe', () => {
  const { run } = buildCli();
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: fake-cli\.js/);
});

test('`gh` absent — exit 2, ghRequiredNote appended when configured', () => {
  const { run } = buildCli({ ghRequiredNote: '(work-links: native)' });
  const deps = fakeDeps({ ghAvailable: () => false });
  const code = run(['720'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /fake-cli\.js: `gh` is required \(work-links: native\)/);
});

test('`gh` absent — exit 2, plain message when ghRequiredNote omitted', () => {
  const { run } = buildCli();
  const deps = fakeDeps({ ghAvailable: () => false });
  const code = run(['720'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /fake-cli\.js: `gh` is required\n/);
});

test('no --repo and no resolvable origin remote — exit 2', () => {
  const { run } = buildCli();
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('no remote'); } });
  const code = run(['720'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not resolve owner\/repo/);
});

test('fetch throwing — exit 3, error message on stderr, nothing on stdout', () => {
  const { run } = buildCli({ fetch: () => { throw new Error('boom'); } });
  const deps = fakeDeps();
  const code = run(['720'], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /fake-cli\.js: boom/);
  assert.equal(deps.calls.stdout.length, 0);
});

test('success: mapResult applied per number, one stdout write, exit 0', () => {
  const { run } = buildCli();
  const deps = fakeDeps();
  const code = run(['720,730'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.runner.length, 0, 'this fake fetch never calls the runner directly');
  assert.equal(deps.calls.stdout.length, 1);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 720: 'fetched-720', 730: 'fetched-730' });
});

test('success: --repo override is parsed and passed to fetch as owner/repo', () => {
  let seen = null;
  const { run } = buildCli({ fetch: (args) => { seen = args; return new Map([[720, 'x']]); } });
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('should not be called'); } });
  const code = run(['720', '--repo', 'someone/else'], deps);
  assert.equal(code, 0);
  assert.equal(seen.owner, 'someone');
  assert.equal(seen.repo, 'else');
});
