'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { originWithTwoClones, cleanGitEnv } = require('../../helpers/git-fixtures');
const {
  defaultGit, makeGit, resolveCommit, localRef, lsRemoteRef, fetchRef, planCommitFile, changedPaths, absoluteGitDir,
} = require('../../../plugin/bin/lib/plan-store/git');

function setup(t) {
  const fx = originWithTwoClones('ct-plan-store-');
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const env = cleanGitEnv(fx.env);
  const calls = [];
  const git = (args, opts) => { calls.push(args); return defaultGit(args, opts); };
  const g = makeGit({ git, root: fx.work, env });
  return { fx, env, g, calls };
}

// A commit on HEAD adding `files` ({path: content}); HEAD itself is left where it was.
function commitFiles(fx, files) {
  const head = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(fx.work, p)), { recursive: true });
    fs.writeFileSync(path.join(fx.work, p), c);
    fx.run(fx.work, ['add', p]);
  }
  fx.run(fx.work, ['commit', '-q', '-m', 'plan']);
  const sha = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  fx.run(fx.work, ['reset', '-q', '--hard', head]);
  return sha;
}

test('resolveCommit resolves a commit and refuses the rest', (t) => {
  const { fx, g } = setup(t);
  const head = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  const tree = fx.run(fx.work, ['rev-parse', 'HEAD^{tree}']).trim();
  assert.strictEqual(resolveCommit(g, 'HEAD'), head);
  for (const bad of ['deadbeef', '-evil', tree]) assert.strictEqual(resolveCommit(g, bad), null);
});

test('resolveCommit and localRef put --verify and --end-of-options directly before the rev', (t) => {
  const { g, calls } = setup(t);
  resolveCommit(g, '-evil');
  localRef(g, '-evil');
  const rp = calls.filter((a) => a.includes('rev-parse'));
  assert.strictEqual(rp.length, 2);
  for (const a of rp) {
    const i = a.indexOf('--end-of-options');
    assert.ok(a.includes('--verify') && i > a.indexOf('--verify') && i === a.length - 2, `argv ${JSON.stringify(a)}`);
  }
  assert.strictEqual(rp[0][rp[0].length - 1], '-evil^{commit}');
  assert.strictEqual(rp[1][rp[1].length - 1], '-evil');
});

test('lsRemoteRef refuses a dash-leading remote without running git', (t) => {
  const { g, calls } = setup(t);
  for (const bad of ['--upload-pack=x', '', undefined]) assert.strictEqual(lsRemoteRef(g, bad, 'refs/claude-tweaks/plans/7').ok, false);
  assert.deepStrictEqual(calls, []);
});

test('fetchRef refuses a dash-leading remote without running git', (t) => {
  const { g, calls } = setup(t);
  for (const bad of ['--upload-pack=x', '', undefined]) assert.strictEqual(fetchRef(g, bad, 'refs/claude-tweaks/plans/7').ok, false);
  assert.deepStrictEqual(calls, []);
});

test('lsRemoteRef ignores a same-tail ref', (t) => {
  const { fx, g } = setup(t);
  const ref = 'refs/claude-tweaks/plans/8';
  fx.run(fx.work, ['push', '-q', 'origin', `HEAD:refs/archive/${ref}`]);
  assert.deepStrictEqual(lsRemoteRef(g, 'origin', ref), { ok: true, sha: null });
  fx.run(fx.work, ['push', '-q', 'origin', `HEAD:${ref}`]);
  const head = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  assert.deepStrictEqual(lsRemoteRef(g, 'origin', ref), { ok: true, sha: head });
  fx.run(fx.work, ['remote', 'set-url', 'origin', path.join(fx.root, 'nope.git')]);
  assert.strictEqual(lsRemoteRef(g, 'origin', ref).ok, false);
});

test('fetchRef force-updates a stale local ref', (t) => {
  const { fx, g } = setup(t);
  const ref = 'refs/claude-tweaks/plans/7';
  const a = commitFiles(fx, { 'a-only.txt': 'a' });
  const b = commitFiles(fx, { 'b-only.txt': 'b' });
  fx.run(fx.work, ['push', '-q', 'origin', `${a}:${ref}`]);
  fx.run(fx.work, ['update-ref', ref, b]);
  assert.strictEqual(localRef(g, ref), b);
  assert.deepStrictEqual(fetchRef(g, 'origin', ref), { ok: true });
  assert.strictEqual(localRef(g, ref), a);
  const missing = fetchRef(g, 'origin', 'refs/claude-tweaks/plans/9');
  assert.strictEqual(missing.ok, false);
  assert.match(missing.reason, /couldn't find remote ref/);
});

test('fetchRef passes the one-record refspec', (t) => {
  const { fx, g, calls } = setup(t);
  const ref = 'refs/claude-tweaks/plans/7';
  fx.run(fx.work, ['push', '-q', 'origin', `HEAD:${ref}`]);
  fetchRef(g, 'origin', ref);
  const fetch = calls.find((a) => a.includes('fetch'));
  assert.deepStrictEqual(fetch, ['-C', fx.work, 'fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', `+${ref}:${ref}`]);
});

test('planCommitFile reads a one-file plan commit', (t) => {
  const { fx, g } = setup(t);
  const head = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  const content = 'plan é bytes\r\n';
  const one = commitFiles(fx, { 'docs/superpowers/plans/x-7.md': content });
  const r = planCommitFile(g, one);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.path, 'docs/superpowers/plans/x-7.md');
  assert.strictEqual(r.parent, head);
  assert.ok(Buffer.from(content).equals(r.bytes));

  const two = commitFiles(fx, { 'docs/superpowers/plans/a.md': 'a', 'docs/superpowers/plans/b.md': 'b' });
  assert.strictEqual(planCommitFile(g, two).ok, false);

  const tree = fx.run(fx.work, ['rev-parse', 'HEAD^{tree}']).trim();
  const orphan = fx.run(fx.work, ['commit-tree', tree, '-m', 'root']).trim();
  const noParent = planCommitFile(g, orphan);
  assert.strictEqual(noParent.ok, false);
  assert.strictEqual(noParent.reason, `commit ${orphan} has no parent`);

  const outside = commitFiles(fx, { 'docs/other/x.md': 'x' });
  assert.strictEqual(planCommitFile(g, outside).ok, false);
  // A sibling file whose name merely starts with the plan dir's name: only the startsWith clause refuses it.
  const sibling = commitFiles(fx, { 'docs/superpowers/plans-x.md': 'x' });
  const sib = planCommitFile(g, sibling);
  assert.strictEqual(sib.ok, false);
  assert.match(sib.reason, /not directly under/);

  // A deletion of an existing plan file: the status check refuses it, with its own reason.
  const added = commitFiles(fx, { 'docs/superpowers/plans/gone.md': 'x' });
  fx.run(fx.work, ['reset', '-q', '--hard', added]);
  fx.run(fx.work, ['rm', '-q', '--', 'docs/superpowers/plans/gone.md']);
  fx.run(fx.work, ['commit', '-q', '-m', 'delete plan']);
  const deleted = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  fx.run(fx.work, ['reset', '-q', '--hard', head]);
  const del = planCommitFile(g, deleted);
  assert.strictEqual(del.ok, false);
  assert.strictEqual(del.reason, `plan commit ${deleted} has status D, expected A or M`);
  const nested = commitFiles(fx, { 'docs/superpowers/plans/sub/x.md': 'x' });
  assert.strictEqual(planCommitFile(g, nested).ok, false);
});

test('planCommitFile refuses a backslash basename that would escape --out on win32', { skip: process.platform === 'win32' && 'git on win32 refuses to index a backslash path' }, (t) => {
  const { fx, g } = setup(t);
  const blob = String(defaultGit(['hash-object', '-w', '--stdin'], { cwd: fx.work, env: cleanGitEnv(fx.env), input: 'x' })).trim();
  const idx = path.join(fx.root, 'scratch-index');
  const env = { ...fx.env, GIT_INDEX_FILE: idx };
  const run = (args) => defaultGit(args, { cwd: fx.work, env: cleanGitEnv(env) });
  run(['read-tree', 'HEAD']);
  run(['update-index', '--add', '--cacheinfo', `100644,${blob},docs/superpowers/plans/..\\..\\evil.md`]);
  const tree = String(run(['write-tree'])).trim();
  const head = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  const bad = String(run(['commit-tree', tree, '-p', head, '-m', 'evil'])).trim();
  const r = planCommitFile(g, bad);
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.match(r.reason, /not directly under/);
});

test('changedPaths uses --no-renames', (t) => {
  const { fx, g, calls } = setup(t);
  fx.commit(fx.work, 'a.txt');
  const before = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  fx.run(fx.work, ['mv', 'a.txt', 'b.txt']);
  fx.run(fx.work, ['commit', '-q', '-m', 'mv']);
  const after = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  const r = changedPaths(g, before, after);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([...r.paths].sort(), ['a.txt', 'b.txt']);
  const argv = calls.find((a) => a.includes('--name-status') && a.includes('diff'));
  assert.ok(argv.includes('--name-status') && argv.includes('-z') && argv.includes('--no-renames'));
  assert.strictEqual(changedPaths(g, 'nonexistent-rev', after).ok, false);
});

test('changedPaths with paths reports only those paths, each as a literal pathspec', (t) => {
  const { fx, g, calls } = setup(t);
  fx.commit(fx.work, 'a.txt');
  fx.commit(fx.work, 'c.txt');
  const before = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  fx.run(fx.work, ['mv', 'a.txt', 'b.txt']);
  fx.run(fx.work, ['rm', '-q', 'c.txt']);
  fx.run(fx.work, ['commit', '-q', '-m', 'mv and rm']);
  const after = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  const r = changedPaths(g, before, after, ['a.txt', '*.md']);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([...r.paths], ['a.txt'], 'b.txt and c.txt changed too, but only a.txt was asked about');
  const argv = calls.filter((a) => a.includes('--name-status')).pop();
  assert.deepStrictEqual(argv.slice(argv.indexOf('--')), ['--', ':(literal)a.txt', ':(literal)*.md']);
});

test('absoluteGitDir returns the repo git dir, and an inherited GIT_DIR never redirects it', (t) => {
  const { fx, env } = setup(t);
  const decoy = path.join(fx.other, '.git');
  const g = makeGit({ root: fx.work, env: { ...env, GIT_DIR: decoy } });
  assert.strictEqual(fs.realpathSync(absoluteGitDir(g)), fs.realpathSync(path.join(fx.work, '.git')));
});
