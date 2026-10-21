#!/usr/bin/env node
// plugin/bin/console-residue.js — show and acknowledge the Review Console items
// an `unattended` run left `pending` / `keep-staged` that no human has reviewed
// (#3370). Read-only toward staged/ and toward resolution; the only write is
// `--ack`, which adds `residueAcknowledgedAt` to a console.json and preserves
// every other field.
//   console-residue.js --run <dir>             print the residue block (nothing when none)
//   console-residue.js --run <dir> --require-verify <base>
//                                              also name the wrap-up-engine.js verify command
//                                              for each checked dir with no valid verify.json (#3783)
//   console-residue.js --ack --run <dir>       mark that run's consoles reviewed
//   console-residue.js --ack-all               mark every run with unacknowledged residue
// Exit 0 done; 2 malformed (unknown flag, --run without a value, --require-verify
// without a value or with an empty one, --require-verify with --ack or --ack-all,
// --ack without --run, --ack-all with --run or --ack, neither --run nor
// --ack-all); 3 --run
// missing or not anchored under the main checkout ([IL-127]), or a console.json
// that could not be written (the remaining consoles are still tried, and the
// summary line says how many failed). A missing --run whose basename exists
// under the main checkout's pipelines/archive/ (a path printed before the run
// archived) uses that copy, with one stderr note. An already acknowledged
// console is never rewritten, and a console.json that does not parse is never
// written.
'use strict';

const fs = require('fs');
const path = require('path');
const { readRunResidue, formatResidueLines } = require('./lib/console/residue');
const { collectUnresolvedConsoles } = require('./lib/hooks/session-residue');
const { resolveTarget } = require('./lib/stage-item/write');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { writeFileAtomic } = require('./lib/atomic-write');
const { readVerifyResults } = require('./lib/wrap-up/verify-results');

const USAGE = 'usage: console-residue.js (--run <dir> [--require-verify <base>] | --ack --run <dir> | --ack-all)';

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { run: null, ack: false, ackAll: false, requireVerify: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--run') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError('--run requires a value');
      out.run = value;
      i += 1;
    } else if (flag === '--require-verify') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) throw new UsageError('--require-verify requires a value');
      out.requireVerify = value;
      i += 1;
    } else if (flag === '--ack') out.ack = true;
    else if (flag === '--ack-all') out.ackAll = true;
    else throw new UsageError(`unknown flag: ${flag}`);
  }
  if (out.ackAll && (out.run || out.ack)) throw new UsageError('--ack-all takes neither --run nor --ack');
  if (out.requireVerify && (out.ackAll || out.ack)) throw new UsageError('--require-verify takes neither --ack nor --ack-all');
  if (out.ack && !out.run) throw new UsageError('--ack requires --run <dir>');
  if (!out.ackAll && !out.run) throw new UsageError('--run <dir> or --ack-all is required');
  return out;
}

// Re-read the raw file and parse it at write time: the scan may be stale, so a
// file that no longer parses is never written and one acknowledged since the
// scan is never rewritten. Returns the outcome: 'wrote', 'already',
// 'unparseable', or 'failed' (the write threw — unwritable, or the run dir
// moved under a concurrent archival).
function acknowledge(consolePath, at, { readFile, writeFile }) {
  let parsed;
  try { parsed = JSON.parse(readFile(consolePath)); } catch { return { status: 'unparseable' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'unparseable' };
  if (typeof parsed.residueAcknowledgedAt === 'string') return { status: 'already' };
  try {
    writeFile(consolePath, `${JSON.stringify({ ...parsed, residueAcknowledgedAt: at }, null, 2)}\n`);
  } catch (err) {
    return { status: 'failed', message: err && err.message ? err.message : String(err) };
  }
  return { status: 'wrote' };
}

function ackConsoles(consoles, at, io, stderr) {
  const tally = { marked: 0, skipped: 0, failed: 0 };
  for (const c of consoles) {
    const r = acknowledge(c.path, at, io);
    if (r.status === 'wrote') tally.marked += 1;
    else if (r.status === 'failed') {
      tally.failed += 1;
      stderr(`console-residue.js: could not write ${c.path}: ${r.message}\n`);
    } else tally.skipped += 1;
  }
  return tally;
}

// Trailing note for a summary line: skips and failures are never silent.
function tallyNote({ skipped, failed }) {
  return `${skipped ? ` (${skipped} skipped — already acknowledged or no longer valid JSON)` : ''}${failed ? ` (${failed} could not be written)` : ''}`;
}

// #3783: the dirs whose verify.json is required — each spec-*/ subdirectory of a
// multi-spec parent when any exist, else the run dir itself. Two lines per dir
// with no readable verify.json (absent and unparseable both count as missing):
// what is wrong, then the paste-ready command that fixes it.
function missingVerifyLines(runDir, base, pluginRoot) {
  let specs = [];
  try {
    specs = fs.readdirSync(runDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('spec-')).map((e) => e.name).sort();
  } catch { /* unreadable dir — treat as a single-spec run */ }
  const runLabel = path.basename(runDir);
  const checked = specs.length
    ? specs.map((s) => ({ dir: path.join(runDir, s), label: `${runLabel}/${s}` }))
    : [{ dir: runDir, label: runLabel }];
  const lines = [];
  for (const c of checked) {
    if (readVerifyResults(c.dir)) continue;
    lines.push(`- ${c.label}: verify.json missing — wrap-up's Verify execution never ran, or its write failed`);
    lines.push(`  run: node "${pluginRoot}/bin/wrap-up-engine.js" verify --run-dir "${c.dir}" --base ${base}`);
  }
  return lines;
}

function run(argv, deps = {}) {
  const cwd = deps.cwd || (() => process.cwd());
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const now = deps.now || (() => Date.now());
  const io = {
    readFile: deps.readFile || ((p) => fs.readFileSync(p, 'utf8')),
    writeFile: deps.writeFile || writeFileAtomic,
  };
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
    const total = ackConsoles(runs.flatMap((r) => r.consoles), at, io, stderr);
    stdout(`claude-tweaks: marked ${total.marked} console(s) reviewed across ${runs.length} run(s)${tallyNote(total)}\n`);
    return total.failed > 0 ? 3 : 0;
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
  const found = readRunResidue(target.dir);
  const unacknowledged = found.consoles.filter((c) => !c.acknowledged);
  if (o.ack) {
    const tally = ackConsoles(unacknowledged, at, io, stderr);
    stdout(`claude-tweaks: marked ${tally.marked} console(s) reviewed for ${path.basename(target.dir)}${tallyNote(tally)}\n`);
    return tally.failed > 0 ? 3 : 0;
  }
  const missingOnly = found.missingOnly.filter((c) => !c.acknowledged);
  const lines = formatResidueLines({ dir: target.dir, consoles: unacknowledged, missingOnly }, { pluginRoot });
  // A console.json that exists but is not valid JSON hides its items: say so
  // here, where the Pipeline Summary renders stdout, instead of printing nothing.
  if (found.unreadable.length) {
    if (!lines.length) lines.push(`- ${path.basename(target.dir)}: console.json could not be checked for unreviewed items`);
    for (const p of found.unreadable) lines.push(`  ! ${path.relative(target.dir, p)} is not valid JSON — any pending items in it cannot be listed`);
  }
  if (o.requireVerify) lines.push(...missingVerifyLines(target.dir, o.requireVerify, pluginRoot));
  if (lines.length) stdout(`${lines.join('\n')}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { run, parseArgs };
