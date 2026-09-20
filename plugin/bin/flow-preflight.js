#!/usr/bin/env node
// plugin/bin/flow-preflight.js — one fact pack for /flow's second-call
// preflight (#1931): adoption case + note, resume freshness, staged
// inventory, Manifesto levers, materialized spec, PR + phase checklist,
// runner stamp, changed files — one process, one JSON. Read-only apart from
// the pack file. Exit 0 whenever the pack was produced (a BLOCKED freshness
// verdict is data the skill acts on, never an exit code), 2 on a malformed
// invocation, 3 when --run (or --json's parent) does not resolve under the
// main checkout ([IL-127]/[IL-150] — the decision is made on the real path).
// An undecided crash — a throw that reaches the top level rather than a
// decided outcome — is exit 1, as in both sibling packs: the 0/2/3
// vocabulary governs outcomes this CLI decided.
'use strict';

const path = require('path');
const { gatherPreflight } = require('./lib/flow/preflight');
const { resolveTarget } = require('./lib/stage-item/write');
const { safeReal, mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: flow-preflight.js --run <dir> --steps <a,b,c> [--json <path>]';

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { run: null, steps: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--run' || flag === '--steps' || flag === '--json') {
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      out[flag.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  if (!out.run) throw new UsageError('--run <dir> is required');
  const steps = (out.steps || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!steps.length) throw new UsageError('--steps <a,b,c> is required (metadata — every field is computed regardless)');
  out.steps = steps;
  return out;
}

async function run(argv, deps = {}) {
  const cwd = deps.cwd || (() => process.cwd());
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(`flow-preflight.js: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  const target = resolveTarget({ runDir: o.run, cwd: cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    stderr(`flow-preflight.js: --run ${o.run} refused (${target.reason === 'missing' ? 'missing' : 'not anchored under the main checkout'}) — nothing written\n`);
    return 3;
  }
  let file = path.join(target.dir, 'preflight.json');
  if (o.json) {
    const requested = path.resolve(cwd(), o.json);
    const parent = safeReal(path.dirname(requested));
    if (!parent || !resolveTarget({ runDir: parent, cwd: cwd(), mainRoot: deps.mainRoot }).ok) {
      stderr(`flow-preflight.js: --json ${o.json} refused (its directory does not resolve under the main checkout) — nothing written\n`);
      return 3;
    }
    file = path.join(parent, path.basename(requested));
  }
  // deps.mainRoot wins when injected (tests); otherwise re-derive the same
  // anchor resolveTarget() just used internally (mainCheckoutRoot(cwd()) —
  // it takes a path and walks up to the main checkout root even from inside
  // a linked worktree) rather than counting path segments off target.dir,
  // which would break the moment the run-dir layout gains or loses a level.
  const mainRoot = deps.mainRoot || mainCheckoutRoot(cwd());
  const pack = await gatherPreflight({ runDir: target.dir, steps: o.steps, cwd: cwd(), mainRoot, deps: deps.packDeps || {} });
  const text = `${JSON.stringify(pack, null, 2)}\n`;
  writeFileAtomic(file, text);
  stdout(text);
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.stderr.write(`flow-preflight.js: ${err && err.stack ? err.stack : err}\n`); process.exitCode = 1; });
}

module.exports = { run, parseArgs };
