'use strict';
// The pipeline driver's step table (drive.js, record #5218).
//
// Ports plugin/skills/_shared/express-lane.md Procedure steps 1–8 and 10 (step 9, merge, omitted by design); each step function names the step it ports. No test reads that prose — keep the two in step by hand.
//
// STEPS is a frozen, ordered array of { name, run }. run.js walks it once per record and
// owns only event emission and stop handling between steps, so a later unit adds a step
// as one table entry, never a change to the loop. Each entry is built by defineStep:
//
//   defineStep(name, stopClass, fn) -> { name, run }
//     fn(ctx, deps) -> Promise<StepResult>, where
//     StepResult = { status: 'ok'|'stop'|'fail', detail?, halt?, stopClass?, reason?, extra? }
//   - `stop` means a gate said no; `fail` means a call failed.
//   - `halt` defaults to `status !== 'ok'`; a step that must never end the record (a
//     failed summary entry) returns `halt: false`.
//   - `stopClass` defaults to the step's own class and may be overridden per result.
//   - `reason` defaults to the status; it is the final line's `stop.reason`.
//   - `extra` fields merge into the step's event line (never over its core fields).
//   - A throw from fn is `{ status: 'fail', detail: err.message }` with the step's class.
//   - On entry the wrapper records `ctx.currentStep` and `ctx.currentStopClass`, so a
//     signal handler can stamp an interrupted record with the running step and its own
//     class while run.js still names no step.
//
// Every external call goes through `deps`; nothing here reads process state.
const { STEP, STOP_CLASSES } = require('./events');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { gateOriginRepo } = require('../repo-resolve');
const { openBlockerRefs } = require('../issues/record-dependencies');
const { sensitivePathsOf } = require('../express/policy');

// The worker's test command and the full verify invocation's `--cmd tests=…` value.
const TEST_COMMAND = 'npm test';
// How long the ci step waits for a pending or stale check state, and how often it polls.
const CI_WAIT_BOUND_MS = 30 * 60 * 1000;
const CI_POLL_INTERVAL_MS = 30 * 1000;
// On win32 the worker launcher's default `bin` (`claude`) does not find an npm-installed
// `claude.cmd`, so a win32 caller passes this explicitly.
const WIN32_CLAUDE_BIN = 'claude.cmd';

// Read once per run, in the policy step.
const POLICY_KEYS = Object.freeze([
  'express-driver', 'express-driver-wall-clock-minutes', 'express-driver-spend-ceiling-dollars',
  'merge-sensitive-paths', 'integration-model', 'integration-branch', 'verify-suite-slots',
]);
// The one record read: its JSON feeds eligibility, admission, the worker and check.
const ISSUE_JSON_FIELDS = 'number,title,body,labels,state';
const RESULT_STATUSES = new Set(['ok', 'stop', 'fail']);
const STOP_CLASS_SET = new Set(Object.values(STOP_CLASSES));
// A branch name the integration ref may take: never empty, never flag-shaped, no whitespace.
const REF_RE = /^[^\s-]\S*$/;

// An execFileSync error's own words: gh and git put the cause on stderr, while the
// message leads with "Command failed: …". First non-empty line of whichever has text.
function errorText(err) {
  const firstLine = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  return firstLine(err && err.stderr) || firstLine(err && err.message) || String(err);
}

function defineStep(name, stopClass, fn) {
  if (!STOP_CLASS_SET.has(stopClass)) throw new Error(`defineStep ${name}: unknown stop class ${String(stopClass)}`);
  async function runStep(ctx, deps) {
    ctx.currentStep = name;
    ctx.currentStopClass = stopClass;
    let result;
    try {
      result = await fn(ctx, deps);
    } catch (err) {
      return { status: 'fail', detail: (err && err.message) || String(err), halt: true, stopClass, reason: 'fail', extra: {} };
    }
    if (!result || !RESULT_STATUSES.has(result.status)) {
      return { status: 'fail', detail: `step returned an invalid status: ${String(result && result.status)}`, halt: true, stopClass, reason: 'fail', extra: {} };
    }
    if (result.stopClass !== undefined && !STOP_CLASS_SET.has(result.stopClass)) {
      return { status: 'fail', detail: `step returned an invalid stop class: ${String(result.stopClass)}`, halt: true, stopClass, reason: 'fail', extra: {} };
    }
    return {
      status: result.status,
      detail: result.detail,
      halt: typeof result.halt === 'boolean' ? result.halt : result.status !== 'ok',
      stopClass: result.stopClass || stopClass,
      reason: result.reason || result.status,
      extra: result.extra || {},
    };
  }
  return Object.freeze({ name, run: runStep });
}

// The integration-branch policy value when non-empty, else origin/HEAD minus `origin/`
// (_shared/integration-branch.md). Null when neither gives a usable branch name.
function resolveIntegrationRef(policy, mainRoot, deps) {
  const pinned = policy['integration-branch'].value;
  let ref = typeof pinned === 'string' ? pinned.trim() : '';
  if (!ref) {
    try {
      ref = String(deps.git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: mainRoot }))
        .trim().replace(/^origin\//, '');
    } catch (err) {
      return { ref: null, why: `origin/HEAD unreadable (${errorText(err)})` };
    }
  }
  return REF_RE.test(ref) ? { ref, why: null } : { ref: null, why: `not a branch name: ${JSON.stringify(ref)}` };
}

// Ports express-lane.md's Eligibility section (the lane's own policy read), once per run.
// It also resolves the run's shared values: the main checkout root, the origin repo and
// the integration ref. Anything unreadable is fatal: the record is refused and run.js
// attempts no further record.
const policyStep = defineStep(STEP.policy, STOP_CLASSES.REFUSED, async (ctx, deps) => {
  const { shared } = ctx;
  if (shared.policy) return { status: 'ok', detail: 'cached' };
  const fatal = (detail) => {
    shared.fatal = true;
    return { status: 'fail', detail };
  };
  try {
    const resolved = deps.resolvePolicy(POLICY_KEYS.slice()) || {};
    const unreadable = POLICY_KEYS.filter((k) => !resolved[k] || resolved[k].error);
    if (unreadable.length) {
      return fatal(`policy unreadable: ${unreadable.map((k) => `${k} (${(resolved[k] && resolved[k].error) || 'missing'})`).join(', ')}`);
    }
    const mainRoot = mainCheckoutRoot(deps.cwd());
    if (!mainRoot) return fatal('main checkout root unresolvable from the working directory');
    let remote;
    try { remote = deps.remoteUrl(); } catch (err) { return fatal(`origin remote unreadable: ${errorText(err)}`); }
    // The origin-host gate (#4933): an unknown host is refused, never sent to gh.
    const { spec: repo, refusal } = gateOriginRepo(remote, { env: deps.env, platform: deps.platform });
    if (refusal) return fatal(refusal);
    if (!repo) return fatal('origin remote does not name a host/owner/repo');
    const { ref, why } = resolveIntegrationRef(resolved, mainRoot, deps);
    if (!ref) return fatal(`integration branch unresolvable: ${why}`);
    shared.policy = resolved;
    shared.mainRoot = mainRoot;
    shared.repo = repo;
    shared.ref = ref;
    return { status: 'ok' };
  } catch (err) {
    return fatal(`policy read failed: ${(err && err.message) || String(err)}`);
  }
});

// Ports express-lane.md step 2's record read: the one fetch of the record.
const fetchStep = defineStep(STEP.fetch, STOP_CLASSES.REFUSED, async (ctx, deps) => {
  let raw;
  try {
    raw = deps.gh(['issue', 'view', '--json', ISSUE_JSON_FIELDS, '--', String(ctx.record)]);
  } catch (err) {
    return { status: 'fail', detail: `gh issue view failed: ${errorText(err)}` };
  }
  let issue;
  try { issue = JSON.parse(raw); } catch { issue = null; }
  if (!issue || typeof issue !== 'object' || issue.number !== ctx.record) {
    return { status: 'fail', detail: `gh issue view returned no record #${ctx.record}` };
  }
  ctx.recordJson = raw;
  ctx.issue = issue;
  return { status: 'ok' };
});

// Ports express-lane.md's Eligibility section, with the driver's relaxed ceremony gate.
const eligibilityStep = defineStep(STEP.eligibility, STOP_CLASSES.REFUSED, async (ctx, deps) => {
  const { policy } = ctx.shared;
  const verdict = deps.evaluateRecordEligibility(ctx.issue, {
    enabled: true,
    allowAbsentCeremony: true,
    integrationModel: policy['integration-model'].value,
    sensitivePaths: sensitivePathsOf(policy['merge-sensitive-paths']),
  });
  ctx.keyFiles = (verdict && verdict.keyFiles) || [];
  if (!verdict || verdict.eligible !== true) {
    return { status: 'stop', detail: ((verdict && verdict.reasons) || []).join('; ') || 'not eligible' };
  }
  return { status: 'ok' };
});

// Ports express-lane.md's Eligibility section: the driver lane's admission (state, grants,
// open blockers, open linked PRs, and the express-driver routing, where `off` refuses).
const admissionStep = defineStep(STEP.admission, STOP_CLASSES.REFUSED, async (ctx, deps) => {
  const { policy, repo: { host, owner, repo } } = ctx.shared;
  const n = ctx.record;
  // Each read is one aliased GraphQL batch, so it runs under the batch bound (#4815).
  const runner = (args) => deps.ghBatch(args);
  let blockers;
  let linked;
  try {
    blockers = deps.fetchNativeDependencies({ numbers: [n], owner, repo, host, runner });
    linked = deps.fetchLinkedPRs({ numbers: [n], owner, repo, host, runner });
  } catch (err) {
    return { status: 'fail', detail: `admission read failed: ${errorText(err)}` };
  }
  // A map with no entry for the record is an unread fact, never "none": admission gets
  // null and refuses with its own unreadable reason.
  const blockerEntry = blockers && typeof blockers.get === 'function' ? blockers.get(n) : undefined;
  const linkedEntry = linked && typeof linked.get === 'function' ? linked.get(n) : undefined;
  let openLinkedPRs = null;
  if (linkedEntry) {
    const { openPR } = linkedEntry;
    openLinkedPRs = openPR === null || openPR === undefined ? [] : [openPR];
  }
  const verdict = deps.evaluateAdmission({
    number: n,
    state: ctx.issue.state,
    labels: ctx.issue.labels,
    openBlockerRefs: blockerEntry ? openBlockerRefs(blockerEntry) : null,
    openLinkedPRs,
    routing: policy['express-driver'].value,
  });
  if (!verdict || verdict.admitted !== true) {
    return { status: 'stop', detail: ((verdict && verdict.reasons) || []).join('; ') || 'not admitted' };
  }
  return { status: 'ok' };
});

const STEPS = Object.freeze([policyStep, fetchStep, eligibilityStep, admissionStep]);

module.exports = {
  STEPS, defineStep, TEST_COMMAND, CI_WAIT_BOUND_MS, CI_POLL_INTERVAL_MS, WIN32_CLAUDE_BIN,
};
