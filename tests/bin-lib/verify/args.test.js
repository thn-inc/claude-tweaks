'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { parseArgs, UsageError, USAGE } = require(path.join(
  __dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'args.js'));

test('parses repeatable --cmd plus --json, --log-dir, and --count-stamp', () => {
  const got = parseArgs([
    '--cmd', 'types=tsc --noEmit',
    '--cmd', 'lint=eslint .',
    '--cmd', 'tests=npm test',
    '--json', '/tmp/r.json',
    '--log-dir', '/tmp/logs',
    '--count-stamp', '/tmp/count.json',
  ]);
  assert.deepStrictEqual(got, {
    cmds: [
      { name: 'types', command: 'tsc --noEmit' },
      { name: 'lint', command: 'eslint .' },
      { name: 'tests', command: 'npm test' },
    ],
    json: '/tmp/r.json',
    logDir: '/tmp/logs',
    countStamp: '/tmp/count.json',
    gitDir: null,
    stampStatus: false,
    noStamp: false,
    scope: null,
    base: null,
    integrationBranch: null,
    changedFiles: false,
    run: null,
    cwd: null,
  });
});

test('--cwd sets the cwd every --cmd spawns in (#2376)', () => {
  const got = parseArgs(['--cmd', 'tests=npm test', '--cwd', '/repo/packages/app']);
  assert.strictEqual(got.cwd, '/repo/packages/app');
});

test('cwd defaults to null when --cwd is omitted', () => {
  const got = parseArgs(['--cmd', 'tests=npm test']);
  assert.strictEqual(got.cwd, null);
});

test('--cwd with --stamp-status throws UsageError (read-only mode takes no run-scoped flags)', () => {
  assert.throws(() => parseArgs(['--stamp-status', '--cwd', '/repo']), UsageError);
});

test('--cwd with --changed-files throws UsageError', () => {
  assert.throws(() => parseArgs(['--changed-files', '--cwd', '/repo']), UsageError);
});

test('json, logDir, and countStamp default to null when omitted', () => {
  const got = parseArgs(['--cmd', 'tests=npm test']);
  assert.strictEqual(got.json, null);
  assert.strictEqual(got.logDir, null);
  assert.strictEqual(got.countStamp, null);
});

test('a --cmd value keeps metacharacters and later = signs intact (AC10 parse half)', () => {
  const got = parseArgs(['--cmd', 'tests=FOO="a b" node -e "1 && 2" | cat']);
  assert.strictEqual(got.cmds[0].command, 'FOO="a b" node -e "1 && 2" | cat');
});

test('missing = in --cmd value throws UsageError', () => {
  assert.throws(() => parseArgs(['--cmd', 'testsnpm test']), UsageError);
});

test('empty name in --cmd value throws UsageError', () => {
  assert.throws(() => parseArgs(['--cmd', '=npm test']), UsageError);
});

test('empty command in --cmd value throws UsageError', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=']), UsageError);
});

test('unknown flag throws UsageError', () => {
  assert.throws(() => parseArgs(['--bogus']), UsageError);
});

test('flag missing its value throws UsageError', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=npm test', '--json']), UsageError);
});

test('zero --cmd flags throws UsageError', () => {
  assert.throws(() => parseArgs([]), UsageError);
});

test('duplicate --cmd name throws UsageError', () => {
  assert.throws(
    () => parseArgs(['--cmd', 'tests=a', '--cmd', 'tests=b']), UsageError);
});

test('a --cmd name with path-traversal or path-separator characters throws UsageError (security)', () => {
  assert.throws(() => parseArgs(['--cmd', '../../etc/passwd=echo hi']), UsageError);
  assert.throws(() => parseArgs(['--cmd', 'a/b=echo hi']), UsageError);
  assert.throws(() => parseArgs(['--cmd', 'a\\b=echo hi']), UsageError);
});

test('USAGE names every flag', () => {
  for (const flag of ['--cmd', '--json', '--log-dir', '--count-stamp']) {
    assert.ok(USAGE.includes(flag), `USAGE missing ${flag}`);
  }
});

test('USAGE documents the workaround for a monorepo with N independent typecheck commands (#2341)', () => {
  assert.match(USAGE, /only one --cmd name, "types", joins the reserved/);
  assert.match(USAGE, /combine them/);
});

test('--stamp-status parses with no --cmd and sets stampStatus (#1921)', () => {
  const parsed = parseArgs(['--stamp-status']);
  assert.strictEqual(parsed.stampStatus, true);
  assert.deepStrictEqual(parsed.cmds, []);
  assert.strictEqual(parsed.gitDir, null);
});

test('--git-dir is accepted with --stamp-status and with a run (#1921)', () => {
  assert.strictEqual(parseArgs(['--stamp-status', '--git-dir', '/g']).gitDir, '/g');
  assert.strictEqual(parseArgs(['--cmd', 'tests=node -e 0', '--git-dir', '/g']).gitDir, '/g');
  assert.throws(() => parseArgs(['--git-dir']), UsageError);
});

test('--no-stamp is a boolean flag defaulting to false (#1921)', () => {
  assert.strictEqual(parseArgs(['--cmd', 'tests=node -e 0']).noStamp, false);
  assert.strictEqual(parseArgs(['--cmd', 'tests=node -e 0', '--no-stamp']).noStamp, true);
  assert.strictEqual(parseArgs(['--cmd', 'tests=node -e 0']).stampStatus, false);
});

test('a run without --cmd is still a usage error when --stamp-status is absent (#1921)', () => {
  assert.throws(() => parseArgs(['--no-stamp']), UsageError);
});

test('USAGE names the new flags (#1921)', () => {
  for (const flag of ['--stamp-status', '--no-stamp', '--git-dir']) assert.ok(USAGE.includes(flag), flag);
});

test('--stamp-status and --cmd are mutually exclusive (#1921 final review)', () => {
  assert.throws(() => parseArgs(['--stamp-status', '--cmd', 'tests=node -e 0']), UsageError);
});

test('--scope, --base, and --integration-branch parse as value flags (#1922)', () => {
  const p = parseArgs(['--cmd', 'tests=node -e 0', '--scope', '.claude-tweaks/verify-scope.json', '--base', 'abc', '--integration-branch', 'main']);
  assert.strictEqual(p.scope, '.claude-tweaks/verify-scope.json');
  assert.strictEqual(p.base, 'abc');
  assert.strictEqual(p.integrationBranch, 'main');
  const d = parseArgs(['--cmd', 'tests=node -e 0']);
  assert.strictEqual(d.scope, null); assert.strictEqual(d.base, null); assert.strictEqual(d.integrationBranch, null);
  assert.throws(() => parseArgs(['--cmd', 'tests=x', '--scope']), UsageError);
  for (const flag of ['--scope', '--base', '--integration-branch']) assert.ok(USAGE.includes(flag), flag);
});

test('--base/--integration-branch without --scope is a usage error (#1922 review L12)', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=x', '--base', 'abc']), UsageError);
  assert.throws(() => parseArgs(['--cmd', 'tests=x', '--integration-branch', 'main']), UsageError);
  // --scope present makes both fine (existing behavior, unaffected).
  assert.doesNotThrow(() => parseArgs(['--cmd', 'tests=x', '--scope', 's.json', '--base', 'abc']));
});

test('--stamp-status rejects --scope/--base/--integration-branch (#1922 review L12)', () => {
  assert.throws(() => parseArgs(['--stamp-status', '--scope', 's.json']), UsageError);
  assert.throws(() => parseArgs(['--stamp-status', '--base', 'abc']), UsageError);
  assert.throws(() => parseArgs(['--stamp-status', '--integration-branch', 'main']), UsageError);
  // --git-dir stays fine alongside --stamp-status (existing behavior, unaffected).
  assert.doesNotThrow(() => parseArgs(['--stamp-status', '--git-dir', '/g']));
});

test('--changed-files is a read-only mode: no --cmd, no --scope, not with --stamp-status; --base/--integration-branch allowed (#1923)', () => {
  const p = parseArgs(['--changed-files', '--integration-branch', 'main']);
  assert.strictEqual(p.changedFiles, true);
  assert.strictEqual(p.integrationBranch, 'main');
  assert.deepStrictEqual(p.cmds, []);
  assert.strictEqual(parseArgs(['--cmd', 'tests=x']).changedFiles, false);
  assert.throws(() => parseArgs(['--changed-files', '--cmd', 'tests=x']), UsageError);
  assert.throws(() => parseArgs(['--changed-files', '--scope', 's.json']), UsageError);
  assert.throws(() => parseArgs(['--changed-files', '--git-dir', '/g']), UsageError);
  assert.throws(() => parseArgs(['--changed-files', '--stamp-status']), UsageError);
  assert.ok(USAGE.includes('--changed-files'));
});

test('#1928: --run is parsed as a value flag and defaults to null', () => {
  assert.strictEqual(parseArgs(['--cmd', 'tests=node -e 0']).run, null);
  assert.strictEqual(parseArgs(['--run', '/tmp/run-x', '--cmd', 'tests=node -e 0']).run, '/tmp/run-x');
  assert.strictEqual(parseArgs(['--run', '', '--cmd', 'tests=node -e 0']).run, '');
});

test('#1928: --run is a usage error with --stamp-status or --changed-files', () => {
  assert.throws(() => parseArgs(['--stamp-status', '--run', '/tmp/run-x']), UsageError);
  assert.throws(() => parseArgs(['--changed-files', '--run', '/tmp/run-x']), UsageError);
});
