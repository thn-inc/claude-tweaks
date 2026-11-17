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
const { fromTemplate, disableReceiveAutoGc } = require('./helpers/git-template');
const { runCliSync } = require('./helpers/run-cli');
const { compareWorkTwin } = require('../plugin/bin/lib/reconcile/archive-merged');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'archive-tracked-shells.js');
const { findShells, realDeps, prBody, BRANCH } = require(CLI);
const REPO_GITIGNORE = path.join(__dirname, '..', '.gitignore');
const IDENTITY = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
};
const ENV = { ...cleanGitEnv(), ...IDENTITY };

function git(cwd, ...args) {
  return fixtureGit(args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Runs fn with git's trace2 event output pointed at `dir` for git started through process.env or
// through the module's ENV: every git process writes one file there. Both are restored after.
function traced(dir, fn) {
  const key = 'GIT_TRACE2_EVENT';
  const saved = [process.env, ENV].map((env) => [env, env[key]]);
  process.env[key] = dir;
  ENV[key] = dir;
  try {
    return fn();
  } finally {
    for (const [env, v] of saved) {
      if (v === undefined) delete env[key]; else env[key] = v;
    }
  }
}

// Read when called: a template build runs with auto-maintenance off in process.env, which the
// module-level ENV (read at load) does not carry.
const fixtureEnv = () => ({ ...cleanGitEnv(), ...IDENTITY });

// The template builders' git runner: git in `cwd` under `env`, output untrimmed.
const runnerFor = (env) => (cwd, ...args) => fixtureGit(args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let seq = 0;

// The addShell option objects a seeded fixture takes (IDENTICAL: the default twin).
const ABSENT = { twin: 'absent' };
const IDENTICAL = {};

const shellId = (i) => `2026-10-01T00000${i}-record-${i + 1}`;
const shellNumber = (i) => 8001 + i;

// A bare `origin` and a clone of it as the main checkout, with this repo's .gitignore (so the
// archive paths behave as in production), an initial commit pushed to origin/main. Built once per
// process; every call gets a copy. `shells` is an ordered list of addShell options seeded after the
// seed push, one template per distinct list: shell i has id 2026-10-01T00000{i}-record-{i + 1} and
// file number 8001 + i. The returned descriptors point into the copy.
function makeFixture(shells = []) {
  const norm = shells.map(({ twin = 'identical', clean = true, push = true }) => [twin, clean, push]);
  const base = fromTemplate(`ats:fixture:${JSON.stringify(norm)}`, (dir) => {
    const env = fixtureEnv();
    const origin = path.join(dir, 'origin.git');
    const root = path.join(dir, 'main');
    const run = runnerFor(env);
    fixtureGit(['init', '-q', '--bare', '-b', 'main', origin], { env });
    disableReceiveAutoGc(origin);
    fixtureGit(['clone', '-q', origin, root], { env });
    run(root, 'config', 'core.autocrlf', 'false');
    run(root, 'checkout', '-q', '-B', 'main');
    fs.writeFileSync(path.join(root, '.gitignore'), readText(REPO_GITIGNORE));
    fs.writeFileSync(path.join(root, 'README.md'), 'seed\n');
    run(root, 'add', '.gitignore', 'README.md');
    run(root, 'commit', '-q', '-m', 'seed');
    run(root, 'push', '-q', '-u', 'origin', 'main');
    norm.forEach(([twin, clean, push], i) => writeShell(run, root, shellId(i), shellNumber(i), { twin, clean, push }));
  }, { prefix: 'ct-ats-', realpath: true });
  const root = path.join(base, 'main');
  const seeded = norm.map((_, i) => {
    const id = shellId(i);
    return { id, file: `${shellNumber(i)}-spec.md`, live: path.join(pipelines(root), id, 'work'), twinWork: path.join(pipelines(root), 'archive', id, 'work') };
  });
  return { base, origin: path.join(base, 'origin.git'), root, shells: seeded };
}

// An empty `git init` repository for the policy test, built once per process.
function policyRepo() {
  return fromTemplate('ats:policy-repo', (dir) => {
    fixtureGit(['init', '-q', dir], { env: fixtureEnv() });
  }, { prefix: 'ct-ats-policy-', realpath: true });
}

function pipelines(root) { return path.join(root, '.claude-tweaks', 'pipelines'); }

// twin: 'identical' | 'absent' | 'differs' | 'differs-same-length'. Commits the live work/{n}-spec.md (and the archive
// twin's work/ unless 'absent'), pushes, and writes the gitignored archive run-state.
function addShell(root, id, opts) {
  seq += 1;
  return writeShell(git, root, id, 9000 + seq, opts);
}

// `run(cwd, ...args)` runs git; `n` numbers the spec file.
function writeShell(run, root, id, n, { twin = 'identical', clean = true, push = true } = {}) {
  const file = `${n}-spec.md`;
  const live = path.join(pipelines(root), id, 'work');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, file), `spec ${n}\n`);
  const add = [path.join('.claude-tweaks', 'pipelines', id, 'work', file)];
  const twinWork = path.join(pipelines(root), 'archive', id, 'work');
  if (twin !== 'absent') {
    fs.mkdirSync(twinWork, { recursive: true });
    fs.writeFileSync(path.join(twinWork, file), twin === 'differs' ? `other ${n}\n` : twin === 'differs-same-length' ? `spac ${n}\n` : `spec ${n}\n`);
    add.push(path.join('.claude-tweaks', 'pipelines', 'archive', id, 'work', file));
  }
  run(root, 'add', '--', ...add);
  run(root, 'commit', '-q', '-m', `shell ${id}`);
  if (push) run(root, 'push', '-q', 'origin', 'main');
  if (clean) {
    fs.mkdirSync(path.join(pipelines(root), 'archive', id), { recursive: true });
    fs.writeFileSync(path.join(pipelines(root), 'archive', id, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  }
  return { id, file, live, twinWork };
}

function call(root, argv, { model = 'pr-first', ghOk = true, branch = 'main', extra = {}, ghFake = null, auto = 'false' } = {}) {
  const ghCalls = [];
  const res = runCliSync(CLI, argv, {
    cwd: root,
    env: ENV,
    deps: {
      ...extra,
      gh: ghFake || ((args) => { ghCalls.push(args); throw new Error(`unexpected gh ${args.join(' ')}`); }),
      ghAvailable: () => ghOk,
      policy: () => ({ 'integration-model': model, 'integration-branch': branch, 'housekeeping-auto-merge': auto }),
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
  const { root } = makeFixture([IDENTICAL]);
  const r = call(root, ['--root', root], { model: 'local-merge' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--no-pr/);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.equal(branches(root), '');
});

test('AC7.3: gh absent without --no-pr refuses with exit 2 naming --no-pr', () => {
  const { root } = makeFixture([IDENTICAL]);
  const r = call(root, ['--root', root], { model: 'pr-first', ghOk: false });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--no-pr/);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.equal(branches(root), '');
});

test('AC7.4: --no-pr makes the branch and commits locally, pushes nothing, prints the branch name', () => {
  const { root, shells: [a, b] } = makeFixture([ABSENT, IDENTICAL]);
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
  const { root, shells: [absent, same] } = makeFixture([ABSENT, IDENTICAL]);
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

test('AC4.2b: a twin whose bytes differ at the same length is left in place, never deleted on a size match', () => {
  const { root } = makeFixture();
  const bad = addShell(root, '2026-11-06T000002-record-3', { twin: 'differs-same-length' });
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.envelope.conflicts, [{ runId: bad.id, reason: 'work-twin-conflict', differing: [bad.file] }]);
  assert.deepEqual(r.envelope.deleted, []);
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
  const { root, shells: [a] } = makeFixture([IDENTICAL]);
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
  const { root } = makeFixture([IDENTICAL]);
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
  const { root, shells: [s] } = makeFixture([IDENTICAL]);
  fs.mkdirSync(worktreeDir(root), { recursive: true });
  fs.writeFileSync(path.join(worktreeDir(root), 'stale.txt'), 'x\n');
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [s.id]);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
});

test('a stale scratch worktree locked by a dead archive-tracked-shells pid is replaced', () => {
  const { root, shells: [s] } = makeFixture([IDENTICAL]);
  git(root, 'worktree', 'add', '-q', '-b', 'stale-scratch', worktreeDir(root), 'main');
  git(root, 'worktree', 'lock', '--reason', 'archive-tracked-shells (pid 424242)', worktreeDir(root));
  const asked = [];
  const r = call(root, ['--root', root, '--no-pr'], { extra: { pidAlive: (pid) => { asked.push(pid); return false; } } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(asked, [424242]);
  assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [s.id]);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /archive-tracked-shells/);
});

test('a scratch worktree locked by a live archive-tracked-shells run refuses with exit 2 and is left untouched', () => {
  const { root } = makeFixture([IDENTICAL]);
  git(root, 'worktree', 'add', '-q', '-b', 'live-scratch', worktreeDir(root), 'main');
  git(root, 'worktree', 'lock', '--reason', 'archive-tracked-shells (pid 424243)', worktreeDir(root));
  fs.writeFileSync(path.join(worktreeDir(root), 'in-flight.txt'), 'x\n');
  const r = call(root, ['--root', root, '--no-pr'], { extra: { pidAlive: (pid) => pid === 424243 } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /another archive-tracked-shells run is in progress \(pid 424243\)/);
  assert.equal(r.stdout, '');
  assert.ok(fs.existsSync(path.join(worktreeDir(root), 'in-flight.txt')), 'the live run\'s worktree is untouched');
  assert.match(git(root, 'worktree', 'list', '--porcelain'), /locked archive-tracked-shells \(pid 424243\)/);
  assert.equal(git(root, 'branch', '--list', BRANCH), '');
});

test('a scratch worktree locked with no pid in its reason refuses with exit 2 naming git worktree unlock', () => {
  const { root } = makeFixture([IDENTICAL]);
  git(root, 'worktree', 'add', '-q', '-b', 'other-scratch', worktreeDir(root), 'main');
  git(root, 'worktree', 'lock', worktreeDir(root));
  const r = call(root, ['--root', root, '--no-pr'], { extra: { pidAlive: () => { throw new Error('no pid to ask about'); } } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /git worktree unlock/);
  assert.ok(fs.existsSync(worktreeDir(root)));
});

test('a run that locks the scratch worktree after this run read the worktree list keeps it: no forced remove, exit 2', () => {
  for (const stale of [false, true]) {
    const { root } = makeFixture([IDENTICAL]);
    if (stale) {
      fs.mkdirSync(worktreeDir(root), { recursive: true });
      fs.writeFileSync(path.join(worktreeDir(root), 'stale.txt'), 'x\n');
    }
    // Run A (pid 424244) takes the scratch path just after this run's first worktree-list read.
    let raced = false;
    const racing = (args, o) => {
      const res = realDeps.git(args, o);
      if (!raced && args[0] === 'worktree' && args[1] === 'list') {
        raced = true;
        fs.rmSync(worktreeDir(root), { recursive: true, force: true });
        git(root, 'worktree', 'add', '-q', '--lock', '--reason', 'archive-tracked-shells (pid 424244)', '-b', 'run-a', worktreeDir(root), 'main');
        fs.writeFileSync(path.join(worktreeDir(root), 'in-flight.txt'), 'x\n');
      }
      return res;
    };
    const r = call(root, ['--root', root, '--no-pr'], { extra: { git: racing, pid: () => 31338, pidAlive: (pid) => pid === 424244 } });
    assert.ok(raced, 'the race was staged');
    assert.equal(r.code, 2, `stale=${stale}: ${r.stderr}`);
    assert.match(r.stderr, /another archive-tracked-shells run is in progress \(pid 424244\)/);
    assert.ok(fs.existsSync(path.join(worktreeDir(root), 'in-flight.txt')), `stale=${stale}: run A's worktree is untouched`);
    assert.match(git(root, 'worktree', 'list', '--porcelain'), /locked archive-tracked-shells \(pid 424244\)/);
  }
});

test('an unlocked scratch worktree git could not remove is left registered, never deleted behind git, exit 2', () => {
  const { root } = makeFixture([IDENTICAL]);
  git(root, 'worktree', 'add', '-q', '-b', 'stuck-scratch', worktreeDir(root), 'main');
  fs.writeFileSync(path.join(worktreeDir(root), 'in-use.txt'), 'x\n');
  const failingRemove = (args, o) => {
    if (args[0] === 'worktree' && args[1] === 'remove') return { stdout: '', stderr: 'injected remove failure', failure: 'git-error' };
    return realDeps.git(args, o);
  };
  const r = call(root, ['--root', root, '--no-pr'], { extra: { git: failingRemove } });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /could not be removed/);
  assert.ok(fs.existsSync(path.join(worktreeDir(root), 'in-use.txt')), 'the registered tree is not deleted with rmSync');
  assert.match(git(root, 'worktree', 'list', '--porcelain'), /branch refs\/heads\/stuck-scratch/);
});

test('a locked registration that appears between the remove and the add makes the add fail, exit 2, registration kept', () => {
  const { root } = makeFixture([IDENTICAL]);
  // Run A (pid 424245) registers and locks the scratch path right after this run's prune, its
  // directory not yet populated: only a forced add would take it over.
  let raced = false;
  const racing = (args, o) => {
    const res = realDeps.git(args, o);
    if (!raced && args[0] === 'worktree' && args[1] === 'prune') {
      raced = true;
      git(root, 'worktree', 'add', '-q', '--lock', '--reason', 'archive-tracked-shells (pid 424245)', '-b', 'run-a', worktreeDir(root), 'main');
      fs.rmSync(worktreeDir(root), { recursive: true, force: true });
    }
    return res;
  };
  const r = call(root, ['--root', root, '--no-pr'], { extra: { git: racing, pid: () => 31339, pidAlive: (pid) => pid === 424245 } });
  assert.ok(raced, 'the race was staged');
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /git worktree add failed/);
  assert.match(git(root, 'worktree', 'list', '--porcelain'), /branch refs\/heads\/run-a\nlocked archive-tracked-shells \(pid 424245\)/);
});

test('the scratch worktree is created locked with this run\'s pid', () => {
  const { root } = makeFixture([IDENTICAL]);
  let lockLine = null;
  const peeking = (args, o) => {
    if (args.includes('status')) lockLine = (git(root, 'worktree', 'list', '--porcelain').match(/^locked .*archive-tracked-shells.*$/m) || [null])[0];
    return realDeps.git(args, o);
  };
  const r = call(root, ['--root', root, '--no-pr'], { extra: { git: peeking, pid: () => 31337 } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lockLine, 'locked archive-tracked-shells (pid 31337)');
});

// A fake `gh` over an in-memory PR table. `pr list` and `pr view` project only the requested
// --json fields (so a dropped field is visible); `pr create` adds an OPEN row whose
// mergeStateStatus is `mergeState`; `pr merge` records its argv and then either sets an
// auto-merge request or (`mergeOnArm`, an unprotected repo) merges the PR outright.
function fakeGh({
  failCreate = false, failOpenList = false, failMerge = false, failView = false, mergeState = 'BLOCKED', mergeOnArm = false,
} = {}) {
  const st = { prs: [], calls: [], creates: 0, merges: [], bodies: [] };
  const flag = (args, name) => args[args.indexOf(name) + 1];
  const ok = (stdout) => ({ stdout, stderr: '', failure: null, exitCode: 0 });
  const bad = (stderr) => ({ stdout: null, stderr, failure: 'gh-failed', exitCode: 1 });
  const project = (p, args) => Object.fromEntries(flag(args, '--json').split(',').map((f) => [f, p[f] === undefined ? null : p[f]]));
  st.gh = (args, o = {}) => {
    st.calls.push({ args, input: o.input });
    if (args[0] === 'pr' && args[1] === 'list') {
      const state = flag(args, '--state');
      if (state === 'open' && failOpenList) return bad('read-back down\nsecond line');
      const rows = st.prs
        .filter((p) => p.head === flag(args, '--head') && (state === 'all' || p.state.toLowerCase() === state))
        .map((p) => project(p, args));
      return ok(JSON.stringify(rows));
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      if (failView) return bad('view down\nsecond line');
      const row = st.prs.find((p) => String(p.number) === args[2]);
      if (!row) return bad(`no pull request ${args[2]}`);
      return ok(JSON.stringify(project(row, args)));
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      if (failCreate) return bad('create down');
      st.creates += 1;
      st.bodies.push(o.input);
      const number = st.prs.length + 1;
      st.prs.push({
        number,
        url: `https://example.test/pull/${number}`,
        state: 'OPEN',
        head: flag(args, '--head'),
        createdAt: `2026-11-01T00:00:${String(number).padStart(2, '0')}Z`,
        mergeStateStatus: mergeState,
        autoMergeRequest: null,
      });
      return ok(`https://example.test/pull/${number}`);
    }
    if (args[0] === 'pr' && args[1] === 'merge') {
      if (failMerge) return bad('auto-merge not allowed\nsecond line');
      st.merges.push(args);
      const row = st.prs.find((p) => String(p.number) === args[2]);
      if (mergeOnArm) row.state = 'MERGED';
      else row.autoMergeRequest = { enabledAt: '2026-11-01T00:01:00Z' };
      return ok('');
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return st;
}

// Simulates a merge of PR row `i`: MERGED, with headRefOid the remote branch's current head.
function markMerged(fake, root, i = 0) {
  const ls = git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`);
  fake.prs[i].state = 'MERGED';
  fake.prs[i].headRefOid = ls ? ls.split(/\s+/)[0] : null;
}

const remoteTree = (origin, ref = BRANCH) => git(origin, 'ls-tree', '-r', '--name-only', ref).split('\n');
const archivedOnRemote = (origin, s) => remoteTree(origin).includes(`.claude-tweaks/pipelines/archive/${s.id}/work/${s.file}`);

test('AC2.1: under worktree-always the emitted command exits 0, creates the branch, moves the shell, opens one PR, main checkout HEAD unchanged', () => {
  const { root, origin, shells: [s] } = makeFixture([ABSENT]);
  const head = git(root, 'rev-parse', 'HEAD');
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.notEqual(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), '');
  assert.ok(archivedOnRemote(origin, s));
  assert.equal(fake.creates, 1);
  assert.equal(r.envelope.pr.url, 'https://example.test/pull/1');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  const create = fake.calls.find((c) => c.args[1] === 'create');
  assert.deepEqual(create.args, ['pr', 'create', '--base', 'main', '--head', BRANCH, '--title', 'Archive 1 stranded run spec headers', '--body-file', '-']);
  assert.ok(create.input.includes(s.id));
  const list = fake.calls.find((c) => c.args[1] === 'list');
  assert.deepEqual(list.args, ['pr', 'list', '--head', BRANCH, '--state', 'all', '--json', 'number,url,state,createdAt,headRefOid']);
  assert.ok(create.input.endsWith('\n<!-- tidy-housekeeping-pr -->\n'), 'the body ends with the housekeeping marker item 9 recognises');
});

test('AC3.1: three shells -> exactly one PR, branch carries every move', () => {
  const { root, origin } = makeFixture();
  const shells = [1, 2, 3].map((n) => addShell(root, `2026-11-12T00000${n}-record-${n}`, { twin: n === 2 ? 'identical' : 'absent' }));
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.creates, 1);
  for (const s of shells) assert.ok(archivedOnRemote(origin, s), s.id);
});

test('AC3.2: re-run after simulated merge is a no-op exiting 0 with moved empty', () => {
  const { root } = makeFixture([ABSENT, IDENTICAL]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  git(root, 'fetch', '-q', 'origin');
  git(root, 'push', '-q', 'origin', `refs/remotes/origin/${BRANCH}:refs/heads/main`);
  markMerged(fake, root);
  git(root, 'pull', '-q', '--ff-only', 'origin', 'main');
  const before = fake.creates;
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.envelope.moved, []);
  assert.deepEqual(r.envelope.deleted, []);
  assert.equal(fake.creates, before);
});

test('AC3.2b: after a squash merge whose head branch was deleted, a run with new shells bases on origin/main, not the stale local branch', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  git(root, 'fetch', '-q', 'origin');
  git(root, 'merge', '--squash', `refs/remotes/origin/${BRANCH}`);
  git(root, 'commit', '-q', '-m', 'squash of the housekeeping branch');
  git(root, 'push', '-q', 'origin', 'main');
  markMerged(fake, root);
  git(root, 'push', '-q', 'origin', `:refs/heads/${BRANCH}`);
  git(root, 'rev-parse', '--verify', `refs/heads/${BRANCH}`); // the stale local branch is still there
  const b = addShell(root, '2026-11-14T000001-record-2', { twin: 'absent' });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  git(root, 'fetch', '-q', 'origin');
  const subjects = git(root, 'log', `origin/main..origin/${BRANCH}`, '--format=%s').split('\n');
  assert.deepEqual(subjects, [`[reconcile] archive run ${b.id}`]);
  assert.equal(fake.creates, 2);
});

test('a merged PR whose head branch still exists on the remote has that branch deleted first, then restarts from the integration branch', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  markMerged(fake, root);
  const mergedHead = fake.prs[0].headRefOid;
  const b = addShell(root, '2026-11-14T100001-record-2', { twin: 'absent' });
  const seen = [];
  const recording = (args, o) => { seen.push(args); return realDeps.git(args, o); };
  const r = call(root, ['--root', root], { ghFake: fake.gh, extra: { git: recording } });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(
    seen.some((a) => a.join(' ') === `push --force-with-lease=refs/heads/${BRANCH}:${mergedHead} origin :refs/heads/${BRANCH}`),
    'the lingering remote branch was deleted, leased on the merged head',
  );
  git(root, 'fetch', '-q', 'origin');
  const subjects = git(root, 'log', `origin/main..origin/${BRANCH}`, '--format=%s').split('\n');
  assert.ok(subjects.includes(`[reconcile] archive run ${b.id}`));
  assert.equal(fake.creates, 2);
});

test('a merged PR followed by a newer CLOSED PR whose branch is still on origin refuses with exit 2 and deletes nothing', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  markMerged(fake, root);
  // PR #2 reused the branch and was closed without merging; the branch stayed on origin.
  fake.prs.push({ ...fake.prs[0], number: 2, url: 'https://example.test/pull/2', state: 'CLOSED', createdAt: '2026-11-02T00:00:00Z', headRefOid: null });
  const tip = git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`);
  addShell(root, '2026-11-14T110001-record-2', { twin: 'absent' });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /reopen PR #2/);
  assert.equal(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), tip);
  assert.equal(fake.creates, 1);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
});

test('a merged PR whose remote branch moved since the merge refuses with exit 2 and deletes nothing', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  markMerged(fake, root);
  // Someone pushed to the branch after the merge: its head is no longer the merged one.
  git(root, 'fetch', '-q', 'origin');
  git(root, 'push', '-q', 'origin', `refs/remotes/origin/main:refs/heads/${BRANCH}`, '--force');
  const tip = git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`);
  assert.notEqual(tip.split(/\s+/)[0], fake.prs[0].headRefOid);
  addShell(root, '2026-11-14T120001-record-2', { twin: 'absent' });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is not the head PR #1 merged/);
  assert.equal(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), tip);
  assert.equal(fake.creates, 1);
});

test('a merged PR with the integration fetch failing refuses with exit 2 instead of building on a stale ref', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  markMerged(fake, root);
  addShell(root, '2026-11-14T150001-record-2', { twin: 'absent' });
  const seen = [];
  const failingFetch = (args, o) => {
    seen.push(args);
    if (args[0] === 'fetch' && args[2].startsWith('+refs/heads/main:')) return { stdout: '', stderr: 'network down', failure: 'git-error' };
    return realDeps.git(args, o);
  };
  const r = call(root, ['--root', root], { ghFake: fake.gh, extra: { git: failingFetch } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /could not be fetched/);
  assert.equal(seen.some((a) => a[0] === 'push' && a[2] === `:refs/heads/${BRANCH}`), false);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.equal(fake.creates, 1);
});

test('a CLOSED PR whose remote branch is gone starts over like no PR ever: the local branch is kept and a new PR opens', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  fake.prs[0].state = 'CLOSED';
  git(root, 'push', '-q', 'origin', `:refs/heads/${BRANCH}`);
  const b = addShell(root, '2026-11-14T200001-record-2', { twin: 'absent' });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.creates, 2);
  assert.equal(r.envelope.pr.number, 2);
  assert.deepEqual(r.envelope.moved.map((m) => m.runId), [b.id]);
});

test('a CLOSED PR whose remote branch still exists exits 2 naming both remedies and touches nothing', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  fake.prs[0].state = 'CLOSED';
  const tip = git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`);
  addShell(root, '2026-11-14T210001-record-2', { twin: 'absent' });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /reopen PR #1/);
  assert.ok(r.stderr.includes(`git push origin --delete ${BRANCH}`));
  assert.equal(fake.creates, 1);
  assert.equal(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), tip);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
});

test('AC3.3: re-run while the PR is open reuses the branch and PR and prints its URL', () => {
  const { root, origin } = makeFixture();
  [1, 2, 3].forEach((n) => addShell(root, `2026-11-15T00000${n}-record-${n}`, { twin: 'absent' }));
  const fake = fakeGh();
  const first = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(first.code, 0, first.stderr);
  const fourth = addShell(root, '2026-11-15T000004-record-4', { twin: 'absent' });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.creates, 1);
  assert.equal(r.envelope.pr.url, first.envelope.pr.url);
  assert.ok(archivedOnRemote(origin, fourth));
});

test('AC3.4: re-run after a crash resumes from the branch current state', () => {
  const { root, origin, shells: [a] } = makeFixture([ABSENT]);
  assert.equal(call(root, ['--root', root, '--no-pr']).code, 0);
  const b = addShell(root, '2026-11-16T000001-record-2', { twin: 'absent' });
  const c = addShell(root, '2026-11-16T000002-record-3', { twin: 'identical' });
  fs.mkdirSync(worktreeDir(root), { recursive: true });
  fs.writeFileSync(path.join(worktreeDir(root), 'stale.txt'), 'x\n');
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.creates, 1);
  for (const s of [a, b, c]) assert.ok(archivedOnRemote(origin, s), s.id);
  const subjects = git(root, 'log', `origin/main..${BRANCH}`, '--no-merges', '--format=%s').split('\n');
  for (const s of [a, b, c]) assert.equal(subjects.filter((x) => x === `[reconcile] archive run ${s.id}`).length, 1);
});

test('AC5.1: housekeeping-auto-merge true on a PR the forge holds (BLOCKED) arms with gh pr merge --auto --squash', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh({ mergeState: 'BLOCKED' });
  const r = call(root, ['--root', root], { ghFake: fake.gh, auto: 'true' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fake.merges, [['pr', 'merge', '1', '--auto', '--squash']]);
  assert.equal(r.envelope.pr.armed, true);
  assert.equal(r.envelope.pr.merged, false);
  assert.equal(r.envelope.pr.state, 'OPEN');
  const views = fake.calls.filter((c) => c.args[1] === 'view').map((c) => c.args);
  assert.deepEqual(views, [
    ['pr', 'view', '1', '--json', 'state,mergeStateStatus,autoMergeRequest'],
    ['pr', 'view', '1', '--json', 'state,mergeStateStatus,autoMergeRequest'],
  ], 'one merge-state read before arming and one after');
});

test('housekeeping-auto-merge true on a PR the forge does not hold (not BLOCKED) leaves it unarmed with a note naming the state it read, exit 0', () => {
  const NOTES = {
    CLEAN: 'merge state CLEAN: no required check holds it, so --auto would merge it before CI',
    UNSTABLE: 'merge state UNSTABLE: only checks that are not required are failing or pending, so no required check holds it and --auto would merge it before CI',
    HAS_HOOKS: 'merge state HAS_HOOKS: mergeable with only pre-receive hooks to run, so no required check holds it and --auto would merge it before CI',
    UNKNOWN: 'merge state UNKNOWN (not yet computed, as GitHub reports right after a PR opens); the housekeeping backstop can arm it later',
    BEHIND: 'merge state BEHIND (its branch is out of date with the base); the housekeeping backstop can arm it once it is updated',
    DIRTY: 'merge state DIRTY (it conflicts with the base); the housekeeping backstop can arm it once the conflict is resolved',
    DRAFT: 'merge state DRAFT (it is a draft); the housekeeping backstop can arm it once it is marked ready',
    SOMETHING_NEW: 'merge state SOMETHING_NEW is not one this CLI knows; only BLOCKED (the forge holds the merge for its required checks) is armed',
    '': 'merge state not reported; only BLOCKED (the forge holds the merge for its required checks) is armed',
  };
  for (const [mergeState, note] of Object.entries(NOTES)) {
    const { root } = makeFixture([ABSENT]);
    const fake = fakeGh({ mergeState: mergeState || null, mergeOnArm: true });
    const r = call(root, ['--root', root], { ghFake: fake.gh, auto: 'true' });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(fake.merges, [], `${mergeState}: no gh pr merge call`);
    assert.equal(r.envelope.pr.armed, false);
    assert.equal(r.envelope.pr.merged, false);
    assert.equal(fake.prs[0].state, 'OPEN');
    assert.deepEqual(r.envelope.notes, [`PR #1 left unarmed: ${note}`], mergeState);
  }
});

test('an arming call that merged the PR at once is reported as merged, not armed', () => {
  const { root } = makeFixture([ABSENT]);
  // The state read said BLOCKED, but the forge merged on arming: the read-back is what counts.
  const fake = fakeGh({ mergeState: 'BLOCKED', mergeOnArm: true });
  const r = call(root, ['--root', root], { ghFake: fake.gh, auto: 'true' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.merges.length, 1);
  assert.equal(r.envelope.pr.armed, false);
  assert.equal(r.envelope.pr.merged, true);
  assert.equal(r.envelope.pr.state, 'MERGED');
});

test('a merge-state read that fails leaves the PR unarmed with the reason, exit 0', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh({ failView: true });
  const r = call(root, ['--root', root], { ghFake: fake.gh, auto: 'true' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fake.merges, []);
  assert.equal(r.envelope.pr.armed, false);
  assert.ok(r.envelope.notes.includes('PR #1 left unarmed: its merge state could not be read (view down)'), JSON.stringify(r.envelope.notes));
});

test('AC5.2: housekeeping-auto-merge false leaves the PR unarmed and says so', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh, auto: 'false' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fake.merges, []);
  assert.equal(r.envelope.pr.armed, false);
  assert.ok(r.envelope.notes.includes('housekeeping-auto-merge is false — PR left unarmed'));
});

test('AC5.3/AC5.4: a rejected arming call leaves the PR unarmed, reports the rejection, and is not an error exit', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh({ failMerge: true, mergeState: 'BLOCKED' });
  const r = call(root, ['--root', root], { ghFake: fake.gh, auto: 'true' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.envelope.pr.armed, false);
  assert.equal(r.envelope.pr.merged, false);
  assert.equal(r.envelope.pr.armError, 'auto-merge not allowed');
});

test('AC4.3: with one differing and one clean shell the PR still opens for the clean one and the CLI exits 1', () => {
  const { root, origin } = makeFixture();
  const good = addShell(root, '2026-11-18T000000-record-1', { twin: 'absent' });
  const bad = addShell(root, '2026-11-18T000001-record-2', { twin: 'differs' });
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 1);
  assert.equal(fake.creates, 1);
  assert.ok(archivedOnRemote(origin, good));
  assert.deepEqual(r.envelope.conflicts.map((c) => c.runId), [bad.id]);
  assert.ok(fake.bodies[0].includes(bad.file));
});

test('the PR body lists untwinned dirs under their own heading', () => {
  const { root } = makeFixture();
  addShell(root, '2026-11-18T100000-record-1', { twin: 'absent' });
  const odd = addShell(root, '2026-11-18T100001-record-2', { clean: false });
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fake.bodies[0].includes('Untwinned (classify by hand)'));
  assert.ok(fake.bodies[0].includes(odd.id));
});

test('AC7.5: a failure after the scratch worktree exists removes it and leaves no branch on the remote', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh({ failCreate: true });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 2);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.equal(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), '');
});

test('a create that succeeded keeps its branch and takes the PR from the create output when the read-back fails', () => {
  const { root, origin, shells: [s] } = makeFixture([ABSENT]);
  const fake = fakeGh({ failOpenList: true });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.envelope.pr.number, 1);
  assert.equal(r.envelope.pr.url, 'https://example.test/pull/1');
  assert.notEqual(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), '');
  assert.ok(archivedOnRemote(origin, s));
});

test('a failed create whose read-back also fails keeps the branch: the PR is unconfirmed, not absent', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh({ failCreate: true, failOpenList: true });
  const r = call(root, ['--root', root], { ghFake: fake.gh });
  assert.equal(r.code, 2);
  assert.notEqual(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), '');
  assert.ok(r.envelope.notes.some((n) => /unconfirmed/.test(n)));
});

test('a re-run that archives nothing new does not push a merge-only commit', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  const tip = git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`);
  addShell(root, '2026-11-19T400001-record-2', { twin: 'differs' }); // advances main, archives nothing
  const seen = [];
  const recording = (args, o) => { seen.push(args); return realDeps.git(args, o); };
  const r = call(root, ['--root', root], { ghFake: fake.gh, extra: { git: recording } });
  assert.equal(r.code, 1);
  assert.equal(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), tip);
  assert.equal(seen.some((a) => a[0] === 'push' && a.includes(BRANCH)), false);
  assert.equal(r.envelope.pr.number, 1);
});

test('a push-then-create recovery titles the PR by the archived headers on the branch, never "Archive 0"', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh({ failCreate: true });
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 2);
  // The crash left the branch on the remote with no PR; run again with nothing new to archive.
  git(root, 'push', '-q', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`);
  const again = fakeGh();
  const r = call(root, ['--root', root], { ghFake: again.gh });
  assert.equal(r.code, 0, r.stderr);
  const create = again.calls.find((c) => c.args[1] === 'create');
  assert.ok(create, 'a PR was created');
  assert.doesNotMatch(create.args[create.args.indexOf('--title') + 1], /Archive 0 /);
  assert.equal(create.args[create.args.indexOf('--title') + 1], 'Archive 1 stranded run spec headers');
});

test('prBody neutralizes closing phrases, HTML-comment markers and @-mentions in what it prints', () => {
  const body = prBody({
    moved: [{ runId: 'closes #5 <!-- x --> @octo' }],
    deleted: [],
    conflicts: [{ runId: 'r', reason: 'work-twin-conflict', differing: ['@scope/a.md', 'fixes #9'] }],
    untwinned: ['resolves #11'],
  }, ['already @me']);
  const marker = '\n<!-- tidy-housekeeping-pr -->\n';
  assert.ok(body.endsWith(marker), 'the housekeeping marker is the last line');
  assert.doesNotMatch(body.slice(0, -marker.length), /<!--/, 'no other HTML-comment marker survives');
  assert.doesNotMatch(body, /@(?!​)/);
  assert.doesNotMatch(body, /\b(?:closes|fixes|resolves) #\d+/i);
  assert.match(body, /closes issue #5/);
  assert.match(body, /Untwinned \(classify by hand\)/);
});

test('the arming note says "is false" only for the literal false', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh, auto: 'maybe' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fake.merges, []);
  assert.ok(r.envelope.notes.includes("housekeeping-auto-merge is 'maybe', not 'true' — PR left unarmed"));
  assert.ok(!r.envelope.notes.some((n) => n.includes('is false')));
});

test('a create failure on a branch the call did not create leaves the remote branch alone', () => {
  const { root } = makeFixture([ABSENT]);
  const fake = fakeGh();
  assert.equal(call(root, ['--root', root], { ghFake: fake.gh }).code, 0);
  fake.prs.length = 0; // the PR is gone: the branch is on the remote with no PR
  addShell(root, '2026-11-19T100001-record-2', { twin: 'absent' });
  const broken = fakeGh({ failCreate: true }); // the read-back confirms no PR, so only createdRemote protects the branch
  const r = call(root, ['--root', root], { ghFake: broken.gh });
  assert.equal(r.code, 2);
  assert.notEqual(git(root, 'ls-remote', 'origin', `refs/heads/${BRANCH}`), '');
});

test('a kept local branch that cannot merge the integration branch aborts with exit 2 and no scratch worktree', () => {
  const { root, shells: [a] } = makeFixture([ABSENT]);
  assert.equal(call(root, ['--root', root, '--no-pr']).code, 0);
  // origin/main adds the archive file the kept branch also added, with other bytes: an add/add conflict.
  fs.mkdirSync(a.twinWork, { recursive: true });
  fs.writeFileSync(path.join(a.twinWork, a.file), 'a different archived copy\n');
  git(root, 'add', '--', path.join('.claude-tweaks', 'pipelines', 'archive', a.id, 'work', a.file));
  git(root, 'commit', '-q', '-m', 'add a different archived copy');
  git(root, 'push', '-q', 'origin', 'main');
  addShell(root, '2026-11-20T000001-record-2', { twin: 'absent' });
  const r = call(root, ['--root', root, '--no-pr']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /merging refs\/remotes\/origin\/main into/);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /archive-tracked-shells/);
});

test('every git call of a dry run and of enumeration carries the injected env', () => {
  const { root } = makeFixture([ABSENT]);
  const seen = [];
  const recording = (args, o) => { seen.push({ args, env: o && o.env }); return realDeps.git(args, o); };
  const r = call(root, ['--root', root, '--dry-run'], { extra: { git: recording } });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(seen.some((c) => c.args.includes('ls-files')));
  for (const c of seen) assert.ok(c.env, `no env on git ${c.args.join(' ')}`);
});

// A no-forge local-merge project: one checkout, no `origin` at all.
function makeLocalOnlyFixture() {
  const base = fromTemplate('ats:local-only', (dir) => {
    const env = fixtureEnv();
    const root = path.join(dir, 'main');
    const run = runnerFor(env);
    fixtureGit(['init', '-q', '-b', 'main', root], { env });
    run(root, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(root, '.gitignore'), readText(REPO_GITIGNORE));
    fs.writeFileSync(path.join(root, 'README.md'), 'seed\n');
    run(root, 'add', '.gitignore', 'README.md');
    run(root, 'commit', '-q', '-m', 'seed');
  }, { prefix: 'ct-ats-local-', realpath: true });
  return { root: path.join(base, 'main') };
}

test('--no-pr in a repository with no origin builds the branch on the local integration branch and exits 0', () => {
  for (const branch of ['main', '']) { // policy integration-branch, then unset (the current branch)
    const { root } = makeLocalOnlyFixture();
    const a = addShell(root, '2026-11-22T000000-record-1', { twin: 'absent', push: false });
    const b = addShell(root, '2026-11-22T000001-record-2', { twin: 'identical', push: false });
    const head = git(root, 'rev-parse', 'HEAD');
    const r = call(root, ['--root', root, '--no-pr'], { model: 'local-merge', branch });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.envelope.branch, BRANCH);
    assert.deepEqual(r.envelope.moved.map((m) => m.runId), [a.id]);
    assert.deepEqual(r.envelope.deleted.map((m) => m.runId), [b.id]);
    assert.ok(r.envelope.notes.includes(`no origin remote: ${BRANCH} is built on the local main`), JSON.stringify(r.envelope.notes));
    const subjects = git(root, 'log', `main..${BRANCH}`, '--format=%s').split('\n').sort();
    assert.deepEqual(subjects, [`[reconcile] archive run ${a.id}`, `[reconcile] archive run ${b.id}`].sort());
    assert.equal(git(root, 'rev-parse', 'HEAD'), head);
    assert.equal(fs.existsSync(worktreeDir(root)), false);
  }
});

test('a clean-twin work/-only dir with no tracked file is named in untracked and left alone', () => {
  const { root, shells: [s] } = makeFixture([ABSENT]);
  const id = '2026-11-23T000001-record-2';
  fs.mkdirSync(path.join(pipelines(root), id, 'work'), { recursive: true });
  fs.writeFileSync(path.join(pipelines(root), id, 'work', '1-spec.md'), 'untracked\n');
  fs.mkdirSync(path.join(pipelines(root), 'archive', id), { recursive: true });
  fs.writeFileSync(path.join(pipelines(root), 'archive', id, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  const lone = '2026-11-23T000002-record-3'; // untracked and twin-less: not reconcile's shape, not listed
  fs.mkdirSync(path.join(pipelines(root), lone, 'work'), { recursive: true });
  fs.writeFileSync(path.join(pipelines(root), lone, 'work', '1-spec.md'), 'x\n');
  for (const argv of [['--dry-run'], ['--no-pr']]) {
    const r = call(root, ['--root', root, ...argv]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.envelope.untracked, [id]);
    assert.ok(fs.existsSync(path.join(pipelines(root), id, 'work', '1-spec.md')));
  }
  assert.deepEqual(findShells(root, realDeps).shells.map((x) => x.runId), [s.id]);
});

test('a push failure after the shells were archived exits 2 and still prints the envelope with branch and error', () => {
  const { root, shells: [s] } = makeFixture([ABSENT]);
  const failingPush = (args, o) => {
    if (args[0] === 'push' && args.includes(BRANCH)) return { stdout: '', stderr: 'remote rejected\nmore', failure: 'git-error' };
    return realDeps.git(args, o);
  };
  const fake = fakeGh();
  const r = call(root, ['--root', root], { ghFake: fake.gh, extra: { git: failingPush } });
  assert.equal(r.code, 2);
  assert.ok(r.envelope, `an envelope is printed: ${JSON.stringify(r.stdout)}`);
  assert.equal(r.envelope.branch, BRANCH);
  assert.equal(r.envelope.error, `git push origin ${BRANCH} failed: remote rejected`);
  assert.deepEqual(r.envelope.moved.map((m) => m.runId), [s.id]);
  assert.equal(r.envelope.pr, null);
  assert.equal(fake.creates, 0);
  assert.equal(fs.existsSync(worktreeDir(root)), false);
});

test('a throw after the shells were archived exits 2 and still prints the envelope with branch and error', () => {
  const { root, shells: [s] } = makeFixture([ABSENT]);
  const throwing = (args, o) => {
    if (args[0] === 'rev-list') throw new Error('injected rev-list failure');
    return realDeps.git(args, o);
  };
  const r = call(root, ['--root', root], { ghFake: fakeGh().gh, extra: { git: throwing } });
  assert.equal(r.code, 2);
  assert.equal(r.envelope.branch, BRANCH);
  assert.equal(r.envelope.error, 'archiving failed: injected rev-list failure');
  assert.deepEqual(r.envelope.moved.map((m) => m.runId), [s.id]);
});

test('realDeps.policy returns flat strings: true/false as text and an unset key as the empty string', () => {
  const resolveIn = (body) => {
    const dir = policyRepo();
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), body);
    return realDeps.policy(dir, ['integration-model', 'integration-branch', 'housekeeping-auto-merge'], { env: ENV });
  };
  assert.deepEqual(
    resolveIn('integration-model: local-merge\nhousekeeping-auto-merge: true\n'),
    { 'integration-model': 'local-merge', 'integration-branch': '', 'housekeeping-auto-merge': 'true' },
  );
  assert.deepEqual(
    resolveIn('integration-model: local-merge\nintegration-branch: trunk\nhousekeeping-auto-merge: false\n'),
    { 'integration-model': 'local-merge', 'integration-branch': 'trunk', 'housekeeping-auto-merge': 'false' },
  );
});

test('#5845 AC4.1: a fixture copy has its own origin; a push in one copy leaves another copy unchanged', () => {
  const a = makeFixture();
  const b = makeFixture();
  assert.notEqual(a.base, b.base);
  for (const f of [a, b]) {
    assert.equal(f.origin, path.join(f.base, 'origin.git'));
    assert.equal(f.root, path.join(f.base, 'main'));
    assert.equal(fs.realpathSync.native(git(f.root, 'remote', 'get-url', 'origin')), fs.realpathSync.native(f.origin));
    assert.equal(git(f.root, 'config', 'core.autocrlf'), 'false');
    assert.equal(git(f.root, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');
    assert.equal(git(f.root, 'log', '--format=%s'), 'seed');
  }
  const before = git(b.origin, 'rev-parse', 'main');
  assert.equal(git(a.origin, 'rev-parse', 'main'), before);
  addShell(a.root, '2026-11-30T000000-record-1', { twin: 'absent' }); // commits and pushes in copy a
  assert.notEqual(git(a.origin, 'rev-parse', 'main'), before);
  assert.equal(git(b.origin, 'rev-parse', 'main'), before);
  assert.equal(git(b.root, 'rev-parse', 'HEAD'), before);
  const v = makeFixture([ABSENT, IDENTICAL]);
  const w = makeFixture([{ twin: 'absent' }, { twin: 'identical' }]); // same template: defaults are normalized
  assert.deepEqual(v.shells.map((s) => s.id), ['2026-10-01T000000-record-1', '2026-10-01T000001-record-2']);
  assert.deepEqual(w.shells.map((s) => s.id), v.shells.map((s) => s.id));
  for (const f of [v, w]) {
    for (const s of f.shells) {
      assert.equal(s.live, path.join(pipelines(f.root), s.id, 'work'));
      assert.equal(s.twinWork, path.join(pipelines(f.root), 'archive', s.id, 'work'));
      assert.ok(fs.existsSync(path.join(s.live, s.file)));
      assert.ok(fs.existsSync(path.join(pipelines(f.root), 'archive', s.id, 'run-state.json')));
    }
    assert.equal(fs.existsSync(f.shells[0].twinWork), false); // absent twin
    assert.ok(fs.existsSync(path.join(f.shells[1].twinWork, f.shells[1].file))); // identical twin
    assert.equal(git(f.root, 'status', '--porcelain'), '');
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), git(f.origin, 'rev-parse', 'main')); // both shells pushed
    assert.deepEqual(findShells(f.root, realDeps).shells.map((s) => s.runId), f.shells.map((s) => s.id));
  }
});

test('#5845 AC3.1: a warm call of each templated fixture builder starts no git process', () => {
  const builders = [
    () => makeFixture(), () => makeFixture([ABSENT]), () => makeFixture([IDENTICAL]), () => makeFixture([ABSENT, IDENTICAL]),
    () => makeLocalOnlyFixture(), () => policyRepo(),
  ];
  for (const build of builders) build(); // warm-up: a first call may build the template
  const trace = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ats-trace-'));
  traced(trace, () => { for (const build of builders) build(); });
  assert.deepEqual(fs.readdirSync(trace), []);
  fs.rmSync(trace, { recursive: true, force: true });
});
