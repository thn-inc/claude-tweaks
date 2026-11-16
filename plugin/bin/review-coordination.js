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
//   node bin/review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>] [--run <dir>] [--tier capable|standard]
//   node bin/review-coordination.js finding-ids <entries.json>
//   node bin/review-coordination.js plan-chunks <entries.json>
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
// resolve-tiebreak's chunk form (#5540): when <finding.json> is a JSON array of 1 to
// CHUNK_MAX findings, <reply-file> holds one `Id: {12 hex}` block per finding and the
// call prints {chunk: true, results, unsettled, escalated}. Each settled finding (its block
// present exactly once) gets a result — the one-finding result plus id, index and,
// under --run, logged — and, under --run, its verdict line, appended in entry order. A
// missing or repeated id settles nothing and is named in unsettled with reason
// missing|duplicated, for the caller to re-dispatch alone. An empty, oversize or
// malformed array, or one repeating a finding id, exits 2 before anything is written.
// finding-ids (#5540) runs the chunk form's input checks over a JSON array of entries
// and prints {ids: [{index, id}]} — each id tiebreak.js's findingId, the `Id:` header a
// chunk agent is given — with no run dir and no writes; a failed check exits 2.
// plan-chunks (#5541) takes a JSON array of entries of any length and prints
// {chunks: [{chunk, tier, indexes}]}: tiebreak.js's planChunks, numbered from 1 in output
// order, each chunk one judge tier ('capable' | 'standard') of at most CHUNK_MAX entries,
// `indexes` positions in the input, a repeated finding id kept once at its first index (its later
// indexes appear in no chunk); [] prints {chunks: []}. No writes; an unreadable file, a
// non-array or a malformed entry exits 2 with the cause on stderr.
// resolve-tiebreak --tier (#5541), capable (the default) or standard; a missing or unknown
// value exits 2. At standard every entry must be Standard-tier (tiebreak.js's judgeTier); a
// Capable-tier entry exits 2 before the reply is read or anything is appended. The chunk
// form's output gains `escalated` beside results and unsettled: the entries a Standard judge
// raised to medium or higher, each {id, index, reason: 'raised', severity}, with no result and
// no verdict line, for the caller to judge again at capable ([] at capable). The one-finding
// form at standard prints {escalated: true, id, reason: 'raised', severity} for a raised
// finding — exit 0, nothing appended; any other reply resolves as at capable.
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
  resolveTiebreak, resolveTiebreakChunk, CHUNK_MAX, buildFindingsArtifact, checkRunTiebreakCoverage, FINDINGS_ARTIFACT,
  findingId, TIERS, judgeTier, planChunks, escalation,
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
  '       review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>] [--run <dir>] [--tier capable|standard]\n' +
  '       review-coordination.js finding-ids <entries.json>\n' +
  '       review-coordination.js plan-chunks <entries.json>\n' +
  '       review-coordination.js write-findings <run-dir> <findings.json>\n' +
  '       review-coordination.js check-coverage <run-dir>\n';

// A relative path argument resolves against deps.cwd(), never the process's real working directory.
const at = (deps, file) => (path.isAbsolute(file) ? file : path.resolve(deps.cwd(), file));

function readJson(file, deps) {
  const stderr = deps.stderr;
  let raw;
  try {
    raw = fs.readFileSync(at(deps, file), 'utf8');
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

// Appends one resolved verdict's decisions.md line under --run and sets `result.logged`;
// a failed append sets `logged: false` and writes one stderr line, never throwing.
// Shared by resolve-tiebreak's one-finding and chunk forms.
function appendVerdict(result, anchoredDir, now, deps) {
  try {
    const entry = formatEntry({ status: result.logStatus, now, step: result.logStep, text: result.logText, reversibility: 'high' });
    deps.appendDecision({ runDir: anchoredDir, section: '/review', entry });
    result.logged = true;
  } catch (err) {
    result.logged = false;
    deps.stderr(`review-coordination.js: could not append the decisions.md entry (- ${result.logLine}): ${(err && err.message) || err}\n`);
  }
}

// The evidence reader both resolve-tiebreak forms pass the resolver: it throws
// (→ evidence-unverified) for a path that resolves outside --root.
function evidenceReader(root) {
  return (p) => {
    const real = resolveWithin(path.resolve(root, p), root);
    if (real === null) throw new Error(`evidence path is outside --root or does not resolve: ${p}`);
    return fs.readFileSync(real, 'utf8');
  };
}

// The chunk form's input checks, shared by resolve-tiebreak's chunk form and finding-ids:
// returns { ids } (one finding id per entry, in entry order) or { exitCode: 2 } after one stderr line.
function validateChunk(findings, file, deps) {
  if (findings.length === 0 || findings.length > CHUNK_MAX) {
    deps.stderr(`review-coordination.js: a tiebreak chunk holds 1 to ${CHUNK_MAX} findings, ${file} holds ${findings.length}\n`);
    return { exitCode: 2 };
  }
  let ids;
  try {
    ids = buildFindingsArtifact(findings).map((f) => f.id);
  } catch (err) {
    deps.stderr(`review-coordination.js: malformed finding in ${file}: ${err.message}\n`);
    return { exitCode: 2 };
  }
  if (new Set(ids).size !== ids.length) {
    deps.stderr(`review-coordination.js: two findings in ${file} share a finding id\n`);
    return { exitCode: 2 };
  }
  return { ids };
}

// True, after one stderr line, when the entries cannot be judged at `tier` (#5541): at
// 'standard' every entry must be Standard-tier (judgeTier), so a Capable-tier finding is a
// caller error caught here before the reply is read or anything is appended, never by
// catching resolveTiebreakChunk's TypeError afterwards. 'capable' accepts every entry.
// Callers pass entries validateChunk or buildFindingsArtifact already accepted.
function refusedAtTier(findings, tier, deps) {
  if (tier !== 'standard' || !findings.some((f) => judgeTier(f) === 'capable')) return false;
  deps.stderr('review-coordination.js: a Capable-tier finding cannot be judged at standard — run plan-chunks and judge each chunk at its own tier\n');
  return true;
}

// The chunk form of resolve-tiebreak (#5540): the entries file is a JSON array of
// 1..CHUNK_MAX findings and the reply file holds one block per finding. Every exit-2
// check runs before the reply is read, the run dir is anchored, or anything is
// appended, so a refused chunk writes nothing.
function resolveTiebreakChunkCommand(findings, positional, root, runDir, tier, deps) {
  const checked = validateChunk(findings, positional[0], deps);
  if (checked.exitCode !== undefined) return checked.exitCode;
  if (refusedAtTier(findings, tier, deps)) return 2;
  let reply;
  try {
    reply = fs.readFileSync(at(deps, positional[1]), 'utf8');
  } catch (err) {
    deps.stderr(`review-coordination.js: cannot read ${positional[1]}: ${err.message}\n`);
    return 2;
  }
  let anchored = null;
  if (runDir !== null) {
    anchored = anchorRunDir(runDir, deps, 3);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
  }
  const now = deps.now();
  const { results, unsettled, escalated } = resolveTiebreakChunk(findings, reply, { readFile: evidenceReader(root), now, tier });
  if (anchored) {
    for (const result of results) appendVerdict(result, anchored.dir, now, deps);
  }
  deps.stdout(JSON.stringify({ chunk: true, results, unsettled, escalated }) + '\n');
  return 0;
}

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
    const a = readJson(rest[0], deps);
    if (a.failed) return 2;
    const b = readJson(rest[1], deps);
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
    const input = readJson(rest[0], deps);
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
    const input = readJson(rest[0], deps);
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
    let tier = 'capable';
    const positional = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--tier') {
        if (!TIERS.includes(rest[i + 1])) {
          deps.stderr(`review-coordination.js: --tier needs one of ${TIERS.join(', ')}\n` + USAGE);
          return 2;
        }
        tier = rest[++i];
      } else if (rest[i] === '--root' || rest[i] === '--run') {
        // A blank --run (an unset $PIPELINE_RUN_DIR) is a missing one, never a run dir
        // resolved against cwd -- resolve-policy.js's rule (#1138).
        if (i + 1 >= rest.length || (rest[i] === '--run' && rest[i + 1].trim() === '')) {
          deps.stderr(`review-coordination.js: ${rest[i]} needs a directory\n` + USAGE);
          return 2;
        }
        if (rest[i] === '--root') root = at(deps, rest[++i]);
        else runDir = rest[++i];
      } else positional.push(rest[i]);
    }
    if (positional.length !== 2) {
      deps.stderr('review-coordination.js: resolve-tiebreak takes <finding.json> <reply-file> [--root <dir>] [--run <dir>] [--tier capable|standard]\n' + USAGE);
      return 2;
    }
    const input = readJson(positional[0], deps);
    if (input.failed) return 2;
    if (Array.isArray(input.value)) return resolveTiebreakChunkCommand(input.value, positional, root, runDir, tier, deps);
    try {
      buildFindingsArtifact([input.value]);
    } catch (err) {
      deps.stderr(`review-coordination.js: malformed finding in ${positional[0]}: ${err.message}\n`);
      return 2;
    }
    if (refusedAtTier([input.value], tier, deps)) return 2;
    let reply;
    try {
      reply = fs.readFileSync(at(deps, positional[1]), 'utf8');
    } catch (err) {
      deps.stderr(`review-coordination.js: cannot read ${positional[1]}: ${err.message}\n`);
      return 2;
    }
    let anchored = null;
    if (runDir !== null) {
      anchored = anchorRunDir(runDir, deps, 3);
      if (anchored.exitCode !== undefined) return anchored.exitCode;
    }
    // A Standard judge that raised the finding to medium or higher has not settled it (#5541):
    // print the escalation and append nothing, for the caller to judge it again at Capable.
    const raised = escalation(input.value, reply, tier);
    if (raised) {
      deps.stdout(JSON.stringify({ escalated: true, id: findingId(input.value), ...raised }) + '\n');
      return 0;
    }
    const now = deps.now();
    const result = resolveTiebreak(input.value, reply, { readFile: evidenceReader(root), now });
    if (anchored) appendVerdict(result, anchored.dir, now, deps);
    deps.stdout(JSON.stringify(result) + '\n');
    return 0;
  }
  if (command === 'finding-ids') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: finding-ids takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps);
    if (input.failed) return 2;
    if (!Array.isArray(input.value)) {
      deps.stderr(`review-coordination.js: ${rest[0]} must hold a JSON array of tiebreak entries\n`);
      return 2;
    }
    const checked = validateChunk(input.value, rest[0], deps);
    if (checked.exitCode !== undefined) return checked.exitCode;
    deps.stdout(JSON.stringify({ ids: checked.ids.map((id, index) => ({ index, id })) }) + '\n');
    return 0;
  }
  if (command === 'plan-chunks') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: plan-chunks takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps);
    if (input.failed) return 2;
    if (!Array.isArray(input.value)) {
      deps.stderr(`review-coordination.js: ${rest[0]} must hold a JSON array of tiebreak entries\n`);
      return 2;
    }
    let chunks;
    try {
      chunks = planChunks(input.value);
    } catch (err) {
      deps.stderr(`review-coordination.js: malformed finding in ${rest[0]}: ${err.message}\n`);
      return 2;
    }
    deps.stdout(JSON.stringify({ chunks: chunks.map((c, i) => ({ chunk: i + 1, tier: c.tier, indexes: c.indexes })) }) + '\n');
    return 0;
  }
  if (command === 'write-findings') {
    if (rest.length !== 2) {
      deps.stderr('review-coordination.js: write-findings takes <run-dir> <findings.json>\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[1], deps);
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

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
