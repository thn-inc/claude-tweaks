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
// #3661 adds `checkFirstCallStamp`, a sibling read of the first call's runner-written
// verification pass stamp -- reported as a note, never folded into the gate result below.
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
const { resolvePolicyKeys, resolvePolicyConfig } = require('../policy-schema');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS } = require('../shared-primitives');
const { lstatType } = require('../path-guard');
const { worktreeMirror } = require('../wrap-up/pack');
const { hasCanonicalClaimLogFor } = require('../log-decision/claim-log');

function defaultReadFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function defaultGitRunner(args) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true });
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
// Manifesto never ran) -- the pr-first-only check below is skipped with a degrade
// line in that case, since there is nothing to confirm the model against.
function resolveIntegrationModel(configRaw) {
  const resolved = resolvePolicyKeys(['integration-model'], { policyRaw: null, runConfigRaw: configRaw });
  return resolved['integration-model'].value;
}

// checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug }, deps?)
//   -> { ok: true } | { ok: false, reason, message } | { ok: false, reason: 'missing-config', message, repairable }
//
// Checks, in order (first failure wins -- never aggregates; the one exception is
// `missing-config`, which also carries `repairable: boolean` -- the claim and PR checks
// below run for it too, as classification, and the first-failure reason stays
// `missing-config`):
//   1. `{runDir}/run-state.json` exists.
//   2. `{runDir}/config.yml` exists.
//   3. Every member of `issueNumbers` has a `claims/issue-{n}.json` blob on the
//      claims-registry branch that classifies 'live' with `runId === basename(runDir)`.
//   4. Under `integration-model: pr-first` (resolved from config.yml), run-state.json's
//      `pr.number` is recorded AND `pr.branch` exists on `origin`.
//   5. Every member of `issueNumbers` has a materialized header (#2775): a readable
//      `{n}-spec.md` at `work/{n}-spec.md` or `spec-{n}/work/{n}-spec.md`, in the run
//      dir or its worktree mirror -- the same two shapes and mirror rule
//      `wrap-up/pack.js`'s resolveRecords ladder reads, so a group that clears this
//      gate never reaches its second call with records unresolved. A header whose
//      `record:` line names another number does not count. A group mixing `work/` and
//      `spec-{n}/work/` layouts across its own members passes this check, but
//      `pack.js`'s resolveRecords ladder only ever reads ONE of the two shapes per
//      rung (its first, flat-`work/`, rung wins outright whenever it finds anything) --
//      no current producer writes that mixed layout.
//   6. (#3577) `{runDir}/decisions.md` carries the canonical `Step 2.8: claimed #{n}` line for
//      every member (`hasCanonicalClaimLogFor`, `log-decision/claim-log.js`). A missing or
//      unreadable `decisions.md` counts as empty; the batch-summary and paraphrased forms do
//      not satisfy it.
//
// `repairable` (#3226): a `missing-config` first call is repairable when a re-dispatch of
// call 2 would land in a recoverable /flow adoption case, and the claim and PR evidence
// say call 1 really ran. The relationship to `plugin/bin/lib/flow/preflight.js`'s
// `computeAdoption` is partial, not an exact match:
//   - `state.pr` is the one adoption input among these facts: recorded -> case 3; absent
//     with `dispatched: true` -> case 2 (initializes config.yml in place); absent without
//     the `dispatched` stamp but with other run content -> case 3. `computeAdoption`
//     never reads claim liveness, `runId`, or branch-pushed.
//   - Claim liveness/`runId` (check 3) is evidence call 1 actually ran /flow Step 2.8, and
//     call 2's ownership-checked Settle/wrap-up release (`claim.runId === basename(runDir)`)
//     needs the claim intact.
//   - A pushed branch (check 4, under pr-first) is evidence the PR-early lifecycle ran.
// The integration model is read from policy.yml (config.yml is the thing missing): an unset
// `integration-model` key in policy.yml requires the same PR evidence as `pr-first`; an
// invalid value never repairs. Any failure to read it, or any throw while classifying,
// means `repairable: false`.

// The run dir plus its worktree mirror (pack.js's worktreeMirror), deduplicated.
function headerBases(runDir, runState) {
  const bases = [runDir];
  const mirror = worktreeMirror(runDir, runState && runState.worktree);
  if (mirror && path.resolve(mirror) !== path.resolve(runDir)) bases.push(mirror);
  return bases;
}

function hasMaterializedHeader(readFile, bases, n) {
  for (const base of bases) {
    for (const rel of [path.join('work', `${n}-spec.md`), path.join(`spec-${n}`, 'work', `${n}-spec.md`)]) {
      let text;
      try { text = readFile(path.join(base, rel)); } catch { continue; }
      const rec = /^record:\s*(\d+)\s*$/m.exec(text);
      if (!rec || Number(rec[1]) === n) return true;
    }
  }
  return false;
}

// claimFailure({ ghApi, repoSlug, issueNumbers, runId, now }) -> null | failObject
// Check 3: every member's claim is live and held under this run's id. Shared by the
// main path and `assessRepairable` so the two cannot drift.
function claimFailure({ ghApi, repoSlug, issueNumbers, runId, now }) {
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
  return null;
}

// prFailure(parsedRunState, gitRunner) -> null | failObject
// Check 4's body (the caller gates on `integration-model: pr-first`): a PR is recorded in
// run-state.json and its head branch exists on `origin`.
function prFailure(parsedRunState, gitRunner) {
  const pr = parsedRunState && parsedRunState.pr;
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
  return null;
}

// assessRepairable(...) -> boolean
// For a `missing-config` first call: would the claim and PR evidence let a re-dispatch of
// call 2 recover? Claims first, then the integration model from policy.yml (the run's
// config.yml is what is missing). Fails closed -- any throw (claim read, policy.yml read,
// git) means not repairable.
function assessRepairable({ runDir, issueNumbers, repoSlug, parsedRunState, readFile, gitRunner, ghApi, now }) {
  try {
    if (claimFailure({ ghApi, repoSlug, issueNumbers, runId: path.basename(runDir), now })) return false;
    const { result } = resolvePolicyConfig({ git: gitRunner, readFile, keys: ['integration-model'] });
    const entry = result['integration-model'];
    if (!entry || entry.invalid || entry.error) return false;
    // An unset key (value null, not invalid) is a project relying on forge detection --
    // it requires the same PR evidence as `pr-first`, never claim-only and never false outright.
    if (entry.value == null || entry.value === 'pr-first') return prFailure(parsedRunState, gitRunner) === null;
    return true;
  } catch {
    return false;
  }
}

function checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug }, deps = {}) {
  const {
    readFile = defaultReadFile,
    gitRunner = defaultGitRunner,
    ghApi = defaultGhApi,
    now = Date.now(),
    warn = (line) => process.stderr.write(line),
  } = deps;

  const runStatePath = path.join(runDir, 'run-state.json');
  let runStateRaw;
  try {
    runStateRaw = readFile(runStatePath);
  } catch {
    return fail('missing-run-state', `run-state.json not found at ${runStatePath}`);
  }

  let parsedRunState = null;
  try { parsedRunState = JSON.parse(runStateRaw); } catch { parsedRunState = null; }

  const configPath = path.join(runDir, 'config.yml');
  let configRaw;
  try {
    configRaw = readFile(configPath);
  } catch {
    return {
      ...fail('missing-config', `config.yml not found at ${configPath}`),
      repairable: assessRepairable({
        runDir, issueNumbers, repoSlug, parsedRunState, readFile, gitRunner, ghApi, now,
      }),
    };
  }

  const runId = path.basename(runDir);
  const claimFail = claimFailure({ ghApi, repoSlug, issueNumbers, runId, now });
  if (claimFail) return claimFail;

  const integrationModel = resolveIntegrationModel(configRaw);
  if (integrationModel === null) {
    warn(`first-call-artifact-check: degraded — ${configPath} carries no valid integration-model pin; PR-bookend check not run (_shared/integration-model.md's Run-scoped stability)\n`);
  }
  if (integrationModel === 'pr-first') {
    const prFail = prFailure(parsedRunState, gitRunner);
    if (prFail) return prFail;
  }

  const bases = headerBases(runDir, parsedRunState);
  for (const issueNumber of issueNumbers) {
    if (!hasMaterializedHeader(readFile, bases, Number(issueNumber))) {
      return fail('materialized-header-missing', `no materialized header for issue #${issueNumber} under ${bases.join(' or ')} (work/ or spec-${issueNumber}/work/)`);
    }
  }

  const decisionsPath = path.join(runDir, 'decisions.md');
  let decisionsBody = '';
  try { decisionsBody = readFile(decisionsPath); } catch { decisionsBody = ''; }
  for (const issueNumber of issueNumbers) {
    if (!hasCanonicalClaimLogFor(decisionsBody, Number(issueNumber))) {
      return fail('claim-log-missing', `no canonical "Step 2.8: claimed #${issueNumber}" line in ${decisionsPath} (/flow claim-targets.md's Log the claim)`);
    }
  }

  return { ok: true };
}

const VERIFY_JS = path.resolve(__dirname, '..', '..', 'verify.js');

// The default stamp read: `verify.js --stamp-status` run with the worktree as cwd (it reads
// that checkout's own stamp and live HEAD). Status is data -- exit 0 always -- so a throw here
// means the read itself failed (spawn error, timeout, non-JSON output).
function defaultStampStatus(worktree) {
  const out = execFileSync(process.execPath, [VERIFY_JS, '--stamp-status'], {
    cwd: worktree, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true,
  });
  return JSON.parse(out);
}

// A directory (or symlink) named report.json is not the artifact -- only a regular file counts.
function defaultReportExists(p) {
  return lstatType(p).type === 'file';
}

// checkFirstCallStamp({ runDir }, deps?)
//   -> { verified: boolean, reason: null | 'worktree-unrecorded' | 'stamp-read-failed'
//        | 'stamp-absent' | 'stamp-not-head' | 'report-missing', status: object | null }
//
// #3661: whether the first call's runner (`verify.js`) left a pass stamp that verifies the
// worktree's HEAD, with its `report.json` still on disk. Reads `run-state.json`'s `worktree`
// (written by `hooks.js record-worktree`), then `verify.js --stamp-status` there. First match
// wins, in the order listed: no recorded worktree -> worktree-unrecorded (no stamp read);
// a throwing or non-object stamp read -> stamp-read-failed; a complete composed per-suite
// verdict (`verifiedHead` and `suiteComposed.complete`, #4006) verifies with no single stamp or
// `reportPath` needed; `present !== true` -> stamp-absent;
// `verifiedHead !== true` -> stamp-not-head; a `reportPath` that is not a string or does not
// exist -> report-missing. `status` is the parsed stamp-status object whenever one was read.
//
// Note posture, never a gate result: this is NOT a `checkFirstCallArtifacts` check and
// `resolveFirstCallGate` never sees it. An unverified first call is surfaced as a note only,
// because call 2's review Step 1.5 re-verifies an unstamped HEAD through the runner -- the
// missing stamp costs a re-run, not correctness, so it must not block the dispatch.
function checkFirstCallStamp({ runDir }, deps = {}) {
  const {
    readFile = defaultReadFile,
    stampStatus = defaultStampStatus,
    exists = defaultReportExists,
  } = deps;

  let worktree = null;
  try {
    const parsed = JSON.parse(readFile(path.join(runDir, 'run-state.json')));
    worktree = parsed && typeof parsed.worktree === 'string' && parsed.worktree.length > 0 ? parsed.worktree : null;
  } catch {
    worktree = null;
  }
  if (worktree === null) return { verified: false, reason: 'worktree-unrecorded', status: null };

  let status = null;
  try {
    status = stampStatus(worktree);
  } catch {
    status = null;
  }
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return { verified: false, reason: 'stamp-read-failed', status: null };
  }

  if (status.verifiedHead === true && status.suiteComposed && status.suiteComposed.complete === true) {
    return { verified: true, reason: null, status };
  }
  if (status.present !== true) return { verified: false, reason: 'stamp-absent', status };
  if (status.verifiedHead !== true) return { verified: false, reason: 'stamp-not-head', status };
  if (typeof status.reportPath !== 'string' || !exists(status.reportPath)) {
    return { verified: false, reason: 'report-missing', status };
  }
  return { verified: true, reason: null, status };
}

// resolveFirstCallGate({ reply, artifact })
//   -> 'blocked' | 'already-shipped' | 'artifact-failed' | 'repair' | 'dispatch'
//
// The code twin of `skills/dispatch/two-call-gate.md` section 2's ordering: the first call's
// status line is judged FIRST (#2429), then its OUTCOME line, and only then the artifact
// check (#2837) -- so a repairable `missing-config` (#3226's `repair` branch) can never
// launder a malformed or non-DONE reply into a re-dispatch. `reply` is the first call's raw
// text; `artifact` is `checkFirstCallArtifacts`' result (absent fails closed).
const STATUS_LINE_RE = /^STATUS: (DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)$/;
const OUTCOME_LINE_RE = /^OUTCOME:\s*(\S+)/;

function resolveFirstCallGate({ reply, artifact }) {
  const lines = String(reply == null ? '' : reply).split('\n').map((l) => l.replace(/\r$/, ''));
  const lastLine = lines.filter((l) => l.trim().length > 0).pop();
  const status = lastLine ? STATUS_LINE_RE.exec(lastLine) : null;
  if (!status || (status[1] !== 'DONE' && status[1] !== 'DONE_WITH_CONCERNS')) return 'blocked';

  const outcomeLine = lines.map((l) => OUTCOME_LINE_RE.exec(l)).find(Boolean);
  const outcome = outcomeLine ? outcomeLine[1] : null;
  if (outcome === 'already-shipped') return 'already-shipped';
  if (outcome !== 'build-test-ok') return 'blocked';

  if (artifact && artifact.ok === true) return 'dispatch';
  if (artifact && artifact.reason === 'missing-config' && artifact.repairable === true) return 'repair';
  return 'artifact-failed';
}

module.exports = { checkFirstCallArtifacts, checkFirstCallStamp, resolveFirstCallGate, resolveIntegrationModel, headerBases, hasMaterializedHeader, defaultReadFile };
