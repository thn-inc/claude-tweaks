#!/usr/bin/env node
// bin/check-staged-stack.js — #3290's staging-time stacked check for one staged proposal: does
// `--patch` still apply once every staged/ patch that sorts before it has applied, and if not,
// which earlier patch broke it. Checking is pure (bin/lib/staged-patch/stack-check.js); this CLI
// reads the run dir's staged/ and writes nothing there. Its only write is --rederive-out.
//   node bin/check-staged-stack.js --worktree <dir> --patch <run-dir>/staged/<name>.patch [--rederive-out <file>] [--help]
// Exit 0 no conflict involves --patch — one JSON line on stdout, nothing on stderr; 1 a conflict
// involves --patch — the JSON on stdout, one stderr line naming both staged/ paths; 2 a malformed
// invocation (missing/valueless flags, --patch not a .patch directly under a staged/ dir, a
// missing --patch file, --worktree not a directory, --rederive-out resolving inside staged/, --patch
// not among staged/'s walked .patch entries — a dotfile, say), or --patch does not apply at its
// position nor alone — the JSON still prints on that last path; 3 the run dir (the parent of staged/) is missing or
// not anchored under the main checkout (a worktree-local shadow — _shared/pipeline-run-dir.md's
// Anchoring section, [IL-127]); 4 the check could not run — any throw from checkStack (scratch or
// git failure, or an invariant guard), error on stderr.
// --rederive-out (#3290): when --patch conflicts with an earlier patch, its per-file 3-way re-derive
// onto the stacked state is written there and named in the JSON's `rederived`; a refusal or failure
// lands in `rederiveReason` instead and never changes the exit code (a re-derive that cannot run
// keeps exit 1).
'use strict';

const fs = require('fs');
const path = require('path');
const { stagedApplyOrder, checkStack, rederive } = require('./lib/staged-patch/stack-check');
const { resolveTarget } = require('./lib/stage-item/write');
const { isPathContained } = require('./lib/shared-primitives');

const USAGE = 'usage: check-staged-stack.js --worktree <dir> --patch <run-dir>/staged/<name>.patch [--rederive-out <file>] [--help]\n';

const VALUE_FLAGS = {
  '--worktree': 'worktree',
  '--patch': 'patch',
  '--rederive-out': 'rederiveOut',
};

function parseArgs(argv) {
  const o = {
    worktree: null, patch: null, rederiveOut: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a)) {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} requires a value` };
      o[VALUE_FLAGS[a]] = v;
      i++;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  writeFile: (p, data) => fs.writeFileSync(p, data),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`check-staged-stack.js: ${message}\n` + USAGE); return 2; };
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.worktree) return usageError('--worktree <dir> is required');
  if (!o.patch) return usageError('--patch <run-dir>/staged/<name>.patch is required');

  const cwd = deps.cwd();
  const patch = path.resolve(cwd, o.patch);
  const stagedDir = path.dirname(patch);
  if (path.extname(patch) !== '.patch' || path.basename(stagedDir) !== 'staged') {
    return usageError(`--patch must be a .patch file directly under a run dir's staged/: ${o.patch}`);
  }
  if (!isFile(patch)) return usageError(`--patch does not exist as a file: ${o.patch}`);
  const worktree = path.resolve(cwd, o.worktree);
  if (!isDirectory(worktree)) return usageError(`--worktree must be an existing directory: ${o.worktree}`);
  if (o.rederiveOut !== null) {
    // A re-derived file written into staged/ would become a staged proposal of its own.
    if (isPathContained(path.resolve(cwd, o.rederiveOut), stagedDir, { orEqual: true })) {
      return usageError(`--rederive-out must not resolve inside the run's staged/ dir: ${o.rederiveOut}`);
    }
  }

  const runDir = path.dirname(stagedDir);
  let anchored;
  try { anchored = resolveTarget({ runDir, cwd, mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`check-staged-stack.js: ${err && err.message}\n`);
    return 3;
  }
  if (!anchored.ok) {
    if (anchored.reason === 'missing') deps.stderr(`check-staged-stack.js: run dir does not exist: ${runDir}\n`);
    else deps.stderr(`check-staged-stack.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  const targetName = path.basename(patch);
  let result;
  let patches;
  try {
    const names = stagedApplyOrder(fs.readdirSync(stagedDir));
    // A --patch the walk would never visit (a dotfile, or a name the listing spells differently)
    // must not read as a clean check.
    if (!names.includes(targetName)) {
      return usageError(`--patch is not among staged/'s walked .patch entries: ${targetName}`);
    }
    patches = names.map((n) => path.join(stagedDir, n));
    result = checkStack({ worktree, patches, target: patch, git: deps.git });
  } catch (err) {
    deps.stderr(`check-staged-stack.js: could not run the stacked check (${err && err.message})\n`);
    return 4;
  }

  const payload = {
    ok: result.ok,
    order: result.order,
    skipped: result.skipped,
    conflicts: result.conflicts,
    targetConflict: result.targetConflict,
    rederived: null,
    rederiveReason: null,
  };

  if (o.rederiveOut !== null && result.targetConflict !== null && result.targetConflict.patch === targetName) {
    const outPath = path.resolve(cwd, o.rederiveOut);
    let re = null;
    try {
      re = rederive({ worktree, patches, target: patch, git: deps.git });
    } catch (err) {
      payload.rederiveReason = `could not run: ${err && err.message}`;
    }
    if (re !== null && !re.ok) payload.rederiveReason = re.reason;
    if (re !== null && re.ok) {
      try {
        deps.writeFile(outPath, re.patch);
        payload.rederived = outPath;
      } catch (err) {
        payload.rederiveReason = `could not write: ${err && err.message}`;
      }
    }
  }

  deps.stdout(JSON.stringify(payload) + '\n');

  if (result.targetUnapplicable) {
    const skip = result.skipped.find((s) => s.patch === targetName);
    deps.stderr(`check-staged-stack.js: staged/${targetName} does not apply at its position nor alone (${skip.error})\n`);
    return 2;
  }
  if (result.targetConflict !== null) {
    const c = result.targetConflict;
    deps.stderr(`check-staged-stack.js: staged/${c.patch} does not apply on top of staged/${c.conflictsWith} in apply order (${c.error})\n`);
    return 1;
  }
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
