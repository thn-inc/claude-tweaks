// bin/lib/hooks/contract-retries.js
//
// Session-scoped, per-agent one-retry-cap counter for the Subagent Contract's
// forced in-run retry (#1936 Task 0 confirmed SubagentStop's JSON output
// supports `{ decision: 'block', reason }`, which keeps a subagent running
// and delivers `reason` as its next instruction). Mirrors
// bin/lib/model-profiles/session-failures.js's session-scoped blacklist-file
// convention exactly: one file per session under os.tmpdir(), keyed by
// CLAUDE_CODE_SESSION_ID, members are strings (here, agent ids that have
// already been offered their one forced retry).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');

function resolveSessionId(sessionId) {
  return sessionId && String(sessionId).trim() ? String(sessionId).trim() : null;
}

function retriesPath(sessionId) {
  const id = resolveSessionId(sessionId);
  if (!id) return null;
  return path.join(os.tmpdir(), `ct-contract-retries-${id}.json`);
}

// -> Set<string> of agent ids already offered their one forced retry this
// session. Any read failure (missing file, malformed JSON) degrades to an
// empty set — a corrupt or absent counter must never itself cause a retry
// loop; it can only fail to prevent one extra retry.
function readRetried(sessionId) {
  const p = retriesPath(sessionId);
  if (!p) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

// Marks `agentId` as having been offered its one forced retry. Returns
// `true` on a successful write, `false` on any failure (no session id, no
// agent id, or the write itself throwing) — the caller treats a `false`
// return exactly like "already retried": a broken tmp dir must never be the
// reason a violating subagent gets blocked twice, since that risks looping
// forever if the subagent keeps failing to comply.
function recordRetry(sessionId, agentId) {
  const p = retriesPath(sessionId);
  if (!p || !agentId) return false;
  try {
    const current = readRetried(sessionId);
    current.add(agentId);
    writeFileAtomic(p, JSON.stringify([...current]));
    return true;
  } catch {
    return false;
  }
}

module.exports = { retriesPath, readRetried, recordRetry };
