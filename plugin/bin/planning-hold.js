#!/usr/bin/env node
// bin/planning-hold.js — does `/claude-tweaks:specify`'s planning step hold this record? (#6059)
//   node bin/planning-hold.js --comments-file <file> [--help]
// A thin shell over bin/lib/issues/planning-hold.js's readPlanningHold: no selection or parse
// logic lives here. <file> is `gh issue view {n} --json comments` output (`{comments: [...]}`)
// or an MCP `get_comments` array.
// Stdout (exit 0, whatever the verdict): one JSON line, readPlanningHold's result —
// {verdict, reason, comment, otherUnresolved, supersededHolds, questions, skipped}
// (otherUnresolved and supersededHolds: see the lib module's header). --help or -h anywhere in
// argv prints usage and exits 0, ahead of every other argv check.
// Exit vocabulary follows bin/find-run-comment.js: 0 = answered (held or not); 1 = payload
// failure, the file unreadable, not JSON, or not one of the two shapes; 2 = invocation
// failure, a malformed argv (unknown flag, missing or repeated value). A relative path resolves
// against the injected cwd. The entry contract is
// .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
'use strict';

const fs = require('fs');
const { readPlanningHold } = require('./lib/issues/planning-hold');
const { resolveAgainst } = require('./lib/health-core/io');

const USAGE = 'usage: planning-hold.js --comments-file <file> [--help]\n';

function parseArgs(argv) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true, commentsFile: null };
  const o = { help: false, commentsFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--comments-file') return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    if (o.commentsFile !== null) return { error: `${a} given more than once` };
    o.commentsFile = v;
    i++;
  }
  return o;
}

function commentList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload !== null && typeof payload === 'object' && Array.isArray(payload.comments)) return payload.comments;
  return null;
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`planning-hold.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.commentsFile === null) return usageError('--comments-file is required');

  let payload;
  try {
    payload = JSON.parse(deps.readFile(resolveAgainst(deps.cwd(), o.commentsFile)));
  } catch (err) {
    deps.stderr(`planning-hold.js: could not read or parse --comments-file: ${o.commentsFile} (${err && err.message})\n`);
    return 1;
  }
  const comments = commentList(payload);
  if (comments === null) {
    deps.stderr(`planning-hold.js: --comments-file ${o.commentsFile} is not a comments list\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify(readPlanningHold(comments))}\n`);
  return 0;
}

const realDeps = {
  cwd: () => process.cwd(),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
