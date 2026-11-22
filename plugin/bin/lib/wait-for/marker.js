'use strict';

// The per-session files `wait-for.js` coordinates through, in the OS temp dir:
//
//   ct-agent-stops-{sessionId}.jsonl   one line per SubagentStop event:
//       {"agentId":"…","at":<epoch seconds>,"blocked":<bool>,"pending":<int|null>}
//   ct-agent-waits-{sessionId}.jsonl   one line per wait-record event:
//       {"kind":"open","window","target","key","openedAt","deadline","n"[,"ids"]}
//       {"kind":"close","window","reason":"deadline"|"done"}
//       {"kind":"delivered","agentId","stop","claim"}   claim: the appending call's random token
//
// Lines are appended and never rewritten. Nothing deletes either file — the OS
// clears its temp directory. The stop line's field meanings are a contract
// between plugin/bin/lib/hooks/subagent-stop.js (the writer) and
// plugin/bin/lib/wait-for/index.js (the reader) — #5066 and #5543 edit the hook.
//
// The session id is interpolated into a file name, so it is validated against
// SESSION_ID_RE; an id outside it yields no path. Both files are opened without
// following a final-component symlink, and readers refuse anything that is not
// a plain file before opening it (a FIFO would block the open).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { lstatType } = require('../path-guard');

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

class MarkerFileError extends Error {
  constructor(reason, filePath) {
    super(`marker file ${filePath} refused: ${reason}`);
    this.name = 'MarkerFileError';
    this.path = filePath;
    this.reason = reason;
  }
}

function validId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId);
}

function stopsPath(sessionId, { tmpDir = os.tmpdir() } = {}) {
  return validId(sessionId) ? path.join(tmpDir, 'ct-agent-stops-' + sessionId + '.jsonl') : null;
}

function waitsPath(sessionId, { tmpDir = os.tmpdir() } = {}) {
  return validId(sessionId) ? path.join(tmpDir, 'ct-agent-waits-' + sessionId + '.jsonl') : null;
}

function formatStop({ agentId, at, blocked, pending }) {
  return JSON.stringify({ agentId, at, blocked, pending }) + '\n';
}

// The file names are predictable and live in a temp dir another user may share,
// so a file that user created first is refused on both sides: the reader would
// take forged final-stop lines for ours, and the writer would hand ours to them.
// A platform with no process.getuid (Windows) has per-user temp dirs and skips it.
function foreignOwner(st) {
  return typeof process.getuid === 'function' && BigInt(st.uid) !== BigInt(process.getuid());
}

// One writeSync of one line to an append-only, no-follow fd. A missing
// O_NOFOLLOW (Windows) contributes 0. O_NONBLOCK makes a FIFO with no reader
// fail with ENXIO instead of hanging the caller; regular files ignore it.
function appendLine(p, line, constants) {
  const flags =
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  const fd = fs.openSync(p, flags, 0o600);
  try {
    if (foreignOwner(fs.fstatSync(fd))) throw new MarkerFileError('not-owned', p);
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function appendStop(sessionId, stop, { tmpDir, constants = fs.constants } = {}) {
  const p = stopsPath(sessionId, { tmpDir });
  if (p === null) return false;
  return appendLine(p, formatStop(stop), constants);
}

function appendWait(sessionId, record, { tmpDir, constants = fs.constants } = {}) {
  const p = waitsPath(sessionId, { tmpDir });
  if (p === null) return false;
  return appendLine(p, JSON.stringify(record) + '\n', constants);
}

// Parsed lines of the file at `p` as `{ index, value }`, index being the
// 0-based line position (unparseable lines keep their position but are
// omitted). `[]` when the file is missing.
function readLines(p, constants) {
  const leaf = lstatType(p);
  if (leaf.type === 'missing') return [];
  if (leaf.type === 'symlink') throw new MarkerFileError('symlink', p);
  if (leaf.type === 'unreadable') throw new MarkerFileError('unreadable', p);
  if (leaf.type !== 'file') throw new MarkerFileError('not-a-file', p);

  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  let fd;
  try {
    fd = fs.openSync(p, flags);
  } catch (err) {
    throw new MarkerFileError(err && err.code === 'ELOOP' ? 'symlink' : 'unreadable', p);
  }
  let text;
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    let current;
    try {
      current = fs.lstatSync(p, { bigint: true });
    } catch (_err) {
      throw new MarkerFileError('replaced', p);
    }
    if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new MarkerFileError('replaced', p);
    }
    if (foreignOwner(opened)) throw new MarkerFileError('not-owned', p);
    text = fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }

  const pieces = text.split(/\r?\n/);
  if (pieces.length && pieces[pieces.length - 1] === '') pieces.pop();
  const out = [];
  pieces.forEach((piece, index) => {
    try {
      out.push({ index, value: JSON.parse(piece) });
    } catch (_err) {
      // a torn or non-JSON line is skipped; its position is still counted
    }
  });
  return out;
}

function requireId(sessionId) {
  if (!validId(sessionId)) throw new TypeError('invalid session id');
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0;

function validStop(v) {
  return (
    isObj(v) &&
    isNonEmptyStr(v.agentId) &&
    typeof v.at === 'number' &&
    Number.isFinite(v.at) &&
    typeof v.blocked === 'boolean' &&
    (v.pending === null || (Number.isInteger(v.pending) && v.pending >= 0))
  );
}

function validWait(v) {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case 'open':
      return (
        isStr(v.window) &&
        isStr(v.target) &&
        isStr(v.key) &&
        Number.isInteger(v.openedAt) &&
        Number.isInteger(v.deadline) &&
        Number.isInteger(v.n) &&
        (v.target !== 'agents' || (Array.isArray(v.ids) && v.ids.every(isNonEmptyStr)))
      );
    case 'close':
      return isStr(v.window) && (v.reason === 'deadline' || v.reason === 'done');
    case 'delivered':
      return isNonEmptyStr(v.agentId) && Number.isInteger(v.stop) && v.stop >= 0;
    default:
      return false;
  }
}

function readStops(sessionId, { tmpDir, constants = fs.constants } = {}) {
  requireId(sessionId);
  const stops = readLines(stopsPath(sessionId, { tmpDir }), constants)
    .filter(({ value }) => validStop(value))
    .map(({ index, value }) => ({
      index,
      agentId: value.agentId,
      at: value.at,
      blocked: value.blocked,
      pending: value.pending,
    }));
  return { stops, count: stops.length };
}

function readWaits(sessionId, { tmpDir, constants = fs.constants } = {}) {
  requireId(sessionId);
  return readLines(waitsPath(sessionId, { tmpDir }), constants)
    .filter(({ value }) => validWait(value))
    .map(({ index, value }) => ({ ...value, index }));
}

function isFinalStop(stop) {
  return stop.blocked === false && stop.pending === 0;
}

module.exports = {
  SESSION_ID_RE,
  stopsPath,
  waitsPath,
  formatStop,
  appendStop,
  appendWait,
  readStops,
  readWaits,
  isFinalStop,
  MarkerFileError,
};
