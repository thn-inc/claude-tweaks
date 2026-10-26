#!/usr/bin/env node
// bin/pr-checklist.js -- flip or remove one phase row in a pr-first run's PR
// body with one call (#3263). The calling procedure is
// skills/_shared/pr-checklist-refresh.md's Phase-checklist update; the
// transforms are lib/flow/pr-checklist.js (the row edit) and lib/flow/pr-body.js
// (marker repair, Spec summary revision).
//
//   node bin/pr-checklist.js --run <run-dir> --phase <build|test|review|polish|wrap-up>
//     [--remove] [--fixes <n>[,<m>...]] [--summary-file <file>] [--help]
//
// Reads the run's PR body, restores any missing run marker / phases block /
// fixes block, flips (or with --remove drops) the one phase row, applies a
// pending Spec summary revision when --summary-file is given, and writes the
// result back in one `gh pr edit`. Every byte outside the edited row stays
// identical. Prints one JSON line: {action, pr, phase, row, restored,
// summary: {uncovered, reason, changed}}; action is written | no-op | no-pr |
// gh-absent (no-pr and gh-absent carry only {action} / {action, pr}); a
// `written` line adds `logFailed: true` when the restore line could not be
// appended to decisions.md (the PR write still landed).
//
// Status is data: exit 0 for written, no-op, no-pr and gh-absent.
// 2 malformed invocation, or an unreadable --summary-file.
// 3 run dir missing or not anchored under the main checkout (a worktree-local
//   shadow -- _shared/pipeline-run-dir.md, [IL-127]).
// 4 run-marker mismatch: the PR body's first line names a different run (or
//   none) -- refused, nothing written to the PR. The CLI logs the refusal
//   (`refused on PR #{n} — run marker mismatch (body names run {found|none},
//   expected {runId})`); the caller never retries by hand.
// 5 `gh pr view` or `gh pr edit` failed. The CLI logs the warning (`gh pr
//   {view|edit} failed on PR #{n} at {phase} exit — row left for the pre-merge
//   refresh`); the pre-merge refresh re-runs the CLI for that phase and catches
//   the row up.
// Both lines are AUTO, step `PR checklist refresh`, reversibility n/a. A failed
// append adds one stderr line and never changes the exit code.
// 4 and 5 are distinct because the refresh procedure branches on them: a
// mismatch is a wrong-PR signal a retry cannot fix, a gh failure is transient.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CANONICAL_PHASES, repairPrBody, reviseSpecSummary } = require('./lib/flow/pr-body');
const { setPhaseRow, firstLineRunId, readRunReversals } = require('./lib/flow/pr-checklist');
const { readManifest } = require('./lib/flow/manifest');
const { resolveTarget, appendEntry, formatEntry } = require('./lib/log-decision/append');
const { readRunStateWithParent } = require('./lib/hooks/context');
const { ghAvailable } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives');

const USAGE = 'usage: pr-checklist.js --run <run-dir> --phase <build|test|review|polish|wrap-up>\n'
  + '         [--remove] [--fixes <n>[,<m>...]] [--summary-file <file>] [--help]\n'
  + '  flips (or with --remove drops) one phase row in the run\'s PR body, in one gh pr edit\n'
  + '  prints {action, pr, phase, row, restored, summary}; action: written | no-op | no-pr | gh-absent\n'
  + '  exit 0 done or status-as-data (no-pr, gh-absent, no-op)\n'
  + '       2 malformed invocation or unreadable --summary-file\n'
  + '       3 run dir missing or not anchored under the main checkout\n'
  + '       4 run marker mismatch -- refused, nothing written\n'
  + '       5 gh pr view / gh pr edit failed\n'
  + '  4 and 5 append their own AUTO line to decisions.md\n';

const VALUE_FLAGS = { '--run': 'run', '--phase': 'phase', '--summary-file': 'summaryFile' };

function parseArgs(argv) {
  const o = { run: null, phase: null, remove: false, fixes: [], summaryFile: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--remove') { o.remove = true; continue; }
    if (a !== '--fixes' && !(a in VALUE_FLAGS)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    i++;
    if (a === '--fixes') {
      const parts = v.split(',');
      if (!parts.every((p) => /^[1-9]\d*$/.test(p))) return { error: `--fixes takes positive integers, comma-separated: ${v}` };
      o.fixes = parts.map(Number);
    } else {
      o[VALUE_FLAGS[a]] = v;
    }
  }
  if (o.phase !== null && !CANONICAL_PHASES.includes(o.phase)) {
    return { error: `--phase must be one of ${CANONICAL_PHASES.join(', ')}: ${o.phase}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  ghAvailable: () => ghAvailable(),
  gh: (args, input) => execFileSync('gh', args, {
    encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  }),
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readManifest,
  appendDecision: ({ runDir, entry }) => appendEntry({ runDir, entry }),
  now: () => new Date(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function errText(e) {
  return [e && e.message, e && e.stderr, e && e.stdout].filter(Boolean).join(' ').trim() || String(e);
}

function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; the rest stay real.
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`pr-checklist.js: ${message}\n${USAGE}`); return 2; };
  const print = (body) => { deps.stdout(`${JSON.stringify(body)}\n`); return 0; };

  // 1. Parse / validate. --help answers before any probe.
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.phase) return usageError('--phase <build|test|review|polish|wrap-up> is required');

  // 2. The run dir must be the main checkout's, never a worktree-local shadow.
  const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`pr-checklist.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`pr-checklist.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  // 3. The PR number and run id; a per-spec dir answers for its parent run.
  let resolved = { state: null, parentRunDir: null };
  try { resolved = deps.readRunState(o.run) || resolved; } catch { /* no readable run-state: no-pr */ }
  const n = resolved.state && resolved.state.pr && resolved.state.pr.number;
  if (!Number.isInteger(n) || n <= 0) return print({ action: 'no-pr' });
  const runDir = resolved.parentRunDir || o.run;
  const runId = path.basename(runDir);

  // An exit-4 / exit-5 outcome logs its own decisions.md line. A failed append
  // adds one stderr line only -- the exit code already carries the outcome.
  const logLine = (text) => {
    try {
      deps.appendDecision({
        runDir: o.run,
        entry: formatEntry({ status: 'AUTO', now: deps.now(), step: 'PR checklist refresh', text, reversibility: 'n/a' }),
      });
    } catch (e) {
      deps.stderr(`pr-checklist.js: could not append the decisions.md entry: ${(e && e.message) || e}\n`);
    }
  };
  const ghFailed = (verb) => {
    logLine(`gh pr ${verb} failed on PR #${n} at ${o.phase} exit — row left for the pre-merge refresh`);
    return 5;
  };

  // 4. No gh: status as data, never a failure.
  if (!deps.ghAvailable()) return print({ action: 'gh-absent', pr: n });

  // 5. The agent-written summary paragraph, read from a file so record text
  // never passes through a shell.
  let summary;
  if (o.summaryFile) {
    try { summary = deps.readFile(o.summaryFile); } catch (e) {
      return usageError(`could not read --summary-file: ${o.summaryFile} (${errText(e)})`);
    }
  }

  // 6. Read the live body. A body that is not a string is a read failure --
  // the transforms coerce a non-string to '', which would write a rebuilt body
  // over a PR whose real body was never read.
  let original;
  try {
    original = JSON.parse(deps.gh(['pr', 'view', String(n), '--json', 'body'])).body;
  } catch (e) {
    deps.stderr(`pr-checklist.js: gh pr view failed on PR #${n}: ${errText(e)}\n`);
    return ghFailed('view');
  }
  if (typeof original !== 'string') {
    deps.stderr(`pr-checklist.js: gh pr view on PR #${n} returned no string body field\n`);
    return ghFailed('view');
  }

  // 7. Repair, flip the row, then revise the Spec summary -- one body, one write.
  const repaired = repairPrBody({ body: original, runId, fixesLines: o.fixes.map((f) => `Fixes #${f}`) });
  const flipped = setPhaseRow({ body: repaired.body, phase: o.phase, remove: o.remove });
  const revised = reviseSpecSummary({ body: flipped.body, reversals: readRunReversals(runDir, deps), summary });
  const final = revised.changed ? revised.body : flipped.body;

  // 8. A body naming another run is another run's PR: refuse, write nothing.
  const found = firstLineRunId(final);
  if (found !== runId) {
    const detail = `body names run ${found || 'none'}, expected ${runId}`;
    deps.stderr(`pr-checklist.js: run marker mismatch on PR #${n}: ${detail} — nothing written\n`);
    logLine(`refused on PR #${n} — run marker mismatch (${detail})`);
    return 4;
  }

  const envelope = {
    pr: n,
    phase: o.phase,
    row: flipped.row,
    restored: repaired.restored,
    summary: { uncovered: revised.uncovered, reason: revised.reason, changed: revised.changed },
  };

  // 9. Nothing differs from what the PR already carries: no write.
  if (final === original) return print({ action: 'no-op', ...envelope });

  // 10. One write.
  try {
    deps.gh(['pr', 'edit', String(n), '--body-file', '-'], final);
  } catch (e) {
    deps.stderr(`pr-checklist.js: gh pr edit failed on PR #${n}: ${errText(e)}\n`);
    return ghFailed('edit');
  }

  // 11. A repair is worth a decisions.md line; a logging failure never changes the exit.
  let logFailed = false;
  if (repaired.restored.length > 0) {
    const carried = repaired.restored.length === 3 ? 'none' : 'some';
    try {
      deps.appendDecision({
        runDir: o.run,
        entry: formatEntry({
          status: 'AUTO',
          now: deps.now(),
          step: 'PR checklist refresh',
          text: `restored ${repaired.restored.join(', ')} on PR #${n} (body carried ${carried} of the expected markers)`,
          reversibility: 'high',
        }),
      });
    } catch { logFailed = true; }
  }

  // 12. Report the write.
  return print({ action: 'written', ...envelope, ...(logFailed ? { logFailed: true } : {}) });
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
