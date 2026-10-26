#!/usr/bin/env node
// bin/close-out-marker.js — read, write and resolve the `close-out-update` PR
// run comment's update marker (#4331).
//   node bin/close-out-marker.js read --comments-file <file> [--body-out <file>] [--help]
//   node bin/close-out-marker.js write --comments-file <file> --update-method <m>
//        (--conflicted-files-file <file> | --conflicted-files <none|unknown>)
//        --pre-update-head <40-hex> --resolution-commit <40-hex|pending> --out <file>
//   node bin/close-out-marker.js resolve-pending --comments-file <file> --sha <40-hex> --out <file>
// The parsing, validation and accumulation rules live in
// bin/lib/dispatch/close-out-marker.js; this CLI is the file/argv seam over them
// for skills/dispatch/close-out-update.md. The comment is found through
// find-run-comment.js's findRunComments (kind `close-out-update`), so a marker
// from an untrusted author is skipped and named, never read.
//
// Input: a gh `{comments: [...]}` payload, or a bare REST/MCP comment array.
// Stdout (exit 0), one JSON line:
//   read:  {status, id, ids, updateMethod, conflictedFiles, preUpdateHead,
//           resolutionCommits, skipped, bodyWritten}. status is `none` (no trusted
//           marker; the four fields are null), `pending`, `cleared` or `unreadable`
//           (the fields then read 'unknown'). An unreadable marker is still exit 0:
//           the status is data. `id` is the comment to update in place and `ids` every
//           trusted match (Find's list), so a caller can log more than one.
//           `--body-out` saves the trusted comment's exact raw body, byte for byte
//           (CRLF included), to that path, written atomically like --out; no trusted
//           marker writes nothing. `bodyWritten` is that path, or null when the flag is
//           not given or no file was written. This is how a caller keeps the body a
//           marker had before a `write`, to post it back unchanged if the landing call
//           fails and nothing landed: the CLI saved it, so nothing composes it by hand.
//   write / resolve-pending: {written, accumulated, marker}. `written` is the
//           path written (the --out value, as given, the sanctioned writers'
//           echoed-path convention), `marker` is the written body parsed back
//           (parseMarker's shape), and
//           `accumulated` is true only when `write` folded the update into an
//           existing pending marker (a fresh marker, or resolve-pending's in-place
//           replacement, is false).
// `write` over a `pending` marker appends the update (oldest first, files
// unioned, pre-update-head replaced); over no marker or a `cleared` one it writes
// a fresh marker from the flags; over an `unreadable` one it refuses.
//
// Every flag value is validated here, before the file is read: the module's
// appendUpdate/resolvePendingCommit do not validate, and any flag value containing a
// line break is a usage error. Conflicted paths are untrusted text (a path is
// attacker-nameable, and `posts.$slug.tsx` expands inside a double-quoted shell
// argument), so they never travel on the command line: exactly one of
// `--conflicted-files-file <file>` (the caller writes it with a file-writing tool,
// one path per line, LF or CRLF; blank lines are ignored) and
// `--conflicted-files`, which takes only the literals `none` ([]) and `unknown`, is
// required — both or neither is exit 2, and any other `--conflicted-files` value
// is exit 2 naming the file flag. A paths file that is unreadable, holds no paths,
// holds a path with a comma (the marker's comma-joined format cannot carry it), holds a
// bare carriage return, holds a path with leading or trailing whitespace (the marker trims
// it on read), or holds a path named exactly `none` or `unknown` (the marker reads those
// back as its sentinels, losing the path) is exit 1 (payload), read through
// deps.readFile after the comments file.
//
// Exit vocabulary is the Payload-1/Invocation-2 family of find-run-comment.js and
// wrap-up-engine.js: 0 = answered; 1 = Payload failure, the --comments-file
// unreadable, unparseable or not a comments list, or (write / resolve-pending) a
// marker that cannot be used (unreadable; no pending entry to resolve), or (write)
// a --conflicted-files-file payload that cannot be used;
// 2 = Invocation failure, a malformed argv; 3 = the --out (or read's --body-out)
// could not be written (qa-report.js's precedent: --out is a caller-named
// artifact, written atomically with no lock and no run-dir anchoring).
'use strict';

const fs = require('fs');
const { findRunComments, firstTrustedMarkerComment } = require('./find-run-comment');
const { writeFileAtomic } = require('./lib/atomic-write');
const {
  UPDATE_METHODS,
  SHA_RE,
  parseMarker,
  serializeMarker,
  appendUpdate,
  resolvePendingCommit,
} = require('./lib/dispatch/close-out-marker');

const KIND = 'close-out-update';

// What `read` reports when no trusted marker comment exists.
const NO_MARKER = Object.freeze({
  status: 'none',
  updateMethod: null,
  conflictedFiles: null,
  preUpdateHead: null,
  resolutionCommits: null,
});

const USAGE = 'usage: close-out-marker.js read --comments-file <file> [--body-out <file>] [--help]\n'
  + '       close-out-marker.js write --comments-file <file> --update-method <merge|gh pr update-branch>\n'
  + '           (--conflicted-files-file <file> | --conflicted-files <none|unknown>)\n'
  + '           --pre-update-head <40-hex> --resolution-commit <40-hex|pending> --out <file>\n'
  + '       close-out-marker.js resolve-pending --comments-file <file> --sha <40-hex> --out <file>\n'
  + '  exit 0 answered, 1 comments payload, paths file or marker unusable, 2 malformed invocation, 3 --out or --body-out unwritable\n';

// Per verb: the flags it takes and the key each is stored under. All are required
// except the keys OPTIONAL names.
const VERBS = {
  read: { '--comments-file': 'commentsFile', '--body-out': 'bodyOut' },
  write: {
    '--comments-file': 'commentsFile',
    '--update-method': 'updateMethod',
    '--conflicted-files': 'conflictedFiles',
    '--conflicted-files-file': 'conflictedFilesFile',
    '--pre-update-head': 'preUpdateHead',
    '--resolution-commit': 'resolutionCommit',
    '--out': 'out',
  },
  'resolve-pending': {
    '--comments-file': 'commentsFile',
    '--sha': 'sha',
    '--out': 'out',
  },
};
// write's two conflicted-files keys are checked as an exclusive pair in validate.
const OPTIONAL = { read: ['bodyOut'], write: ['conflictedFiles', 'conflictedFilesFile'] };

function parseArgs(argv) {
  const o = { help: false, verb: null };
  let start = 0;
  if (argv.length > 0 && !argv[0].startsWith('-')) {
    o.verb = argv[0];
    start = 1;
    if (!Object.hasOwn(VERBS, o.verb)) return { error: `unknown verb: ${o.verb}` };
  }
  const flags = o.verb === null ? {} : VERBS[o.verb];
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!Object.hasOwn(flags, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    if (/[\r\n]/.test(v)) return { error: `${a} value must not contain a line break` };
    if (Object.hasOwn(o, flags[a])) return { error: `${a} given more than once` };
    o[flags[a]] = v;
    i++;
  }
  if (!o.help && o.verb === null) return { error: 'a verb is required' };
  return o;
}

// The flags a verb requires, each present; then the value-shape checks. Returns
// an error string, or null when the invocation is well-formed. Normalises the
// parsed values in place (hex lowercased, the conflicted-files list split).
function validate(o) {
  const optional = Object.hasOwn(OPTIONAL, o.verb) ? OPTIONAL[o.verb] : [];
  for (const [flag, key] of Object.entries(VERBS[o.verb])) {
    if (!Object.hasOwn(o, key) && !optional.includes(key)) return `${flag} is required`;
  }
  if (o.verb === 'read') return null;
  if (o.verb === 'resolve-pending') {
    if (!SHA_RE.test(o.sha)) return `--sha must be 40 hex characters, got: ${o.sha}`;
    o.sha = o.sha.toLowerCase();
    return null;
  }
  if (!UPDATE_METHODS.includes(o.updateMethod)) {
    return `--update-method must be one of: ${UPDATE_METHODS.join(', ')}; got: ${o.updateMethod}`;
  }
  if (!SHA_RE.test(o.preUpdateHead)) return `--pre-update-head must be 40 hex characters, got: ${o.preUpdateHead}`;
  o.preUpdateHead = o.preUpdateHead.toLowerCase();
  if (o.resolutionCommit !== 'pending') {
    if (!SHA_RE.test(o.resolutionCommit)) return `--resolution-commit must be 40 hex characters or pending, got: ${o.resolutionCommit}`;
    o.resolutionCommit = o.resolutionCommit.toLowerCase();
  }
  const hasList = Object.hasOwn(o, 'conflictedFiles');
  const hasFile = Object.hasOwn(o, 'conflictedFilesFile');
  if (hasList === hasFile) return 'exactly one of --conflicted-files-file <file> and --conflicted-files <none|unknown> is required';
  if (hasList) {
    if (o.conflictedFiles === 'none') o.conflictedFiles = [];
    else if (o.conflictedFiles !== 'unknown') {
      return `--conflicted-files takes only none or unknown; pass paths with --conflicted-files-file <file>, got: ${o.conflictedFiles}`;
    }
  }
  return null;
}

// The conflicted paths a --conflicted-files-file holds: one per line (LF or CRLF), blank and
// whitespace-only lines ignored. Returns {files} or {error}; the file is untrusted text, so a path
// the marker's comma-joined, line-oriented, whitespace-trimmed format cannot carry is refused
// rather than altered.
function readPathsFile(file, deps) {
  let text;
  try { text = deps.readFile(file); } catch (e) {
    return { error: `could not read --conflicted-files-file: ${file} (${errMsg(e)})` };
  }
  const files = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (files.length === 0) return { error: `--conflicted-files-file ${file} holds no paths` };
  const padded = files.find((f) => f !== f.trim());
  if (padded !== undefined) return { error: `--conflicted-files-file ${file} holds a path with leading or trailing whitespace, which the marker would trim: ${JSON.stringify(padded)}; record this update with --conflicted-files unknown instead` };
  const bad = files.find((f) => f.includes(','));
  if (bad !== undefined) return { error: `--conflicted-files-file ${file} holds a path with a comma, which the marker cannot carry: ${bad}; record this update with --conflicted-files unknown instead` };
  if (files.some((f) => /\r/.test(f))) return { error: `--conflicted-files-file ${file} holds a path with a line break` };
  const reserved = files.find((f) => f === 'none' || f === 'unknown');
  if (reserved !== undefined) return { error: `--conflicted-files-file ${file} holds a path named ${reserved}, which the marker reads back as a sentinel, not a path; record this update with --conflicted-files unknown instead` };
  return { files };
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, content) => writeFileAtomic(p, content),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const errMsg = (e) => (e && (e.code || e.message)) || 'unknown';

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`close-out-marker.js: ${message}\n${USAGE}`); return 2; };
  const fail = (code, message) => { deps.stderr(`close-out-marker.js: ${message}\n`); return code; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  const invalid = validate(o);
  if (invalid) return usageError(invalid);

  let payload;
  try { payload = JSON.parse(deps.readFile(o.commentsFile)); } catch (e) {
    return fail(1, `could not read or parse --comments-file: ${o.commentsFile} (${errMsg(e)})`);
  }
  const found = findRunComments(payload, KIND);
  if (found === null) return fail(1, `--comments-file ${o.commentsFile} is not a comments list`);

  // The trusted comment findRunComments chose, taken from the same module so the selection rule lives once.
  const hit = firstTrustedMarkerComment(payload, KIND);
  const rawBody = hit === null ? null : hit.body;
  const existing = hit === null ? null : parseMarker(rawBody);

  if (o.verb === 'read') {
    let bodyWritten = null;
    if (Object.hasOwn(o, 'bodyOut') && rawBody !== null) {
      try { deps.writeFile(o.bodyOut, rawBody); } catch (e) {
        return fail(3, `out-unwritable: ${o.bodyOut} (${errMsg(e)})`);
      }
      bodyWritten = o.bodyOut;
    }
    const view = existing === null ? NO_MARKER : existing;
    deps.stdout(`${JSON.stringify({
      status: view.status,
      id: found.id,
      ids: found.ids,
      updateMethod: view.updateMethod,
      conflictedFiles: view.conflictedFiles,
      preUpdateHead: view.preUpdateHead,
      resolutionCommits: view.resolutionCommits,
      skipped: found.skipped,
      bodyWritten,
    })}\n`);
    return 0;
  }

  if (o.verb === 'write' && Object.hasOwn(o, 'conflictedFilesFile')) {
    const paths = readPathsFile(o.conflictedFilesFile, deps);
    if (paths.error) return fail(1, paths.error);
    o.conflictedFiles = paths.files;
  }

  let next;
  let accumulated = false;
  if (o.verb === 'write') {
    if (existing !== null && existing.status === 'unreadable') {
      return fail(1, `marker unreadable: comment ${found.id} is a close-out-update comment this CLI cannot parse; nothing written`);
    }
    if (existing !== null && existing.status === 'pending') {
      next = appendUpdate(existing, o);
      accumulated = true;
    } else {
      next = {
        updateMethod: [o.updateMethod],
        conflictedFiles: o.conflictedFiles,
        preUpdateHead: o.preUpdateHead,
        resolutionCommits: [o.resolutionCommit],
      };
    }
  } else {
    const status = existing === null ? NO_MARKER.status : existing.status;
    if (status !== 'pending') {
      return fail(1, `no pending marker to resolve (marker is ${status}); nothing written`);
    }
    next = resolvePendingCommit(existing, o.sha);
    if (next === null) return fail(1, 'the pending marker has no pending resolution-commit entry to resolve; nothing written');
  }

  const body = serializeMarker(next);
  try { deps.writeFile(o.out, body); } catch (e) {
    return fail(3, `out-unwritable: ${o.out} (${errMsg(e)})`);
  }
  deps.stdout(`${JSON.stringify({ written: o.out, accumulated, marker: parseMarker(body) })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
