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
// pointer's prompt id names, checked by readTypedCommand below; it requires
// `../timing/transcript` and `./build-authority` lazily, inside the function,
// never at load, so the hook that loads this file for `writePointer` stays cheap.
//
// Two concurrent writes are last-rename-wins: each rewrites the whole file
// from its own read, so one write's entries can drop the other's. A prompt
// hook runs once per prompt, in order, so this does not arise in practice.
//
// The reader treats the file as untrusted: lstat first, a regular file of at
// most POINTER_MAX_BYTES only, never followed through a link. Each refusal
// carries its own reason word (`no-pointer`, `pointer-unreadable`,
// `pointer-other-session`, `no-session-id`), so "absent" never reads like
// "could not read".
//
// readTypedCommand({ number, env, now, tmpdir, homeDir, fsImpl, readRows, locate })
// -> { answer: 'typed', promptId } | { answer: 'none', reason }. The steps run
// in order and the first that fails is the answer:
//
//   | Step | Requirement                                                     | Reason when it fails        |
//   |------|-----------------------------------------------------------------|-----------------------------|
//   | 1    | env.CLAUDE_CODE_SESSION_ID is 1-64 chars of [A-Za-z0-9-]          | no-session-id               |
//   | 2-4  | readPointer finds this session's entry for the record           | its own reason word         |
//   | 5    | the entry's `at` is not later than now nor older than the bound | expired                     |
//   | 6    | locateTranscripts by session id alone (no cwd) finds exactly one | no-transcript               |
//   |      | file, named <sessionId>.jsonl                                   |                             |
//   | 7    | the file reads to its end                                       | transcript-unreadable       |
//   | 8    | at least one candidate row (isCandidateRow)                     | no-prompt-row               |
//   | 9    | a candidate passes markers, command and time                    | expired / other-command /   |
//   |      | (command: the row's ARGS hold no line terminator and no         | not-typed                   |
//   |      | surrounding whitespace, else other-command)                     |                             |
//
// Step 9's reason: `expired` when a candidate passed markers and command,
// else `other-command` when one passed markers, else `not-typed`. The command,
// record and time are read from the row, never from the pointer.
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

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

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
  let file;
  try {
    file = path.join(sessionTmpRoot(sessionId, { tmpdir }), POINTER_FILE);
  } catch {
    return { ok: false, reason: 'pointer-unreadable' };
  }
  const read = readPointerFile(file, fsImpl);
  if (read.status === 'absent') return { ok: false, reason: 'no-pointer' };
  if (read.status !== 'ok') return { ok: false, reason: 'pointer-unreadable' };
  const { value } = read;
  if (value.sessionId !== sessionId) return { ok: false, reason: 'pointer-other-session' };
  const key = String(number);
  if (!hasOwn(value.records, key)) return { ok: false, reason: 'no-pointer' };
  const entry = value.records[key];
  if (!isPlainObject(entry) || !isWellFormedId(entry.promptId)) return { ok: false, reason: 'pointer-unreadable' };
  if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) return { ok: false, reason: 'pointer-unreadable' };
  return { ok: true, promptId: entry.promptId, at: entry.at };
}

// The command form, the human markers below and SCHEDULE_KEYS are observed rows, not a documented
// Claude Code contract: docs/hooks.md ("The typed-dispatch pointer", the probe table, the transcript
// fields) holds the evidence and tools/typed-command-probe.js re-runs it after a Claude Code upgrade.
// A drift refuses every typed dispatch (not-typed / other-command), never widens it.
const COMMAND_HEAD = '<command-message>claude-tweaks:dispatch</command-message>\n'
  + '<command-name>/claude-tweaks:dispatch</command-name>\n<command-args>';
const COMMAND_TAIL = '</command-args>';
const DISPATCH_LINE = '/claude-tweaks:dispatch ';
const SCHEDULE_KEYS = ['scheduledTaskId', 'scheduledFireId', 'wakeupSource', 'queueSkipSlashCommands'];

// A line of this prompt and session on the main thread, written as the user,
// that is not a tool result.
function isCandidateRow(row, { sessionId, promptId } = {}) {
  if (!isPlainObject(row) || row.type !== 'user') return false;
  if (row.promptId !== promptId || row.sessionId !== sessionId || row.isSidechain === true) return false;
  const msg = row.message;
  if (!isPlainObject(msg) || msg.role !== 'user') return false;
  return !(Array.isArray(msg.content) && msg.content.some((b) => isPlainObject(b) && b.type === 'tool_result'));
}

// The transcript marks the row as typed by a person. `isMeta` and `promptSource` may be absent because
// the typed command row (probe case (a)) carries neither; a present wrong value refuses. The scheduled
// (g) and delivered (h) rows carry SCHEDULE_KEYS, so a version that marked one human is still refused.
function rowMarkersPass(row) {
  if (!isPlainObject(row)) return false;
  if (row.turnOrigin !== 'human') return false;
  if (!isPlainObject(row.origin) || row.origin.kind !== 'human') return false;
  if (hasOwn(row, 'isMeta') && row.isMeta !== false) return false;
  if (hasOwn(row, 'promptSource') && row.promptSource !== 'typed') return false;
  return !SCHEDULE_KEYS.some((k) => hasOwn(row, k));
}

// The row's content is, whole, the dispatch command form with one line of
// arguments, and those arguments name `number`. Prefix/suffix checks, no
// regex, so a huge content string costs one pass.
function rowCommandNames(row, number) {
  if (!isPlainObject(row) || !isPlainObject(row.message)) return false;
  const content = row.message.content;
  if (typeof content !== 'string') return false;
  if (content.length < COMMAND_HEAD.length + COMMAND_TAIL.length) return false;
  if (!content.startsWith(COMMAND_HEAD) || !content.endsWith(COMMAND_TAIL)) return false;
  const args = content.slice(COMMAND_HEAD.length, content.length - COMMAND_TAIL.length);
  // One line, nothing around it: no line terminator, no surrounding
  // whitespace (no captured row has either; the stricter reading wins).
  if (args.includes('\n') || args.includes('\r') || args !== args.trim()) return false;
  const { parseTypedDispatch } = require('./build-authority');
  const numbers = parseTypedDispatch(DISPATCH_LINE + args);
  return Array.isArray(numbers) && numbers.includes(number);
}

function withinBound(ms, nowMs) {
  return Number.isFinite(ms) && Number.isFinite(nowMs) && ms <= nowMs && nowMs - ms <= TYPED_DISPATCH_MAX_AGE_MS;
}

const none = (reason) => ({ answer: 'none', reason });

// The proof of typing for one record. The table in the header is the order.
// The transcript is found by the session id alone, never by a working
// directory or a path from the pointer.
function readTypedCommand({ number, env, now, tmpdir = os.tmpdir(), homeDir = os.homedir(), fsImpl = fs, readRows, locate } = {}) {
  const nowMs = new Date(now).getTime();
  const sessionId = isPlainObject(env) ? env.CLAUDE_CODE_SESSION_ID : undefined;
  if (!isWellFormedId(sessionId)) return none('no-session-id');

  const pointer = readPointer({ sessionId, number, tmpdir, fsImpl });
  if (!pointer.ok) return none(pointer.reason);
  const { promptId } = pointer;
  if (!withinBound(Date.parse(pointer.at), nowMs)) return none('expired');

  const transcript = require('../timing/transcript');
  const configDir = typeof env.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR !== ''
    ? env.CLAUDE_CONFIG_DIR
    : path.join(homeDir, '.claude');
  let found;
  try {
    found = (locate || transcript.locateTranscripts)({ sessionId, configDir, homeDir, fsImpl });
    if (!Array.isArray(found) || found.length !== 1 || path.basename(found[0].path) !== `${sessionId}.jsonl`) {
      return none('no-transcript');
    }
  } catch {
    return none('no-transcript');
  }

  let rows;
  try {
    // `keep` drops the turn's tool-result rows while reading, so they are never held (they share the prompt id).
    rows = (readRows || transcript.readPromptRows)(found[0].path, promptId, { fsImpl, keep: (row) => isCandidateRow(row, { sessionId, promptId }) });
  } catch {
    return none('transcript-unreadable');
  }
  if (!Array.isArray(rows)) return none('transcript-unreadable');

  const candidates = rows.filter((row) => isCandidateRow(row, { sessionId, promptId }));
  if (candidates.length === 0) return none('no-prompt-row');

  let markersAndCommand = false;
  let markers = false;
  for (const row of candidates) {
    if (!rowMarkersPass(row)) continue;
    markers = true;
    if (!rowCommandNames(row, number)) continue;
    markersAndCommand = true;
    if (typeof row.timestamp === 'string' && withinBound(Date.parse(row.timestamp), nowMs)) {
      return { answer: 'typed', promptId };
    }
  }
  if (markersAndCommand) return none('expired');
  return none(markers ? 'other-command' : 'not-typed');
}

module.exports = {
  POINTER_FILE,
  TYPED_DISPATCH_MAX_AGE_MS,
  POINTER_MAX_BYTES,
  isWellFormedId,
  writePointer,
  readPointer,
  isCandidateRow,
  rowMarkersPass,
  rowCommandNames,
  readTypedCommand,
};
