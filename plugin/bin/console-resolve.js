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
//
// Second shape (#4170): `--run <dir> --set-item <id> --resolution keep-staged
// --reason <text>` rewrites one stored item `apply` → `keep-staged` after its
// execution failed, so it re-surfaces as residue (lib/console/item-resolution.js).
// It needs no ceiling (it only records what already happened). Exit 0 rewrote or
// already there, 2 malformed, 3 --run not anchored or the write failed, 5 refused
// (no console.json, not this CLI's shape, unknown/duplicate id, resolution not
// rewritable).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveAll, renderStoredTable } = require('./lib/console/resolve');
const { resolveTarget } = require('./lib/stage-item/write');
const { stackVerdicts } = require('./lib/staged-patch/stack-check');
const { appendEntry, formatEntry } = require('./lib/log-decision/append');
const { resolvePolicyConfig } = require('./lib/policy-schema');
const { resolveCeiling, bookkeepingPermissions } = require('./lib/issues/autonomy');
const { extractPendingGrantedAt, partitionGrantComments } = require('./lib/issues/grant-maturation');
const { writeFileAtomic } = require('./lib/atomic-write');
const { unresolvedItems, splitMissing, formatResidueLines, consoleResidueItems } = require('./lib/console/residue');
const { REWRITE_FROM, rewriteItemResolution } = require('./lib/console/item-resolution');

const USAGE = 'usage: console-resolve.js --run <dir> --policy console-auto [--dry-run] [--json]\n'
  + '       console-resolve.js --run <dir> --set-item <id> --resolution keep-staged --reason <text>';

class UsageError extends Error {}

// #3370: the human-facing block for items a console left pending/keep-staged,
// or '' when there are none. Read-only: nothing here applies or resolves them.
// Items whose staged file is gone (#3772) are not counted — they are named in
// the block's `not counted` line instead.
function needsAHumanBlock(unresolved, runDir, consolePath) {
  const { items, missing } = splitMissing(unresolved, path.dirname(consolePath));
  if (items.length === 0) return '';
  const pluginRoot = path.resolve(__dirname, '..');
  const lines = formatResidueLines({ dir: runDir, consoles: [{ path: consolePath, items, missing }] }, { pluginRoot });
  lines.push(`  paths move when the run is archived; current paths: node "${pluginRoot}/bin/console-residue.js" --run "${runDir}"`);
  return `\nNeeds a human — ${items.length} item(s) this console did not resolve (never auto-applied):\n${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const out = { run: null, policy: null, dryRun: false, json: false, setItem: null, resolution: null, reason: null };
  const valued = { '--run': 'run', '--policy': 'policy', '--set-item': 'setItem', '--resolution': 'resolution', '--reason': 'reason' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (Object.prototype.hasOwnProperty.call(valued, flag)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      out[valued[flag]] = value;
      i += 1;
    } else if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--json') out.json = true;
    else throw new UsageError(`unknown flag: ${flag}`);
  }
  if (!out.run) throw new UsageError('--run <dir> is required');
  if (out.setItem !== null) {
    if (out.policy !== null || out.dryRun || out.json) throw new UsageError('--set-item takes none of --policy, --dry-run, --json');
    if (out.setItem === '') throw new UsageError('--set-item requires a non-empty id');
    if (!out.resolution || !out.reason) throw new UsageError('--set-item requires --resolution and --reason (both non-empty)');
    if (!Object.prototype.hasOwnProperty.call(REWRITE_FROM, out.resolution)) throw new UsageError(`--resolution must be one of ${Object.keys(REWRITE_FROM).join(', ')} (got ${out.resolution})`);
    return out;
  }
  if (out.resolution !== null || out.reason !== null) throw new UsageError('--resolution and --reason require --set-item');
  if (out.policy !== 'console-auto') throw new UsageError(`--policy must be console-auto (got ${out.policy || 'nothing'})`);
  return out;
}

function defaultExecFile(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 30000, ...opts, windowsHide: true });
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
      // #3358: trusted comments only; each untrusted marker comment passed over is named.
      const { bodies, skippedUntrusted } = partitionGrantComments(parsed.comments);
      out[n] = { labels, pendingSince: extractPendingGrantedAt(bodies), skippedUntrusted };
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

// One stacked verdict per staged .patch (#3290): the paths arrive in apply order and a re-derived
// patch is ok at its position on top of the earlier ones. A walk that cannot run fails closed —
// every patch reads as not applying, the same route a failing per-patch check takes.
function checkPatchStack(worktree) {
  return (paths) => {
    if (paths.length === 0) return {};
    try {
      return stackVerdicts({ worktree, patches: paths });
    } catch (err) {
      const error = `stacked check could not run: ${err && err.message ? err.message : err}`;
      return Object.fromEntries(paths.map((p) => [path.basename(p), { ok: false, error }]));
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

// #4170: the `--set-item` shape — one stored item rewritten after its execution failed. Exit 0 rewrote or
// already there, 3 the write threw, 5 refused. Runs before the ceiling check: it only records what happened.
function setItem(o, runDir, { stdout, stderr, now }) {
  const consolePath = path.join(runDir, 'console.json');
  const at = new Date(now()).toISOString();
  let r;
  try {
    r = rewriteItemResolution({ consolePath, id: o.setItem, resolution: o.resolution, reason: o.reason, at });
  } catch (err) {
    stderr(`console-resolve.js: could not write ${consolePath}: ${err && err.message ? err.message : err}\n`);
    return 3;
  }
  if (r.status === 'refused') { stderr(`console-resolve.js: ${r.why} — nothing written\n`); return 5; }
  if (r.status === 'unchanged') { stdout(`console-resolve.js: ${o.setItem} already ${o.resolution} — nothing rewritten\n`); return 0; }
  const text = `Console item ${o.setItem} (${r.item.section}): rewritten ${r.from} → ${o.resolution} after execution — ${o.reason}`;
  try {
    appendEntry({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'AUTO', now: now(), step: 'Review Console', text, reversibility: 'n/a' }) });
  } catch (err) {
    stderr(`console-resolve.js: ${o.setItem} rewritten ${r.from} → ${o.resolution} in ${consolePath}, but the decisions.md entry could not be written (${err && err.message ? err.message : err})\n`);
    return 3;
  }
  stdout(`console-resolve.js: ${o.setItem} rewritten ${r.from} → ${o.resolution} in ${consolePath}\n`);
  return 0;
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
  if (o.setItem !== null) return setItem(o, runDir, { stdout, stderr, now });
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
      // A resumed wrap-up re-renders here: the block must still reach its final stop.
      // A planned can't-tell filing with no filed line is residue here too (#4170); the fresh path's filings are about to run.
      let decisions = '';
      try { decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { decisions = ''; }
      const block = needsAHumanBlock(consoleResidueItems(existing, decisions), runDir, consolePath);
      if (block) stdout(block);
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
    checkPatchStack: checkPatchStack(cwd()),
    readGrants: ghReadGrants(execFile, cwd()),
    checkPrState: ghCheckPrState(execFile, cwd()),
    vetoWindowHours,
    now,
    ...(deps.resolverDeps || {}),
  };
  const result = resolveAll({ runDir, policy: o.policy, deps: resolverDeps });
  // The proposal text stays in-process (result.filings); console.json and --json carry only the summary.
  const { snapshot, table, filings, ...rest } = result;
  const filingSummaries = filings.map(({ item, fingerprint, title }) => ({ item, fingerprint, title }));
  const publicResult = { ...rest, filings: filingSummaries };
  const at = new Date(now()).toISOString();
  if (!o.dryRun) {
    const header = formatEntry({ status: 'AUTO', now: now(), step: 'Review Console', text: `Console auto-resolved ${result.items.length} item(s) at unattended (console-resolve.js)`, reversibility: 'per item' });
    // Reversibility uses _shared/auto-decision-log.md's closed vocabulary
    // (high | med | low | n/a) — nothing else is a legal value on a schema line.
    const nothingToRevert = new Set(['stale', 'keep-staged', 'pending', 'refused', 'dismissed', 'dropped']);
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
    writeFileAtomic(consolePath, `${JSON.stringify({ resolved: true, mode: 'auto-resolve', at, ceiling: 'unattended', items: result.items, merge: result.merge, droppedByTiebreak: result.droppedByTiebreak, filings: filingSummaries }, null, 2)}\n`);
  }
  // #3370: items this console deliberately left pending/keep-staged must survive
  // the run's own final stop. Read-only: nothing here applies or resolves them.
  const unresolved = unresolvedItems({ items: result.items });
  if (o.json) {
    stdout(`${JSON.stringify({ ...publicResult, unresolved, at, dryRun: o.dryRun }, null, 2)}\n`);
  } else {
    stdout(`${table}\n`);
    const block = needsAHumanBlock(unresolved, runDir, consolePath);
    if (block) stdout(block);
  }
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.stderr.write(`console-resolve.js: ${err && err.stack ? err.stack : err}\n`); process.exitCode = 1; });
}

module.exports = { run, parseArgs, ghReadGrants, readPolicy, checkPatchStack, USAGE };
