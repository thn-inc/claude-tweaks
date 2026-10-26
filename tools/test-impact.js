#!/usr/bin/env node
'use strict';
// tools/test-impact.js — refreshes the test-impact map verify.js's impact selection reads (#4024).
//
//   trace [--out <path>] [--allow-dirty]
//     Runs the full suite (`node {repo}/tools/run-tests.js`) under tools/test-impact/tracer.js and folds
//     the trace files into a map (tools/test-impact/build-map.js) recording HEAD and the suite's exit
//     code — a failing suite still writes its map, which verify.js then refuses as
//     map-from-failing-suite. A run in which a traced process could not record a read (a `.lost` marker)
//     writes no map. Refuses a tree with tracked changes unless --allow-dirty (untracked files
//     do not count). Prints `trace: {n} test file(s), {paths} path(s), suite exit {code} → {out} ({bytes} bytes)`.
//   fetch [--repo owner/name] [--out <path>]
//     Downloads the map CI built: of the last 30 successful `test-impact-map.yml` runs on main, the
//     newest whose head commit is an ancestor of HEAD (a branch behind main could never use a newer
//     one). Skips the download when the cached map already holds that commit; validates the artifact
//     (parseImpactMap, commit === the run's headSha, exitCode 0) before replacing the cache.
//
// --out defaults to `{git-common-dir}/claude-tweaks-test-impact.json` (shared by every worktree); the
// map is written atomically. The repo root is `git rev-parse --show-toplevel` of the cwd.
//
// Exit codes: 0 map written (or, for fetch, already current); 1 failure (no trace data, a trace run whose
// tracer lost a read, gh/git failure, an invalid or unusable artifact, no ancestor map) with a message on
// stderr; 2 malformed invocation or, for trace, a dirty tree.
//
// Seam: run({ argv, deps }) returns the exit code; deps holds git(args, {cwd}) and gh(args, {cwd})
// (stdout; throw on failure), spawn(cmd, args, opts) (→ {status, signal, error}), fs, now, env,
// execPath, cwd, tmpdir and the log/err line writers.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { parseImpactMap, gitLocations, DEFAULT_MAP_NAME } = require('../plugin/bin/lib/verify/impact');
const { writeFileAtomic } = require('../plugin/bin/lib/atomic-write');
const { buildMap } = require('./test-impact/build-map');
const { requireOption } = require('./test-impact/node-options');

const USAGE = [
  'usage: node tools/test-impact.js trace [--out <path>] [--allow-dirty]',
  '       node tools/test-impact.js fetch [--repo owner/name] [--out <path>]',
].join('\n');

const WORKFLOW = 'test-impact-map.yml';
const ARTIFACT = 'test-impact-map';
const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const errText = (e) => String((e && (e.stderr && String(e.stderr).trim())) || (e && e.message) || e);

function defaultDeps() {
  const exec = (cmd) => (args, opts = {}) => String(execFileSync(cmd, args, {
    cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }));
  return {
    git: exec('git'),
    gh: exec('gh'),
    spawn: (cmd, args, opts) => spawnSync(cmd, args, { ...opts, stdio: 'inherit' }),
    fs,
    now: Date.now,
    env: process.env,
    execPath: process.execPath,
    cwd: process.cwd(),
    tmpdir: os.tmpdir(),
    log: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
}

// Parses `args` against `spec` ({ '--flag': 'value' | 'bool' }) → { opts } or { error }.
function parseArgs(args, spec) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const kind = spec[a];
    if (!kind) return { error: `unknown argument ${JSON.stringify(a)}` };
    if (kind === 'bool') {
      opts[a] = true;
      continue;
    }
    const v = args[++i];
    if (v === undefined || v === '' || v.startsWith('-')) return { error: `${a} needs a value` };
    opts[a] = v;
  }
  return { opts };
}

function locate(deps) {
  const execImpl = (cmd, args, opts) => deps.git(args, opts);
  return gitLocations({ cwd: deps.cwd, execImpl });
}

function resolveOut(outArg, loc, deps) {
  return outArg ? path.resolve(deps.cwd, outArg) : path.join(loc.commonDir, DEFAULT_MAP_NAME);
}

function writeMap(deps, out, text) {
  writeFileAtomic(out, text, {
    writeFile: deps.fs.writeFileSync, rename: deps.fs.renameSync, unlink: deps.fs.unlinkSync,
  });
}

function rmQuiet(deps, dir) {
  try {
    deps.fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // a leftover temp dir must not fail the command
  }
}

function trace(args, deps) {
  const parsed = parseArgs(args, { '--out': 'value', '--allow-dirty': 'bool' });
  if (parsed.error) {
    deps.err(`test-impact.js trace: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const loc = locate(deps);
  if (!loc) {
    deps.err('test-impact.js trace: not inside a git checkout');
    return 1;
  }
  const root = loc.repoRoot;
  let commit;
  try {
    if (!parsed.opts['--allow-dirty']) {
      const status = deps.git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no'], { cwd: root });
      if (status.trim() !== '') {
        deps.err('test-impact.js trace: the working tree is dirty (tracked changes) — commit them or pass --allow-dirty');
        return 2;
      }
    }
    commit = deps.git(['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root }).trim();
  } catch (e) {
    deps.err(`test-impact.js trace: git failed: ${errText(e)}`);
    return 1;
  }
  if (!SHA_RE.test(commit)) {
    deps.err(`test-impact.js trace: HEAD is not a commit (${JSON.stringify(commit)})`);
    return 1;
  }
  const out = resolveOut(parsed.opts['--out'], loc, deps);

  let traceDir = null;
  try {
    traceDir = deps.fs.mkdtempSync(path.join(deps.tmpdir || os.tmpdir(), 'ct-test-impact-trace-'));
    const realRoot = deps.fs.realpathSync(root);
    const req = requireOption(path.join(root, 'tools', 'test-impact', 'tracer.js'));
    // Inherited CT_TRACE_* is dropped first: the tracer leaves a child alone when its env names a
    // different CT_TRACE_ROOT (a nested trace, tools/test-impact/tracer.js injectEnv), so a stale root
    // from an outer traced session would otherwise mix two repos' reads into this map. `req` keeps the
    // literal quotes because NODE_OPTIONS is split on spaces and the checkout path may hold one; the
    // path is forward-slashed because NODE_OPTIONS reads `\` inside quotes as an escape (node-options.js).
    const env = {};
    for (const [k, v] of Object.entries(deps.env)) if (!k.startsWith('CT_TRACE_')) env[k] = v;
    env.CT_TRACE_ROOT = realRoot;
    env.CT_TRACE_DIR = traceDir;
    env.CT_TRACE_REQUIRE = req;
    env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${req}` : req;

    const result = deps.spawn(deps.execPath, [path.join(root, 'tools', 'run-tests.js')], { cwd: root, env });
    if (result && result.error) deps.err(`test-impact.js trace: the suite did not start: ${errText(result.error)}`);
    const exitCode = result && Number.isInteger(result.status) ? result.status : 1;

    const built = buildMap({ traceDir, commit, exitCode, node: process.version, now: deps.now, fsImpl: deps.fs });
    if (built.lost > 0) {
      const named = built.lostTests.length ? built.lostTests.join(', ') : 'unknown';
      deps.err(`test-impact.js trace: ${built.lost} traced process(es) could not record a read (tests: ${named}) — no map written`);
      return 1;
    }
    const tests = Object.keys(built.map.tests).length;
    if (tests === 0) {
      deps.err(`test-impact.js trace: the run left no parseable trace file in ${traceDir} — no map written`);
      return 1;
    }
    if (built.skipped || built.headerless) {
      deps.err(`test-impact.js trace: ${built.skipped} unparseable trace line(s) (their tests kept for every change), ` +
        `${built.headerless} trace file(s) without a header skipped`);
    }
    const text = `${JSON.stringify(built.map)}\n`;
    writeMap(deps, out, text);
    deps.log(`trace: ${tests} test file(s), ${built.map.paths.length} path(s), suite exit ${exitCode} → ${out} (${Buffer.byteLength(text)} bytes)`);
    return 0;
  } catch (e) {
    deps.err(`test-impact.js trace: ${errText(e)}`);
    return 1;
  } finally {
    if (traceDir) rmQuiet(deps, traceDir);
  }
}

function fetch(args, deps) {
  const parsed = parseArgs(args, { '--out': 'value', '--repo': 'value' });
  if (parsed.error || (parsed.opts['--repo'] && !REPO_RE.test(parsed.opts['--repo']))) {
    deps.err(`test-impact.js fetch: ${parsed.error || '--repo must be owner/name'}\n${USAGE}`);
    return 2;
  }
  const loc = locate(deps);
  if (!loc) {
    deps.err('test-impact.js fetch: not inside a git checkout');
    return 1;
  }
  const root = loc.repoRoot;
  const repoArgs = parsed.opts['--repo'] ? ['--repo', parsed.opts['--repo']] : [];
  const out = resolveOut(parsed.opts['--out'], loc, deps);

  let runs;
  try {
    runs = JSON.parse(deps.gh(['run', 'list', '--workflow', WORKFLOW, '--branch', 'main', '--status', 'success',
      '--limit', '30', '--json', 'databaseId,headSha,event', ...repoArgs], { cwd: root }));
  } catch (e) {
    deps.err(`test-impact.js fetch: listing ${WORKFLOW} runs failed: ${errText(e)}`);
    return 1;
  }
  if (!Array.isArray(runs)) {
    deps.err('test-impact.js fetch: gh run list returned no run list');
    return 1;
  }
  const chosen = runs.find((r) => {
    if (!r || !Number.isInteger(r.databaseId) || typeof r.headSha !== 'string' || !SHA_RE.test(r.headSha)) return false;
    // `--branch main` matches a run's head branch, so a pull_request run from a fork branch named
    // `main` would list here too — and its artifact is built by that PR's own code. Only the runs
    // the workflow makes from this repo's main (push, dispatch) are trusted.
    if (r.event !== 'push' && r.event !== 'workflow_dispatch') return false;
    try {
      deps.git(['merge-base', '--is-ancestor', '--end-of-options', r.headSha, 'HEAD'], { cwd: root });
      return true;
    } catch (_) {
      return false; // not an ancestor, or a commit this clone does not have
    }
  });
  if (!chosen) {
    deps.err(`test-impact.js fetch: no successful main ${WORKFLOW} map (of ${runs.length} run(s)) is an ancestor of HEAD`);
    return 1;
  }
  const sha = chosen.headSha;

  let cached = null;
  try {
    cached = parseImpactMap(deps.fs.readFileSync(out, 'utf8'));
  } catch (_) {
    // no cached map
  }
  if (cached && cached.ok && cached.map.commit === sha) {
    deps.log(`fetch: map at ${sha} already current → ${out}`);
    return 0;
  }

  let dir = null;
  try {
    dir = deps.fs.mkdtempSync(path.join(deps.tmpdir || os.tmpdir(), 'ct-test-impact-fetch-'));
    try {
      deps.gh(['run', 'download', String(chosen.databaseId), '--name', ARTIFACT, '--dir', dir, ...repoArgs], { cwd: root });
    } catch (e) {
      deps.err(`test-impact.js fetch: downloading run ${chosen.databaseId}'s ${ARTIFACT} artifact failed: ${errText(e)}`);
      return 1;
    }
    const jsons = deps.fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    if (jsons.length !== 1) {
      deps.err(`test-impact.js fetch: run ${chosen.databaseId}'s artifact holds ${jsons.length} .json file(s), want exactly 1`);
      return 1;
    }
    const text = deps.fs.readFileSync(path.join(dir, jsons[0]), 'utf8');
    const map = parseImpactMap(text);
    if (!map.ok) {
      deps.err(`test-impact.js fetch: run ${chosen.databaseId}'s map is invalid: ${map.reason}`);
      return 1;
    }
    if (map.map.commit !== sha) {
      deps.err(`test-impact.js fetch: run ${chosen.databaseId}'s map records commit ${map.map.commit}, not the run's ${sha}`);
      return 1;
    }
    if (map.map.exitCode !== 0) {
      deps.err(`test-impact.js fetch: run ${chosen.databaseId}'s map comes from a failing suite (exit ${map.map.exitCode})`);
      return 1;
    }
    writeMap(deps, out, text);
    deps.log(`fetch: run ${chosen.databaseId} map at ${sha} → ${out} (${Buffer.byteLength(text)} bytes)`);
    return 0;
  } catch (e) {
    deps.err(`test-impact.js fetch: ${errText(e)}`);
    return 1;
  } finally {
    if (dir) rmQuiet(deps, dir);
  }
}

function run({ argv, deps: given = {} }) {
  const deps = { ...defaultDeps(), ...given };
  const [cmd, ...args] = argv;
  if (cmd === '--help' || cmd === '-h') {
    deps.log(USAGE);
    return 0;
  }
  if (cmd === 'trace') return trace(args, deps);
  if (cmd === 'fetch') return fetch(args, deps);
  deps.err(USAGE);
  return 2;
}

module.exports = { run };

if (require.main === module) {
  process.exitCode = run({ argv: process.argv.slice(2) });
}
