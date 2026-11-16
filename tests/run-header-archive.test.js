'use strict';
// Unit tests for plugin/bin/lib/run-header-archive.js (#3976): wrap-up's pre-merge move of a
// run's tracked spec header from the live run dir to archive/{run-id}/, in one commit on the
// run branch. Every case builds a real git repo carrying the repo's real .gitignore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { archiveRunHeader, ARCHIVE_HEADER_SUBJECT } = require('../plugin/bin/lib/run-header-archive');
const { readText } = require('./helpers/read-skill');
const { committedRepo, cleanGitEnv } = require('./helpers/git-fixtures');

const RUN = '2026-11-16T000000-record-7';
const P = '.claude-tweaks/pipelines';
const PIPELINES = path.join('.claude-tweaks', 'pipelines');
const LIVE = `${P}/${RUN}`;
const ARCH = `${P}/archive/${RUN}`;
const REAL_GITIGNORE = path.join(__dirname, '..', '.gitignore');

// Hermetic: no machine-wide hooks path, signing or identity leaks in; the commit identity is
// the env's own, so the injected-env case can prove the lib forwards it.
const ENV = {
  ...cleanGitEnv(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
};

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// A repo with the real .gitignore committed. `put(rel, content, {force})` writes and
// `git add`s a file (not committed); `commit(msg)` commits the index.
// The pre-narrowing .gitignore (every file under work/ un-ignored) or the narrowed form (#3976 Task 5)
// in which only work/*-spec.md is un-ignored: each `!…/work/**` line is `…/work/*` then `!…/work/*-spec.md`.
// The repo's real file is the narrowed form; the wide variant is derived from it, so both stay covered.
function gitignoreText({ narrowed }) {
  const real = readText(REAL_GITIGNORE);
  const wide = real
    .replace(/^(\.claude-tweaks\/pipelines\/.*\/work)\/\*\r?\n!\1\/\*-spec\.md$/gm, (_m, work) => `!${work}/**`);
  // A reflowed narrowing must fail here, not turn the wide control into a second copy of the narrowed rules.
  assert.notEqual(wide, real, 'the wide variant was derived from the narrowed .gitignore');
  assert.match(wide, /^!\.claude-tweaks\/pipelines\/\*\/work\/\*\*$/m, 'the wide variant un-ignores everything under work/');
  if (!narrowed) return wide;
  const again = wide.replace(/^!(\.claude-tweaks\/pipelines\/.*\/work)\/\*\*$/gm, (_m, work) => `${work}/*\n!${work}/*-spec.md`);
  assert.equal(again, real, 're-narrowing the wide variant reproduces the real .gitignore');
  return again;
}

function makeRepo({ narrowed = false } = {}) {
  const { dir, git } = committedRepo({ prefix: 'ct-rha-', branch: 'main' });
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignoreText({ narrowed }));
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'gitignore');
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  const track = (rel, content, { force = false } = {}) => {
    write(rel, content);
    git('add', ...(force ? ['-f'] : []), rel);
  };
  const commit = (msg) => git('commit', '-q', '-m', msg);
  const head = () => git('rev-parse', 'HEAD');
  const tree = (prefix) => git('ls-tree', '-r', '--name-only', 'HEAD', prefix).split('\n').filter(Boolean);
  const exitsClean = (...args) => {
    try { git(...args); return true; } catch { return false; }
  };
  return { dir, git, write, track, commit, head, tree, exitsClean };
}

// Registers the case twice: under the current .gitignore and under the narrowed one, where every
// file under work/ but *-spec.md is ignored. A case that tracks or leaves a non-spec file forces it.
function bothIgnoreRules(name, fn) {
  test(name, () => fn({ narrowed: false }));
  test(`${name} (narrowed .gitignore)`, () => fn({ narrowed: true }));
}

const mv = (r, extra = {}) => archiveRunHeader({ worktree: r.dir, runId: RUN, env: ENV, ...extra });

test('AC2.3/AC2.4 moves a live flat header to archive/{run}/work in one commit with the fixed subject', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  const before = r.git('rev-list', '--count', 'HEAD');

  const res = mv(r);

  assert.deepEqual(res, { outcome: 'moved', commit: r.head(), moved: [`${LIVE}/work/7-spec.md`] });
  assert.deepEqual(r.tree(`${LIVE}/`), []);
  assert.deepEqual(r.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
  assert.equal(r.git('log', '-1', '--format=%s'), ARCHIVE_HEADER_SUBJECT(RUN));
  assert.equal(ARCHIVE_HEADER_SUBJECT(RUN), `Archive run ${RUN} spec header — moved to archive/ before merge`);
  assert.equal(r.git('rev-list', '--count', 'HEAD'), String(Number(before) + 1));
  assert.equal(fs.existsSync(path.join(r.dir, LIVE, 'work')), false, 'the emptied live work/ dir is removed');
});

test('AC2.5 re-entry: a second call on a branch where the move already happened is a no-op with no new commit', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  assert.equal(mv(r).outcome, 'moved');
  const head = r.head();

  const again = mv(r);

  assert.deepEqual(again, { outcome: 'noop', moved: [] });
  assert.equal(r.head(), head);
});

test('noop when the run never materialized (no tracked work/)', () => {
  const r = makeRepo();
  const head = r.head();
  assert.deepEqual(mv(r), { outcome: 'noop', moved: [] });
  assert.equal(r.head(), head);
});

test('AC2.6 refusal: an archived copy that differs makes no commit and leaves both copies', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'live bytes\n');
  r.track(`${ARCH}/work/7-spec.md`, 'different archived bytes\n');
  r.commit('both copies');
  const head = r.head();

  const res = mv(r);

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'archived-copy-differs');
  assert.deepEqual(res.moved, []);
  assert.equal(r.head(), head);
  assert.equal(r.exitsClean('diff', '--cached', '--quiet'), true, 'index clean');
  assert.deepEqual(r.tree(`${LIVE}/`), [`${LIVE}/work/7-spec.md`]);
  assert.equal(fs.readFileSync(path.join(r.dir, ARCH, 'work', '7-spec.md'), 'utf8'), 'different archived bytes\n');
});

test('identical archived twin is resolved by git rm, not refused', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'same\n');
  r.track(`${ARCH}/work/7-spec.md`, 'same\n');
  r.commit('identical twin');

  const res = mv(r);

  assert.equal(res.outcome, 'moved');
  assert.deepEqual(res.moved, [`${LIVE}/work/7-spec.md`]);
  assert.deepEqual(r.tree(`${LIVE}/`), []);
  assert.deepEqual(r.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
});

test('an untracked destination file: identical is taken over, different is refused', () => {
  const same = makeRepo();
  same.track(`${LIVE}/work/7-spec.md`, 'same\n');
  same.commit('materialize');
  same.write(`${ARCH}/work/7-spec.md`, 'same\n'); // on disk, untracked (the real .gitignore does not ignore it)
  const resSame = mv(same);
  assert.equal(resSame.outcome, 'moved', JSON.stringify(resSame));
  assert.deepEqual(same.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`], 'destination now tracked');
  assert.deepEqual(same.tree(`${LIVE}/`), []);

  const differs = makeRepo();
  differs.track(`${LIVE}/work/7-spec.md`, 'live\n');
  differs.commit('materialize');
  differs.write(`${ARCH}/work/7-spec.md`, 'stray untracked bytes\n');
  const head = differs.head();
  const resDiff = mv(differs);
  assert.equal(resDiff.outcome, 'refused');
  assert.equal(resDiff.reason, 'archived-copy-differs');
  assert.equal(differs.head(), head);
  assert.equal(fs.readFileSync(path.join(differs.dir, ARCH, 'work', '7-spec.md'), 'utf8'), 'stray untracked bytes\n');
  assert.deepEqual(differs.tree(`${LIVE}/`), [`${LIVE}/work/7-spec.md`]);
});

test("specDir limits the move to that spec's header", () => {
  const r = makeRepo();
  r.track(`${LIVE}/spec-8/work/8-spec.md`, 'eight\n');
  r.track(`${LIVE}/spec-9/work/9-spec.md`, 'nine\n');
  r.commit('materialize');

  const res = mv(r, { specDir: 'spec-8' });

  assert.equal(res.outcome, 'moved');
  assert.deepEqual(res.moved, [`${LIVE}/spec-8/work/8-spec.md`]);
  assert.deepEqual(r.tree(`${ARCH}/`), [`${ARCH}/spec-8/work/8-spec.md`]);
  assert.deepEqual(r.tree(`${LIVE}/`), [`${LIVE}/spec-9/work/9-spec.md`]);
});

test('AC3.1/AC3.2 multi-spec: one move commit relocates work/ and every spec-{N}/work/ header', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'seven\n');
  r.track(`${LIVE}/spec-8/work/8-spec.md`, 'eight\n');
  r.track(`${LIVE}/spec-9/work/9-spec.md`, 'nine\n');
  r.commit('materialize');
  const before = Number(r.git('rev-list', '--count', 'HEAD'));

  const res = mv(r);

  assert.equal(res.outcome, 'moved');
  assert.equal(Number(r.git('rev-list', '--count', 'HEAD')), before + 1, 'exactly one new commit');
  assert.deepEqual(r.tree(`${ARCH}/`), [
    `${ARCH}/spec-8/work/8-spec.md`,
    `${ARCH}/spec-9/work/9-spec.md`,
    `${ARCH}/work/7-spec.md`,
  ]);
  assert.deepEqual(r.tree(`${LIVE}/`), []);
  assert.deepEqual([...res.moved].sort(), [
    `${LIVE}/spec-8/work/8-spec.md`,
    `${LIVE}/spec-9/work/9-spec.md`,
    `${LIVE}/work/7-spec.md`,
  ]);
});

bothIgnoreRules('moves every tracked file, not only *-spec.md; untracked files stay', (rules) => {
  const r = makeRepo(rules);
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.track(`${LIVE}/work/prompt-audit-probe.txt`, 'probe\n', { force: true });
  r.commit('materialize');
  r.write(`${LIVE}/work/scratch.md`, 'untracked scratch\n');

  const res = mv(r);

  assert.equal(res.outcome, 'moved');
  assert.deepEqual(r.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`, `${ARCH}/work/prompt-audit-probe.txt`]);
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'work', 'scratch.md'), 'utf8'), 'untracked scratch\n');
  assert.deepEqual(r.tree(`${LIVE}/`), []);
});

test('AC2.7 a commit made after the move leaves no live work/ path', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  const runBranch = r.git('rev-parse', '--abbrev-ref', 'HEAD');
  r.git('checkout', '-q', '-b', 'side');
  r.track('unrelated.txt', 'u\n');
  r.commit('unrelated');
  r.git('checkout', '-q', runBranch);
  assert.equal(mv(r).outcome, 'moved');

  r.git('merge', '-q', '--no-edit', 'side');
  r.track('docs/ledger.md', 'ledger\n');
  r.commit('ledger');

  assert.deepEqual(r.git('ls-tree', '-r', 'HEAD', '--', `${LIVE}/`).split('\n').filter(Boolean), []);
  assert.deepEqual(r.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
});

test('dirty index refuses before any mutation', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  r.track('unrelated.txt', 'staged\n');
  const head = r.head();

  const res = mv(r);

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'dirty-index');
  assert.equal(r.head(), head);
  assert.equal(r.git('diff', '--cached', '--name-only'), 'unrelated.txt', 'the unrelated file is still staged');
  assert.deepEqual(r.tree(`${LIVE}/`), [`${LIVE}/work/7-spec.md`]);
  assert.equal(fs.existsSync(path.join(r.dir, ARCH)), false, 'nothing was created at the destination');
});

test('a failing pre-commit hook reverts the move and refuses', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.track(`${LIVE}/spec-8/work/8-spec.md`, 'eight\n');
  r.commit('materialize');
  fs.writeFileSync(path.join(r.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const head = r.head();

  const res = mv(r);

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'commit-failed');
  assert.equal(r.head(), head);
  assert.deepEqual(r.git('ls-files', '--', `${LIVE}/`).split('\n').filter(Boolean), [`${LIVE}/spec-8/work/8-spec.md`, `${LIVE}/work/7-spec.md`]);
  assert.equal(r.git('ls-files', '--', `${ARCH}/`), '', 'archived path absent from the index');
  assert.equal(r.git('status', '--porcelain'), '', 'nothing staged, nothing dirty');
  assert.equal(fs.existsSync(path.join(r.dir, PIPELINES, 'archive')), false, 'the archive directories this call created are removed');
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'work', '7-spec.md'), 'utf8'), 'spec\n');
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'spec-8', 'work', '8-spec.md'), 'utf8'), 'eight\n');
});

bothIgnoreRules('a failing pre-commit hook restores an identical twin and an untracked destination', (rules) => {
  const r = makeRepo(rules);
  r.track(`${LIVE}/work/7-spec.md`, 'same\n');
  r.track(`${ARCH}/work/7-spec.md`, 'same\n'); // identical tracked twin: git rm op
  r.track(`${LIVE}/work/9-note.md`, 'nine\n', { force: true });
  r.commit('materialize');
  r.write(`${ARCH}/work/9-note.md`, 'nine\n'); // identical untracked destination: mv-force op
  fs.writeFileSync(path.join(r.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  const res = mv(r);

  assert.equal(res.reason, 'commit-failed', JSON.stringify(res));
  // The whole tree, exactly: the untracked destination is the only thing not tracked, shown as `??` under
  // the current .gitignore and `!!` under the narrowed one; anything else a revert left behind would be listed.
  assert.equal(
    r.git('status', '--porcelain', '--untracked-files=all', '--ignored'),
    `${rules.narrowed ? '!!' : '??'} ${ARCH}/work/9-note.md`,
  );
  assert.equal(r.exitsClean('diff', '--cached', '--quiet'), true, 'nothing staged');
  assert.equal(r.exitsClean('diff', '--quiet'), true, 'no tracked file modified or deleted');
  assert.equal(r.git('ls-files', '--', `${ARCH}/work/9-note.md`), '', 'the destination is still untracked');
  assert.equal(fs.readFileSync(path.join(r.dir, ARCH, 'work', '9-note.md'), 'utf8'), 'nine\n');
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'work', '7-spec.md'), 'utf8'), 'same\n');
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'work', '9-note.md'), 'utf8'), 'nine\n');
  assert.deepEqual(r.git('ls-files', '--', `${LIVE}/`).split('\n'), [`${LIVE}/work/7-spec.md`, `${LIVE}/work/9-note.md`]);
});

test('a failing second git mv reverts the first and refuses with git-mv-failed', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.track(`${LIVE}/spec-8/work/8-spec.md`, 'eight\n');
  r.commit('materialize');
  const head = r.head();
  const { runGit } = require('../plugin/bin/lib/hooks/git-exec');
  let mvCalls = 0;
  const git = (args, cwd, opts) => {
    if (args[0] === 'mv' && ++mvCalls === 2) {
      return { stdout: null, failure: 'git-error', stderr: 'simulated mv failure', exitCode: 128, failureStdout: '' };
    }
    return runGit(args, cwd, opts);
  };

  const res = mv(r, { git });

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'git-mv-failed');
  assert.match(res.detail, /simulated mv failure/);
  assert.equal(r.head(), head);
  assert.equal(r.git('status', '--porcelain'), '', 'the first mv was reverted');
  assert.equal(fs.existsSync(path.join(r.dir, PIPELINES, 'archive')), false, 'the archive directories the first mv created are removed');
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'work', '7-spec.md'), 'utf8'), 'spec\n');
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'spec-8', 'work', '8-spec.md'), 'utf8'), 'eight\n');
});

test('missing worktree refuses', () => {
  const missing = path.join(os.tmpdir(), `ct-rha-missing-${process.pid}-${Date.now()}`);
  const res = archiveRunHeader({ worktree: missing, runId: RUN, env: ENV });
  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'missing-worktree');
  assert.deepEqual(res.moved, []);
});

test('the commit takes the injected env', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  assert.equal(process.env.GIT_AUTHOR_NAME === 'ArchiveEnvProbe', false);

  const res = mv(r, { env: { ...ENV, GIT_AUTHOR_NAME: 'ArchiveEnvProbe' } });

  assert.equal(res.outcome, 'moved');
  assert.equal(r.git('log', '-1', '--format=%an'), 'ArchiveEnvProbe');
});

test('an argument that is not a run id or a spec dir throws instead of reaching git', () => {
  const r = makeRepo();
  assert.throws(() => archiveRunHeader({ worktree: r.dir, runId: '../escape', env: ENV }), TypeError);
  assert.throws(() => archiveRunHeader({ worktree: r.dir, runId: RUN, specDir: 'spec-8/../x', env: ENV }), TypeError);
  assert.throws(() => archiveRunHeader({ worktree: r.dir, runId: RUN, specDir: 'work', env: ENV }), TypeError);
  // The CLI tells these from a bug inside the move by this code, never by the error's type.
  for (const bad of [{ runId: '../escape' }, { runId: RUN, specDir: 'work' }]) {
    assert.throws(() => archiveRunHeader({ worktree: r.dir, env: ENV, ...bad }), { name: 'TypeError', code: 'ERR_RUN_HEADER_ARGS' });
  }
});

test('an inherited GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE never redirects the move to another repo (#4178)', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  const decoy = makeRepo();
  const decoyHead = decoy.head();
  const hostile = {
    ...ENV,
    GIT_DIR: path.join(decoy.dir, '.git'),
    GIT_WORK_TREE: decoy.dir,
    GIT_INDEX_FILE: path.join(decoy.dir, '.git', 'index'),
  };

  const res = archiveRunHeader({ worktree: r.dir, runId: RUN, env: hostile });

  assert.equal(res.outcome, 'moved', 'the move ran in the worktree it was given');
  assert.deepEqual(r.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
  assert.deepEqual(r.tree(`${LIVE}/`), []);
  assert.equal(decoy.head(), decoyHead, 'the decoy repo took no commit');
});

test('AC7.1 the gh-absent bookends check reads the archived-only header as materialized', () => {
  const { realDeps } = require('../plugin/bin/verify-run-bookends.js');
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  const runDir = path.join(os.tmpdir(), 'main-checkout-shape', ...P.split('/'), RUN);
  const args = { worktree: r.dir, runDir, issue: 7, multiTarget: false };
  assert.equal(realDeps.isSpecCommitted(args), true, 'control: live header');

  assert.equal(mv(r).outcome, 'moved');

  assert.deepEqual(r.tree(`${LIVE}/`), []);
  assert.equal(realDeps.isSpecCommitted(args), true, 'archived-only header');
});

test('an unstaged edit to a file about to move refuses dirty-index, naming the path, before any mutation', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'committed\n');
  r.commit('materialize');
  r.write(`${LIVE}/work/7-spec.md`, 'committed\nplus an unstaged edit\n');
  const head = r.head();

  const res = mv(r);

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'dirty-index');
  assert.ok(res.detail.includes(`${LIVE}/work/7-spec.md`), res.detail);
  assert.equal(r.head(), head);
  assert.equal(r.exitsClean('diff', '--cached', '--quiet'), true, 'nothing staged');
  assert.equal(fs.readFileSync(path.join(r.dir, LIVE, 'work', '7-spec.md'), 'utf8'), 'committed\nplus an unstaged edit\n', 'the edit is untouched');
  assert.equal(fs.existsSync(path.join(r.dir, PIPELINES, 'archive')), false);
});

test('an unstaged edit to a file beside the moving ones does not block the move or ride along', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.track('docs/other.md', 'other\n');
  r.commit('materialize');
  r.write('docs/other.md', 'edited\n');

  assert.equal(mv(r).outcome, 'moved');

  assert.equal(r.git('status', '--porcelain').trim(), 'M docs/other.md', 'the unrelated edit stays unstaged and uncommitted');
});

test('a hook sees no GIT_LITERAL_PATHSPECS from the move', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  const probe = path.join(r.dir, '.git', 'hook-env-probe');
  fs.writeFileSync(path.join(r.dir, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\necho "\${GIT_LITERAL_PATHSPECS-unset}" > "${probe}"\n`, { mode: 0o755 });

  assert.equal(mv(r).outcome, 'moved');

  assert.equal(fs.readFileSync(probe, 'utf8').trim(), 'unset');
});

test('a file name with glob characters is moved as itself (literal pathspecs)', { skip: process.platform === 'win32' && 'a * cannot be in a Windows file name' }, () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/s*.md`, 'star\n', { force: true });
  r.track(`${ARCH}/work/s*.md`, 'star\n', { force: true }); // identical twin: the rm op, which would glob without :(literal)
  r.track(`${LIVE}/work/sx.md`, 'sx\n', { force: true });
  r.commit('materialize');

  const res = mv(r);

  assert.equal(res.outcome, 'moved', JSON.stringify(res));
  assert.deepEqual(r.tree(`${LIVE}/`), []);
  assert.deepEqual(r.tree(`${ARCH}/`), [`${ARCH}/work/s*.md`, `${ARCH}/work/sx.md`]);
});

test('a glob-shaped run id throws instead of reaching a pathspec', () => {
  const r = makeRepo();
  for (const runId of ['2026-11-16T*', '2026-11-16T[a]', '2026-11-16T?', '2026-11-16T a', '2026-11-16T', 'x2026-11-16T000000-r']) {
    assert.throws(() => archiveRunHeader({ worktree: r.dir, runId, env: ENV }), TypeError, runId);
  }
});

// A runner that really runs git, except for the calls `fail(args, n)` names (n counts that verb's calls).
function failingRunner(fail) {
  const { runGit } = require('../plugin/bin/lib/hooks/git-exec');
  const counts = {};
  return (args, cwd, opts) => {
    counts[args[0]] = (counts[args[0]] || 0) + 1;
    if (fail(args, counts[args[0]])) return { stdout: null, failure: 'git-error', stderr: `simulated ${args[0]} failure`, exitCode: 128, failureStdout: '' };
    return runGit(args, cwd, opts);
  };
}

test('a mv failure whose unwind also fails is a partial-revert refusal naming what is left', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.track(`${LIVE}/spec-8/work/8-spec.md`, 'eight\n');
  r.commit('materialize');
  // the first mv works, the second fails, and the revert mv (the third) fails too
  const git = failingRunner((args, n) => args[0] === 'mv' && n >= 2);

  const res = mv(r, { git });

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'git-mv-failed-partial-revert');
  assert.match(res.detail, /simulated mv failure/);
  assert.match(res.detail, /did not finish/);
  assert.match(res.detail, /mv \S+ back/);
  // ls-files order: spec-8's header moves first; it is the one left staged.
  assert.deepEqual(r.git('ls-files', '--', `${ARCH}/`).split('\n').filter(Boolean), [`${ARCH}/spec-8/work/8-spec.md`], 'the first move is still staged, as the detail says');
});

test('a commit failure whose unwind also fails is a partial-revert refusal', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  fs.writeFileSync(path.join(r.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const git = failingRunner((args, n) => args[0] === 'mv' && n >= 2); // the revert mv

  const res = mv(r, { git });

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'commit-failed-partial-revert');
  assert.match(res.detail, /did not finish/);
});

test('a tracked identical twin with an unstaged edit on the archived copy refuses dirty-index, naming it', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'same\n');
  r.track(`${ARCH}/work/7-spec.md`, 'same\n');
  r.commit('identical twin');
  r.write(`${ARCH}/work/7-spec.md`, 'same\nedited archived copy\n');
  const head = r.head();

  const res = mv(r);

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'dirty-index');
  assert.ok(res.detail.includes(`${ARCH}/work/7-spec.md`), res.detail);
  assert.equal(r.head(), head);
  assert.equal(r.exitsClean('diff', '--cached', '--quiet'), true, 'nothing staged');
  assert.equal(fs.readFileSync(path.join(r.dir, ARCH, 'work', '7-spec.md'), 'utf8'), 'same\nedited archived copy\n', 'the edit is untouched');
  assert.deepEqual(r.tree(`${LIVE}/`), [`${LIVE}/work/7-spec.md`]);
});

test('a destination that is not a regular file refuses archived-copy-differs before any mutation', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  fs.mkdirSync(path.join(r.dir, ARCH, 'work', '7-spec.md'), { recursive: true }); // a directory where the file would land
  const head = r.head();

  const res = mv(r);

  assert.equal(res.outcome, 'refused');
  assert.equal(res.reason, 'archived-copy-differs');
  assert.match(res.detail, /not a regular file/);
  assert.equal(r.head(), head);
  assert.equal(r.exitsClean('diff', '--cached', '--quiet'), true, 'nothing staged');
  assert.deepEqual(r.tree(`${LIVE}/`), [`${LIVE}/work/7-spec.md`]);
  assert.equal(fs.statSync(path.join(r.dir, ARCH, 'work', '7-spec.md')).isDirectory(), true, 'the directory is untouched');
});

test('a pre-existing archive directory survives a reverted move', () => {
  const r = makeRepo();
  r.track(`${LIVE}/work/7-spec.md`, 'spec\n');
  r.commit('materialize');
  r.write(`${ARCH}/run-state.json`, '{}\n'); // the archive run dir already exists (its gitignored half)
  fs.writeFileSync(path.join(r.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  assert.equal(mv(r).reason, 'commit-failed');

  assert.equal(fs.readFileSync(path.join(r.dir, ARCH, 'run-state.json'), 'utf8'), '{}\n');
  assert.equal(fs.existsSync(path.join(r.dir, ARCH, 'work')), false, 'only the work/ this call created is removed');
});
