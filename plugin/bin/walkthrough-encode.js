#!/usr/bin/env node
// bin/walkthrough-encode.js — thin CLI over bin/lib/walkthrough/encode.js (#2758). Writes the
// encoded GIF via atomic-write.js; nothing else. Logic lives in run(argv, deps); every side
// effect (readFile, readdir, writeFileAtomic, stdout, stderr) is injected so tests never touch
// the filesystem.
//
// Usage: walkthrough-encode.js --frames <dir-or-comma-list> --out <gif path>
//        [--delay-ms <n>] [--last-hold-ms <n>] [--width <px>] [--budget-mb <n=8>] [--help]
// Exit codes (Split-1/2, the resolve-blockers.js / fetch-sub-issues.js vocabulary):
//   0 encoded — prints {bytes, frames, width, height, out, downscaled} JSON
//   1 malformed invocation (missing --frames/--out, unknown flag)
//   2 a frame is unreadable, undecodable, or dimension-mismatched (the underlying error's
//     message is relayed, naming the offending path)
//   3 the encoded GIF is over budget — prints {bytes, budgetBytes, levers, out: null} JSON;
//     levers is always ["fewer steps", "lower --width (current {width}px)"] in that order —
//     {width} is the encoded width whether or not --width was passed; --delay-ms never appears,
//     since frame delay does not change encoded size
'use strict';

const fs = require('fs');
const path = require('path');
const { planFrames, encodeWalkthrough, FrameMismatchError, BudgetExceededError } = require('./lib/walkthrough/encode');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: walkthrough-encode.js --frames <dir-or-comma-list> --out <gif path> [--delay-ms <n>] [--last-hold-ms <n>] [--width <px>] [--budget-mb <n=8>] [--help]\n';

function parseArgs(argv) {
  const o = { frames: null, out: null, delayMs: 2000, lastHoldMs: 4000, width: null, budgetMb: 8, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v === '' || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--frames') { o.frames = next(); if (o.frames === null) return { error: '--frames requires a value' }; }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else if (a === '--delay-ms') { const v = next(); if (v === null) return { error: '--delay-ms requires a value' }; o.delayMs = Number(v); }
    else if (a === '--last-hold-ms') { const v = next(); if (v === null) return { error: '--last-hold-ms requires a value' }; o.lastHoldMs = Number(v); }
    else if (a === '--width') { const v = next(); if (v === null) return { error: '--width requires a value' }; o.width = Number(v); }
    else if (a === '--budget-mb') { const v = next(); if (v === null) return { error: '--budget-mb requires a value' }; o.budgetMb = Number(v); }
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p),
  readdir: (p) => fs.readdirSync(p),
  writeFileAtomic: (p, content) => writeFileAtomic(p, content),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// Per-frame delays reuse encode.js's own planFrames rather than re-deriving the same rule here:
// the CLI never receives a step count directly, but the resolved frame-path list's length IS
// that count (one screenshot per step, per the skill's Step 3), so planFrames(framePaths.length)
// is the correct call, not a coincidence.

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`walkthrough-encode.js: ${message}\n${USAGE}`); return 1; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.frames) return usageError('--frames is required');
  if (!o.out) return usageError('--out is required');

  let framePaths;
  try {
    const stat = fs.existsSync && deps.readdir ? null : null; // no-op placeholder for clarity
    if (o.frames.includes(',')) {
      framePaths = o.frames.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      // Single value: try as a directory first (readdir), fall back to a single file path.
      let entries = null;
      try { entries = deps.readdir(o.frames); } catch { entries = null; }
      if (entries) {
        // path.posix.join, not path.join: these are opaque strings fed back into deps.readFile
        // (a real fs.readFileSync accepts forward slashes fine on Windows too), and a
        // platform-native separator here would make directory-expansion output depend on the
        // host OS for no benefit.
        framePaths = entries.filter((f) => f.endsWith('.png')).sort().map((f) => path.posix.join(o.frames, f));
      } else {
        framePaths = [o.frames];
      }
    }
  } catch (err) {
    deps.stderr(`walkthrough-encode.js: could not resolve --frames: ${err && err.message}\n`);
    return 2;
  }

  const delays = planFrames(framePaths.length, { delayMs: o.delayMs, lastHoldMs: o.lastHoldMs }).map((f) => f.delayCs);
  const budgetBytes = Math.round(o.budgetMb * 1024 * 1024);

  let result;
  try {
    result = encodeWalkthrough({ framePaths, delays, width: o.width, budgetBytes }, { readFile: deps.readFile });
  } catch (err) {
    if (err instanceof FrameMismatchError) { deps.stderr(`walkthrough-encode.js: ${err.message}\n`); return 2; }
    if (err instanceof BudgetExceededError) {
      deps.stdout(JSON.stringify({ bytes: err.bytes, budgetBytes: err.budgetBytes, levers: err.levers, out: null }) + '\n');
      return 3;
    }
    deps.stderr(`walkthrough-encode.js: could not read or decode a frame: ${err && err.message}\n`);
    return 2;
  }

  deps.writeFileAtomic(o.out, result.buffer);
  deps.stdout(JSON.stringify({ out: o.out, bytes: result.bytes, frames: framePaths.length, width: result.width, height: result.height, downscaled: result.downscaled }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
