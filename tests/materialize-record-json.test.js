// tests/materialize-record-json.test.js
//
// #1459: bin/materialize.js's --record-json <path> flag lets a gh-absent
// caller (one with MCP issue_read access instead) supply an already-fetched
// record instead of asking this CLI to shell out to `gh` itself. Coverage
// follows the fakeDeps/gitRepo fixture pattern established in
// tests/materialize-drift.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run } = require('../plugin/bin/materialize');

const SHAPED_BODY = [
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

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

// A fakeDeps whose ghView/ghAvailable throw if called at all — proves the
// --record-json path never touches gh (AC1).
function fakeDepsNoGh({ readFile } = {}) {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => { throw new Error('ghAvailable should never be called when --record-json is passed'); },
    ghView: () => { throw new Error('ghView should never be called when --record-json is passed'); },
    remoteUrl: () => { throw new Error('remoteUrl should never be called when --record-json is passed'); },
    readFile: readFile || ((file) => fs.readFileSync(file, 'utf8')),
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
    gitRevListCount: () => { throw new Error('gitRevListCount should not be called — no stamp on this record'); },
    gitCommitDate: () => { throw new Error('gitCommitDate should not be called — no stamp on this record'); },
  };
}

// Mirrors tests/materialize-drift.test.js's ghAvailable:()=>false shape, plus
// readFile/ghView stubs that would fail loudly if reached.
function fakeDepsGhAbsent() {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => false,
    ghView: () => { throw new Error('ghView should not be called when gh is unavailable'); },
    remoteUrl: () => { throw new Error('remoteUrl should not be called when gh is unavailable'); },
    readFile: () => { throw new Error('readFile should not be called — no --record-json passed'); },
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
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-1459');
}

test('--record-json: succeeds without invoking gh, producing the same header shape as the gh-present path', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const recordFile = path.join(repo, 'record.json');
    fs.writeFileSync(recordFile, JSON.stringify({
      number: 1459,
      title: 'Test record',
      body: SHAPED_BODY,
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/1459',
    }));
    const deps = fakeDepsNoGh();
    const runDir = runDirFor(repo);
    const exitCode = run(['1459', '--run-dir', runDir, '--record-json', recordFile], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.record, 1459);
    const written = fs.readFileSync(envelope.file, 'utf8');
    assert.match(written, /^---\nrecord: 1459\n/);
    assert.match(written, /ceremony: standard/);
    assert.match(written, /surface: backend/);
    assert.match(written, /# 1459: Test record/);
  });
});

test('--record-json: a malformed JSON file exits 2, naming the file', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const recordFile = path.join(repo, 'record.json');
    fs.writeFileSync(recordFile, '{ not valid json');
    const deps = fakeDepsNoGh();
    const runDir = runDirFor(repo);
    const exitCode = run(['1459', '--run-dir', runDir, '--record-json', recordFile], deps);
    assert.strictEqual(exitCode, 2);
    const err = deps.calls.stderr.join('');
    assert.match(err, /Record #1459 could not be resolved/);
    assert.ok(err.includes(recordFile), `expected stderr to name the file ${recordFile}: ${err}`);
  });
});

test('--record-json: a nonexistent file exits 2, naming the file', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const recordFile = path.join(os.tmpdir(), 'does-not-exist-materialize-record-json.json');
    const deps = fakeDepsNoGh();
    const runDir = runDirFor(repo);
    const exitCode = run(['1459', '--run-dir', runDir, '--record-json', recordFile], deps);
    assert.strictEqual(exitCode, 2);
    const err = deps.calls.stderr.join('');
    assert.match(err, /Record #1459 could not be resolved/);
    assert.ok(err.includes(recordFile), `expected stderr to name the file ${recordFile}: ${err}`);
  });
});

test('gh absent, --record-json absent: exits 2 naming both the existing message and --record-json as the alternative', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDepsGhAbsent();
    const runDir = runDirFor(repo);
    const exitCode = run(['1459', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 2);
    const err = deps.calls.stderr.join('');
    assert.match(err, /`gh` is required/);
    assert.match(err, /--record-json/);
  });
});
