#!/usr/bin/env node
'use strict';
// tools/wait-polls.js — #5602: counts the Bash calls that begin with `sleep` across the local transcript
// store and classifies what each one waited for. It is the instrument for "how much of a session's
// Bash traffic is a poll".
//
//   node tools/wait-polls.js [--projects-dir <dir>]... [--match <slug-substring>] [--since-days <n>=30]
//                            [--until <iso>=now] [--help]
//
// --projects-dir may repeat; with none given it defaults to $CLAUDE_CONFIG_DIR/projects, else
// ~/.claude/projects. The scan window is [until - since-days, until) over file mtimes.
//
// Output (always one JSON line, keys in this order):
//   { window: { since, until }, transcripts: { main, subagent }, bashCalls: { main, subagent },
//     sleepLed: { main, subagent }, targets: { <target>: { calls, share }, ... } }
//   transcripts  files read; bashCalls: first-occurrence Bash tool_uses; sleepLed: those whose command
//                matches /^\s*sleep\s+\d/. Each is split by the kind of file the call was first seen in.
//   targets      one entry per TARGETS name, in that order; share = calls / sleep-led total * 100, one decimal.
//
// Walk. Each --projects-dir and each slug directory is resolved with realpath and read once, so a symlinked
// alias of a directory is not walked twice. A file is `subagent` when its parent directory is named
// `subagents`, else `main`; every main file is read before any subagent file, each list sorted. A tool call
// is identified by its tool_use `id` and counted at its first occurrence across the walk (a fork replays its
// parent's history); a line that is not valid JSON is skipped.
//
// Read errors. A slug directory, candidate or file that vanishes or dangles between listing and read
// (ENOENT) is skipped and not counted in `transcripts`. Any other read error after the up-front
// --projects-dir checks prints `wait-polls.js: cannot read <path> (<code>)` and exits 2 with no JSON.
//
// Classification (a heuristic, not a measurement of intent). For each counted sleep-led call, in order:
//   1. the command chained after the leading `sleep N` (after the first `;`, `&&`, `||` or newline), if
//      classifyProbe matches it;
//   2. the tool calls between this sleep and the next sleep-led call of the same file, then those between
//      the previous sleep-led call and this one, each segment only when it holds at most PROBE_GAP_MAX calls
//      (Agent and Task calls never count as probes);
//   3. `agent-notification` when an Agent or Task call precedes the sleep in the same file;
//   4. `other`.
// classifyProbe tries the RULES table below in order; the first match wins.
//
// Exit codes: 0 success; 2 an unknown flag, a flag with no value, a non-positive --since-days, an
// unparseable --until, a --projects-dir that is missing, not a directory or unreadable, or a mid-walk
// read error other than ENOENT.
//
// Seam: run({ argv, deps }) returns the exit code; deps holds fs, env, now, homedir, log and err.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eachLine, listCandidates } = require('./guard-refusals/transcripts');

const USAGE = [
  'usage: node tools/wait-polls.js [--projects-dir <dir>]... [--match <slug-substring>] [--since-days <n>=30]',
  '                                [--until <iso>=now] [--help]',
].join('\n');

const DAY_MS = 86400e3;
const PROBE_GAP_MAX = 3;
const SPEC = {
  '--projects-dir': 'multi', '--match': 'value', '--since-days': 'value', '--until': 'value',
  '--help': 'bool', '-h': 'bool',
};

const TARGETS = ['agent-notification', 'background-process', 'output-file', 'ci', 'worktree-git', 'verify', 'dev-server', 'suite-slot', 'other'];

const RULES = [
  ['ci', /\bgh\s+(pr\s+(checks|view)|run\s+(view|watch|list))\b|pr-checks\.js|ci-gate-record\.js/],
  ['worktree-git', /\bgit\b.*\b(rev-parse HEAD|status --porcelain|diff HEAD)\b|\bhash-object\b/],
  ['suite-slot', /suite-slot/],
  ['verify', /verify\.js|\bnpm (run )?test\b|node --test|run-tests\.js/],
  ['output-file', /\/tasks\/[^\s"']+\.output\b/],
  ['dev-server', /\bcurl\b.*\b(localhost|127\.0\.0\.1)|playwright|\blsof\b.*-i/],
  ['background-process', /\bps\b|\bkill -0\b|\bpgrep\b|\btail\b|\.log\b|^(BashOutput|TaskOutput) /],
];

const SLEEP_LED = /^\s*sleep\s+\d/;
const SLEEP_CHAIN = /^\s*sleep\s+[^;&|\n]*?(?:;|&&|\|\||\n)([\s\S]*)$/;
const isAgent = (c) => c.name === 'Agent' || c.name === 'Task';

function defaultDeps() {
  return {
    fs,
    env: process.env,
    now: Date.now,
    homedir: os.homedir,
    log: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
}

function parseArgs(args) {
  const opts = { '--projects-dir': [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const kind = SPEC[a];
    if (!kind) return { error: `unknown argument ${JSON.stringify(a)}` };
    if (kind === 'bool') {
      opts[a] = true;
      continue;
    }
    const v = args[++i];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    if (kind === 'multi') opts[a].push(v);
    else opts[a] = v;
  }
  return { opts };
}

function classifyProbe(text) {
  for (const [target, re] of RULES) if (re.test(text)) return target;
  return null;
}

function probeText(call) {
  if (call.name === 'Bash') return String((call.input || {}).command || '');
  if (call.name === 'Read') return String((call.input || {}).file_path || '');
  return `${call.name} ${JSON.stringify(call.input || {})}`;
}

function classifyCall(calls, i) {
  const own = calls[i];
  const chain = SLEEP_CHAIN.exec(String((own.input || {}).command || ''));
  const chained = chain ? chain[1].trim() : '';
  if (chained) {
    const t = classifyProbe(chained);
    if (t) return t;
  }
  const sleeps = [];
  calls.forEach((c, idx) => { if (c.sleepLed) sleeps.push(idx); });
  const at = sleeps.indexOf(i);
  const segments = [];
  if (at + 1 < sleeps.length) segments.push(calls.slice(i + 1, sleeps[at + 1]));
  if (at > 0) segments.push(calls.slice(sleeps[at - 1] + 1, i));
  for (const seg of segments) {
    if (seg.length > PROBE_GAP_MAX) continue;
    for (const c of seg) {
      if (isAgent(c)) continue;
      const t = classifyProbe(probeText(c));
      if (t) return t;
    }
  }
  if (calls.slice(0, i).some(isAgent)) return 'agent-notification';
  return 'other';
}

// Thrown to unwind the walk with the path and code of a read error that is not ENOENT.
class ReadFailure extends Error {
  constructor(p, code) {
    super(`cannot read ${p} (${code})`);
    this.readPath = p;
    this.readCode = code;
  }
}

function guarded(p, fn) {
  try {
    return { value: fn() };
  } catch (err) {
    if (err instanceof ReadFailure) throw err;
    if (err && err.code === 'ENOENT') return { gone: true };
    throw new ReadFailure(p, (err && err.code) || (err && err.message) || 'unknown');
  }
}

// Every transcript file in the window, as { file, kind }, each root and slug directory visited once by real path.
function collect({ roots, match, sinceMs, untilMs, fsImpl }) {
  const seenRoots = new Set();
  const seenSlugs = new Set();
  const found = [];
  for (const root of roots) {
    const realRoot = fsImpl.realpathSync(root);
    if (seenRoots.has(realRoot)) continue;
    seenRoots.add(realRoot);
    const names = guarded(realRoot, () => fsImpl.readdirSync(realRoot)).value.sort();
    for (const slug of names) {
      if (match && !slug.includes(match)) continue;
      const real = guarded(path.join(realRoot, slug), () => fsImpl.realpathSync(path.join(realRoot, slug)));
      if (real.gone || seenSlugs.has(real.value)) continue;
      seenSlugs.add(real.value);
      const dir = guarded(real.value, () => fsImpl.statSync(real.value).isDirectory());
      if (dir.gone || !dir.value) continue;
      // listCandidates swallows the error it reports, so keep the last one the wrapper saw.
      let last = null;
      const spy = { ...fsImpl };
      for (const m of ['readdirSync', 'statSync']) {
        spy[m] = (p, ...rest) => {
          try {
            return fsImpl[m](p, ...rest);
          } catch (err) {
            last = { path: String(p), code: err && err.code };
            throw err;
          }
        };
      }
      let failure = null;
      const candidates = listCandidates(spy, real.value, () => {
        if (last && last.code === 'ENOENT') return;
        if (!failure) failure = new ReadFailure(last ? last.path : real.value, (last && last.code) || 'unknown');
      });
      if (failure) throw failure;
      for (const p of candidates) {
        const st = guarded(p, () => fsImpl.statSync(p).mtimeMs);
        if (st.gone) continue;
        if (st.value >= sinceMs && st.value < untilMs) {
          found.push({ file: p, kind: path.basename(path.dirname(p)) === 'subagents' ? 'subagent' : 'main' });
        }
      }
    }
  }
  const byPath = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  return [
    ...found.filter((f) => f.kind === 'main').sort(byPath),
    ...found.filter((f) => f.kind === 'subagent').sort(byPath),
  ];
}

// The file's tool_use blocks in order, in-file duplicates dropped.
function readCalls(fsImpl, file) {
  const calls = [];
  const ids = new Set();
  eachLine(fsImpl, file, (buf) => {
    if (buf.indexOf('tool_use') === -1) return;
    let entry;
    try {
      entry = JSON.parse(buf.toString('utf8'));
    } catch (_) {
      return;
    }
    const content = entry && entry.message && entry.message.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || typeof b.name !== 'string' || ids.has(b.id)) continue;
      ids.add(b.id);
      const command = b.name === 'Bash' && b.input ? b.input.command : undefined;
      calls.push({ id: b.id, name: b.name, input: b.input || {}, sleepLed: typeof command === 'string' && SLEEP_LED.test(command) });
    }
  });
  return calls;
}

const pair = () => ({ main: 0, subagent: 0 });

function run({ argv, deps: given = {} }) {
  const deps = { ...defaultDeps(), ...given };
  const usageErr = (msg) => {
    deps.err(`wait-polls.js: ${msg}\n${USAGE}`);
    return 2;
  };
  const parsed = parseArgs(argv);
  if (parsed.error) return usageErr(parsed.error);
  const o = parsed.opts;
  if (o['--help'] || o['-h']) {
    deps.log(USAGE);
    return 0;
  }
  const days = o['--since-days'] === undefined ? 30 : Number(o['--since-days']);
  if (!Number.isFinite(days) || days <= 0) return usageErr('--since-days must be a positive number');
  const untilMs = o['--until'] === undefined ? deps.now() : Date.parse(o['--until']);
  if (!Number.isFinite(untilMs)) return usageErr('--until must be an ISO timestamp');
  const given_ = o['--projects-dir'];
  const roots = (given_.length ? given_ : [path.join(deps.env.CLAUDE_CONFIG_DIR || path.join(deps.homedir(), '.claude'), 'projects')])
    .map((d) => path.resolve(d));
  for (const dir of roots) {
    let isDir = false;
    try {
      isDir = deps.fs.statSync(dir).isDirectory();
    } catch (_) { /* a missing or unstat-able path is reported as not a directory below */ }
    if (!isDir) return usageErr(`--projects-dir ${dir} is not a directory`);
    try {
      deps.fs.readdirSync(dir);
    } catch (err) {
      return usageErr(`--projects-dir ${dir} cannot be read (${err.code || err.message})`);
    }
  }

  const sinceMs = untilMs - days * DAY_MS;
  const window = { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString() };
  const transcripts = pair();
  const bashCalls = pair();
  const sleepLed = pair();
  const counts = Object.fromEntries(TARGETS.map((t) => [t, 0]));
  const seen = new Set();
  try {
    for (const { file, kind } of collect({ roots, match: o['--match'] || null, sinceMs, untilMs, fsImpl: deps.fs })) {
      const read = guarded(file, () => readCalls(deps.fs, file));
      if (read.gone) continue;
      const calls = read.value;
      transcripts[kind]++;
      calls.forEach((c, i) => {
        if (seen.has(c.id)) return;
        seen.add(c.id);
        if (c.name !== 'Bash') return;
        bashCalls[kind]++;
        if (!c.sleepLed) return;
        sleepLed[kind]++;
        counts[classifyCall(calls, i)]++;
      });
    }
  } catch (err) {
    if (!(err instanceof ReadFailure)) throw err;
    deps.err(`wait-polls.js: ${err.message}\n${USAGE}`);
    return 2;
  }
  const total = sleepLed.main + sleepLed.subagent;
  const targets = Object.fromEntries(TARGETS.map((t) => [t, {
    calls: counts[t],
    share: total ? Math.round((counts[t] / total) * 1000) / 10 : 0,
  }]));
  deps.log(JSON.stringify({ window, transcripts, bashCalls, sleepLed, targets }));
  return 0;
}

module.exports = { run, classifyProbe, TARGETS };

if (require.main === module) {
  process.exitCode = run({ argv: process.argv.slice(2) });
}
