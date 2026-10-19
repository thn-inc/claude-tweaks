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

function writeHeader(baseDir, relDir, n, recordLine = `record: ${n}`) {
  const dir = path.join(baseDir, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${n}-spec.md`), `---\n${recordLine}\n---\n# ${n}: title\n`);
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
  writeHeader(runDir, 'work', 2806);
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

function localMergeGroup(runDir, issueNumbers, runState = {}) {
  writeRunDir(runDir, { runState, config: 'integration-model: local-merge\n' });
  const claims = Object.fromEntries(issueNumbers.map((n) => [n, liveClaimContent(RUN_ID)]));
  return { ghApi: fakeGhApi(claims), now: NOW };
}

test('fails materialized-header-missing when a member has no header anywhere (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'materialized-header-missing');
  assert.match(result.message, /#2806/);
});

test('passes for a multi-record group whose headers live under spec-{n}/work/ (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806, 2807]);
  writeHeader(runDir, path.join('spec-2806', 'work'), 2806);
  writeHeader(runDir, path.join('spec-2807', 'work'), 2807);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806, 2807], repoSlug: REPO_SLUG }, deps);
  assert.deepEqual(result, { ok: true });
});

test('fails naming the one unmaterialized member of an otherwise-materialized group (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806, 2807]);
  writeHeader(runDir, path.join('spec-2806', 'work'), 2806);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806, 2807], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'materialized-header-missing');
  assert.match(result.message, /#2807/);
  assert.doesNotMatch(result.message, /#2806/);
});

test('passes when headers exist only in the worktree mirror of the run dir (pr-first shape, #2775)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-first-call-mirror-'));
  const runDir = path.join(root, 'main', '.claude-tweaks', 'pipelines', RUN_ID);
  const worktree = path.join(root, 'wt');
  const deps = localMergeGroup(runDir, [2806], { worktree });
  writeHeader(path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID), path.join('spec-2806', 'work'), 2806);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.deepEqual(result, { ok: true });
});

test('passes when the header lives under work/ (not spec-{n}/work/) in the worktree mirror -- the pr-first singleton shape (#2775)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-first-call-mirror-singleton-'));
  const runDir = path.join(root, 'main', '.claude-tweaks', 'pipelines', RUN_ID);
  const worktree = path.join(root, 'wt');
  const deps = localMergeGroup(runDir, [2806], { worktree });
  writeHeader(path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID), 'work', 2806);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.deepEqual(result, { ok: true });
});

test('a header whose record: line names a different number does not count (#2775)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
  writeHeader(runDir, 'work', 2806, 'record: 9999');
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'materialized-header-missing');
});

// ---- #3226: `repairable` classification of a missing-config first call ----

function repoRootWithPolicy(policyText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-first-call-repo-'));
  if (policyText !== null) {
    fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policyText);
  }
  return root;
}

function fakeRepoGit(root, pushedBranches, calls = []) {
  const lsRemote = fakeGitRunner(pushedBranches);
  return (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return `${root}\n`;
    return lsRemote(args);
  };
}

const PR_RECORDED = { pr: { number: 42, url: 'https://github.com/acme/widgets/pull/42', branch: 'worktree-2806' } };

function missingConfigRun(runState, deps, issueNumbers = [2806]) {
  const runDir = mkRunDir();
  writeRunDir(runDir, { runState });
  return checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug: REPO_SLUG }, { now: NOW, ...deps });
}

function assertMissingConfig(result, repairable) {
  assert.equal(result.reason, 'missing-config');
  assert.equal(result.repairable, repairable);
}

test('AC1.1: missing-config + live matching claim + pr-first PR recorded and pushed -> repairable: true', () => {
  const root = repoRootWithPolicy('integration-model: pr-first\n');
  const result = missingConfigRun(PR_RECORDED, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    gitRunner: fakeRepoGit(root, ['worktree-2806']),
  });
  assert.deepEqual(result, { ok: false, reason: 'missing-config', message: result.message, repairable: true });
});

test('AC2.1: missing-config + claim absent, stale, or held under another runId -> repairable: false', () => {
  const root = repoRootWithPolicy('integration-model: pr-first\n');
  const stale = JSON.stringify({
    runId: RUN_ID, sessionId: 's1', claimedAt: new Date(NOW - 100 * 3600 * 1000).toISOString(), ttlHours: 72, host: 'h',
  });
  const claims = [null, stale, liveClaimContent('other-run')];
  for (const claim of claims) {
    const r = missingConfigRun(PR_RECORDED, {
      ghApi: fakeGhApi({ 2806: claim }),
      gitRunner: fakeRepoGit(root, ['worktree-2806']),
    });
    assertMissingConfig(r, false);
  }
});

test('AC3.1: missing-config under pr-first with PR unrecorded, branch unrecorded, or branch unpushed -> repairable: false', () => {
  const root = repoRootWithPolicy('integration-model: pr-first\n');
  const cases = [
    [{}, ['worktree-2806']],
    [{ pr: { number: 42 } }, ['worktree-2806']],
    [PR_RECORDED, []],
  ];
  for (const [runState, pushed] of cases) {
    const r = missingConfigRun(runState, {
      ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
      gitRunner: fakeRepoGit(root, pushed),
    });
    assertMissingConfig(r, false);
  }
});

test('AC4.1: integration-model read fails (invalid value, policy.yml absent, readFile throws) -> repairable: false', () => {
  const ghApi = fakeGhApi({ 2806: liveClaimContent(RUN_ID) });
  const bogusRoot = repoRootWithPolicy('integration-model: bogus\n');
  const invalid = missingConfigRun(PR_RECORDED, { ghApi, gitRunner: fakeRepoGit(bogusRoot, ['worktree-2806']) });
  assertMissingConfig(invalid, false);

  const noPolicyRoot = repoRootWithPolicy(null);
  const absent = missingConfigRun(PR_RECORDED, { ghApi, gitRunner: fakeRepoGit(noPolicyRoot, ['worktree-2806']) });
  assertMissingConfig(absent, false);

  const okRoot = repoRootWithPolicy('integration-model: pr-first\n');
  const throwingRead = (p) => {
    if (p.endsWith('policy.yml')) throw new Error('EACCES: policy.yml unreadable');
    return fs.readFileSync(p, 'utf8');
  };
  const thrown = missingConfigRun(PR_RECORDED, {
    ghApi, gitRunner: fakeRepoGit(okRoot, ['worktree-2806']), readFile: throwingRead,
  });
  assertMissingConfig(thrown, false);
});

test('AC5.1: missing-config under local-merge with a live matching claim -> repairable: true from the claim checks alone', () => {
  const root = repoRootWithPolicy('integration-model: local-merge\n');
  const calls = [];
  const result = missingConfigRun({}, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    gitRunner: fakeRepoGit(root, [], calls),
  });
  assertMissingConfig(result, true);
  assert.equal(calls.some((a) => a[0] === 'ls-remote'), false);
});

test('Review focus: policy.yml without an integration-model key requires pr-first PR evidence', () => {
  const root = repoRootWithPolicy('autonomy: trusted\n');
  const ghApi = fakeGhApi({ 2806: liveClaimContent(RUN_ID) });

  const recordedAndPushed = missingConfigRun(PR_RECORDED, { ghApi, gitRunner: fakeRepoGit(root, ['worktree-2806']) });
  assertMissingConfig(recordedAndPushed, true);

  const noPr = missingConfigRun({}, { ghApi, gitRunner: fakeRepoGit(root, ['worktree-2806']) });
  assertMissingConfig(noPr, false);

  const unpushed = missingConfigRun(PR_RECORDED, { ghApi, gitRunner: fakeRepoGit(root, []) });
  assertMissingConfig(unpushed, false);
});

test('Review focus: one member live, another absent -> repairable: false', () => {
  const root = repoRootWithPolicy('integration-model: local-merge\n');
  const result = missingConfigRun({}, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID), 2807: null }),
    gitRunner: fakeRepoGit(root, []),
  }, [2806, 2807]);
  assertMissingConfig(result, false);
});

test('AC6.2: every reason other than missing-config, and ok: true, carries no repairable key', () => {
  const has = (r) => Object.prototype.hasOwnProperty.call(r, 'repairable');

  const absentRun = mkRunDir();
  writeRunDir(absentRun, { runState: {}, config: 'integration-model: local-merge\n' });
  const absent = checkFirstCallArtifacts({ runDir: absentRun, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: null }),
  });
  assert.equal(absent.reason, 'claim-absent');
  assert.equal(has(absent), false);

  const unpushedRun = mkRunDir();
  writeRunDir(unpushedRun, { runState: PR_RECORDED, config: 'integration-model: pr-first\n' });
  const unpushed = checkFirstCallArtifacts({ runDir: unpushedRun, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    gitRunner: fakeGitRunner([]),
    now: NOW,
  });
  assert.equal(unpushed.reason, 'pr-branch-unpushed');
  assert.equal(has(unpushed), false);

  const passRun = mkRunDir();
  writeRunDir(passRun, { runState: PR_RECORDED, config: 'integration-model: pr-first\n' });
  writeHeader(passRun, 'work', 2806);
  const pass = checkFirstCallArtifacts({ runDir: passRun, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    gitRunner: fakeGitRunner(['worktree-2806']),
    now: NOW,
  });
  assert.deepEqual(pass, { ok: true });
});

// #3226: resolveFirstCallGate -- the two-call gate's ordering as code (status line, then
// OUTCOME, then the artifact check). A repairable artifact never overrides the status line.
const { resolveFirstCallGate } = require('../../../plugin/bin/lib/dispatch/first-call-artifact-check');

const REPAIRABLE = { ok: false, reason: 'missing-config', message: 'm', repairable: true };
const gateReply = (status, outcome = 'build-test-ok') => `GROUP: 3226\nOUTCOME: ${outcome}\nMANIFEST: /x\n\n${status}\n`;

test('AC9.1: a malformed status line with a repairable artifact resolves blocked, never repair', () => {
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: DONE (backgrounded)'), artifact: REPAIRABLE }), 'blocked');
  assert.equal(resolveFirstCallGate({ reply: 'GROUP: 3226\nOUTCOME: build-test-ok\n', artifact: REPAIRABLE }), 'blocked');
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: BLOCKED'), artifact: REPAIRABLE }), 'blocked');
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: NEEDS_CONTEXT'), artifact: REPAIRABLE }), 'blocked');
});

test('resolveFirstCallGate: clean pair + repairable -> repair; ok -> dispatch; non-repairable or other reason -> artifact-failed', () => {
  for (const status of ['STATUS: DONE', 'STATUS: DONE_WITH_CONCERNS']) {
    assert.equal(resolveFirstCallGate({ reply: gateReply(status), artifact: REPAIRABLE }), 'repair');
    assert.equal(resolveFirstCallGate({ reply: gateReply(status), artifact: { ok: true } }), 'dispatch');
  }
  // the status line must match exactly -- trailing spaces are malformed; a CRLF terminator is not
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: DONE   '), artifact: REPAIRABLE }), 'blocked');
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: DONE').replace(/\n/g, '\r\n'), artifact: REPAIRABLE }), 'repair');
  const reply = gateReply('STATUS: DONE');
  assert.equal(resolveFirstCallGate({ reply, artifact: { ...REPAIRABLE, repairable: false } }), 'artifact-failed');
  assert.equal(resolveFirstCallGate({ reply, artifact: { ok: false, reason: 'claim-absent', message: 'm' } }), 'artifact-failed');
  assert.equal(resolveFirstCallGate({ reply, artifact: { ok: false, reason: 'missing-run-state', message: 'm', repairable: true } }), 'artifact-failed');
});

test('resolveFirstCallGate: OUTCOME already-shipped -> already-shipped; build-test-failed -> blocked', () => {
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: DONE', 'already-shipped'), artifact: undefined }), 'already-shipped');
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: DONE', 'build-test-failed'), artifact: undefined }), 'blocked');
  assert.equal(resolveFirstCallGate({ reply: 'STATUS: DONE\n', artifact: { ok: true } }), 'blocked');
  // absent artifact on an otherwise clean reply fails closed
  assert.equal(resolveFirstCallGate({ reply: gateReply('STATUS: DONE'), artifact: undefined }), 'artifact-failed');
});
