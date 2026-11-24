'use strict';
// The real-git fixture for the learned-skills rebuild tests (#6113): a bare origin with `main`, a clone,
// and a helper that pushes `learned-skills/{name}` branches cut from main's first commit. Built per call
// (a handful of git processes), not copied from a template.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { disableReceiveAutoGc } = require('./git-template');

const FILE = '.claude/skills/x/SKILL.md';
const BODY = '# x\n\n- one\n- two\n\nend\n';
const IDENT = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
};

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...IDENT }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
function write(repo, rel, text) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

// `t.after` removes the fixture. `body` is the base text of FILE; `extra` maps more base files to text.
function rebuildFixture(t, { body = BODY, extra = {} } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-rebuild-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const clone = path.join(root, 'clone');
  sh(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  disableReceiveAutoGc(origin);
  fs.mkdirSync(clone);
  sh(clone, ['init', '-q', '-b', 'main']);
  sh(clone, ['config', 'core.autocrlf', 'false']);
  sh(clone, ['remote', 'add', 'origin', origin]);
  write(clone, FILE, body);
  for (const [rel, text] of Object.entries(extra)) write(clone, rel, text);
  sh(clone, ['add', '-A']);
  sh(clone, ['commit', '-q', '-m', 'base']);
  sh(clone, ['push', '-q', 'origin', 'main']);
  const baseSha = sh(clone, ['rev-parse', 'HEAD']).trim();

  const rev = (cwd, ref) => sh(cwd, ['rev-parse', ref]).trim();
  // Commits on main's base and pushes learned-skills/{name}; `edit(repo, n)` changes the tree for commit n;
  // `commits` (default one) lists the trailer pairs per commit, [[run, entry], ...] each.
  function lsBranch(name, edit, commits = [[[name, 1]]]) {
    sh(clone, ['checkout', '-q', '-B', `learned-skills/${name}`, baseSha]);
    let sha = baseSha;
    commits.forEach((pairs, n) => {
      edit(clone, n);
      const trailers = pairs.map(([run, entry]) => `Learned-Skills-Run: ${run}\nLearned-Skills-Entry: ${entry}\n`).join('');
      sh(clone, ['add', '-A']);
      sh(clone, ['commit', '-q', '--allow-empty', '-m', `Add ${name} note ${n}\n\n${trailers}`]);
      sha = rev(clone, 'HEAD');
    });
    sh(clone, ['push', '-q', '--force', 'origin', `learned-skills/${name}`]);
    sh(clone, ['checkout', '-q', 'main']);
    return sha;
  }
  // Fast-forwards origin's main to `sha`.
  function advanceMain(sha) {
    sh(clone, ['merge', '-q', '--ff-only', sha]);
    sh(clone, ['push', '-q', 'origin', 'main']);
  }
  const originRef = (ref) => rev(origin, ref);
  return { root, origin, clone, baseSha, FILE, sh, write, rev, lsBranch, advanceMain, originRef };
}

module.exports = { rebuildFixture, sh, write, FILE, BODY };
