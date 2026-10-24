'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkFirstCallArtifacts, checkFirstCallStamp } = require('../../../plugin/bin/lib/dispatch/first-call-artifact-check');
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

// The /flow Step 2.8 claim line, one per member (claim-targets.md's "Log the claim").
function writeClaimLog(runDir, issueNumbers) {
  const lines = issueNumbers.map((n) => `- AUTO 20:02:17 — Step 2.8: claimed #${n} (bin/claim-targets.js, transport: git). Reversibility: high.`);
  fs.writeFileSync(path.join(runDir, 'decisions.md'), ['## /flow', ...lines, ''].join('\n'));
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
  writeClaimLog(runDir, [2806]);
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
  writeClaimLog(runDir, [2806, 2807]);
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
  writeClaimLog(runDir, [2806]);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.deepEqual(result, { ok: true });
});

test('passes when the header lives under work/ (not spec-{n}/work/) in the worktree mirror -- the pr-first singleton shape (#2775)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-first-call-mirror-singleton-'));
  const runDir = path.join(root, 'main', '.claude-tweaks', 'pipelines', RUN_ID);
  const worktree = path.join(root, 'wt');
  const deps = localMergeGroup(runDir, [2806], { worktree });
  writeHeader(path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID), 'work', 2806);
  writeClaimLog(runDir, [2806]);
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

// ---- #3577: check 6 -- the canonical Step 2.8 claim line in decisions.md ----

test('fails claim-log-missing when decisions.md lacks the canonical Step 2.8 line (#3577)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
  writeHeader(runDir, 'work', 2806);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'claim-log-missing');
  assert.match(result.message, /#2806/);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'repairable'), false);
});

test('passes once the canonical Step 2.8 line is written (#3577)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
  writeHeader(runDir, 'work', 2806);
  assert.equal(checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps).reason, 'claim-log-missing');
  writeClaimLog(runDir, [2806]);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.deepEqual(result, { ok: true });
});

test('names only the member whose line is missing in a multi-record group (#3577)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806, 2807]);
  writeHeader(runDir, 'work', 2806);
  writeHeader(runDir, 'work', 2807);
  writeClaimLog(runDir, [2806]);
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806, 2807], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'claim-log-missing');
  assert.match(result.message, /#2807/);
  assert.doesNotMatch(result.message, /#2806/);
});

test('a batch-summary or paraphrased claim line does not satisfy the canonical check (#3577)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
  writeHeader(runDir, 'work', 2806);
  fs.writeFileSync(path.join(runDir, 'decisions.md'), [
    '## /flow',
    '- AUTO 20:02:17 — Step 2.8: Claimed all 1 targets under run X (git). Reversibility: high.',
    '- AUTO 20:02:18 — claimed issue #2806 for this run via claim-targets. Reversibility: high.',
    '',
  ].join('\n'));
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'claim-log-missing');
});

test('an earlier failure still wins over a missing claim line (#3577)', () => {
  const runDir = mkRunDir();
  const deps = localMergeGroup(runDir, [2806]);
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
  writeClaimLog(passRun, [2806]);
  const pass = checkFirstCallArtifacts({ runDir: passRun, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    gitRunner: fakeGitRunner(['worktree-2806']),
    now: NOW,
  });
  assert.deepEqual(pass, { ok: true });
});

// ---- #3350: no integration-model pin -> the PR-bookend check degrades loudly, never silently ----

function pinRun(config) {
  const runDir = mkRunDir();
  writeRunDir(runDir, { runState: {}, config });
  return runDir;
}

function checkWithWarn(runDir, extra = {}) {
  const lines = [];
  const result = checkFirstCallArtifacts({ runDir, issueNumbers: [2806], repoSlug: REPO_SLUG }, {
    ghApi: fakeGhApi({ 2806: liveClaimContent(RUN_ID) }),
    now: NOW,
    warn: (line) => lines.push(line),
    ...extra,
  });
  return { result, lines };
}

test('AC2.1: with an integration-model: pr-first pin, the PR-bookend check runs -- no recorded PR fails pr-missing, no degrade line', () => {
  const { result, lines } = checkWithWarn(pinRun('integration-model: pr-first\n'));
  assert.equal(result.reason, 'pr-missing');
  assert.equal(lines.length, 0);
});

test('AC3.1: with no integration-model pin, a degrade line is emitted instead of passing silently', () => {
  const runDir = pinRun('autonomy: trusted\n');
  writeHeader(runDir, 'work', 2806);
  writeClaimLog(runDir, [2806]);
  const { result, lines } = checkWithWarn(runDir);
  assert.deepEqual(result, { ok: true });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^first-call-artifact-check: degraded — .*carries no valid integration-model pin/);
});

test('AC3.1: an invalid integration-model pin emits the same degrade line', () => {
  const runDir = pinRun('integration-model: bogus\n');
  writeHeader(runDir, 'work', 2806);
  writeClaimLog(runDir, [2806]);
  const { result, lines } = checkWithWarn(runDir);
  assert.deepEqual(result, { ok: true });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^first-call-artifact-check: degraded — .*carries no valid integration-model pin/);
});

test('a local-merge pin emits no degrade line', () => {
  const runDir = pinRun('integration-model: local-merge\n');
  writeHeader(runDir, 'work', 2806);
  writeClaimLog(runDir, [2806]);
  const { result, lines } = checkWithWarn(runDir);
  assert.deepEqual(result, { ok: true });
  assert.equal(lines.length, 0);
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

// ---- #3661: checkFirstCallStamp -- the first call's runner-written pass stamp at HEAD ----
// Every case injects `stampStatus` / `exists` except the last two, which exercise the real
// default report check and the real verify.js spawn (its worktree cwd) against temp fixtures.

const STAMP_REPORT = '/wt/.git/claude-tweaks-verify/report.json';

function stampRun(runState) {
  const runDir = mkRunDir();
  writeRunDir(runDir, { runState });
  return runDir;
}

function stampStub(status) {
  const calls = [];
  return { calls, fn: (worktree) => { calls.push(worktree); return status; } };
}

test('AC2.1: a stamp verifying HEAD with its report.json present passes unchanged', () => {
  const status = { present: true, verifiedHead: true, reportPath: STAMP_REPORT };
  const stub = stampStub(status);
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stub.fn,
    exists: (p) => p === STAMP_REPORT,
  });
  assert.deepEqual(result, { verified: true, reason: null, status });
  assert.deepEqual(stub.calls, ['/wt']);
});

test('AC1.1: no stamp at all (raw npm test first call) is detected as stamp-absent', () => {
  const status = { present: false, verifiedHead: false, reportPath: null };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => true,
  });
  assert.deepEqual(result, { verified: false, reason: 'stamp-absent', status });
});

test('AC1.1: a stamp that does not verify HEAD is stamp-not-head', () => {
  const status = { present: true, verifiedHead: false, reportPath: '/r.json' };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => true,
  });
  assert.deepEqual(result, { verified: false, reason: 'stamp-not-head', status });
});

test('report.json missing behind a verifying stamp is report-missing', () => {
  const status = { present: true, verifiedHead: true, reportPath: STAMP_REPORT };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => false,
  });
  assert.deepEqual(result, { verified: false, reason: 'report-missing', status });
});

test('no worktree recorded never reads a stamp', () => {
  const boom = () => { throw new Error('stampStatus must not be called without a recorded worktree'); };
  const noWorktree = checkFirstCallStamp({ runDir: stampRun({}) }, { stampStatus: boom, exists: () => true });
  assert.deepEqual(noWorktree, { verified: false, reason: 'worktree-unrecorded', status: null });

  const noRunState = mkRunDir();
  writeRunDir(noRunState, {});
  const absent = checkFirstCallStamp({ runDir: noRunState }, { stampStatus: boom, exists: () => true });
  assert.deepEqual(absent, { verified: false, reason: 'worktree-unrecorded', status: null });
});

test('an unreadable stamp read is stamp-read-failed, never a throw', () => {
  const runDir = stampRun({ worktree: '/wt' });
  const thrown = checkFirstCallStamp({ runDir }, {
    stampStatus: () => { throw new Error('verify.js exited 1'); },
    exists: () => true,
  });
  assert.deepEqual(thrown, { verified: false, reason: 'stamp-read-failed', status: null });

  const nonObject = checkFirstCallStamp({ runDir }, { stampStatus: () => null, exists: () => true });
  assert.deepEqual(nonObject, { verified: false, reason: 'stamp-read-failed', status: null });
});

test('a verifying stamp with no reportPath string is report-missing, never a pass', () => {
  const status = { present: true, verifiedHead: true, reportPath: null };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => true,
  });
  assert.deepEqual(result, { verified: false, reason: 'report-missing', status });
});

test('the default report check passes only a regular file -- a directory named report.json is report-missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-stamp-report-'));
  const asFile = path.join(dir, 'file-report.json');
  fs.writeFileSync(asFile, '{}');
  const asDir = path.join(dir, 'dir-report.json');
  fs.mkdirSync(asDir);
  const runDir = stampRun({ worktree: '/wt' });
  const verifies = (reportPath) => checkFirstCallStamp({ runDir }, {
    stampStatus: () => ({ present: true, verifiedHead: true, reportPath }),
  });
  assert.equal(verifies(asFile).verified, true);
  assert.equal(verifies(asDir).reason, 'report-missing');
  assert.equal(verifies(path.join(dir, 'absent.json')).reason, 'report-missing');
});

test('the default stampStatus spawns verify.js with the recorded worktree as cwd, not the test process cwd', () => {
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-stamp-repo-'));
  git(['init', '-q'], repo);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init'], repo);
  const head = git(['rev-parse', 'HEAD'], repo);
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: repo }) });
  assert.equal(result.reason, 'stamp-absent');
  assert.equal(result.verified, false);
  assert.equal(result.status.head, head);
  assert.notEqual(git(['rev-parse', 'HEAD'], process.cwd()), head, 'control: the test process cwd is a different repo');
});

// ---- #4006: a complete composed per-suite verdict stands in for the single stamp ----

test('AC8.1: a complete composed verdict with no single stamp verifies HEAD', () => {
  const status = { present: false, verifiedHead: true, reportPath: null, suiteComposed: { complete: true } };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => false,
  });
  assert.deepEqual(result, { verified: true, reason: null, status });
});

test('AC8.1: no stamp and no composition is still stamp-absent', () => {
  const status = { present: false, verifiedHead: false, reportPath: null, suiteComposed: null };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => true,
  });
  assert.deepEqual(result, { verified: false, reason: 'stamp-absent', status });
});

test('AC8.1: a single stamp whose reportPath is gone is still report-missing', () => {
  const status = { present: true, verifiedHead: true, reportPath: '/r.json', suiteComposed: null };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => false,
  });
  assert.deepEqual(result, { verified: false, reason: 'report-missing', status });
});

test('a complete composition supersedes the single stamp\'s missing reportPath', () => {
  const status = { present: true, verifiedHead: true, reportPath: '/missing.json', suiteComposed: { complete: true } };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => false,
  });
  assert.deepEqual(result, { verified: true, reason: null, status });
});

test('only a complete composition stands in for the stamp — complete: false with verifiedHead: true is still stamp-absent', () => {
  const status = { present: false, verifiedHead: true, reportPath: null, suiteComposed: { complete: false } };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, {
    stampStatus: stampStub(status).fn,
    exists: () => true,
  });
  assert.deepEqual(result, { verified: false, reason: 'stamp-absent', status });
});
