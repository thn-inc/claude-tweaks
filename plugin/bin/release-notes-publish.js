#!/usr/bin/env node
// bin/release-notes-publish.js — CLI wrapper for lib/release-notes-publish.js
// (#2582, the pr-first post-publish step). Invoked by
// .github/workflows/mirror-marketplace.yml's `release: published` job,
// inside a checkout of this repo with `gh` authenticated via GH_TOKEN and
// `git` able to push (the workflow's own GITHUB_TOKEN). run(argv, deps) per
// .claude/skills/gh-api-module-pattern's CLI wrapper contract.
//
//   node plugin/bin/release-notes-publish.js [--root <dir>]
//
// Exit codes: 0 applied, partially applied, or no-op; 1 a gh/git call failed.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { run } = require('./lib/release-notes-publish.js');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives.js');

const USAGE = 'usage: release-notes-publish.js [--root <dir>]\nexit 0 applied/no-op; 1 a gh/git call failed';

function parseArgs(argv) {
  const opts = { root: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--root') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return { error: '--root requires a value' };
      opts.root = next;
      i += 1;
      continue;
    }
    return { error: `unknown argument: ${a}` };
  }
  return opts;
}

function defaultDeps(root) {
  const abs = (p) => path.join(root, p);
  return {
    // Remote-contacting calls (release list/view/edit) are bounded by the
    // shared, policy-resolved timeout — git log/add/commit/push are local-or-
    // push-only and stay unbounded, matching release-local.js's own posture.
    gh: (args, input) => execFileSync('gh', args, {
      cwd: root, encoding: 'utf8', timeout: GH_TIMEOUT_MS,
      input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }),
    git: (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    readFile: (p) => { try { return fs.readFileSync(abs(p), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    writeFile: (p, text) => fs.writeFileSync(abs(p), text),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) { process.stderr.write(`${opts.error}\n${USAGE}\n`); return 2; }
  if (opts.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  return run(argv, defaultDeps(root));
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, parseArgs, defaultDeps, USAGE };
