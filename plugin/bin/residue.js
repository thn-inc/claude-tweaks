#!/usr/bin/env node
// bin/residue.js — compute outstanding residue at close time.
//
// Exit codes: 0 for any successful render INCLUDING a degraded one; 2 only
// for a malformed invocation. Copies bin/wrap-up-state.js's contract — a
// degraded read must never cost the caller the whole report.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { MANIFEST_PATHS } = require('./lib/manifest-path');
const { resolveScope } = require('./lib/residue/scope');
const { hasTestScript } = require('./lib/residue/detect-test-script');
const { probeWorktrees } = require('./lib/residue/probes/worktrees');
const { probeBranches } = require('./lib/residue/probes/branches');
const { probeForge } = require('./lib/residue/probes/forge');
const { probeSuite } = require('./lib/residue/probes/suite');
const { probeRelease } = require('./lib/residue/probes/release');
const { probePipelineRuns } = require('./lib/residue/probes/pipeline-runs');
const { probeArtifacts } = require('./lib/residue/probes/artifacts');
const { renderOutstanding } = require('./lib/residue/render');
const { filterResultsByScope } = require('./lib/residue/scope-filter');

function parseArgs(argv) {
  // 'repo' is the default deliberately: it is what this CLI has always done
  // (--scope was parsed but never read), so defaulting to it keeps every
  // existing caller and documented behavior valid. A red-suite finding is
  // now always `scope: 'blast-radius'` and so is never hidden under either
  // scope; 'repo' still matters for other `observed` findings (a sibling
  // worktree, another lane's PR) that blast-radius would otherwise drop.
  const out = {
    base: null, scope: 'repo', integrationBranch: 'origin/main', json: false, noSuite: false, ownPr: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--base' && next && !next.startsWith('--')) { out.base = next; i += 1; continue; }
    if (argv[i] === '--scope' && next && !next.startsWith('--')) { out.scope = next; i += 1; continue; }
    if (argv[i] === '--integration-branch' && next && !next.startsWith('--')) { out.integrationBranch = next; i += 1; continue; }
    // No pre-existing --flag-value integer-flag convention in this file to
    // mirror; Number(next) on a non-numeric or non-integer string yields NaN
    // or a fraction, both caught by main()'s Number.isInteger(opts.ownPr)
    // check below — same two-step parse/validate split release-claim.js and
    // materialize.js use for their own positive-integer args.
    if (argv[i] === '--own-pr' && next && !next.startsWith('--')) { out.ownPr = Number(next); i += 1; continue; }
    if (argv[i] === '--json') { out.json = true; continue; }
    if (argv[i] === '--no-suite') { out.noSuite = true; continue; }
  }
  return out;
}

const USAGE = 'usage: residue.js --base <commit-ish> [--scope repo|blast-radius] [--integration-branch <ref>] [--own-pr <n>] [--no-suite] [--json]\n';

function runner(cwd) {
  // `opts` lets a caller pass extra `execFileSync` options (e.g. `timeout`)
  // for a specific command without changing every other call through this
  // shared seam — a probe that needs to contact a remote (unlike the
  // local-only checks every probe currently runs) needs a bound; the
  // existing catch-all below already treats a timeout kill the same as any
  // other failure (returns null), so no new error handling is needed here.
  // `maxBuffer` defaults to 64 MiB (mirrors suiteRun()'s own bound below) —
  // Node's execFileSync default is 1 MiB, and CHANGELOG.md alone (read via
  // `git show HEAD:CHANGELOG.md` in probeRelease) is already a quarter of
  // that and growing; an overflow past the default silently fell into the
  // bare catch below and read as an ordinary degraded probe. `opts` can
  // still override it per call through the same spread.
  return (argv, opts = {}) => {
    try {
      return execFileSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
    } catch {
      return null;
    }
  };
}

// Both spellings of this repo's own manifest, new path first (#418's payload
// cutover moved it under `plugin/`). No longer consulted by probeRelease
// (#2257 dropped its `manifest.name === 'claude-tweaks'` gate in favor of a
// project-agnostic tag/CHANGELOG check) — kept as a general-purpose reader
// for callers that still need this repo's own manifest. An absent — or
// unparseable — manifest stays normal: every other project this CLI runs in
// has none.
function readProjectManifest(cwd) {
  for (const manifestPath of MANIFEST_PATHS) {
    try {
      return JSON.parse(fs.readFileSync(path.join(cwd, manifestPath), 'utf8'));
    } catch { /* try the next spelling */ }
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.base) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  if (opts.ownPr !== null && !Number.isInteger(opts.ownPr)) {
    process.stderr.write(`residue.js: --own-pr must be an integer\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const cwd = process.cwd();
  const run = runner(cwd);
  const git = (args, execOpts) => run(['git', ...args], execOpts);
  const scope = resolveScope({ base: opts.base, run: git });

  const suiteRun = () => {
    try {
      return { code: 0, stdout: execFileSync('npm', ['test'], { cwd, encoding: 'utf8', timeout: 600000, maxBuffer: LARGE_MAX_BUFFER_BYTES, stdio: ['ignore', 'pipe', 'ignore'] }) };
    } catch (err) {
      if (err && (err.killed || err.code === 'ETIMEDOUT')) return { code: null, stdout: '', timedOut: true };
      if (err && err.code === 'ENOBUFS') return { code: null, stdout: '', bufferOverflowed: true };
      if (err && typeof err.status === 'number') return { code: err.status, stdout: String(err.stdout || '') };
      return null;
    }
  };

  // A deliberate skip is still `unknown` — we do not know the suite's state —
  // but it is NOT a failure to run, and saying so would read as an environment
  // problem the user did not have. probeSuite's own contract has no third
  // outcome, so the honest reason is supplied here, where the choice was made.
  // Same logic for a missing test script: `npm test` with no `scripts.test`
  // key exits non-zero for a reason that has nothing to do with this repo's
  // code, so check the script exists BEFORE ever invoking npm — verified
  // live: a directory with no package.json used to report a fabricated
  // "test suite exit 254" finding instead of `unknown`.
  let suiteResult;
  if (opts.noSuite) {
    suiteResult = { ran: false, reason: 'skipped via --no-suite', findings: [] };
  } else if (!hasTestScript(cwd)) {
    suiteResult = { ran: false, reason: 'no test command detected', findings: [] };
  } else {
    suiteResult = probeSuite({ scope, run: suiteRun });
  }

  // A blank or whitespace-only value (the shape an unset $PIPELINE_RUN_DIR
  // expands to in shell) is treated as no value at all — same shape as
  // materialize.js's --run-dir and resolve-policy.js's --run (#1118).
  const pipelineRunDir = process.env.PIPELINE_RUN_DIR;
  const pipelineRunId = pipelineRunDir && pipelineRunDir.trim() !== '' ? path.basename(pipelineRunDir) : null;

  // NOTE the runner shapes differ and are NOT interchangeable. probeBranches
  // calls run(['branch', ...]) — bare git args, so it gets the `git` wrapper.
  // probeRelease calls run(['git', 'show', ...]) — full argv including the
  // executable — so it gets the raw `run`, like probeForge.
  // Passing `git` here yields `git git show …`, and the probe then reports
  // ran:false on every invocation of a perfectly healthy repo.
  const results = filterResultsByScope([
    probeWorktrees({ scope }),
    probeBranches({ scope, integrationBranch: opts.integrationBranch, run: git }),
    probeForge({ scope, run, ownPr: opts.ownPr }),
    suiteResult,
    probeRelease({ scope, run }),
    probePipelineRuns({
      cwd,
      // The invoking run's identity, when one is threaded (wrap-up runs
      // inside a pipeline run; standalone invocations have none) — #1118.
      runId: pipelineRunId,
      worktreeRoot: git(['rev-parse', '--show-toplevel']),
      // #1328: lets the probe cross-check a status: clean finding's
      // recorded worktree against the already-resolved locked-worktree
      // list, instead of re-invoking git from inside the probe itself.
      scope,
    }),
    probeArtifacts({ cwd, run: git }),
  ], opts.scope);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ scope, results }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderOutstanding({ results })}\n`);
  }
}

if (require.main === module) main();

module.exports = { readProjectManifest };
