'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkFirstCallArtifacts } = require('../../../plugin/bin/lib/dispatch/first-call-artifact-check');
const { claimFilePath } = require('../../../plugin/bin/lib/issues/claims');

const REPO_SLUG = 'acme/widgets';
const RUN_ID = '2026-09-29T154722-record-2806';
const NOW = Date.parse('2026-09-29T16:00:00Z');

function mkRunDir() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-first-call-check-'));
  return path.join(parent, RUN_ID);
}

function writeRunDir(runDir, { runState, config }) {
  fs.mkdirSync(runDir, { recursive: true });
  if (runState !== undefined) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  if (config !== undefined) fs.writeFileSync(path.join(runDir, 'config.yml'), config);
}

function liveClaimContent(runId) {
  return JSON.stringify({
    runId, sessionId: 's1', claimedAt: new Date(NOW).toISOString(), ttlHours: 72, host: 'h',
  });
}

// Fake ghApi mirrors claim-store.test.js's own shape: non-throwing, branches on the
// exact contents-API read args readClaimBlobContentsApi issues, throws on anything
// else so a wrong endpoint fails the test loudly rather than silently passing.
function fakeGhApi(claimsByIssue) {
  return (args) => {
    for (const [issueNumber, content] of Object.entries(claimsByIssue)) {
      const expected = `repos/${REPO_SLUG}/contents/${claimFilePath(issueNumber)}?ref=claims-registry`;
      if (args[0] === expected) {
        if (content === null) return { stdout: null, failure: null, status: 404 };
        return { stdout: JSON.stringify({ content, sha: 'deadbeef' }), failure: null, status: null };
      }
    }
    throw new Error(`unexpected gh api call: ${args.join(' ')}`);
  };
}

function fakeGitRunner(pushedBranches) {
  return (args) => {
    assert.deepEqual(args.slice(0, 3), ['ls-remote', '--heads', 'origin'], `unexpected git call: ${args.join(' ')}`);
    const branch = args[3];
    return pushedBranches.includes(branch) ? `abc123\trefs/heads/${branch}\n` : '';
  };
}

test('fully-formed pr-first run passes: claim live under this run, PR recorded and branch pushed', () => {
  const runDir = mkRunDir();
  writeRunDir(runDir, {
    runState: { pr: { number: 42, url: 'https://github.com/acme/widgets/pull/42', branch: 'worktree-2806' } },
    config: 'integration-model: pr-first\nautonomy: trusted\n',
  });
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    gitRunner: fakeGitRunner(['worktree-2806']),
    now: NOW,
  });
  assert.deepEqual(result, { ok: true });
});

test('fails with a distinct reason when run-state.json is missing', () => {
  const runDir = mkRunDir();
  writeRunDir(runDir, { config: 'integration-model: local-merge\n' });
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-run-state');
});

test('fails with a distinct reason when config.yml is missing', () => {
  const runDir = mkRunDir();
  writeRunDir(runDir, { runState: {} });
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-config');
});

test('fails with a distinct reason when the claim is absent (#2806 attempt-1 symptom)', () => {
  const runDir = mkRunDir();
  writeRunDir(runDir, { runState: {}, config: 'integration-model: local-merge\n' });
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: null }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'claim-absent');
});

test('fails with a distinct reason when the claim is live under a different runId', () => {
  const runDir = mkRunDir();
  writeRunDir(runDir, { runState: {}, config: 'integration-model: local-merge\n' });
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent('some-other-run-id') }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'claim-run-id-mismatch');
  assert.match(result.message, /some-other-run-id/);
});

test('fails with a distinct reason under pr-first when run-state.json records no PR', () => {
  const runDir = mkRunDir();
  writeRunDir(runDir, { runState: {}, config: 'integration-model: pr-first\n' });
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'pr-missing');
});

test('fails with a distinct reason under pr-first when the recorded PR\'s head branch is unpushed', () => {
  const runDir = mkRunDir();
  writeRunDir(runDir, {
    runState: { pr: { number: 42, url: 'https://github.com/acme/widgets/pull/42', branch: 'worktree-2806' } },
    config: 'integration-model: pr-first\n',
  });
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    gitRunner: fakeGitRunner([]), // nothing pushed to origin
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'pr-branch-unpushed');
});
