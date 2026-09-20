#!/usr/bin/env node
// bin/build-review-context.js — mint a collision-free review scratch dir and build the shared
// context bundle /claude-tweaks:review Step 3's lens agents read (step3-lens-dispatch.md).
//   node bin/build-review-context.js mint [--run <run-dir>] [--print-dir]
//   node bin/build-review-context.js build --base <ref> --branch <ref> [--dir <dir>|--run <run-dir>] [--files-from <path>]
// Prints a one-line JSON result on stdout ({dir} for mint; {dir, contextPath, bytes, files,
// emptySections} for build) by default. `mint --print-dir` instead prints the bare directory
// path followed by a newline and nothing else — a shell-substitution convenience; `--print-dir`
// is mint-only and rejected on build. Exit 0 ok; 2 malformed invocation; 1 git/filesystem failure.
// Single plain command by design — the compound-shell recipe it replaces is refused by the
// harness worktree guard (refs #887).
'use strict';

const { resolveDir, buildContext } = require('./lib/review-context/build');

const USAGE =
  'usage: build-review-context.js mint [--run <run-dir>] [--print-dir]\n' +
  '       build-review-context.js build --base <ref> --branch <ref> [--dir <dir>|--run <run-dir>] [--files-from <path>]\n';

function parseArgs(argv) {
  const o = { command: null, base: null, branch: null, dir: null, run: null, filesFrom: null, printDir: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--base') o.base = next();
    else if (a === '--branch') o.branch = next();
    else if (a === '--dir') o.dir = next();
    else if (a === '--run') o.run = next();
    else if (a === '--files-from') o.filesFrom = next();
    else if (a === '--print-dir') o.printDir = true;
    else if (!a.startsWith('--') && o.command === null) o.command = a;
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  resolveDir,
  buildContext,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) {
    deps.stderr(o.error + '\n' + USAGE);
    return 2;
  }
  if (o.help) {
    deps.stdout(USAGE);
    return 0;
  }
  if (o.command === 'mint') {
    const dir = deps.resolveDir({ run: o.run });
    if (o.printDir) {
      deps.stdout(dir + '\n');
    } else {
      deps.stdout(JSON.stringify({ dir }) + '\n');
    }
    return 0;
  }
  if (o.command === 'build') {
    if (o.printDir) {
      deps.stderr('build-review-context.js: --print-dir is mint-only\n' + USAGE);
      return 2;
    }
    if (!o.base || !o.branch) {
      deps.stderr('build-review-context.js: build requires --base and --branch\n' + USAGE);
      return 2;
    }
    const dir = deps.resolveDir({ dir: o.dir, run: o.run });
    const result = deps.buildContext({ base: o.base, branch: o.branch, dir, filesFrom: o.filesFrom });
    deps.stdout(JSON.stringify(result) + '\n');
    return 0;
  }
  deps.stderr(`build-review-context.js: unknown command: ${o.command === null ? '(none)' : o.command}\n` + USAGE);
  return 2;
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`build-review-context.js: ${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run, parseArgs };
