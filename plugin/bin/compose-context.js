#!/usr/bin/env node
// bin/compose-context.js — per-run skill-context composer (#1988).
//   node bin/compose-context.js --run <run-dir> --step <name> <source-file>...
// Resolves the run's six-key condition set, strips the `<!-- when: key=value -->`
// branches the run didn't take, concatenates the sources in argv order, and
// writes one bundle at {run}/context/{step}.md a skill step reads once.
// stdout: exactly one JSON line {path, bytes, sources, unresolved}.
// Exit 0 success; 2 malformed invocation (usage on stderr) OR malformed marker
// (offending file:line on stderr) OR a --run dir that is missing or resolves
// inside a checkout other than the main one (bin/lib/run-dir-guard.js's
// anchored-or-outside rule, #1065/[IL-127] — a path outside any checkout is
// accepted, a worktree-local shadow is refused) — on every exit-2 case nothing
// is written and a prior bundle at the output path is left untouched; 1
// filesystem failure (unreadable source, unwritable output, or a cwd or --run
// dir that cannot be read). Same run(argv, deps) seam and require.main guard as
// bin/build-review-context.js.
'use strict';
const fs = require('fs');
const path = require('path');
const { anchoredOrOutsideMessage } = require('./lib/run-dir-guard');
const wtDetect = require('./lib/hooks/worktree-detect');
const { composeContext } = require('./lib/compose-context');

const USAGE = 'usage: compose-context.js --run <run-dir> --step <name> <source-file>... [--help]\n';
const STEP_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // one path segment — never a traversal

function parseArgs(argv) {
  const o = { run: null, step: null, sources: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--step') o.step = next();
    else if (a.startsWith('--')) return { error: `unknown argument: ${a}` };
    else o.sources.push(a);
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: (p) => wtDetect.mainCheckoutRoot(p),
  isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  anchoredOrOutsideMessage,
  composeContext,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const usageError = (message) => { d.stderr(`compose-context.js: ${message}\n${USAGE}`); return 2; };
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { d.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.step || !STEP_RE.test(o.step)) return usageError('--step <name> is required and must be one plain path segment (letters, digits, . _ -)');
  if (o.sources.length === 0) return usageError('at least one <source-file> is required');

  let cwd;
  try { cwd = d.cwd(); } catch (err) { d.stderr(`compose-context.js: ${err && err.message}\n`); return 1; }
  const runDir = path.resolve(cwd, o.run);
  let isDir;
  // A stat that throws (EIO, EACCES on a parent) is a filesystem failure, not a
  // missing run dir — exit 1, like any other read the CLI cannot complete.
  try { isDir = d.isDirectory(runDir); } catch (err) { d.stderr(`compose-context.js: ${err && err.message}\n`); return 1; }
  if (!isDir) { d.stderr(`compose-context.js: --run ${o.run} is not a directory\n`); return 2; }
  let rejection;
  try { rejection = d.anchoredOrOutsideMessage(runDir, cwd, '--run'); } catch (err) { d.stderr(`compose-context.js: ${err && err.message}\n`); return 2; }
  if (rejection) { d.stderr(`compose-context.js: ${rejection}\n`); return 2; }

  let repoRoot;
  try { repoRoot = d.mainRoot(cwd) || cwd; } catch { repoRoot = cwd; }
  const sources = o.sources.map((label) => ({ label, file: path.resolve(cwd, label) }));

  let result;
  try {
    result = d.composeContext({ runDir, step: o.step, sources, repoRoot }, d);
  } catch (err) {
    if (err && err.name === 'MarkerError') {
      d.stderr(`compose-context.js: ${err.file}:${err.line}: ${err.message}\n`);
      return 2;
    }
    d.stderr(`compose-context.js: ${err && err.message}\n`);
    return 1; // SourceReadError, or the write's own fs error
  }
  d.stdout(JSON.stringify(result) + '\n');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`compose-context.js: ${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run, parseArgs };
