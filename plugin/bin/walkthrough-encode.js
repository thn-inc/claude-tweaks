#!/usr/bin/env node
// bin/walkthrough-encode.js — thin CLI over bin/lib/walkthrough/encode.js (#2758). Writes the
// encoded GIF via atomic-write.js; nothing else. Logic lives in run(argv, deps); every side
// effect (readFile, readdir, writeFileAtomic, stdout, stderr) is injected so tests never touch
// the filesystem.
//
// Usage: walkthrough-encode.js --frames <dir-or-comma-list> --out <gif path>
//        [--delay-ms <n>] [--last-hold-ms <n>] [--width <px>] [--budget-mb <n=8>]
//        [--steps-json <path> --captions <path> [--caption-title <text>]] [--help]
//
// --steps-json/--captions are optional but must be given together (either both or neither) —
// when both are present, --steps-json is read as a JSON array of story steps, rendered through
// captionList(), and written to --captions (after a successful GIF encode). --caption-title, if
// given, prepends a `# {text}` title line above the rendered list; omitted, the file is just the
// list (backward-compatible with a captions file written before this flag existed).
// Exit codes (Split-1/2, the resolve-blockers.js / fetch-sub-issues.js vocabulary):
//   0 encoded — prints {bytes, frames, width, height, out, downscaled, captions} JSON
//   1 malformed invocation (missing --frames/--out, unknown flag, non-numeric/non-positive
//     numeric flag, only one of --steps-json/--captions given, malformed --steps-json content)
//   2 a frame is unreadable, undecodable, or dimension-mismatched (the underlying error's
//     message is relayed, naming the offending path)
//   3 the encoded GIF is over budget — prints {bytes, budgetBytes, levers, out: null} JSON;
//     levers is always ["fewer steps", "lower --width (current {width}px)"] in that order —
//     {width} is the encoded width whether or not --width was passed; --delay-ms never appears,
//     since frame delay does not change encoded size
'use strict';

const fs = require('fs');
const path = require('path');
const { planFrames, encodeWalkthrough, captionList, FrameMismatchError, BudgetExceededError } = require('./lib/walkthrough/encode');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: walkthrough-encode.js --frames <dir-or-comma-list> --out <gif path> [--delay-ms <n>] [--last-hold-ms <n>] [--width <px>] [--budget-mb <n=8>] [--steps-json <path> --captions <path> [--caption-title <text>]] [--help]\n';

const isPositiveNumber = (n) => Number.isFinite(n) && n > 0;
const isPositiveInteger = (n) => Number.isInteger(n) && n > 0;

// The four numeric flags differ only in their predicate and the noun their error names; consuming
// the value, rejecting a missing one, and parsing it are identical across all four. Returns
// either { value } or an { error } the caller returns verbatim.
function numericFlag(flag, raw, isValid, expected) {
  if (raw === null) return { error: `${flag} requires a value` };
  const n = Number(raw);
  if (!isValid(n)) return { error: `${flag} must be a ${expected}, got "${raw}"` };
  return { value: n };
}

function parseArgs(argv) {
  const o = {
    frames: null, out: null, delayMs: 2000, lastHoldMs: 4000, width: null, budgetMb: 8,
    stepsJson: null, captions: null, captionTitle: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v === '' || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--frames') { o.frames = next(); if (o.frames === null) return { error: '--frames requires a value' }; }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else if (a === '--delay-ms') { const r = numericFlag(a, next(), isPositiveNumber, 'positive number'); if (r.error) return r; o.delayMs = r.value; }
    else if (a === '--last-hold-ms') { const r = numericFlag(a, next(), isPositiveNumber, 'positive number'); if (r.error) return r; o.lastHoldMs = r.value; }
    else if (a === '--width') { const r = numericFlag(a, next(), isPositiveInteger, 'positive integer'); if (r.error) return r; o.width = r.value; }
    else if (a === '--budget-mb') { const r = numericFlag(a, next(), isPositiveNumber, 'positive number'); if (r.error) return r; o.budgetMb = r.value; }
    else if (a === '--steps-json') { o.stepsJson = next(); if (o.stepsJson === null) return { error: '--steps-json requires a value' }; }
    else if (a === '--captions') { o.captions = next(); if (o.captions === null) return { error: '--captions requires a value' }; }
    else if (a === '--caption-title') { o.captionTitle = next(); if (o.captionTitle === null) return { error: '--caption-title requires a value' }; }
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

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`walkthrough-encode.js: ${message}\n${USAGE}`); return 1; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.frames) return usageError('--frames is required');
  if (!o.out) return usageError('--out is required');
  if ((o.stepsJson && !o.captions) || (o.captions && !o.stepsJson)) {
    return usageError('--steps-json and --captions must be given together');
  }

  let framePaths;
  try {
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

  // Per-frame delays reuse encode.js's own planFrames rather than re-deriving the same rule here:
  // the CLI never receives a step count directly, but the resolved frame-path list's length IS
  // that count (one screenshot per step, per the skill's Step 3), so planFrames(framePaths.length)
  // is the correct call, not a coincidence.
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

  if (o.stepsJson && o.captions) {
    let steps;
    try {
      steps = JSON.parse(deps.readFile(o.stepsJson).toString());
    } catch (err) {
      deps.stderr(`walkthrough-encode.js: could not parse --steps-json ${o.stepsJson}: ${err && err.message}\n`);
      return 1;
    }
    if (!Array.isArray(steps)) {
      deps.stderr(`walkthrough-encode.js: --steps-json ${o.stepsJson} must contain a JSON array of step objects, got ${typeof steps}\n`);
      return 1;
    }
    const rendered = (o.captionTitle ? `# ${o.captionTitle}\n\n` : '') + captionList(steps);
    deps.writeFileAtomic(o.captions, rendered);
  }

  deps.writeFileAtomic(o.out, result.buffer);
  deps.stdout(JSON.stringify({ out: o.out, bytes: result.bytes, frames: framePaths.length, width: result.width, height: result.height, downscaled: result.downscaled, captions: o.captions || null }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
