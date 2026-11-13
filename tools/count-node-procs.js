'use strict';
// tools/count-node-procs.js — per-test-file node process counts (#5374, maintainer-side, not shipped).
//
// Usage: node tools/count-node-procs.js [--files-from <list>] [--json <out>]
//
// Runs the suite (or the listed test files) through tools/run-tests.js with
// tools/count-node-procs-preload.js carried in NODE_OPTIONS, then prints node processes, plugin/bin
// CLI processes and wall time per test file. With no --files-from it runs both root sets
// (`tests` and `tools/upstream-drift/tests`) explicitly. --json writes the per-file rows.
// Exit code: the test run's (1 when it has none); 2 for a malformed invocation.
//
// The counts are a floor: a child started with a replaced env drops NODE_OPTIONS and is not logged, and
// a node process started through a non-node parent (a shell) is not attributed to a test file. The
// `node --test` runner is never a test file; it counts as unattributed unless a test file is above it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { requireOption } = require('./test-impact/node-options');

const REPO_ROOT = path.resolve(__dirname, '..');
const PRELOAD_PATH = path.join(__dirname, 'count-node-procs-preload.js');
const RUN_TESTS_PATH = path.join(__dirname, 'run-tests.js');
const DEFAULT_ROOTS = ['tests', path.join('tools', 'upstream-drift', 'tests')];
const USAGE = 'usage: node tools/count-node-procs.js [--files-from <list>] [--json <out>]\n';
const FLOOR_NOTE = '# counts are a floor: a child started with a replaced env drops NODE_OPTIONS and is not logged; a node process started through a non-node parent (a shell) is not attributed to a test file; the node --test runner itself is counted as unattributed';
const MAX_HOPS = 12;

const fwd = (p) => String(p).split(path.sep).join('/').replace(/\\/g, '/');

function analyze(logText, { repoRoot }) {
  const root = fwd(repoRoot).replace(/\/+$/, '');
  const inRepo = (p) => fwd(p).startsWith(root + '/');
  const rel = (p) => {
    const s = fwd(p);
    return inRepo(p) ? s.slice(root.length + 1) : s;
  };
  const starts = [];
  const exits = [];
  let skippedLines = 0;
  for (const line of String(logText).split('\n')) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch (_) { row = null; }
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.pid !== 'number' || typeof row.t !== 'number') {
      skippedLines += 1;
      continue;
    }
    if (row.ev === 'start') {
      const raw = Array.isArray(row.argv) && typeof row.argv[0] === 'string' ? row.argv[0] : '';
      const runner = Array.isArray(row.execArgv) && row.execArgv.includes('--test');
      starts.push({ pid: row.pid, ppid: row.ppid, t: row.t, script: rel(raw), inRepo: inRepo(raw), runner });
    } else if (row.ev === 'exit') {
      exits.push({ pid: row.pid, t: row.t });
    } else {
      skippedLines += 1;
    }
  }
  starts.sort((a, b) => a.t - b.t);

  const byPid = new Map();
  for (const s of starts) {
    if (!byPid.has(s.pid)) byPid.set(s.pid, []);
    byPid.get(s.pid).push(s);
  }
  const procAt = (pid, t) => {
    const list = byPid.get(pid);
    if (!list) return null;
    let best = null;
    for (const s of list) { if (s.t <= t) best = s; else break; }
    // a process that already exited cannot be the parent of a later start: the pid was reused by a non-node process
    if (best) {
      const e = exitOf(best);
      if (e !== null && e < t) return null;
    }
    return best;
  };
  const exitsByPid = new Map();
  for (const e of exits) {
    if (!exitsByPid.has(e.pid)) exitsByPid.set(e.pid, []);
    exitsByPid.get(e.pid).push(e.t);
  }
  const exitOf = (s) => {
    const list = byPid.get(s.pid);
    const next = list[list.indexOf(s) + 1];
    let best = null;
    for (const t of exitsByPid.get(s.pid) || []) {
      if (t >= s.t && (!next || t <= next.t) && (best === null || t < best)) best = t;
    }
    return best;
  };
  // a `node --test` runner takes the first listed test file as argv[0]; it is never a test-file process
  const isTestFile = (s) => !s.runner && s.inRepo && s.script.endsWith('.test.js');
  const cliName = (s) => {
    const m = /^plugin\/bin\/([^/]+\.js)$/.exec(s.script);
    return m ? m[1] : null;
  };
  const owner = (s) => {
    // the outermost test-file process among the process itself and up to MAX_HOPS ancestors
    let cur = s;
    let found = null;
    for (let hops = 0; cur && hops <= MAX_HOPS; hops += 1) {
      if (isTestFile(cur)) found = cur.script;
      const parent = procAt(cur.ppid, cur.t);
      if (!parent || parent === cur) break;
      cur = parent;
    }
    return found;
  };

  const perFile = new Map();
  const unattributed = { nodeProcs: 0, cliProcs: {} };
  for (const s of starts) {
    const file = owner(s);
    const cli = cliName(s);
    if (file === null) {
      unattributed.nodeProcs += 1;
      if (cli) unattributed.cliProcs[cli] = (unattributed.cliProcs[cli] || 0) + 1;
      continue;
    }
    if (!perFile.has(file)) perFile.set(file, { file, nodeProcs: 0, cliProcs: {}, minStart: s.t, maxStart: s.t, maxExit: null });
    const f = perFile.get(file);
    f.nodeProcs += 1;
    if (cli) f.cliProcs[cli] = (f.cliProcs[cli] || 0) + 1;
    f.minStart = Math.min(f.minStart, s.t);
    f.maxStart = Math.max(f.maxStart, s.t);
    const e = exitOf(s);
    if (e !== null) f.maxExit = f.maxExit === null ? e : Math.max(f.maxExit, e);
  }
  const files = [...perFile.values()]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((f) => ({
      file: f.file,
      nodeProcs: f.nodeProcs,
      cliProcs: f.cliProcs,
      wallMs: Math.max(f.maxExit === null ? f.maxStart : f.maxExit, f.maxStart) - f.minStart,
    }));
  return { files, unattributed, skippedLines };
}

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

function formatTable(result) {
  const rows = result.files.map((f) => [f.file, String(f.nodeProcs), String(sum(f.cliProcs)), String(f.wallMs)]);
  rows.push(['(unattributed)', String(result.unattributed.nodeProcs), String(sum(result.unattributed.cliProcs)), '-']);
  rows.push([
    'total',
    String(result.files.reduce((n, f) => n + f.nodeProcs, 0) + result.unattributed.nodeProcs),
    String(result.files.reduce((n, f) => n + sum(f.cliProcs), 0) + sum(result.unattributed.cliProcs)),
    '-',
  ]);
  const header = ['file', 'node', 'cli', 'wall-ms'];
  const all = [header, ...rows];
  const w = [0, 1, 2, 3].map((i) => Math.max(...all.map((r) => r[i].length)));
  const fmt = (r) => `${r[0].padEnd(w[0])}  ${r[1].padStart(w[1])}  ${r[2].padStart(w[2])}  ${r[3].padStart(w[3])}`;
  return [FLOOR_NOTE, ...all.map(fmt)].join('\n') + '\n';
}

function parseArgs(argv) {
  const opts = { filesFrom: null, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if ((a === '--files-from' || a === '--json') && i + 1 < argv.length) {
      opts[a === '--json' ? 'json' : 'filesFrom'] = argv[i + 1];
      i += 1;
    } else {
      return null;
    }
  }
  return opts;
}

function run(argv, deps) {
  const d = deps || realDeps;
  const opts = parseArgs(argv);
  if (!opts) {
    d.stderr.write(USAGE);
    return 2;
  }
  const dir = fs.mkdtempSync(path.join(d.tmpdir(), 'ct-count-node-'));
  try {
    const logFile = path.join(dir, 'procs.jsonl');
    const env = {
      ...d.env,
      CT_COUNT_NODE_LOG: logFile,
      NODE_OPTIONS: [d.env.NODE_OPTIONS, requireOption(PRELOAD_PATH)].filter(Boolean).join(' '),
    };
    const args = opts.filesFrom ? ['--files-from', opts.filesFrom] : DEFAULT_ROOTS;
    const child = d.spawnSync(process.execPath, [RUN_TESTS_PATH, ...args], { stdio: 'inherit', env, windowsHide: true });
    let logText = '';
    try { logText = fs.readFileSync(logFile, 'utf8'); } catch (_) { logText = ''; }
    const result = analyze(logText, { repoRoot: REPO_ROOT });
    d.stdout.write(formatTable(result));
    if (result.skippedLines) d.stderr.write(`count-node-procs: skipped ${result.skippedLines} unreadable log line(s)\n`);
    const status = child && typeof child.status === 'number' ? child.status : 1;
    if (opts.json) {
      try {
        fs.writeFileSync(opts.json, JSON.stringify(result.files));
      } catch (e) {
        d.stderr.write(`count-node-procs: could not write ${opts.json}: ${e.message}\n`);
        return status !== 0 ? status : 1;
      }
    }
    return status;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const realDeps = {
  spawnSync: childProcess.spawnSync,
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  tmpdir: os.tmpdir,
};

module.exports = { run, analyze, formatTable };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
