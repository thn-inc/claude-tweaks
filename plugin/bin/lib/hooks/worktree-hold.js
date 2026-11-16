// bin/lib/hooks/worktree-hold.js — a "hold" is a small JSON file a session
// writes into a linked worktree's own git admin dir
// (`{gitdir}/claude-tweaks-holds/{key}.json`) to record that it is standing in
// that worktree, so a reaper running in another session can see the presence.
// Every function here is best-effort and never throws: a write or clear failure
// returns the empty value (false / null / 0), but readHolds fails closed — what
// it could not look at comes back as one unverifiable entry, never as no holds.
//
// Requires nothing from worktree-reap.js or context.js (the liveness predicate
// there requires this module; the reverse would be a cycle).
'use strict';
const fs = require('fs');
const path = require('path');
const { safeReal, nearestExistingDir, mainCheckoutRoot } = require('./worktree-detect');
const processProbe = require('../run-liveness/process-probe');
const { isPathContained } = require('../shared-primitives');
const { writeFileAtomic } = require('../atomic-write');

const HOLD_DIR_NAME = 'claude-tweaks-holds';
// A key part never contains `__` (the key's separator), so one part layout cannot
// be read as another's.
const SAFE_PART = /^[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/;

function isPid(n) { return Number.isInteger(n) && n > 0; }

// A whole key: `__`-joined parts, each a safe part (no path separator, no `..`).
function isKey(key) {
  return typeof key === 'string' && key.split('__').every((p) => SAFE_PART.test(p));
}

function unverifiable() { return [{ key: null, hold: null }]; }

function holdKey({ sessionId, agentId, pid } = {}) {
  try {
    if (typeof sessionId !== 'string' || !SAFE_PART.test(sessionId)) return null;
    const agent = agentId === undefined || agentId === null || agentId === '' ? 'main' : agentId;
    if (typeof agent !== 'string' || !SAFE_PART.test(agent)) return null;
    if (!isPid(pid)) return null;
    return `${sessionId}__${agent}__${pid}`;
  } catch {
    return null;
  }
}

// Where `wtPath`'s hold dir is: { dir } for a linked worktree; { none: true } for a
// checkout with no hold dir (no .git, a .git directory, or a gitdir not directly under a
// `worktrees` dir — a submodule's `.git/modules/<name>`); { unverifiable: true } when the
// .git entry exists but cannot be read or names no gitdir.
function locate(wtPath) {
  try {
    const gitPath = path.join(wtPath, '.git');
    let st;
    try {
      st = fs.statSync(gitPath);
    } catch (e) {
      return e && e.code === 'ENOENT' ? { none: true } : { unverifiable: true };
    }
    if (!st.isFile()) return { none: true };
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(gitPath, 'utf8'));
    // A .git file that names no gitdir: holds may live somewhere we cannot locate.
    if (!m) return { unverifiable: true };
    const admin = path.resolve(wtPath, m[1]);
    if (path.basename(path.dirname(admin)) !== 'worktrees') return { none: true };
    return { dir: path.join(admin, HOLD_DIR_NAME) };
  } catch {
    return { unverifiable: true };
  }
}

// The nearest `.git` at or above `p`: a FILE pointing into a `worktrees` admin dir means
// a linked worktree (return its directory); a directory, a submodule file, an unreadable
// entry, or none means null.
function worktreeRootOf(p) {
  try {
    let dir = nearestExistingDir(p);
    while (dir) {
      let st = null;
      try {
        st = fs.statSync(path.join(dir, '.git'));
      } catch (e) {
        if (!e || e.code !== 'ENOENT') return null;
      }
      if (st) return st.isFile() && locate(dir).dir ? safeReal(dir) : null;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

function holdDirOf(wtPath) {
  return locate(wtPath).dir || null;
}

function writeHold(wtPath, { key, block, agentId } = {}) {
  try {
    if (!isKey(key)) return false;
    const dir = holdDirOf(wtPath);
    if (!dir) return false;
    // Create the last level only: a pruned or non-directory admin dir fails here (ENOENT /
    // ENOTDIR) and is never resurrected.
    try { fs.mkdirSync(dir); } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
    const body = { ...block, agentId: agentId || null, worktree: wtPath, key };
    writeFileAtomic(path.join(dir, `${key}.json`), JSON.stringify(body));
    return true;
  } catch {
    return false;
  }
}

// [] only when the worktree has no hold dir. Anything that could not be looked at is one
// unverifiable entry ({ key: null, hold: null }), so a caller never reads "could not
// look" as "no holds".
function readHolds(wtPath) {
  try {
    const loc = locate(wtPath);
    if (loc.unverifiable) return unverifiable();
    if (!loc.dir) return [];
    let names;
    try {
      names = fs.readdirSync(loc.dir).sort();
    } catch (e) {
      return e && e.code === 'ENOENT' ? [] : unverifiable();
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      let hold = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(loc.dir, name), 'utf8'));
        if (parsed && typeof parsed === 'object') hold = parsed;
      } catch (e) {
        // Released between the listing and the read: no hold. Any other failure stays unverifiable.
        if (e && e.code === 'ENOENT') continue;
      }
      out.push({ key: name.slice(0, -'.json'.length), hold });
    }
    return out;
  } catch {
    return unverifiable();
  }
}

// Every `{mainRoot}/.git/worktrees/*/claude-tweaks-holds` directory. When `.git` is a
// file (mainRoot is itself a linked worktree), `.git/worktrees` is ENOTDIR: the read
// throws and the caller removes nothing.
function allHoldDirs(mainRoot) {
  const worktrees = path.join(mainRoot, '.git', 'worktrees');
  return fs.readdirSync(worktrees).map((n) => path.join(worktrees, n, HOLD_DIR_NAME));
}

function removeMatching(mainRoot, { except, matches }) {
  let removed = 0;
  let skip = null;
  if (except) {
    const exceptDir = holdDirOf(except);
    skip = exceptDir ? (safeReal(path.dirname(exceptDir)) || path.dirname(exceptDir)) : null;
  }
  let dirs;
  try { dirs = allHoldDirs(mainRoot); } catch { return 0; }
  for (const dir of dirs) {
    try {
      const admin = safeReal(path.dirname(dir)) || path.dirname(dir);
      if (skip && isPathContained(admin, skip, { orEqual: true }) && isPathContained(skip, admin, { orEqual: true })) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!matches(name)) continue;
        try { fs.unlinkSync(path.join(dir, name)); removed += 1; } catch { /* best effort */ }
      }
    } catch { /* this admin dir has no holds, or is unreadable */ }
  }
  return removed;
}

function clearHolds(mainRoot, { key, except } = {}) {
  try {
    if (!isKey(key)) return 0;
    return removeMatching(mainRoot, { except, matches: (name) => name === `${key}.json` });
  } catch {
    return 0;
  }
}

function clearSessionHolds(mainRoot, { sessionId, pid } = {}) {
  try {
    if (typeof sessionId !== 'string' || !SAFE_PART.test(sessionId) || !isPid(pid)) return 0;
    return removeMatching(mainRoot, {
      matches: (name) => {
        if (!name.endsWith('.json')) return false;
        const parts = name.slice(0, -'.json'.length).split('__');
        return parts.length === 3 && parts[0] === sessionId && SAFE_PART.test(parts[1]) && parts[2] === String(pid);
      },
    });
  } catch {
    return 0;
  }
}

// The hook-facing half. Each function below never throws; its return is a status string or
// count for tests, not a contract. `ownerBlock` is injected by the hook module (it lives in
// context.js, which this file must not require); the pid it reports is the same
// resolveOwnerPid answer the run-state writers stamp.

// Stamps `{sessionId, agentId}`'s hold in the worktree containing `where`, then clears the
// same key from every other worktree so the hold follows the session. 'failed' (distinct from
// 'skipped': not a linked worktree, or no valid key) means the worktree and key were valid but
// the write failed, so the session stands in that worktree unheld; the caller records it.
// `keyAgent` is the key's agent part when it differs from the block's `agentId`.
// `move: false` only adds the hold and leaves the same key where it already is.
function stampHold({ where, sessionId, agentId, keyAgent = agentId, move = true, env, ownerBlock }) {
  const wt = worktreeRootOf(where);
  if (!wt) return 'skipped';
  const block = ownerBlock({ sessionId, env });
  const key = holdKey({ sessionId, agentId: keyAgent, pid: block && block.pid });
  if (!key) return 'skipped';
  if (!writeHold(wt, { key, block, agentId })) return 'failed';
  if (!move) return 'stamped';
  const mainRoot = mainCheckoutRoot(wt);
  if (mainRoot) clearHolds(mainRoot, { key, except: wt });
  return 'stamped';
}

function syncHoldForToolUse(input, { cwd, env, ownerBlock, resolveEnteredPath } = {}) {
  try {
    const tool = input && input.tool_name;
    if (tool === 'EnterWorktree') {
      return stampHold({
        where: resolveEnteredPath() || cwd, sessionId: input.session_id, agentId: input.agent_id, env, ownerBlock,
      });
    }
    if (tool === 'ExitWorktree') {
      const key = holdKey({
        sessionId: input.session_id, agentId: input.agent_id, pid: processProbe.resolveOwnerPid(env).pid,
      });
      const mainRoot = key && mainCheckoutRoot(cwd);
      if (!mainRoot) return 'skipped';
      clearHolds(mainRoot, { key });
      return 'cleared';
    }
    return 'skipped';
  } catch {
    return 'skipped';
  }
}

// SessionStart: a "home" hold for the worktree the session starts (or resumes) in. Its own key
// (`home`, never `main`) so EnterWorktree's move and ExitWorktree's clear leave it: the session
// returns to its launch directory on exit, and a session standing in A with no hold is #4960.
// It only adds, never clears the home key elsewhere: compact/clear/resume re-fire SessionStart
// mid-session (possibly inside B), and every worktree stood in at a SessionStart stays held
// until SessionEnd clears them all. A resumed session has a new pid, so the old pid's holds
// read as dead; clearing the same key elsewhere buys nothing.
function stampHoldForCwd({ cwd, sessionId, env, ownerBlock } = {}) {
  try {
    return stampHold({ where: cwd, sessionId, agentId: undefined, keyAgent: 'home', move: false, env, ownerBlock });
  } catch {
    return 'skipped';
  }
}

// SessionEnd: every hold this session wrote under this process's pid, in any worktree.
function releaseSessionHolds({ cwd, sessionId, env, resolvePid } = {}) {
  try {
    const { pid } = (resolvePid || processProbe.resolveOwnerPid)(env);
    if (!isPid(pid)) return 0;
    const mainRoot = mainCheckoutRoot(cwd);
    return mainRoot ? clearSessionHolds(mainRoot, { sessionId, pid }) : 0;
  } catch {
    return 0;
  }
}

// SubagentStop: the finished subagent's own hold, never the still-live parent's.
function releaseAgentHolds({ cwd, sessionId, agentId, env, resolvePid } = {}) {
  try {
    if (!agentId) return 0;
    const { pid } = (resolvePid || processProbe.resolveOwnerPid)(env);
    const key = holdKey({ sessionId, agentId, pid });
    const mainRoot = key && mainCheckoutRoot(cwd);
    return mainRoot ? clearHolds(mainRoot, { key }) : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  HOLD_DIR_NAME, holdKey, worktreeRootOf, holdDirOf, writeHold, readHolds, clearHolds, clearSessionHolds,
  syncHoldForToolUse, stampHoldForCwd, releaseSessionHolds, releaseAgentHolds,
};
