#!/usr/bin/env node
// bin/resolve-policy.js
//
// The canonical read path for .claude-tweaks/policy.yml and pipeline-run
// config.yml overlays (#329). A thin shell — argument parsing plus file
// reads over two library calls: bin/lib/policy-schema.js#resolvePolicyKeys
// (all precedence/alias/validation logic) and
// bin/lib/model-profiles/policy-fragment.js#parsePolicyModelConfig (the
// model-profiles nested-block key; risk-path-globs, the other, resolves inside
// resolvePolicyKeys). No resolution logic lives here. Zero runtime npm deps.
// Exports { resolvePolicy, run, realDeps }: resolvePolicy is the core and returns an
// object (it prints nothing), run parses argv and prints, realDeps is the production
// deps map. The entry contract is .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
//
// Usage: resolve-policy.js [--values | --all] [--mcp-reachable] [--run <dir>] <key> [<key>…]
// Output: one JSON object on stdout keyed by requested name — or, with
// --values, one plain value per line in request order (scalar mode for shell
// captures; empty line for unset-no-default and error entries; not valid for
// model-profiles or risk-path-globs). --values also writes one stderr warning per requested key
// holding a present-but-invalid value (`resolve-policy: warning: {key} has
// invalid value "{raw}" — using default "{value}"`); stdout and the exit code
// are unchanged, and JSON and --all modes write no warning. --all emits
// every POLICY_KEYS entry, each decorated with its schema metadata
// (summary/category/tier/type/default); mutually exclusive with --values and
// takes no key arguments. Per-key errors ({"error": "unknown-key"}) are data
// (exit 0). Invocation failures — zero keys, a --run dir that does not exist,
// or a --run path that resolves inside a checkout other than the main
// checkout (#1065's anchored-or-outside guard) — exit 1 with a stderr message
// and no JSON. A degraded forge detection (#4578 — `gh` timed out, then failed
// its retry, so the 'local-merge' answer is a guess rather than a detection)
// writes one stderr line per affected key, in every output mode (stdout and the
// exit code unchanged): `resolve-policy: degraded — {key}: {reason text};
// resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or
// raise gh-timeout-ms`. It applies to integration-model and to a merge-
// verification request that runs its own detection (a merge-verification that
// reuses a degraded integration-model from the same call carries the field
// only — no second line); JSON entries gain the
// additive `degraded: 'timeout' | 'timeout-then-exit'` reason code, and a
// non-degraded entry keeps exactly { value, source }. merge-verification's
// own detection honours a valid --run config.yml integration-model pin first.
// Repo root comes from `git rev-parse --show-toplevel` at the
// process cwd (cwd itself outside a git repo) — never from CLAUDE_PLUGIN_ROOT
// (observed unset in Bash tool environments, #170) and never from a
// positional path argument.
// --mcp-reachable asserts the caller has already confirmed GitHub
// reachability via its own MCP probe (e.g. a bounded `list_issues`/`get_me`
// call) inside the current agent turn — pass it only when that probe
// succeeded; it forwards into detectIntegrationModel's mcpReachable override
// for the integration-model key, and (via resolveIntegrationModel) for
// merge-verification too whenever that key is derived in the same call.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { POLICY_KEYS, resolvePolicyConfig, formatForgeDegrade } = require('./lib/policy-schema');
const { computeDerivedDefaults } = require('./lib/policy-derived-defaults');
const { parsePolicyModelConfig } = require('./lib/model-profiles/policy-fragment');
const { anchoredOrOutsideMessage } = require('./lib/run-dir-guard');

// The nested-block keys: no scalar form under --values.
const BLOCK_KEYS = POLICY_KEYS.filter((row) => row.type === 'map').map((row) => row.key);

function gitRoot(args, { cwd, env } = {}) {
  return execFileSync('git', args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
    windowsHide: true,
  });
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// The core: resolves `keys` against policy.yml, the optional run config and forge
// detection, and returns { code: 0, result, invalidRaw, degrades } or
// { code: 1, message } (message is the text after `resolve-policy: `). It prints
// nothing. deps: cwd(), env, git(args, { cwd, env }), readFile(path), and optional
// stderr(text) and homeDir() that the library lookups receive.
function resolvePolicy({ keys, runDir = null, mcpReachable = false }, deps) {
  const cwd = deps.cwd();
  // #1065: anchored-or-outside guard — runs before the existence check and any
  // config.yml read. The raw runDir string is kept for the "does not exist"
  // message, which echoes the value as given; the reject message here names the
  // realpath-resolved candidate instead.
  let runDirPath = null;
  if (runDir !== null) {
    const message = anchoredOrOutsideMessage(runDir, cwd, '--run');
    if (message) return { code: 1, message };
    runDirPath = path.resolve(cwd, runDir);
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(runDirPath).isDirectory();
    } catch {}
    if (!isDirectory) {
      // A file path (e.g. the config.yml itself) must fail loud here, not
      // degrade to a silent no-overlay with policy-source answers.
      return { code: 1, message: `--run dir does not exist or is not a directory: ${runDir}` };
    }
  }

  // A run dir without a config.yml is not an error — the Manifesto may not
  // have written one yet; readFileSafe's null simply means no overlay.
  // #4141: the rejected raw value rides a side channel, so the entry shape
  // stays exactly as the JSON output documents it.
  const invalidRaw = new Map();
  const { root, policyRaw, runConfigRaw, result } = resolvePolicyConfig({
    git: (args) => deps.git(args, { cwd, env: deps.env }),
    readFile: deps.readFile,
    runDir: runDirPath,
    keys,
    onInvalid: (key, raw) => invalidRaw.set(key, raw),
    cwd,
  });

  // integration-model / merge-verification have no static schema default
  // (skills/_shared/integration-model.md; #559) — an absent value (never a
  // typo'd/invalid one; `invalid: true` stays visible as an error, never
  // silently overwritten) is computed via forge detection / the four-branch
  // derivation ladder instead of a literal, with merge-verification reusing
  // this call's own integration-model result to avoid running forge
  // detection twice per invocation. Extracted into bin/lib/policy-derived-
  // defaults.js (#604) so the dedup is unit-testable via an injectable deps
  // map — see that module for the full block. mcpReachable forwards through
  // so both keys' forge detection can skip the `gh` probe within this call
  // (--mcp-reachable, #1421). #4578: runConfigRaw lets merge-verification's own
  // detection honour the run's integration-model pin first, and the degrade
  // collector (a Map, so a key requested twice reports once) carries the full
  // degrade object the entry's bare `degraded` reason code cannot.
  const degrades = new Map();
  computeDerivedDefaults(result, keys, root, {
    mcpReachable,
    runConfigRaw,
    onDegrade: (key, degrade) => degrades.set(key, degrade),
    env: deps.env,
    ...(deps.stderr ? { stderr: deps.stderr } : {}),
    ...(deps.homeDir ? { homeDir: deps.homeDir } : {}),
  });

  // model-profiles is a block-style key — policy-only (the --run
  // overlay never applies; run configs hold flat lever lines, not nested
  // blocks; risk-path-globs is policy-only the same way). Overwrite the flat
  // resolver's placeholder entry via the dedicated fragment reader.
  if (keys.includes('model-profiles')) {
    try {
      const parsed = parsePolicyModelConfig(policyRaw);
      result['model-profiles'] = Object.prototype.hasOwnProperty.call(parsed, 'model-profiles')
        ? { value: parsed['model-profiles'], source: 'policy' }
        : { value: null, source: 'default' };
    } catch {
      // Any fragment-reader throw lands here — a malformed block, but also a
      // malformed sibling model key (e.g. frontier-run-cap), since the reader
      // parses all four model keys and its throws aren't sub-classified. Same
      // present-but-rejected carve-out as flat keys; the key has no schema
      // default — null is the documented absent shape.
      result['model-profiles'] = { value: null, source: 'default', invalid: true };
    }
  }

  return { code: 0, result, invalidRaw, degrades };
}

function run(argv, deps = realDeps) {
  const fail = (msg) => {
    deps.stderr(`resolve-policy: ${msg}\n`);
    return 1;
  };
  const args = [...argv];
  let runDir = null;
  let valuesMode = false;
  let allMode = false;
  let mcpReachable = false;
  const keys = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--run') {
      const value = args.shift();
      // A blank or whitespace-only value (the shape an unset
      // $PIPELINE_RUN_DIR expands to in shell) is rejected the same as a
      // genuinely missing one — it must never reach the --run anchoring
      // check as a blank string (#1138).
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        return fail('--run requires a value');
      }
      runDir = value;
    } else if (arg === '--values') {
      valuesMode = true;
    } else if (arg === '--all') {
      allMode = true;
    } else if (arg === '--mcp-reachable') {
      mcpReachable = true;
    } else {
      // A key argument may be a single lever or a comma-joined list
      // (`--values a,b,c`) — both shapes collect into the same flat key list,
      // so the two output modes share one parse (#1248). Empty segments (a
      // trailing or doubled comma) are dropped rather than becoming an
      // unknown-key entry.
      keys.push(...arg.split(',').filter(Boolean));
    }
  }
  if (allMode && valuesMode) {
    return fail('--all and --values are mutually exclusive — --all always emits the JSON object');
  }
  if (allMode && keys.length > 0) {
    return fail('--all takes no key arguments — it already emits every schema key');
  }
  if (allMode) keys.push(...POLICY_KEYS.map((row) => row.key));
  if (keys.length === 0) {
    return fail('usage: resolve-policy.js [--values | --all] [--mcp-reachable] [--run <dir>] <key> [<key>…]');
  }
  const blockKey = BLOCK_KEYS.find((key) => keys.includes(key));
  if (valuesMode && blockKey) {
    // A nested-block key has no scalar form.
    return fail(`--values does not support ${blockKey} (no scalar form) — use the JSON output`);
  }

  const out = resolvePolicy({ keys, runDir, mcpReachable }, deps);
  if (out.code !== 0) return fail(out.message);
  const { result, invalidRaw, degrades } = out;

  // One stderr line per degraded key, in every output mode; stdout is unchanged.
  for (const key of ['integration-model', 'merge-verification']) {
    if (!degrades.has(key)) continue;
    deps.stderr(`resolve-policy: degraded — ${key}: ${formatForgeDegrade(degrades.get(key))}; resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms\n`);
  }

  if (valuesMode) {
    // #4141: a rejected value still prints its schema default on stdout, so
    // name each rejected key on stderr — the caller otherwise cannot tell a
    // typo from an intentional default. Every `invalid` entry reaching here
    // came through resolvePolicyKeys's invalid branch, so its raw value is
    // recorded (the block keys are rejected above in --values mode).
    for (const key of keys) {
      const entry = result[key];
      if (!entry || !entry.invalid) continue;
      const shownDefault = entry.value ?? '(none)';
      deps.stderr(`resolve-policy: warning: ${key} has invalid value "${invalidRaw.get(key)}" — using default "${shownDefault}"\n`);
    }
    // Scalar mode for shell-variable capture at prose read sites: one value
    // per line, request order. An {error} entry and a null value (no-default
    // key unset) both print an empty line — mirroring the empty string the
    // retired grep-pipeline idiom produced for an absent key.
    const lines = keys.map((key) => {
      const entry = result[key];
      if (!entry || entry.error !== undefined || entry.value === null || entry.value === undefined) return '';
      return String(entry.value);
    });
    deps.stdout(`${lines.join('\n')}\n`);
    return 0;
  }

  if (allMode) {
    const decorated = {};
    for (const row of POLICY_KEYS) {
      decorated[row.key] = {
        ...result[row.key],
        summary: row.summary,
        category: row.category,
        tier: row.tier,
        type: row.type,
        default: row.default ?? null,
      };
    }
    deps.stdout(`${JSON.stringify(decorated)}\n`);
    return 0;
  }

  deps.stdout(`${JSON.stringify(result)}\n`);
  return 0;
}

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  homeDir: () => os.homedir(),
  git: gitRoot,
  readFile: readFileSafe,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

module.exports = { resolvePolicy, run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
