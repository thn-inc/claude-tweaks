'use strict';
// plugin/bin/archive-tracked-shells.js — enumeration, dry run, environment refusal and the
// local-branch (--no-pr) path (#3975). The CLI runs in-process through runCliSync with real git
// against a bare `origin`; `gh` is a recording fake that must stay untouched on these paths.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { cleanGitEnv, fixtureGit } = require('./helpers/git-fixtures');
const { runCliSync } = require('./helpers/run-cli');
const { compareWorkTwin } = require('../plugin/bin/lib/reconcile/archive-merged');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'archive-tracked-shells.js');
const { findShells, realDeps, BRANCH } = require(CLI);
const REPO_GITIGNORE = path.join(__dirname, '..', '.gitignore');
const IDENTITY = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
};
const ENV = { ...cleanGitEnv(), ...IDENTITY };

function git(cwd, ...args) {
  return fixtureGit(args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let seq = 0;

// A bare `origin` and a clone of it as the main checkout, with this repo's .gitignore (so the
// archive paths behave as in production), an initial commit pushed to origin/main.
function makeFixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ats-')));
  const origin = path.join(base, 'origin.git');
  const root = path.join(base, 'main');
  fixtureGit(['init', '-q', '--bare', '-b', 'main', origin], { env: ENV });
  fixtureGit(['clone', '-q', origin, root], { env: ENV });
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'checkout', '-q', '-B', 'main');
  fs.writeFileSync(path.join(root, '.gitignore'), readText(REPO_GITIGNORE));
  fs.writeFileSync(path.join(root, 'README.md'), 'seed\n');
  git(root, 'add', '.gitignore', 'README.md');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'push', '-q', '-u', 'origin', 'main');
  return { base, origin, root };
}

function pipelines(root) { return path.join(root, '.claude-tweaks', 'pipelines'); }

// twin: 'identical' | 'absent' | 'differs'. Commits the live work/{n}-spec.md (and the archive
// twin's work/ unless 'absent'), pushes, and writes the gitignored archive run-state.
function addShell(root, id, { twin = 'identical', clean = true, push = true } = {}) {
  seq += 1;
  const n = 9000 + seq;
  const file = `${n}-spec.md`;
  const live = path.join(pipelines(root), id, 'work');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, file), `spec ${n}\n`);
  const add = [path.join('.claude-tweaks', 'pipelines', id, 'work', file)];
  const twinWork = path.join(pipelines(root), 'archive', id, 'work');
  if (twin !== 'absent') {
    fs.mkdirSync(twinWork, { recursive: true });
    fs.writeFileSync(path.join(twinWork, file), twin === 'differs' ? `other ${n}\n` : `spec ${n}\n`);
    add.push(path.join('.claude-tweaks', 'pipelines', 'archive', id, 'work', file));
  }
  git(root, 'add', '--', ...add);
  git(root, 'commit', '-q', '-m', `shell ${id}`);
  if (push) git(root, 'push', '-q', 'origin', 'main');
  if (clean) {
    fs.mkdirSync(path.join(pipelines(root), 'archive', id), { recursive: true });
    fs.writeFileSync(path.join(pipelines(root), 'archive', id, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  }
  return { id, file, live, twinWork };
}

function call(root, argv, { model = 'pr-first', ghOk = true, branch = 'main', extra = {} } = {}) {
  const ghCalls = [];
  const res = runCliSync(CLI, argv, {
    cwd: root,
    env: ENV,
    deps: {
      ...extra,
      gh: (args) => { ghCalls.push(args); throw new Error(`unexpected gh ${args.join(' ')}`); },
      ghAvailable: () => ghOk,
      policy: () => ({ 'integration-model': model, 'integration-branch': branch, 'housekeeping-auto-merge': 'false' }),
    },
  });
  let envelope = null;
  try { envelope = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* refusal paths print none */ }
  return { ...res, envelope, ghCalls };
}

const worktreeDir = (root) => path.join(root, '.worktrees', 'archive-tracked-shells');
const branches = (root) => git(root, 'branch', '--list', 'housekeeping/*');

test('findShells: clean-twin work-only dir is a shell; twin-less one is untwinned; untracked work-only dir is ignored; dir with run-state.json is ignored', () => {
  const { root } = makeFixture();
  const a = addShell(root, '2026-11-01T000000-record-1');
  const b = addShell(root, '2026-11-01T000001-record-2', { clean: false });
  const untracked = path.join(pipelines(root), '2026-11-01T000002-record-3', 'work');
  fs.mkdirSync(untracked, { recursive: true });
  fs.writeFileSync(path.join(untracked, '1-spec.md'), 'x\n');
  const c = addShell(root, '2026-11-01T000003-record-4');
  fs.writeFileSync(path.join(pipelines(root), c.id, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const out = findShells(root, realDeps);
  assert.deepEqual(out.shells.map((s) => s.runId), [a.id]);
  assert.deepEqual(out.shells.map((s) => s.dir), [path.join(pipelines(root), a.id)]);
  assert.deepEqual(out.untwinned, [b.id]);
});

test('AC7.1: --dry-run makes no change and opens no PR', () => {
  const { root } = makeFixture();
  const moved = addShell(root, '2026-11-02T000000-record-1', { twin: 'absent' });
  const del = addShell(root, '2026-11-02T000001-record-2', { twin: 'identical' });
  const bad = addShell(root, '2026-11-02T000002-record-3', { twin: 'differs' });
  const head = git(root, 'rev-parse', 'HEAD');
  for (const model of ['pr-first', 'local-merge']) {
    const r = call(root, ['--root', root, '--dry-run'], { model });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.envelope.dryRun, true);
    assert.deepEqual(r.envelope.moved.map((m) => m.runId), [moved.id]);
    assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [del.id]);
    const expected = compareWorkTwin(root, bad.live, bad.twinWork, ENV).differing;
    assert.deepEqual(expected, [bad.file]);
    assert.deepEqual(r.envelope.conflicts, [{ runId: bad.id, reason: 'work-twin-conflict', differing: expected }]);
    assert.equal(r.envelope.pr, null);
    assert.equal(r.envelope.branch, null);
    assert.deepEqual(r.ghCalls, []);
    assert.equal(git(root, 'rev-parse', 'HEAD'), head);
    assert.equal(branches(root), '');
    assert.equal(fs.existsSync(worktreeDir(root)), false);
  }
});

test('AC7.2: local-merge without --no-pr refuses with exit 2 naming --no-pr', () => {
  const { root } = makeFixture();
  addShell(root, '2026-11-03T000000-record-1');
  const r = call(root, ['--root', root], { model: 'local-merge' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--no-pr/);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.equal(branches(root), '');
});

test('AC7.3: gh absent without --no-pr refuses with exit 2 naming --no-pr', () => {
  const { root } = makeFixture();
  addShell(root, '2026-11-03T000001-record-1');
  const r = call(root, ['--root', root], { model: 'pr-first', ghOk: false });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--no-pr/);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.equal(branches(root), '');
});

test('AC7.4: --no-pr makes the branch and commits locally, pushes nothing, prints the branch name', () => {
  const { root } = makeFixture();
  const a = addShell(root, '2026-11-04T000000-record-1', { twin: 'absent' });
  const b = addShell(root, '2026-11-04T000001-record-2', { twin: 'identical' });
  const head = git(root, 'rev-parse', 'HEAD');
  const r = call(root, ['--root', root, '--no-pr'], { model: 'local-merge' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.envelope.branch, BRANCH);
  assert.equal(BRANCH, 'housekeeping/archive-tracked-shells');
  assert.equal(r.envelope.pr, null);
  const subjects = git(root, 'log', `main..${BRANCH}`, '--format=%s').split('\n').sort();
  assert.deepEqual(subjects, [`[reconcile] archive run ${a.id}`, `[reconcile] archive run ${b.id}`].sort());
  assert.equal(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), '');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'branch', '--show-current'), 'main');
  assert.doesNotMatch(git(root, 'worktree', 'list'), /archive-tracked-shells/);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.deepEqual(r.ghCalls, []);
});

test('AC4.1: identical twin -> deleted, absent twin -> moved', () => {
  const { root } = makeFixture();
  const absent = addShell(root, '2026-11-05T000000-record-1', { twin: 'absent' });
  const same = addShell(root, '2026-11-05T000001-record-2', { twin: 'identical' });
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.envelope.moved.map((m) => m.runId), [absent.id]);
  assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [same.id]);
  assert.ok(r.envelope.moved[0].commit && r.envelope.deleted[0].commit);
  const tree = git(root, 'ls-tree', '-r', '--name-only', BRANCH).split('\n');
  for (const s of [absent, same]) {
    assert.ok(!tree.some((p) => p.startsWith(`.claude-tweaks/pipelines/${s.id}/work/`)), `live work left for ${s.id}`);
    assert.ok(tree.includes(`.claude-tweaks/pipelines/archive/${s.id}/work/${s.file}`), `no archived work for ${s.id}`);
  }
});

test('AC4.2: differing twin is left in place, named with its differing path, exit 1', () => {
  const { root } = makeFixture();
  const good = addShell(root, '2026-11-06T000000-record-1', { twin: 'identical' });
  const bad = addShell(root, '2026-11-06T000001-record-2', { twin: 'differs' });
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.envelope.conflicts, [{ runId: bad.id, reason: 'work-twin-conflict', differing: [bad.file] }]);
  assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [good.id]);
  const tree = git(root, 'ls-tree', '-r', '--name-only', BRANCH).split('\n');
  assert.ok(tree.includes(`.claude-tweaks/pipelines/${bad.id}/work/${bad.file}`));
});

test('unknown flag exits 2 with usage and prints no envelope', () => {
  const { root } = makeFixture();
  const r = call(root, ['--root', root, '--bogus']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage/i);
  assert.equal(r.stdout, '');
});

test('nothing to archive exits 0 without creating a branch or worktree', () => {
  const { root } = makeFixture();
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.envelope.moved, []);
  assert.equal(r.envelope.branch, null);
  assert.equal(branches(root), '');
});

test('a kept local branch is brought up to the integration branch: a later shell is archived, an earlier one is not redone', () => {
  const { root } = makeFixture();
  const a = addShell(root, '2026-11-07T000000-record-1', { twin: 'identical' });
  const first = call(root, ['--root', root, '--no-pr']);
  assert.equal(first.code, 0, first.stderr);
  const b = addShell(root, '2026-11-07T000001-record-2', { twin: 'absent' });
  const second = call(root, ['--root', root, '--no-pr']);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(second.envelope.moved.map((m) => m.runId), [b.id]);
  assert.deepEqual(second.envelope.deleted, []);
  assert.deepEqual(second.envelope.conflicts, []);
  assert.ok(second.envelope.notes.some((n) => n.startsWith(`${a.id}: already archived`)));
  const tree = git(root, 'ls-tree', '-r', '--name-only', BRANCH).split('\n');
  assert.ok(tree.includes(`.claude-tweaks/pipelines/archive/${b.id}/work/${b.file}`));
  assert.ok(tree.includes(`.claude-tweaks/pipelines/archive/${a.id}/work/${a.file}`));
  assert.ok(!tree.some((p) => p.startsWith(`.claude-tweaks/pipelines/${a.id}/work/`)));
  assert.ok(!tree.some((p) => p.startsWith(`.claude-tweaks/pipelines/${b.id}/work/`)));
});

test('a shell absent from the scratch tree with no archived work is reported not-on-branch, exit 1', () => {
  const { root } = makeFixture();
  const local = addShell(root, '2026-11-08T000000-record-1', { twin: 'absent', push: false });
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.envelope.conflicts, [{ runId: local.id, reason: 'not-on-branch', differing: [] }]);
  assert.deepEqual(r.envelope.notes, []);
});

test('an exception after the scratch worktree exists exits 2 with a message and leaves no scratch worktree', () => {
  const { root } = makeFixture();
  addShell(root, '2026-11-09T000000-record-1');
  const throwing = (args, o) => {
    if (args.includes('status')) throw new Error('injected git failure');
    return realDeps.git(args, o);
  };
  const r = call(root, ['--root', root, '--no-pr'], { extra: { git: throwing } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /injected git failure/);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /archive-tracked-shells/);
});

test('a stale unregistered directory at the scratch path is replaced', () => {
  const { root } = makeFixture();
  const s = addShell(root, '2026-11-10T000000-record-1');
  fs.mkdirSync(worktreeDir(root), { recursive: true });
  fs.writeFileSync(path.join(worktreeDir(root), 'stale.txt'), 'x\n');
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [s.id]);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
});

test('a stale locked registered worktree at the scratch path is replaced', () => {
  const { root } = makeFixture();
  const s = addShell(root, '2026-11-10T000001-record-1');
  git(root, 'worktree', 'add', '-q', '-b', 'stale-scratch', worktreeDir(root), 'main');
  git(root, 'worktree', 'lock', worktreeDir(root));
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [s.id]);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /archive-tracked-shells/);
});
