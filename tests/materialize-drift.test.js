// tests/materialize-drift.test.js
//
// #117 AC3: materialize.js reads a record's own Verified-as-of: freshness
// stamp (written by the four health-sweep skills via specShapedBody) and
// surfaces an explicit, actionable statement when the commit distance from
// that stamp to current HEAD crosses DRIFT_THRESHOLD_COMMITS. These tests
// drive run(argv, deps) end to end against a real temp git repo (so the
// [IL-127] anchoring guard passes for real) with gh/git calls faked.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run } = require('../plugin/bin/materialize');

const SHAPED_BODY_NO_STAMP = [
  'Surface: backend',
  '',
  '## Current State',
  'Some current state text.',
  '',
  '## Deliverables',
  '- [ ] do a thing',
  '',
  '## Acceptance Criteria',
  '1. It works',
  '',
  '## Release Note',
  'Fixed the thing.',
].join('\n');

function shapedBodyWithStamp(sha) {
  return [
    'Surface: backend',
    `Verified-as-of: ${sha}`,
    '',
    '## Current State',
    'Some current state text.',
    '',
    '## Deliverables',
    '- [ ] do a thing',
    '',
    '## Acceptance Criteria',
    '1. It works',
    '',
    '## Release Note',
    'Fixed the thing.',
  ].join('\n');
}

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function fakeDeps(root, { body, gitRevListCount, gitCommitDate }) {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => true,
    ghView: () => JSON.stringify({
      number: 117,
      title: 'Test record',
      body,
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/117',
    }),
    remoteUrl: () => { throw new Error('remoteUrl should never be called when --repo is passed explicitly'); },
    cwd: () => process.cwd(),
    mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
    isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
    cwdWorktreeRoot: (cwd) => {
      const info = wtDetect.repoInfo(cwd);
      return info.isLinkedWorktree ? info.repoRoot : null;
    },
    mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile: (file, content) => fs.writeFileSync(file, content),
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
    gitRevListCount: gitRevListCount || (() => { throw new Error('gitRevListCount should not be called — no stamp on this record'); }),
    gitCommitDate: gitCommitDate || (() => { throw new Error('gitCommitDate should not be called — no stamp on this record'); }),
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-117');
}

test('drift: no Verified-as-of line on the record -> drift is null, git rev-list never called', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, { body: SHAPED_BODY_NO_STAMP });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.drift, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
  });
});

test('drift: stamp present, commit distance below threshold -> drift.stale is false, no stderr warning', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithStamp('abc1234'),
      gitRevListCount: () => '3\n',
      gitCommitDate: () => '2026-08-01T00:00:00+00:00\n',
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.drift.sha, 'abc1234');
    assert.strictEqual(envelope.drift.commits, 3);
    assert.strictEqual(envelope.drift.stale, false);
    assert.deepStrictEqual(deps.calls.stderr, []);
  });
});

test('drift: stamp present, commit distance at/above threshold -> drift.stale true, actionable stderr line naming commits and sha', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithStamp('deadbee'),
      gitRevListCount: () => '340\n',
      gitCommitDate: () => '2026-05-01T00:00:00+00:00\n',
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.drift.commits, 340);
    assert.strictEqual(envelope.drift.stale, true);
    assert.strictEqual(deps.calls.stderr.length, 1);
    assert.match(deps.calls.stderr[0], /340 commits old/);
    assert.match(deps.calls.stderr[0], /deadbee/);
    assert.match(deps.calls.stderr[0], /re-derive facts/);
  });
});

test('drift: gitRevListCount throwing (stamped sha unreachable from HEAD) degrades to drift: null, never crashes the run', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithStamp('0000000'),
      gitRevListCount: () => { throw new Error('unknown revision or path not in the working tree'); },
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.drift, null);
  });
});

test('drift: gitCommitDate throwing still reports commits/stale — ageDays degrades to null, not a crash', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithStamp('cafe123'),
      gitRevListCount: () => '75\n',
      gitCommitDate: () => { throw new Error('no such commit'); },
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.drift.commits, 75);
    assert.strictEqual(envelope.drift.ageDays, null);
    assert.strictEqual(envelope.drift.stale, true);
  });
});
