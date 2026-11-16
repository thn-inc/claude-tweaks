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
const { safeReal, nearestExistingDir } = require('./worktree-detect');
const { isPathContained } = require('../shared-primitives');

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
// checkout with no hold dir (no .git, a .git directory, no gitdir line, or a gitdir not
// directly under a `worktrees` dir — a submodule's `.git/modules/<name>`);
// { unverifiable: true } when the .git entry exists but cannot be read.
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
    if (!m) return { none: true };
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
    // Create the last level only: a pruned admin dir must not be resurrected.
    if (!fs.statSync(path.dirname(dir)).isDirectory()) return false;
    try { fs.mkdirSync(dir); } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
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
      } catch { /* unreadable or unparseable: hold stays null */ }
      out.push({ key: name.slice(0, -'.json'.length), hold });
    }
    return out;
  } catch {
    return unverifiable();
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
        return parts.length === 3 && parts[0] === sessionId && parts[2] === String(pid);
      },
    });
  } catch {
    return 0;
  }
}

module.exports = {
  HOLD_DIR_NAME, holdKey, worktreeRootOf, holdDirOf, writeHold, readHolds, clearHolds, clearSessionHolds,
};
