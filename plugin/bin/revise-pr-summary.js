#!/usr/bin/env node
// bin/revise-pr-summary.js — refresh a pr-first run's PR `### Spec summary`
// after build logged a premise reversal (#3050).
//   node bin/revise-pr-summary.js --run-dir <dir> --body-file <file>
//     [--summary-file <file> --out <file>] [--help]
// Reads this run's `premise reversed:` decisions.md entries (a bundle's
// every spec-{id}/decisions.md, else the run's own decisions.md) and the PR
// body in --body-file. Without --summary-file it reports which reversals the
// body's `Revised during build:` note does not yet name, and writes nothing.
// With --summary-file (the agent-written one-paragraph summary, read from a
// file so record text never passes through a shell) and --out, it writes the
// revised body to --out — only when something changed. The rewrite itself is
// bin/lib/flow/pr-body.js's reviseSpecSummary; the procedure that calls this
// is _shared/pr-checklist-refresh.md's Phase-checklist update.
// Exit 0 = reported or applied (stdout: one JSON line); 2 = malformed
// invocation, a --run-dir that is not a directory or is a worktree-local
// shadow of the run dir, an unreadable --body-file/--summary-file, or an
// unwritable --out.
// --run-dir takes the anchored-or-outside posture (run-dir-guard.js, the
// resolver family's rule): a path inside a checkout must be the main
// checkout's run dir, so a shadow never yields a confident `no-reversals`
// (IL-127); a path outside every checkout is accepted, which the subprocess
// test's temp run dir relies on. Every caller treats any non-zero exit the
// same way (log a warning, write the checklist-only body), so exit 2 suffices.
'use strict';

const fs = require('fs');
const path = require('path');
const { parsePremiseReversals, reviseSpecSummary } = require('./lib/flow/pr-body');
const { readManifest } = require('./lib/flow/manifest');
const { writeFileAtomic } = require('./lib/atomic-write');
const { anchoredOrOutsideMessage } = require('./lib/run-dir-guard');

const USAGE = 'usage: revise-pr-summary.js --run-dir <dir> --body-file <file> [--summary-file <file> --out <file>] [--help]\n';

const FLAGS = { '--run-dir': 'runDir', '--body-file': 'bodyFile', '--summary-file': 'summaryFile', '--out': 'out' };

function parseArgs(argv) {
  const o = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!(a in FLAGS)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => writeFileAtomic(p, s),
  readManifest,
  isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  cwd: () => process.cwd(),
  anchoredOrOutsideMessage,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// A missing decisions.md contributes nothing — the same fail-open posture as
// manifest.js's readDeferredClosures.
function readReversals(runDir, deps) {
  const manifest = deps.readManifest(runDir);
  const specs = manifest && manifest.multispec && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs : null;
  const files = specs
    ? specs.map((s) => path.join(runDir, `spec-${s.id}`, 'decisions.md'))
    : [path.join(runDir, 'decisions.md')];
  let text = '';
  for (const f of files) {
    try { text += `${deps.readFile(f)}\n`; } catch { /* no decisions.md for this spec */ }
  }
  return parsePremiseReversals(text);
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`revise-pr-summary.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  for (const flag of ['--run-dir', '--body-file']) {
    if (!o[FLAGS[flag]]) return usageError(`${flag} is required`);
  }
  if (!deps.isDirectory(o.runDir)) return usageError(`--run-dir is not a directory: ${o.runDir}`);
  let rejection;
  try { rejection = deps.anchoredOrOutsideMessage(o.runDir, deps.cwd(), '--run-dir'); } catch (err) {
    return usageError(`could not check --run-dir anchoring: ${err && err.message}`);
  }
  if (rejection) { deps.stderr(`revise-pr-summary.js: ${rejection}\n`); return 2; }
  if (Boolean(o.summaryFile) !== Boolean(o.out)) return usageError('--summary-file and --out go together');

  let body;
  try { body = deps.readFile(o.bodyFile); } catch (err) {
    return usageError(`could not read --body-file: ${o.bodyFile} (${err && err.message})`);
  }
  let summary;
  if (o.summaryFile) {
    try { summary = deps.readFile(o.summaryFile); } catch (err) {
      return usageError(`could not read --summary-file: ${o.summaryFile} (${err && err.message})`);
    }
  }

  const reversals = readReversals(o.runDir, deps);
  const result = reviseSpecSummary({ body, reversals, summary });
  const report = { reversals: reversals.length, uncovered: result.uncovered, changed: result.changed, reason: result.reason };
  if (result.changed) {
    try { deps.writeFile(o.out, result.body); } catch (err) {
      deps.stderr(`revise-pr-summary.js: could not write --out file: ${o.out} (${err && err.message})\n`);
      return 2;
    }
    report.out = o.out;
  }
  deps.stdout(`${JSON.stringify(report)}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
