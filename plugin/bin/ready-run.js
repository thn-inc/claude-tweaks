#!/usr/bin/env node
// bin/ready-run.js -- the merge gate's ready-run read (#5153): has the CI run
// that `gh pr ready` starts been created, and has it passed? Draft-time skipped
// jobs read as green in the check rollup; this read keeps the gate waiting for
// the post-ready run instead. Run by _shared/pr-first-merge.md Step 2.5 (and
// its bounded watch) and by dispatch close-out; bin/pr-checks.js calls the same
// lib in-process. Reads and rules: lib/pr-checks/ready-run.js.
//
//   node bin/ready-run.js --pr <n> --sha <sha> [--root <dir>] [--help]
//
// --sha is the PR head commit GitHub reported (40 lowercase hex). --root is the
// checkout whose git objects and origin are read (default: the cwd). No run dir
// is read or written, so no anchoring guard applies.
//
// Prints one JSON line: {state, reason?, readySince, readyWorkflows,
// awaitingReadyRun, pending, failing, draftSkipWithoutReadyTrigger, unparsed,
// pr, sha}. state is not-applicable | met | awaiting | red |
// draft-skip-without-ready-trigger | read-failed (STATES); reason is present
// on read-failed only.
//
// Status is data: exit 0 in every state, including read-failed.
// 2 malformed invocation.
'use strict';

const { STATES, defaultDeps, resolveReadyRun, readFailed } = require('./lib/pr-checks/ready-run');

const USAGE = 'usage: ready-run.js --pr <n> --sha <sha> [--root <dir>] [--help]\n'
  + '  reads the PR\'s last ready-for-review event, the workflow files at <sha> and the REST workflow runs for <sha>;\n'
  + '  --sha: the PR head commit (40 lowercase hex); --root: the checkout to read (default: the cwd)\n'
  + '  prints {state, reason?, readySince, readyWorkflows, awaitingReadyRun, pending, failing, draftSkipWithoutReadyTrigger, unparsed, pr, sha};\n'
  + `  state: ${STATES.join(' | ')}\n`
  + '  exit 0 in every state; 2 malformed invocation\n';

const VALUE_FLAGS = new Set(['--pr', '--sha', '--root']);

function parseArgs(argv) {
  const o = { pr: null, sha: null, root: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!VALUE_FLAGS.has(a)) return { error: `unknown argument: ${a}` };
    if (i + 1 >= argv.length) return { error: `${a} needs a value` };
    const v = argv[++i];
    if (a === '--pr') {
      if (!/^[1-9]\d*$/.test(v)) return { error: `--pr needs a positive integer, got: ${JSON.stringify(v)}` };
      o.pr = Number(v);
    } else if (a === '--sha') {
      if (!/^[0-9a-f]{40}$/.test(v)) return { error: `--sha needs a 40-hex lowercase commit sha, got: ${JSON.stringify(v)}` };
      o.sha = v;
    } else {
      if (v === '' || v.startsWith('-')) return { error: `--root needs a directory, got: ${JSON.stringify(v)}` };
      o.root = v;
    }
  }
  if (o.help) return o;
  if (o.pr === null || o.sha === null) return { error: 'both --pr <n> and --sha <sha> are required' };
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  readerDeps: (root) => defaultDeps(root),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`ready-run.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  let envelope;
  try {
    const root = o.root === null ? deps.cwd() : o.root;
    envelope = resolveReadyRun(deps.readerDeps(root), { pr: o.pr, sha: o.sha });
  } catch (e) {
    // the cwd is gone (a removed worktree): nothing was read — read-failed, still exit 0
    envelope = readFailed(`checkout unreadable: ${(e && e.message) || e}`);
  }
  deps.stdout(`${JSON.stringify({ ...envelope, pr: o.pr, sha: o.sha })}\n`);
  return 0;
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
