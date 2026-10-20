// tests/bin-lib/staged-patch/stack-check.test.js — #3290's staging-time stacked check: apply-order
// conflict attribution. Every patch is a real `git diff` captured in a throwaway fixture repo
// (edit f.txt, capture the diff, restore f.txt with git checkout inside that fixture) — never
// hand-typed hunks.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FIXTURE_TIMEOUT_MS } = require('../../helpers/git-fixtures');
const { checkStack, gitEnv, rederive, stagedApplyOrder, stackVerdicts } = require('../../../plugin/bin/lib/staged-patch/stack-check');

const FIXTURE_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const BASE = ['l1', 'l2', 'l3', 'l4', 'anchor', 'a1', 'a2', 'a3'].join('\n') + '\n';
const PREAMBLE = 'Target: f.txt\nInvariant: x\n\n';

function gitFixture(t, content = BASE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: FIXTURE_ENV });
  const runOk = (...args) => {
    const r = git(...args);
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  runOk('init', '-q');
  runOk('config', 'user.email', 'stack-check@example.invalid');
  runOk('config', 'user.name', 'stack-check');
  fs.writeFileSync(path.join(dir, 'f.txt'), content);
  runOk('add', 'f.txt');
  runOk('commit', '-q', '-m', 'base');
  return { dir, git, runOk };
}

// Edit f.txt in a fixture whose HEAD is `base`, capture `git diff`, then restore f.txt.
function captureDiff(t, base, edit) {
  const fx = gitFixture(t, base);
  fs.writeFileSync(path.join(fx.dir, 'f.txt'), edit(base));
  const d = fx.git('diff');
  assert.equal(d.status, 0, d.stderr);
  fx.runOk('checkout', '--', 'f.txt');
  return d.stdout;
}

function stagedDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-check-staged-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function stage(dir, name, diff) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, PREAMBLE + diff);
  return file;
}

const insertAboveAnchor = (tag) => (text) => text.replace('anchor\n', `${tag}a\n${tag}b\nanchor\n`);
const editLine = (from, to) => (text) => text.replace(`${from}\n`, `${to}\n`);

test('AC1.1: two patches inserting above the same anchor are reported naming both', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  const r = checkStack({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(r.ok, false);
  assert.equal(r.targetConflict.patch, 'review-2.patch');
  assert.equal(r.targetConflict.conflictsWith, 'review-1.patch');
  assert.match(r.targetConflict.error, /patch failed|does not apply/);
});

test('AC2.1: patches on separate regions stack cleanly', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, BASE, editLine('a3', 'a3-edit')));
  const r = checkStack({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.skipped, []);
});

test('AC1.1: order — a new patch sorting first is still caught', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  stage(dir, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  const p10 = stage(dir, 'review-10.patch', captureDiff(t, BASE, insertAboveAnchor('new10')));
  const patches = stagedApplyOrder(['review-2.patch', 'review-10.patch']).map((n) => path.join(dir, n));
  const r = checkStack({ worktree: fx.dir, patches, target: p10 });
  assert.deepEqual(r.order, ['review-10.patch', 'review-2.patch']);
  assert.equal(r.targetConflict.patch, 'review-2.patch');
  assert.equal(r.targetConflict.conflictsWith, 'review-10.patch');
});

test('a patch that fails alone is skipped, not a conflict', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const mid = BASE.replace('a3\n', 'a3-mid\n');
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const r3 = stage(dir, 'review-3.patch', captureDiff(t, mid, editLine('a3-mid', 'a3-new')));
  const r = checkStack({ worktree: fx.dir, patches: [r1, r3], target: r1 });
  assert.deepEqual(r.skipped.map((s) => s.patch), ['review-3.patch']);
  assert.match(r.skipped[0].error, /patch failed|does not apply/);
  assert.deepEqual(r.conflicts, []);
});

test('worktree untouched: the check leaves git status clean and f.txt at its base bytes', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  checkStack({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(fx.git('status', '--porcelain').stdout, '');
  assert.equal(fs.readFileSync(path.join(fx.dir, 'f.txt'), 'utf8'), BASE);
});

// Real git for every call except those `intercept` answers (it returns a result, or null to pass).
function gitIntercepting(intercept) {
  return (args, { cwd }) => {
    const faked = intercept(args);
    if (faked) return faked;
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: FIXTURE_ENV });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
}

// Injectable-git seam: the numstat call reports `reported` as the patch's copied path; every other
// call runs real git. `calls` records each invocation so a test can prove what was never run.
function numstatReporting(reported, calls) {
  return gitIntercepting((args) => {
    calls.push(args);
    return args[0] === 'apply' && args[1] === '--numstat'
      ? { status: 0, stdout: `1\t1\t${reported}\0`, stderr: '' }
      : null;
  });
}

test('a copied path with a .. segment is skipped as unsafe and never read', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const p = stage(dir, 'unsafe.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const calls = [];
  const r = checkStack({ worktree: fx.dir, patches: [p], target: p, git: numstatReporting('../escape.txt', calls) });
  assert.deepEqual(r.skipped, [{ patch: 'unsafe.patch', error: 'unsafe path ../escape.txt' }]);
  assert.equal(r.ok, false);
  assert.equal(r.targetUnapplicable, true);
  assert.deepEqual(calls.filter((a) => a[0] === 'apply' && a[1] !== '--numstat'), []);
});

test('an absolute copied path is skipped as unsafe and never read', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const p = stage(dir, 'absolute.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const calls = [];
  const r = checkStack({ worktree: fx.dir, patches: [p], target: p, git: numstatReporting('/etc/passwd', calls) });
  assert.deepEqual(r.skipped, [{ patch: 'absolute.patch', error: 'unsafe path /etc/passwd' }]);
  assert.equal(r.ok, false);
  assert.deepEqual(calls.filter((a) => a[0] === 'apply' && a[1] !== '--numstat'), []);
});

test('stagedApplyOrder sorts byte-wise and drops non-patches', () => {
  assert.deepEqual(stagedApplyOrder(['review-2.patch', 'x.md', 'review-10.patch']), ['review-10.patch', 'review-2.patch']);
});

const NINE = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'].join('\n') + '\n';

test('AC1.1: overlapping-context edits re-derive onto the earlier patch', (t) => {
  const fx = gitFixture(t, NINE);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const before = checkStack({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(before.targetConflict.conflictsWith, 'review-1.patch');
  const r = rederive({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.patch.toString().startsWith(PREAMBLE));
  assert.match(r.patch.toString(), /^\+L5$/m);
  assert.match(r.patch.toString(), /^ L2$/m);
});

test('re-derived patch passes the stacked check', (t) => {
  const fx = gitFixture(t, NINE);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const r = rederive({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(r.ok, true, r.reason);
  fs.writeFileSync(r2, r.patch);
  const check = checkStack({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(check.ok, true);
  assert.deepEqual(check.conflicts, []);
});

test('AC1.1: same-anchor insertions are not re-derived', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  const r = rederive({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /conflict/);
});

test('create-mode patch is not re-derived', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const creator = gitFixture(t);
  fs.writeFileSync(path.join(creator.dir, 'g.txt'), 'new\n');
  creator.runOk('add', '-N', 'g.txt');
  const d = creator.git('diff');
  assert.equal(d.status, 0, d.stderr);
  const p = stage(dir, 'create.patch', d.stdout);
  const r = rederive({ worktree: fx.dir, patches: [p], target: p });
  assert.deepEqual(r, { ok: false, reason: 'non-modification hunk' });
});

test('the emitted patch keeps a/ b/ prefixes under a user config that drops them', (t) => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-check-cfg-'));
  t.after(() => fs.rmSync(cfgDir, { recursive: true, force: true }));
  const cfg = path.join(cfgDir, 'gitconfig');
  fs.writeFileSync(cfg, '[diff]\n\tnoprefix = true\n\tmnemonicPrefix = true\n');
  const priorCfg = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = cfg;
  t.after(() => {
    if (priorCfg === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = priorCfg;
  });
  const fx = gitFixture(t, NINE);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const r = rederive({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.patch.includes('diff --git a/f.txt b/f.txt\n'), r.patch.toString());
  assert.ok(r.patch.includes('+++ b/f.txt\n'), r.patch.toString());
});

test('a content-and-mode change is not re-derived', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const modder = gitFixture(t);
  modder.runOk('config', 'core.fileMode', 'true');
  fs.writeFileSync(path.join(modder.dir, 'f.txt'), BASE.replace('l1\n', 'l1-edit\n'));
  fs.chmodSync(path.join(modder.dir, 'f.txt'), 0o755); // root-safe: makes a mode-change diff for git to capture, not a permission simulation
  const d = modder.git('diff');
  assert.equal(d.status, 0, d.stderr);
  const p = stage(dir, 'mode.patch', d.stdout);
  const r = rederive({ worktree: fx.dir, patches: [p], target: p });
  assert.deepEqual(r, { ok: false, reason: 'non-modification hunk' });
});

// A fixture whose f.txt ends in a Latin-1 line (`caf\xe9`) — bytes that are not valid UTF-8. The
// diff is captured as a Buffer, so no byte is ever decoded on the way to a staged file.
const LATIN1_BASE = Buffer.concat([Buffer.from(NINE), Buffer.from('caf\xe9\n', 'latin1')]);

function captureBytesDiff(t, base, from, to) {
  const fx = gitFixture(t, base);
  fs.writeFileSync(path.join(fx.dir, 'f.txt'), Buffer.from(base.toString('latin1').replace(`${from}\n`, `${to}\n`), 'latin1'));
  const d = spawnSync('git', ['diff'], { cwd: fx.dir, env: FIXTURE_ENV, timeout: FIXTURE_TIMEOUT_MS });
  assert.equal(d.status, 0, String(d.stderr));
  return d.stdout;
}

function stageBytes(dir, name, diff) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(PREAMBLE), diff]));
  return file;
}

test('M3: a Latin-1 file re-derives byte-safely — applies on the stacked state and touches only the edited line', (t) => {
  const fx = gitFixture(t, LATIN1_BASE);
  const dir = stagedDir(t);
  const r1 = stageBytes(dir, 'review-1.patch', captureBytesDiff(t, LATIN1_BASE, 'l4', 'L4'));
  const r2 = stageBytes(dir, 'review-2.patch', captureBytesDiff(t, LATIN1_BASE, 'l7', 'L7'));
  assert.equal(checkStack({ worktree: fx.dir, patches: [r1, r2], target: r2 }).targetConflict.conflictsWith, 'review-1.patch');
  const r = rederive({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(r.ok, true, r.reason);
  assert.ok(Buffer.isBuffer(r.patch));
  assert.ok(r.patch.includes(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])), 'the Latin-1 context line keeps its raw byte');
  assert.equal(r.patch.includes(Buffer.from([0xef, 0xbf, 0xbd])), false, 'no U+FFFD replacement bytes');
  const changed = r.patch.toString('latin1').split('\n').filter((l) => /^[+-](?![+-]{2} )/.test(l));
  assert.deepEqual(changed, ['-l7', '+L7']);
  fs.writeFileSync(r2, r.patch);
  assert.equal(checkStack({ worktree: fx.dir, patches: [r1, r2], target: r2 }).ok, true);
});

test('T2: a failing final git diff is reported, not read as already satisfied', (t) => {
  const fx = gitFixture(t, NINE);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const git = gitIntercepting((args) => (args[0] === 'diff' ? { status: 129, stdout: '', stderr: 'fatal: boom\n' } : null));
  assert.deepEqual(rederive({ worktree: fx.dir, patches: [r1, r2], target: r2, git }), { ok: false, reason: 'git diff failed: fatal: boom' });
});

test('M3: a re-derived diff that does not apply on the stacked state is refused, not returned', (t) => {
  const fx = gitFixture(t, NINE);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  // Only the verification copy (same basename, outside staged/) fails its apply check.
  const git = gitIntercepting((args) => (args[0] === 'apply' && args[1] === '--check' && args[2] !== r2 && path.basename(args[2]) === 'review-2.patch'
    ? { status: 1, stdout: '', stderr: `error: patch failed: ${args[2]}\n` } : null));
  const r = rederive({ worktree: fx.dir, patches: [r1, r2], target: r2, git });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^re-derived diff failed verification: error: patch failed: review-2\.patch/);
});

test('M4: stagedApplyOrder drops dotfiles and equals the .patch subsequence of the dotfile-filtered sort', () => {
  const names = ['review-2.patch', '.hidden.patch', 'x.md', 'review-10.patch', '.review-0.patch', 'review-2.patch.shadow-dup'];
  const expected = names.filter((n) => !n.startsWith('.')).sort().filter((n) => n.endsWith('.patch'));
  assert.deepEqual(stagedApplyOrder(names), expected);
  assert.deepEqual(stagedApplyOrder(names), ['review-10.patch', 'review-2.patch']);
});

test('I1: stackVerdicts — a re-derived dependent pair is ok at both positions', (t) => {
  const fx = gitFixture(t, NINE);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  assert.equal(stackVerdicts({ worktree: fx.dir, patches: [r1, r2] })['review-2.patch'].ok, false);
  const re = rederive({ worktree: fx.dir, patches: [r1, r2], target: r2 });
  assert.equal(re.ok, true, re.reason);
  fs.writeFileSync(r2, re.patch);
  assert.deepEqual(stackVerdicts({ worktree: fx.dir, patches: [r1, r2] }), { 'review-1.patch': { ok: true }, 'review-2.patch': { ok: true } });
});

test('I1: stackVerdicts — a same-anchor pair is ok for the first and not the second, with the walk error', (t) => {
  const fx = gitFixture(t);
  const dir = stagedDir(t);
  const r1 = stage(dir, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  const r2 = stage(dir, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  const v = stackVerdicts({ worktree: fx.dir, patches: [r1, r2] });
  assert.deepEqual(v['review-1.patch'], { ok: true });
  assert.equal(v['review-2.patch'].ok, false);
  assert.match(v['review-2.patch'].error, /patch failed|does not apply/);
  assert.equal(v['review-2.patch'].error.includes(dir), false, 'basenames only');
});

test('#3696 AC1.1: gitEnv on win32 uses /dev/null, never the \\\\.\\nul device path', () => {
  const env = gitEnv({ platform: 'win32', devNull: '\\\\.\\nul', env: {} });
  assert.strictEqual(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.ok(!String(env.GIT_CONFIG_GLOBAL).includes('\\\\.\\nul'));
});

test('#3696 AC1.2: gitEnv on linux uses the platform devNull', () => {
  const env = gitEnv({ platform: 'linux', devNull: '/dev/null', env: {} });
  assert.strictEqual(env.GIT_CONFIG_GLOBAL, '/dev/null');
});

test('#3696: gitEnv keeps NOSYSTEM, drops repo pointers, and never mutates the input env', () => {
  const input = { PATH: '/bin', GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/i' };
  const env = gitEnv({ platform: 'linux', devNull: '/dev/null', env: input });
  assert.strictEqual(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.strictEqual(env.PATH, '/bin');
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) assert.ok(!(k in env), k);
  assert.deepStrictEqual(input, { PATH: '/bin', GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/i' });
});
