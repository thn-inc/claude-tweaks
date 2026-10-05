'use strict';
// bin/lib/impeccable-engine/index.js — find and run Impeccable's design engine
// (plugin 4.2.2+) without ever downloading it. One module every design-wrapper
// consumer uses: resolve() answers "where is the active install and its engine
// binary?", run() shells out to one of four documented verbs and validates the
// output's shape. Neither function throws — every failure is a returned value
// ({ok: false, reason, ...}), following the seam convention in
// bin/link-records.js ("argv -> exit code. All I/O through deps so tests never
// touch gh or git.") applied here to filesystem + process I/O instead.
//
// ASSUMPTION resolution (record #2979 Gotchas — "verify at build"): empirically
// checked ~/.claude/plugins/installed_plugins.json on the authoring machine
// (2026-10-05). Several historical entries carry a project-scope `projectPath`
// pointing at a `.claude/worktrees/*` path (e.g. the `impeccable@impeccable`
// entries for `claude-tweaks/.claude/worktrees/dispatch-422`,
// `.../flow+spec-332-602-334`, `.../dispatch-record-2221`, each with its OWN
// `installPath`/version, distinct from the main checkout's entry) — Claude Code
// does NOT always collapse a worktree session's projectPath to the main
// checkout. The spec's original algorithm (match project-scope entries against
// a forced `mainCheckoutRoot`) would therefore miss a worktree-specific
// install. The observed rule implemented below instead matches against the
// CALLING session's own project path (`opts.projectPath` — default
// `deps.cwd()`, i.e. the real working directory, worktree or not), with the
// same ancestor-or-equal + longest-match precedence the spec described — this
// generalizes correctly to both shapes (an entry keyed to the worktree itself,
// or one keyed to the main checkout that the worktree sits under).

const path = require('path');

// Frozen contract — sibling sub-issues of #2979 document and test against
// these exact strings. Treat any rename or addition as a breaking change.
const FAILURE_REASONS = Object.freeze([
  'not-installed',
  'upgrade-required',
  'engine-not-installed',
  'shape-mismatch',
  'exec-failed',
  'timeout',
]);

const VERBS = Object.freeze(['signals', 'doctor', 'concept-seed', 'surface-brief']);

const NOT_INSTALLED_FIX = '/plugin install impeccable@impeccable (Impeccable 4.2.2 or later)';

const CONCEPT_SEED_ALLOWED_FLAGS = Object.freeze(['--scope', '--mode', '--from', '--candidate-count']);

const DEFAULT_TIMEOUT_MS = 60000;

function defaultDeps() {
  const fs = require('fs');
  const os = require('os');
  const { execFileSync } = require('child_process');
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    exists: (p) => fs.existsSync(p),
    realpath: (p) => fs.realpathSync(p),
    homedir: () => os.homedir(),
    cwd: () => process.cwd(),
    // spawn(cmd, args, options) -> stdout string; throws on non-zero exit,
    // timeout (err.killed/err.signal), or launch failure (err.code).
    spawn: (cmd, args, options) => execFileSync(cmd, args, options),
  };
}

function safeRealpath(p, deps) {
  try {
    return deps.realpath(p);
  } catch {
    return p;
  }
}

function readInstalledPlugins(deps) {
  const file = path.join(deps.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  if (!deps.exists(file)) return { ok: false, detail: `not found: ${file}` };
  let raw;
  try {
    raw = deps.readFile(file);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, detail: `malformed JSON (${err.message})` };
  }
}

// Project-scope entries whose projectPath is an ancestor of (or equal to)
// `projectPath`, longest `projectPath` wins; falls back to the user-scope
// entry; absent either, null.
function selectEntry(entries, projectPath, deps) {
  const target = safeRealpath(projectPath, deps);
  let best = null;
  let bestLen = -1;
  for (const entry of entries) {
    if (entry.scope !== 'project' || typeof entry.projectPath !== 'string') continue;
    const candidate = safeRealpath(entry.projectPath, deps);
    const rel = path.relative(candidate, target);
    const isAncestorOrSelf = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    if (isAncestorOrSelf && candidate.length > bestLen) {
      best = entry;
      bestLen = candidate.length;
    }
  }
  if (best) return best;
  return entries.find((e) => e.scope === 'user') || null;
}

function launcherPath(installPath) {
  const name = process.platform === 'win32' ? 'impeccable.cmd' : 'impeccable';
  return path.join(installPath, 'skills', 'impeccable', 'scripts', name);
}

// Shared by every launcher call — the probe and each verb all carry
// IMPECCABLE_LAUNCHER_PROBE=1.
function spawnOptions(cwd, opts) {
  return {
    cwd,
    env: Object.assign({}, process.env, { IMPECCABLE_LAUNCHER_PROBE: '1' }),
    encoding: 'utf8',
    timeout: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
  };
}

// opts: { projectPath, timeoutMs }. deps: { readFile, exists, realpath,
// homedir, cwd, spawn }.
function resolve(opts = {}, deps = defaultDeps()) {
  const read = readInstalledPlugins(deps);
  if (!read.ok) {
    return { ok: false, reason: 'not-installed', fix: NOT_INSTALLED_FIX, detail: read.detail };
  }
  const entries = (read.data && read.data.plugins && read.data.plugins['impeccable@impeccable']) || [];
  const projectPath = opts.projectPath || deps.cwd();
  const entry = selectEntry(entries, projectPath, deps);
  if (!entry) {
    return { ok: false, reason: 'not-installed', fix: NOT_INSTALLED_FIX };
  }
  const launcher = launcherPath(entry.installPath);
  if (!deps.exists(launcher)) {
    return {
      ok: false,
      reason: 'upgrade-required',
      fix: `/plugin update impeccable@impeccable to 4.2.2 or later (missing ${launcher})`,
    };
  }
  let stdout;
  try {
    stdout = deps.spawn(launcher, ['engine-probe'], spawnOptions(projectPath, opts));
  } catch (err) {
    return {
      ok: false,
      reason: 'engine-not-installed',
      fix: `${launcher} engine-probe`,
      detail: err && err.message,
    };
  }
  const match = /impeccable-engine\s+(\S+)/.exec(String(stdout));
  return {
    ok: true,
    pluginRoot: entry.installPath,
    launcher,
    pluginVersion: entry.version,
    engineVersion: match ? match[1] : null,
    scope: entry.scope,
  };
}

// Each verb's own argv shape — the module hardcodes/filters args per verb
// rather than forwarding whatever the caller passed, which is what makes
// `doctor --fix` inert at this layer even before the CLI's own usage gate
// (bin/impeccable-engine.js) rejects it outright.
function buildArgs(verb, args) {
  if (verb === 'doctor') return ['doctor', '--json'];
  if (verb === 'signals') return ['signals'];
  if (verb === 'surface-brief') return ['surface-brief', 'read', ...args];
  if (verb === 'concept-seed') {
    const out = ['concept-seed'];
    for (let i = 0; i < args.length; i++) {
      if (CONCEPT_SEED_ALLOWED_FLAGS.includes(args[i])) {
        out.push(args[i]);
        if (i + 1 < args.length) out.push(args[++i]);
      }
    }
    return out;
  }
  return [verb, ...args];
}

// Each verb's accepted argument shape — the CLI's usage-error gate
// (bin/impeccable-engine.js). Returns {ok:false} for an unknown verb too.
// Shares CONCEPT_SEED_ALLOWED_FLAGS with buildArgs' defensive filtering.
function validateVerbArgs(verb, args) {
  if (verb === 'signals' || verb === 'doctor') {
    return { ok: args.length === 0 };
  }
  if (verb === 'concept-seed') {
    if (args.length % 2 !== 0) return { ok: false };
    for (let i = 0; i < args.length; i += 2) {
      if (!CONCEPT_SEED_ALLOWED_FLAGS.includes(args[i])) return { ok: false };
    }
    return { ok: true };
  }
  if (verb === 'surface-brief') {
    return { ok: args.length === 1 };
  }
  return { ok: false };
}

function validateSignals(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, field: '(invalid JSON)' };
  }
  if (obj === null || typeof obj !== 'object') return { ok: false, field: '(invalid JSON)' };
  for (const key of ['setup', 'critique', 'git', 'devServer']) {
    if (!(key in obj) || obj[key] === null || typeof obj[key] !== 'object') {
      return { ok: false, field: key };
    }
  }
  const setup = obj.setup;
  const checks = [
    ['hasProduct', (v) => typeof v === 'boolean'],
    ['productPath', (v) => v === null || typeof v === 'string'],
    ['hasDesign', (v) => typeof v === 'boolean'],
    ['designPath', (v) => v === null || typeof v === 'string'],
    ['hasCode', (v) => typeof v === 'boolean'],
    ['platform', (v) => v === null || ['web', 'ios', 'android', 'adaptive'].includes(v)],
  ];
  for (const [field, ok] of checks) {
    if (!(field in setup) || !ok(setup[field])) return { ok: false, field: `setup.${field}` };
  }
  return { ok: true, value: obj };
}

function validateDoctor(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, field: '(invalid JSON)' };
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.findings)) {
    return { ok: false, field: 'findings' };
  }
  for (let i = 0; i < obj.findings.length; i++) {
    const finding = obj.findings[i];
    if (!finding || typeof finding !== 'object' || typeof finding.severity !== 'string') {
      return { ok: false, field: `findings[${i}].severity` };
    }
  }
  return { ok: true, value: obj };
}

const CONCEPT_SEED_HEADER_RE = /CONCEPT SEED \(key: [^)]+\)/;

function validateConceptSeed(text) {
  const lines = String(text).split('\n');
  const firstNonEmpty = lines.find((l) => l.trim() !== '');
  if (firstNonEmpty === undefined || !CONCEPT_SEED_HEADER_RE.test(firstNonEmpty)) {
    return { ok: false, field: '(first line)' };
  }
  return { ok: true, value: text };
}

function validateSurfaceBrief(text) {
  return { ok: true, value: text };
}

const VALIDATORS = {
  signals: validateSignals,
  doctor: validateDoctor,
  'concept-seed': validateConceptSeed,
  'surface-brief': validateSurfaceBrief,
};

// opts: { projectPath, timeoutMs, projectRoot }. deps: as resolve().
function run(verb, args = [], opts = {}, deps = defaultDeps()) {
  if (!VERBS.includes(verb)) {
    return { ok: false, reason: 'exec-failed', detail: `unknown verb: ${verb}` };
  }
  const resolved = resolve(opts, deps);
  if (!resolved.ok) return resolved;
  const cwd = opts.projectRoot || opts.projectPath || deps.cwd();
  let stdout;
  try {
    stdout = deps.spawn(resolved.launcher, buildArgs(verb, args), spawnOptions(cwd, opts));
  } catch (err) {
    if (err && (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT')) {
      return { ok: false, reason: 'timeout' };
    }
    const stderrText = String((err && err.stderr) || (err && err.message) || '');
    const lastLines = stderrText.split('\n').slice(-20).join('\n');
    return { ok: false, reason: 'exec-failed', detail: `exit ${err && err.status}: ${lastLines}` };
  }
  const result = VALIDATORS[verb](stdout);
  if (!result.ok) return { ok: false, reason: 'shape-mismatch', detail: result.field };
  return { ok: true, value: result.value };
}

module.exports = {
  resolve,
  run,
  FAILURE_REASONS,
  VERBS,
  validateVerbArgs,
  defaultDeps,
};
