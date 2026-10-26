'use strict';

// Close-out update marker — parse, serialise and accumulate the
// `close-out-update` PR run comment.
//
// Implements the contract in skills/dispatch/close-out-update.md's "Update
// marker" section; #4331 moved its parsing and validation rules out of skill
// prose and into this module. Pure: no I/O, no process state.
//
// Parsing is tolerant of trailing whitespace (a GitHub web UI edit can turn a
// line ending into CRLF) and strict about everything else. A field that fails
// validation reads 'unknown' — never a thrown error, never a value that was
// not checked — because a comment body is untrusted text that later reaches
// shell commands.

const MARKER_LINE = '<!-- run-comment: close-out-update -->';
const UPDATE_METHODS = Object.freeze(['merge', 'gh pr update-branch']);

const PENDING_LINE = 'close-out-update: pending';
const CLEARED_RE = /^close-out-update: cleared \(.*\)$/;
const SHA_RE = /^[0-9a-f]{40}$/i;

// The template's explanatory paragraph, copied byte-for-byte from
// close-out-update.md.
const EXPLANATION =
  'While this reads `pending`, close-out has pushed an update to this PR whose head had not passed a full-suite verify and CI when it was written; a close-out run from any checkout re-verifies the head before the merge question.';

function unreadable() {
  return {
    status: 'unreadable',
    updateMethod: 'unknown',
    conflictedFiles: 'unknown',
    preUpdateHead: 'unknown',
    resolutionCommits: 'unknown',
  };
}

// The value of the first line in `lines` that starts with `{key}: `, else null.
function fieldValue(lines, key) {
  const prefix = `${key}: `;
  const line = lines.find((l) => l.startsWith(prefix));
  return line === undefined ? null : line.slice(prefix.length).trim();
}

function splitList(value) {
  return value.split(',').map((s) => s.trim());
}

function parseUpdateMethod(value) {
  if (value === null) return 'unknown';
  const entries = splitList(value);
  return entries.every((e) => UPDATE_METHODS.includes(e)) ? entries : 'unknown';
}

function parseConflictedFiles(value) {
  if (value === null) return 'unknown';
  if (value === 'none') return [];
  if (value === 'unknown') return 'unknown';
  const entries = splitList(value);
  return entries.some((e) => e === '') ? 'unknown' : entries;
}

function parsePreUpdateHead(value) {
  return value !== null && SHA_RE.test(value) ? value.toLowerCase() : 'unknown';
}

function parseResolutionCommits(value) {
  if (value === null) return 'unknown';
  const entries = splitList(value).map((e) => (SHA_RE.test(e) ? e.toLowerCase() : e));
  return entries.every((e) => e === 'pending' || SHA_RE.test(e)) ? entries : 'unknown';
}

function parseMarker(body) {
  if (typeof body !== 'string') return unreadable();
  const lines = body.split(/\r?\n/).map((l) => l.trimEnd());
  if (lines[0] !== MARKER_LINE) return unreadable();

  let status;
  if (lines[1] === PENDING_LINE) status = 'pending';
  else if (typeof lines[1] === 'string' && CLEARED_RE.test(lines[1])) status = 'cleared';
  else return unreadable();

  // Fields: the lines after line 2, up to the first blank line.
  const rest = lines.slice(2);
  const blank = rest.indexOf('');
  const block = blank === -1 ? rest : rest.slice(0, blank);

  return {
    status,
    updateMethod: parseUpdateMethod(fieldValue(block, 'update-method')),
    conflictedFiles: parseConflictedFiles(fieldValue(block, 'conflicted-files')),
    preUpdateHead: parsePreUpdateHead(fieldValue(block, 'pre-update-head')),
    resolutionCommits: parseResolutionCommits(fieldValue(block, 'resolution-commit')),
  };
}

function joinList(value) {
  return value === 'unknown' ? 'unknown' : value.join(', ');
}

function conflictedFilesText(conflicted) {
  if (conflicted === 'unknown') return 'unknown';
  if (conflicted.length === 0) return 'none';
  return conflicted.join(', ');
}

function serializeMarker(fields) {
  const conflictedText = conflictedFilesText(fields.conflictedFiles);
  return [
    MARKER_LINE,
    PENDING_LINE,
    `update-method: ${joinList(fields.updateMethod)}`,
    `conflicted-files: ${conflictedText}`,
    `pre-update-head: ${fields.preUpdateHead}`,
    `resolution-commit: ${joinList(fields.resolutionCommits)}`,
    '',
    EXPLANATION,
    '',
  ].join('\n');
}

// Fold one more update into a pending marker's fields: method and resolution
// commit entries append (oldest first), conflicted files union in first-seen
// order, pre-update-head is replaced. An 'unknown' side stays 'unknown'.
function appendUpdate(pending, update) {
  const append = (existing, entry) => (existing === 'unknown' ? 'unknown' : [...existing, entry]);
  let conflictedFiles;
  if (pending.conflictedFiles === 'unknown' || update.conflictedFiles === 'unknown') {
    conflictedFiles = 'unknown';
  } else {
    conflictedFiles = [...new Set([...pending.conflictedFiles, ...update.conflictedFiles])];
  }
  return {
    updateMethod: append(pending.updateMethod, update.updateMethod),
    conflictedFiles,
    preUpdateHead: update.preUpdateHead,
    resolutionCommits: append(pending.resolutionCommits, update.resolutionCommit),
  };
}

// Replace the last 'pending' resolution-commit entry with `sha`; null when
// there is none to replace.
function resolvePendingCommit(fields, sha) {
  const commits = fields.resolutionCommits;
  if (commits === 'unknown') return null;
  const at = commits.lastIndexOf('pending');
  if (at === -1) return null;
  const next = [...commits];
  next[at] = sha;
  return { ...fields, resolutionCommits: next };
}

module.exports = {
  MARKER_LINE,
  UPDATE_METHODS,
  SHA_RE,
  parseMarker,
  serializeMarker,
  appendUpdate,
  resolvePendingCommit,
};
