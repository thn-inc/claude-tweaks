#!/usr/bin/env node
'use strict';
// bin/review-lens-workers.js — runs review lens briefs as headless `lens-reviewer` workers
// (#6000) and prints the reply shape `review-coordination.js settle-lens-replies` reads, the
// same shape `plugin/workflows/review-lens-fanout.js` returns. The library is
// lib/driver/lens-workers.js; its header holds the constants, the failure reasons, the
// launcher's log (`worker-dispatches.jsonl` in the run dir) and the auth-failure wording.
//
//   node bin/review-lens-workers.js --run <run-dir> --lenses-file <json> --cwd <reviewed-worktree> --bundle <file> [--help]
//
// --lenses-file holds `{ lenses: [{ lens, brief, model, reviewers }] }`, refused by the
// workflow script's own checks (`inputRefusal`). --cwd is the reviewed worktree, an absolute
// existing directory inside a git work tree: every worker runs there, with --bundle's text
// inlined in its prompt, so nothing is written into the reviewed tree. --run is anchored
// strictly through lib/stage-item/write.js's `resolveTarget` (boundary shape 3's predicate:
// under the main checkout, strictly inside its `.claude-tweaks/pipelines/`) and must not lie
// inside --cwd (spec Plan Review Clarification, Reading A).
//
// Derived per call: `readPaths` is the reviewed worktree's git common dir (`git rev-parse
// --path-format=absolute --git-common-dir`) when it lies outside --cwd (a linked worktree),
// else none; `attrSource` is the reviewed repository's empty tree id (`git hash-object -t tree
// --stdin` on empty input), for the worker's pinned git environment; the settings directory is
// a fresh temporary directory outside --cwd, removed at the end; the policy is
// `resolvePolicy(MODEL_POLICY_KEYS)`. Before any worker starts on a sandbox-probed platform,
// `gitHonoursAttrSource` checks that this git honours GIT_ATTR_SOURCE; when it does not,
// every side that is not excluded fails with reason `platform` and a stderr line says why.
//
// Stdout: the reply JSON on one line. Stderr: one `review-lens-workers: lens {lens} {side}
// failed: {reason}` line per failed side (a worker-written detail, when the envelope carries
// one, follows in parentheses, stripped of control characters and neutralized), and one
// `review-lens-workers: log append failed for lens {lens} {side}: {reason}` line per log
// append that failed, which never changes the reply or the exit code.
//
// Exit codes: 0 the reply was printed; 2 a malformed call (an unknown flag, any of the four
// flags missing or empty, an unreadable or unparseable lens file, an unreadable bundle, an
// `inputRefusal`, a refused --run, a --cwd that is not an absolute existing directory inside a
// git work tree, a --run inside --cwd, a failed git derivation). A refused --run takes exit 2,
// not the sanctioned writers' 3, per the #4027 split: the spec fixes this CLI's codes to 0
// and 2, and no caller branches on a distinct run-dir code. On POSIX a SIGINT or SIGTERM
// forwards SIGTERM to every running worker, waits for their launches to settle (bounded by the
// launcher's kill grace) so each still logs its record, prints nothing on stdout, and exits
// 130 (SIGINT) or 143 (SIGTERM), so a dispatcher never reads an interrupted run as a reply.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { resolveTarget } = require('./lib/stage-item/write');
const { lstatType, canonicalRealpath, isAncestorOrSelf } = require('./lib/path-guard');
const { fsPath } = require('./lib/health-core/io');
const { neutralize } = require('./lib/driver/events');
const { MODEL_POLICY_KEYS, roleLaunch } = require('./lib/driver/launch');
const { SANDBOX_PROBED_PLATFORMS, gitHonoursAttrSource } = require('./lib/driver/roles');
const { launchWorker, defaultRunner, KILL_GRACE_MS } = require('./lib/driver/worker');
const { defaultResolvePolicy } = require('./lib/express/policy');
const { inputRefusal, runLensWorkers, appendWorkerRecord } = require('./lib/driver/lens-workers');

const USAGE = 'Usage: review-lens-workers.js --run <run-dir> --lenses-file <json> --cwd <reviewed-worktree> --bundle <file> [--help]\n' +
  '  exit 0 the reply was printed; 2 a malformed call; 130/143 interrupted (SIGINT/SIGTERM), nothing printed\n';
const FLAGS = { '--run': 'run', '--lenses-file': 'lensesFile', '--cwd': 'cwd', '--bundle': 'bundle' };
const GIT_TIMEOUT_MS = 30000;
// C0 and C1 controls (ESC among them), so no terminal sequence a worker wrote reaches stderr.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || v.trim() === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i += 1;
  }
  for (const [flag, key] of Object.entries(FLAGS)) if (o[key] === undefined) return { error: `${flag} is required` };
  return o;
}

function errText(err) {
  return err && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err);
}

// A worker-written string, safe for one stderr line.
function safeText(text) {
  return neutralize(String(text).replace(CONTROL_CHARS, ' '));
}

function realGit(args, { cwd, env, input = '' }) {
  const res = cp.spawnSync('git', args, { cwd, env, input, encoding: 'utf8', windowsHide: true, timeout: GIT_TIMEOUT_MS });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`git ${args[0] === '-C' ? args[2] : args[0]} exited ${res.status}: ${String(res.stderr || '').trim().split('\n')[0]}`);
  return res.stdout;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  env: process.env,
  platform: process.platform,
  mainRoot: undefined, // resolveTarget derives the main-checkout anchor from cwd
  resolveTarget,
  git: realGit,
  gitHonoursAttrSource,
  resolvePolicy: (keys, opts) => defaultResolvePolicy(keys, opts),
  tmpdir: () => os.tmpdir(),
  runner: defaultRunner,
  launchWorker,
  roleLaunch,
  appendRecord: undefined, // the library's locked append, bound to the injected env
  now: () => Date.now(),
  onSignal: (signal, fn) => {
    process.on(signal, fn);
    return () => process.removeListener(signal, fn);
  },
  killGraceMs: KILL_GRACE_MS,
};

async function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`review-lens-workers: ${message}\n${USAGE}`); return 2; };
  const o = parseArgs(argv);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.error) return usageError(o.error);

  let input;
  let bundleText;
  try {
    const at = (p) => fsPath(deps, p);
    let raw;
    try { raw = fs.readFileSync(at(o.lensesFile), 'utf8'); } catch (e) { return usageError(`--lenses-file unreadable: ${errText(e)}`); }
    try { input = JSON.parse(raw); } catch (e) { return usageError(`--lenses-file is not JSON: ${errText(e)}`); }
    const refusal = inputRefusal(input);
    if (refusal !== null) return usageError(`--lenses-file refused: ${refusal}`);
    try { bundleText = fs.readFileSync(at(o.bundle), 'utf8'); } catch (e) { return usageError(`--bundle unreadable: ${errText(e)}`); }
  } catch (e) {
    return usageError(errText(e));
  }

  if (!path.isAbsolute(o.cwd)) return usageError(`--cwd must be an absolute path: ${o.cwd}`);
  const cwdReal = canonicalRealpath(o.cwd);
  if (cwdReal === null || lstatType(cwdReal).type !== 'directory') return usageError(`--cwd is not an existing directory: ${o.cwd}`);
  let inside;
  try { inside = deps.git(['-C', o.cwd, 'rev-parse', '--is-inside-work-tree'], { cwd: o.cwd, env: deps.env }).trim(); } catch (e) { inside = errText(e); }
  if (inside !== 'true') return usageError(`--cwd is not inside a git work tree: ${o.cwd}`);

  let target;
  try {
    const here = deps.cwd();
    target = deps.resolveTarget({ runDir: path.resolve(here, o.run), cwd: here, mainRoot: deps.mainRoot });
  } catch (e) {
    return usageError(errText(e));
  }
  if (!target.ok) {
    return usageError(target.reason === 'missing'
      ? `--run dir does not exist or is not a directory: ${o.run}`
      : `--run ${o.run} is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/, or outside every checkout) — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }
  const runDir = target.dir;
  if (isAncestorOrSelf(cwdReal, canonicalRealpath(runDir) || runDir)) return usageError(`--run ${o.run} lies inside --cwd ${o.cwd}: the launcher's log would be written into the reviewed worktree`);

  let readPaths;
  let attrSource;
  try {
    const common = deps.git(['-C', o.cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: o.cwd, env: deps.env }).trim();
    const commonReal = canonicalRealpath(common);
    if (!common || commonReal === null) return usageError(`--cwd's git common dir cannot be resolved: ${common}`);
    readPaths = isAncestorOrSelf(cwdReal, commonReal) ? [] : [commonReal];
    attrSource = deps.git(['-C', o.cwd, 'hash-object', '-t', 'tree', '--stdin'], { cwd: o.cwd, env: deps.env, input: '' }).trim();
  } catch (e) {
    return usageError(`git derivation failed in --cwd: ${errText(e)}`);
  }

  const platform = deps.platform;
  let honours;
  if (SANDBOX_PROBED_PLATFORMS.includes(platform)) {
    honours = deps.gitHonoursAttrSource({ cwd: o.cwd, env: deps.env }) === true;
    if (!honours) deps.stderr(`review-lens-workers: the git in ${o.cwd} does not honour GIT_ATTR_SOURCE, which the lens-reviewer's pinned git environment needs; no worker starts\n`);
  }

  let policy;
  try { policy = deps.resolvePolicy(MODEL_POLICY_KEYS, { runDir }); } catch { policy = undefined; }

  let settingsDir;
  try { settingsDir = fs.mkdtempSync(path.join(deps.tmpdir(), 'review-lens-workers-')); } catch (e) { return usageError(`settings directory not created: ${errText(e)}`); }

  const active = new Set();
  let signalled = null;
  let onSignalled;
  const signalSeen = new Promise((resolve) => { onSignalled = resolve; });
  const removers = [];
  try {
    if (platform !== 'win32') {
      for (const sig of ['SIGINT', 'SIGTERM']) {
        removers.push(deps.onSignal(sig, () => {
          if (signalled !== null) return;
          signalled = sig;
          for (const h of active) {
            try { h.kill('SIGTERM'); } catch { /* already gone */ }
          }
          onSignalled(sig);
        }));
      }
    }
    const appendRecord = deps.appendRecord || ((dir, record) => appendWorkerRecord(dir, record, { env: deps.env }));
    const work = runLensWorkers({
      lenses: input.lenses, runDir, cwd: o.cwd, bundleText, readPaths, attrSource, settingsDir, platform, policy, env: deps.env, now: deps.now,
      ...(honours === undefined ? {} : { gitHonoursAttrSource: honours }),
    }, {
      runner: deps.runner, launchWorker: deps.launchWorker, roleLaunch: deps.roleLaunch, appendRecord, active, aborted: () => signalled !== null,
      ...(deps.timers ? { timers: deps.timers } : {}),
    });
    const first = await Promise.race([work.then((result) => ({ result })), signalSeen.then((sig) => ({ sig }))]);
    if (first.sig !== undefined) {
      let timer;
      const grace = new Promise((resolve) => { timer = setTimeout(resolve, deps.killGraceMs); });
      await Promise.race([work.then(() => {}, () => {}), grace]);
      clearTimeout(timer);
      return first.sig === 'SIGINT' ? 130 : 143;
    }
    const { reply, failures, logFailures } = first.result;
    deps.stdout(JSON.stringify(reply) + '\n');
    for (const f of failures) deps.stderr(`review-lens-workers: lens ${f.lens} ${f.side} failed: ${f.reason}${f.detail ? ` (${safeText(f.detail)})` : ''}\n`);
    for (const f of logFailures) deps.stderr(`review-lens-workers: log append failed for lens ${f.lens} ${f.side}: ${safeText(f.reason)}\n`);
    return 0;
  } finally {
    for (const remove of removers) remove();
    try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

module.exports = { run, realDeps, USAGE };

if (require.main === module) run(process.argv.slice(2), realDeps).then((code) => { process.exitCode = code; });
