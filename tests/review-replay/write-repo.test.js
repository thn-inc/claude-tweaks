'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeWriteRepo } = require('../../tools/review-replay');
const { scratchDir } = require('../helpers/tmp-dir');

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
    assert.ok(!fs.existsSync(path.join(d1, '.claude-tweaks', 'pipelines')));
    assert.equal(git(d1, 'rev-parse', 'origin/main'), r1.base);

    const r2 = writeRepo(B, H, path.join(root, 'd2'));
    assert.deepEqual(r2, r1);
  } finally {
    if (prior === undefined) delete process.env.GIT_AUTHOR_NAME;
    else process.env.GIT_AUTHOR_NAME = prior;
  }
});
