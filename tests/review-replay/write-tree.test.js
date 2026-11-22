'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { defaultDeps } = require('../../tools/review-replay');

// The real writeTree against a real throwaway repo: a committed .claude-tweaks/policy.yml belongs in the replay tree,
// the pipelines directory (the archived run's own records) does not.
test('writeTree keeps committed .claude-tweaks files and leaves out .claude-tweaks/pipelines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-wt-'));
  const repo = path.join(root, 'repo');
  const dest = path.join(root, 'tree');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, encoding: 'utf8', windowsHide: true });
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const before = process.cwd();
  try {
    fs.mkdirSync(repo);
    git('init', '-q');
    put('src/a.js', 'a\n');
    put('.claude-tweaks/policy.yml', 'a: 1\n');
    put('.claude-tweaks/pipelines/p/work/9-spec.md', 'spec\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    const head = git('rev-parse', 'HEAD').trim();
    process.chdir(repo);
    const deps = defaultDeps();
    process.chdir(before);
    deps.writeTree(head, dest);
    assert.ok(fs.existsSync(path.join(dest, 'src', 'a.js')));
    assert.ok(fs.existsSync(path.join(dest, '.claude-tweaks', 'policy.yml')));
    assert.ok(!fs.existsSync(path.join(dest, '.claude-tweaks', 'pipelines')));
  } finally {
    process.chdir(before);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
