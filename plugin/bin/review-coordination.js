#!/usr/bin/env node
// bin/review-coordination.js — single-plain-command CLI over bin/lib/coordination.js's
// comparison/resolution helpers, for /claude-tweaks:review's Step 3/3.5 procedures
// (step3-lens-dispatch.md, step3-debate-and-refutation.md). Replaces the multi-line
// `node -e` invocations the harness worktree guard refuses (refs #887).
//   node bin/review-coordination.js categorise-reproduction <agentA.json> <agentB.json>
//   node bin/review-coordination.js detect-overlap <findings-by-lens.json>
//   node bin/review-coordination.js corroborate-cross-lens <unconfirmed-by-lens.json>
//   node bin/review-coordination.js resolve-debate <verdictA> <verdictB>
//   node bin/review-coordination.js resolve-refutation <verdict>
// categorise-reproduction/detect-overlap/corroborate-cross-lens print JSON
// (corroborate-cross-lens: #3604); resolve-debate/resolve-refutation print
// the bare resolution string. Exit 0 ok; 2 malformed invocation or unreadable/invalid input.
'use strict';

const fs = require('node:fs');
const {
  categoriseReproduction,
  detectCrossLensOverlap,
  corroborateCrossLens,
  resolveDebate,
  resolveRefutation,
} = require('./lib/coordination');

const USAGE =
  'usage: review-coordination.js categorise-reproduction <agentA.json> <agentB.json>\n' +
  '       review-coordination.js detect-overlap <findings-by-lens.json>\n' +
  '       review-coordination.js corroborate-cross-lens <unconfirmed-by-lens.json>\n' +
  '       review-coordination.js resolve-debate <verdictA> <verdictB>\n' +
  '       review-coordination.js resolve-refutation <verdict>\n';

function readJson(file, stderr) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    stderr(`review-coordination.js: cannot read ${file}: ${err.message}\n`);
    return { failed: true };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (err) {
    stderr(`review-coordination.js: invalid JSON in ${file}: ${err.message}\n`);
    return { failed: true };
  }
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') {
    deps.stdout(USAGE);
    return 0;
  }
  if (command === 'categorise-reproduction') {
    if (rest.length !== 2) {
      deps.stderr('review-coordination.js: categorise-reproduction takes exactly 2 JSON file paths\n' + USAGE);
      return 2;
    }
    const a = readJson(rest[0], deps.stderr);
    if (a.failed) return 2;
    const b = readJson(rest[1], deps.stderr);
    if (b.failed) return 2;
    if (!Array.isArray(a.value) || !Array.isArray(b.value)) {
      deps.stderr('review-coordination.js: both inputs must be JSON arrays of findings\n');
      return 2;
    }
    deps.stdout(JSON.stringify(categoriseReproduction(a.value, b.value)) + '\n');
    return 0;
  }
  if (command === 'detect-overlap') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: detect-overlap takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps.stderr);
    if (input.failed) return 2;
    if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
      deps.stderr('review-coordination.js: input must be a JSON object mapping lens name to findings array\n');
      return 2;
    }
    deps.stdout(JSON.stringify(detectCrossLensOverlap(input.value)) + '\n');
    return 0;
  }
  if (command === 'corroborate-cross-lens') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: corroborate-cross-lens takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps.stderr);
    if (input.failed) return 2;
    if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
      deps.stderr('review-coordination.js: input must be a JSON object mapping lens name to findings array\n');
      return 2;
    }
    if (!Object.values(input.value).every(Array.isArray)) {
      deps.stderr('review-coordination.js: every lens value must be a findings array\n');
      return 2;
    }
    deps.stdout(JSON.stringify(corroborateCrossLens(input.value)) + '\n');
    return 0;
  }
  if (command === 'resolve-debate') {
    if (rest.length !== 2) {
      deps.stderr('review-coordination.js: resolve-debate takes exactly 2 verdicts\n' + USAGE);
      return 2;
    }
    deps.stdout(resolveDebate(rest[0], rest[1]) + '\n');
    return 0;
  }
  if (command === 'resolve-refutation') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: resolve-refutation takes exactly 1 verdict\n' + USAGE);
      return 2;
    }
    deps.stdout(resolveRefutation(rest[0]) + '\n');
    return 0;
  }
  deps.stderr(`review-coordination.js: unknown command: ${command === undefined ? '(none)' : command}\n` + USAGE);
  return 2;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { run };
