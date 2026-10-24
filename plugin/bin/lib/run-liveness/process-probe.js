'use strict';
// Process probes for the run-liveness owner block (#3973). Must not require
// hooks/context.js — context.js requires this module.
const path = require('path');
const childProcess = require('child_process');

const MAX_ANCESTOR_HOPS = 8;
// `ps -o lstart=` prints in the caller's TZ and locale; the stored start time is compared by
// equality across different processes, so pin both (a TZ/locale difference would otherwise
// make a live owner look like pid reuse).
function psEnv() {
  return { ...process.env, LC_ALL: 'C', TZ: 'UTC' };
}

// #3845: Claude Code sets CLAUDE_PID to its own pid in every process it spawns
// (its Bash tool and its hooks alike). Moved here from hooks/context.js, which
// re-exports it; the nested-session / liveness rationale stays documented there.
function claudePid(env) {
  const raw = env && env.CLAUDE_PID;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) ? pid : null;
}

// The process start time as `ps` prints it (e.g. `Sat Oct 24 08:08:15 2026`),
// trimmed. Stored and compared by equality only — never parsed. null on win32,
// a non-integer pid, a failed probe, or empty output.
function pidStartTime(pid, deps = {}) {
  try {
    if ((deps.platform || process.platform) === 'win32') return null;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const run = deps.execFileSync || childProcess.execFileSync;
    const out = run('ps', ['-o', 'lstart=', '-p', String(pid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, windowsHide: true, env: psEnv() });
    const text = typeof out === 'string' ? out.trim() : '';
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

// The nearest ancestor process whose command basename is `claude`, walking
// `ps -o ppid=,comm=` upward from this process's parent — at most 8 `ps` calls.
// null on win32 or any failure (the fallback when CLAUDE_PID is absent).
function ancestorClaudePid(deps = {}) {
  try {
    if ((deps.platform || process.platform) === 'win32') return null;
    const run = deps.execFileSync || childProcess.execFileSync;
    let pid = deps.ppid ?? process.ppid;
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
      if (!Number.isInteger(pid) || pid <= 0) return null;
      const out = run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, windowsHide: true, env: psEnv() });
      const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(typeof out === 'string' ? out : '');
      if (!m) return null;
      if (path.basename(m[2]) === 'claude') return pid;
      pid = Number(m[1]);
    }
    return null;
  } catch {
    return null;
  }
}

// The owning Claude process: CLAUDE_PID from the environment first, else the
// nearest `claude` ancestor. pidSource records which one answered.
function resolveOwnerPid(env, deps = {}) {
  const fromEnv = claudePid(env);
  if (fromEnv !== null) return { pid: fromEnv, pidSource: 'env' };
  const fromAncestry = (deps.ancestorClaudePid || ancestorClaudePid)();
  if (Number.isInteger(fromAncestry) && fromAncestry > 0) return { pid: fromAncestry, pidSource: 'ancestry' };
  return { pid: null, pidSource: null };
}

module.exports = { claudePid, pidStartTime, ancestorClaudePid, resolveOwnerPid };
