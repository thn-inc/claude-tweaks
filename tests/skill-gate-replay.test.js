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

test('a test file a journey lists in files: proceeds, and is not a guard-off skip', { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, 'docs/journeys'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/journeys/j.md'), '---\nfiles:\n  - tests/listed.test.js\n---\n# j\n');
  git(repo, 'add', '--', 'docs/journeys/j.md');
  git(repo, 'commit', '--amend', '-q', '-m', '[reconcile] init');
  commit(repo, 'Touch the listed test', { 'tests/listed.test.js': 'x\n' });
  commit(repo, 'Touch an unlisted test', { 'tests/other.test.js': 'x\n' });

  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31' });
  assert.equal(r.commits, 2);
  assert.deepEqual(r.results.journeys, { skip: 1, proceed: 1 });
  assert.equal(r.journeysSkipsWithoutJourneyGuard, 1);
});

test("each commit's own CLAUDE.md design-integration flag reaches the design-wrapper rules", { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'commit', '--allow-empty', '--amend', '-q', '-m', '[reconcile] init');
  commit(repo, 'Touch a UI file, no flag', { 'app/page.tsx': 'x\n' });
  commit(repo, 'Enable design integration', { 'CLAUDE.md': '## Design integration\n\ndesign-integration: enabled\n' });
  commit(repo, 'Touch a UI file, flag on', { 'app/other.tsx': 'x\n' });

  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31' });
  assert.equal(r.commits, 3);
  // Only the third commit changes a UI file under an enabled flag; the first has none, the second no UI file.
  assert.deepEqual(r.results['design-wrapper test'], { skip: 2, proceed: 1 });
});

test('a path with a shape problem is not a guard-off skip', { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'commit', '--allow-empty', '--amend', '-q', '-m', '[reconcile] init');
  commit(repo, 'Add a test with a percent sign', { 'tests/100%.test.js': 'x\n' });

  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31' });
  assert.deepEqual(r.results.journeys, { skip: 0, proceed: 1 });
  assert.equal(r.journeysSkipsWithoutJourneyGuard, 0);
});

test('a symlinked journey is never read: that commit proceeds as cannot tell', { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const blob = git(repo, 'hash-object', '-w', '--stdin').trim();
  git(repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},docs/journeys/link.md`);
  git(repo, 'commit', '--amend', '-q', '-m', '[reconcile] init');
  commit(repo, 'Add a test', { 'tests/a.test.js': 'x\n' });

  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31' });
  assert.equal(r.commits, 1);
  assert.deepEqual(r.results.journeys, { skip: 0, proceed: 1 });
  assert.equal(r.journeysSkipsWithoutJourneyGuard, 0);
});

test('a root commit inside the window counts its files, whatever log.showRoot says', { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'config', 'log.showRoot', 'false');
  git(repo, 'checkout', '-q', '--orphan', 'rooted');
  commit(repo, 'Root with a test', { 'tests/r.test.js': 'x\n' });

  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31' });
  assert.equal(r.commits, 1);
  assert.deepEqual(r.results.journeys, { skip: 1, proceed: 0 });
});

test("a merge commit's files come from its first-parent diff only", { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'commit', '--allow-empty', '--amend', '-q', '-m', '[reconcile] init');
  git(repo, 'checkout', '-q', '-b', 'side');
  commit(repo, 'Side work', { 'tests/side.test.js': 'x\n' });
  git(repo, 'checkout', '-q', '-');
  commit(repo, 'Main work', { 'tests/a.test.js': 'x\n' });
  git(repo, 'merge', '--no-ff', '-q', '-m', 'Merge side', 'side');

  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31' });
  // --first-parent walks the merge and "Main work"; the merge's first-parent diff is tests/side.test.js.
  assert.equal(r.commits, 2);
  assert.deepEqual(r.results.journeys, { skip: 2, proceed: 0 });
});

test('journeys are read lazily: a commit with a UI file never lists docs/journeys', { timeout: FIXTURE_TIMEOUT_MS * 4 }, (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, 'docs/journeys'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/journeys/j.md'), '---\nfiles:\n  - src/x.js\n---\n# j\n');
  git(repo, 'add', '--', 'docs/journeys/j.md');
  git(repo, 'commit', '--amend', '-q', '-m', '[reconcile] init');
  commit(repo, 'Touch a UI file', { 'app/page.tsx': 'x\n' });

  const calls = [];
  const execImpl = (args, { input, latin1 } = {}) => {
    calls.push(args[0]);
    return fixtureGit(['-C', repo, ...args], { env: ENV, input, encoding: latin1 ? 'latin1' : 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  };
  const r = replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2099-12-31', execImpl });
  assert.equal(r.commits, 1);
  // app/page.tsx is outside the no-surface set (journeys proceeds) and a UI trigger (visual-review proceeds).
  assert.equal(r.results.journeys.proceed, 1);
  assert.equal(r.results['visual-review'].proceed, 1);
  assert.equal(calls.includes('ls-tree'), false);
});
