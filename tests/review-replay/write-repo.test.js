'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeWriteRepo } = require('../../tools/review-replay');
const { scratchDir } = require('../helpers/tmp-dir');
const { cleanEnv } = require('./reviews-fixture');

// The real writeRepo against a real throwaway source repo: base and head become two reproducible commits in a clean
// repository, the archived runs' own records are left out, and the ambient git identity never leaks in.
test('writeRepo builds a reproducible base/head repository without .claude-tweaks/pipelines', () => {
  const root = scratchDir('rr-wr-');
  const repo = path.join(root, 'repo');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', windowsHide: true }).trim();
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const prior = process.env.GIT_AUTHOR_NAME;
  process.env.GIT_AUTHOR_NAME = 'ci-bot';
  try {
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    put('src/a.js', 'a\n');
    put('.claude-tweaks/pipelines/p/work/9-spec.md', 'spec\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'B');
    const B = git(repo, 'rev-parse', 'HEAD');
    put('src/a.js', 'a2\n');
    put('src/b.js', 'b\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'H');
    const H = git(repo, 'rev-parse', 'HEAD');

    const writeRepo = makeWriteRepo(repo);
    const d1 = path.join(root, 'd1');
    const r1 = writeRepo(B, H, d1, { originRefs: ['main'] });
    assert.equal(git(d1, 'log', '--format=%s'), 'head\nbase');
    assert.equal(git(d1, 'diff', `${r1.base}...${r1.head}`, '--name-only'), 'src/a.js\nsrc/b.js');
    assert.equal(git(d1, 'log', '-1', '--format=%an'), 'review-replay');
    assert.equal(git(d1, 'log', '-1', '--format=%at %ct %ae %ce'), '946684800 946684800 review-replay@localhost review-replay@localhost');
    assert.ok(!fs.existsSync(path.join(d1, '.claude-tweaks', 'pipelines')));
    assert.equal(git(d1, 'rev-parse', 'origin/main'), r1.base);

    const r2 = writeRepo(B, H, path.join(root, 'd2'));
    assert.deepEqual(r2, r1);
  } finally {
    if (prior === undefined) delete process.env.GIT_AUTHOR_NAME;
    else process.env.GIT_AUTHOR_NAME = prior;
  }
});

// A source repo with commits built from { rel: text | null } maps (null deletes); returns the repo path and each sha.
function sourceRepo(root, commits) {
  const repo = path.join(root, 'repo');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env: cleanEnv(), encoding: 'utf8', windowsHide: true }).trim();
  fs.mkdirSync(repo);
  git('init', '-q');
  const shas = commits.map((files, i) => {
    for (const [rel, text] of Object.entries(files)) {
      const p = path.join(repo, rel);
      if (text === null) fs.rmSync(p, { force: true });
      else {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
      }
    }
    git('add', '-A', '-f');
    git('commit', '-q', '--allow-empty', '-m', `c${i}`);
    return git('rev-parse', 'HEAD');
  });
  return { repo, shas };
}

const inDest = (dest) => (...args) => execFileSync('git', args, { cwd: dest, env: cleanEnv(), encoding: 'utf8', windowsHide: true }).trim();

test('writeRepo shows a file head deletes as D and leaves it out of the replay head', () => {
  const root = scratchDir('rr-wr-');
  const { repo, shas: [B, H] } = sourceRepo(root, [{ 'src/a.js': 'a\n', 'src/gone.js': 'g\n' }, { 'src/gone.js': null, 'src/b.js': 'b\n' }]);
  const dest = path.join(root, 'd');
  const r = makeWriteRepo(repo)(B, H, dest);
  const out = inDest(dest);
  assert.ok(!fs.existsSync(path.join(dest, 'src', 'gone.js')));
  assert.equal(out('ls-tree', '-r', '--name-only', r.head), 'src/a.js\nsrc/b.js');
  assert.equal(out('diff', '--name-status', `${r.base}...${r.head}`), 'A\tsrc/b.js\nD\tsrc/gone.js');
});

test('writeRepo keeps a tracked file that a .gitignore rule matches', () => {
  const root = scratchDir('rr-wr-');
  const { repo, shas: [B, H] } = sourceRepo(root, [{ '.gitignore': 'kept.log\n', 'kept.log': 'one\n', 'src/a.js': 'a\n' }, { 'kept.log': 'two\n' }]);
  const dest = path.join(root, 'd');
  const r = makeWriteRepo(repo)(B, H, dest);
  const out = inDest(dest);
  assert.match(out('ls-tree', '-r', '--name-only', r.base), /^kept\.log$/m);
  assert.equal(out('diff', '--name-only', `${r.base}...${r.head}`), 'kept.log');
});

test('writeRepo ignores the user global git config', () => {
  const root = scratchDir('rr-wr-');
  const { repo, shas: [B, H] } = sourceRepo(root, [{ 'src/a.js': 'a\n' }, { 'src/b.js': 'b\n' }]);
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.gitconfig'), `[core]\n\thooksPath = ${home.replace(/\\/g, '/')}/hooks\n`);
  const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const r = makeWriteRepo(repo)(B, H, path.join(root, 'd'));
    assert.equal(inDest(path.join(root, 'd'))('diff', '--name-only', `${r.base}...${r.head}`), 'src/b.js');
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('writeRepo copes with a base whose tree is empty after the pipelines exclusion', () => {
  const root = scratchDir('rr-wr-');
  const { repo, shas: [B, H] } = sourceRepo(root, [{ '.claude-tweaks/pipelines/p/work/9-spec.md': 's\n' }, { 'src/a.js': 'a\n' }]);
  const dest = path.join(root, 'd');
  const r = makeWriteRepo(repo)(B, H, dest);
  const out = inDest(dest);
  assert.equal(out('ls-tree', '-r', '--name-only', r.base), '');
  assert.equal(out('diff', '--name-only', `${r.base}...${r.head}`), 'src/a.js');
});
