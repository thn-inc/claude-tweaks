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
