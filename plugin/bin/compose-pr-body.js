#!/usr/bin/env node
// bin/compose-pr-body.js — write a PR-early draft-PR body to a file (#3120).
//   node bin/compose-pr-body.js --run-id <id> --target <ref> --next-step <step>
//     --summary-file <file> --fixes <n>[,<m>...] --out <file> [--run-dir <dir>] [--help]
//   node bin/compose-pr-body.js --express --run-id <id> --summary-file <file>
//     --fixes <n>[,<m>...] --out <file>
// A thin wrapper over bin/lib/flow/pr-body.js's composePrEarlyBody, which owns
// the template (_shared/pr-early-run-lifecycle.md Step 3) — or, under the
// valueless --express (#4025), composeExpressBody, the express lane's slimmer
// body (no Phases, no Resume; --target/--next-step not required). It exists because
// the inline `node -e` form it replaces failed twice: a multi-line `node -e`
// writes nothing on Windows Git Bash (bin/node-eval-file.js's header), and the
// spec summary — free record text — went through shell quoting, where a
// backtick or `$(...)` runs. The summary is read from a file instead (written
// with the Write tool, never the shell; one trailing newline is stripped).
// --fixes takes bare record numbers and composes one `Fixes #{n}` line each.
// Exit 0 = body written to --out (stdout: {out, bytes});
// 2 = malformed invocation, an unreadable --summary-file, or --out could not be written.
'use strict';

const fs = require('fs');
const { composePrEarlyBody, composeExpressBody } = require('./lib/flow/pr-body');

const USAGE = 'usage: compose-pr-body.js --run-id <id> --target <ref> --next-step <step> --summary-file <file> --fixes <n>[,<m>...] --out <file> [--run-dir <dir>] [--help]\n'
  + '       compose-pr-body.js --express --run-id <id> --summary-file <file> --fixes <n>[,<m>...] --out <file>\n';

const FLAGS = {
  '--run-id': 'runId', '--target': 'target', '--next-step': 'nextStep', '--summary-file': 'summaryFile',
  '--fixes': 'fixes', '--out': 'out', '--run-dir': 'runDir',
};

// Boolean flags take no value: a token after one is parsed as its own argument.
const BOOL_FLAGS = { '--help': 'help', '-h': 'help', '--express': 'express' };

function parseArgs(argv) {
  const o = { help: false, express: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (Object.hasOwn(BOOL_FLAGS, a)) { o[BOOL_FLAGS[a]] = true; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`compose-pr-body.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  const required = o.express
    ? ['--run-id', '--summary-file', '--fixes', '--out']
    : ['--run-id', '--target', '--next-step', '--summary-file', '--fixes', '--out'];
  for (const flag of required) {
    if (!o[FLAGS[flag]]) return usageError(`${flag} is required`);
  }
  const fixes = o.fixes.split(',').map((s) => s.trim().replace(/^#/, ''));
  if (fixes.some((n) => !/^\d+$/.test(n))) return usageError(`--fixes must be record numbers, got: ${o.fixes}`);

  let summary;
  try { summary = deps.readFile(o.summaryFile).replace(/\r?\n$/, ''); } catch (err) {
    return usageError(`could not read --summary-file: ${o.summaryFile} (${err && err.message})`);
  }

  const fixesLines = fixes.map((n) => `Fixes #${n}`);
  const body = o.express
    ? composeExpressBody({ runId: o.runId, specSummary: summary, fixesLines })
    : composePrEarlyBody({
      runId: o.runId, specSummary: summary, target: o.target, nextStep: o.nextStep,
      fixesLines, runDir: o.runDir,
    });

  try { deps.writeFile(o.out, body); } catch (err) {
    deps.stderr(`compose-pr-body.js: could not write --out file: ${o.out} (${err && err.message})\n`);
    return 2;
  }
  deps.stdout(`${JSON.stringify({ out: o.out, bytes: Buffer.byteLength(body) })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
