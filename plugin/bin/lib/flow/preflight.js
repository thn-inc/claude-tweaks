// plugin/bin/lib/flow/preflight.js — one fact pack for /flow's second-call
// preflight (#1931): run-dir adoption (the five cases steps-and-gates.md
// states, their note literals living HERE as the single source), the
// resume-freshness probe, the staged-inventory check, the Manifesto levers,
// the materialized spec, the PR record + phase checklist, the runner stamp,
// and the changed-file set — gathered concurrently into per-field
// {ok, value | error} envelopes. Read-only. Every fs/git/subprocess call
// goes through `deps` so tests inject fakes. Same shape as
// bin/lib/wrap-up/pack.js (#1930).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile: execFileCb, execFileSync } = require('child_process');
const { promisify } = require('util');
const { checkResumeFreshness } = require('../hooks/resume-freshness');
const { checkStagedInventory } = require('../hooks/staged-inventory');
const { readRunState } = require('../hooks/context');
const { resolvePolicyConfig } = require('../policy-schema');
const { computeDerivedDefaults } = require('../policy-derived-defaults');
const { resolveTarget } = require('../stage-item/write');

const BIN = path.join(__dirname, '..', '..');
const VERIFY_JS = path.join(BIN, 'verify.js');
const EXEC_OPTS = { maxBuffer: 32 * 1024 * 1024, timeout: 30000 };

// Outer per-probe bound, mirroring bin/lib/wrap-up/pack.js's own
// withTimeout/PROBE_TIMEOUT_MS (#1930): a hung `gh`/`node verify.js` call
// must not hold the whole pack open forever. Injectable via
// deps.probeTimeoutMs for tests.
const PROBE_TIMEOUT_MS = 60000;

// The Manifesto's lever list (flow/SKILL.md Step 3), minus `mode` (lever 1,
// read separately from config.yml). ceremony-profile is NOT a policy-schema
// key — it is written into config.yml by the Manifesto's header fold
// (source `header`), so it is read from config.yml, not resolved.
const LEVER_KEYS = ['scope-creep', 'overlap', 'design-intent', 'leftover-default', 'auto-fix-threshold', 'review-auto-apply-ceiling', 'tidy-aggressiveness', 'ceremony-profile', 'model-stance', 'merge-verification', 'design-critique', 'merge-authorization'];
const CONFIG_ONLY_LEVERS = new Set(['ceremony-profile']);

// The adoption note lines, verbatim from steps-and-gates.md's five cases —
// this module is their single source; the prose renders them and
// tests/flow-preflight-conformance.test.js pins the two equal. Case 5
// (PIPELINE_RUN_DIR unset) is the creation path and has no note.
const ADOPTION_NOTES = Object.freeze({
  1: 'Resuming existing run directory: {path}',
  2: 'Adopting minted run directory: {path}',
  3: 'Recovering inherited run directory: {path} (missing config.yml; backfilled {worktree registration | PR-early lifecycle | materialize commit} before proceeding).',
  4: 'PIPELINE_RUN_DIR was set to {path}, which {does not exist | is not anchored to the main checkout} — created a fresh run directory instead.',
});
const CASE3_PLACEHOLDER = '{worktree registration | PR-early lifecycle | materialize commit}';
const CASE4_PLACEHOLDER = '{does not exist | is not anchored to the main checkout}';

function defaultDeps(cwd) {
  const execFileAsync = promisify(execFileCb);
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    git: (args, opts = {}) => execFileSync('git', args, { cwd: opts.cwd || cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    execFile: (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...EXEC_OPTS, ...opts }),
    execFileAsync: async (cmd, args, opts = {}) => (await execFileAsync(cmd, args, { cwd, encoding: 'utf8', ...EXEC_OPTS, ...opts })).stdout,
    checkResumeFreshness,
    checkStagedInventory,
    readRunState,
    resolvePolicy: (keys, runDir) => {
      const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
      // Mirrors bin/resolve-policy.js: `integration-model`/`merge-verification`
      // have no static schema default, so the flat resolver leaves them null
      // until computeDerivedDefaults runs. `mcpReachable: false` is what the
      // CLI passes without its own `--mcp-reachable` flag (#1421).
      const { root, result } = resolvePolicyConfig({ git, readFile, runDir, keys });
      computeDerivedDefaults(result, keys, root, { mcpReachable: false });
      return result;
    },
    resolveTarget,
    now: () => Date.now(),
    sessionId: process.env.CLAUDE_CODE_SESSION_ID || null,
  };
}

function readText(deps, file) {
  try { return deps.readFile(file); } catch { return null; }
}

function configValue(text, key) {
  const m = new RegExp(`^${key}:\\s*(\\S+)(?:\\s+#.*)?\\s*$`, 'm').exec(text || '');
  return m ? m[1] : null;
}

function nonEmpty(deps, file) {
  const t = readText(deps, file);
  return t !== null && t.trim().length > 0;
}

// "work/{n}-spec.md committed on the run's branch", checked from the main
// checkout's git ($RUN_ROOT), never the cwd worktree: the branch is the
// PR's recorded branch, else the worktree's current branch. null = unknown.
function specOnBranch(deps, { mainRoot, runDirReal, state }) {
  let branch = state && state.pr && state.pr.branch ? state.pr.branch : null;
  if (!branch && state && typeof state.worktree === 'string') {
    try { branch = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: state.worktree }).trim() || null; } catch { branch = null; }
  }
  if (!branch) return null;
  const rel = path.relative(mainRoot, runDirReal).split(path.sep).join('/');
  const ls = (pathspec, recursive) => {
    const args = ['ls-tree'];
    if (recursive) args.push('-r');
    args.push('--name-only', branch, '--', pathspec);
    try { return deps.git(args, { cwd: mainRoot }); } catch { return null; }
  };
  const direct = ls(`${rel}/work/`, false);
  if (direct === null) return null;
  if (direct.split('\n').some((l) => /(^|\/)work\/\d+-spec\.md$/.test(l))) return true;
  // Multi-spec parent (#1931 I4): /dispatch hands both calls the PARENT run
  // dir, whose spec headers live under `spec-{N}/work/` — a `{rel}/work/`
  // listing is legitimately empty there. `-r` is required: without it a
  // `{rel}/` listing returns the `spec-{N}`/`work` TREE names, never a file
  // path the header regex could match.
  const nested = ls(`${rel}/`, true);
  if (nested === null) return null;
  return nested.split('\n').some((l) => /(^|\/)(spec-\d+\/)?work\/\d+-spec\.md$/.test(l));
}

function computeAdoption({ runDir, mainRoot, cwd, deps }) {
  if (!runDir) return { case: 5, note: null, path: null, anchored: false, hasConfig: false, hasOtherContent: false, specMaterialized: null, backfills: [] };
  const target = deps.resolveTarget({ runDir, cwd, mainRoot });
  if (!target.ok) {
    const why = target.reason === 'missing' ? 'does not exist' : 'is not anchored to the main checkout';
    return { case: 4, note: ADOPTION_NOTES[4].replace('{path}', runDir).replace(CASE4_PLACEHOLDER, why), path: runDir, anchored: false, hasConfig: false, hasOtherContent: false, specMaterialized: null, backfills: [] };
  }
  const real = target.dir;
  const hasConfig = readText(deps, path.join(real, 'config.yml')) !== null;
  const state = deps.readRunState(real);
  const specMaterialized = specOnBranch(deps, { mainRoot, runDirReal: real, state });
  const hasOtherContent = nonEmpty(deps, path.join(real, 'decisions.md')) || nonEmpty(deps, path.join(real, 'events.jsonl')) || specMaterialized === true;
  if (hasConfig) return { case: 1, note: ADOPTION_NOTES[1].replace('{path}', real), path: real, anchored: true, hasConfig, hasOtherContent, specMaterialized, backfills: [] };
  if (!hasOtherContent) return { case: 2, note: ADOPTION_NOTES[2].replace('{path}', real), path: real, anchored: true, hasConfig, hasOtherContent, specMaterialized, backfills: [] };
  const backfills = [];
  if (!state || typeof state.worktree !== 'string') backfills.push('worktree registration');
  if (!state || !state.pr) backfills.push('PR-early lifecycle');
  if (specMaterialized !== true) backfills.push('materialize commit');
  return { case: 3, note: ADOPTION_NOTES[3].replace('{path}', real).replace(CASE3_PLACEHOLDER, backfills.length ? backfills.join(', ') : 'nothing'), path: real, anchored: true, hasConfig, hasOtherContent, specMaterialized, backfills };
}

function parseChecklist(body) {
  const start = (body || '').indexOf('<!-- phases-start -->');
  const end = (body || '').indexOf('<!-- phases-end -->');
  if (start === -1 || end === -1 || end < start) return [];
  const rows = [];
  for (const line of body.slice(start, end).split('\n')) {
    const m = /^- \[([ xX])\] ([a-z-]+)\s*$/.exec(line.trim());
    if (m) rows.push({ phase: m[2], done: m[1].toLowerCase() === 'x' });
  }
  return rows;
}

async function wrapProbe(name, fn, now) {
  const t0 = now();
  try {
    const value = await fn();
    return { ok: true, value, durationMs: now() - t0 };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err), durationMs: now() - t0 };
  }
}

// Timer is cleared on every settle path so a fast probe never holds the
// event loop open past its own resolution.
function withTimeout(fn, ms) {
  return () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    Promise.resolve().then(fn).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// Which subprocess seam to use: an injected async seam wins; an injected
// SYNC `execFile` fake (the unit tests' usual shape) must not be shadowed by
// the default async seam, so it is wrapped; only with neither injected does
// the real async seam run (concurrent by construction).
function pickExec(overrides, deps) {
  if (overrides.execFileAsync) return overrides.execFileAsync;
  if (overrides.execFile) return async (cmd, args, opts) => overrides.execFile(cmd, args, opts);
  return deps.execFileAsync;
}

function buildProbes({ runDirReal, runId, mainRoot, cwd, config, state, deps, exec }) {
  // One resolvePolicy call per pack (#1931 M5): the levers and the
  // changed-files integration branch resolve together, memoized (throws
  // included, so a failure degrades both fields without a second call).
  const POLICY_KEYS = [...LEVER_KEYS.filter((k) => !CONFIG_ONLY_LEVERS.has(k)), 'integration-branch'];
  const worktreeCwd = state && typeof state.worktree === 'string' ? state.worktree : cwd;
  let policyMemo;
  const policy = () => {
    if (policyMemo === undefined) {
      try { policyMemo = { ok: true, value: deps.resolvePolicy(POLICY_KEYS, runDirReal) || {} }; } catch (err) { policyMemo = { ok: false, err }; }
    }
    if (!policyMemo.ok) throw policyMemo.err;
    return policyMemo.value;
  };
  return {
    freshness: () => {
      const r = deps.checkResumeFreshness(runDirReal, { sessionId: deps.sessionId || null });
      const line = r.safe
        ? `claude-tweaks: resume freshness OK for ${runId} (${r.verdict})`
        : `claude-tweaks: resume freshness BLOCKED for ${runId} — run appears actively owned (${r.reason})`;
      return { verdict: r.safe ? 'OK' : 'BLOCKED', detail: r.verdict, reason: r.reason || null, line };
    },
    inventory: () => {
      const r = deps.checkStagedInventory(runDirReal);
      const status = r.missing.length === 0 ? 'OK' : 'MISMATCH';
      const line = status === 'OK'
        ? `claude-tweaks: staged inventory OK for ${runId} (${r.checked} STAGED entries)`
        : `claude-tweaks: staged inventory MISMATCH for ${runId} — ${r.missing.length} of ${r.checked} STAGED entries missing from staged/: ${r.missing.join(', ')}`;
      return { status, checked: r.checked, missing: r.missing, line };
    },
    levers: () => {
      const resolved = policy();
      return LEVER_KEYS.map((key) => {
        if (CONFIG_ONLY_LEVERS.has(key)) {
          const value = configValue(config, key);
          return value === null ? { key, value: null, source: null, error: 'absent from config.yml' } : { key, value, source: 'header' };
        }
        const entry = resolved[key];
        if (!entry || entry.error !== undefined) return { key, value: null, source: null, error: entry && entry.error ? String(entry.error) : 'unresolved' };
        return { key, value: entry.value === undefined ? null : entry.value, source: entry.source || 'default' };
      });
    },
    spec: () => {
      const headers = (dir) => deps.readdir(dir).filter((n) => /^\d+-spec\.md$/.test(n)).sort();
      const names = headers(path.join(runDirReal, 'work'));
      if (names.length) {
        const record = Number(names[0].split('-')[0]);
        return { path: `work/${names[0]}`, present: true, record, records: [record] };
      }
      // Multi-spec parent (#1931 I4): /dispatch hands both calls the PARENT
      // run dir; its headers live one level down, under `spec-{N}/work/`
      // (multi-spec.md). `record`/`path` stay null — a parent has no single
      // one — and `records` carries every header found.
      const records = [];
      for (const sub of deps.readdir(runDirReal).filter((n) => /^spec-\d+$/.test(n))) {
        for (const n of headers(path.join(runDirReal, sub, 'work'))) records.push(Number(n.split('-')[0]));
      }
      records.sort((a, b) => a - b);
      if (records.length) return { path: null, present: true, record: null, records };
      return { path: null, present: false, record: null, records: [] };
    },
    pr: async () => {
      if (!state || !state.pr || !state.pr.number) return null;
      let raw;
      try { raw = await exec('gh', ['pr', 'view', String(state.pr.number), '--json', 'state,isDraft,body'], { cwd: mainRoot }); } catch (err) {
        if (err && err.code === 'ENOENT') throw new Error('gh-absent');
        throw err;
      }
      const view = JSON.parse(raw);
      return { number: state.pr.number, url: state.pr.url || null, branch: state.pr.branch || null, state: view.state, isDraft: view.isDraft, checklist: parseChecklist(view.body) };
    },
    stamp: async () => JSON.parse(await exec('node', [VERIFY_JS, '--stamp-status'], { cwd: worktreeCwd })),
    changedFiles: async () => {
      const ib = policy()['integration-branch'];
      const branch = ib && ib.value ? String(ib.value) : 'main';
      return JSON.parse(await exec('node', [VERIFY_JS, '--changed-files', '--integration-branch', branch], { cwd: worktreeCwd }));
    },
  };
}

// `mainRoot` has NO default (#1931 M1): an explicit `null` would both disable
// resolveTarget's own anchoring and throw inside path.relative(); leaving it
// undefined lets resolveTarget derive the main-checkout anchor from `cwd`.
async function gatherPreflight({ runDir, steps = [], cwd = process.cwd(), mainRoot, deps: overrides = {} }) {
  const deps = { ...defaultDeps(cwd), ...overrides };
  const limit = Number.isFinite(deps.probeTimeoutMs) ? deps.probeTimeoutMs : PROBE_TIMEOUT_MS;
  const t0 = deps.now();
  const adoption = computeAdoption({ runDir, mainRoot, cwd, deps });
  const runDirReal = adoption.path && adoption.anchored ? adoption.path : null;
  const runId = runDirReal ? path.basename(runDirReal) : null;
  const config = runDirReal ? readText(deps, path.join(runDirReal, 'config.yml')) : null;
  const state = runDirReal ? deps.readRunState(runDirReal) : null;
  const pack = { generatedAt: new Date(deps.now()).toISOString(), steps: [...steps], mode: configValue(config, 'mode'), adoption: { ok: true, value: adoption, durationMs: deps.now() - t0 } };
  if (!runDirReal) {
    // Cases 4/5: nothing to probe — every probe field reports why.
    for (const k of ['freshness', 'inventory', 'levers', 'spec', 'pr', 'stamp', 'changedFiles']) pack[k] = { ok: false, error: 'run dir not adopted (adoption case ' + adoption.case + ')', durationMs: 0 };
    pack.durationMs = deps.now() - t0;
    return pack;
  }
  const probes = buildProbes({ runDirReal, runId, mainRoot, cwd, config, state, deps, exec: pickExec(overrides, deps) });
  const names = Object.keys(probes);
  const results = await Promise.all(names.map((n) => wrapProbe(n, withTimeout(probes[n], limit), deps.now)));
  names.forEach((n, i) => { pack[n] = results[i]; });
  pack.durationMs = deps.now() - t0;
  return pack;
}

module.exports = { ADOPTION_NOTES, LEVER_KEYS, computeAdoption, parseChecklist, gatherPreflight, defaultDeps };
