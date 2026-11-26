#!/usr/bin/env node
// bin/compose-record.js — compose + validate a work-record body from a JSON payload file,
// or validate an already-composed body file.
//   node bin/compose-record.js <payload-file> --out <body-file> [--require-shaped] [--help]
//   node bin/compose-record.js --check <body-file> [--record <id>]
// Exit 0 = composed and written (prints {title,type,labels,out} JSON to stdout), or --check passed (no output;
//     with --record the passing body file is rewritten in place without its composed-for marker);
// 2 = malformed invocation (bad args, missing/unreadable/unparsable payload or body file, missing --out,
//     --check combined with a payload, --out, or --require-shaped, or --record without --check / without an id);
// 3 = payload validation error (recordPayload rejected a field — see stderr);
// 4 = shape validation failed (--require-shaped or --check — gaps on stderr, one per line);
// 5 = could not write --out (or, under --check --record, could not rewrite the body file);
// 6 = --check --record: the first-line `<!-- composed-for: #{id} -->` marker is missing, malformed, or names
//     another record (#4746).
// Consolidates the "compose a payload, write it to a temp JSON file, then read the JSON back
// out to extract just its .body field" node -e pattern repeated across capture/SKILL.md and
// specify/record-creation.md (#800) into one canonical, tested CLI — #686's release-claim.js /
// log-decision.js precedent for shape (injectable stdout/stderr deps, run(argv, deps) exported
// alongside the require.main guard, direct fs calls with no injection needed for them).
'use strict';

const fs = require('fs');
const { composeBody, validateShaped } = require('./lib/compose-record/compose');

const USAGE = 'usage: compose-record.js <payload-file> --out <body-file> [--require-shaped] [--help]\n'
  + '       compose-record.js --check <body-file> [--record <id>]\n';

const COMPOSED_FOR_RE = /^<!-- composed-for: #([A-Za-z0-9._-]+) -->$/;

// First-line provenance marker (#4746). `rest` is the body minus the marker line (and its line ending) when ok.
function readComposedFor(body) {
  const nl = body.indexOf('\n');
  const first = (nl === -1 ? body : body.slice(0, nl)).replace(/\r$/, '');
  const m = COMPOSED_FOR_RE.exec(first);
  if (m) return { status: 'ok', id: m[1], rest: nl === -1 ? '' : body.slice(nl + 1) };
  return { status: first.startsWith('<!-- composed-for:') ? 'malformed' : 'missing', id: null, rest: body };
}

function parseArgs(argv) {
  const o = { payloadFile: null, out: null, requireShaped: false, help: false, check: null, record: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--out') o.out = next();
    else if (a === '--require-shaped') o.requireShaped = true;
    else if (a === '--check') o.check = next() ?? '';
    else if (a === '--record') o.record = next() ?? '';
    else if (a.startsWith('--')) return { error: `unknown argument: ${a}` };
    else positional.push(a);
  }
  if (positional.length > 1) return { error: `unexpected argument: ${positional[1]}` };
  o.payloadFile = positional[0] || null;
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const shapeGapsMessage = (gaps) => `compose-record.js: body is not spec-shaped:\n${gaps.map((g) => `  - ${g}`).join('\n')}\n`;

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`compose-record.js: ${message}\n` + USAGE); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }

  if (o.record !== null && o.check === null) return usageError('--record is only valid with --check');
  if (o.check !== null) {
    if (!o.check) return usageError('--check <body-file> is required');
    if (o.record === '') return usageError('--record <id> is required');
    if (o.payloadFile || o.out || o.requireShaped) return usageError('--check cannot be combined with a payload file, --out, or --require-shaped');
    let body;
    try { body = fs.readFileSync(o.check, 'utf8'); } catch (err) {
      return usageError(`could not read body file: ${o.check} (${err && err.message})`);
    }
    if (o.record === null) {
      const shaped = validateShaped(body);
      if (!shaped.ok) { deps.stderr(shapeGapsMessage(shaped.gaps)); return 4; }
      return 0;
    }
    const marker = readComposedFor(body);
    if (marker.status !== 'ok' || marker.id !== o.record) {
      deps.stderr(marker.status === 'ok'
        ? `compose-record.js: body file ${o.check} was composed for #${marker.id}, not #${o.record} — refusing to write it\n`
        : marker.status === 'missing'
          ? `compose-record.js: body file ${o.check} carries no composed-for marker — refusing to write it to #${o.record}\n`
          : `compose-record.js: body file ${o.check} has a malformed composed-for marker — refusing to write it to #${o.record}\n`);
      return 6;
    }
    const shaped = validateShaped(marker.rest);
    if (!shaped.ok) { deps.stderr(shapeGapsMessage(shaped.gaps)); return 4; }
    try { fs.writeFileSync(o.check, marker.rest); } catch (err) {
      deps.stderr(`compose-record.js: could not rewrite body file: ${o.check} (${err && err.message})\n`);
      return 5;
    }
    return 0;
  }

  if (!o.payloadFile) return usageError('<payload-file> is required');
  if (!o.out) return usageError('--out <body-file> is required');

  let raw;
  try { raw = fs.readFileSync(o.payloadFile, 'utf8'); } catch (err) {
    return usageError(`could not read payload file: ${o.payloadFile} (${err && err.message})`);
  }
  let payload;
  try { payload = JSON.parse(raw); } catch (err) {
    return usageError(`payload file is not valid JSON: ${o.payloadFile} (${err && err.message})`);
  }

  let result;
  try { result = composeBody(payload); } catch (err) {
    deps.stderr(`compose-record.js: payload rejected: ${err && err.message}\n`);
    return 3;
  }

  if (o.requireShaped) {
    const shaped = validateShaped(result.body);
    if (!shaped.ok) {
      deps.stderr(shapeGapsMessage(shaped.gaps));
      return 4;
    }
  }

  try { fs.writeFileSync(o.out, result.body); } catch (err) {
    deps.stderr(`compose-record.js: could not write --out file: ${o.out} (${err && err.message})\n`);
    return 5;
  }

  deps.stdout(JSON.stringify({ title: result.title, type: result.type, labels: result.labels, out: o.out }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, readComposedFor };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
