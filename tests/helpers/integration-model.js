// tests/helpers/integration-model.js — fixtures shared by tests/integration-model*.test.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathWithOnly } = require('./path-stub');

function gitRepo({ remote } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-intmodel-')));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  if (remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
  return dir;
}

// Fakes "gh absent, git present" without an empty PATH — blanking PATH
// entirely would also break the git remote-get-url probe that must keep
// succeeding. pathWithOnly resolves git via the *current* PATH and returns
// git's own directory as the override PATH; on some machines (this repo's dev
// environment included) git and gh live in the SAME directory (e.g. both
// under /opt/homebrew/bin via Homebrew), so when that directory also holds gh
// it substitutes a scratch dir holding only a git symlink — git resolves, gh
// does not.
function ghAbsentPath() {
  return pathWithOnly(['git'], { exclude: ['gh'] });
}

const GH_REMOTE = 'https://github.com/o/n.git';
const TIMEOUT_ENV = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';

// Runs fn with CLAUDE_TWEAKS_GH_TIMEOUT_MS set to `value` (undefined -> deleted),
// then restores the original — deleted when it was originally unset.
function withTimeoutEnv(value, fn) {
  const original = process.env[TIMEOUT_ENV];
  if (value === undefined) delete process.env[TIMEOUT_ENV];
  else process.env[TIMEOUT_ENV] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[TIMEOUT_ENV];
    else process.env[TIMEOUT_ENV] = original;
  }
}

function writePolicy(dir, text) {
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), text);
}

module.exports = { gitRepo, ghAbsentPath, GH_REMOTE, TIMEOUT_ENV, withTimeoutEnv, writePolicy };
