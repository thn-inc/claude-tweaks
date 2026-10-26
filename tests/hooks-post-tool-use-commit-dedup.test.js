// tests/hooks-post-tool-use-commit-dedup.test.js
// #2553: a commit/push breadcrumb that is already recorded in this run's
// events.jsonl (a repeated PostToolUse firing for the same real git action)
// must not be logged a second time — dedupe on the tuple (action, hash, dir).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const post = require('../plugin/bin/lib/hooks/post-tool-use');

function gitEnv() {
  return { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dedup-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q'], { env: gitEnv() });
  return fs.realpathSync(dir);
}

function makeRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dedup-run-'));
}

function runPost(repo, runDir, command) {
  return post.run({
    input: { tool_name: 'Bash', tool_input: { command }, cwd: repo },
    runDir, runState: { status: 'active' }, ownedRun: { dir: runDir, attribution: 'session' }, cwd: repo,
  });
}

function readEvents(runDir) {
  const raw = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('a repeated PostToolUse firing for the SAME commit logs the breadcrumb only once', () => {
  const repo = initRepo();
  const runDir = makeRunDir();
  runPost(repo, runDir, 'git commit -m "feature work"');
  runPost(repo, runDir, 'git commit -m "feature work"'); // repeated firing — no new real commit in between
  const events = readEvents(runDir).filter((e) => e.type === 'commit');
  assert.strictEqual(events.length, 1, 'expected exactly one commit breadcrumb, not a duplicate');
  assert.strictEqual(events[0].action, 'commit');
});

test('a genuinely NEW commit after a logged one is NOT deduped away', () => {
  const repo = initRepo();
  const runDir = makeRunDir();
  runPost(repo, runDir, 'git commit -m "feature work"');
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'second real commit', '-q'], { env: gitEnv() });
  runPost(repo, runDir, 'git commit -m "feature work"');
  const events = readEvents(runDir).filter((e) => e.type === 'commit');
  assert.strictEqual(events.length, 2, 'two distinct real commits must both be logged');
  assert.notStrictEqual(events[0].hash, events[1].hash);
});

test('a repeated PostToolUse firing for the SAME push logs the breadcrumb only once', () => {
  const repo = initRepo();
  const runDir = makeRunDir();
  runPost(repo, runDir, 'git push origin main');
  runPost(repo, runDir, 'git push origin main'); // repeated firing — HEAD unchanged in between
  const events = readEvents(runDir).filter((e) => e.type === 'commit' && e.action === 'push');
  assert.strictEqual(events.length, 1, 'expected exactly one push breadcrumb, not a duplicate');
  assert.ok(events[0].hash, 'push breadcrumb should carry the pushed HEAD hash');
});

test('a push after a new commit (different HEAD) is NOT deduped away', () => {
  const repo = initRepo();
  const runDir = makeRunDir();
  runPost(repo, runDir, 'git push origin main');
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'advance HEAD', '-q'], { env: gitEnv() });
  runPost(repo, runDir, 'git push origin main');
  const events = readEvents(runDir).filter((e) => e.type === 'commit' && e.action === 'push');
  assert.strictEqual(events.length, 2, 'two pushes of different HEADs must both be logged');
  assert.notStrictEqual(events[0].hash, events[1].hash);
});

// #4303 (P1): past the shell scanner's cwd cap the git command's dir is only the walk's start
// (marked `lost`). From a worktree nested at M/.claude/worktrees/x, `G20 cd ../../..; git commit`
// (20 failing groups `{ cd /tmp/ct-4303-nK; }`): bash 3.2 and 5 commit in M. Base d9aa6b82d through
// 3b26440ad logged M; 4e7d54a9d logged the worktree and its stale HEAD. The breadcrumb now names the
// candidate checkout with the fresh commit. The fixture makes bash's commit; the init commit is old.
test('#4303: a commit past the cwd cap is logged in the checkout bash made it in, not the walk\'s start', () => {
  const main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dedup-')));
  execFileSync('git', ['-C', main, 'init', '-q']);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-m', 'init', '-q'], { env: { ...gitEnv(), GIT_AUTHOR_DATE: '2020-01-01T00:00:00', GIT_COMMITTER_DATE: '2020-01-01T00:00:00' } });
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-m', 'work', '-q'], { env: gitEnv() });
  const head = execFileSync('git', ['-C', main, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const runDir = makeRunDir();
  const groups = Array.from({ length: 20 }, (_, i) => `{ cd /tmp/ct-4303-n${i}; }; `).join('');
  runPost(wt, runDir, `${groups}cd ../../..; git commit --allow-empty -qm work`);
  const events = readEvents(runDir).filter((e) => e.type === 'commit' && e.hash === head);
  assert.strictEqual(events.length, 1, JSON.stringify(readEvents(runDir)));
  assert.strictEqual(path.resolve(events[0].dir), main);
});

// #4303: a candidate counts only with a fresh commit, so a newer but stale commit in the main
// checkout is never logged as the lost commit's: with no fresh commit anywhere (the commit did not
// land) the breadcrumb stays at the walk's start, as before #4303.
test('#4303: a stale commit in another candidate checkout is never logged for a commit past the cwd cap', () => {
  const old = (date) => ({ env: { ...gitEnv(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  const main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dedup-')));
  execFileSync('git', ['-C', main, 'init', '-q']);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-m', 'init', '-q'], old('2020-01-01T00:00:00'));
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-m', 'later, still old', '-q'], old('2021-01-01T00:00:00'));
  const runDir = makeRunDir();
  const groups = Array.from({ length: 20 }, (_, i) => `{ cd /tmp/ct-4303-n${i}; }; `).join('');
  runPost(wt, runDir, `${groups}cd ../../..; git commit --allow-empty -qm work`);
  const dirs = readEvents(runDir).filter((e) => e.type === 'commit').map((e) => path.resolve(e.dir));
  assert.ok(dirs.includes(wt) && !dirs.includes(main), JSON.stringify(dirs));
});

test('commit and push targets in ONE compound-resolved command never collide with each other\'s dedup key', () => {
  // Different actions at the same dir/hash must not be treated as the same tuple.
  const repo = initRepo();
  const runDir = makeRunDir();
  runPost(repo, runDir, 'git commit -m "x"');
  runPost(repo, runDir, 'git push origin main'); // same HEAD hash as the commit above, different action
  const events = readEvents(runDir).filter((e) => e.type === 'commit');
  assert.strictEqual(events.length, 2);
  assert.deepStrictEqual(events.map((e) => e.action).sort(), ['commit', 'push']);
});
