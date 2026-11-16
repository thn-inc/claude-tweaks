#!/usr/bin/env node
// bin/remote-branch-collision.js — the CLI over lib/worktree/remote-branch-collision.js's
// checkAdoptedBranch (#5589). A run that ADOPTED its worktree skips build's creation-path
// remote-branch check, so this classifies a same-name branch on `origin` for it. Called by
// plugin/skills/build/adopted-branch-collision-check.md.
//
//   node bin/remote-branch-collision.js --branch <name> [--repo <owner/name>] [--records <n[,m...]>] [--help]
//
// Prints one JSON line, `{state, reason, remoteSha}` (state: absent | mine | foreign |
// prior-attempt | unreachable; reason and remoteSha are null when the module gave none), plus
// `pr` when the state is prior-attempt or `card` when a stop card was composed. An empty --repo
// or --records counts as not given (null / []); an empty --branch is passed to the module,
// which answers unreachable / invalid-branch-name.
//
// Exit codes: 0 a JSON line was printed, whatever the state; 1 the module (or a seam under it)
// threw — `claude-tweaks: remote-branch-collision: {message}` on stderr, nothing on stdout;
// 2 a malformed call (no --branch, an unknown flag, a --records item that is not a positive
// integer, a flag with no value, a repeated flag, a positional argument) — a usage line on
// stderr, nothing on stdout. --help prints the usage on stdout and exits 0.
'use strict';

const { execFileSync } = require('child_process');
const { checkAdoptedBranch } = require('./lib/worktree/remote-branch-collision');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS } = require('./lib/shared-primitives');
const {
  parseRepo, ghOptions, pinExplicitRepoHost, injectedGhDeps, pickInjected,
} = require('./lib/repo-resolve');

const USAGE = 'usage: remote-branch-collision.js --branch <name> [--repo <owner/name>] [--records <n[,m...]>] [--help]\n' +
  'exit: 0 a JSON line was printed, whatever the state; 1 the check threw (nothing on stdout); 2 a malformed call\n';

const FLAGS = { '--branch': 'branch', '--repo': 'repo', '--records': 'records' };

function parseArgs(argv) {
  const seen = {};
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { help = true; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const key = FLAGS[a];
    if (Object.hasOwn(seen, key)) return { error: `repeated flag: ${a}` };
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    seen[key] = v;
  }
  if (!help && !Object.hasOwn(seen, 'branch')) return { error: '--branch is required' };
  let records = [];
  if (seen.records) {
    const items = seen.records.split(',');
    if (!items.every((s) => /^[1-9]\d*$/.test(s))) {
      return { error: `--records must be positive integers separated by commas: ${seen.records}` };
    }
    records = items.map(Number);
  }
  return { branch: seen.branch, repo: seen.repo || null, records, help };
}

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  git: (args, { cwd, env }) => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, windowsHide: true, cwd, env,
  }),
  gh: (args, { cwd, env, ghDeps }) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true, cwd, env,
  }, ghDeps)),
  // An explicit --repo's host reaches every gh call below (#4505's seam).
  pinGhHost: (repoSpec, { cwd, env } = {}) => pinExplicitRepoHost(repoSpec, { cwd, env }),
  checkAdoptedBranch,
};

function run(argv, deps = realDeps) {
  const parsedArgs = parseArgs(argv);
  if (parsedArgs.error) {
    deps.stderr(`remote-branch-collision.js: ${parsedArgs.error}\n${USAGE}`);
    return 2;
  }
  if (parsedArgs.help) {
    deps.stdout(USAGE);
    return 0;
  }
  const { branch, repo, records } = parsedArgs;
  try {
    if (repo) {
      // Same parse as link-records.js: pinExplicitRepoHost reads repoSpec.host, so a raw string
      // would always pin github.com. The module still receives the raw string.
      const spec = parseRepo(repo.split('/').length >= 3 ? repo : `github.com/${repo}`);
      if (spec) deps.pinGhHost(spec, { cwd: deps.cwd(), env: deps.env });
    }
    const git = (args) => deps.git(args, { cwd: deps.cwd(), env: deps.env });
    const gh = (args) => deps.gh(args, { cwd: deps.cwd(), env: deps.env, ghDeps: injectedGhDeps(pickInjected(deps)) });
    const out = deps.checkAdoptedBranch({ branch, repo, records, git, gh });
    deps.stdout(`${JSON.stringify(out)}\n`);
    return 0;
  } catch (e) {
    deps.stderr(`claude-tweaks: remote-branch-collision: ${(e && e.message) || e}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
