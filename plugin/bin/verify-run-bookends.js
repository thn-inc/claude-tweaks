#!/usr/bin/env node
// bin/verify-run-bookends.js — mechanical post-condition check for a headless
// build/test call, closing #1728's core gap: a `gh`-absent (MCP-transport)
// sandbox has no CLI-enforced guarantee that the claim/materialize/PR-open
// bookends actually landed before the calling agent self-reports
// DONE/build-test-ok. Five bookends are confirmed: `worktree` (stamped in
// run-state.json), `pr` (recorded, required only under pr-first), `claim` (a
// live claim for this run per target), `materialize` (each target's
// work/{n}-spec.md committed at the worktree's HEAD, #2912) and `claim-log`
// (the canonical Step 2.8 `claimed #{n}` decisions.md line per target, #2912).
// Every `missing` entry carries a `remedy` — the literal command that lands
// it. `flow/claim-targets.md`'s manual MCP procedure and
// `_shared/pr-early-run-lifecycle.md`'s MCP fallback (#929) already document
// how to perform each bookend correctly, but nothing mechanically confirms
// they were actually followed — this is that confirmation, run by direct
// inspection rather than trusting the call's own narrative (#1728's own
// Acceptance Criteria).
//
// Reads: run-state.json (`worktree`, `pr`), this run's own `config.yml`
// (`integration-model`, a valid pin being `pr-first` or `local-merge`; any
// other value degrades to one stderr line, since the PR bookend is then not
// checked) and `decisions.md` (the claim-log line) from
// `--run <dir>`; the live claim state for each `--targets` issue via git
// (never `gh` — `claims-git-cas.js`'s `readClaimBlobGit`, the same git-CAS
// read `claim-store.js` already uses on the `gh`-present path, so this check
// works identically whether `gh` is on PATH or not); and each target's
// committed spec via `git cat-file` at the recorded worktree's HEAD.
//
// The no-valid-pin degrade line also appends its own SKIP to decisions.md
// (#4026) — `condition: {that stderr line} → fallback: PR-bookend check not
// run`, reversibility n/a, no step or section, the line the caller prose had
// log-decision.js write — only into a run dir anchored under the main
// checkout. Every envelope carries `logged`: true when that entry landed,
// false when nothing degraded or the append failed (one more stderr line).
//
// Usage: node bin/verify-run-bookends.js --run <dir> --targets <n,n,...> [--help]
// Exit 0 = every bookend confirmed — {ok:true, confirmed:{...}, logged}.
// Exit 1 = one or more missing/unconfirmed — {ok:false, missing:[...], logged}. A
//          caller reaching exit 1 must report BLOCKED/build-test-blocked,
//          never DONE/build-test-ok (#1728's Acceptance Criteria).
// Exit 2 = malformed invocation.
'use strict';

const fs = require('fs');
const path = require('path');
const { readClaimBlobGit } = require('./lib/issues/claims-git-cas');
const { classifyClaimBlob } = require('./lib/issues/claims');
const { execFileSync } = require('child_process');
const { GIT_TIMEOUT_MS } = require('./lib/shared-primitives');
const { RUN_ID_RE } = require('./lib/hooks/context');
const { hasCanonicalClaimLogFor } = require('./lib/log-decision/claim-log');
const { resolveTarget, appendEntry, formatEntry } = require('./lib/log-decision/append');
const { lstatType } = require('./lib/path-guard');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SPEC_RUN_DIR_RE = /^spec-\d+$/;

const USAGE = 'usage: verify-run-bookends.js --run <dir> --targets <n,n,...> [--help]\n'
  + '  exit 0 = every bookend confirmed (worktree stamp, PR under pr-first, a live claim, a committed work/{n}-spec.md\n'
  + '           and the canonical Step 2.8 claim-log line per target)\n'
  + '  exit 1 = one or more missing/unconfirmed -- {ok:false, missing:[...]}\n'
  + '  exit 2 = malformed invocation\n'
  + '  a "degraded" stderr line also appends its SKIP to decisions.md; logged: true when it landed\n';

function parseArgs(argv) {
  const opts = { runDir: null, targetsRaw: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--run') opts.runDir = next();
    else if (a === '--targets') opts.targetsRaw = next();
    else return { error: `unknown argument: ${a}` };
  }
  return opts;
}

// Explicit positive-integer validation per part — mirrors
// `claim-targets.js`'s `parseTargets` exactly (never `Number(s)`, whose
// `Number('') === 0` would let a trailing comma or blank slip past
// `Number.isInteger`).
function parseTargets(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.split(',').map((s) => s.trim());
  const targets = [];
  for (const p of parts) {
    if (!/^[1-9]\d*$/.test(p)) return null;
    targets.push(Number(p));
  }
  return targets.length ? targets : null;
}

// A minimal flat `key: value` reader for this run's own config.yml — never a
// full YAML parser. The Pipeline Config Manifesto writes config.yml with
// `integration-model` as a top-level scalar (flow/manifesto.md); this reads
// only that one key, the same narrow-read posture materialize.js already
// takes for its own header composition rather than adding a YAML dependency.
function readConfigIntegrationModel(runDir) {
  try {
    const raw = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
    // [^\S\n]*, not \s*: an empty `integration-model:` line must read as absent,
    // never capture the next line's key as the value (the degrade line prints it).
    const m = raw.match(/^integration-model:[^\S\n]*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function readDecisions(runDir) {
  try {
    return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  } catch {
    return null;
  }
}

// Repo-relative paths a target's materialized spec can live at. A `spec-{n}`
// run dir nests under its parent run id; a run dir that is itself the run id
// holds the spec at `work/` (single-spec) or under `spec-{n}/work/`. A
// multi-target parent run is a bundle, which never uses flat `work/`.
function specCandidatePaths(runDir, issue, multiTarget) {
  const base = path.basename(runDir);
  const parent = path.basename(path.dirname(runDir));
  const root = '.claude-tweaks/pipelines';
  if (SPEC_RUN_DIR_RE.test(base) && RUN_ID_RE.test(parent)) {
    return [`${root}/${parent}/${base}/work/${issue}-spec.md`];
  }
  const nested = `${root}/${base}/spec-${issue}/work/${issue}-spec.md`;
  return multiTarget ? [nested] : [`${root}/${base}/work/${issue}-spec.md`, nested];
}

// true = git exited 0; false = git ran and exited non-zero; null = git did not
// get to answer (timeout, or a spawn error such as ENOENT) — "absent" would be
// a claim the probe cannot make.
function gitProbe(worktree, args, exec) {
  try {
    exec('git', ['-C', worktree, ...args], { stdio: 'ignore', windowsHide: true, timeout: GIT_TIMEOUT_MS });
    return true;
  } catch (err) {
    if (err && (err.signal || err.code === 'ETIMEDOUT' || typeof err.code === 'string')) return null;
    return false;
  }
}

// true = committed at HEAD; false = provably not (git ran, HEAD resolves, no
// candidate path in it); null = could not determine (no worktree, or git
// could not run or timed out) — the caller reports that as its own reason,
// never as done. `exec` is injectable for tests.
function isSpecCommitted({
  runDir, worktree, issue, multiTarget,
}, exec = execFileSync) {
  if (typeof worktree !== 'string' || !worktree) return null;
  const worktreeType = lstatType(worktree).type;
  if (worktreeType !== 'directory' && worktreeType !== 'symlink') return null;
  let undetermined = false;
  for (const rel of specCandidatePaths(runDir, issue, multiTarget)) {
    const found = gitProbe(worktree, ['cat-file', '-e', `HEAD:${rel}`], exec);
    if (found === true) return true;
    if (found === null) undetermined = true;
  }
  if (undetermined) return null;
  return gitProbe(worktree, ['rev-parse', '--verify', 'HEAD'], exec) === true ? false : null;
}

function readRunState(runDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  } catch {
    return null;
  }
}

// argv -> exit code. All I/O through deps so tests never touch real git or
// the filesystem (gh-api-module-pattern's injectable-runner convention).
function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`${opts.error}\n${USAGE}`); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!opts.runDir || opts.runDir.trim() === '') { deps.stderr(USAGE); return 2; }
  const targets = parseTargets(opts.targetsRaw);
  if (!targets) { deps.stderr(USAGE); return 2; }

  const missing = [];
  const { runDir } = opts;
  const runId = path.basename(runDir);
  const hooks = `node "${PLUGIN_ROOT}/bin/hooks.js"`;
  const claimRemedy = (n) => `node "${PLUGIN_ROOT}/bin/claim-targets.js" --run-id "${runId}" --targets ${n} --run "${runDir}" (gh-absent: flow/claim-targets.md's MCP claim procedure)`;
  // A bundle's parent run dir holds each member's spec under spec-{n}/; a spec-{N} run dir already is that dir.
  const bundleParent = targets.length > 1 && !SPEC_RUN_DIR_RE.test(runId);
  const materializeRemedy = (n) => `node "${PLUGIN_ROOT}/bin/materialize.js" ${n} --run-dir "${runDir}"${bundleParent ? ` --multi-record-slug ${n}` : ''} [--record-json <path> when gh is absent] then commit work/${n}-spec.md`;

  const runState = deps.readRunState(runDir);
  if (!runState || !runState.worktree) {
    missing.push({ bookend: 'worktree', remedy: `${hooks} record-worktree --run "${runDir}" "<worktree>"` });
  }

  // The degrade line also logs itself (#4026): the SKIP the prose had the caller
  // write, `condition: {stderr line} → fallback: PR-bookend check not run`, no
  // --step or --section. A failed append never changes the exit code: one
  // stderr line, logged:false, and the caller writes it by hand.
  let logged = false;
  const integrationModel = deps.readIntegrationModel(runDir);
  if (integrationModel !== 'pr-first' && integrationModel !== 'local-merge') {
    const line = `verify-run-bookends: degraded — ${runDir}/config.yml carries no valid integration-model pin (${integrationModel ?? 'absent'}); PR bookend not checked (_shared/integration-model.md's Run-scoped stability)`;
    deps.stderr(`${line}\n`);
    try {
      deps.appendDecision({
        runDir,
        entry: formatEntry({
          status: 'SKIP', now: deps.now(), text: `condition: ${line} → fallback: PR-bookend check not run`.replace(/\s+/g, ' '), reversibility: 'n/a',
        }),
      });
      logged = true;
    } catch (e) {
      deps.stderr(`verify-run-bookends: could not append the decisions.md entry: ${(e && e.message) || e}\n`);
    }
  }
  const prRequired = integrationModel === 'pr-first';
  if (prRequired && (!runState || !runState.pr)) {
    missing.push({
      bookend: 'pr',
      remedy: `_shared/pr-early-run-lifecycle.md push-and-open-draft-PR, then ${hooks} record-pr --run "${runDir}" <number> <url>`,
    });
  }

  for (const issue of targets) {
    const read = deps.readClaimBlobGit({ issueNumber: issue });
    if (read.failure) {
      // #3051: name the timeout specifically when claims-git-cas reported
      // one — "remote slow" is a different, more actionable signal than
      // "remote unreachable" for whoever reads this missing-bookend reason.
      const reason = read.timedOut
        ? `read-failed: ${read.failure} (timed out after ${GIT_TIMEOUT_MS} ms)`
        : `read-failed: ${read.failure}`;
      missing.push({ bookend: 'claim', issue, reason, remedy: claimRemedy(issue) });
      continue;
    }
    const content = read.absent ? null : read.content;
    const classified = classifyClaimBlob(content, deps.now());
    // A blob only carries an identity worth reading when it is still held —
    // `identity` stays null for every other state, which is itself the
    // "unconfirmed" answer below.
    const held = classified.state === 'live' || classified.state === 'stale';
    let identity = null;
    if (held) {
      try { identity = JSON.parse(content); } catch { identity = null; }
    }
    const confirmed = Boolean(identity && identity.runId === runId);
    if (!confirmed) {
      const identityNote = identity ? ` runId=${identity.runId}` : '';
      missing.push({ bookend: 'claim', issue, reason: `state=${classified.state}${identityNote}`, remedy: claimRemedy(issue) });
    }
  }

  const claimMissing = new Set(missing.filter((m) => m.bookend === 'claim').map((m) => m.issue));
  const worktree = runState && typeof runState.worktree === 'string' ? runState.worktree : null;
  const decisions = deps.readDecisions(runDir);
  for (const issue of targets) {
    const committed = deps.isSpecCommitted({
      runDir, worktree, issue, multiTarget: bundleParent,
    });
    if (committed !== true) {
      missing.push({
        bookend: 'materialize',
        issue,
        reason: committed === false ? 'not-committed' : 'undetermined',
        remedy: materializeRemedy(issue),
      });
    }
    if (!hasCanonicalClaimLogFor(decisions, issue)) {
      missing.push({
        bookend: 'claim-log',
        issue,
        reason: 'no canonical Step 2.8 line',
        remedy: claimMissing.has(issue)
          ? 'covered by the claim remedy above (claim-targets.js --run writes the canonical line)'
          : `node "${PLUGIN_ROOT}/bin/log-decision.js" --run "${runDir}" --section "/flow" --step "Step 2.8" --status AUTO --reversibility high --text "claimed #${issue} (bin/claim-targets.js, transport: {git|contents-api|mcp})"`,
      });
    }
  }

  if (missing.length) {
    deps.stdout(JSON.stringify({ ok: false, missing, logged }));
    return 1;
  }
  deps.stdout(JSON.stringify({
    ok: true,
    confirmed: {
      worktree: true, pr: prRequired ? true : 'n/a', claims: targets, materialize: targets, claimLog: targets,
    },
    logged,
  }));
  return 0;
}

// Appends only to a run dir anchored under the main checkout -- never a
// worktree-local shadow ([IL-127]); a refusal throws, which run() reports.
function appendDecision({ runDir, entry }) {
  const target = resolveTarget({ runDir });
  if (!target.ok) throw new Error(target.reason === 'missing' ? `run dir does not exist: ${runDir}` : `run dir is not anchored under the main checkout: ${runDir}`);
  return appendEntry({ runDir, entry });
}

const realDeps = {
  appendDecision,
  readRunState,
  readIntegrationModel: readConfigIntegrationModel,
  readClaimBlobGit,
  isSpecCommitted,
  readDecisions,
  now: Date.now,
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(s),
};

// `realDeps` is exported so the CLI's own wiring is testable, same reason
// `claim-targets.js` exports its own.
module.exports = {
  run, parseArgs, parseTargets, USAGE, realDeps,
};

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
