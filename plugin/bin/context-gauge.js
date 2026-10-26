#!/usr/bin/env node
// bin/context-gauge.js — measure the running agent's context and, past the
// cap, write the handoff a fresh agent resumes from (#4027 Deliverable 3).
// /flow calls it at a phase boundary while at least one step remains; the
// procedure is lib/timing/context-gauge.js.
//
//   node bin/context-gauge.js --run <run-dir> [--transcript <path>] [--cap <n>]
//     [--next-steps <step,...>] [--help]
//
// The transcript is --transcript when given, else found from
// CLAUDE_CODE_SESSION_ID (the parent session's id inside a subagent) under
// $CLAUDE_CONFIG_DIR (else ~/.claude) by lib/timing/context-gauge.js's
// findAgentTranscript: the session transcript (main or subagent) whose tail
// holds this very call — an unanswered Bash tool_use whose command names
// context-gauge and the run dir's basename, so the caller must pass the run
// dir as a literal path, not a shell variable. Failing that it falls back to
// the newest subagent transcript whose first user message names the run id,
// then the main transcript, and `reason` names the fallback
// (`caller-not-identified: …`); a fallback never hands off: over the cap it prints
// handoff: null and a reason saying so. --cap overrides CONTEXT_CAP_TOKENS (200000).
// --next-steps is the steps still to run, each one of /flow's step names
// (claim-targets' FLOW_STEPS).
//
// Stdout: one JSON line, {contextTokens, cap, over, transcript, handoff, reason}.
// over is contextTokens > cap. When over, --next-steps was given and the caller was
// identified (in-flight or --transcript),
// {run}/handoff.json = {nextSteps, contextTokens, cap, mode, handoffCount, writtenAt, resume}
// is written atomically and `handoff` is its path. `handoffCount` is the
// existing handoff.json's count plus one (a missing or unreadable file counts
// 0); the count is per run, shared by both dispatch calls of one run dir. At
// HANDOFF_BOUND (3) earlier handoffs nothing is written: over: true,
// handoff: null, reason "handoff bound reached (3 handoffs this run): continue
// in place". `resume` is
// `PIPELINE_RUN_DIR="{run}" /claude-tweaks:flow "{target}" {next-steps}[ auto]`,
// {target} the run's records (#N[,#M]) from its spec-{N}/ subdirs (in
// manifest.yml's order) or its work/{n}-spec.md names (lib's
// resolveTargetRecords). `mode` is config.yml's mode (null without one); the
// ` auto` token is emitted for auto, confirm and hybrid (all run as auto past
// the Manifesto) and omitted for interactive or no recorded mode.
// Fail-open: a missing or unreadable transcript, one with no assistant turn,
// or any other measurement failure prints over: false, contextTokens: null and
// a `reason`; a handoff that cannot be written (no target records, a failed
// write, a multi-record run) prints over: true, handoff: null and a `reason`.
// Neither ever stops a run. Several reasons are joined with "; ". Every
// non-null `reason` is also logged to the run's decisions.md as a SKIP
// (_shared/auto-decision-log.md's degrade trace), so a gauge that cannot work
// — a transcript layout that changed, a caller it cannot find — is visible
// at the Review Console instead of reading as a run that stayed under the cap.
// Exit 0 in every measured state — status is data, the JSON is the answer
//        (bin/verify.js --stamp-status's posture).
//      2 malformed invocation: an unknown flag, a value-less flag, a --cap that
//        is not a positive integer, a --next-steps entry outside FLOW_STEPS, or
//        a --run that is missing, not anchored under the main checkout (a
//        worktree-local shadow, or outside every checkout — [IL-127]), or whose
//        basename is not a run id. Nothing is written.
// --run is anchored strictly through lib/stage-item/write.js's resolveTarget
// (deps-injected, mainRoot injectable): handoff.json is a run-dir write, and
// nothing legitimately writes a run dir outside the main checkout. The
// refusal is this CLI's exit 2; it has no exit 3.
'use strict';

const path = require('path');
const { writeFileAtomic } = require('./lib/atomic-write');
const { resolveTarget, findGitRoot } = require('./lib/stage-item/write');
const { formatEntry, appendEntry } = require('./lib/log-decision/append');
const ctxLib = require('./lib/hooks/context');
const { FLOW_STEPS } = require('./lib/claim-targets/claim-targets');
const {
  CONTEXT_CAP_TOKENS, findAgentTranscript, gauge, resolveTargetRecords, buildHandoff, HANDOFF_BOUND, readHandoffCount,
} = require('./lib/timing/context-gauge');
const { readRunMode } = require('./lib/flow/run-mode');

const USAGE = 'usage: context-gauge.js --run <run-dir> [--transcript <path>] [--cap <n>] [--next-steps <step,...>] [--help]\n'
  + '  measures this agent\'s context from its transcript; past the cap, writes {run}/handoff.json (with --next-steps)\n'
  + '  prints {contextTokens, cap, over, transcript, handoff, reason}; a missing/unreadable transcript prints over: false + reason\n'
  + `  --cap defaults to ${CONTEXT_CAP_TOKENS}; --next-steps entries: ${FLOW_STEPS.join(', ')}\n`
  + '  exit 0 in every measured state (the JSON is the answer)\n'
  + '       2 malformed invocation or bad --run (missing, not anchored under the main checkout, not a run id)\n';

const FLAGS = { '--run': 'run', '--transcript': 'transcript', '--cap': 'cap', '--next-steps': 'nextSteps' };

function parseArgs(argv) {
  const o = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

// "test,review" -> { steps } | { error }. An empty part, a duplicate, or a name
// outside FLOW_STEPS is malformed — a mangled list must not become a handoff
// that skips or repeats a step.
function parseNextSteps(raw) {
  const parts = raw.split(',').map((s) => s.trim());
  const bad = parts.find((p) => !FLOW_STEPS.includes(p));
  if (bad !== undefined) return { error: `unknown --next-steps entry ${JSON.stringify(bad)} — accepted: ${FLOW_STEPS.join(', ')}` };
  if (new Set(parts).size !== parts.length) return { error: `--next-steps names a step twice: ${raw}` };
  return { steps: parts };
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined, // resolveTarget derives the main-checkout anchor from cwd
  resolveTarget,
  gitRootOf: (dir) => { const found = findGitRoot(dir); return found ? found.dir : null; },
  readRunState: (runDir) => ctxLib.readRunState(runDir),
  env: process.env,
  findAgentTranscript,
  gauge,
  resolveTargetRecords,
  readRunMode: (runDir) => readRunMode(runDir),
  readHandoffCount: (runDir) => readHandoffCount(runDir),
  writeFile: (p, text) => writeFileAtomic(p, text),
  appendDecision: (runDir, entry) => appendEntry({ runDir, section: '/flow', entry }),
  now: () => Date.now(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function errText(e) {
  return (e && e.message) || String(e);
}

// The reason findAgentTranscript's fallback rungs carry (the in-flight rung
// identified the caller and carries none).
const FALLBACK_REASONS = {
  'first-message': 'caller-not-identified: fell back to first-message match',
  main: 'caller-not-identified: fell back to the main transcript',
};

// Only these identifications hand off: the in-flight rung found the caller itself, and
// --transcript names it. A fallback (FALLBACK_REASONS) may be another agent's context — for
// a dispatched call, `main` is the dispatcher's own — so it measures and reports, never hands off.
const HANDS_OFF = new Set(['in-flight', 'explicit']);
const NOT_IDENTIFIED_REASON = 'handoff.json not written: the caller was not identified, so the measured transcript may be another agent\'s (only an in-flight or --transcript identification hands off)';

// Measure, and write the handoff when over. Never throws: every failure is a
// `reason` on the result (the fail-open contract); several join with '; '.
async function measure({ runDir, runId, cwd, cap, nextSteps, transcriptArg }, deps) {
  const result = { contextTokens: null, cap, over: false, transcript: null, handoff: null, reason: null };
  const reasons = [];
  const done = (why) => {
    if (why) reasons.push(why);
    result.reason = reasons.length ? reasons.join('; ') : null;
    return result;
  };
  let identified = null;
  try {
    let found;
    if (transcriptArg) {
      found = { path: path.resolve(cwd, transcriptArg), kind: 'explicit', identified: 'explicit' };
    } else {
      const sessionId = deps.env.CLAUDE_CODE_SESSION_ID;
      if (!sessionId) return done('no transcript found: CLAUDE_CODE_SESSION_ID is not set (pass --transcript <path>)');
      found = deps.findAgentTranscript({ runId, sessionId, cwd, configDir: deps.env.CLAUDE_CONFIG_DIR || undefined });
      if (!found) return done(`no transcript found for session ${sessionId} (no main transcript under the config dir's projects/)`);
      if (FALLBACK_REASONS[found.identified]) reasons.push(FALLBACK_REASONS[found.identified]);
    }
    identified = found.identified;
    result.transcript = found.path;
    let measured;
    try {
      measured = await deps.gauge({ transcript: found.path });
    } catch (e) {
      return done(`transcript not readable (${(e && e.code) || 'EUNKNOWN'}): ${found.path}`);
    }
    if (!measured || !Number.isFinite(measured.contextTokens)) return done(`transcript has no assistant turn: ${found.path}`);
    result.contextTokens = measured.contextTokens;
    result.over = measured.contextTokens > cap;
  } catch (e) {
    result.contextTokens = null;
    result.over = false;
    return done(`measurement failed: ${errText(e)}`);
  }
  if (!result.over || !nextSteps) return done();
  if (!HANDS_OFF.has(identified)) return done(NOT_IDENTIFIED_REASON);

  try {
    const previous = deps.readHandoffCount(runDir);
    if (previous >= HANDOFF_BOUND) return done(`handoff bound reached (${HANDOFF_BOUND} handoffs this run): continue in place`);
    let state = null;
    try { state = deps.readRunState(runDir); } catch { state = null; }
    const worktree = state && typeof state.worktree === 'string' ? state.worktree : null;
    const targets = deps.resolveTargetRecords({ runDir, worktree, gitRoot: deps.gitRootOf(runDir) });
    if (!targets || targets.length === 0) {
      return done(`handoff.json not written: no target records (no spec-{N}/ dir, no work/{n}-spec.md in ${runDir}${worktree ? ' or its worktree copy' : ''})`);
    }
    // --next-steps names one record's remaining steps, so a resume over several records would
    // skip the later ones' earlier steps. Multi-spec handoff is #4358; until then continue in place.
    if (targets.length > 1) return done(`handoff.json not written: a multi-record run (${targets.join(', ')}) — handoff is single-record (#4358): continue in place`);
    const handoffPath = path.join(runDir, 'handoff.json');
    const mode = deps.readRunMode(runDir);
    const handoff = buildHandoff({ runDir, nextSteps, contextTokens: result.contextTokens, cap, targets, mode, handoffCount: previous + 1, now: deps.now() });
    deps.writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
    result.handoff = handoffPath;
  } catch (e) {
    return done(`handoff.json not written: ${errText(e)}`);
  }
  return done();
}

async function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; the rest stay real.
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`context-gauge.js: ${message}\n${USAGE}`); return 2; };

  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run is required');
  let cap = CONTEXT_CAP_TOKENS;
  if (o.cap !== undefined) {
    if (!/^[1-9]\d*$/.test(o.cap.trim())) return usageError(`--cap takes a positive integer: ${o.cap}`);
    cap = Number(o.cap.trim());
  }
  let nextSteps = null;
  if (o.nextSteps !== undefined) {
    const parsed = parseNextSteps(o.nextSteps);
    if (parsed.error) return usageError(parsed.error);
    nextSteps = parsed.steps;
  }

  let cwd;
  let target;
  try {
    cwd = deps.cwd();
    target = deps.resolveTarget({ runDir: path.resolve(cwd, o.run), cwd, mainRoot: deps.mainRoot });
  } catch (e) {
    return usageError(errText(e));
  }
  if (!target.ok) {
    return usageError(target.reason === 'missing'
      ? `--run dir does not exist or is not a directory: ${o.run}`
      : `--run ${o.run} is not anchored under the main checkout (a worktree-local shadow, or outside every checkout) — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }
  const runDir = target.dir;
  const runId = path.basename(runDir);
  if (!ctxLib.RUN_ID_RE.test(runId)) return usageError(`--run basename is not a run id (a spec- subdir answers for its parent run): ${runId}`);

  const result = await measure({ runDir, runId, cwd, cap, nextSteps, transcriptArg: o.transcript }, deps);
  if (result.reason) {
    try {
      deps.appendDecision(runDir, formatEntry({
        status: 'SKIP', now: deps.now(), step: 'Step 4 context cap',
        text: `condition: context-gauge ${result.reason} → fallback: continue in this agent`, reversibility: 'n/a',
      }));
    } catch { /* the trace is best-effort: the gauge never stops a run */ }
  }
  deps.stdout(`${JSON.stringify(result)}\n`);
  return 0;
}

module.exports = { run, parseArgs, parseNextSteps };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    // Unreachable by design (measure never throws); still fail open.
    process.stderr.write(`context-gauge.js: ${err && err.stack ? err.stack : err}\n`);
    process.stdout.write(`${JSON.stringify({ contextTokens: null, cap: null, over: false, transcript: null, handoff: null, reason: `internal error: ${errText(err)}` })}\n`);
    process.exitCode = 0;
  });
}
