// tests/bin-lib/staged-patch/cli.test.js — #3290's check-staged-stack CLI: exit vocabulary, stdout
// JSON, stderr attribution, --rederive-out, and run-dir anchoring. Every patch is a real `git diff`
// captured in a throwaway fixture repo — never hand-typed hunks.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FIXTURE_TIMEOUT_MS } = require('../../helpers/git-fixtures');
const { run } = require('../../../plugin/bin/check-staged-stack');
const { gitEnv } = require('../../../plugin/bin/lib/staged-patch/stack-check');
const { readText } = require('../../helpers/read-skill');

const FIXTURE_ENV = gitEnv();
const BASE = ['l1', 'l2', 'l3', 'l4', 'anchor', 'a1', 'a2', 'a3'].join('\n') + '\n';
const NINE = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'].join('\n') + '\n';
const PREAMBLE = 'Target: f.txt\nInvariant: x\n\n';

function gitRepo(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicli-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runOk = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: FIXTURE_ENV });
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  runOk('init', '-q');
  runOk('config', 'user.email', 'stack-check@example.invalid');
  runOk('config', 'user.name', 'stack-check');
  fs.writeFileSync(path.join(dir, 'f.txt'), content);
  runOk('add', 'f.txt');
  runOk('commit', '-q', '-m', 'base');
  return dir;
}

// Edit f.txt in a fresh fixture whose HEAD is `base`, then capture `git diff`.
function captureDiff(t, base, edit) {
  const dir = gitRepo(t, base);
  fs.writeFileSync(path.join(dir, 'f.txt'), edit(base));
  const d = spawnSync('git', ['diff'], { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: FIXTURE_ENV });
  assert.equal(d.status, 0, d.stderr);
  return d.stdout;
}

const insertAboveAnchor = (tag) => (text) => text.replace('anchor\n', `${tag}a\n${tag}b\nanchor\n`);
const editLine = (from, to) => (text) => text.replace(`${from}\n`, `${to}\n`);

// A main checkout (`.git` dir), its run dir, and a worktree-shadow copy of that run dir under a
// linked worktree (`.git` file) — the shadow is what resolveTarget must refuse.
function fixture(t, content = BASE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-19T000000-spec-3290');
  const staged = path.join(runDir, 'staged');
  fs.mkdirSync(staged, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  const shadowWt = path.join(main, '.claude', 'worktrees', 'flow-spec-3290');
  const shadow = path.join(shadowWt, '.claude-tweaks', 'pipelines', '2026-10-19T000000-spec-3290');
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(shadowWt, '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-3290\n');
  return { main, runDir, staged, shadow, worktree: gitRepo(t, content) };
}

function stage(dir, name, diff) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, PREAMBLE + diff);
  return file;
}

function fakeDeps(cwd, extra = {}) {
  const out = []; const err = [];
  return {
    deps: {
      cwd: () => cwd,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      writeFile: (p, data) => fs.writeFileSync(p, data),
      ...extra,
    },
    out, err,
  };
}

test('AC1.1: a conflict involving --patch exits 1, names both staged paths on stderr, and prints JSON', (t) => {
  const fx = fixture(t);
  stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  const { deps, out, err } = fakeDeps(fx.main);
  const code = run(['--worktree', fx.worktree, '--patch', r2], deps);
  assert.equal(code, 1);
  const stderr = err.join('');
  assert.match(stderr, /staged\/review-2\.patch/);
  assert.match(stderr, /staged\/review-1\.patch/);
  assert.equal(stderr.split('\n').filter((l) => l !== '').length, 1);
  const json = JSON.parse(out.join(''));
  assert.equal(json.ok, false);
  assert.equal(json.targetConflict.patch, 'review-2.patch');
  assert.equal(json.targetConflict.conflictsWith, 'review-1.patch');
  assert.equal(json.rederived, null);
  assert.equal(json.rederiveReason, null);
});

test('AC2.1: a single patch exits 0 with nothing on stderr', (t) => {
  const fx = fixture(t);
  const r1 = stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const { deps, out, err } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r1], deps), 0);
  assert.equal(err.join(''), '');
  assert.equal(JSON.parse(out.join('')).ok, true);
});

test('AC2.1: a clean stack exits 0 with nothing on stderr', (t) => {
  const fx = fixture(t);
  stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, BASE, editLine('a3', 'a3-edit')));
  const { deps, out, err } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2], deps), 0);
  assert.equal(err.join(''), '');
  const json = JSON.parse(out.join(''));
  assert.equal(json.ok, true);
  assert.deepEqual(json.order, ['review-1.patch', 'review-2.patch']);
});

test('--rederive-out writes the re-derived patch and reports its path in the JSON', (t) => {
  const fx = fixture(t, NINE);
  stage(fx.staged, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const outPath = path.join(fx.main, 'rederived-review-2.patch');
  const { deps, out } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2, '--rederive-out', outPath], deps), 1);
  assert.ok(fs.existsSync(outPath));
  assert.ok(fs.readFileSync(outPath, 'utf8').startsWith(PREAMBLE));
  const json = JSON.parse(out.join(''));
  assert.equal(json.rederived, outPath);
  assert.equal(json.rederiveReason, null);
});

test('--rederive-out whose write fails keeps exit 1 and reports the write failure', (t) => {
  const fx = fixture(t, NINE);
  stage(fx.staged, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const { deps, out } = fakeDeps(fx.main, {
    writeFile: () => { throw new Error('disk full'); },
  });
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2, '--rederive-out', path.join(fx.main, 'x.patch')], deps), 1);
  const json = JSON.parse(out.join(''));
  assert.equal(json.rederived, null);
  assert.equal(json.rederiveReason, 'could not write: disk full');
});

test('--patch outside a staged/ dir is malformed (exit 2)', (t) => {
  const fx = fixture(t);
  const loose = stage(fx.runDir, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const { deps, out } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', loose], deps), 2);
  assert.equal(out.join(''), '');
});

test('a --patch that does not end in .patch is malformed (exit 2)', (t) => {
  const fx = fixture(t);
  const md = stage(fx.staged, 'review-1.md', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const { deps } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', md], deps), 2);
});

test('missing --worktree is malformed (exit 2)', (t) => {
  const fx = fixture(t);
  const r1 = stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const { deps } = fakeDeps(fx.main);
  assert.equal(run(['--patch', r1], deps), 2);
});

test('a trailing bare --patch with no value is malformed (exit 2)', (t) => {
  const fx = fixture(t);
  const { deps } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch'], deps), 2);
});

test('--help prints usage and exits 0', (t) => {
  const fx = fixture(t);
  const { deps, out, err } = fakeDeps(fx.main);
  assert.equal(run(['--help'], deps), 0);
  assert.match(out.join(''), /usage: check-staged-stack\.js/);
  assert.equal(err.join(''), '');
});

test('AC1.1: a --patch under a worktree-shadow run dir is refused (exit 3) and writes neither JSON nor the rederive file', (t) => {
  const fx = fixture(t, NINE);
  const shadowStaged = path.join(fx.shadow, 'staged');
  stage(shadowStaged, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const shadowPatch = stage(shadowStaged, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const rederived = path.join(fx.shadow, 'rederived.patch');
  const { deps, out } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', shadowPatch, '--rederive-out', rederived], deps), 3);
  assert.equal(out.join(''), '');
  assert.equal(fs.existsSync(rederived), false);
});

test('a --patch that does not apply at its position nor alone exits 2', (t) => {
  const fx = fixture(t);
  const mid = BASE.replace('a3\n', 'a3-mid\n');
  stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const r3 = stage(fx.staged, 'review-3.patch', captureDiff(t, mid, editLine('a3-mid', 'a3-new')));
  const { deps, out, err } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r3], deps), 2);
  const json = JSON.parse(out.join(''));
  assert.equal(json.ok, false);
  assert.deepEqual(json.skipped.map((s) => s.patch), ['review-3.patch']);
  assert.match(err.join(''), /staged\/review-3\.patch/);
});

test('M5: a --patch the staged/ walk never visits (a dotfile) exits 2 with a stderr line, never 0', (t) => {
  const fx = fixture(t);
  stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const hidden = stage(fx.staged, '.hidden.patch', captureDiff(t, BASE, editLine('a3', 'a3-edit')));
  const { deps, out, err } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', hidden], deps), 2);
  assert.equal(out.join(''), '');
  assert.match(err.join(''), /\.hidden\.patch/);
  assert.match(err.join(''), /not among staged\/'s walked/);
});

test('T3: --rederive-out resolving inside the run\'s staged/ dir exits 2 and writes nothing', (t) => {
  const fx = fixture(t, NINE);
  stage(fx.staged, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const inside = path.join(fx.staged, 'review-2-rederived.patch');
  const { deps, out, err } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2, '--rederive-out', inside], deps), 2);
  assert.equal(out.join(''), '');
  assert.match(err.join(''), /--rederive-out must not resolve inside/);
  assert.equal(fs.existsSync(inside), false);
  // A relative path that climbs out of staged/ is outside, and still allowed.
  const outside = path.join(fx.runDir, 'review-2-rederived.patch');
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2, '--rederive-out', path.relative(fx.main, outside)], fakeDeps(fx.main).deps), 1);
  assert.ok(fs.existsSync(outside));
});

test('a check that cannot run (git did not complete) maps to exit 4 with the error on stderr', (t) => {
  const fx = fixture(t);
  const r1 = stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const { deps, out, err } = fakeDeps(fx.main, {
    git: () => ({ status: null, stdout: '', stderr: '' }),
  });
  assert.equal(run(['--worktree', fx.worktree, '--patch', r1], deps), 4);
  assert.equal(out.join(''), '');
  assert.match(err.join(''), /did not complete/);
});

test('AC1.1: the exit-1 stderr line names every conflict that involves --patch', (t) => {
  const fx = fixture(t);
  const r1 = stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  stage(fx.staged, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  stage(fx.staged, 'review-3.patch', captureDiff(t, BASE, insertAboveAnchor('new3')));
  const { deps, out, err } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r1], deps), 1);
  // One exact line: the `; ` join and the walk order, built from the JSON's own conflict errors.
  const [e2, e3] = JSON.parse(out.join('')).conflicts.map((c) => c.error);
  assert.equal(err.join(''), `check-staged-stack.js: staged/review-2.patch does not apply on top of staged/review-1.patch in apply order (${e2}); staged/review-3.patch does not apply on top of staged/review-1.patch in apply order (${e3})\n`);
});

test('AC1.1: the exit-1 stderr line is filtered to the conflicts that involve --patch', (t) => {
  const fx = fixture(t);
  stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  stage(fx.staged, 'review-3.patch', captureDiff(t, BASE, insertAboveAnchor('new3')));
  const { deps, err } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2], deps), 1);
  const stderr = err.join('');
  assert.match(stderr, /staged\/review-2\.patch does not apply on top of staged\/review-1\.patch/);
  // review-3 conflicts with review-1 and does not involve review-2.
  assert.doesNotMatch(stderr, /staged\/review-3\.patch/);
});

test('AC1.1: rederive refusal lands in rederiveReason and keeps exit 1', (t) => {
  const fx = fixture(t);
  stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  const outPath = path.join(fx.main, 'x.patch');
  const { deps, out } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2, '--rederive-out', outPath], deps), 1);
  const json = JSON.parse(out.join(''));
  assert.equal(json.rederived, null);
  assert.equal(json.rederiveReason, 'conflict in f.txt');
  assert.equal(fs.existsSync(outPath), false);
});

test('AC1.1: a rederive that throws lands in rederiveReason as could not run', (t) => {
  const fx = fixture(t, NINE);
  stage(fx.staged, 'review-1.patch', captureDiff(t, NINE, editLine('l2', 'L2')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, NINE, editLine('l5', 'L5')));
  const outPath = path.join(fx.main, 'x.patch');
  // Real git for every call except merge-file, which reports it never completed.
  const git = (args, { cwd, binary = false }) => {
    if (args[0] === 'merge-file') return { status: null, stdout: '', stderr: '' };
    const r = spawnSync('git', args, { cwd, encoding: binary ? 'buffer' : 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: FIXTURE_ENV });
    return { status: r.status, stdout: r.stdout || (binary ? Buffer.alloc(0) : ''), stderr: r.stderr ? r.stderr.toString() : '' };
  };
  const { deps, out } = fakeDeps(fx.main, { git });
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2, '--rederive-out', outPath], deps), 1);
  const json = JSON.parse(out.join(''));
  assert.equal(json.rederived, null);
  assert.match(json.rederiveReason, /^could not run: git merge-file .* did not complete/);
  assert.equal(fs.existsSync(outPath), false);
});

test('AC1.1: --rederive-out on a non-conflicting --patch writes nothing and reports no reason', (t) => {
  const fx = fixture(t);
  stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, editLine('l1', 'l1-edit')));
  const r2 = stage(fx.staged, 'review-2.patch', captureDiff(t, BASE, editLine('a3', 'a3-edit')));
  const outPath = path.join(fx.main, 'x.patch');
  const { deps, out } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r2, '--rederive-out', outPath], deps), 0);
  const json = JSON.parse(out.join(''));
  assert.equal(json.rederived, null);
  assert.equal(json.rederiveReason, null);
  assert.equal(fs.existsSync(outPath), false);
});

test('AC1.1: when --patch is the earlier side of the conflict no rederive is attempted', (t) => {
  const fx = fixture(t);
  const r1 = stage(fx.staged, 'review-1.patch', captureDiff(t, BASE, insertAboveAnchor('new1')));
  stage(fx.staged, 'review-2.patch', captureDiff(t, BASE, insertAboveAnchor('new2')));
  const outPath = path.join(fx.main, 'x.patch');
  const { deps, out } = fakeDeps(fx.main);
  assert.equal(run(['--worktree', fx.worktree, '--patch', r1, '--rederive-out', outPath], deps), 1);
  const json = JSON.parse(out.join(''));
  assert.equal(json.targetConflict.conflictsWith, 'review-1.patch');
  assert.equal(json.rederived, null);
  assert.equal(json.rederiveReason, null);
  assert.equal(fs.existsSync(outPath), false);
});

test('AC1.1: docs/plugin-structure.md states exit 2 still prints the JSON line and the git 2.32 floor', () => {
  const doc = readText(path.join(__dirname, '..', '..', '..', 'docs', 'plugin-structure.md')).split('\n');
  const cli = doc.find((l) => l.includes('node plugin/bin/check-staged-stack.js'));
  assert.ok(cli, 'plugin-structure.md lists the CLI');
  assert.match(cli, /exit 2 [^,]*still prints the JSON line/);
  const lib = doc.find((l) => l.startsWith('plugin/bin/lib/staged-patch/'));
  assert.ok(lib, 'plugin-structure.md lists the lib dir');
  assert.ok(lib.includes('git >= 2.32'));
});
