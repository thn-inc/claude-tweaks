// bin/lib/session-tmp.js
// Session-scoped temp-root convention (#266) — a single canonical root
// directory every skill's own non-snapshot temp state (composed bodies,
// payload files, queue-pull results) lands under, keyed by
// CLAUDE_CODE_SESSION_ID, so two concurrent sessions of the same skill never
// collide on a shared /tmp/{skill}-{thing} filename. Reuses the same
// session-identifying value bin/lib/issues/record-snapshot.js already
// established as reachable from skill-snippet execution (#645) — this is the
// general-purpose sibling of that file's single-purpose snapshot path. No
// network, no gh/MCP calls — pure filesystem helpers only.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
// Imported, not copy-pasted — the two files must never silently drift on what
// counts as a valid session id (both fs/path/os-only, no network pulled in).
const { resolveSessionId } = require('./issues/record-snapshot');

// The temp directory resolved from `env` the way os.tmpdir() does: win32 reads TEMP, TMP, then
// SystemRoot\temp and ignores TMPDIR; POSIX reads TMPDIR, TMP, TEMP, then /tmp. An absent `env`
// (or one naming no directory) falls back to os.tmpdir().
function envTmpdir(env, platform = process.platform) {
  if (!env) return os.tmpdir();
  const win = platform === 'win32';
  const sysRoot = env.SystemRoot || env.windir;
  let t = win ? env.TEMP || env.TMP || (sysRoot ? sysRoot + '\\temp' : '') : env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  if (!t) return os.tmpdir();
  const sep = win ? '\\' : '/';
  if (t.length > 1 && t.endsWith(sep) && !(win && t.endsWith(':' + sep))) t = t.slice(0, -1);
  return t;
}

// sessionId -> this session's temp root directory, or null when no session
// id is available. Mirrors record-snapshot.js's snapshotPath degrade rule:
// callers fall through to an unscoped path rather than erroring.
function sessionTmpRoot(sessionId, { tmpdir = os.tmpdir() } = {}) {
  const id = resolveSessionId(sessionId);
  if (!id) return null;
  return path.join(tmpdir, `ct-session-${id}`);
}

// sessionId, filename -> the full path for one purpose-suffixed file under
// this session's root (creating the root directory if needed), or null when
// no session id is available. `filename` keeps the exact basename each
// skill already uses today (e.g. 'specify-parent-body.md') -- the root
// directory is what changes, not each call site's own per-purpose naming.
// Never throws on a pre-existing root (mkdir recursive is idempotent).
function sessionTmpPath(sessionId, filename, { tmpdir = os.tmpdir() } = {}) {
  const root = sessionTmpRoot(sessionId, { tmpdir });
  if (!root) return null;
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, filename);
}

module.exports = { resolveSessionId, envTmpdir, sessionTmpRoot, sessionTmpPath };
