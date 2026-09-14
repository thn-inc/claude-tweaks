// plugin/bin/lib/wrap-up/pack.js — one deterministic fact pack for
// /claude-tweaks:wrap-up's Phases 3-4 (#1930). The runner owns execution and
// bounding, the skill owns judgment: eight independent reads run concurrently
// and come back as one JSON document with a per-probe envelope — a failing
// probe degrades its own field, never the pack. Read-only by construction:
// nothing here releases a claim, archives, posts, or appends the shipped
// record. Every subprocess and fs read goes through `deps` so tests inject
// fakes. Named pack.js because bin/lib/wrap-up/facts.js (the curation-gate
// facts) already exists.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile: execFileCb, execFileSync } = require('child_process');
const { promisify } = require('util');
const { resolvePolicyConfig } = require('../policy-schema');
const { parseManifestYaml } = require('../flow/manifest');
const { parseDependencies } = require('../issues/record');

const PROBE_NAMES = ['residue', 'state', 'blastRadius', 'pr', 'recordLabels', 'claim', 'ledger', 'unblocked'];
const BIN = path.join(__dirname, '..', '..');

// Every subprocess this module spawns is bounded the same way: a 32 MB stdout
// ceiling (a `gh issue list --limit 200` of long bodies overruns Node's 1 MB
// default and comes back as a truncation error) and a 30 s wall clock, so one
// hung `gh` can never hold the whole pack open.
// Merged with `cwd` at each call site; never mutated.
const EXEC_OPTS = { maxBuffer: 32 * 1024 * 1024, timeout: 30000 };

// The per-probe outer bound, one level above EXEC_OPTS: a probe that makes no
// subprocess call at all (a module probe spinning, an fs read on a dead mount)
// is still bounded. Injectable via deps.probeTimeoutMs for tests.
const PROBE_TIMEOUT_MS = 60000;

// The policy levers the pack reads, resolved ONCE per run in resolveInputs and
// stored on inputs.policy — no probe resolves policy for itself (#1930 review
// I8: three synchronous resolve-policy.js spawns, one of them mid-fan-out).
// work-backend is deliberately NOT here: see WORK_BACKEND_RE below.
const POLICY_KEYS = ['integration-branch', 'work-links'];

// work-backend does not live in policy.yml. `_shared/work-record-config.md`'s
// "Where these live" states it is read from CLAUDE.md and is absent from
// policy-schema.js's POLICY_KEYS — so resolve-policy.js answers
// `{"error":"unknown-key"}` for it, and the pack's original policy lookup
// resolved '' on every repo, silently degrading every forge probe to
// `no-forge` (#1930 review E1). No reader for this key exists anywhere in
// bin/lib, so this three-line one stays local.
const WORK_BACKEND_RE = /^work-backend:\s*(\S+)\s*$/m;

// stderr is piped rather than inherited or ignored: a failing git call cannot
// spray the CLI's own stderr, and its diagnostic still survives on
// `err.stderr` for any consumer module that classifies a failure by message.
function defaultGit(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// In-process replacement for `node resolve-policy.js --values <key>` (#1930
// review I8). Same scalar semantics as that CLI's --values mode: an unknown
// key, an error entry, or a null/absent value all read as ''. One call
// resolves every key the pack needs.
function defaultResolvePolicy(keys, cwd) {
  const out = {};
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  try {
    const { result } = resolvePolicyConfig({ git, readFile, keys });
    for (const key of keys) {
      const entry = result[key];
      out[key] = !entry || entry.error !== undefined || entry.value === null || entry.value === undefined ? '' : String(entry.value);
    }
  } catch {
    for (const key of keys) out[key] = '';
  }
  return out;
}

function defaultDeps(cwd) {
  return {
    now: () => Date.now(),
    git: defaultGit,
    execFile: promisify(execFileCb),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    resolvePolicy: (keys, policyCwd) => defaultResolvePolicy(keys, policyCwd || cwd),
    computeBlastRadius: require('../blast-radius-cli').computeBlastRadius,
    readClaimBlob: require('../issues/claim-store').readClaimBlob,
    classifyClaimBlob: require('../issues/claims').classifyClaimBlob,
    gitRunner: require('../issues/claims-git-cas').defaultRunner,
    queryRecords: require('../issues/local-store').queryRecords,
    readRecord: require('../issues/local-store').readRecord,
    ghApi: () => { throw new Error('claim: git transport to the claims branch failed and the pack has no gh API fallback'); },
  };
}

function readJson(deps, file) {
  try { return JSON.parse(deps.readFile(file)); } catch { return null; }
}

function readText(deps, file) {
  try { return deps.readFile(file); } catch { return null; }
}

// The worktree's CLAUDE.md `## Work records` block -> the work-backend value,
// or null. work-record-config.md's key table marks no default for this key
// (its "Values / default" cell lists only the two accepted values), so an
// absent file or line is UNCONFIGURED, not a driver choice. Defaulting it to
// `local-files` made a GitHub-backed project with no declaration report an
// empty `unblocked` list — a clean empty standing in for an unresolved input,
// the exact shape C2 rejected elsewhere (#1930 review E3).
function readWorkBackend(deps, worktree) {
  const m = WORK_BACKEND_RE.exec(readText(deps, path.join(worktree, 'CLAUDE.md')) || '');
  return m ? { value: m[1], source: 'claude-md' } : { value: null, source: 'unconfigured' };
}

function sortedUnique(nums) {
  return [...new Set(nums)].sort((a, b) => a - b);
}

// The {number, title} shape every unblocked-dependent list returns, regardless
// of which of the three ladder branches (local-files, native, body-text) found it.
function toSummary(r) {
  return { number: r.number, title: r.title };
}

// One directory of materialized headers: work/{n}-spec.md, one per record.
// The frontmatter `record:` line wins over the filename when both exist.
function headerRecords(deps, dir) {
  const nums = [];
  for (const name of deps.readdir(dir)) {
    const m = /^(\d+)-spec\.md$/.exec(name);
    if (!m) continue;
    let text = '';
    try { text = deps.readFile(path.join(dir, name)); } catch { continue; }
    const rec = /^record:\s*(\d+)\s*$/m.exec(text);
    nums.push(Number(rec ? rec[1] : m[1]));
  }
  return sortedUnique(nums);
}

// The worktree's own mirror of a run dir: everything from the
// `.claude-tweaks/pipelines` segment onward, re-rooted under the worktree.
// Materialized headers are committed on the feature branch, so on a real
// pr-first run they exist only here — never in the main-checkout run dir the
// CLI anchors --run to (#1930 review C1).
function worktreeMirror(runDir, worktree) {
  if (typeof worktree !== 'string') return null;
  const parts = path.resolve(runDir).split(path.sep);
  const i = parts.lastIndexOf('.claude-tweaks');
  if (i === -1 || parts[i + 1] !== 'pipelines') return null;
  return path.join(worktree, ...parts.slice(i));
}

// The record-resolution ladder, in order, reporting which rung won:
// (a) the run dir's own materialized headers; (b) the worktree's mirror of the
// same run dir; (c) a parent multi-spec run's manifest.yml ids plus any
// spec-*/work/ headers; else none.
function resolveRecords(deps, runDir, worktree) {
  const own = headerRecords(deps, path.join(runDir, 'work'));
  if (own.length) return { records: own, source: 'headers' };

  const mirror = worktreeMirror(runDir, worktree);
  if (mirror && path.resolve(mirror) !== path.resolve(runDir)) {
    const mirrored = headerRecords(deps, path.join(mirror, 'work'));
    if (mirrored.length) return { records: mirrored, source: 'worktree-headers' };
  }

  const nums = [];
  const manifest = parseManifestYaml(readText(deps, path.join(runDir, 'manifest.yml')));
  const specs = manifest && manifest.multispec && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs : [];
  for (const spec of specs) {
    const n = Number(spec && spec.id);
    if (Number.isInteger(n)) nums.push(n);
  }
  for (const name of deps.readdir(runDir)) {
    if (!/^spec-/.test(name)) continue;
    nums.push(...headerRecords(deps, path.join(runDir, name, 'work')));
  }
  if (nums.length) return { records: sortedUnique(nums), source: 'manifest' };

  return { records: [], source: 'unavailable' };
}

function hasPrNumber(state) {
  return Boolean(state && state.pr && Number.isInteger(state.pr.number));
}

// run-state.json, with the parent fallback a per-spec subdirectory needs: a
// `spec-*/` run dir carries its own status but not the run's worktree or PR —
// those live one level up, on the parent run's state (#1930 review C1).
function resolveState(deps, runDir) {
  const own = readJson(deps, path.join(runDir, 'run-state.json'));
  const complete = own && typeof own.worktree === 'string' && hasPrNumber(own);
  if (!/^spec-/.test(path.basename(runDir)) || complete) {
    return { state: own, source: own ? 'run-state.json' : 'unavailable' };
  }
  const parent = readJson(deps, path.join(path.dirname(runDir), 'run-state.json'));
  if (!parent) return { state: own, source: own ? 'run-state.json' : 'unavailable' };
  const merged = { ...(own || {}) };
  if (typeof merged.worktree !== 'string' && typeof parent.worktree === 'string') merged.worktree = parent.worktree;
  if (!hasPrNumber(merged) && hasPrNumber(parent)) merged.pr = parent.pr;
  return { state: merged, source: 'parent' };
}

function mergeBase(deps, cwd, integrationBranch) {
  for (const ref of [`origin/${integrationBranch}`, integrationBranch]) {
    try {
      const out = deps.git(['merge-base', 'HEAD', ref], { cwd }).trim();
      if (out) return { base: out, ref };
    } catch { /* try the next ref */ }
  }
  return { base: null, ref: null };
}

// Resolved once, reported with sources: state ← run-state.json (or the parent
// run's, for a spec-* subdirectory); records ← the resolveRecords ladder;
// pr/worktree ← that state; policy ← one resolvePolicyConfig call;
// base ← merge-base against origin/{branch}, then the local branch.
function resolveInputs({ runDir, cwd, deps }) {
  const sources = {};
  const { state, source: stateSource } = resolveState(deps, runDir);
  sources.state = stateSource;
  const hasWorktree = state && typeof state.worktree === 'string';
  const worktree = hasWorktree ? state.worktree : cwd;
  sources.worktree = hasWorktree ? 'run-state.json' : 'cwd';
  const { records, source: recordSource } = resolveRecords(deps, runDir, worktree);
  sources.records = recordSource;
  const pr = hasPrNumber(state) ? state.pr.number : null;
  sources.pr = pr === null ? 'unavailable' : 'run-state.json';
  const values = deps.resolvePolicy(POLICY_KEYS, worktree) || {};
  const backend = readWorkBackend(deps, worktree);
  sources.workBackend = backend.source;
  const policy = {
    integrationBranch: values['integration-branch'] || '',
    workBackend: backend.value,
    workLinks: values['work-links'] || '',
  };
  const integrationBranch = policy.integrationBranch || 'main';
  sources.integrationBranch = policy.integrationBranch ? 'policy' : 'default';
  const mb = mergeBase(deps, worktree, integrationBranch);
  sources.base = mb.base ? 'merge-base' : 'unavailable';
  // One record is a record; several are a parent multi-spec run, whose
  // record-scoped questions ("what did closing it unblock?") have no single
  // answer — null rather than a silently-picked first element.
  const record = records.length === 1 ? records[0] : null;
  return { records, record, pr, base: mb.base, baseRef: mb.ref, integrationBranch, worktree, policy, sources };
}

async function wrapProbe(name, fn, now) {
  const t0 = now();
  try {
    const value = await fn();
    return { ok: true, durationMs: now() - t0, value };
  } catch (err) {
    return { ok: false, durationMs: now() - t0, error: String((err && err.message) || err) };
  }
}

// Outer per-probe bound. The timer is cleared on every settle path so a fast
// probe never holds the event loop open past its own resolution.
function withTimeout(fn, ms) {
  return () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    Promise.resolve().then(fn).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function parseLedger(text) {
  const rows = text.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const byPhase = {};
  let open = 0;
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    const phase = cells[1] || 'unknown';
    const status = (cells[3] || '').toLowerCase();
    byPhase[phase] = byPhase[phase] || { open: 0, total: 0 };
    byPhase[phase].total += 1;
    if (status === 'open') { open += 1; byPhase[phase].open += 1; }
  }
  return { open, total: rows.length, byPhase };
}

// A ledger filename names record {n} only at a `-{n}-` or `-{n}.` boundary. A
// bare substring test let the date prefix answer for a record number
// (`#26` matching `2026-09-05-…`), silently folding a stranger's ledger into
// this run's counts (#1930 review M5).
function namesRecord(file, n) {
  return file.includes(`-${n}-`) || file.includes(`-${n}.`);
}

function ledgerProbe(inputs, deps) {
  const dir = path.join(inputs.worktree, 'docs', 'plans');
  const files = deps.readdir(dir).filter((f) => f.endsWith('-ledger.md') && inputs.records.some((n) => namesRecord(f, n)));
  const totals = { open: 0, total: 0, byPhase: {}, files: files.map((f) => path.posix.join('docs', 'plans', f)) };
  for (const f of files) {
    // Read-and-catch, like headerRecords: a ledger archived between the
    // readdir snapshot and this read is skipped, not a whole-probe failure.
    const text = readText(deps, path.join(dir, f));
    if (text === null) continue;
    const one = parseLedger(text);
    totals.open += one.open; totals.total += one.total;
    for (const [phase, c] of Object.entries(one.byPhase)) {
      totals.byPhase[phase] = totals.byPhase[phase] || { open: 0, total: 0 };
      totals.byPhase[phase].open += c.open; totals.byPhase[phase].total += c.total;
    }
  }
  return totals;
}

// work-backend: local-files — the same two-pass predicate
// wrap-up/unblocked-records.md's local branch runs: dependents whose declared
// blockers are all either the record that just closed or an already-closed
// record.
function unblockedLocal(inputs, deps, closed) {
  const dir = path.join(inputs.worktree, 'specs');
  const files = deps.readdir(dir).filter((f) => /^\d+-.*\.md$/.test(f));
  const dependents = deps.queryRecords(dir, {})
    .map((r) => ({ number: r.id, title: r.title, blockedBy: (r.facets && r.facets.blockedBy) || [] }))
    .filter((r) => r.blockedBy.includes(closed));
  const isResolved = (id) => {
    const file = files.find((f) => f.startsWith(`${id}-`));
    if (!file) return true; // already gone — treat as resolved
    // The readdir above is a snapshot; a sibling session can prune the file
    // before this read (#901's race, [IL-146]) — a vanished record is the same
    // "already gone" outcome, not a probe failure.
    try { return deps.readRecord(path.join(dir, file)).facets.closed === true; } catch { return true; }
  };
  return dependents
    .filter((d) => d.blockedBy.every((b) => b === closed || isResolved(b)))
    .map(toSummary);
}

// The eight probes. Module probes call the exported functions the CLIs already
// compute from; subprocess probes go through deps.execFile.
function buildProbes(inputs, deps) {
  const git = (args) => deps.git(args, { cwd: inputs.worktree });
  const forge = inputs.policy.workBackend === 'github-issues';
  const forgeOrThrow = () => { if (!forge) throw new Error('no-forge'); };
  // Unconfigured is not a backend. It must never collapse into `no-forge`
  // (which asserts "this project has no forge") or into a clean empty
  // (#1930 review E3) — every backend-gated probe says so and fails its own
  // field. `claim` is deliberately NOT in that set: the claims-registry branch
  // read is backend-agnostic (neither `_shared/issue-claims.md` nor
  // bin/lib/issues/claim-store.js mentions work-backend), so it stays gated
  // on records alone.
  const backendOrThrow = () => {
    if (inputs.policy.workBackend === null) throw new Error('work-backend unconfigured — no `work-backend:` line in CLAUDE.md');
  };
  // A record-scoped probe with no records is not a clean empty result — it is
  // an unresolved input, and must read as one (#1930 review C2).
  const recordsOrThrow = () => {
    if (inputs.records.length === 0) throw new Error('records unresolved — no materialized header or manifest found');
  };
  const gh = async (args) => {
    try { return await deps.execFile('gh', args, { cwd: inputs.worktree, ...EXEC_OPTS }); } catch (err) {
      if (err && err.code === 'ENOENT') throw new Error('gh-absent');
      throw err;
    }
  };
  return {
    state: async () => {
      if (!inputs.base) throw new Error('base unresolved — no merge-base against the integration branch');
      const { stdout } = await deps.execFile('node', [path.join(BIN, 'wrap-up-state.js'), '--since', String(inputs.base), '--json'], { cwd: inputs.worktree, ...EXEC_OPTS });
      return JSON.parse(stdout);
    },
    blastRadius: () => deps.computeBlastRadius({ base: inputs.base, integrationBranch: inputs.integrationBranch }, { git }),
    // No mergeSize probe (#1930 fix round 4): its only consumer,
    // `_shared/pr-early-run-lifecycle.md`'s pre-merge merge-size step, mandates
    // a `git fetch origin {integration-branch}` immediately before measuring.
    // The pack is gathered in Phase 3, before that fetch, so a pack-fed value
    // would be exactly the stale prediction that step's own text forbids —
    // that step keeps running `bin/merge-size-probe.js` itself.
    ledger: () => { recordsOrThrow(); return ledgerProbe(inputs, deps); },
    // --no-suite: a fact pack never re-runs the project's test suite. Suite
    // state belongs to /claude-tweaks:test's verification stamp, which already
    // holds it by the time wrap-up runs; re-running it here costs minutes (on
    // this repo residue.js's suite probe exceeds both EXEC_OPTS.timeout and
    // the per-probe race), so every pack-fed residue carries
    // `suite: {ran: false, reason: 'skipped via --no-suite'}` by construction
    // — residue-sweep.md's "Running the sweep" says where the sweep reads
    // suite state instead (#1930 review E2).
    residue: async () => {
      if (!inputs.base) throw new Error('base unresolved — no merge-base against the integration branch');
      const { stdout } = await deps.execFile('node', [path.join(BIN, 'residue.js'), '--base', String(inputs.base), '--integration-branch', String(inputs.baseRef || inputs.integrationBranch), '--scope', 'blast-radius', '--no-suite', '--json'], { cwd: inputs.worktree, ...EXEC_OPTS });
      return JSON.parse(stdout);
    },
    pr: async () => {
      backendOrThrow(); forgeOrThrow(); if (inputs.pr === null) throw new Error('no PR number in run-state.json');
      const { stdout } = await gh(['pr', 'view', String(inputs.pr), '--json', 'state,isDraft,mergeStateStatus,headRefOid,statusCheckRollup,reviewDecision']);
      return JSON.parse(stdout);
    },
    recordLabels: async () => {
      backendOrThrow(); forgeOrThrow(); recordsOrThrow();
      const out = {};
      await Promise.all(inputs.records.map(async (n) => {
        const { stdout } = await gh(['issue', 'view', String(n), '--json', 'labels']);
        out[n] = JSON.parse(stdout).labels.map((l) => l.name);
      }));
      return out;
    },
    claim: async () => {
      recordsOrThrow();
      const out = {};
      const gitRunner = (args, opts = {}) => deps.gitRunner(args, { cwd: inputs.worktree, ...opts });
      for (const n of inputs.records) {
        const blob = await deps.readClaimBlob({ gitRunner, ghApi: deps.ghApi }, null, n);
        if (blob.failure) throw new Error(`claim read failed: ${blob.failure}`);
        out[n] = { ...deps.classifyClaimBlob(blob.absent ? null : blob.content, deps.now()), via: blob.via || 'git' };
      }
      return out;
    },
    unblocked: async () => {
      recordsOrThrow();
      const closed = inputs.record;
      if (closed === null) throw new Error('record unresolved');
      backendOrThrow();
      if (inputs.policy.workBackend === 'local-files') return unblockedLocal(inputs, deps, closed);
      forgeOrThrow();
      const { stdout } = await gh(['issue', 'list', '--state', 'open', '--json', 'number,title,body', '--limit', '200']);
      const records = JSON.parse(stdout);
      if (inputs.policy.workLinks === 'native') {
        if (!records.length) return [];
        const res = await deps.execFile('node', [path.join(BIN, 'resolve-blockers.js'), records.map((r) => r.number).join(',')], { cwd: inputs.worktree, ...EXEC_OPTS });
        const byNumber = JSON.parse(res.stdout.trim());
        return records.filter((r) => byNumber[r.number] && byNumber[r.number].blockedBy.includes(closed) && !byNumber[r.number].openBlocker).map(toSummary);
      }
      // work-links: body-text — the same two passes unblocked-records.md runs.
      // Pass 1 is `parseDependencies` (the canonical line-anchored `Blocked by
      // #N` parse), pass 2 checks every OTHER blocker is closed too: a
      // dependent still held by a second open blocker is not unblocked.
      const dependents = records
        .map((r) => ({ number: r.number, title: r.title, blockedBy: parseDependencies(r.body || '') }))
        .filter((r) => r.blockedBy.includes(closed));
      if (!dependents.length) return [];
      const states = await gh(['issue', 'list', '--state', 'all', '--json', 'number,state', '--limit', '200']);
      const stateOf = new Map(JSON.parse(states.stdout).map((i) => [i.number, i.state]));
      return dependents
        .filter((d) => d.blockedBy.every((b) => b === closed || stateOf.get(b) === 'CLOSED'))
        .map(toSummary);
    },
  };
}

async function gatherPack({ runDir, cwd = process.cwd(), only = null, deps: overrides = {} } = {}) {
  const deps = { ...defaultDeps(cwd), ...overrides };
  const limit = Number.isFinite(deps.probeTimeoutMs) ? deps.probeTimeoutMs : PROBE_TIMEOUT_MS;
  const t0 = deps.now();
  const inputs = resolveInputs({ runDir, cwd, deps });
  const probes = buildProbes(inputs, deps);
  const names = PROBE_NAMES.filter((n) => !only || only.includes(n));
  const settled = await Promise.all(names.map((n) => wrapProbe(n, withTimeout(probes[n] || (() => { throw new Error(`probe ${n} not implemented`); }), limit), deps.now)));
  const pack = { generatedAt: new Date().toISOString(), durationMs: 0, inputs };
  names.forEach((n, i) => { pack[n] = settled[i]; });
  pack.durationMs = deps.now() - t0;
  return pack;
}

module.exports = {
  gatherPack, resolveInputs, wrapProbe, withTimeout, parseLedger, PROBE_NAMES, resolveRecords, headerRecords,
};
