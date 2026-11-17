'use strict';
// Template-copy fixtures for stack-check.test.js (#5772): each fixture repo is built once per
// test process and copied per call, so a further call starts no git process
// (tests/helpers/git-template.js). No test runner import here: `t` may be null, and then no
// cleanup is registered (the caller removes `dir` itself).
//
// A copy's git calls run under FIXTURE_ENV, stack-check's own gitEnv() snapshot taken at load. gitEnv()
// strips GIT_CONFIG_*, so the maintenance-off keys git-template.js puts in process.env during a
// build never reach these calls: maintenance and auto-gc are switched off in the repo's own
// .git/config instead, which every copy carries.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FIXTURE_TIMEOUT_MS } = require('../../helpers/git-fixtures');
const { fromTemplate } = require('../../helpers/git-template');
const { gitEnv } = require('../../../plugin/bin/lib/staged-patch/stack-check');

const FIXTURE_ENV = gitEnv();
const BASE = ['l1', 'l2', 'l3', 'l4', 'anchor', 'a1', 'a2', 'a3'].join('\n') + '\n';

const REPO_CONFIG = '[user]\n\temail = stack-check@example.invalid\n\tname = stack-check\n'
  + '[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n';

const sha1 = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');

function helpers(dir, env = FIXTURE_ENV) {
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env });
  const runOk = (...args) => {
    const r = git(...args);
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  return { git, runOk };
}

// init, the repo-local config, then f.txt committed as `base`. The build takes gitEnv() at call
// time, not the load-time FIXTURE_ENV: the two differ only in variables set since load, and the
// config ones never reach git (gitEnv() pins GIT_CONFIG_GLOBAL and strips GIT_CONFIG_*), so the
// repo is the same, while a caller's GIT_TRACE2_EVENT reaches a build — which is what lets a
// "copy starts no git" test go red.
function buildBase(dir, content) {
  const { runOk } = helpers(dir, gitEnv());
  runOk('init', '-q');
  fs.appendFileSync(path.join(dir, '.git', 'config'), REPO_CONFIG);
  fs.writeFileSync(path.join(dir, 'f.txt'), content);
  runOk('add', 'f.txt');
  runOk('commit', '-q', '-m', 'base');
  return runOk;
}

function copy(t, key, build) {
  const dir = fromTemplate(key, build, { prefix: 'stack-check-' });
  if (t) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, ...helpers(dir) };
}

function gitFixture(t, content = BASE) {
  return copy(t, `stack-check:gitFixture:${sha1(content)}`, (dir) => { buildBase(dir, content); });
}

// A fixture repo with every `{name: content}` file committed. The key serializes `files` with each
// value type-tagged, so a string and a Buffer whose base64 equals it never share a template.
function repoWith(t, files) {
  const stable = Object.keys(files).sort().map((name) => {
    const v = files[name];
    return [name, Buffer.isBuffer(v) ? ['b', v.toString('base64')] : ['s', v]];
  });
  return copy(t, `stack-check:repoWith:${sha1(JSON.stringify(stable))}`, (dir) => {
    const runOk = buildBase(dir, BASE);
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
      runOk('add', name);
    }
    runOk('commit', '-q', '--allow-empty', '-m', 'files');
  });
}

module.exports = { gitFixture, repoWith, BASE, FIXTURE_ENV };
