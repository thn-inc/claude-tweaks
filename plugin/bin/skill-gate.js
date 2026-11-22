#!/usr/bin/env node
// bin/skill-gate.js — the skill-load gate (record #5605): decide, before a
// lifecycle step loads `journeys`, `visual-review` or `design-wrapper {mode}`,
// whether the skill has anything to do. The rules live in lib/skill-gate/;
// this CLI resolves the inputs (changed files, CLAUDE.md's design-integration
// flag, docs/journeys/) and writes the skip's decisions.md line. The contract
// callers follow is _shared/skill-load-gate.md.
//
// Prints exactly one JSON line: {decision: "proceed"|"skip", reason,
// journeys? (a visual-review skip: the journeys whose files: overlap),
// logged? (a skip: true when the decisions.md line was written, false when no
// --run was given or the write failed)}.
//
// Fail-open: when the gate cannot tell (changed files unresolvable, an empty
// list, an unreadable journey, a rule that threw) it prints `proceed` with a
// reason starting "cannot tell: ", writes that reason as one stderr line, and
// logs nothing.
//
// Exit codes: 0 either decision; 2 malformed invocation (usage on stderr);
// 3 --run names a directory that is missing or not anchored under the main
// checkout (a worktree-local shadow, or a directory outside pipelines/ -- _shared/pipeline-run-dir.md, [IL-127]);
// nothing is written.
'use strict';

const { execFileSync } = require('child_process');
const { SKILLS, WRAPPER_MODES, CANNOT_TELL, gate: libGate } = require('./lib/skill-gate');
const sharedPrimitives = require('./lib/shared-primitives');
const { readDesignIntegrationFlagFromFile } = require('./lib/design-detect');
const { resolveTarget, formatEntry, appendEntry } = require('./lib/log-decision/append');

const USAGE = 'usage: skill-gate.js --skill journeys|visual-review|design-wrapper [--mode pre-build|test|review|polish|survey]\n'
  + '         [--surface <value>] (--files <a,b> | --integration-branch <ref>) [--run <run-dir> --section "/<skill>" --step "<step name>"]\n'
  + '       skill-gate.js --help\n'
  + '  --mode is required for design-wrapper and invalid for the other skills\n'
  + '  --files is the changed-file list, comma-separated; --integration-branch resolves it from the branch instead; pass one of the two\n'
  + '    (design-wrapper pre-build needs neither: no diff exists before the build)\n'
  + '  --run, --section and --step go together: a skip appends one SKIP line to the run\'s decisions.md\n'
  + '  prints {decision: proceed|skip, reason, journeys? (visual-review skip), logged? (skip)}\n'
  + '  proceed with a reason starting "cannot tell: " means the gate could not decide; it also writes that reason to stderr\n'
  + '  exit 0 either decision; 2 malformed invocation; 3 run dir missing or not anchored under the main checkout\'s .claude-tweaks/pipelines\n';

const VALUE_FLAGS = {
  '--skill': 'skill',
  '--mode': 'mode',
  '--surface': 'surface',
  '--files': 'files',
  '--integration-branch': 'integrationBranch',
  '--run': 'run',
  '--section': 'section',
  '--step': 'step',
};

// --help / -h in flag position. A token a value flag consumes is a value, so
// `--step -h` is a step named -h; a value flag followed by a `--` token has no
// value (parseArgs rejects it), and that token is read as a flag here.
function wantsHelp(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return true;
    if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a)) {
      const v = argv[i + 1];
      if (v === '--help') return false; // the flag's missing value, which parseArgs rejects (exit 2)
      if (v !== undefined && !v.startsWith('--')) i += 1;
    }
  }
  return false;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const key = Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a) ? VALUE_FLAGS[a] : null;
    if (key === null) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    if (o[key] !== undefined) return { error: `${a} given more than once` };
    o[key] = v;
    i += 1;
  }
  if (o.skill === undefined || !SKILLS.includes(o.skill)) return { error: `--skill must be one of ${SKILLS.join(', ')}` };
  if (o.skill === 'design-wrapper') {
    if (o.mode === undefined) return { error: '--mode is required for design-wrapper' };
    if (!WRAPPER_MODES.includes(o.mode)) return { error: `--mode must be one of ${WRAPPER_MODES.join(', ')}` };
  } else if (o.mode !== undefined) {
    return { error: '--mode is valid only with --skill design-wrapper' };
  }
  if (o.files !== undefined && o.integrationBranch !== undefined) return { error: '--files and --integration-branch are mutually exclusive' };
  if (o.files === undefined && o.integrationBranch === undefined && !(o.skill === 'design-wrapper' && o.mode === 'pre-build')) {
    return { error: 'one of --files or --integration-branch is required' };
  }
  const logging = ['run', 'section', 'step'].filter((k) => o[k] !== undefined).length;
  if (logging !== 0 && logging !== 3) return { error: '--run, --section and --step go together' };
  if (o.files !== undefined) {
    o.files = o.files.split(',').map((f) => f.trim()).filter((f) => f !== '');
  }
  return o;
}

function skillLabel(o) {
  return o.skill === 'design-wrapper' ? `design-wrapper ${o.mode}` : o.skill;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  env: process.env,
  now: () => Date.now(),
  mainRoot: undefined,
  gate: libGate,
  appendDecision: (args) => appendEntry(args),
  readDesignIntegration: (root) => readDesignIntegrationFlagFromFile(root),
  // (cwd, env) -> the checkout's top-level directory; throws outside a git repo.
  repoRoot: (cwd, env) => String(execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd, env, timeout: sharedPrimitives.GIT_TIMEOUT_MS,
  })).trim(),
};

function errText(e) {
  return (e && e.message) || String(e);
}

function resolveRoot(deps) {
  const cwd = deps.cwd();
  try {
    const r = deps.repoRoot(cwd, deps.env);
    if (typeof r === 'string' && r) return r;
  } catch { /* not a git repo: fall back to cwd */ }
  return cwd;
}

function logSkip(deps, o, reason) {
  if (o.run === undefined) return false;
  try {
    const entry = formatEntry({
      status: 'SKIP',
      now: deps.now(),
      step: `${o.step} (skipped)`,
      text: `condition: ${reason.replace(/\s+/g, ' ').trim()} → fallback: ${skillLabel(o)} not loaded`,
      reversibility: 'n/a',
    });
    deps.appendDecision({ runDir: o.run, section: o.section, entry });
    return true;
  } catch (e) {
    deps.stderr(`skill-gate: could not append the decisions.md entry: ${errText(e).replace(/\s+/g, ' ')}\n`);
    return false;
  }
}

function run(argv, deps = realDeps) {
  if (wantsHelp(argv)) { deps.stdout(USAGE); return 0; }
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`skill-gate.js: ${o.error}\n${USAGE}`); return 2; }

  if (o.run !== undefined) {
    let target;
    try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (e) {
      deps.stderr(`skill-gate.js: could not resolve the run dir: ${errText(e)}\n`);
      return 3;
    }
    if (!target.ok) {
      if (target.reason === 'missing') deps.stderr(`skill-gate.js: run dir does not exist: ${o.run}\n`);
      else deps.stderr(`skill-gate.js: run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
      return 3;
    }
  }

  const root = resolveRoot(deps);
  let designIntegration = null;
  if (o.skill === 'design-wrapper') {
    try { designIntegration = deps.readDesignIntegration(root); } catch { designIntegration = null; }
  }

  let result;
  try {
    result = deps.gate({
      skill: o.skill,
      mode: o.mode,
      surface: o.surface,
      files: o.files === undefined ? null : o.files,
      integrationBranch: o.integrationBranch,
      root,
      designIntegration,
      env: deps.env,
    });
    if (!result || (result.decision !== 'proceed' && result.decision !== 'skip') || typeof result.reason !== 'string') {
      throw new Error('the gate returned no decision');
    }
  } catch (e) {
    result = { decision: 'proceed', reason: `${CANNOT_TELL}gate error: ${errText(e).replace(/\s+/g, ' ')}`, cannotTell: true };
  }

  if (result.cannotTell) deps.stderr(`skill-gate: ${result.reason}\n`);
  const skip = result.decision === 'skip';
  const logged = skip ? logSkip(deps, o, result.reason) : undefined;
  deps.stdout(`${JSON.stringify({
    decision: result.decision,
    reason: result.reason,
    ...(result.journeys && { journeys: result.journeys }),
    ...(skip && { logged }),
  })}\n`);
  return 0;
}

module.exports = { run, realDeps, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
