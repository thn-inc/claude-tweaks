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
  appendShimRecord, readShimLog, SHIM_LOGS, createSandbox, writeShims, oracleSkip, REPO,
} = require('./queue-pull-oracle');
const {
  S0, S1, S2, SEmpty, SMalformed, SPortable, D1Second, S1LiveDep, FAULTS, QUEUE_ARGV, ghAnswer, shimTable,
} = require('./queue-pull-fixtures');

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

// The shell bin/git's #! line names, for the tests that start it (or a baseline) from a wrapper.
const SHIM_SHELL = '/bin/sh';

// A sandbox built from `scenario`, removed when the test ends, its run env, and
// `git(args, { cwd, extra })`: its bin/git run from `cwd` (default: the clone) with that env,
// `extra` merged over it.
const gitSandbox = (t, scenario = S0()) => {
  const sb = createSandbox(scenario);
  t.after(() => sb.cleanup());
  const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-git-shim' });
  const git = (args, { cwd = sb.proj, extra = {} } = {}) => spawnSync(path.join(sb.bin, 'git'), args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  return { sb, env, git };
};

// [tag, why] of each record in the sandbox's git log.
const gitTagsAndWhys = (sb) => readShimLog(sb.logs, 'git').map((e) => [e.tag, e.why]);

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
  // The same walk in one value: the kernel resolves proj/root/.. from the link's target, as git's
  // chdir does, so it lands above the sandbox too (real git there: "not a git repository").
  const oneValue = git(['-C', 'proj/root/..', 'rev-parse', 'HEAD'], { cwd: sb.root });
  assert.equal(oneValue.status, 97, oneValue.stderr);
  assert.equal(oneValue.stderr, `git-shim: refused (outside the sandbox: ${above}): -C proj/root/.. rev-parse HEAD\n`);
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

test('the git shim cuts the refused argv at 300 bytes and logs it whole', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const argv = ['--bare', 'x'.repeat(400)];
  const r = git(argv);
  assert.equal(r.status, 97);
  assert.equal(r.stderr, `git-shim: refused (unknown global option --bare): ${argv.join(' ').slice(0, 300)}\n`);
  assert.deepEqual(readShimLog(sb.logs, 'git'), [{ tag: 'REFUSED', why: 'unknown global option --bare', cwd: sb.proj, argv }]);
});

test('the git shim hands git the OLDPWD and PWD it was started with', { skip: oracleSkip() }, (t) => {
  const { sb, env, git } = gitSandbox(t);
  // A repo-local alias (the shim checks -c values, not the repo's config): git execs env with
  // the environment it inherited.
  fs.appendFileSync(path.join(sb.proj, '.git', 'config'), '[alias]\n\tshowenv = !env\n');
  const alias = path.join(sb.root, 'alias');
  fs.symlinkSync(sb.root, alias);
  const extra = { OLDPWD: '/x', PWD: alias };
  const seen = (r) => r.stdout.split('\n').filter((l) => /^(OLDPWD|PWD)=/.test(l)).sort();
  const viaShim = git(['-C', 'proj', 'showenv'], { cwd: alias, extra });
  assert.equal(viaShim.status, 0, viaShim.stderr);
  // The baseline is the same shell exec'ing git with no shim: macOS /bin/sh (bash 3.2) drops an
  // inherited OLDPWD at startup, dash keeps it, so the baseline says which of the two git sees.
  const direct = spawnSync(SHIM_SHELL, ['-c', 'exec git "$@"', SHIM_SHELL, '-C', 'proj', 'showenv'],
    { cwd: alias, env: { ...env, ...extra, PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(direct.status, 0, direct.stderr);
  const expected = seen(direct);
  assert.ok([`OLDPWD=/x\nPWD=${alias}`, `PWD=${alias}`].includes(expected.join('\n')), `baseline: ${expected.join(' ')}`);
  assert.deepEqual(seen(viaShim), expected);
});

test('the git shim stops before git runs when it cannot write its log', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const missing = path.join(sb.root, 'no-such-logs');
  const r = git(['tag', 'qp-unlogged'], { extra: { QP_LOG_DIR: missing } });
  assert.equal(r.status, 97);
  assert.equal(r.stderr, `git-shim: cannot write ${missing}/git-argv.nul\n`);
  assert.equal(git(['tag', '--list', 'qp-unlogged']).stdout, '', 'git never ran');
});

test('the git shim refuses a cwd outside the sandbox', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qp-shims-outside-')));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const r = git(['status'], { cwd: outside, extra: { PWD: outside } });
  assert.equal(r.status, 97, r.stderr);
  assert.equal(r.stderr, `git-shim: refused (outside the sandbox: ${outside}): status\n`);
  assert.deepEqual(readShimLog(sb.logs, 'git'), [{ tag: 'REFUSED', why: `outside the sandbox: ${outside}`, cwd: outside, argv: ['status'] }]);
});

test('the git shim refuses an unresolvable cwd', { skip: oracleSkip() }, (t) => {
  const { sb, env } = gitSandbox(t);
  const gone = path.join(sb.proj, 'gone');
  fs.mkdirSync(gone);
  // A wrapper removes its own cwd, then starts the shim there.
  const r = spawnSync(SHIM_SHELL, ['-c', 'rmdir "$1" && exec "$0" "$2" status', SHIM_SHELL, gone, path.join(sb.bin, 'git')],
    { cwd: gone, env: { ...env, PWD: gone }, encoding: 'utf8' });
  assert.equal(r.status, 97, r.stderr);
  // Each shell first prints its own getcwd complaint at startup.
  assert.match(r.stderr, /git-shim: refused \(unresolvable cwd\): status\n$/);
  assert.deepEqual(gitTagsAndWhys(sb), [['REFUSED', 'unresolvable cwd']]);
});

for (const [name, extra] of [
  ['GIT_CONFIG_COUNT', { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/x' }],
  ['GIT_CONFIG_PARAMETERS', { GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/x'" }],
]) {
  test(`the git shim refuses config carried in ${name}`, { skip: oracleSkip() }, (t) => {
    const { sb, git } = gitSandbox(t);
    const r = git(['status'], { extra });
    assert.equal(r.status, 97);
    assert.equal(r.stderr, 'git-shim: refused (GIT_CONFIG_COUNT/GIT_CONFIG_PARAMETERS set): status\n');
    assert.deepEqual(gitTagsAndWhys(sb), [['REFUSED', 'GIT_CONFIG_COUNT/GIT_CONFIG_PARAMETERS set']]);
  });
}

for (const name of ['GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
  test(`the git shim refuses a repository moved by ${name}`, { skip: oracleSkip() }, (t) => {
    const { sb, git } = gitSandbox(t);
    const r = git(['status'], { extra: { [name]: path.join(REPO, '.git') } });
    assert.equal(r.status, 97);
    assert.equal(r.stderr, 'git-shim: refused (GIT_COMMON_DIR/GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES set): status\n');
    assert.deepEqual(gitTagsAndWhys(sb), [['REFUSED', 'GIT_COMMON_DIR/GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES set']]);
  });
}

// The file an escaping GIT_INDEX_FILE would land on beside the sandbox, named after it so a
// leftover never fails a later run, and removed when the test ends.
const escapeTarget = (t, sb, suffix) => {
  const name = `${path.basename(sb.root)}-${suffix}`;
  const file = path.join(path.dirname(sb.root), name);
  t.after(() => fs.rmSync(file, { force: true }));
  return { name, file };
};

test('the git shim refuses a GIT_INDEX_FILE outside the sandbox', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const { name, file } = escapeTarget(t, sb, 'qp-index');
  // Plainly outside, and outside through a .. that only reads as inside.
  const outside = [file, `${sb.root}/tmp/../../${name}`];
  for (const index of outside) {
    const r = git(['read-tree', 'HEAD'], { extra: { GIT_INDEX_FILE: index } });
    assert.equal(r.status, 97, index);
    assert.equal(r.stderr, `git-shim: refused (GIT_INDEX_FILE outside the sandbox: ${index}): read-tree HEAD\n`);
  }
  assert.deepEqual(gitTagsAndWhys(sb), outside.map((index) => ['REFUSED', `GIT_INDEX_FILE outside the sandbox: ${index}`]));
  assert.equal(fs.existsSync(file), false, 'git never wrote it');
});

test('the git shim refuses a relative GIT_INDEX_FILE with a .. segment', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  const { name, file } = escapeTarget(t, sb, 'qp-rel-index');
  // git resolves a relative GIT_INDEX_FILE from the worktree top (the clone, root/proj): the first
  // two climb to the file beside the sandbox (sub exists, so the kernel can resolve the second);
  // the other three land inside it and are refused by shape alone, one per case pattern.
  fs.mkdirSync(path.join(sb.proj, 'sub'));
  const relative = [`../../${name}`, `sub/../../../${name}`, `../${name}`, '..', 'sub/..'];
  for (const index of relative) {
    const r = git(['read-tree', 'HEAD'], { extra: { GIT_INDEX_FILE: index } });
    assert.equal(r.status, 97, index);
    assert.equal(r.stderr, `git-shim: refused (GIT_INDEX_FILE outside the sandbox: ${index}): read-tree HEAD\n`);
  }
  assert.deepEqual(gitTagsAndWhys(sb), relative.map((index) => ['REFUSED', `GIT_INDEX_FILE outside the sandbox: ${index}`]));
  assert.equal(fs.existsSync(file), false, 'git never wrote it');
});

test('the git shim delegates with a GIT_INDEX_FILE inside the sandbox', { skip: oracleSkip() }, (t) => {
  const { sb, git } = gitSandbox(t);
  // The plugin's scratch index (claims-git-cas.js, ledger-residue.js): absolute, under TMPDIR.
  const index = path.join(sb.root, 'tmp', 'qp-scratch-index');
  const r = git(['read-tree', 'HEAD'], { extra: { GIT_INDEX_FILE: index } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(index), true, 'git wrote the scratch index');
  // A relative one with no .. segment stays under the worktree top git resolves it from, inside
  // the repo the -C walk already contained.
  const relative = git(['read-tree', 'HEAD'], { extra: { GIT_INDEX_FILE: 'qp-rel-index' } });
  assert.equal(relative.status, 0, relative.stderr);
  assert.deepEqual(readShimLog(sb.logs, 'git').map((e) => e.tag), ['delegated', 'delegated']);
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

// --- the mktemp shim and bin/node ------------------------------------------------

// A sandbox, its tmpdir (created) and `mktemp(args, { extra })`: its bin/mktemp run with the
// sandbox's run env, `extra` merged over it. `counter` is the file the shim and deps.tmpName share.
const mktempSandbox = (t) => {
  const sb = createSandbox(S0());
  t.after(() => sb.cleanup());
  const tmpdir = path.join(sb.root, 'tmp', 'mk');
  fs.mkdirSync(tmpdir, { recursive: true });
  const env = sb.runEnv({ tmpdir, sessionId: 'qp-mktemp-shim' });
  const mktemp = (args = [], { extra = {} } = {}) => spawnSync(path.join(sb.bin, 'mktemp'), args, { cwd: sb.proj, env: { ...env, ...extra }, encoding: 'utf8' });
  return { sb, tmpdir, counter: env.QP_TMPNAME_COUNTER_FILE, mktemp };
};

test('the mktemp shim is a sh script and counts', { skip: oracleSkip() }, (t) => {
  const { sb, tmpdir, counter, mktemp } = mktempSandbox(t);
  assert.equal(fs.readFileSync(path.join(sb.bin, 'mktemp'), 'utf8').split('\n')[0], '#!/bin/sh');
  for (const k of [1, 2]) {
    const file = path.join(tmpdir, `tmp.qp0000000${k}`);
    const r = mktemp();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${file}\n`);
    assert.equal(r.stderr, '');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.equal(fs.readFileSync(counter, 'utf8'), '2');
});

test('the mktemp shim reads a leading-zero counter as decimal', { skip: oracleSkip() }, (t) => {
  const { tmpdir, counter, mktemp } = mktempSandbox(t);
  fs.writeFileSync(counter, '08');
  assert.equal(mktemp().stdout, `${path.join(tmpdir, 'tmp.qp00000009')}\n`);
  assert.equal(fs.readFileSync(counter, 'utf8'), '9');
  fs.writeFileSync(counter, '');
  assert.equal(mktemp().stdout, `${path.join(tmpdir, 'tmp.qp00000001')}\n`);
  fs.rmSync(counter);
  fs.rmSync(path.join(tmpdir, 'tmp.qp00000001'));
  assert.equal(mktemp().stdout, `${path.join(tmpdir, 'tmp.qp00000001')}\n`, 'an absent counter is 0');
});

test('the mktemp shim refuses', { skip: oracleSkip() }, (t) => {
  const { tmpdir, counter, mktemp } = mktempSandbox(t);
  const arg = mktemp(['-d']);
  assert.equal(arg.status, 97);
  assert.equal(arg.stderr, 'mktemp-shim: refused (arguments are not supported): -d\n');
  fs.writeFileSync(counter, 'abc');
  const bad = mktemp();
  assert.equal(bad.status, 97);
  assert.equal(bad.stderr, 'mktemp-shim: refused (counter file holds "abc"): \n');
  fs.writeFileSync(counter, '4');
  fs.writeFileSync(path.join(tmpdir, 'tmp.qp00000005'), 'taken');
  const taken = mktemp();
  assert.equal(taken.status, 97);
  assert.equal(taken.stderr, `mktemp-shim: refused (file exists: ${path.join(tmpdir, 'tmp.qp00000005')}): \n`);
  assert.equal(fs.readFileSync(path.join(tmpdir, 'tmp.qp00000005'), 'utf8'), 'taken', 'an existing file is left alone');
  assert.equal(fs.readFileSync(counter, 'utf8'), '4', 'a refusal leaves the counter');
  for (const extra of [{ TMPDIR: '' }, { QP_TMPNAME_COUNTER_FILE: '' }]) {
    const r = mktemp([], { extra });
    assert.equal(r.status, 97);
    assert.equal(r.stderr, 'mktemp-shim: refused (TMPDIR and QP_TMPNAME_COUNTER_FILE are required): \n');
  }
});

test('the mktemp shim refuses a TMPDIR it cannot create in', { skip: oracleSkip() }, (t) => {
  const { tmpdir, counter, mktemp } = mktempSandbox(t);
  fs.writeFileSync(counter, '4');
  const missing = path.join(tmpdir, 'absent');
  const r = mktemp([], { extra: { TMPDIR: missing } });
  assert.equal(r.status, 97);
  assert.equal(r.stderr, `mktemp-shim: refused (cannot create: ${path.join(missing, 'tmp.qp00000005')}): \n`);
  assert.equal(fs.readFileSync(counter, 'utf8'), '4');
});

test('the mktemp shim refuses a counter it cannot write, leaving the created file', { skip: oracleSkip() }, (t) => {
  const { tmpdir, mktemp } = mktempSandbox(t);
  const counter = path.join(tmpdir, 'no-such-dir', 'counter');
  const r = mktemp([], { extra: { QP_TMPNAME_COUNTER_FILE: counter } });
  assert.equal(r.status, 97);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `mktemp-shim: refused (cannot write counter: ${counter}): \n`);
  assert.equal(fs.existsSync(path.join(tmpdir, 'tmp.qp00000001')), true, 'the created file stays');
});

test('the mktemp shim refuses a counter past 15 digits', { skip: oracleSkip() }, (t) => {
  const { tmpdir, counter, mktemp } = mktempSandbox(t);
  fs.writeFileSync(counter, '1234567890123456');
  const r = mktemp();
  assert.equal(r.status, 97);
  assert.equal(r.stderr, 'mktemp-shim: refused (counter file holds "1234567890123456"): \n');
  fs.writeFileSync(counter, '0000000000000000007');
  assert.equal(mktemp().stdout, `${path.join(tmpdir, 'tmp.qp00000008')}\n`, 'zeros do not count toward the 15');
});

test('bin/node is a sh script', { skip: oracleSkip() }, (t) => {
  const { sb } = mktempSandbox(t);
  assert.equal(fs.readFileSync(path.join(sb.bin, 'node'), 'utf8').split('\n')[0], '#!/bin/sh');
});

// --- the gh shim ------------------------------------------------------------------

// The shims for `scenario` written by writeShims into a fresh temp root, removed when the test ends
// (no clone: only bin/gh runs here, so the git shim's real-git path is never used), and
// `gh(args, { extra })`: that bin/gh run with QP_SHIM_TABLE holding the table and a fresh
// QP_LOG_DIR, `extra` merged over the env.
const ghShims = (t, scenario) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qp-gh-shim-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [bin, shimDir, logs] = ['bin', 'shim', 'logs'].map((d) => {
    fs.mkdirSync(path.join(root, d));
    return path.join(root, d);
  });
  const table = shimTable(scenario);
  const tablePath = path.join(root, 'shim-table.json');
  fs.writeFileSync(tablePath, JSON.stringify(table));
  writeShims({ bin, shimDir, root, realGit: '/usr/bin/git', table });
  const env = { PATH: [bin, '/usr/bin', '/bin'].join(path.delimiter), QP_LOG_DIR: logs, QP_SHIM_TABLE: tablePath };
  const gh = (args, { extra = {} } = {}) => spawnSync(path.join(bin, 'gh'), args, { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  return { root, shimDir, logs, gh };
};

test('the gh shim is a sh script', { skip: oracleSkip() }, (t) => {
  const sb = createSandbox(S0());
  t.after(() => sb.cleanup());
  assert.equal(fs.readFileSync(path.join(sb.bin, 'gh'), 'utf8').split('\n')[0], '#!/bin/sh');
  assert.equal(fs.existsSync(path.join(sb.bin, 'gh-fallback')), false, 'the node fallback is off PATH');
  assert.equal(fs.existsSync(path.join(sb.root, 'shim', 'gh-fallback')), true);
});

test('the sh gh shim agrees with ghAnswer on every exact entry', { skip: oracleSkip() }, (t) => {
  const scenarios = [S0(), S1(), S1({ full: true }), S1({ parity: true }), S2(), SEmpty(), SMalformed(), SMalformed('labels'), SMalformed('body'),
    SMalformed('blocker'), SPortable(), D1Second(), S1LiveDep(), ...FAULTS.map((f) => f.scenario())];
  const checked = new Set();
  let longest = 0;
  scenarios.forEach((scenario, n) => {
    const table = shimTable(scenario);
    const fresh = [];
    for (const entry of table.gh) {
      if (!Array.isArray(entry.argv)) continue;
      const answer = ghAnswer(table.gh, entry.argv);
      const key = JSON.stringify([entry.argv, answer]);
      if (answer.effect || checked.has(key)) continue;
      checked.add(key);
      fresh.push([entry.argv, answer]);
    }
    if (!fresh.length) return;
    const { shimDir, logs, gh } = ghShims(t, scenario);
    // With the node fallback gone, a call that only it could answer fails instead of agreeing.
    fs.rmSync(path.join(shimDir, 'gh-fallback'));
    for (const [argv, answer] of fresh) {
      const label = `scenario ${n} (${scenario.name}): gh ${argv.join(' ').slice(0, 120)}`;
      const r = gh(argv);
      assert.deepEqual({ stdout: r.stdout, stderr: r.stderr, status: r.status }, { stdout: answer.stdout, stderr: answer.stderr, status: answer.status }, label);
      assert.deepEqual(readShimLog(logs, 'gh').at(-1), { tag: answer.status ? 'injected' : 'ok', argv }, label);
      longest = Math.max(longest, argv.length);
    }
  });
  assert.ok(longest >= 10, `the longest checked argv has ${longest} elements, so \${10} is never exercised`);
});

test('a near miss of an exact entry falls back and fails loudly', { skip: oracleSkip() }, (t) => {
  const { logs, gh } = ghShims(t, S0());
  for (const argv of [[...QUEUE_ARGV.slice(0, -1), '501'], [...QUEUE_ARGV, '--paginate']]) {
    const r = gh(argv);
    assert.equal(r.status, 97, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `gh-shim: no canned response for: ${argv.join(' ').slice(0, 300)}\n`);
    assert.deepEqual(readShimLog(logs, 'gh').at(-1), { tag: 'UNHANDLED', argv });
  }
});

test('an effect entry keeps its argv on the node path, shadowing a later entry with the same argv', { skip: oracleSkip() }, (t) => {
  const { root, gh } = ghShims(t, { gh: [{ argv: ['dup'], stdout: 'x\n', effect: 'delete-session-file:probe.txt' }, { argv: ['dup'], stdout: 'y\n' }] });
  const probe = path.join(root, 'ct-session-qp-gh-shadow', 'probe.txt');
  fs.mkdirSync(path.dirname(probe));
  fs.writeFileSync(probe, 'x');
  const r = gh(['dup'], { extra: { TMPDIR: root, CLAUDE_CODE_SESSION_ID: 'qp-gh-shadow' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'x\n', 'ghAnswer returns the first entry, the effect one');
  assert.equal(fs.existsSync(probe), false, 'the fallback applied the effect');
});

test('the sh gh shim answers nothing when it cannot write its log', { skip: oracleSkip() }, (t) => {
  const { root, gh } = ghShims(t, S0());
  const missing = path.join(root, 'no-such-logs');
  const r = gh(['--version'], { extra: { QP_LOG_DIR: missing } });
  assert.equal(r.status, 97);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `gh-shim: cannot write ${missing}/gh-argv.nul\n`);
  const unset = gh(['--version'], { extra: { QP_LOG_DIR: '' } });
  assert.equal(unset.status, 97);
  assert.equal(unset.stderr, 'gh-shim: QP_LOG_DIR is required\n');
});

test('the sh gh shim refuses an empty QP_LOG_DIR before a miss reaches the fallback', { skip: oracleSkip() }, (t) => {
  const { root, gh } = ghShims(t, S0());
  const r = gh(['issue', 'view', '1'], { extra: { QP_LOG_DIR: '' } });
  assert.equal(r.status, 97);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'gh-shim: QP_LOG_DIR is required\n');
  assert.equal(fs.existsSync(path.join(root, 'gh-argv.nul')), false, 'no relative log in the cwd');
});

test('setScenario regenerates the gh answers', { skip: oracleSkip() }, (t) => {
  const probe = (stdout) => ({ ...S0(), gh: [...S0().gh, { argv: ['probe'], stdout }] });
  const sb = createSandbox(probe('a\n'));
  t.after(() => sb.cleanup());
  const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-gh-shim' });
  const gh = () => spawnSync(path.join(sb.bin, 'gh'), ['probe'], { cwd: sb.proj, env, encoding: 'utf8' });
  const before = gh();
  assert.equal(before.status, 0, before.stderr);
  assert.equal(before.stdout, 'a\n');
  sb.setScenario(probe('b\n'));
  assert.equal(gh().stdout, 'b\n');
});
