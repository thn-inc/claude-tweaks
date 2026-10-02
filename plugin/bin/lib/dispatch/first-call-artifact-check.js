'use strict';
// #2837: the two-call gate (`skills/dispatch/two-call-gate.md` section 2) used to dispatch
// the second (review,polish,wrap-up) call on a first call's self-reported `STATUS: DONE` /
// `OUTCOME: build-test-ok` alone -- a first call that never actually ran /flow (implemented
// the record directly, or backgrounded the pipeline) could still report that line and pass.
// This module is the mechanical artifact check that closes the gap: it reads the raw
// filesystem/claims-registry/origin state the first call's /flow invocation is supposed to
// have produced, rather than trusting anything the call said about itself -- the same
// "re-derive from raw artifacts, never a self-report" posture `artifact-verdict.js` (this
// directory) already applies to the test-output claim.
//
// Injectable-runner seam per the gh-api-module-pattern skill: `gitRunner` is the throwing
// argv-array seam (`(args) => stdout`, a non-zero exit throws); `ghApi` is claim-store.js's
// non-throwing `(args) => {stdout, failure, status}` seam, used only as readClaimBlob's
// contents-API fallback when git-CAS is unavailable. No real `gh`/`git` call in tests --
// every test below supplies a fake runner.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readClaimBlob, defaultGhApi } = require('../issues/claim-store');
const { classifyClaimBlob } = require('../issues/claims');
const { resolvePolicyKeys } = require('../policy-schema');
const { GH_TIMEOUT_MS } = require('../shared-primitives');

function defaultReadFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function defaultGitRunner(args) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS });
}

function fail(reason, message) {
  return { ok: false, reason, message };
}

// resolveIntegrationModel(configRaw) -> 'pr-first' | 'local-merge' | null
// A run pins its resolved integration-model into its OWN config.yml at run start
// (`_shared/integration-model.md`'s "Run-scoped stability") -- reading only
// run-config (never policy.yml) reproduces that pin, since run-config already wins
// over policy.yml in resolvePolicyKeys' own source order whenever both are present.
// `null` means the run's config.yml carries no resolvable value (e.g. the
// Manifesto never ran) -- the pr-first-only check below is skipped in that case,
// since there is nothing to confirm the model against.
function resolveIntegrationModel(configRaw) {
  const resolved = resolvePolicyKeys(['integration-model'], { policyRaw: null, runConfigRaw: configRaw });
  return resolved['integration-model'].value;
}

// checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug }, deps?) -> { ok: true } | { ok: false, reason, message }
//
// Checks, in order (first failure wins -- never aggregates):
//   1. `{runDir}/run-state.json` exists.
//   2. `{runDir}/config.yml` exists.
//   3. Every member of `issueNumbers` has a `claims/issue-{n}.json` blob on the
//      claims-registry branch that classifies 'live' with `runId === basename(runDir)`.
//   4. Under `integration-model: pr-first` (resolved from config.yml), run-state.json's
//      `pr.number` is recorded AND `pr.branch` exists on `origin`.
function checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug }, deps = {}) {
  const {
    readFile = defaultReadFile,
    gitRunner = defaultGitRunner,
    ghApi = defaultGhApi,
    now = Date.now(),
  } = deps;

  const runStatePath = path.join(runDir, 'run-state.json');
  let runStateRaw;
  try {
    runStateRaw = readFile(runStatePath);
  } catch {
    return fail('missing-run-state', `run-state.json not found at ${runStatePath}`);
  }

  const configPath = path.join(runDir, 'config.yml');
  let configRaw;
  try {
    configRaw = readFile(configPath);
  } catch {
    return fail('missing-config', `config.yml not found at ${configPath}`);
  }

  const runId = path.basename(runDir);
  for (const issueNumber of issueNumbers) {
    // Contents-API only (no `gitRunner` passed here): this check reads the claim, it never
    // writes one, so it has no need for git-CAS's fetch + scratch-ref dance -- `ghApi` alone
    // reaches the same `claims/issue-{n}.json` blob on `claims-registry` readClaimBlob's git
    // path would, with a fake runner that is trivial to assert against in tests.
    const blob = readClaimBlob({ ghApi }, repoSlug, issueNumber);
    if (blob.failure) {
      return fail('claim-read-failed', `could not read claim for issue #${issueNumber}: ${blob.failure}`);
    }
    if (blob.absent) {
      return fail('claim-absent', `no claim recorded for issue #${issueNumber}`);
    }
    const classified = classifyClaimBlob(blob.content, now);
    if (classified.state !== 'live') {
      return fail('claim-not-live', `claim for issue #${issueNumber} is ${classified.state}, not live`);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(blob.content);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.runId !== runId) {
      const heldBy = parsed && parsed.runId ? parsed.runId : 'unknown';
      return fail('claim-run-id-mismatch', `claim for issue #${issueNumber} is held under runId ${heldBy}, not ${runId}`);
    }
  }

  const integrationModel = resolveIntegrationModel(configRaw);
  if (integrationModel === 'pr-first') {
    let runState = null;
    try {
      runState = JSON.parse(runStateRaw);
    } catch {
      runState = null;
    }
    const pr = runState && runState.pr;
    if (!pr || !pr.number) {
      return fail('pr-missing', 'no recorded PR in run-state.json under integration-model: pr-first');
    }
    if (!pr.branch) {
      return fail('pr-branch-unrecorded', `PR #${pr.number} recorded but no head branch name in run-state.json`);
    }
    let branchExists = false;
    try {
      const out = gitRunner(['ls-remote', '--heads', 'origin', pr.branch]);
      branchExists = typeof out === 'string' && out.trim().length > 0;
    } catch {
      branchExists = false; // transport failure -- fail closed, cannot confirm the branch is pushed
    }
    if (!branchExists) {
      return fail('pr-branch-unpushed', `PR #${pr.number}'s head branch "${pr.branch}" does not exist on origin`);
    }
  }

  return { ok: true };
}

module.exports = { checkFirstCallArtifacts, resolveIntegrationModel };
