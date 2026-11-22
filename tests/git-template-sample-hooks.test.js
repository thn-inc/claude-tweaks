// tests/git-template-sample-hooks.test.js — the sample-hook check for fixture repos (#5771), moved
// out of tests/helpers-git-template.test.js: it starts two node children, and
// tests/count-node-procs.test.js pins that file at one node process.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fixtureGit, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');
const { writeGitTemplateDir, runnerChildEnv } = require('../tools/run-tests');

const scratch = [];
after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
function mk(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(d);
  return d;
}

// An empty config file pinned as the global/system config, so a host's own
// git config cannot leak in.
const EMPTY_CONFIG = path.join(mk('ct-gt-cfg-'), 'empty');
fs.writeFileSync(EMPTY_CONFIG, '');
// Built per call, never at load: a template build appends maintenance-off keys
// to process.env at build time, and a load-time snapshot would miss them.
const gitEnv = () => ({
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_CONFIG_SYSTEM: EMPTY_CONFIG,
});
function git(cwd, args, env = gitEnv()) {
  return fixtureGit(args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// #5771: git's default template copies 14 `*.sample` hooks into every repository a test creates.
// The runner's template drops them, and a bare `node --test` run gets the same template when it
// loads the helper (git-fixtures.js requires git-template.js).
test('AC2.1 AC2.2: a fixture repo made in a runner child and in a bare node --test run holds no sample hook', () => {
  const base = gitEnv();
  for (const k of Object.keys(base)) if (/^(GIT_TEMPLATE_DIR|GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+))$/.test(k)) delete base[k];
  const samplesIn = (gitDir) => {
    assert.ok(fs.statSync(path.join(gitDir, 'hooks')).isDirectory(), `${gitDir}/hooks is a directory`);
    return fs.readdirSync(path.join(gitDir, 'hooks')).filter((n) => n.endsWith('.sample'));
  };

  const control = mk('ct-gt-ac2-ctl-');
  git(control, ['init', '-q'], base);
  assert.notDeepStrictEqual(samplesIn(path.join(control, '.git')), [], 'control: a plain git init without the helper holds sample hooks');

  const fixtures = path.join(__dirname, 'helpers', 'git-fixtures.js');
  const script = `const fs = require('fs'); const os = require('os'); const path = require('path');
const { initRepo, gitRepo } = require(${JSON.stringify(fixtures)});
const a = initRepo(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gt-ac2-')), { name: 't', email: 't@example.test' });
// gitRepo() removes its repository when this process exits, so what the test asserts is read here, not after.
const look = (repo) => ({ repo, hooksIsDir: fs.statSync(path.join(repo, '.git', 'hooks')).isDirectory(), samples: fs.readdirSync(path.join(repo, '.git', 'hooks')).filter((n) => n.endsWith('.sample')), infoIsDir: fs.statSync(path.join(repo, '.git', 'info')).isDirectory() });
process.stdout.write(JSON.stringify([a, gitRepo()].map(look)));
fs.rmSync(a, { recursive: true, force: true });`;
  const runnerEnv = runnerChildEnv(base, { runRoot: mk('ct-gt-ac2-run-'), templateDir: writeGitTemplateDir(path.join(mk('ct-gt-ac2-tpl-'), 't'), base) });
  assert.strictEqual(typeof runnerEnv.GIT_TEMPLATE_DIR, 'string', 'the runner child has a template');
  const bareEnv = { ...base };
  delete bareEnv.GIT_TEMPLATE_DIR;
  delete bareEnv.CT_TEST_SUITE_SLOT_HELD;
  for (const [label, env] of [['runner child', runnerEnv], ['bare node --test', bareEnv]]) {
    const r = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', windowsHide: true, timeout: FIXTURE_TIMEOUT_MS });
    assert.strictEqual(r.status, 0, `${label}: ${r.stderr}`);
    const repos = JSON.parse(r.stdout);
    assert.strictEqual(repos.length, 2, label);
    for (const { repo, hooksIsDir, samples, infoIsDir } of repos) {
      assert.ok(hooksIsDir, `${repo}/.git/hooks is a directory`);
      assert.deepStrictEqual(samples, [], `${label}: ${repo}`);
      assert.ok(infoIsDir, `${label}: ${repo}/.git/info is a directory`);
    }
  }
});
