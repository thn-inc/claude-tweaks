// bin/lib/hooks/worktree-hold.js — a "hold" is a small JSON file a session
// writes into a linked worktree's own git admin dir
// (`{gitdir}/claude-tweaks-holds/{key}.json`) to record that it is standing in
// that worktree, so a reaper running in another session can see the presence.
// Every function here is best-effort and never throws: a failure returns the
// empty value (false / null / [] / 0) and the caller carries on.
//
// Requires nothing from worktree-reap.js or context.js (the liveness predicate
// there requires this module; the reverse would be a cycle).
'use strict';
const fs = require('fs');
const path = require('path');
const { safeReal, nearestExistingDir } = require('./worktree-detect');
const { isPathContained } = require('../shared-primitives');

const HOLD_DIR_NAME = 'claude-tweaks-holds';
const SAFE_PART = /^[A-Za-z0-9_-]+$/;

function isPid(n) { return Number.isInteger(n) && n > 0; }

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

// The nearest `.git` at or above `p`: a FILE means a linked worktree (return its
// directory); a directory, an unreadable entry, or none means null.
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
      if (st) return st.isFile() ? safeReal(dir) : null;
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
  try {
    const gitPath = path.join(wtPath, '.git');
    if (!fs.statSync(gitPath).isFile()) return null;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(gitPath, 'utf8'));
    if (!m) return null;
    return path.join(path.resolve(wtPath, m[1]), HOLD_DIR_NAME);
  } catch {
    return null;
  }
}

function writeHold(wtPath, { key, block, agentId } = {}) {
  try {
    if (typeof key !== 'string' || !SAFE_PART.test(key.replace(/__/g, '_'))) return false;
    const dir = holdDirOf(wtPath);
    if (!dir) return false;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${key}.json`);
    const tmp = `${file}.tmp-${process.pid}`;
    const body = { ...block, agentId: agentId || null, worktree: wtPath, key };
    try {
      fs.writeFileSync(tmp, JSON.stringify(body));
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw e;
    }
    return true;
  } catch {
    return false;
  }
}

function readHolds(wtPath) {
  try {
    const dir = holdDirOf(wtPath);
    if (!dir) return [];
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.json')) continue;
      let hold = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (parsed && typeof parsed === 'object') hold = parsed;
      } catch { /* unreadable or unparseable: hold stays null */ }
      out.push({ key: name.slice(0, -'.json'.length), hold });
    }
    return out;
  } catch {
    return [];
  }
}

// Every `{mainRoot}/.git/worktrees/*/claude-tweaks-holds` directory.
function allHoldDirs(mainRoot) {
  const worktrees = path.join(mainRoot, '.git', 'worktrees');
  if (!fs.statSync(path.join(mainRoot, '.git')).isDirectory()) return [];
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
    if (typeof key !== 'string' || !SAFE_PART.test(key.replace(/__/g, '_'))) return 0;
    return removeMatching(mainRoot, { except, matches: (name) => name === `${key}.json` });
  } catch {
    return 0;
  }
}

function clearSessionHolds(mainRoot, { sessionId, pid } = {}) {
  try {
    if (typeof sessionId !== 'string' || !SAFE_PART.test(sessionId) || !isPid(pid)) return 0;
    const prefix = `${sessionId}__`;
    const suffix = `__${pid}.json`;
    return removeMatching(mainRoot, {
      matches: (name) => name.length > prefix.length + suffix.length && name.startsWith(prefix) && name.endsWith(suffix),
    });
  } catch {
    return 0;
  }
}

module.exports = {
  HOLD_DIR_NAME, holdKey, worktreeRootOf, holdDirOf, writeHold, readHolds, clearHolds, clearSessionHolds,
};
