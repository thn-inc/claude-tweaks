#!/usr/bin/env node
// bin/design-detect.js
//
// Deterministic re-implementation of design-wrapper's Layers 1-3 + track
// resolution (skills/design-wrapper/SKILL.md's "Universal preconditions"
// Step 1, and frontend-detection.md's Layer 3 sniff). All decision logic
// lives in bin/lib/design-detect — this file is argument parsing plus two
// file reads, the same shell-vs-logic split resolve-policy.js follows.
//
// Usage: design-detect.js --mode <mode> [--surface <value>]
//          [--files <f1,f2,...>] [--signals <path|->]
//          [--design-integration <value>] [--claude-md <path>]
//          [--platform <web|ios|android|adaptive>]
//
//        design-detect.js --surface-lines <diff-file-path|->
//
// Output (--mode form): one JSON object on stdout — { decision:
// "proceed"|"skip", track?, reason?, surface_track_override? }. Never
// throws for an ordinary skip; exits 1 with a stderr message only for a
// malformed invocation (unknown --mode, no --mode at all).
//
// Output (--surface-lines form): { surface: <bool>, files: [{file, kind,
// surface, changedLines}, ...] } — the design-surface gate
// (skills/design-wrapper/modes/review.md Step 3.8 (b), #1863): whether any
// changed line in a unified diff (`git diff -U0`) touched JSX/TSX markup, a
// className/style attribute, a rendered text node, or any line in a
// style/template file. `--surface-lines` and `--mode` are mutually
// exclusive invocation forms — pass one or the other, never both.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  evaluate,
  readDesignIntegrationFlagFromFile,
  MODE_LAYERS,
} = require('./lib/design-detect');
const { analyzeDiff } = require('./lib/design-detect/surface-lines');
const { DEFAULT_IO, resolveAgainst } = require('./lib/health-core/io');

function parseArgs(argv) {
  const out = { mode: null, surface: null, files: [], signalsPath: null, designIntegration: null, claudeMdPath: null, platform: null, surfaceLinesPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--mode': out.mode = next(); break;
      case '--surface': out.surface = next(); break;
      case '--files': out.files = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--signals': out.signalsPath = next(); break;
      case '--design-integration': out.designIntegration = next(); break;
      case '--claude-md': out.claudeMdPath = next(); break;
      case '--platform': out.platform = next(); break;
      case '--surface-lines': out.surfaceLinesPath = next(); break;
      default: return { ok: false, message: `unknown argument "${a}"` };
    }
  }
  return { ok: true, args: out };
}

// An operand carrying a root never reads the cwd: a deleted working directory makes
// process.cwd() throw, and the unconverted CLI never called it for an absolute path.
// A relative operand whose cwd cannot be read is handed to fs as written, as the
// unconverted CLI did, so the read fails with fs's own message naming the caller's spelling.
function resolveOperand(deps, p) {
  if (path.parse(p).root) return p;
  try {
    return resolveAgainst(deps.cwd(), p);
  } catch {
    return p;
  }
}

function repoRoot(deps) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: deps.cwd(),
      env: deps.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return deps.cwd();
  }
}

function resolvePlatform(args, deps) {
  if (args.platform) return args.platform;
  if (!args.signalsPath) return null;
  let raw;
  try {
    raw = args.signalsPath === '-' ? deps.stdin() : fs.readFileSync(resolveOperand(deps, args.signalsPath), 'utf8');
    const signals = JSON.parse(raw);
    return (signals && signals.setup && signals.setup.platform) || null;
  } catch {
    return null; // absent/malformed signals degrade to "no signals" — never a hard failure
  }
}

function resolveDesignIntegration(args, deps) {
  if (args.designIntegration) return args.designIntegration;
  if (args.claudeMdPath) {
    try {
      const { readDesignIntegrationFlag } = require('./lib/design-detect');
      return readDesignIntegrationFlag(fs.readFileSync(resolveOperand(deps, args.claudeMdPath), 'utf8'));
    } catch {
      return null;
    }
  }
  return readDesignIntegrationFlagFromFile(repoRoot(deps));
}

// run(argv, deps) -> exit code. argv is already sliced past the node/script pair.
function run(argv, deps = realDeps) {
  const fail = (msg) => {
    deps.stderr(`design-detect: ${msg}\n`);
    return 1;
  };
  const parsed = parseArgs(argv);
  if (!parsed.ok) return fail(parsed.message);
  const args = parsed.args;

  if (args.surfaceLinesPath) {
    if (args.mode) return fail('--surface-lines and --mode are mutually exclusive');
    let diffText;
    let resolved = null;
    try {
      resolved = args.surfaceLinesPath === '-' ? null : resolveOperand(deps, args.surfaceLinesPath);
      diffText = resolved === null ? deps.stdin() : fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      // Node's message names the opened path; print the caller's own spelling instead of the joined one.
      // On win32 the message carries the path normalized (`sub/x` joined as `C:\cwd\sub/x` is
      // reported as `C:\cwd\sub\x`), so a rooted join that is absent verbatim is matched normalized.
      let message = err.message;
      if (resolved !== null) {
        const from = message.includes(resolved) || !path.parse(resolved).root ? resolved : path.normalize(resolved);
        message = message.split(from).join(args.surfaceLinesPath);
      }
      return fail(`could not read diff at "${args.surfaceLinesPath}": ${message}`);
    }
    const files = analyzeDiff(diffText);
    const surface = files.some((f) => f.surface);
    deps.stdout(JSON.stringify({ surface, files }) + '\n');
    return 0;
  }

  if (!args.mode) return fail('--mode is required');
  if (!Object.prototype.hasOwnProperty.call(MODE_LAYERS, args.mode)) {
    return fail(`unknown mode "${args.mode}" — must be one of: ${Object.keys(MODE_LAYERS).join(', ')}`);
  }

  const result = evaluate({
    mode: args.mode,
    designIntegrationValue: resolveDesignIntegration(args, deps),
    surface: args.surface,
    platform: resolvePlatform(args, deps),
    files: args.files,
  });

  deps.stdout(JSON.stringify(result) + '\n');
  return 0;
}

const realDeps = {
  ...DEFAULT_IO,
  env: process.env,
  stdin: () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } },
};

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
