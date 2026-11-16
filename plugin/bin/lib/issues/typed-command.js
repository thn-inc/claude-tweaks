// bin/lib/issues/typed-command.js
// The typed-dispatch prompt pointer (#5584). The UserPromptSubmit hook records,
// per record number, the prompt id of the last `/claude-tweaks:dispatch` line
// that named it, in `dispatch-prompts.json` under the session's temp root
// (bin/lib/session-tmp.js):
//
//   { "v": 1, "sessionId": "<id>", "records": { "<n>": { "promptId": "<id>", "at": "<ISO time>" } } }
//
// It is a pointer, not a proof: the hook cannot tell who sent a prompt, so a
// scheduled or delivered line writes it too, and anything in the session can
// write the file by hand. Authority comes only from the transcript row the
// pointer's prompt id names, checked by the reader Task 4 adds here; that
// reader requires `../timing/transcript` lazily, inside the function, never
// at load, so the hook that loads this file for `writePointer` stays cheap.
//
// The reader treats the file as untrusted: lstat first, a regular file of at
// most POINTER_MAX_BYTES only, never followed through a link. Each refusal
// carries its own reason word (`no-pointer`, `pointer-unreadable`,
// `pointer-other-session`, `no-session-id`), so "absent" never reads like
// "could not read".
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sessionTmpRoot } = require('../session-tmp');

const POINTER_FILE = 'dispatch-prompts.json';
const TYPED_DISPATCH_MAX_AGE_MS = 30 * 60 * 1000;
const POINTER_MAX_BYTES = 65536;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function isWellFormedId(s) {
  return typeof s === 'string' && ID_RE.test(s);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// file -> { status: 'absent' } | { status: 'unreadable' } | { status: 'ok', value }.
// Only ENOENT on the lstat is absent; any other error, a non-regular file
// (a link included) or an oversize file is unreadable. The open carries
// O_NOFOLLOW where the platform has it and the opened descriptor is checked
// again, so a link swapped in after the lstat is not read through either.
function readPointerFile(file, fsImpl) {
  let st;
  try {
    st = fsImpl.lstatSync(file);
  } catch (err) {
    return { status: err && err.code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
  if (!st.isFile() || st.size > POINTER_MAX_BYTES) return { status: 'unreadable' };
  let fd = null;
  try {
    fd = fsImpl.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const fst = fsImpl.fstatSync(fd);
    if (!fst.isFile() || fst.size > POINTER_MAX_BYTES) return { status: 'unreadable' };
    const buf = Buffer.alloc(POINTER_MAX_BYTES + 1);
    let len = 0;
    for (;;) {
      const n = fsImpl.readSync(fd, buf, len, buf.length - len, null);
      if (n === 0) break;
      len += n;
      if (len > POINTER_MAX_BYTES) return { status: 'unreadable' };
    }
    const value = JSON.parse(buf.toString('utf8', 0, len));
    if (!isPlainObject(value) || value.v !== 1 || !isPlainObject(value.records)) return { status: 'unreadable' };
    return { status: 'ok', value };
  } catch {
    return { status: 'unreadable' };
  } finally {
    if (fd !== null) {
      try { fsImpl.closeSync(fd); } catch { /* the read's answer stands */ }
    }
  }
}

// Records each number's prompt id and time, replacing that number's entry and
// keeping every other entry of this session's pointer. Refuses (false, nothing
// written) on a malformed id, number list or time. Never throws.
function writePointer({ sessionId, promptId, numbers, now, tmpdir = os.tmpdir(), fsImpl = fs } = {}) {
  let tmp = null;
  try {
    if (!isWellFormedId(sessionId) || !isWellFormedId(promptId)) return false;
    if (!Array.isArray(numbers) || numbers.length === 0) return false;
    if (!numbers.every((n) => Number.isInteger(n) && n > 0)) return false;
    // An invalid time throws RangeError here, before any fs call: refused.
    const at = new Date(now).toISOString();

    const root = sessionTmpRoot(sessionId, { tmpdir });
    const file = path.join(root, POINTER_FILE);
    const existing = readPointerFile(file, fsImpl);
    const records = existing.status === 'ok' && existing.value.sessionId === sessionId ? existing.value.records : {};
    for (const n of numbers) records[String(n)] = { promptId, at };

    fsImpl.mkdirSync(root, { recursive: true });
    tmp = path.join(root, `${POINTER_FILE}.${process.pid}.tmp`);
    try { fsImpl.unlinkSync(tmp); } catch { /* absent is the usual case */ }
    // 'wx' never writes through a link planted at the temp name.
    fsImpl.writeFileSync(tmp, JSON.stringify({ v: 1, sessionId, records }), { flag: 'wx', mode: 0o600 });
    fsImpl.renameSync(tmp, file);
    tmp = null;
    return true;
  } catch {
    if (tmp) {
      try { fsImpl.unlinkSync(tmp); } catch { /* nothing more to undo */ }
    }
    return false;
  }
}

// One record's pointer entry, or the reason there is none. The caller supplies
// the session id; a malformed one answers no-session-id before any fs call.
function readPointer({ sessionId, number, tmpdir = os.tmpdir(), fsImpl = fs } = {}) {
  if (!isWellFormedId(sessionId)) return { ok: false, reason: 'no-session-id' };
  const file = path.join(sessionTmpRoot(sessionId, { tmpdir }), POINTER_FILE);
  const read = readPointerFile(file, fsImpl);
  if (read.status === 'absent') return { ok: false, reason: 'no-pointer' };
  if (read.status !== 'ok') return { ok: false, reason: 'pointer-unreadable' };
  const { value } = read;
  if (value.sessionId !== sessionId) return { ok: false, reason: 'pointer-other-session' };
  const key = String(number);
  if (!Object.prototype.hasOwnProperty.call(value.records, key)) return { ok: false, reason: 'no-pointer' };
  const entry = value.records[key];
  if (!isPlainObject(entry) || !isWellFormedId(entry.promptId)) return { ok: false, reason: 'pointer-unreadable' };
  if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) return { ok: false, reason: 'pointer-unreadable' };
  return { ok: true, promptId: entry.promptId, at: entry.at };
}

module.exports = {
  POINTER_FILE,
  TYPED_DISPATCH_MAX_AGE_MS,
  POINTER_MAX_BYTES,
  isWellFormedId,
  writePointer,
  readPointer,
};
