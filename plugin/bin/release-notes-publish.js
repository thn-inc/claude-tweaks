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
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run: publish } = require('./lib/release-notes-publish.js');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives.js');
const { locatePolicyFile } = require('./lib/policy-file.js');
const { ghOptions, injectedGhDeps, pickInjected } = require('./lib/repo-resolve.js');

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

// Remote-contacting calls (release list/view/edit) are bounded by the
// shared, policy-resolved timeout — git log/add/commit/push are local-or-
// push-only and stay unbounded, matching release-local.js's own posture.
const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  homeDir: () => os.homedir(),
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  // `{ cwd, env, stderr, homeDir }` is the caller's injected process context (#5386): ghOptions'
  // origin-host probe, gh config-dir lookup and host note read it, not the real process's.
  gh: (args, input, { cwd, env, stderr, homeDir }) => execFileSync('gh', args, ghOptions(args, {
    cwd, env, encoding: 'utf8', timeout: GH_TIMEOUT_MS,
    input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }, injectedGhDeps({ env, stderr, homeDir }))),
  git: (args, { cwd, env }) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
  readFile: (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
  writeFile: (abs, text) => fs.writeFileSync(abs, text),
  // The project policy, read only for `changelog-max-releases` and `integration-branch`: a missing
  // file is "no policy" (null); any other read failure throws, and the trim reports it unreadable.
  readPolicy: (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
};

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`${opts.error}\n${USAGE}\n`); return 2; }
  if (opts.help) { deps.stdout(`${USAGE}\n`); return 0; }
  // deps.cwd() only for a relative or absent --root: an absolute one works from a deleted cwd.
  let root;
  if (!opts.root) root = deps.cwd();
  else root = path.isAbsolute(opts.root) ? path.resolve(opts.root) : path.resolve(deps.cwd(), opts.root);
  return publish(argv, {
    gh: (args, input) => deps.gh(args, input, { cwd: root, ...pickInjected(deps) }),
    git: (args) => deps.git(args, { cwd: root, env: deps.env }),
    readFile: (p) => deps.readFile(path.join(root, p)),
    writeFile: (p, text) => deps.writeFile(path.join(root, p), text),
    readPolicy: () => deps.readPolicy(locatePolicyFile(root).path),
    stdout: deps.stdout,
    stderr: deps.stderr,
  });
}

// The status quo for callers that import main: run against the real world.
function main(argv) { return run(argv, realDeps); }

module.exports = { run, realDeps, main, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
