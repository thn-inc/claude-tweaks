'use strict';

// #5227: the module port of dispatch's queue-pull script -- the ```bash fence in
// plugin/skills/dispatch/queue-pull-script.md that starts at the `DISPATCH_QUEUE_RAW=` line.
// This file holds the registry, the session paths, the pass loop and the passes ported so far.
//
// R6, step-for-step port: each fence step is one function. A throw inside a step is caught and
// printed to stderr as `queue-pull: <step>: <message>`, and the run then continues or stops
// exactly where the fence has an RC check or a `grep -q 'appendExclusion:'` check. Stop and
// Warning texts are copied from the fence byte for byte. The module reproduces the fence's
// behavior, including behavior that looks wrong; a defect found while porting goes to the run
// ledger and is never fixed here.
//
// R7, registry semantics: PASSES is the ordered registry. `queuePull` walks it in array order, so
// position in the array is position in the run. Each entry is
//   { id, kind, reason, removes, bypass, runsOnCacheHit, failOpen, mcp }
// where `kind` is 'setup' | 'exclusion' | 'informational' and `reason` is null unless `kind` is
// 'exclusion'. `removes` says whether the reason drops the record from dispatch-groups.json,
// `bypass` whether a named #N form may still dispatch it, `runsOnCacheHit` whether the pass runs
// on a queue-order cache hit, and `mcp` how the pass behaves on the `files` transport.
//   failOpen is the pull-level posture of a fetch failure within that pass, in AC11's fixed set:
//     'stop' -- a fetch failure in the pass can stop the pull;
//     'open' -- a fetch failure lets the pull continue (whether the pass then excludes nothing,
//               or excludes fail-closed as "unreadable");
//     'n/a'  -- the pass makes no fetch.
//   It is the strictest posture across all of the pass's fetches and across BOTH transports.
// `malformed-blocker` and `unlanded-blocker` share `id: 'blocker-landing'`, because one
// dispatch-unlanded-blockers.js call writes both; they carry one identical failOpen. A shared id
// runs once, at its first entry.
//
// `omit` (queuePull option) takes reasons or ids and removes that pass's own filtering and
// appends and nothing else, with one exception: omitting either blocker-landing reason skips the
// shared call, so both reasons. runPasses ALWAYS calls every pass's runner and exposes the omit
// set as `ctx.omit` (a Set of ids); each runner skips only its own filtering and appends when
// `ctx.omit.has(<its id>)` and runs its shared steps regardless (for example `oversized` owns the
// grouping block that writes dispatch-groups.json and the `blocked` appends, and `target-missing`
// owns the integration-branch and run-dir resolution). Omitting a setup pass, or naming an
// unknown reason or id, throws TypeError.
//
// PF6: failOpen is taken across both transports, so a gh-only reader sees `stop` for a pass whose
// gh fetch fails open (neighbour-in-flight): on `files`, a missing or malformed in-flight or
// claims file stops the pull.
//
// Test-only seam: when QP_TMPNAME_COUNTER_FILE is set, defaultDeps().tmpName reads that file's
// integer (a missing file is 0; a non-integer or negative value is refused, as the oracle's
// mktemp shim refuses it), creates `tmp.qp<8-digit counter+1>` exclusively, and only then writes
// the counter back, so a failed create does not advance it. The parity CLI is
// a subprocess and cannot take an injected function, and the oracle's mktemp shim implements the
// same format over the same variable, so both sides emit identical names. Production never sets it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const { readExclusions } = require('./exclusions');
const { sessionTmpPath } = require('../session-tmp');
const { ghOptions } = require('../repo-resolve');
const { lstatType } = require('../path-guard');
const { GH_TIMEOUT_MS, GH_BATCH_TIMEOUT_MS, GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');

const BIN_DIR = path.join(__dirname, '..', '..');

const deepFreeze = (value) => {
  for (const v of Object.values(value)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(value);
};

const row = (id, kind, reason, removes, bypass, runsOnCacheHit, failOpen, mcp) => (
  { id, kind, reason, removes, bypass, runsOnCacheHit, failOpen, mcp }
);

const PASSES = deepFreeze([
  row('truncate', 'setup', null, false, false, true, 'n/a', 'same'),
  row('fetch', 'setup', null, false, false, true, 'stop', 'agent-fetched'),
  row('blocked', 'exclusion', 'blocked', true, false, true, 'open', 'agent-fetched'),
  row('oversized', 'exclusion', 'oversized', false, true, true, 'n/a', 'same'),
  row('write-back', 'setup', null, false, false, false, 'open', 'same'),
  row('not-spec-shaped', 'exclusion', 'not-spec-shaped', true, false, true, 'n/a', 'same'),
  row('open-pr', 'exclusion', 'open-pr', true, false, true, 'open', 'fails-open'),
  row('target-missing', 'exclusion', 'target-missing', true, false, true, 'open', 'same'),
  row('shipped', 'exclusion', 'shipped', true, false, true, 'open', 'skipped-empty'),
  row('blocker-landing', 'exclusion', 'malformed-blocker', true, false, true, 'open', 'same'),
  row('blocker-landing', 'exclusion', 'unlanded-blocker', true, false, true, 'open', 'fails-open'),
  row('neighbour-in-flight', 'exclusion', 'neighbour-in-flight', false, true, true, 'stop', 'agent-fetched'),
  row('cross-pr-overlap', 'informational', null, false, false, true, 'open', 'skipped-empty'),
  row('near-dup-pairs', 'informational', null, false, false, true, 'n/a', 'same'),
]);

const PASS_FIELD_VALUES = deepFreeze({
  kind: ['setup', 'exclusion', 'informational'],
  failOpen: ['open', 'stop', 'n/a'],
  mcp: ['same', 'skipped-empty', 'fails-open', 'agent-fetched'],
});

// The fence's `--value` names in fence order, then the ranking script's own pick file.
const SESSION_FILES = deepFreeze([
  'dispatch-queue-raw.json',
  'dispatch-open-numbers.json',
  'dispatch-eligible-pre-dep.json',
  'dispatch-unresolved-deps.json',
  'dispatch-verified-open-deps.txt',
  'dispatch-eligible.json',
  'dispatch-blocked-excluded-body.json',
  'dispatch-native-deps.json',
  'dispatch-native-deps.tmp.json',
  'dispatch-native-deps.err',
  'dispatch-groups.json',
  'dispatch-exclusions.json',
  'dispatch-fastlane-bundles.json',
  'dispatch-in-flight-raw.json',
  'dispatch-in-flight-claims.json',
  'dispatch-dep-freshness.json',
  'dispatch-open-prs.json',
  'dispatch-crosspr-overlap.json',
  'dispatch-near-dup-pairs.json',
  'dispatch-linked-prs.json',
  'dispatch-linked-prs.err',
  'dispatch-named-targets.json',
  'dispatch-shipped-probe-prs.json',
  'dispatch-shipped-pr-files.jsonl',
  'dispatch-shipped-releases.json',
  'dispatch-shape-gate.err',
  'dispatch-next-pick.json',
]);

// sessionId -> { [name]: absolute path }; with no session id each falls back to os.tmpdir()/name.
function sessionPaths(sessionId) {
  const out = {};
  for (const name of SESSION_FILES) out[name] = sessionTmpPath(sessionId, name) || path.join(os.tmpdir(), name);
  return out;
}

// A stop: `.line` is the exact 'dispatch: queue-pull stopped -- ...' text the fence prints.
class QueuePullStopped extends Error {
  constructor(line) {
    super(line);
    this.name = 'QueuePullStopped';
    this.line = line;
  }
}

// Fence lines 50-55. The only direct write to the exclusions file; every later pass appends
// through appendExclusion. Keeps only the 'firing' entries (firing-exclusion.md).
function runTruncate(ctx) {
  const file = ctx.paths['dispatch-exclusions.json'];
  try {
    const kept = readExclusions(file).filter((e) => e.reason === 'firing');
    fs.writeFileSync(file, JSON.stringify(kept));
  } catch (err) {
    ctx.deps.stderr(`queue-pull: truncate: ${err.message}\n`);
  }
}

const RUNNERS = { truncate: runTruncate };

// omit entries (reasons or ids) -> the Set of pass ids to skip. Exported so the omit mapping
// (either blocker-landing reason -> the shared id) is testable without a runner for every pass.
function resolveOmit(omit = []) {
  const ids = new Set();
  for (const name of omit) {
    const hit = PASSES.find((p) => p.reason === name || p.id === name);
    if (!hit) throw new TypeError(`queue-pull: omit: unknown reason or pass id: ${name}`);
    if (hit.kind === 'setup') throw new TypeError(`queue-pull: omit: a setup pass cannot be omitted: ${name}`);
    ids.add(hit.id);
  }
  return ids;
}

// Walks a registry in array order, running each id once at its first entry. ctx carries
// { deps, paths, options, omit?: Set of ids, runners?: { [id]: fn } }.
function runPasses(passes, ctx) {
  const runners = ctx.runners || RUNNERS;
  const seen = new Set();
  for (const pass of passes) {
    if (seen.has(pass.id)) continue;
    seen.add(pass.id);
    const runner = runners[pass.id];
    if (typeof runner !== 'function') throw new Error(`queue-pull: pass not implemented: ${pass.id}`);
    if (ctx.deps.onPass) ctx.deps.onPass(pass.id);
    runner(ctx);
  }
}

function tmpName() {
  const counterFile = process.env.QP_TMPNAME_COUNTER_FILE;
  let base;
  if (counterFile) {
    let stored = null;
    try { stored = fs.readFileSync(counterFile, 'utf8'); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    const n = stored === null ? 0 : Number(stored);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`queue-pull: tmpName: counter file holds ${JSON.stringify(stored)}`);
    const file = path.join(os.tmpdir(), `tmp.qp${String(n + 1).padStart(8, '0')}`);
    fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(counterFile, String(n + 1));
    return file;
  } else {
    const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    base = 'tmp.' + Array.from(crypto.randomBytes(10), (b) => alnum[b % alnum.length]).join('');
  }
  const file = path.join(os.tmpdir(), base);
  fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  return file;
}

function defaultDeps() {
  return {
    run(cmd, args, opts = {}) {
      if (cmd === 'gh') {
        const timeout = args.includes('graphql') ? GH_BATCH_TIMEOUT_MS : GH_TIMEOUT_MS;
        return execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, timeout, windowsHide: true, ...opts }));
      }
      return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, timeout: GIT_TIMEOUT_MS, windowsHide: true, ...opts });
    },
    spawnCli(name, args, { input, cwd, env } = {}) {
      const r = spawnSync(process.execPath, [path.join(BIN_DIR, name), ...args], { encoding: 'utf8', input, cwd, env, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true });
      return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    },
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    now: () => new Date(),
    tmpName,
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    queueOrder: {
      readOrder: (...a) => require('./queue-order').readOrder(...a),
      writeOrder: (...a) => require('./queue-order').writeOrder(...a),
    },
    createClaimReader: (...a) => require('../issues/claim-store').createClaimReader(...a),
    expressQueuePolicy: (...a) => require('../express/queue').expressQueuePolicy(...a),
    foreignDeps: {},
    onPass: null,
  };
}

// Runs the pull. Only the truncate pass has a runner so far; any other pass throws
// `queue-pull: pass not implemented: <id>`.
function queuePull(options = {}, deps = {}) {
  const merged = { ...defaultDeps(), ...deps };
  const omit = resolveOmit(options.omit);
  const paths = sessionPaths(options.sessionId);
  const ctx = { options, deps: merged, paths, omit };
  runPasses(PASSES, ctx);
  const groupsFile = paths['dispatch-groups.json'];
  const groups = lstatType(groupsFile).type === 'missing' ? [] : JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
  return { groups, exclusions: readExclusions(paths['dispatch-exclusions.json']) };
}

module.exports = {
  PASSES, PASS_FIELD_VALUES, SESSION_FILES, sessionPaths, QueuePullStopped, runPasses, resolveOmit, defaultDeps, queuePull,
};
