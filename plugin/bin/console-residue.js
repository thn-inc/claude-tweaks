#!/usr/bin/env node
// plugin/bin/console-residue.js — show and acknowledge the Review Console items
// an `unattended` run left `pending` / `keep-staged` that no human has reviewed
// (#3370). Read-only toward staged/ and toward resolution; the only write is
// `--ack`, which adds `residueAcknowledgedAt` to a console.json and preserves
// every other field.
//   console-residue.js --run <dir>             print the residue block (nothing when none)
//   console-residue.js --ack --run <dir>       mark that run's consoles reviewed
//   console-residue.js --ack-all               mark every run with unacknowledged residue
// Exit 0 done; 2 malformed (unknown flag, --run without a value, --ack without
// --run, --ack-all with --run or --ack, neither --run nor --ack-all); 3 --run
// missing or not anchored under the main checkout ([IL-127]). A missing --run
// whose basename exists under the main checkout's pipelines/archive/ (a path
// printed before the run archived) uses that copy, with one stderr note. An already
// acknowledged console is never rewritten, and a console.json that does not
// parse is never written.
'use strict';

const fs = require('fs');
const path = require('path');
const { readRunResidue, formatResidueLines } = require('./lib/console/residue');
const { collectUnresolvedConsoles } = require('./lib/hooks/session-residue');
const { resolveTarget } = require('./lib/stage-item/write');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: console-residue.js (--run <dir> | --ack --run <dir> | --ack-all)';

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { run: null, ack: false, ackAll: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--run') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError('--run requires a value');
      out.run = value;
      i += 1;
    } else if (flag === '--ack') out.ack = true;
    else if (flag === '--ack-all') out.ackAll = true;
    else throw new UsageError(`unknown flag: ${flag}`);
  }
  if (out.ackAll && (out.run || out.ack)) throw new UsageError('--ack-all takes neither --run nor --ack');
  if (out.ack && !out.run) throw new UsageError('--ack requires --run <dir>');
  if (!out.ackAll && !out.run) throw new UsageError('--run <dir> or --ack-all is required');
  return out;
}

// Re-read the raw file and parse it at write time: the scan may be stale, and a
// file that no longer parses is never written. Returns whether it wrote.
function acknowledge(consolePath, at, readFile) {
  let parsed;
  try { parsed = JSON.parse(readFile(consolePath)); } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  writeFileAtomic(consolePath, `${JSON.stringify({ ...parsed, residueAcknowledgedAt: at }, null, 2)}\n`);
  return true;
}

function ackConsoles(consoles, at, readFile) {
  return consoles.filter((c) => acknowledge(c.path, at, readFile)).length;
}

function run(argv, deps = {}) {
  const cwd = deps.cwd || (() => process.cwd());
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const now = deps.now || (() => Date.now());
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const pluginRoot = deps.pluginRoot || path.resolve(__dirname, '..');
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(`console-residue.js: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  const at = new Date(now()).toISOString();

  if (o.ackAll) {
    const runs = collectUnresolvedConsoles(cwd(), { limit: Infinity, window: Infinity, pluginRoot });
    let marked = 0;
    for (const r of runs) marked += ackConsoles(r.consoles, at, readFile);
    stdout(`claude-tweaks: marked ${marked} console(s) reviewed across ${runs.length} run(s)\n`);
    return 0;
  }

  let target = resolveTarget({ runDir: o.run, cwd: cwd(), mainRoot: deps.mainRoot });
  if (!target.ok && target.reason === 'missing') {
    // A path printed before the run archived: use its archive/ copy.
    const main = deps.mainRoot || mainCheckoutRoot(cwd());
    const archiveDir = main && path.join(main, '.claude-tweaks', 'pipelines', 'archive', path.basename(o.run));
    const moved = archiveDir ? resolveTarget({ runDir: archiveDir, cwd: cwd(), mainRoot: deps.mainRoot }) : target;
    if (moved.ok) {
      stderr(`console-residue.js: ${o.run} has moved to ${archiveDir} — using the archived copy\n`);
      target = moved;
    }
  }
  if (!target.ok) {
    stderr(`console-residue.js: --run ${o.run} refused (${target.reason === 'missing' ? 'missing' : 'not anchored under the main checkout'}) — nothing written\n`);
    return 3;
  }
  const unacknowledged = readRunResidue(target.dir).consoles.filter((c) => !c.acknowledged);
  if (o.ack) {
    const marked = ackConsoles(unacknowledged, at, readFile);
    stdout(`claude-tweaks: marked ${marked} console(s) reviewed for ${path.basename(target.dir)}\n`);
    return 0;
  }
  const lines = formatResidueLines({ dir: target.dir, consoles: unacknowledged }, { pluginRoot });
  if (lines.length) stdout(`${lines.join('\n')}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { run, parseArgs };
