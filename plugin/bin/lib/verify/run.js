// plugin/bin/lib/verify/run.js — check execution with the fail-fast ordering
// policy (#892 AC1/AC9). spawnImpl is the injectable seam (tests inject fakes;
// same convention as bin/lib/issues/capabilities-probe.js's runner param).
// Each command is the caller's whole shell string by design — spawn(cmd,
// {shell: true}) — but the runner never composes a larger shell script
// around it (spec: Technical Approach).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STAGE1 = ['types', 'lint'];

// Best-effort: kills the whole process tree rooted at `child`, not just the
// immediate shell runOne spawned with `{shell: true}` — a hung command is
// usually a grandchild of that shell (#3063). POSIX kills the negative-pid
// process group spawnImpl creates via `detached: true` (every descendant
// inherits that group); Windows has no such group kill, so `taskkill /T`
// walks the tree itself regardless of `detached`. `kill`/`execImpl` are
// injectable so a test never spawns or kills a real process; a fake child
// (no numeric `.pid`) always falls through to the plain `child.kill()` below.
function killTree(child, { platform = process.platform, kill = process.kill, execImpl = execFileSync } = {}) {
  if (child && typeof child.pid === 'number') {
    try {
      if (platform === 'win32') execImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else kill(-child.pid, 'SIGKILL');
      return;
    } catch { /* fall through to the plain kill below */ }
  }
  try { if (child) child.kill('SIGKILL'); } catch { /* best effort */ }
}

// #5119: how long a signalled check gets for its own teardown (containers,
// temp databases, worker shutdown) before stopTrees kills its tree.
const SIGNAL_GRACE_MS = 5000;

// Whether any process is left in the POSIX process group `pid` leads. Any
// throw counts as gone: ESRCH, or EPERM, which macOS reports for a group of
// only unreaped zombies — and a group we cannot signal could not be killed
// below anyway.
function groupAlive(pid, kill) {
  try {
    kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Stops every tracked check on a signal (#5119): POSIX forwards `signal` to
// each check's process group (the session runOne's `detached` spawn gave it,
// so the terminal's own signal never reached it), polls every `pollMs` for up
// to `graceMs` while any group lives, then killTrees the groups still alive.
// Synchronous, because it runs inside a signal handler that cannot await:
// `sleep` blocks. An exited check's group stays visible until Node reaps it,
// which it cannot do while this blocks, so on Linux, where a zombie still
// answers the probe, the grace runs to its end. Win32 has no signal to
// forward, so each tree is killed at once (killTree's taskkill /T). Never
// throws.
function stopTrees(children, signal, {
  platform = process.platform, kill = process.kill, execImpl = execFileSync, graceMs = SIGNAL_GRACE_MS, pollMs = 100,
  sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
} = {}) {
  const all = [...children];
  const grouped = platform === 'win32' ? [] : all.filter((c) => c && typeof c.pid === 'number');
  for (const child of all) if (!grouped.includes(child)) killTree(child, { platform, kill, execImpl });
  for (const child of grouped) {
    try { kill(-child.pid, signal); } catch { /* ESRCH: the group already exited */ }
  }
  let alive = grouped.filter((c) => groupAlive(c.pid, kill));
  for (let waited = 0; alive.length && waited < graceMs; waited += pollMs) {
    sleep(pollMs);
    alive = alive.filter((c) => groupAlive(c.pid, kill));
  }
  for (const child of alive) killTree(child, { platform, kill, execImpl });
}

function runOne({
  name, command, logDir, spawnImpl, now, cwd, env: checkEnv = null, platform = process.platform,
  timeout: timeoutMs = null, track = null,
}) {
  const logPath = path.join(logDir, `${name}.log`);
  const stream = fs.createWriteStream(logPath);
  const started = now();
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    // stream.end's callback fires after the log data is flushed — resolving
    // earlier lets a caller read a truncated log file.
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (track && child) track.delete(child);
      stream.end(() => resolve(result));
    };
    // A write-stream failure (missing logDir, disk full, ...), a spawn-time
    // throw, and a child 'error' event are the same failure class: record
    // them, never let one crash the run as an unhandled 'error' event.
    let child;
    const finishError = (err) => {
      if (child) child.kill();
      finish({
        name, command, exitCode: null,
        spawnError: String((err && err.message) || err),
        durationMs: now() - started, logPath,
      });
    };
    stream.on('error', finishError);
    // #1837: belt and braces on colour — well-behaved runners emit plain
    // text when told to; the extractor's own stripAnsi stays authoritative
    // for runners that ignore both. Caller-set values win (a project that
    // deliberately forces colour on keeps it).
    // #2779: a check's own --cmd-env variables merge last, over the inherited
    // environment, and reach the child through spawn's `env` option — never
    // as a `VAR=val` prefix on the command string, which cmd.exe rejects.
    // On Windows names are case-insensitive and spawn keeps only the
    // lexicographically first of two case variants, so an inherited variant
    // of a check's own name is dropped first — otherwise `PATH` inherited
    // would beat a check's `path`. Spread, never Object.assign: a variable
    // literally named __proto__ must stay data.
    const inherited = { NO_COLOR: '1', FORCE_COLOR: '0', ...process.env };
    if (checkEnv && platform === 'win32') {
      const mine = new Set(Object.keys(checkEnv).map((k) => k.toUpperCase()));
      for (const k of Object.keys(inherited)) if (mine.has(k.toUpperCase())) delete inherited[k];
    }
    const env = { ...inherited, ...checkEnv };
    const opts = { shell: true, env, windowsHide: true };
    if (cwd) opts.cwd = cwd;
    // detached:true makes the spawned shell the leader of its own POSIX
    // process group, so killTree's negative-pid kill below reaches every
    // descendant the shell forks — never set on win32, which has no such
    // group and where `detached` instead opens a new console. A `track`ed
    // child (#5119: verify.js kills every running check before it frees its
    // suite slot on a signal) needs the same group, so the kill reaches the
    // whole tree; the set holds the child from spawn until it settles.
    if ((timeoutMs !== null || track) && platform !== 'win32') opts.detached = true;
    try {
      child = spawnImpl(command, opts);
    } catch (err) {
      finishError(err);
      return;
    }
    if (track) track.add(child);
    // #3063: a hung check otherwise blocks this run (and --baseline
    // adjudication) forever. A null exit code is never adjudicated and
    // never passes (see runChecks/report.js) — `timedOut` just names why.
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        killTree(child, { platform });
        finish({
          name, command, exitCode: null, timedOut: true, durationMs: now() - started, logPath,
        });
      }, timeoutMs);
    }
    if (child.stdout) { child.stdout.on('error', finishError); child.stdout.pipe(stream, { end: false }); }
    if (child.stderr) { child.stderr.on('error', finishError); child.stderr.pipe(stream, { end: false }); }
    child.on('error', finishError);
    child.on('close', (code) => finish({
      name, command, exitCode: code, durationMs: now() - started, logPath,
    }));
  });
}

function failed(result) {
  return result.exitCode !== 0; // spawnError results carry exitCode null -> failed
}

// Runs c unless skip is true, in which case it records a fail-fast skip
// without spawning. A failed result is offered to `retry` (verify.js's
// flaky hook, #1925) BEFORE the fail-fast decision, so a suite retried to
// a pass never leaves the checks behind it skipped. `anyFailed ||
// failed(r)` short-circuits on a skip result (anyFailed is already true
// whenever skip is true), so anyFailed stays accurate either way.
async function runOrSkip(c, ctx, skip) {
  if (skip) return { name: c.name, command: c.command, skipped: 'fail-fast' };
  const r = await runOne({ ...c, ...ctx });
  return failed(r) ? ctx.retry(r, ctx) : r;
}

// cmds: [{name, command}] in argv order. Returns results in stage order:
// stage 1 (types/lint, argv order), tests, then unknown names in argv order.
// `retry(result, ctx)` is awaited for every failed tests/unknown result
// (never types/lint — deterministic, never retried) and may return a
// replacement result; the default keeps the failure as is.
// `continueSuitesAfterFailure` (#3511, set under --baseline): the suite tier —
// `tests` and every unknown-name check — is skipped only when a stage-1
// (types/lint) check failed; a failing suite no longer skips the suites after
// it, because baseline adjudication refuses a run holding a skipped check and
// needs every suite's evidence. Off (the default) is the fail-fast above.
// `track` (#5119), when given, reaches every runOne here and rides in the
// ctx handed to `retry`, so a retry's spawns join the same set.
async function runChecks({
  cmds, logDir, spawnImpl = require('child_process').spawn, now = Date.now, retry = async (r) => r, cwd = null,
  continueSuitesAfterFailure = false, track = null,
}) {
  const ctx = {
    logDir, spawnImpl, now, retry, cwd, track,
  };
  const results = [];
  const stage1 = cmds.filter((c) => STAGE1.includes(c.name));
  const testsCmd = cmds.find((c) => c.name === 'tests') || null;
  const unknown = cmds.filter((c) => !STAGE1.includes(c.name) && c.name !== 'tests');

  const stage1Results = await Promise.all(stage1.map((c) => runOne({ ...c, ...ctx })));
  results.push(...stage1Results);
  let anyFailed = stage1Results.some(failed);

  if (testsCmd !== null) {
    const r = await runOrSkip(testsCmd, ctx, anyFailed);
    results.push(r);
    anyFailed = anyFailed || (!continueSuitesAfterFailure && failed(r));
  }

  for (const c of unknown) {
    const r = await runOrSkip(c, ctx, anyFailed);
    results.push(r);
    anyFailed = anyFailed || (!continueSuitesAfterFailure && failed(r));
  }

  return results;
}

module.exports = {
  runChecks, runOne, killTree, stopTrees, SIGNAL_GRACE_MS,
};
