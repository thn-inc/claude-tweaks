#!/usr/bin/env node
'use strict';
// tools/typed-command-probe.js — #5584: the maintainer's probe for the typed-dispatch check. After a
// probe case is run in a throwaway session (docs/hooks.md carries the steps), it reads that session's
// pointer and transcript with the shipped code and prints what the check saw:
//
//   node tools/typed-command-probe.js --session <id> --record <n> [--config-dir <dir>] [--tmpdir <dir>]
//
// --config-dir defaults to $CLAUDE_CONFIG_DIR (readTypedCommand falls back to ~/.claude when that is
// unset too); --tmpdir defaults to os.tmpdir(), the temp dir the session's hook wrote the pointer under.
//
// Output, one JSON object: { pointer, candidates, answer }.
//   pointer     readPointer's result for the record
//   candidates  each candidate row (isCandidateRow) of the pointer's prompt id:
//               { promptId, turnOrigin, originKind, promptSource, isMeta, keys } — the marker fields,
//               null when absent, and the row's top-level key names. Never a value of `message` or of
//               any other key, so a row's text never reaches the output.
//   answer      readTypedCommand's result, with the real clock
//
// The candidates are read the way readTypedCommand reads them (the one transcript found by the session
// id alone); a transcript that is missing or unreadable leaves them empty and the answer says why.
//
// Exit codes: 0 printed; 1 malformed invocation.
// Seam: run(argv, deps) returns the exit code; deps holds stdout, stderr, env, cwd, homeDir and now.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPointer, readTypedCommand, isCandidateRow } = require('../plugin/bin/lib/issues/typed-command');
const { locateTranscripts, readPromptRows } = require('../plugin/bin/lib/timing/transcript');

const USAGE = 'usage: node tools/typed-command-probe.js --session <id> --record <n> [--config-dir <dir>] [--tmpdir <dir>]';
const FLAGS = { '--session': 'session', '--record': 'record', '--config-dir': 'configDir', '--tmpdir': 'tmpdir' };

const realDeps = {
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(`${s}\n`),
  env: process.env,
  cwd: () => process.cwd(),
  homeDir: () => os.homedir(),
  now: () => new Date(),
};

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    const key = FLAGS[arg];
    if (!key || i + 1 >= argv.length) return null;
    flags[key] = argv[(i += 1)];
  }
  if (typeof flags.session !== 'string' || flags.session === '') return null;
  if (!/^[1-9][0-9]*$/.test(flags.record || '')) return null;
  for (const k of ['configDir', 'tmpdir']) if (flags[k] === '') return null;
  return { flags };
}

const orNull = (v) => (v === undefined ? null : v);

function candidateMarkers({ sessionId, promptId, configDir, homeDir }) {
  try {
    const found = locateTranscripts({ sessionId, configDir, homeDir, fsImpl: fs });
    if (!Array.isArray(found) || found.length !== 1) return [];
    return readPromptRows(found[0].path, promptId, { fsImpl: fs })
      .filter((row) => isCandidateRow(row, { sessionId, promptId }))
      .map((row) => ({
        promptId: row.promptId,
        turnOrigin: orNull(row.turnOrigin),
        originKind: row.origin && typeof row.origin === 'object' ? orNull(row.origin.kind) : null,
        promptSource: orNull(row.promptSource),
        isMeta: orNull(row.isMeta),
        keys: Object.keys(row),
      }));
  } catch {
    return [];
  }
}

function run(argv, deps = realDeps) {
  const parsed = parseArgs(argv);
  if (parsed && parsed.help) {
    deps.stdout(USAGE);
    return 0;
  }
  if (!parsed) {
    deps.stderr(USAGE);
    return 1;
  }
  const { flags } = parsed;
  const sessionId = flags.session;
  const number = Number(flags.record);
  const env = deps.env || {};
  const configDir = flags.configDir !== undefined ? path.resolve(deps.cwd(), flags.configDir) : env.CLAUDE_CONFIG_DIR;
  const tmpdir = flags.tmpdir !== undefined ? path.resolve(deps.cwd(), flags.tmpdir) : os.tmpdir();
  const homeDir = deps.homeDir ? deps.homeDir() : os.homedir();

  const pointer = readPointer({ sessionId, number, tmpdir });
  const candidates = pointer.ok
    ? candidateMarkers({ sessionId, promptId: pointer.promptId, configDir: configDir || path.join(homeDir, '.claude'), homeDir })
    : [];
  const answer = readTypedCommand({
    number,
    env: { CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_CONFIG_DIR: configDir },
    now: deps.now ? deps.now() : new Date(),
    tmpdir,
    homeDir,
  });
  deps.stdout(JSON.stringify({ pointer, candidates, answer }));
  return 0;
}

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
