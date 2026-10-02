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
const { lookupDecline, recordDecline } = require('./lib/declined-learning/store');

const USAGE = [
  'usage: declined-learning.js lookup --source <source>   ({"description": "..."} on stdin)',
  '       declined-learning.js record-decline --source <source>   ({"description": "...", "reason": "..."} on stdin)',
  '',
].join('\n');

function usageExit() {
  process.stderr.write(USAGE);
  process.exitCode = 2;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
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
// string. Returns the parsed payload, or null (having already written the
// error and exit code 1) on any failure — the shared payload gate for both
// verbs below.
function readDescriptionPayload(verb) {
  const raw = readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`declined-learning.js ${verb}: stdin is not valid JSON: ${e.message}\n`);
    process.exitCode = 1;
    return null;
  }
  if (!payload || typeof payload !== 'object' || typeof payload.description !== 'string' || payload.description.trim() === '') {
    process.stderr.write(`declined-learning.js ${verb}: stdin JSON must carry a non-empty "description" string\n`);
    process.exitCode = 1;
    return null;
  }
  return payload;
}

function runLookup(args) {
  if (!args.source) { usageExit(); return; }
  const payload = readDescriptionPayload('lookup');
  if (!payload) return;

  const fingerprint = createFingerprint(args.source, ['description']).fingerprint({ description: payload.description });
  const decline = lookupDecline(fingerprint);
  process.stdout.write(`${JSON.stringify({ fingerprint, decline }, null, 2)}\n`);
}

function runRecordDecline(args) {
  if (!args.source) { usageExit(); return; }
  const payload = readDescriptionPayload('record-decline');
  if (!payload) return;

  const fingerprint = createFingerprint(args.source, ['description']).fingerprint({ description: payload.description });
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
    });
  } catch (e) {
    process.stderr.write(`declined-learning.js record-decline: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ fingerprint, entry }, null, 2)}\n`);
}

function main() {
  const verb = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (verb === 'lookup') { runLookup(args); return; }
  if (verb === 'record-decline') { runRecordDecline(args); return; }
  usageExit();
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, USAGE };
