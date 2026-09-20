#!/usr/bin/env node
// bin/verify-run-bookends.js — mechanical post-condition check for a headless
// build/test call, closing #1728's core gap: a `gh`-absent (MCP-transport)
// sandbox has no CLI-enforced guarantee that the claim/materialize/PR-open
// bookends actually landed before the calling agent self-reports
// DONE/build-test-ok. `flow/claim-targets.md`'s manual MCP procedure and
// `_shared/pr-early-run-lifecycle.md`'s MCP fallback (#929) already document
// how to perform each bookend correctly, but nothing mechanically confirms
// they were actually followed — this is that confirmation, run by direct
// inspection rather than trusting the call's own narrative (#1728's own
// Acceptance Criteria).
//
// Reads: run-state.json (`worktree`, `pr`) and this run's own `config.yml`
// (`integration-model`) from `--run <dir>`; the live claim state for each
// `--targets` issue via git (never `gh` — `claims-git-cas.js`'s
// `readClaimBlobGit`, the same git-CAS read `claim-store.js` already uses on
// the `gh`-present path, so this check works identically whether `gh` is on
// PATH or not).
//
// Usage: node bin/verify-run-bookends.js --run <dir> --targets <n,n,...> [--help]
// Exit 0 = every bookend confirmed — {ok:true, confirmed:{...}}.
// Exit 1 = one or more missing/unconfirmed — {ok:false, missing:[...]}. A
//          caller reaching exit 1 must report BLOCKED/build-test-blocked,
//          never DONE/build-test-ok (#1728's Acceptance Criteria).
// Exit 2 = malformed invocation.
'use strict';

const fs = require('fs');
const path = require('path');
const { readClaimBlobGit } = require('./lib/issues/claims-git-cas');
const { classifyClaimBlob } = require('./lib/issues/claims');

const USAGE = 'usage: verify-run-bookends.js --run <dir> --targets <n,n,...> [--help]\n'
  + '  exit 0 = every bookend confirmed (worktree stamp, PR under pr-first, and a live claim per target)\n'
  + '  exit 1 = one or more missing/unconfirmed -- {ok:false, missing:[...]}\n'
  + '  exit 2 = malformed invocation\n';

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
    const m = raw.match(/^integration-model:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
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
  const runId = path.basename(opts.runDir);

  const runState = deps.readRunState(opts.runDir);
  if (!runState || !runState.worktree) missing.push({ bookend: 'worktree' });

  const integrationModel = deps.readIntegrationModel(opts.runDir);
  const prRequired = integrationModel === 'pr-first';
  if (prRequired && (!runState || !runState.pr)) {
    missing.push({ bookend: 'pr' });
  }

  for (const issue of targets) {
    const read = deps.readClaimBlobGit({ issueNumber: issue });
    if (read.failure) {
      missing.push({ bookend: 'claim', issue, reason: `read-failed: ${read.failure}` });
      continue;
    }
    const content = read.absent ? null : read.content;
    const classified = classifyClaimBlob(content, deps.now());
    let identity = null;
    if (classified.state === 'live' || classified.state === 'stale') {
      try { identity = JSON.parse(content); } catch { identity = null; }
    }
    const confirmed = identity && identity.runId === runId
      && (classified.state === 'live' || classified.state === 'stale');
    if (!confirmed) {
      const identityNote = identity ? ` runId=${identity.runId}` : '';
      missing.push({ bookend: 'claim', issue, reason: `state=${classified.state}${identityNote}` });
    }
  }

  if (missing.length) {
    deps.stdout(JSON.stringify({ ok: false, missing }));
    return 1;
  }
  deps.stdout(JSON.stringify({
    ok: true,
    confirmed: { worktree: true, pr: prRequired ? true : 'n/a', claims: targets },
  }));
  return 0;
}

const realDeps = {
  readRunState,
  readIntegrationModel: readConfigIntegrationModel,
  readClaimBlobGit,
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
