// tests/materialize-premise-check.test.js
//
// #1829: materialize.js reads a record's own Premise-check: command (written
// via specShapedBody's premiseCheck param) and runs it from the checkout
// root to say whether the record's Current State claim still holds at this
// checkout's base — a positive, mechanical confirmation, unlike the
// freshness-stamp drift (materialize-drift.test.js) which can only say the
// premise MIGHT be stale. These tests drive run(argv, deps) end to end
// against a real temp git repo (so the [IL-127] anchoring guard passes for
// real, and a staged proposal actually lands on disk) with gh/git calls and
// the premise-check runner faked.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run } = require('../plugin/bin/materialize');

const SHAPED_BODY_NO_PREMISE_CHECK = [
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
].join('\n');

function shapedBodyWithPremiseCheck(command) {
  return [
    'Surface: backend',
    `Premise-check: ${command}`,
    '',
    '## Current State',
    'CLAUDE.md is 205 lines vs the 150-line budget.',
    '',
    '## Deliverables',
    '- [ ] trim CLAUDE.md',
    '',
    '## Acceptance Criteria',
    '1. CLAUDE.md is under budget',
  ].join('\n');
}

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function fakeDeps(root, { body, runPremiseCheck }) {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => true,
    ghView: () => JSON.stringify({
      number: 1829,
      title: 'Test record',
      body,
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/1829',
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
    gitRevListCount: () => { throw new Error('gitRevListCount should not be called — no Verified-as-of stamp on this record'); },
    gitCommitDate: () => { throw new Error('gitCommitDate should not be called — no Verified-as-of stamp on this record'); },
    runPremiseCheck: runPremiseCheck || (() => { throw new Error('runPremiseCheck should not be called — no Premise-check: line on this record'); }),
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-1829');
}

test('premise: no Premise-check: line on the record -> premise is null, runner never called', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, { body: SHAPED_BODY_NO_PREMISE_CHECK });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
    assert.ok(!fs.existsSync(path.join(runDir, 'staged')), 'no staged/ directory is created when there is nothing to stage');
  });
});

test('premise: command exits 0 (premise still holds) -> satisfiedAtBase false, no stderr, nothing staged', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('test 1 -eq 1'),
      runPremiseCheck: () => 0,
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.premise, { command: 'test 1 -eq 1', exit: 0, satisfiedAtBase: false });
    assert.deepStrictEqual(deps.calls.stderr, []);
    assert.ok(!fs.existsSync(path.join(runDir, 'staged')));
  });
});

test('premise: command exits non-zero (premise no longer holds) -> satisfiedAtBase true, stderr sentence, STAGED decision + staged close note written', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('test $(wc -l < CLAUDE.md) -gt 150'),
      runPremiseCheck: () => 1,
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0);
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.premise, { command: 'test $(wc -l < CLAUDE.md) -gt 150', exit: 1, satisfiedAtBase: true });
    assert.strictEqual(deps.calls.stderr.length, 1);
    assert.match(deps.calls.stderr[0], /premise already satisfied at base/);
    assert.match(deps.calls.stderr[0], /exited 1/);

    const decisionsPath = path.join(runDir, 'decisions.md');
    assert.ok(fs.existsSync(decisionsPath), 'decisions.md was written');
    const decisions = fs.readFileSync(decisionsPath, 'utf8');
    assert.match(decisions, /STAGED/);
    assert.match(decisions, /Premise-check/);
    assert.match(decisions, /#1829/);

    const stagedFile = path.join(runDir, 'staged', 'premise-satisfied-1829.md');
    assert.ok(fs.existsSync(stagedFile), 'a staged close proposal was written');
    const staged = fs.readFileSync(stagedFile, 'utf8');
    assert.match(staged, /close #1829/);
    assert.match(staged, /already satisfied/);
  });
});

test('premise: a throwing runner (command could not be run at all) degrades to premise: null, never crashes the run', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('some-command'),
      runPremiseCheck: () => { throw new Error('spawnSync /bin/sh ENOENT'); },
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
  });
});
