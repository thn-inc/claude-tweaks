#!/usr/bin/env node
// bin/release-bootstrap.js — CLI for /claude-tweaks:init Step 21
// (bootstrap/step-21-release.md, #2253). Thin argv shell over
// bin/lib/init/release-bootstrap.js's bootstrapRelease: one JSON line on
// stdout, exit 0 on every verdict (conflict and skipped are outcomes the
// step reports, not failures), 2 on usage, 1 on an unexpected throw.
// Exports { run, main, parseArgs, realDeps }: run(argv, deps) returns the exit code and
// reaches the outside world only through deps (stdout, stderr, cwd, env) — the entry
// contract is .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md; main(argv)
// is run(argv, realDeps).
//
//   node bin/release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type> --extra-file <path>] [--dry-run]
'use strict';

const fs = require('fs');
const { fsPath } = require('./lib/health-core/io');
const { bootstrapRelease, containsActionsExpression, RELEASE_TYPE_VALUES } = require('./lib/init/release-bootstrap');
const { isValidBranchName } = require('./lib/branch-name');

const USAGE = 'usage: release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type> --extra-file <path>] [--dry-run]\n';
const VALUE_FLAGS = new Set(['--root', '--branch', '--integration-model', '--release-type', '--extra-file']);
const VALID_INTEGRATION_MODELS = new Set(['pr-first', 'local-merge', 'unresolved', '']);

function parseArgs(argv) {
  const opts = { root: undefined, branch: 'main', dryRun: false, integrationModel: undefined, releaseType: undefined, extraFile: undefined, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return { error: `${a} requires a value` };
      i += 1;
      if (a === '--root') opts.root = next;
      else if (a === '--branch') opts.branch = next;
      else if (a === '--release-type') opts.releaseType = next;
      else if (a === '--extra-file') opts.extraFile = next;
      else opts.integrationModel = next;
      continue;
    }
    return { error: `unknown argument: ${a}` };
  }
  if (!opts.help && opts.integrationModel === undefined) return { error: 'missing required --integration-model' };
  if (!opts.help && !VALID_INTEGRATION_MODELS.has(opts.integrationModel)) {
    return { error: `invalid --integration-model: ${opts.integrationModel}` };
  }
  if (!opts.help && !isValidBranchName(opts.branch)) return { error: `invalid --branch: ${opts.branch}` };
  if (!opts.help && containsActionsExpression(opts.branch)) return { error: `invalid --branch: ${opts.branch} contains an Actions expression` };
  // Pairing before vocabulary — matches resolveReleaseType's order in
  // lib/init/release-bootstrap.js, so an invalid --release-type is rejected
  // the same way here regardless of whether --extra-file is also missing.
  if (!opts.help && (opts.releaseType !== undefined || opts.extraFile !== undefined)) {
    const hasReleaseType = opts.releaseType !== undefined;
    const hasExtraFile = opts.extraFile !== undefined;
    if (hasReleaseType !== hasExtraFile) {
      return { error: '--release-type and --extra-file must be given together' };
    }
  }
  if (!opts.help && opts.releaseType !== undefined && !RELEASE_TYPE_VALUES.has(opts.releaseType)) {
    return { error: `invalid --release-type: ${opts.releaseType}` };
  }
  return opts;
}

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const opts = parseArgs(argv);
  if (opts.error) { d.stderr(`${opts.error}\n${USAGE}`); return 2; }
  if (opts.help) { d.stdout(USAGE); return 0; }
  // The injected cwd is read only when it is needed (no --root, or a relative one), so an absolute
  // --root never touches a deleted working directory; the message keeps the argument as typed. An
  // empty string stays "not a directory" (the join would turn it into the cwd).
  let root;
  if (opts.root === '') root = '';
  else if (opts.root === undefined) root = d.cwd();
  else root = fsPath(d, opts.root);
  let stat;
  try { stat = fs.statSync(root); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) {
    d.stderr(`root is not a directory: ${opts.root === undefined ? root : opts.root}\n${USAGE}`);
    return 2;
  }
  try {
    const result = bootstrapRelease({
      root, integrationModel: opts.integrationModel, branch: opts.branch, dryRun: opts.dryRun,
      releaseType: opts.releaseType, extraFile: opts.extraFile, env: d.env,
    });
    d.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (e) {
    d.stderr(`release-bootstrap: ${e && e.message ? e.message : String(e)}\n`);
    return 1;
  }
}

function main(argv) { return run(argv, realDeps); }

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  get env() { return process.env; },
};

module.exports = { run, main, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
