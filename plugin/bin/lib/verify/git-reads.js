// Per-process answers to verify.js's read-only git questions: where the checkout
// is (toplevel, git dir, common dir), what HEAD is, and whether the tree is dirty.
//
// Contract: the answers live in this object's memory for one invocation and are
// never written to disk. There is deliberately no filesystem signature (the
// mtime/stat check #5294's cross-process cache needs): every point where the
// invocation can change the answers (a suite run, a stamp, a baseline checkout)
// is inside this one process and is named by the caller, which calls
// `invalidate()` there. A read after that point asks git again.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { envFingerprint } = require('../hooks/repo-info-cache');

const COMBINED = ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir', '--verify', '-q', 'HEAD'];

const NULL_LOCATIONS = Object.freeze({ toplevel: null, gitDir: null, commonDir: null, head: null });

// Output lines with only the trailing newline dropped: an empty interior line is a value git left empty (null), not a missing line.
const lines = (text) => String(text).replace(/\r?\n$/, '').split(/\r?\n/).map((l) => l.trim());

function createGitReads({ execImpl = execFileSync, env = process.env } = {}) {
  const locationMemo = new Map();
  const treeMemo = new Map();
  const keyFor = (cwd) => `${path.resolve(cwd)}\0${envFingerprint(env)}`;

  const locationsOf = (cwd, [toplevel, dir, common, head]) => ({
    toplevel: toplevel === '' ? null : toplevel,
    gitDir: dir === '' ? null : path.resolve(cwd, dir),
    commonDir: common === '' ? null : path.resolve(cwd, common),
    head: head === undefined || head === '' ? null : head,
  });

  // Today's per-question behavior (bare repo, inside .git): no stdio option, so git's
  // stderr reaches this process's stderr as report.js's gitDir and gitInfo do.
  const fallback = (cwd) => {
    const ask = (args) => {
      try {
        const out = String(execImpl('git', args, { cwd, env, encoding: 'utf8', windowsHide: true })).trim();
        return out === '' ? null : out;
      } catch {
        return null;
      }
    };
    const dir = ask(['rev-parse', '--git-dir']);
    if (dir === null) return { ...NULL_LOCATIONS };
    const common = ask(['rev-parse', '--git-common-dir']);
    return {
      toplevel: ask(['rev-parse', '--show-toplevel']),
      gitDir: path.resolve(cwd, dir),
      commonDir: common === null ? null : path.resolve(cwd, common),
      head: ask(['rev-parse', 'HEAD']),
    };
  };

  const compute = (cwd) => {
    const opts = { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
    try {
      const out = lines(execImpl('git', COMBINED, opts));
      if (out.length === 4) return locationsOf(cwd, out);
    } catch (err) {
      // An unborn HEAD: rev-parse prints the three locations and exits 1 on --verify.
      if (err && err.status === 1) {
        const out = lines(err.stdout ?? '');
        if (out.length === 3 && out.every((l) => l !== '')) return locationsOf(cwd, out);
      }
    }
    return fallback(cwd);
  };

  const locations = (cwd) => {
    const key = keyFor(cwd);
    if (!locationMemo.has(key)) locationMemo.set(key, compute(cwd));
    return { ...locationMemo.get(key) };
  };

  const treeState = (cwd) => {
    const key = keyFor(cwd);
    if (!treeMemo.has(key)) {
      const sha = locations(cwd).head;
      let state;
      if (sha === null) {
        state = { sha: null, dirty: null };
      } else {
        let dirty;
        try {
          dirty = String(execImpl('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd, env, encoding: 'utf8', windowsHide: true })).trim() !== ''; // git-path-read: not a path list (emptiness only)
        } catch {
          dirty = null;
        }
        state = { sha, dirty };
      }
      treeMemo.set(key, state);
    }
    return { ...treeMemo.get(key) };
  };

  const invalidate = () => {
    locationMemo.clear();
    treeMemo.clear();
  };

  return { locations, treeState, invalidate };
}

module.exports = { createGitReads };
