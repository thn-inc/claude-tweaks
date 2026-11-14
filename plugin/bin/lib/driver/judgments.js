'use strict';
// The judgment supplier merge.js's `consultSupplier` consumes as `deps.judgments(ctx)` (#5228):
// the merge-check verdict and the acceptance state, each judged by a read-only headless worker
// (roles.js: `merge-check`, `acceptance`). The worker only returns a verdict; this module decides
// what the verdict is worth. A verdict reaches merge.js only after code wrote the one logged line
// (`log-decision.js`, no `--section`) and re-read it with `confirmFromFile`; a worker that returns
// anything but the exact string `auto-merge` is `needs-human`, and every failure on the way is a
// stop, never a pass. The floors that need no judgment (a failed or sensitive blast radius) are
// decided here before any launch.
//
// `judgeMergeCheck` and `createJudgments` never throw.

const fs = require('node:fs');
const path = require('node:path');
const { neutralize, CLI_TIMEOUT_MS } = require('./events');
const { reduceDetail } = require('./settle');
const { readCeilings, launchTracked } = require('./launch');
const { MERGE_CHECK_RESULT_SCHEMA } = require('./roles');
const { loadMergeCheckRules, buildMergeCheckPrompt } = require('./judgment-prompts');
const { verdictText, VERDICT_STEPS, confirmFromFile } = require('../dispatch/merge-verdict');

const BIN_DIR = path.join(__dirname, '..', '..');
const EVENT_DETAIL_MAX = 200;

function bin(name) {
  return path.join(BIN_DIR, name);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clock(deps) {
  try {
    return deps && typeof deps.now === 'function' ? deps.now() : 0;
  } catch {
    return 0;
  }
}

// One merge-check event. An emit that throws never changes the verdict it reports.
function emitEvent(deps, startedAt, verdict, floor, detail) {
  try {
    if (!deps || typeof deps.emit !== 'function') return;
    const text = neutralize(String(detail || '')).slice(0, EVENT_DETAIL_MAX);
    deps.emit('merge-check', verdict === 'auto-merge' ? 'ok' : 'stop', clock(deps) - startedAt, text, { verdict, floor });
  } catch {
    // an event is a report about the step, never part of it
  }
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

// Step 3: the record, the diff and the check state. { stop } on a failed record or diff read.
function gatherInputs({ deps }, ctx) {
  let title;
  let body;
  try {
    const rec = JSON.parse(deps.gh(['issue', 'view', String(ctx.record), '--repo', ctx.repo, '--json', 'title,body']));
    if (!isPlainObject(rec)) throw new Error('shape');
    title = String(rec.title ?? '');
    body = String(rec.body ?? '');
  } catch {
    return { stop: 'record read failed' };
  }
  let diff;
  try {
    diff = String(deps.git(['-C', ctx.worktree, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-textconv',
      '--end-of-options', `origin/${ctx.base}...HEAD`, '--'], { cwd: ctx.worktree }));
  } catch {
    return { stop: 'diff read failed' };
  }
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
  const ceilings = readCeilings(shared.policy);
  if (ceilings.bad) return { stop: 'merge-check ceiling is not a positive number' };
  const settingsDir = path.join(ctx.runDir, 'merge-check');
  let envelope;
  try {
    deps.mkdirSync(settingsDir, { recursive: true });
    envelope = await launchTracked(shared, deps, { minutes: ceilings.minutes, dollars: ceilings.dollars }, {
      role: 'merge-check',
      cwd: ctx.worktree,
      prompt,
      schema: MERGE_CHECK_RESULT_SCHEMA,
      settingsDir,
    });
  } catch {
    return { stop: 'merge-check launch failed' };
  }
  const result = envelope && envelope.status === 'ok' ? envelope.result : undefined;
  if (!isPlainObject(result) || typeof result.verdict !== 'string'
    || (result.verdict !== 'auto-merge' && result.verdict !== 'needs-human')) {
    return { stop: 'merge-check returned no valid verdict' };
  }
  return { verdict: result.verdict, rationale: typeof result.rationale === 'string' ? result.rationale : '' };
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
      const prompt = buildMergeCheckPrompt({
        record: ctx.record, title: inputs.title, body: inputs.body, diff: inputs.diff, summary: blast.summary,
        policy: { 'auto-merge-max-lines': blast.limits.lines, 'auto-merge-max-files': blast.limits.files }, checks: inputs.checks, reviewFindings: [], rules: rules.text,
      });
      const judged = await launchAndValidate(env, ctx, prompt);
      if (judged.stop) {
        reached = 'needs-human';
        detail = judged.stop;
      } else {
        reached = judged.verdict;
        detail = judged.rationale ? reduceDetail(judged.rationale) : '';
      }
    }
    return finish(deps, startedAt, ctx, env, reached, floor, detail);
  } catch {
    emitEvent(deps, startedAt, verdict, floor, 'merge-check failed unexpectedly');
    return { verdict, floor, detail: 'merge-check failed unexpectedly' };
  }
}

// Steps 6 to 8 for a verdict reached: log it, confirm an auto-merge from decisions.md, emit once.
function finish(deps, startedAt, ctx, env, reached, floor, detail) {
  let verdict = reached;
  let logged = false;
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
  emitEvent(deps, startedAt, verdict, floor, detail);
  return { verdict, floor, detail: neutralize(String(detail || '')).slice(0, EVENT_DETAIL_MAX) };
}

// The supplier merge.js takes as `deps.judgments`. `runAcceptance` (acceptance.js, resolved lazily so
// this module loads before that one exists) runs only after a confirmed auto-merge.
function createJudgments({ deps, shared, readFile, runAcceptance } = {}) {
  const read = typeof readFile === 'function' ? readFile : (p) => fs.readFileSync(p, 'utf8');
  return async function judgments(ctx) {
    try {
      const mc = await judgeMergeCheck({ deps, shared, readFile: read }, ctx);
      if (mc.verdict !== 'auto-merge') {
        return { mergeCheck: { verdict: mc.verdict }, acceptance: { completed: false } };
      }
      const run = typeof runAcceptance === 'function' ? runAcceptance : require('./acceptance').runAcceptance;
      const acc = await run({ deps, shared, readFile: read }, ctx);
      return { mergeCheck: { verdict: mc.verdict }, acceptance: { completed: !!acc && acc.completed === true } };
    } catch {
      return { mergeCheck: { verdict: 'unconfirmed' }, acceptance: { completed: false } };
    }
  };
}

module.exports = { judgeMergeCheck, createJudgments };
