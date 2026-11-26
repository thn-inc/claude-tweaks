'use strict';
// The judgment supplier merge.js's `consultSupplier` consumes as `deps.judgments(ctx)` (#5228):
// the merge-check verdict and the acceptance state, each judged by a read-only headless worker
// (roles.js: `merge-check`, `acceptance`). The worker only returns a verdict; this module decides
// what the verdict is worth. A verdict reaches merge.js only after code wrote the one logged line
// (`log-decision.js`, no `--section`) and re-read it with `confirmFromFile`; a worker that returns
// anything but the exact string `auto-merge` is `needs-human`, and every failure on the way is a
// stop, never a pass. The floors that need no judgment (a failed or sensitive blast radius, a diff
// over the prompt cap) are decided here before any launch.
//
// `judgeMergeCheck` and `createJudgments` never throw.

const fs = require('node:fs');
const path = require('node:path');
const { CLI_TIMEOUT_MS } = require('./events');
const { reduceDetail } = require('./settle');
const { MERGE_CHECK_RESULT_SCHEMA } = require('./roles');
const { loadMergeCheckRules, buildMergeCheckPrompt } = require('./judgment-prompts');
const { bin, isPlainObject, isInterrupted, clock, cleanDetail, emitStep, readRecordAndDiff, launchJudge } = require('./judgment-io');
const { verdictText, VERDICT_STEPS, confirmFromFile } = require('../dispatch/merge-verdict');
const { runAcceptance: defaultRunAcceptance } = require('./acceptance');
const { codeSuffix, DIFF_PROMPT_MAX_BYTES, truncateUtf8 } = require('./review');

// One merge-check event. `model` is the model the judge launch ran on (#5917), `effort` the level it was
// launched at or null (#5942); both absent when no launch returned. `usage` is the judge envelope's, the
// worker line's shape (#6009); absent unless the envelope carried a usage object.
function emitEvent(deps, startedAt, verdict, floor, detail, model, effort, usage) {
  emitStep(deps, 'merge-check', verdict === 'auto-merge' ? 'ok' : 'stop', startedAt, detail, { verdict, floor, ...(model ? { model, effort: effort ?? null } : {}), ...(isPlainObject(usage) ? { usage } : {}) });
}

// Step 1: the blast radius, run as the CLI. { floor, detail, summary }; floor is null when neither floor fires.
function readBlastRadius({ deps }, ctx) {
  let r;
  try {
    r = deps.node(bin('blast-radius.js'), ['--integration-branch', ctx.base, '--run', ctx.runDir],
      { cwd: ctx.worktree, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch {
    return { floor: 'blast-radius-failed', detail: 'blast radius did not run' };
  }
  let parsed = null;
  if (r && r.code === 0) {
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      parsed = null;
    }
  }
  return blastFloor(parsed);
}

// The two code floors over a parsed blast-radius object (or null for unusable output): { floor, detail, summary? },
// floor null when neither fires. Exported so the verdict-fixture harness applies the same floors (tools/driver-merge-check-eval.js).
function blastFloor(parsed) {
  const summary = parsed && isPlainObject(parsed) ? parsed.summary : null;
  if (!isPlainObject(summary) || !Array.isArray(summary.sensitiveFilesTouched)) {
    return { floor: 'blast-radius-failed', detail: 'blast radius failed or returned unusable output' };
  }
  if (summary.sensitiveFilesTouched.length > 0) {
    return { floor: 'sensitive-path', detail: 'the change touches a sensitive path' };
  }
  const cfg = isPlainObject(parsed.config) ? parsed.config : {};
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!finite(cfg.autoMergeMaxLines) || !finite(cfg.autoMergeMaxFiles)) {
    return { floor: 'blast-radius-failed', detail: 'blast radius reported no size ceilings' };
  }
  return { floor: null, summary, limits: { lines: cfg.autoMergeMaxLines, files: cfg.autoMergeMaxFiles } };
}

// The third code floor: a diff over the prompt cap. The judge would be shown only part of the change and could still
// return `auto-merge`, with only a prompt sentence against it, so code decides it. { floor, detail } or null. Exported so
// the verdict-fixture harness applies the same floor (tools/driver-merge-check-eval.js).
function diffFloor(diff) {
  if (!truncateUtf8(typeof diff === 'string' ? diff : '', DIFF_PROMPT_MAX_BYTES).truncated) return null;
  return { floor: 'diff-truncated', detail: 'the diff exceeds the prompt cap' };
}

// Step 3: the record, the diff and the check state. { stop } on a failed record or diff read.
function gatherInputs({ deps }, ctx) {
  const read = readRecordAndDiff(deps, ctx);
  if (read.stop) return read;
  const { title, body, diff } = read;
  let checks;
  try {
    checks = JSON.parse(deps.gh(['pr', 'checks', String(ctx.pr), '--repo', ctx.repo, '--json', 'name,bucket']));
  } catch {
    checks = 'checks: unreadable';
  }
  return { title, body, diff, checks };
}

// Steps 4 and 5: launch, then validate. { verdict, rationale } or { stop }. Only the exact string
// `auto-merge` or `needs-human` from a status-ok envelope is a verdict.
async function launchAndValidate({ deps, shared }, ctx, prompt) {
  const launched = await launchJudge({ deps, shared }, ctx, {
    role: 'merge-check', dir: 'merge-check', label: 'merge-check', prompt, schema: MERGE_CHECK_RESULT_SCHEMA,
  });
  if (launched.stop) return launched;
  const { envelope, model, effort } = launched;
  const usage = envelope ? envelope.usage : undefined;
  const result = envelope && envelope.status === 'ok' ? envelope.result : undefined;
  if (!isPlainObject(result) || typeof result.verdict !== 'string'
    || (result.verdict !== 'auto-merge' && result.verdict !== 'needs-human')) {
    return { stop: 'merge-check returned no valid verdict', model, effort, usage };
  }
  return { verdict: result.verdict, rationale: typeof result.rationale === 'string' ? result.rationale : '', model, effort, usage };
}

// Step 6: the one logged line, no --section (`latestVerdicts` reads file order). True on exit 0.
function logVerdict({ deps }, ctx, verdict) {
  const r = deps.node(bin('log-decision.js'),
    ['--run', ctx.runDir, '--status', 'AUTO', '--step', VERDICT_STEPS.gate, '--reversibility', 'n/a', '--text', verdictText(ctx.record, verdict)],
    { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  return !!r && r.code === 0;
}

// The merge-check half: { verdict: 'auto-merge' | 'needs-human' | 'unconfirmed', floor, detail }.
async function judgeMergeCheck(env, ctx) {
  let deps;
  const startedAt = clock(env && env.deps);
  let verdict = 'unconfirmed';
  let floor = 'none';
  let detail = '';
  let model;
  let effort;
  let usage;
  try {
    deps = env.deps;
    const { readFile } = env;
    let reached = null;
    const blast = readBlastRadius(env, ctx);
    if (blast.floor) {
      reached = 'needs-human';
      floor = blast.floor;
      detail = blast.detail;
    } else {
      const rules = loadMergeCheckRules(readFile);
      if (!rules.ok) {
        return finish(deps, startedAt, ctx, env, 'needs-human', 'none', `skill section missing: ${rules.missing}`);
      }
      const inputs = gatherInputs(env, ctx);
      if (inputs.stop) {
        return finish(deps, startedAt, ctx, env, 'needs-human', 'none', inputs.stop);
      }
      const cut = diffFloor(inputs.diff);
      if (cut) return finish(deps, startedAt, ctx, env, 'needs-human', cut.floor, cut.detail);
      const prompt = buildMergeCheckPrompt({
        record: ctx.record, title: inputs.title, body: inputs.body, diff: inputs.diff, summary: blast.summary,
        policy: { 'auto-merge-max-lines': blast.limits.lines, 'auto-merge-max-files': blast.limits.files }, checks: inputs.checks, reviewFindings: [], rules: rules.text,
      });
      const judged = await launchAndValidate(env, ctx, prompt);
      model = judged.model;
      effort = judged.effort;
      usage = judged.usage;
      // A signal during the launch was already reported by run.js's handler: log nothing, emit nothing.
      if (isInterrupted(deps)) return { verdict: 'unconfirmed', floor, detail: 'interrupted' };
      if (judged.stop) {
        reached = 'needs-human';
        detail = judged.stop;
      } else {
        reached = judged.verdict;
        detail = judged.rationale ? reduceDetail(judged.rationale) : '';
      }
    }
    return finish(deps, startedAt, ctx, env, reached, floor, detail, model, effort, usage);
  } catch (err) {
    const failed = `merge-check failed unexpectedly${codeSuffix(err)}`;
    emitEvent(deps, startedAt, verdict, floor, failed, model, effort, usage);
    return { verdict, floor, detail: failed };
  }
}

// Steps 6 to 8 for a verdict reached: log it, confirm an auto-merge from decisions.md, emit once.
function finish(deps, startedAt, ctx, env, reached, floor, detail, model, effort, usage) {
  let verdict = reached;
  let logged;
  try {
    logged = logVerdict(env, ctx, reached);
  } catch {
    logged = false;
  }
  if (!logged) {
    verdict = 'unconfirmed';
    detail = 'the verdict line could not be logged';
  } else if (reached === 'auto-merge') {
    let confirmed = false;
    try {
      const c = confirmFromFile(path.join(ctx.runDir, 'decisions.md'), [ctx.record])[ctx.record];
      confirmed = !!c && c.confirmed === true;
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      verdict = 'unconfirmed';
      detail = 'the logged verdict could not be confirmed';
    }
  }
  emitEvent(deps, startedAt, verdict, floor, detail, model, effort, usage);
  return { verdict, floor, detail: cleanDetail(detail) };
}

// The supplier merge.js takes as `deps.judgments`. `runAcceptance` (default: acceptance.js's) runs only
// after a confirmed auto-merge; a caller may inject its own.
function createJudgments({ deps, shared, readFile, runAcceptance } = {}) {
  const read = typeof readFile === 'function' ? readFile : (p) => fs.readFileSync(p, 'utf8');
  return async function judgments(ctx) {
    try {
      const mc = await judgeMergeCheck({ deps, shared, readFile: read }, ctx);
      if (mc.verdict !== 'auto-merge') {
        return { mergeCheck: { verdict: mc.verdict }, acceptance: { completed: false } };
      }
      const run = typeof runAcceptance === 'function' ? runAcceptance : defaultRunAcceptance;
      const acc = await run({ deps, shared, readFile: read }, ctx);
      return { mergeCheck: { verdict: mc.verdict }, acceptance: { completed: !!acc && acc.completed === true } };
    } catch {
      return { mergeCheck: { verdict: 'unconfirmed' }, acceptance: { completed: false } };
    }
  };
}

module.exports = { judgeMergeCheck, createJudgments, blastFloor, diffFloor, launchAndValidate };
