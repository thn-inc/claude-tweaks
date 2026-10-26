#!/usr/bin/env node
// plugin/bin/release-tip-check.js — /claude-tweaks:release Step 5's
// reviewed-tip comparison (#4152): one JSON verdict (`merge`/`delta`/`held`/
// `failed`) on stdout that execute.md routes on, replacing the prose state
// machine whose move counting shipped a bug its pins could not see (IL-168).
// A thin wrapper over lib/release-tip/check.js: reads the run's decisions.md
// (a missing file is ''), reads preMajor from release-preflight.json (absent
// or unparseable → false), runs git in --root, resolves release-tip-moves
// through resolve-policy.js, and appends a run-dir-only advance line under
// decisions.md's `## /release` through lib/log-decision/append.js.
// Exit 0 whenever a verdict was printed (or --help printed the usage line) —
// `failed` is a verdict the skill routes on, never an exit code. Exit 2 on a malformed invocation (a missing
// --run/--root/--branch, an unknown flag, a flag with no value). Exit 3 when
// --run does not resolve under the main checkout ([IL-127]) or does not
// exist — nothing is read or written. An undecided crash (a throw reaching
// the top level) is exit 1.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkReviewedTip } = require('./lib/release-tip/check');
const { resolveTarget, appendEntry, formatEntry } = require('./lib/log-decision/append');

const USAGE = 'usage: release-tip-check.js --run <run-dir> --root <checkout> --branch <name> [--as]';
const VALUE_FLAGS = ['--run', '--root', '--branch'];

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { run: null, root: null, branch: null, as: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (VALUE_FLAGS.includes(flag)) {
      const value = argv[i + 1];
      if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      out[flag.slice(2)] = value;
      i += 1;
      continue;
    }
    if (flag === '--as') {
      out.as = true;
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  const missing = VALUE_FLAGS.find((f) => out[f.slice(2)] === null);
  if (missing) throw new UsageError(`${missing} is required`);
  return out;
}

function readPreMajor(runDir) {
  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(path.join(runDir, 'release-preflight.json'), 'utf8'));
  } catch {
    return false;
  }
  const pv = pack && typeof pack === 'object' ? pack.proposedVersion : null;
  return Boolean(pv && pv.ok === true && pv.value && pv.value.preMajor === true);
}

// A spawn that never ran (no git on PATH, a bad cwd) comes back with status null,
// no stderr and the cause in `error`. Carry that cause as stderr so a `failed`
// verdict names it instead of reading "exited null: undefined".
function normalizeSpawn(r) {
  return {
    status: r.status,
    stdout: r.stdout == null ? '' : r.stdout,
    stderr: r.stderr || (r.error ? r.error.message : ''),
  };
}

function run(argv, deps = {}) {
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const now = deps.now || (() => Date.now());
  const cwd = deps.cwd || (() => process.cwd());
  const spawn = deps.spawn || ((cmd, args, opts) => spawnSync(cmd, args, { ...opts, windowsHide: true }));
  if (argv.includes('--help')) {
    stdout(`${USAGE}\n`);
    return 0;
  }
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(`release-tip-check.js: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  const root = path.resolve(cwd(), o.root);
  const target = resolveTarget({ runDir: path.resolve(cwd(), o.run), cwd: root, mainRoot: deps.mainRoot });
  if (!target.ok) {
    stderr(`release-tip-check.js: run dir ${o.run} refused (${target.reason === 'missing' ? 'missing' : 'not anchored under the main checkout'}) — nothing read or written\n`);
    return 3;
  }
  const runDir = path.dirname(target.file);
  let decisionsText = '';
  try {
    decisionsText = fs.readFileSync(target.file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const verdict = checkReviewedTip(
    { decisionsText, branch: o.branch, asGiven: o.as, preMajor: readPreMajor(runDir) },
    {
      git: (args) => normalizeSpawn(spawn('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })),
      resolveBound: () => normalizeSpawn(spawn(process.execPath, [path.join(__dirname, 'resolve-policy.js'), '--run', runDir, 'release-tip-moves'], { cwd: root, encoding: 'utf8', windowsHide: true })),
      appendLog: (text) => appendEntry({
        runDir,
        section: '/release',
        entry: formatEntry({ status: 'AUTO', now: now(), step: 'Step 5', text, reversibility: 'n/a (gate evaluation)' }),
      }),
    },
  );
  stdout(`${JSON.stringify(verdict)}\n`);
  return 0;
}

if (require.main === module) process.exitCode = run(process.argv.slice(2));

module.exports = { run, parseArgs, USAGE };
