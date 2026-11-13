'use strict';
// #5366: the fast tests for the queue-pull oracle's PATH shims (tests/bin-lib/dispatch/
// queue-pull-oracle.js): the NUL-framed shim log and its reader, and each generated sh shim run
// directly in a sandbox, with no bash oracle run. The parity suite (queue-pull.test.js) holds the
// slow, whole-fence tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  appendShimRecord, readShimLog, SHIM_LOGS, createSandbox, oracleSkip, REPO,
} = require('./queue-pull-oracle');
const { S0 } = require('./queue-pull-fixtures');

// A fresh logs dir, removed when the test ends.
const tmpLogs = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-shims-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('readShimLog round-trips awkward argv', (t) => {
  const dir = tmpLogs(t);
  const awkward = ['api', 'graphql', '-f', 'query=query{ a: issue(number:1){ x } }\n"q" $HOME `id` \'s\'', ''];
  const plain = ['issue', 'view', '1'];
  appendShimRecord(path.join(dir, SHIM_LOGS.gh), { tag: 'ok', argv: awkward });
  appendShimRecord(path.join(dir, SHIM_LOGS.gh), { tag: 'UNHANDLED', argv: plain });
  assert.deepEqual(readShimLog(dir, 'gh'), [{ tag: 'ok', argv: awkward }, { tag: 'UNHANDLED', argv: plain }]);
});

test('readShimLog keeps cwd and why for git', (t) => {
  const dir = tmpLogs(t);
  appendShimRecord(path.join(dir, SHIM_LOGS.git), { tag: 'REFUSED', why: 'unknown global option --bare', cwd: '/a/b', argv: ['--bare', 'status'] });
  appendShimRecord(path.join(dir, SHIM_LOGS.git), { tag: 'delegated', cwd: '/c', argv: ['status'] });
  const [first, second] = readShimLog(dir, 'git');
  assert.deepEqual(first, { tag: 'REFUSED', why: 'unknown global option --bare', cwd: '/a/b', argv: ['--bare', 'status'] });
  assert.deepEqual(second, { tag: 'delegated', cwd: '/c', argv: ['status'] });
  assert.equal('why' in second, false);
});

test('readShimLog throws on a truncated record', (t) => {
  const dir = tmpLogs(t);
  // The detail is pinned too: the header-cut case would otherwise throw on its missing argc anyway.
  const cases = [
    ['ok\0\0\0' + '3\0a\0', /malformed record.*ends after 1 argument/],
    ['ok\0\0\0x\0', /malformed record.*argc is not a decimal integer/],
    ['ok\0\0', /malformed record.*file ends mid-record/],
    ['ok\0\0\0' + '1\0a', /malformed record.*file ends mid-field/],
  ];
  for (const [bytes, expected] of cases) {
    fs.writeFileSync(path.join(dir, SHIM_LOGS.gh), bytes);
    assert.throws(() => readShimLog(dir, 'gh'), expected, JSON.stringify(bytes));
  }
});

test('an absent log reads as []', (t) => {
  assert.deepEqual(readShimLog(tmpLogs(t), 'gh'), []);
  assert.deepEqual(readShimLog(tmpLogs(t), 'git'), []);
});

// --- the git shim ---------------------------------------------------------------

// A sandbox built from `scenario`, removed when the test ends, and `git(args, { cwd, extra })`:
// its bin/git run from `cwd` (default: the clone) with the sandbox's own env, `extra` merged over it.
const gitSandbox = (t, scenario = S0()) => {
  const sb = createSandbox(scenario);
  t.after(() => sb.cleanup());
  const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-git-shim' });
  const git = (args, { cwd = sb.proj, extra = {} } = {}) => spawnSync(path.join(sb.bin, 'git'), args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  return { sb, git };
};

test('the git shim is a sh script', { skip: oracleSkip() }, (t) => {
  const { sb } = gitSandbox(t);
  assert.equal(fs.readFileSync(path.join(sb.bin, 'git'), 'utf8').split('\n')[0], '#!/bin/sh');
});

test('the git shim refuses a -C that leaves the sandbox through a symlink', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const out = path.join(sb.root, 'out');
  fs.symlinkSync(REPO, out);
  const r = git(['-C', out, 'rev-parse', 'HEAD']);
  assert.equal(r.status, 97, r.stderr);
  assert.equal(r.stderr, `git-shim: refused (outside the sandbox: ${fs.realpathSync(REPO)}): -C ${out} rev-parse HEAD\n`);
});

test('the git shim resolves chained relative -C like git', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const above = path.dirname(sb.root);
  const up = git(['-C', 'proj', '-C', '..', '-C', '..', 'rev-parse', 'HEAD'], { cwd: sb.root });
  assert.equal(up.status, 97, up.stderr);
  assert.equal(up.stderr, `git-shim: refused (outside the sandbox: ${above}): -C proj -C .. -C .. rev-parse HEAD\n`);
  const back = git(['-C', 'proj', '-C', '.', 'rev-parse', '--show-toplevel'], { cwd: sb.root });
  assert.equal(back.status, 0, back.stderr);
  assert.equal(back.stdout, sb.proj + '\n');
  // Each -C resolves from where the one before it physically landed, as git's chdir does: proj/root
  // is the sandbox root itself, so its `..` is above the sandbox, though the text proj/root/..
  // reads as proj.
  fs.symlinkSync(sb.root, path.join(sb.proj, 'root'));
  const viaLink = git(['-C', 'proj/root', '-C', '..', 'rev-parse', 'HEAD'], { cwd: sb.root });
  assert.equal(viaLink.status, 97, viaLink.stderr);
  assert.equal(viaLink.stderr, `git-shim: refused (outside the sandbox: ${above}): -C proj/root -C .. rev-parse HEAD\n`);
});

test('the git shim treats -C "" as a no-op and a trailing -c as an empty key', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const empty = git(['-C', '', 'rev-parse', '--show-toplevel']);
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, sb.proj + '\n');
  const trailing = git(['-c']);
  assert.equal(trailing.status, 97);
  assert.equal(trailing.stderr, 'git-shim: refused (config key not allowed: ): -c\n');
});

test('the git shim refuses an unknown option before a bad -c key', { skip: oracleSkip() }, (t) => {
  const { git } = gitSandbox(t);
  const r = git(['-c', 'core.hooksPath=/x', '--bare', 'status']);
  assert.equal(r.status, 97);
  assert.equal(r.stderr, 'git-shim: refused (unknown global option --bare): -c core.hooksPath=/x --bare status\n');
});

test('the git shim logs a delegated call with its physical cwd and execs git', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const r = git(['rev-parse', '--show-toplevel']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, sb.proj + '\n');
  // From a symlinked cwd whose PWD names the link, the log still carries the physical dir.
  const alias = path.join(sb.root, 'alias');
  fs.symlinkSync(sb.proj, alias);
  const viaAlias = git(['rev-parse', '--show-toplevel'], { cwd: alias, extra: { PWD: alias } });
  assert.equal(viaAlias.status, 0, viaAlias.stderr);
  const record = { tag: 'delegated', cwd: sb.proj, argv: ['rev-parse', '--show-toplevel'] };
  assert.deepEqual(readShimLog(sb.logs, 'git'), [record, record]);
});

test('the git shim refuses -C - through a symlink named -', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  fs.symlinkSync(REPO, path.join(sb.proj, '-'));
  const r = git(['-C', '-', 'rev-parse', 'HEAD']);
  assert.equal(r.status, 97, r.stderr);
  assert.equal(r.stderr, `git-shim: refused (outside the sandbox: ${fs.realpathSync(REPO)}): -C - rev-parse HEAD\n`);
});

test('the git shim normalizes an unresolvable relative -C', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const r = git(['-C', './missing/../gone/', 'status']);
  assert.equal(r.status, 97);
  assert.equal(r.stderr, `git-shim: refused (unresolvable directory ${sb.proj}/gone): -C ./missing/../gone/ status\n`);
});

test('the git shim cuts the refused argv at 300 characters and logs it whole', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const argv = ['--bare', 'x'.repeat(400)];
  const r = git(argv);
  assert.equal(r.status, 97);
  assert.equal(r.stderr, `git-shim: refused (unknown global option --bare): ${argv.join(' ').slice(0, 300)}\n`);
  assert.deepEqual(readShimLog(sb.logs, 'git'), [{ tag: 'REFUSED', why: 'unknown global option --bare', cwd: sb.proj, argv }]);
});

test('the git shim requires QP_LOG_DIR', { skip: oracleSkip() }, (t) => {
  const { git } = gitSandbox(t);
  const r = git(['status'], { extra: { QP_LOG_DIR: '' } });
  assert.equal(r.status, 97);
  assert.equal(r.stderr, 'git-shim: QP_LOG_DIR is required\n');
});

test('setScenario regenerates the git fail prefixes', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const before = git(['status']);
  assert.equal(before.status, 0, before.stderr);
  sb.setScenario({ ...S0(), gitFail: [['status']] });
  const after = git(['status']);
  assert.equal(after.status, 128);
  assert.equal(after.stderr, 'git-shim: injected failure: status\n');
});
