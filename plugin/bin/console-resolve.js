#!/usr/bin/env node
// plugin/bin/console-resolve.js — resolve an `unattended` Review Console in
// one process (#1932): every staged item, one decisions block, one
// console.json (the write the auto-resolve path never made — #1854, so
// archive-merged.js never archived an unattended run), one rendered table.
// The merge half is computed, never executed — `gh pr merge` stays in the
// skill's own path. Exit 0 resolved, 2 malformed, 3 --run not anchored under
// the main checkout ([IL-127]), 4 consoleAutoResolve not granted at the
// resolved ceiling (never resolve a console at supervised/trusted), 5 a
// console.json this process must not clobber — one already rendered on the PR
// and awaiting a human, or one that will not parse (fail closed); never under
// `--dry-run`, which writes nothing and so has nothing to clobber. A console.json
// already carrying `resolved: true` is not an error, in either shape: it
// re-renders and exits 0.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveAll, renderStoredTable } = require('./lib/console/resolve');
const { resolveTarget } = require('./lib/stage-item/write');
const { appendEntry, formatEntry } = require('./lib/log-decision/append');
const { resolvePolicyConfig } = require('./lib/policy-schema');
const { resolveCeiling, bookkeepingPermissions } = require('./lib/issues/autonomy');
const { extractPendingGrantedAt } = require('./lib/issues/grant-maturation');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: console-resolve.js --run <dir> --policy console-auto [--dry-run] [--json]';

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { run: null, policy: null, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--run' || flag === '--policy') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      out[flag === '--run' ? 'run' : 'policy'] = value;
      i += 1;
    } else if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--json') out.json = true;
    else throw new UsageError(`unknown flag: ${flag}`);
  }
  if (!out.run) throw new UsageError('--run <dir> is required');
  if (out.policy !== 'console-auto') throw new UsageError(`--policy must be console-auto (got ${out.policy || 'nothing'})`);
  return out;
}

function defaultExecFile(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 30000, ...opts });
}

// The ceiling AND the veto window, resolved in-process with the same precedence
// resolve-policy.js applies (run config over project policy): `resolvePolicyKeys`
// already folds config.yml over policy.yml, so the single resolved value is what
// resolveCeiling sees as runConfig. One call, both keys — a run that widened
// `grant-veto-window-hours` must not have evaluateMaturation fall back to its
// own 24h default the way this CLI's first cut did.
function readPolicy({ execFile, cwd, runDir }) {
  const git = (args) => execFile('git', args, { cwd });
  const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const { result } = resolvePolicyConfig({ git, readFile, runDir, keys: ['autonomy', 'grant-veto-window-hours'] });
  const valueOf = (key) => { const entry = result[key]; return entry && entry.error === undefined ? entry.value : null; };
  const raw = valueOf('grant-veto-window-hours');
  const veto = raw === null || raw === undefined ? NaN : Number(raw);
  return { ceiling: resolveCeiling({ runConfig: valueOf('autonomy') }), vetoWindowHours: Number.isFinite(veto) ? veto : undefined };
}

// Live grants per member — the Authorization read is never a snapshot
// (auto-merge-short-circuit.md's Authorization layer): labels and, for a
// pending grant, the grant timestamp from the audit-trail comment marker.
function ghReadGrants(execFile, cwd) {
  return (numbers) => {
    const out = {};
    for (const n of numbers) {
      const raw = execFile('gh', ['issue', 'view', String(n), '--json', 'labels,comments'], { cwd });
      const parsed = JSON.parse(raw);
      const labels = (parsed.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
      const bodies = (parsed.comments || []).map((c) => (typeof c === 'string' ? c : c.body || ''));
      out[n] = { labels, pendingSince: extractPendingGrantedAt(bodies) };
    }
    return out;
  };
}

function gitApplyCheck(execFile, cwd) {
  return (patchPath) => {
    try { execFile('git', ['apply', '--check', patchPath], { cwd }); return { ok: true }; } catch (err) {
      const msg = err && (err.stderr || err.message) ? String(err.stderr || err.message).trim() : 'git apply --check failed';
      return { ok: false, error: msg };
    }
  };
}

// Live PR state for a drain-overlap hold's re-verification (resolve.js's
// mergeResolution) — mirrors ghReadGrants's shape: one execFile call, thrown
// errors propagate so resolve.js can fail closed to leave-open on a
// transport failure rather than silently treating it as resolved.
function ghCheckPrState(execFile, cwd) {
  return (prNumber) => {
    const raw = execFile('gh', ['pr', 'view', String(prNumber), '--json', 'state'], { cwd });
    return JSON.parse(raw).state;
  };
}

async function run(argv, deps = {}) {
  const cwd = deps.cwd || (() => process.cwd());
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const now = deps.now || (() => Date.now());
  const execFile = deps.execFile || defaultExecFile;
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(`console-resolve.js: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  let isDir = false;
  try { isDir = fs.statSync(o.run).isDirectory(); } catch { isDir = false; }
  if (!isDir) { stderr(`console-resolve.js: --run ${o.run} is not a directory\n${USAGE}\n`); return 2; }
  const target = resolveTarget({ runDir: o.run, cwd: cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    stderr(`console-resolve.js: --run ${o.run} refused (${target.reason === 'missing' ? 'missing' : 'not anchored under the main checkout'}) — nothing written\n`);
    return 3;
  }
  const runDir = target.dir;
  const { ceiling, vetoWindowHours } = readPolicy({ execFile, cwd: cwd(), runDir });
  if (!bookkeepingPermissions(ceiling).consoleAutoResolve) {
    stderr(`console-resolve.js: consoleAutoResolve is not granted at ceiling ${ceiling} (unattended only) — nothing written\n`);
    return 4;
  }
  // Idempotency and no-clobber, before anything is resolved: this run dir's
  // console.json may already hold a resolution (re-run — re-render it, append
  // nothing) or a console rendered on the PR (never ours, in either state).
  // An unparseable file fails closed for the same reason.
  //
  // The PR shape is tested FIRST, because a PR-rendered console the reconciler
  // has since executed carries `resolved: true` AND `prNumber`/`commentIds` —
  // reading it as this CLI's own auto-resolve shape would render its
  // `{id, kind, summary, stagedHash}` items as `undefined` cells.
  const consolePath = path.join(runDir, 'console.json');
  let existingRaw = null;
  try { existingRaw = fs.readFileSync(consolePath, 'utf8'); } catch { existingRaw = null; }
  if (existingRaw !== null) {
    let parsed;
    try { parsed = JSON.parse(existingRaw); } catch { parsed = undefined; }
    const existing = parsed && typeof parsed === 'object' ? parsed : null;
    const onPr = existing !== null
      && (existing.prNumber !== undefined || existing.commentIds !== undefined || existing.mergeCheckVerdict !== undefined);
    const pr = onPr && existing.prNumber !== undefined ? `PR #${existing.prNumber}` : 'the PR';
    if (existing !== null && existing.resolved === true) {
      const notice = onPr
        ? `${consolePath} is a console rendered on ${pr} and already resolved there — nothing to re-resolve.`
        : `${consolePath} already records a resolved console — re-rendering it; nothing re-resolved.`;
      stdout(`console-resolve.js: ${notice}\n`);
      stdout(`${renderStoredTable(existing)}\n`);
      return 0;
    }
    let refusal = null;
    if (onPr) refusal = `${consolePath} is a console rendered on ${pr} and awaiting a human — refusing to overwrite it; nothing written`;
    else if (parsed === undefined) refusal = `${consolePath} exists but does not parse as JSON — refusing to overwrite it; nothing written`;
    if (refusal) {
      stderr(`console-resolve.js: ${refusal}\n`);
      // `--dry-run` is preview-always (review-console.md's Dry-run mode) and
      // writes nothing anyway, so there is nothing here to clobber: the refusal
      // degrades to a warning rather than denying the operator the preview.
      if (!o.dryRun) return 5;
      stderr('console-resolve.js: --dry-run — previewing anyway; nothing is written either way\n');
    }
  }
  const resolverDeps = {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    gitApplyCheck: gitApplyCheck(execFile, cwd()),
    readGrants: ghReadGrants(execFile, cwd()),
    checkPrState: ghCheckPrState(execFile, cwd()),
    vetoWindowHours,
    now,
    ...(deps.resolverDeps || {}),
  };
  const result = resolveAll({ runDir, policy: o.policy, deps: resolverDeps });
  const { snapshot, table, ...publicResult } = result;
  const at = new Date(now()).toISOString();
  if (!o.dryRun) {
    const header = formatEntry({ status: 'AUTO', now: now(), step: 'Review Console', text: `Console auto-resolved ${result.items.length} item(s) at unattended (console-resolve.js)`, reversibility: 'per item' });
    // Reversibility uses _shared/auto-decision-log.md's closed vocabulary
    // (high | med | low | n/a) — nothing else is a legal value on a schema line.
    const nothingToRevert = new Set(['stale', 'keep-staged', 'pending', 'refused']);
    const reversibilityFor = (resolution) => {
      if (nothingToRevert.has(resolution)) return 'n/a';
      return resolution === 'apply' ? 'med' : 'high';
    };
    const stagedNames = new Set(snapshot.staged.map((s) => s.name));
    const lines = result.items.map((it) => formatEntry({
      status: 'AUTO',
      now: now(),
      step: 'Review Console',
      text: `Console item ${it.id} (${it.section}): ${it.resolution} — ${it.reason}${stagedNames.has(it.id) ? ` (staged/${it.id})` : ''}`,
      reversibility: reversibilityFor(it.resolution),
    }));
    appendEntry({ runDir, section: '/wrap-up', entry: [header, ...lines].join('\n') });
    writeFileAtomic(consolePath, `${JSON.stringify({ resolved: true, mode: 'auto-resolve', at, ceiling: 'unattended', items: result.items, merge: result.merge }, null, 2)}\n`);
  }
  stdout(o.json ? `${JSON.stringify({ ...publicResult, at, dryRun: o.dryRun }, null, 2)}\n` : `${table}\n`);
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.stderr.write(`console-resolve.js: ${err && err.stack ? err.stack : err}\n`); process.exitCode = 1; });
}

module.exports = { run, parseArgs };
