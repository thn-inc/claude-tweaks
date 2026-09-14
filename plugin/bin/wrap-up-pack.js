#!/usr/bin/env node
// plugin/bin/wrap-up-pack.js — one deterministic fact pack for
// /claude-tweaks:wrap-up's Phases 3-4 (#1930): eight probes, concurrently,
// one JSON. Read-only. Exit 0 whenever the pack was produced (a failing
// probe degrades its own field), 2 on a malformed invocation, 3 when --run
// is not anchored under the main checkout (stage-item's resolveTarget —
// [IL-127]: a worktree-local shadow run dir must never be written), and 3
// likewise when --json would write outside that same anchored target. An
// undecided crash — a throw that reaches the top level rather than a
// decided outcome — is exit 1, as in both sibling packs: the 0/2/3
// vocabulary governs outcomes this CLI decided.
'use strict';

const path = require('path');
const { gatherPack, PROBE_NAMES } = require('./lib/wrap-up/pack');
const { resolveTarget } = require('./lib/stage-item/write');
const { safeReal } = require('./lib/hooks/worktree-detect');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: wrap-up-pack.js --run <dir> [--json <path>] [--only <probe,...>]';

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { run: null, json: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--run' || flag === '--json' || flag === '--only') {
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      if (flag === '--only') {
        const names = value.split(',').map((s) => s.trim()).filter(Boolean);
        // `--only ,` asks for nothing at all. Gathering every probe instead
        // would silently answer a different question than the one asked.
        if (names.length === 0) throw new UsageError(`${flag} names no probes (known: ${PROBE_NAMES.join(', ')})`);
        const bad = names.find((n) => !PROBE_NAMES.includes(n));
        if (bad) throw new UsageError(`unknown probe: ${bad} (known: ${PROBE_NAMES.join(', ')})`);
        out.only = names;
      } else {
        out[flag.slice(2)] = value;
      }
      i += 1;
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  if (!out.run) throw new UsageError('--run <dir> is required');
  return out;
}

async function run(argv, deps = {}) {
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const cwd = deps.cwd || (() => process.cwd());
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(`wrap-up-pack.js: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  const target = resolveTarget({ runDir: o.run, cwd: cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    stderr(`wrap-up-pack.js: --run ${o.run} refused (${target.reason === 'missing' ? 'missing' : 'not anchored under the main checkout'}) — nothing written\n`);
    return 3;
  }
  // --json is the same write, redirected — so it clears the same anchoring bar
  // as --run: its parent directory must itself resolve under the main checkout.
  // The decision is made on the parent's REAL path (symlinks followed) — a
  // lexical "starts with the run dir" test would let a symlinked subdirectory
  // planted inside the run dir carry the write outside the anchor ([IL-150]);
  // an unresolvable parent fails closed. Refused before any probe runs, so an
  // unanchored destination costs nothing and writes nothing ([IL-127]).
  let file = path.join(target.dir, 'wrap-up-pack.json');
  if (o.json) {
    const requested = path.resolve(cwd(), o.json);
    const parent = safeReal(path.dirname(requested));
    if (!parent || !resolveTarget({ runDir: parent, cwd: cwd(), mainRoot: deps.mainRoot }).ok) {
      stderr(`wrap-up-pack.js: --json ${o.json} refused (its directory does not resolve under the main checkout) — nothing written\n`);
      return 3;
    }
    file = path.join(parent, path.basename(requested));
  }
  const pack = await gatherPack({ runDir: target.dir, cwd: cwd(), only: o.only, deps: deps.packDeps || {} });
  const text = `${JSON.stringify(pack, null, 2)}\n`;
  writeFileAtomic(file, text);
  stdout(text);
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`wrap-up-pack.js: ${String((err && err.stack) || err)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run, parseArgs, USAGE };
