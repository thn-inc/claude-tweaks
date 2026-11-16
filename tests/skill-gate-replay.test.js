'use strict';
// AC15 (#5605): the replay over a fixture repository with three work commits — tests only; a journey file
// beside tests; a source file — counts one journeys skip, two proceeds, and no wrong skip.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gitRepo, fixtureGit, FIXTURE_TIMEOUT_MS, cleanGitEnv } = require('./helpers/git-fixtures');
const { replay } = require('../tools/skill-gate-replay');

const ENV = {
  ...cleanGitEnv(),
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(dir, ...args) {
  return fixtureGit(['-C', dir, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commit(dir, subject, files) {
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
    git(dir, 'add', '--', name);
  }
  git(dir, 'commit', '-q', '-m', subject);
}

test('AC15.1: three work commits give one journeys skip, two proceeds, wrong-skip count 0', { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'commit', '--allow-empty', '--amend', '-q', '-m', '[reconcile] init');
  commit(repo, 'Add a test', { 'tests/a.test.js': 'x\n' });
  commit(repo, 'Add a journey', { 'docs/journeys/a.md': '# a\n', 'tests/b.test.js': 'x\n' });
  commit(repo, 'Add source', { 'src/x.js': 'x\n' });

  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31' });
  assert.equal(r.commits, 3);
  assert.deepEqual(r.results.journeys, { skip: 1, proceed: 2 });
  assert.equal(r.journeysWrongSkips, 0);
  assert.equal(r.journeysSkipsWithoutJourneyGuard, 1);
  assert.equal(r.journeysWrongSkipsWithoutJourneyGuard, 0);
  // No surface and no UI file anywhere: every other key is covered and counts all three commits.
  assert.deepEqual(Object.keys(r.results).sort(), [
    'design-wrapper polish', 'design-wrapper pre-build', 'design-wrapper review', 'design-wrapper survey',
    'design-wrapper test', 'journeys', 'visual-review',
  ]);
  for (const v of Object.values(r.results)) assert.equal(v.skip + v.proceed, 3);
});
