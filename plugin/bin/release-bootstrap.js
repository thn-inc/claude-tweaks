#!/usr/bin/env node
// bin/release-bootstrap.js — CLI for /claude-tweaks:init Step 21
// (bootstrap/step-21-release.md, #2253). Thin argv shell over
// bin/lib/init/release-bootstrap.js's bootstrapRelease: one JSON line on
// stdout, exit 0 on every verdict (conflict and skipped are outcomes the
// step reports, not failures), 2 on usage, 1 on an unexpected throw.
//
//   node bin/release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type> --extra-file <path>] [--dry-run]
'use strict';

const fs = require('fs');
const { bootstrapRelease, isValidBranchName, RELEASE_TYPE_VALUES } = require('./lib/init/release-bootstrap');

const USAGE = 'usage: release-bootstrap.js --integration-model <pr-first|local-merge|unresolved> [--root <dir>] [--branch <name>] [--release-type <type> --extra-file <path>] [--dry-run]\n';
const VALUE_FLAGS = new Set(['--root', '--branch', '--integration-model', '--release-type', '--extra-file']);
const VALID_INTEGRATION_MODELS = new Set(['pr-first', 'local-merge', 'unresolved', '']);

function parseArgs(argv) {
  const opts = { root: process.cwd(), branch: 'main', dryRun: false, integrationModel: undefined, releaseType: undefined, extraFile: undefined, help: false };
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

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) { process.stderr.write(`${opts.error}\n${USAGE}`); return 2; }
  if (opts.help) { process.stdout.write(USAGE); return 0; }
  let stat;
  try { stat = fs.statSync(opts.root); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) {
    process.stderr.write(`root is not a directory: ${opts.root}\n${USAGE}`);
    return 2;
  }
  try {
    const result = bootstrapRelease({
      root: opts.root, integrationModel: opts.integrationModel, branch: opts.branch, dryRun: opts.dryRun,
      releaseType: opts.releaseType, extraFile: opts.extraFile,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`release-bootstrap: ${e && e.message ? e.message : String(e)}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, parseArgs };
