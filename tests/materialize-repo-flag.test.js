// tests/materialize-repo-flag.test.js
//
// #2444 review fix: a caller-supplied --repo can itself already be a
// host-qualified `host/owner/repo` slug (repoSlug()'s GHE output) — before
// this fix, --repo was always prefixed with `github.com/` regardless of
// shape, producing an unparseable 4-segment string for a slug like this.
// Mirrors tests/bin-lib/number-list-cli.test.js's #2425 review-fix pair.
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
].join('\n');

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function fakeDeps(seenGhView) {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => true,
    ghView: (owner, repo, n, host) => {
      seenGhView.push({ owner, repo, host });
      return JSON.stringify({
        number: n,
        title: 'Test record',
        body: SHAPED_BODY,
        labels: [{ name: 'ceremony:standard' }],
        url: 'https://example.invalid/117',
      });
    },
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
    gitRevListCount: () => { throw new Error('gitRevListCount should not be called — no stamp on this record'); },
    gitCommitDate: () => { throw new Error('gitCommitDate should not be called — no stamp on this record'); },
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-117');
}

test('#2444 fix: a host-qualified --repo slug resolves to its own host, not github.com', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const seen = [];
    const deps = fakeDeps(seen);
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'ghe.example.com/acme/widgets'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].owner, 'acme');
    assert.strictEqual(seen[0].repo, 'widgets');
    assert.strictEqual(seen[0].host, 'ghe.example.com');
  });
});

test('#2444 fix: a bare --repo owner/repo still resolves to host: github.com (unchanged)', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const seen = [];
    const deps = fakeDeps(seen);
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'someone/else'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].owner, 'someone');
    assert.strictEqual(seen[0].repo, 'else');
    assert.strictEqual(seen[0].host, 'github.com');
  });
});
