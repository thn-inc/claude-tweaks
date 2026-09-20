#!/usr/bin/env node
// plugin/bin/release-preflight.js — /claude-tweaks:release Step 1's fact pack
// (#2255): engine, last tag, unreleased commits, proposed version, open
// release PR, CI on the tip, human-edited release PR, hook presence — one
// process, one JSON, per-field {ok, value | error} envelopes. Read-only apart
// from the pack file. Exit 0 whenever the pack was produced (a degraded
// field is data the skill acts on, never an exit code), 2 on a malformed
// invocation, 3 when --run / PIPELINE_RUN_DIR does not resolve under the
// main checkout ([IL-127]/[IL-150] — decided on the real path) or the cwd is
// not inside a git checkout at all. An undecided crash — a throw that reaches
// the top level rather than a decided outcome — is exit 1, as in both sibling
// packs: the 0/2/3 vocabulary governs outcomes this CLI decided. The pack
// itself always goes to stdout; with no run dir the file goes to a fresh
// scratch directory under the system temp dir (run-directory-fact-packs'
// documented fallback) and only that path is printed on stderr.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { gatherReleasePreflight, PROBE_NAMES } = require('./lib/release-preflight/pack');
const { resolveTarget } = require('./lib/stage-item/write');
const { safeReal } = require('./lib/hooks/worktree-detect');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: release-preflight.js [--run <dir>] [--json <path>] [--only <probe,...>]';
const FILE = 'release-preflight.json';

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { run: null, json: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--run' || flag === '--json' || flag === '--only') {
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      if (flag === '--only') {
        const names = value.split(',').map((s) => s.trim()).filter(Boolean);
        // `--only ,` asks for nothing at all. Gathering every probe instead
        // would silently answer a different question than the one asked.
        if (names.length === 0) throw new UsageError(`${flag} names no probes (known: ${PROBE_NAMES.join(', ')})`);
        const bad = names.find((n) => !PROBE_NAMES.includes(n));
        if (bad) throw new UsageError(`unknown probe: ${bad} (known: ${PROBE_NAMES.join(', ')})`);
        out.only = names;
      } else {
        out[flag.slice(2)] = value;
      }
      i += 1;
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  return out;
}

// The checkout root, or null when `cwd` is not inside one. Returns the root
// rather than a boolean so the pack can be handed the answer instead of
// spawning the identical rev-parse a second time.
function insideGitCheckout(cwd) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

async function run(argv, deps = {}) {
  const cwd = deps.cwd || (() => process.cwd());
  const env = deps.env || process.env;
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const mkdtemp = deps.mkdtemp || ((prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const inCheckout = deps.insideGitCheckout || insideGitCheckout;
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(`release-preflight.js: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  const root = inCheckout(cwd());
  if (!root) {
    stderr('release-preflight.js: not inside a git checkout — nothing written\n');
    return 3;
  }
  // --run, else PIPELINE_RUN_DIR, else a fresh scratch dir. Both explicit
  // sources must resolve under the main checkout (exit 3), exactly as the
  // sibling packs demand; the scratch fallback is what the pattern permits
  // when no run directory exists to anchor to.
  let dir;
  let scratch = false;
  const requested = o.run || env.PIPELINE_RUN_DIR || null;
  if (requested) {
    const target = resolveTarget({ runDir: requested, cwd: cwd(), mainRoot: deps.mainRoot });
    if (!target.ok) {
      stderr(`release-preflight.js: run dir ${requested} refused (${target.reason === 'missing' ? 'missing' : 'not anchored under the main checkout'}) — nothing written\n`);
      return 3;
    }
    dir = target.dir;
  } else {
    dir = mkdtemp('release-preflight-');
    scratch = true;
  }
  let file = path.join(dir, FILE);
  if (o.json) {
    const wanted = path.resolve(cwd(), o.json);
    const parent = safeReal(path.dirname(wanted));
    if (!parent || !resolveTarget({ runDir: parent, cwd: cwd(), mainRoot: deps.mainRoot }).ok) {
      stderr(`release-preflight.js: --json ${o.json} refused (its directory does not resolve under the main checkout) — nothing written\n`);
      return 3;
    }
    file = path.join(parent, path.basename(wanted));
  }
  // A scratch directory is not a run directory: it holds no pinned config.yml,
  // so the pack resolves policy.yml alone there.
  const pack = await gatherReleasePreflight({ cwd: cwd(), only: o.only, deps: deps.packDeps || {}, root, runDir: scratch ? null : dir });
  const text = `${JSON.stringify(pack, null, 2)}\n`;
  writeFileAtomic(file, text);
  if (scratch) stderr(`release-preflight.js: no run directory resolved — ${FILE} written to ${file}\n`);
  stdout(text);
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.stderr.write(`release-preflight.js: ${err && err.stack ? err.stack : err}\n`); process.exitCode = 1; });
}

module.exports = { run, parseArgs, USAGE };
