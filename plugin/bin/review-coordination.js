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
//   node bin/review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>] [--run <dir>]
//   node bin/review-coordination.js write-findings <run-dir> <findings.json>
//   node bin/review-coordination.js check-coverage <run-dir>
// categorise-reproduction/detect-overlap/corroborate-cross-lens print JSON
// (corroborate-cross-lens: #3604); resolve-debate/resolve-refutation print
// the bare resolution string. resolve-tiebreak/write-findings/check-coverage
// (#3945) print one JSON line: the resolver result (a could-not-parse reply is
// parse:"could-not-parse" with exit 0 — the signal is in the JSON), {path, count}
// of the review-findings.json written through the run-dir anchoring guard, and
// the tiebreak-coverage result over the run dir and its spec-*/ subdirs, the
// same set the archive gate checks (missing ids, exit 0 either way — archival,
// not this exit code, refuses). --root (default cwd) is where resolve-tiebreak
// reads the evidence file from; a finding path whose real path (symlinks
// followed, `..` normalized) leaves --root is never read, so its evidence is
// unverified. check-coverage goes through the same run-dir anchoring guard as
// write-findings: a worktree-local shadow run dir holds no artifact, and
// reading it would report a confident "nothing missing" [IL-127].
// resolve-tiebreak --run (#4026) appends the verdict line it prints — logStatus,
// step logStep, text logText, Reversibility: high — under decisions.md's
// `## /review` (the line step3-tiebreak.md's step 3 told the caller to log) and
// adds `logged` to the JSON: false, with one stderr line, when the append threw,
// which never changes the exit code. Without --run the output is unchanged.
// Exit 0 ok; 2 malformed invocation (a blank resolve-tiebreak --run included) or unreadable/invalid input (check-coverage:
// also a run dir that does not exist); 3 run dir unanchored (write-findings,
// check-coverage, resolve-tiebreak --run), or missing (write-findings,
// resolve-tiebreak --run).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  categoriseReproduction,
  detectCrossLensOverlap,
  corroborateCrossLens,
  resolveDebate,
  resolveRefutation,
} = require('./lib/coordination');
const {
  resolveTiebreak, buildFindingsArtifact, checkRunTiebreakCoverage, FINDINGS_ARTIFACT,
} = require('./lib/tiebreak');
const { resolveWithin } = require('./lib/path-guard');
const { resolveTarget } = require('./lib/stage-item/write');
const { writeArtifact } = require('./lib/run-artifact/write');
const { formatEntry, appendEntry } = require('./lib/log-decision/append');

const USAGE =
  'usage: review-coordination.js categorise-reproduction <agentA.json> <agentB.json>\n' +
  '       review-coordination.js detect-overlap <findings-by-lens.json>\n' +
  '       review-coordination.js corroborate-cross-lens <unconfirmed-by-lens.json>\n' +
  '       review-coordination.js resolve-debate <verdictA> <verdictB>\n' +
  '       review-coordination.js resolve-refutation <verdict>\n' +
  '       review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>] [--run <dir>]\n' +
  '       review-coordination.js write-findings <run-dir> <findings.json>\n' +
  '       review-coordination.js check-coverage <run-dir>\n';

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

// Anchors a run dir under the main checkout. Returns { dir } on success, else
// { exitCode } after writing the reason to stderr (a missing dir exits
// `missingExitCode`; an unanchored or unresolvable one exits 3).
function anchorRunDir(runDir, deps, missingExitCode) {
  let target;
  try {
    target = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  } catch (err) {
    deps.stderr(`review-coordination.js: ${err && err.message}\n`);
    return { exitCode: 3 };
  }
  if (target.ok) return { dir: target.dir };
  if (target.reason === 'missing') {
    deps.stderr(`review-coordination.js: run dir does not exist: ${runDir}\n`);
    return { exitCode: missingExitCode };
  }
  deps.stderr(`review-coordination.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
  return { exitCode: 3 };
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  now: () => new Date(),
  appendDecision: appendEntry,
};

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
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
    // No skill prose invokes it since #3947, where refutation step 5 moved to resolve-tiebreak.
    // Removal condition: remove it with `resolveRefutation` and its tests once #3950 decommissions
    // the pre-tiebreak paths.
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: resolve-refutation takes exactly 1 verdict\n' + USAGE);
      return 2;
    }
    deps.stdout(resolveRefutation(rest[0]) + '\n');
    return 0;
  }
  if (command === 'resolve-tiebreak') {
    let root = deps.cwd();
    let runDir = null;
    const positional = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--root' || rest[i] === '--run') {
        // A blank --run (an unset $PIPELINE_RUN_DIR) is a missing one, never a run dir
        // resolved against cwd -- resolve-policy.js's rule (#1138).
        if (i + 1 >= rest.length || (rest[i] === '--run' && rest[i + 1].trim() === '')) {
          deps.stderr(`review-coordination.js: ${rest[i]} needs a directory\n` + USAGE);
          return 2;
        }
        if (rest[i] === '--root') root = rest[++i];
        else runDir = rest[++i];
      } else positional.push(rest[i]);
    }
    if (positional.length !== 2) {
      deps.stderr('review-coordination.js: resolve-tiebreak takes <finding.json> <reply-file> [--root <dir>] [--run <dir>]\n' + USAGE);
      return 2;
    }
    const input = readJson(positional[0], deps.stderr);
    if (input.failed) return 2;
    try {
      buildFindingsArtifact([input.value]);
    } catch (err) {
      deps.stderr(`review-coordination.js: malformed finding in ${positional[0]}: ${err.message}\n`);
      return 2;
    }
    let reply;
    try {
      reply = fs.readFileSync(positional[1], 'utf8');
    } catch (err) {
      deps.stderr(`review-coordination.js: cannot read ${positional[1]}: ${err.message}\n`);
      return 2;
    }
    let anchored = null;
    if (runDir !== null) {
      anchored = anchorRunDir(runDir, deps, 3);
      if (anchored.exitCode !== undefined) return anchored.exitCode;
    }
    // Throws (→ evidence-unverified) for a path that resolves outside --root.
    const readFile = (p) => {
      const real = resolveWithin(path.resolve(root, p), root);
      if (real === null) throw new Error(`evidence path is outside --root or does not resolve: ${p}`);
      return fs.readFileSync(real, 'utf8');
    };
    const now = deps.now();
    const result = resolveTiebreak(input.value, reply, { readFile, now });
    if (anchored) {
      try {
        const entry = formatEntry({ status: result.logStatus, now, step: result.logStep, text: result.logText, reversibility: 'high' });
        deps.appendDecision({ runDir: anchored.dir, section: '/review', entry });
        result.logged = true;
      } catch (err) {
        result.logged = false;
        deps.stderr(`review-coordination.js: could not append the decisions.md entry (- ${result.logLine}): ${(err && err.message) || err}\n`);
      }
    }
    deps.stdout(JSON.stringify(result) + '\n');
    return 0;
  }
  if (command === 'write-findings') {
    if (rest.length !== 2) {
      deps.stderr('review-coordination.js: write-findings takes <run-dir> <findings.json>\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[1], deps.stderr);
    if (input.failed) return 2;
    let artifact;
    try {
      artifact = buildFindingsArtifact(input.value);
    } catch (err) {
      deps.stderr(`review-coordination.js: invalid findings in ${rest[1]}: ${err.message}\n`);
      return 2;
    }
    const anchored = anchorRunDir(rest[0], deps, 3);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
    try {
      const result = writeArtifact({ runDir: anchored.dir, name: FINDINGS_ARTIFACT, content: JSON.stringify(artifact, null, 2) + '\n' });
      deps.stdout(JSON.stringify({ path: result.file, count: artifact.length }) + '\n');
    } catch (err) {
      deps.stderr(`review-coordination.js: could not write ${FINDINGS_ARTIFACT} (${err && err.message})\n`);
      return 3;
    }
    return 0;
  }
  if (command === 'check-coverage') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: check-coverage takes exactly 1 run-dir\n' + USAGE);
      return 2;
    }
    const anchored = anchorRunDir(rest[0], deps, 2);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
    // listSpecDirs comes from the archive module so tiebreak.js never requires
    // it; loaded here so the other verbs never pay for that module.
    const { listSpecDirs } = require('./lib/reconcile/archive-merged');
    deps.stdout(JSON.stringify(checkRunTiebreakCoverage(anchored.dir, listSpecDirs(anchored.dir))) + '\n');
    return 0;
  }
  deps.stderr(`review-coordination.js: unknown command: ${command === undefined ? '(none)' : command}\n` + USAGE);
  return 2;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { run };
