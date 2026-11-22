'use strict';
// Test git pinned away from the host (#5846): an empty file stands in for the global and
// system git config (so a host's maintenance.auto, receive.autogc or signing cannot leak
// into a fixture) and a fixed author and committer. One definition, so a change to what is
// pinned is made once. The env is built per call, never cached: a template build appends
// maintenance-off keys to process.env, and an early snapshot would miss them.
const fs = require('fs');
const { scratchDir } = require('./tmp-dir');
const os = require('os');
const path = require('path');
const { fixtureGit } = require('./git-fixtures');

let emptyConfig;
function emptyGitConfig() {
  if (!emptyConfig) {
    const dir = scratchDir('ct-gt-cfg-');
    emptyConfig = path.join(dir, 'empty');
    fs.writeFileSync(emptyConfig, '');
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return emptyConfig;
}

function pinnedGitEnv() {
  const cfg = emptyGitConfig();
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
    GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_SYSTEM: cfg,
  };
}

function pinnedGit(cwd, args, env = pinnedGitEnv()) {
  return fixtureGit(args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

module.exports = {
  // A getter, so the file is created on first read, not when the module loads.
  get EMPTY_GIT_CONFIG() { return emptyGitConfig(); },
  pinnedGitEnv,
  pinnedGit,
};
