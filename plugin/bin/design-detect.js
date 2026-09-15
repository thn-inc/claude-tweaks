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
const {
  evaluate,
  readDesignIntegrationFlagFromFile,
  MODE_LAYERS,
} = require('./lib/design-detect');
const { analyzeDiff } = require('./lib/design-detect/surface-lines');

function fail(msg) {
  process.stderr.write(`design-detect: ${msg}\n`);
  process.exitCode = 1;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

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
      default: fail(`unknown argument "${a}"`); return out;
    }
  }
  return out;
}

function repoRoot() {
  try {
    return require('child_process')
      .execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
      .trim();
  } catch {
    return process.cwd();
  }
}

function resolvePlatform(args) {
  if (args.platform) return args.platform;
  if (!args.signalsPath) return null;
  let raw;
  try {
    raw = args.signalsPath === '-' ? readStdin() : fs.readFileSync(args.signalsPath, 'utf8');
    const signals = JSON.parse(raw);
    return (signals && signals.setup && signals.setup.platform) || null;
  } catch {
    return null; // absent/malformed signals degrade to "no signals" — never a hard failure
  }
}

function resolveDesignIntegration(args) {
  if (args.designIntegration) return args.designIntegration;
  if (args.claudeMdPath) {
    try {
      const { readDesignIntegrationFlag } = require('./lib/design-detect');
      return readDesignIntegrationFlag(fs.readFileSync(args.claudeMdPath, 'utf8'));
    } catch {
      return null;
    }
  }
  return readDesignIntegrationFlagFromFile(repoRoot());
}

function main(argv) {
  const args = parseArgs(argv.slice(2));
  if (process.exitCode) return;

  if (args.surfaceLinesPath) {
    if (args.mode) { fail('--surface-lines and --mode are mutually exclusive'); return; }
    let diffText;
    try {
      diffText = args.surfaceLinesPath === '-' ? readStdin() : fs.readFileSync(args.surfaceLinesPath, 'utf8');
    } catch (err) {
      fail(`could not read diff at "${args.surfaceLinesPath}": ${err.message}`);
      return;
    }
    const files = analyzeDiff(diffText);
    const surface = files.some((f) => f.surface);
    process.stdout.write(JSON.stringify({ surface, files }) + '\n');
    return;
  }

  if (!args.mode) { fail('--mode is required'); return; }
  if (!Object.prototype.hasOwnProperty.call(MODE_LAYERS, args.mode)) {
    fail(`unknown mode "${args.mode}" — must be one of: ${Object.keys(MODE_LAYERS).join(', ')}`);
    return;
  }

  const result = evaluate({
    mode: args.mode,
    designIntegrationValue: resolveDesignIntegration(args),
    surface: args.surface,
    platform: resolvePlatform(args),
    files: args.files,
  });

  process.stdout.write(JSON.stringify(result) + '\n');
}

if (require.main === module) main(process.argv);

module.exports = { main };
