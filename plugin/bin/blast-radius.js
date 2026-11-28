#!/usr/bin/env node
// bin/blast-radius.js
//
// The gather step of assess-agent-autonomy's merge-check mode as ONE process
// (#888): merge-base resolution, `git diff --numstat` parsing, policy-config
// resolution (merge-sensitive-paths / auto-merge-max-lines /
// auto-merge-max-files), and classification via bin/lib/issues/blast-radius.js.
// A thin shell over bin/lib/blast-radius-cli.js#computeBlastRadius — argv
// parsing and --run path validation live here; the actual gather logic does
// not. Zero runtime npm deps.
//
// Usage: blast-radius.js (--base <ref> | --integration-branch <branch>) [--run <dir>]
// Success: exit 0, one JSON object {mergeBase, config, summary} on stdout.
// Any failure — unknown flag, missing/unresolvable base, git error — exits 1
// with a stderr message and NO stdout: a resolution failure must never be
// readable as a zero-file blast radius (the silent-approval hazard the
// retired shell choreography in merge-check.md carried).
'use strict';
const fs = require('fs');
const path = require('path');
const { computeBlastRadius, BlastRadiusError, defaultGit } = require('./lib/blast-radius-cli.js');
const { resolveAgainst, cwdOrUndefined } = require('./lib/health-core/io.js');

const USAGE = 'usage: blast-radius.js (--base <ref> | --integration-branch <branch>) [--run <dir>]';

function fail(msg, d) {
  const firstLine = String(msg).split('\n')[0];
  d.stderr(`blast-radius: ${firstLine}\n`);
  return 1;
}

function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const args = argv.slice();
  const opts = {};
  while (args.length) {
    const arg = args.shift();
    const value = args.shift();
    if (value === undefined) return fail(`${arg} requires a value`, d);
    switch (arg) {
      case '--base': opts.base = value; break;
      case '--integration-branch': opts.integrationBranch = value; break;
      case '--run': opts.runDir = value; break;
      default: return fail(`unknown argument: ${arg}\n${USAGE}`, d);
    }
  }
  if (!opts.base && !opts.integrationBranch) return fail(USAGE, d);
  // d.cwd() throws when the working directory was deleted. Left undefined then, git starts in the
  // inherited directory and its own failure is reported, as before the entry contract.
  const cwd = cwdOrUndefined(d);
  const rawRunDir = opts.runDir;
  if (rawRunDir !== undefined) {
    // An empty value is never a directory (fs.statSync('') throws); the join would turn it into the cwd.
    // Neither is a relative value with no readable cwd: fs.statSync of it failed the same way.
    const unresolvable = rawRunDir === '' || (cwd === undefined && !path.parse(rawRunDir).root);
    opts.runDir = unresolvable ? rawRunDir : resolveAgainst(cwd, rawRunDir);
    if (unresolvable || !isDirectory(opts.runDir)) {
      return fail(`--run dir does not exist or is not a directory: ${rawRunDir}`, d);
    }
  }
  let result;
  try {
    result = computeBlastRadius(opts, {
      git: (gitArgs) => defaultGit(gitArgs, { cwd, env: d.env }),
      cwd,
      env: d.env, // the policy read's factory layer (#6006)
    });
  } catch (err) {
    if (err instanceof BlastRadiusError) return fail(err.message, d);
    throw err;
  }
  d.stdout(`${JSON.stringify(result)}\n`);
  return 0;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  get env() { return process.env; },
};

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
