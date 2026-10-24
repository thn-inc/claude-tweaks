#!/usr/bin/env node
// bin/find-run-comment.js — the worktree-safe PR run-comment Find (#3936).
//   node bin/find-run-comment.js --comments-file <file> --kind <kind> [--help]
// Premise, corrected (live probes, #3936): the jq form passes when run alone;
// the worktree guard refuses it only when it is chained by `;`/`&&` onto an
// unquoted `$?` (`_shared/scratch-worktree.md` §7), so the Find step's
// worktree-safe form is a plain fetch-to-file plus this CLI, which survives
// that habit. The trust rule is bin/lib/issues/comment-trust.js, the same rule
// the jq twin pastes. The contract is _shared/pr-run-comments.md's Find step.
// Input: a gh `{comments: [...]}` payload, or a bare REST/MCP comment array.
// Stdout (exit 0): one line, {kind, id, ids, skipped}. `id` is the first
// trusted match's id (null when none); `skipped` carries one note per untrusted
// marker comment.
// Exit vocabulary follows bin/wrap-up-engine.js's header: 0 = answered (found
// or not); 1 = Payload failure, the --comments-file unreadable, unparseable, or
// not a comments list; 2 = Invocation failure, a malformed argv.
'use strict';

const fs = require('fs');
const { isTrustedComment, untrustedSkipNote } = require('./lib/issues/comment-trust');

const USAGE = 'usage: find-run-comment.js --comments-file <file> --kind <kind> [--help]\n';
const KIND_RE = /^[a-z][a-z-]*(:\d+)?$/;
const FLAGS = { '--comments-file': 'commentsFile', '--kind': 'kind' };

function parseArgs(argv) {
  const o = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    if (Object.hasOwn(o, FLAGS[a])) return { error: `${a} given more than once` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

// A payload is a comments list: gh's `{comments: [...]}` or a bare array.
function commentList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload !== null && typeof payload === 'object' && Array.isArray(payload.comments)) return payload.comments;
  return null;
}

function findRunComments(payload, kind) {
  const comments = commentList(payload);
  if (comments === null) return null;
  const marker = `<!-- run-comment: ${kind} -->`;
  const candidates = comments.filter((c) => c !== null && typeof c === 'object' && typeof c.body === 'string' && c.body.startsWith(marker));
  const ids = candidates
    .filter(isTrustedComment)
    .map((c) => c.id)
    .filter((id) => id !== null && id !== undefined && id !== '')
    .map(String);
  const skipped = candidates.filter((c) => !isTrustedComment(c)).map(untrustedSkipNote);
  return { kind, id: ids[0] ?? null, ids, skipped };
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`find-run-comment.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.commentsFile) return usageError('--comments-file is required');
  if (!o.kind) return usageError('--kind is required');
  if (!KIND_RE.test(o.kind)) return usageError(`--kind must match ${KIND_RE}, got: ${o.kind}`);

  let payload;
  try { payload = JSON.parse(deps.readFile(o.commentsFile)); } catch (err) {
    deps.stderr(`find-run-comment.js: could not read or parse --comments-file: ${o.commentsFile} (${err && err.message})\n`);
    return 1;
  }
  const found = findRunComments(payload, o.kind);
  if (found === null) {
    deps.stderr(`find-run-comment.js: --comments-file ${o.commentsFile} is not a comments list\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify(found)}\n`);
  return 0;
}

module.exports = { run, parseArgs, findRunComments };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
