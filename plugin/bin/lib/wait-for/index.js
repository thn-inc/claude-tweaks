'use strict';

// The logic of bin/wait-for.js (#5602): a bounded foreground wait an agent calls
// instead of polling with `sleep`. One call blocks until its target changes
// (exit 0) or a bound is hit (exit 3), and prints one JSON line either way.
//
// Bounds. The call bound is --max-seconds (default 100, at most 150): an agents or pid
// call ends within 150 s, a ci call within 170 s (a slow read may run 20 s past the
// bound), both under the measured 180-second foreground ceiling
// (docs/reference/blocking-wait-probe.md), so the caller passes no Bash `timeout`. The window bound is
// --window-seconds (default 1200, at most 3600), shared across calls: calls with
// the same target and ids/key join one window in the session's waits file, so a
// re-issued call cannot extend the wait past the window's deadline. A window is
// closed `deadline` by the call that hits its deadline, and `done` by an `agents`
// call whose every listed id was reported; the next call opens a new one, numbered
// 1 + the session's earlier windows of the same target and key whose first close
// was `deadline`. The call bound and `elapsedSeconds` are measured on
// deps.monotonicNow(); the window's openedAt/deadline and the deadline check use
// the epoch deps.now().
//
// A `ci` call whose first read fails exits 2 after it opened its window, so a retry
// joins that window. Each ci read is a child process killed 20 s (POLL_GRACE_MS) after
// the nearer of the call bound and the window deadline, so a ci call outlasts either
// bound by at most 20 s.
//
// Files: only the two marker-owned files of ./marker.js (the session's stops and
// waits files in the OS temp dir), never a transcript. `agents` reads stops and
// returns each final stop once: it appends a `delivered` record per reported id,
// and a later call skips stops at or below that index.
//
// Exit codes: 0 the target changed; 3 a bound was hit (`bound` is "call" or
// "deadline"); 2 a malformed invocation, a missing or invalid session id, a marker
// file refused (a symlink, a non-file), or any unexpected error.
//
// Targets are a seam: TARGETS maps a target name to { key(opts), poll(ctx) }, and
// poll returns { changed, state, extra } where `extra` is merged into the output.

const { randomBytes } = require('crypto');
const { readStops, readWaits, appendWait, isFinalStop, SESSION_ID_RE } = require('./marker');

const DEFAULT_MAX_SECONDS = 100;
const MAX_SECONDS_CAP = 150;
const DEFAULT_WINDOW_SECONDS = 1200;
const WINDOW_SECONDS_CAP = 3600;
const POLL_MS = { agents: 1000, pid: 1000, ci: 30000 };
// A ci poll starts before the nearer bound and is killed by its own timeout, so a call
// lasts at most --max-seconds + POLL_GRACE_MS (170 s at the cap, under the 180 s ceiling).
// The grace is also the floor: a call that joins a window past its deadline still gets one
// full-grace read, so a slow real read (about 3.4 s) is not killed before it can answer.
const POLL_GRACE_MS = 20000;

const USAGE = `usage: wait-for.js agents --ids <a,b> | ci --pr <n> | ci --run <id> | pid --pid <n>
         [--max-seconds <n>=100 (<=150)] [--window-seconds <n>=1200 (<=3600)] [--session <id>] [--help]

Blocks in the foreground until the target changes or a bound is hit, then prints
one JSON line. Call it with no Bash timeout: the longest agents or pid call,
--max-seconds 150, takes 150 s, and a ci call up to 170 s (a slow read may run 20 s
past the bound), both under the measured 180-second foreground ceiling
(docs/reference/blocking-wait-probe.md).
  agents --ids <a,b>   returns when a listed subagent id has a final stop (not
                       blocked, pending 0) not returned to an earlier call
  ci --pr <n>          returns when the PR's checks leave pending, classified as
                       pr-checks.js --pr does (green, red, inherited-red, no-ci)
  ci --run <id>        returns when the workflow run's status is completed
  pid --pid <n>        returns when the process is gone
A verify run and a suite slot are not targets: verify.js waits on both itself.

Calls with the same target and ids (or key) share one window of --window-seconds;
a call never runs past its window's deadline (a ci read may, by at most 20 s). Session: --session, else
CLAUDE_CODE_SESSION_ID ([A-Za-z0-9_-]).

Output keys: target, state, changed, elapsedSeconds, deadlineEpoch, window,
bound (exit 3 only: "call" or "deadline"), plus the target's own keys
(agents: reported, pending, stops; ci: readFailures, and conclusion for --run;
a ci read that fails after a good one counts as pending and adds to readFailures,
a first read that fails exits 2 after opening the window, so a retry joins it; each
ci read is killed 20 s after the nearer of the call bound and the window deadline, so
a ci call lasts at most --max-seconds + 20 s).

Exit codes: 0 the target changed; 3 a bound was hit; 2 a malformed invocation,
a missing or invalid session id, a refused marker file, or an unexpected error.
`;

const MAX_PID = 2147483647;
const POSITIVE_INT = /^[1-9]\d*$/;
const COMMON_FLAGS = { '--max-seconds': 'maxSeconds', '--window-seconds': 'windowSeconds', '--session': 'session' };
const TARGET_FLAGS = {
  agents: { '--ids': 'ids' },
  ci: { '--pr': 'pr', '--run': 'run' },
  pid: { '--pid': 'pid' },
};

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const target = argv[0];
  if (target === undefined) return { error: 'missing target (agents, ci or pid)' };
  if (!Object.hasOwn(TARGET_FLAGS, target)) return { error: `unknown target: ${target}` };
  const flags = { ...COMMON_FLAGS, ...TARGET_FLAGS[target] };
  const raw = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!Object.hasOwn(flags, a)) return { error: `unknown flag: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) return { error: `${a} needs a value` };
    if (Object.hasOwn(raw, flags[a])) return { error: `${a} given more than once` };
    raw[flags[a]] = v;
    i++;
  }
  const opts = { target, maxSeconds: DEFAULT_MAX_SECONDS, windowSeconds: DEFAULT_WINDOW_SECONDS };
  for (const [name, flag] of [['maxSeconds', '--max-seconds'], ['windowSeconds', '--window-seconds'], ['pr', '--pr'], ['run', '--run'], ['pid', '--pid']]) {
    if (!Object.hasOwn(raw, name)) continue;
    if (!POSITIVE_INT.test(raw[name])) return { error: `${flag} must be a positive integer: ${raw[name]}` };
    opts[name] = name === 'run' ? raw[name] : Number(raw[name]);
  }
  if (opts.maxSeconds > MAX_SECONDS_CAP) return { error: `--max-seconds must be at most ${MAX_SECONDS_CAP}` };
  if (opts.windowSeconds > WINDOW_SECONDS_CAP) return { error: `--window-seconds must be at most ${WINDOW_SECONDS_CAP}` };
  if (Object.hasOwn(raw, 'session')) opts.session = raw.session;
  if (target === 'agents') {
    if (!Object.hasOwn(raw, 'ids')) return { error: 'agents needs --ids' };
    const ids = raw.ids.split(',');
    if (ids.some((id) => !SESSION_ID_RE.test(id))) return { error: `--ids must be a comma list of ids matching [A-Za-z0-9_-]: ${raw.ids}` };
    opts.ids = [...new Set(ids)];
  } else if (target === 'ci') {
    if (Object.hasOwn(opts, 'pr') === Object.hasOwn(opts, 'run')) return { error: 'ci needs exactly one of --pr and --run' };
  } else if (!Object.hasOwn(opts, 'pid')) {
    return { error: 'pid needs --pid' };
  } else if (opts.pid > MAX_PID) {
    // process.kill rejects a pid above int32, which isPidAlive would read as "gone".
    return { error: `--pid must be at most ${MAX_PID}` };
  }
  return opts;
}

const agents = {
  key: (opts) => [...opts.ids].sort().join(','),
  poll({ opts, sessionId, tmpDir, window, deps }) {
    const { stops, count } = readStops(sessionId, { tmpDir });
    const delivered = {};
    for (const w of readWaits(sessionId, { tmpDir })) {
      if (w.kind === 'delivered') delivered[w.agentId] = Math.max(delivered[w.agentId] ?? -1, w.stop);
    }
    const newest = {};
    for (const s of stops) {
      if (isFinalStop(s) && s.index > (delivered[s.agentId] ?? -1)) newest[s.agentId] = Math.max(newest[s.agentId] ?? -1, s.index);
    }
    const candidates = opts.ids.filter((id) => Object.hasOwn(newest, id));
    if (candidates.length === 0) return { changed: false, state: 'pending', extra: { reported: [], pending: [...opts.ids], stops: count } };
    // Two overlapping calls can both read a stop as undelivered. Each appends its own
    // `delivered` line carrying a random claim; appends are atomic and ordered, so the
    // first line for a stop decides which call returns it and the other keeps waiting.
    const claim = randomBytes(8).toString('hex');
    for (const id of candidates) appendWait(sessionId, { kind: 'delivered', agentId: id, stop: newest[id], claim }, { tmpDir });
    const firstClaim = {};
    for (const w of readWaits(sessionId, { tmpDir })) {
      if (w.kind === 'delivered' && w.stop === newest[w.agentId] && !Object.hasOwn(firstClaim, w.agentId)) firstClaim[w.agentId] = w.claim;
    }
    const reported = candidates.filter((id) => firstClaim[id] === claim);
    const pending = opts.ids.filter((id) => !reported.includes(id));
    if (reported.length === 0) return { changed: false, state: 'pending', extra: { reported, pending, stops: count } };
    if (pending.length === 0) appendWait(sessionId, { kind: 'close', window, reason: 'done', at: Math.floor(deps.now() / 1000) }, { tmpDir });
    return { changed: true, state: 'reported', extra: { reported, pending, stops: count } };
  },
};

const pid = {
  key: (opts) => `pid:${opts.pid}`,
  poll({ opts, deps }) {
    const alive = deps.isPidAlive(opts.pid);
    return { changed: !alive, state: alive ? 'alive' : 'gone', extra: {} };
  },
};

// Why a runner answer is not a usable read, or null. A `pr-checks.js --pr` envelope of
// read-failed, gh-absent or no-pr is a failed read, not a change (the spec's "2 ... a
// source that cannot be read").
const FAILED_PR_STATES = new Set(['read-failed', 'gh-absent', 'no-pr']);
function readProblem(opts, read) {
  if (read === null || typeof read !== 'object' || Array.isArray(read)) return 'the CI read returned no object';
  if (opts.pr !== undefined) {
    if (typeof read.state !== 'string') return 'the PR checks read has no state';
    if (FAILED_PR_STATES.has(read.state)) return `the PR checks read is ${read.state}${typeof read.reason === 'string' ? `: ${read.reason}` : ''}`;
  } else if (typeof read.status !== 'string') {
    return 'the workflow run read has no status';
  }
  return null;
}

const ci = {
  key: (opts) => (opts.pr !== undefined ? `pr:${opts.pr}` : `run:${opts.run}`),
  poll({ opts, deps, scratch, timeoutMs }) {
    let read = null;
    let problem;
    try {
      read = deps.runner(opts.pr !== undefined ? { pr: opts.pr } : { run: opts.run }, { cwd: deps.cwd(), env: deps.env, timeoutMs });
      problem = readProblem(opts, read);
    } catch (err) {
      problem = err && err.message ? err.message : String(err);
    }
    if (problem) {
      if (!scratch.good) throw new Error(`CI read failed: ${problem}`);
      scratch.readFailures += 1;
    } else {
      scratch.good = read;
    }
    const last = scratch.good;
    const byRun = opts.pr === undefined;
    const state = byRun ? last.status : last.state;
    return {
      changed: byRun ? state === 'completed' : state !== 'pending',
      state,
      extra: { readFailures: scratch.readFailures, ...(byRun ? { conclusion: last.conclusion ?? null } : {}) },
    };
  },
};

const TARGETS = { agents, pid, ci };

// The open window this call joins, or a new one it appends. -> the open record.
function resolveWindow(opts, key, { sessionId, tmpDir, start }) {
  const waits = readWaits(sessionId, { tmpDir });
  const opens = new Map();
  const closed = new Set();
  for (const w of waits) {
    if (w.kind === 'open') opens.set(w.window, w);
    else if (w.kind === 'close') closed.add(w.window);
  }
  const joinable = [...opens.values()]
    .filter((w) => !closed.has(w.window) && w.target === opts.target)
    .filter((w) => (opts.target === 'agents' ? opts.ids.every((id) => w.ids.includes(id)) : w.key === key));
  if (joinable.length) return joinable[joinable.length - 1];

  // A window counts toward `n` only when its first close is `deadline`: a joiner still
  // running after a sibling closed the window `done` appends a later deadline close.
  const firstClose = new Map();
  for (const w of waits) if (w.kind === 'close' && !firstClose.has(w.window)) firstClose.set(w.window, w.reason);
  const deadlineClosed = [...firstClose]
    .filter(([id, reason]) => reason === 'deadline' && opens.has(id))
    .filter(([id]) => opens.get(id).target === opts.target && opens.get(id).key === key);
  const openedAt = Math.floor(start / 1000);
  const record = {
    kind: 'open',
    window: `${opts.target}:${key}:${start}`,
    target: opts.target,
    key,
    ...(opts.target === 'agents' ? { ids: key.split(',') } : {}),
    openedAt,
    deadline: openedAt + opts.windowSeconds,
    n: 1 + deadlineClosed.length,
  };
  appendWait(sessionId, record, { tmpDir });
  return record;
}

function usageError(deps, reason) {
  deps.stderr(`wait-for.js: ${reason}\n${USAGE}`);
  return 2;
}

async function run(argv, deps) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      deps.stdout(USAGE);
      return 0;
    }
    if (opts.error) return usageError(deps, opts.error);
    const sessionId = opts.session ?? deps.env.CLAUDE_CODE_SESSION_ID;
    if (opts.session === undefined && !sessionId) {
      return usageError(deps, 'no session id: CLAUDE_CODE_SESSION_ID is unset and --session was not given');
    }
    if (!SESSION_ID_RE.test(sessionId)) return usageError(deps, `session id must match [A-Za-z0-9_-]: ${sessionId}`);

    const target = TARGETS[opts.target];
    const tmpDir = deps.tmpDir();
    const start = deps.now();
    const key = target.key(opts);
    const win = resolveWindow(opts, key, { sessionId, tmpDir, start });
    // The call bound runs on the monotonic clock, so a wall-clock step cannot hold a
    // call past --max-seconds; the window deadline is an epoch shared across calls.
    const monoStart = deps.monotonicNow();
    const callEnd = monoStart + opts.maxSeconds * 1000;
    const deadlineMs = win.deadline * 1000;
    const ctx = { opts, sessionId, tmpDir, window: win.window, deps, scratch: { good: null, readFailures: 0 } };
    const print = (res, bound) => {
      const out = {
        target: opts.target,
        state: res.state,
        changed: res.changed,
        elapsedSeconds: Math.round((deps.monotonicNow() - monoStart) / 1000),
        deadlineEpoch: win.deadline,
        window: win.n,
        ...(bound ? { bound } : {}),
        ...res.extra,
      };
      deps.stdout(JSON.stringify(out) + '\n');
    };

    for (;;) {
      // The nearer of the two bounds, plus the grace a slow ci read is allowed past it.
      // Whole ms: performance.now() is fractional and a child-process timeout must be an integer.
      ctx.timeoutMs = Math.max(POLL_GRACE_MS, Math.floor(Math.min(callEnd - deps.monotonicNow(), deadlineMs - deps.now()) + POLL_GRACE_MS));
      const res = await target.poll(ctx);
      if (res.changed) {
        print(res);
        return 0;
      }
      const t = deps.now();
      const m = deps.monotonicNow();
      if (t >= deadlineMs) {
        appendWait(sessionId, { kind: 'close', window: win.window, reason: 'deadline', at: Math.floor(t / 1000) }, { tmpDir });
        print(res, 'deadline');
        return 3;
      }
      if (m >= callEnd) {
        print(res, 'call');
        return 3;
      }
      await deps.sleep(Math.min(POLL_MS[opts.target], deadlineMs - t, callEnd - m));
    }
  } catch (err) {
    deps.stderr(`wait-for.js: ${err && err.message ? err.message : err}\n`);
    return 2;
  }
}

module.exports = {
  run,
  parseArgs,
  USAGE,
  TARGETS,
  DEFAULT_MAX_SECONDS,
  MAX_SECONDS_CAP,
  DEFAULT_WINDOW_SECONDS,
  WINDOW_SECONDS_CAP,
  POLL_MS,
};
