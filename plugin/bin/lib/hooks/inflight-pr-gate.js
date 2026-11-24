// bin/lib/hooks/inflight-pr-gate.js — the in-flight PR gate (block tier, #6143).
// PreToolUse on Bash: a `gh pr ready` or `gh pr merge` against a pipeline run's draft PR is denied
// while that run is still in flight — its run-state.json is not `clean` and its build or test phase
// has not finished (lib/flow/inflight-run.js's inFlightPhase: a checked or absent checklist row
// counts as finished; a present unchecked row is settled by the run's decisions.md set, where a
// phase-exit record decides). Marking such a PR ready or merging it ships a half-built change.
//
// Direction: fails OPEN on every unprovable answer. The call it blocks is prescribed by skill prose
// (a run's own wrap-up and dispatch settle merge their PR), so a wrong deny strands a run while a
// wrong allow only falls back to the hollow merge this gate exists to stop. The run's owner — the
// caller whose session_id equals run-state `sessionId` — is always allowed (its own wrap-up merges
// after its build and test exits). `dispatchSessionId` is not an owner. Every caller is allowed when
// the run-state has no non-empty string `sessionId`. Per call (ghPrLifecycleCalls), it denies only
// when every step is proven: not a cancel (`ready --undo`, `merge --disable-auto`); the GH_REPO/GH_HOST
// gh would read is known (the call's own literal prefix, carried into the PR read's env, or none); the call's cwd is known (not `lost`) and absolute; that
// cwd is in a git checkout whose main checkout resolves; the PR body reads, by `gh pr view` run from
// that cwd under the hook env plus that prefix; its first line carries a run marker; the named run dir resolves under that main
// checkout; its run-state reads with an owner; the caller is not the owner; and inFlightPhase names
// a phase. The call's own cwd is the base, not ctx.cwd: after `cd /other/checkout &&`, gh reads that
// checkout's repo, so the gate judges the PR from there.
// Fail-open conditions, each `{}` with no event: any other tool; a non-string command; no gh pr
// ready/merge call; `--undo` or `--disable-auto`; an `envUnprovable` call (a GH_REPO/GH_HOST value the
// parser cannot carry, so the repo gh reads is unknown); a `lost` call cwd (only a stand-in, so the repo gh would read there
// cannot be proved — _shared/policy-schema-coverage.md's "Where a relative target resolves") or a
// relative one; a call cwd outside any git checkout, or mainCheckoutRoot null or throwing for it
// (the PR is then never read); a PR read that fails or prints no string body and integer number; no
// first-line `claude-tweaks-run:` marker (a marker on a later line is quoted text); a marker run id
// failing RUN_ID_RE; a run dir that does not canonicalize, is not a directory, or is not a direct
// child of the main checkout's pipelines dir (a symlink out, a traversal); a missing or unreadable
// run-state; no owner; the owner calling; an unreadable decisions.md set (readRunDecisions throws);
// no in-flight phase; a load fault in this module (runInner requires it lazily); and any throw.
//
// Runs read: neither ctx.runDir nor ctx.ownedRun — the run the PR body's first-line marker names, in
// the main checkout of the gh call's own cwd (its run-state.json and decisions.md), through
// named-run.js's namedRunDir. The caller's owned run says nothing about which run owns the PR.
//
// Load cost: only context.js, worktree-detect.js and git-command.js, which pre-tool-use.js already
// loads, come in with this module. The PR, run and gh modules load in lazy() once a command holds a
// gh pr ready/merge call, so every other Bash call pays nothing for them.
//
// Each deny appends a `gate-denial` event (gate 'inflight-pr', with the PR number and the phase) to
// the named run, unattributed (the run is named, not guessed). The deny outcome is pre-tool-use.js's
// denyResult, passed in by runInner, so this module never requires pre-tool-use.js. `deps` (test
// seams): readPrBody(call, ctx) -> { body, number } | null (run from call.cwd, env ctx.env + call.env), mainCheckoutRoot,
// readRunState, readDecisions(runDir) -> string[] (throws when unreadable), fsImpl.
'use strict';
const fs = require('fs');
const path = require('path');
const ctxLib = require('./context');
const wtDetect = require('./worktree-detect');
const { ghPrLifecycleCalls } = require('./git-command');

const GATE = 'inflight-pr';

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function testTag(env) {
  return env.CT_HOOKS_TEST_MODE === '1' ? { test: true } : null;
}

// The modules a gh pr ready/merge call needs, required on first use only.
function lazy() {
  return {
    namedRunDir: require('./named-run').namedRunDir,
    firstLineRunId: require('../flow/pr-checklist').firstLineRunId,
    resumeVerdict: require('../flow/pr-body').resumeVerdict,
    inFlightPhase: require('../flow/inflight-run').inFlightPhase,
    readRunDecisions: require('../phase-exit/exit-record').readRunDecisions,
  };
}

// `gh pr view --json body,number [--repo R] [-- selector]` from the call's own cwd, under the hook
// context's env with the call's GH_REPO/GH_HOST prefix laid over it (an empty --repo value, from `-R=` or a trailing `-R`, passes no --repo). The
// selector follows `--`, so one that starts with `-` is never read as a flag.
function defaultReadPrBody(call, ctx) {
  const { execFileSync } = require('child_process');
  const { ghOptions, injectedGhDeps } = require('../repo-resolve');
  const { ghTimeoutMsAt } = require('../shared-primitives');
  const env = { ...ctx.env, ...(call.env && typeof call.env === 'object' ? call.env : {}) };
  const args = ['pr', 'view', '--json', 'body,number'];
  if (isNonEmptyString(call.repo)) args.push('--repo', call.repo);
  if (call.selector !== null && call.selector !== undefined) args.push('--', call.selector);
  try {
    const out = execFileSync('gh', args, ghOptions(args, {
      cwd: call.cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: ghTimeoutMsAt(call.cwd, { env }), windowsHide: true,
    }, injectedGhDeps({ env })));
    const parsed = JSON.parse(out);
    if (!parsed || typeof parsed.body !== 'string' || !Number.isInteger(parsed.number)) return null;
    return { body: parsed.body, number: parsed.number };
  } catch {
    return null;
  }
}

function checkCall(call, ctx, d, deny) {
  if (call.undo) return {};
  if (call.envUnprovable) return {};
  if (call.lost || !isNonEmptyString(call.cwd) || !path.isAbsolute(call.cwd)) return {};
  // Outside any git checkout no run can be named, so the PR is never read.
  let main;
  try { main = d.mainCheckoutRoot(call.cwd); } catch { return {}; }
  if (!isNonEmptyString(main)) return {};
  const { namedRunDir, firstLineRunId, resumeVerdict, inFlightPhase } = d.lib;
  const pr = d.readPrBody({ ...call, repo: isNonEmptyString(call.repo) ? call.repo : null }, ctx);
  if (!pr || typeof pr.body !== 'string' || !Number.isInteger(pr.number)) return {};
  const runId = firstLineRunId(pr.body);
  if (!runId) return {};
  const runDir = namedRunDir(call.cwd, runId, d);
  if (!runDir) return {};
  const runState = d.readRunState(runDir);
  if (!runState || typeof runState !== 'object') return {};
  const owner = runState.sessionId;
  if (!isNonEmptyString(owner)) return {};
  if (ctx.input.session_id === owner) return {};
  let phase;
  try {
    phase = inFlightPhase({ runState, body: pr.body, readDecisions: () => d.readDecisions(runDir) });
  } catch {
    return {};
  }
  if (!phase) return {};
  const resume = resumeVerdict(pr.body, runId);
  const target = isNonEmptyString(resume.target) ? resume.target : '<record>';
  ctxLib.appendEvent(runDir, 'gate-denial', { tool: 'Bash', gate: GATE, pr: pr.number, phase, ...testTag(ctx.env) });
  return deny(
    `claude-tweaks: PR #${pr.number} is the draft PR of pipeline run ${runId}, which is still in flight ` +
    `(${phase} phase not finished) and is owned by session ${owner}. Marking it ready or merging it now would ` +
    `ship a half-built change (#6143). Leave it to that run's own wrap-up. If the run is abandoned, settle it ` +
    `first (/claude-tweaks:dispatch resume, or /claude-tweaks:wrap-up ${target} cleanup-only), then retry.`,
  );
}

function checkInflightPrGate(ctx, deps = {}, deny) {
  // Before the try: inside it the throw would read as "gate passes" and silently disable the gate.
  ctxLib.requireEnv(ctx);
  try {
    const input = ctx && ctx.input;
    if (!input || input.tool_name !== 'Bash') return {};
    const command = input.tool_input && input.tool_input.command;
    if (typeof command !== 'string' || !command) return {};
    if (typeof deny !== 'function') return {};
    // The parser is the pre-check: nothing below loads for a command with no gh pr ready/merge call.
    const calls = ghPrLifecycleCalls(command, ctx.cwd);
    if (!calls.length) return {};
    const fsImpl = deps.fsImpl || fs;
    const lib = lazy();
    const d = {
      lib,
      fsImpl,
      readPrBody: deps.readPrBody || defaultReadPrBody,
      mainCheckoutRoot: deps.mainCheckoutRoot || wtDetect.mainCheckoutRoot,
      readRunState: deps.readRunState || ctxLib.readRunState,
      readDecisions: deps.readDecisions || ((runDir) => lib.readRunDecisions(runDir, fsImpl)),
    };
    for (const call of calls) {
      let out;
      try { out = checkCall(call, ctx, d, deny); } catch { out = {}; }
      if (out && out.json) return out;
    }
    return {};
  } catch {
    return {};
  }
}

module.exports = { checkInflightPrGate, GATE };
