#!/usr/bin/env node
// plugin/bin/declined-learning.js — #2546: a CLI wrapper over
// bin/lib/declined-learning/store.js's lookupDecline/recordDecline, so
// reflect/full-mode.md's prescribed "compute the fingerprint, then look it
// up" and "record the decline" steps are one command each instead of a
// scratch `node -e` module call (the gap this record measured: a 3-attempt
// retry loop under Git Bash, where a bare `node -e` module call printed
// nothing until the call was moved into a file). No new business logic —
// this thinly adapts createFingerprint + lookupDecline/recordDecline to
// stdin/argv, same contract shape as bin/wrap-up-engine.js's record verb.
//
// Exit codes: 0 success. 1 the invocation was fine but stdin wasn't — not
// valid JSON, or missing/empty `description` (matching
// wrap-up-engine.js's own invocation-vs-payload split: a payload problem is
// 1, never 2, since the model retries with fixed stdin rather than
// re-reading usage). 2 a malformed invocation — missing/unknown flags,
// unknown verb, or --source missing/empty.
'use strict';

const fs = require('fs');
const { createFingerprint } = require('./lib/health-core/fingerprint');
const { cwdOrUndefined } = require('./lib/health-core/io');
const { lookupDecline, recordDecline } = require('./lib/declined-learning/store');

const USAGE = [
  'usage: declined-learning.js lookup --source <source>   ({"description": "..."} on stdin)',
  '       declined-learning.js record-decline --source <source>   ({"description": "...", "reason": "..."} on stdin)',
  '',
].join('\n');

function usageExit(d) {
  d.stderr(USAGE);
  return 2;
}

function parseArgs(argv) {
  const out = { source: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const hasValue = i + 1 < argv.length && !argv[i + 1].startsWith('--');
    if (a === '--source' && hasValue) { out.source = argv[i + 1]; i += 1; continue; }
  }
  return out;
}

// Reads stdin as JSON and validates it carries a non-empty `description`
// string. Returns { payload } on success, or { code } (having already written
// the error; the code is 1) on any failure — the shared payload gate for both
// verbs below.
function readDescriptionPayload(verb, d) {
  const raw = d.stdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    d.stderr(`declined-learning.js ${verb}: stdin is not valid JSON: ${e.message}\n`);
    return { code: 1 };
  }
  if (!payload || typeof payload !== 'object' || typeof payload.description !== 'string' || payload.description.trim() === '') {
    d.stderr(`declined-learning.js ${verb}: stdin JSON must carry a non-empty "description" string\n`);
    return { code: 1 };
  }
  return { payload };
}

// Shared by runLookup/runRecordDecline: the fingerprint both verbs key
// their store lookup/write on.
function computeFingerprint(source, description) {
  return createFingerprint(source, ['description']).fingerprint({ description });
}

// Both subcommands pass the store cwdOrUndefined(d): its anchor directory is undefined when d.cwd()
// throws (a deleted working directory), and the store's own anchorRoot() then degrades open exactly
// as it did before the entry contract.
function runLookup(args, d) {
  if (!args.source) return usageExit(d);
  const read = readDescriptionPayload('lookup', d);
  if (!read.payload) return read.code;

  const fingerprint = computeFingerprint(args.source, read.payload.description);
  const decline = lookupDecline(fingerprint, { cwd: cwdOrUndefined(d) });
  d.stdout(`${JSON.stringify({ fingerprint, decline }, null, 2)}\n`);
  return 0;
}

function runRecordDecline(args, d) {
  if (!args.source) return usageExit(d);
  const read = readDescriptionPayload('record-decline', d);
  if (!read.payload) return read.code;
  const { payload } = read;

  const fingerprint = computeFingerprint(args.source, payload.description);
  let entry;
  try {
    // subject: the same description text the fingerprint was computed from
    // (#1033) — matches reflect/full-mode.md's own recordDecline call shape
    // exactly, so a later subject-scan step has something to compare
    // against for a reworded re-surfaced finding.
    entry = recordDecline(fingerprint, {
      reason: typeof payload.reason === 'string' ? payload.reason : null,
      source: args.source,
      subject: payload.description,
    }, { cwd: cwdOrUndefined(d) });
  } catch (e) {
    d.stderr(`declined-learning.js record-decline: ${e.message}\n`);
    return 1;
  }
  d.stdout(`${JSON.stringify({ fingerprint, entry }, null, 2)}\n`);
  return 0;
}

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const verb = argv[0];
  const args = parseArgs(argv.slice(1));

  if (verb === 'lookup') return runLookup(args, d);
  if (verb === 'record-decline') return runRecordDecline(args, d);
  return usageExit(d);
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  stdin: () => {
    try {
      return fs.readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  },
};

module.exports = { run, realDeps, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
