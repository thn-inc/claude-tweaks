// tests/materialize-sibling-premise.test.js — #2590: materialize.js scans
// closed PRs referencing the target issue for language showing a sibling
// attempt already disproved the record's premise, before a fresh
// investigation is planned. Mirrors materialize-premise-check.test.js's
// fakeDeps shape and real-temp-git-repo harness.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
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

function baseDeps() {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => true,
    ghView: () => JSON.stringify({
      number: 2590, title: 'Test record', body: SHAPED_BODY, labels: [{ name: 'ceremony:standard' }], url: 'https://example.invalid/2590',
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
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-2590');
}

test('sibling-premise: deps.ghSearchClosedPRs not defined -> skipped entirely, no stderr, no decisions.md', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
    assert.ok(!fs.existsSync(path.join(runDir, 'decisions.md')));
  });
});

test('sibling-premise: no closed PR matches -> siblingPremiseDisproof null, one SCANNED entry logged, nothing staged', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    deps.ghSearchClosedPRs = () => JSON.stringify([{ number: 1, url: 'https://x/1', body: 'unrelated' }]);
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
    const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    assert.match(decisions, /SCANNED/);
    assert.match(decisions, /#2590/);
    assert.ok(!fs.existsSync(path.join(runDir, 'staged')));
  });
});

test('sibling-premise: a matching closed PR -> siblingPremiseDisproof populated, SCANNED entry cites it, staged note written, stderr note', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    deps.ghSearchClosedPRs = () => JSON.stringify([
      { number: 2560, url: 'https://github.com/o/r/pull/2560', body: 'Conclusion: premise no longer holds — all 9 tests pass.' },
    ]);
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.siblingPremiseDisproof, { number: 2560, url: 'https://github.com/o/r/pull/2560', matchedPhrase: 'premise no longer holds' });
    assert.strictEqual(deps.calls.stderr.length, 1);
    assert.match(deps.calls.stderr[0], /#2560/);

    const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    assert.match(decisions, /SCANNED/);
    assert.match(decisions, /#2560/);

    const stagedFile = path.join(runDir, 'staged', 'sibling-premise-disproof-2590.md');
    assert.ok(fs.existsSync(stagedFile));
    const staged = fs.readFileSync(stagedFile, 'utf8');
    assert.match(staged, /#2560/);
    assert.match(staged, /premise no longer holds/);
  });
});

test('sibling-premise: a throwing/unparseable search degrades to null, never crashes, no stderr', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = baseDeps();
    deps.ghSearchClosedPRs = () => { throw new Error('gh: rate limited'); };
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
  });
});

test('sibling-premise: --record-json path never calls ghSearchClosedPRs (gh-backed only)', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const recordJsonPath = path.join(repo, 'record.json');
    fs.writeFileSync(recordJsonPath, JSON.stringify({
      number: 2590, title: 'Test record', body: SHAPED_BODY, labels: [{ name: 'ceremony:standard' }], url: 'https://example.invalid/2590',
    }));
    const deps = baseDeps();
    deps.readFile = (file) => fs.readFileSync(file, 'utf8');
    deps.ghSearchClosedPRs = () => { throw new Error('ghSearchClosedPRs should never be called on the --record-json path'); };
    const runDir = runDirFor(repo);
    const exitCode = run(['2590', '--run-dir', runDir, '--record-json', recordJsonPath], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.siblingPremiseDisproof, null);
  });
});
