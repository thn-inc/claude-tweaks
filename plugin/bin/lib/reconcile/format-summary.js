// bin/lib/reconcile/format-summary.js — compact, human-readable rendering of
// reconcile()'s return object (index.js's `{ mirror, redTip, worktrees,
// claims, runs, branches, remoteBranches, ledgerResidue, console, skipped }`), for
// `bin/hooks.js reconcile`'s new default output (#638). Pure presentation
// layer — takes exactly the object reconcile() already returns; no changes
// to reconcile()/its per-check modules, and no I/O of its own.
//
// Three kinds of line:
//   - one per non-empty action category, naming what was actually DONE
//     (e.g. "archived: 1 run dir", "released: 3 claims", "reaped: 1
//     worktree") — drawn from the taken-action entries in each of
//     reconcile()'s array-shaped fields, plus mirror/redTip/console's own
//     single-object shapes, and the archive pass's own count lines
//     ("residue (dry run): ...", "ownerless non-clean: N run dirs");
//   - one aggregated "skipped: N {unit} (reason count, reason count, ...)"
//     line, folding together every PER-ITEM skip across every category
//     (archive's per-run-dir skip reasons, reap's per-worktree reasons,
//     release's per-claim reasons, archive-branches'/remote-prune's
//     per-branch reasons, console's per-run-dir reasons) into one
//     grouped-by-reason report, in the issue's own illustrated format:
//     `skipped: 44 run dirs (no-worktree 24, move-failed 15, pr-open 5)`.
//     When a skip pool spans more than one item unit (e.g. both run dirs
//     and worktrees were skipped this pass), the aggregate falls back to a
//     generic "items" unit for the total, and a reason string that occurs
//     under more than one unit is disambiguated per-reason with that unit
//     in parentheses — the "(and check where that disambiguates)" clause;
//   - one line per top-level `result.skipped` entry — an entire CHECK that
//     never ran this pass at all (`no-repo`, `budget-exceeded`,
//     `preflight-*`, the `reconcile-threw` catch, ...). Kept separate from
//     the per-item aggregate above: "a whole check didn't run" and "this
//     check ran and passed over N items" are different failure shapes, and
//     folding a rare, high-signal whole-check skip into a big per-item
//     aggregate would bury it. This is also what keeps every degrade path
//     failure-legible in the compact default rather than reading as a
//     clean no-op.
'use strict';

// Array-shaped result fields: unit noun (singular), the action value(s)
// that count as "taken" for that field, and the skip action value(s) whose
// entries fold into the aggregated per-item skip line. `verb` is the
// taken-line's leading word; multiple categories may legitimately share the
// same verb (e.g. "archived" for both run dirs and branches) since each
// renders on its own line. `kindFilter` narrows a field that mixes more than
// one entry shape in the same array — `result.branches` interleaves
// archive-branches.js's own `kind: 'branch'` entries (action `delete` /
// `tag-and-delete` / `skip`) with its `kind: 'tag'` aging entries (action
// `aged-out` / `skip`), so one CATEGORIES row per kind keeps a tag's
// `aged-out` action from being silently dropped (it matches neither the
// branch row's takenActions nor skipActions) and keeps a tag's `skip`
// reason out of the branch row's aggregated skip count.
const CATEGORIES = [
  { key: 'worktrees', unit: 'worktree', verb: 'reaped', takenActions: ['reaped'], skipActions: ['skipped'] },
  { key: 'claims', unit: 'claim', verb: 'released', takenActions: ['released'], skipActions: ['skipped'] },
  { key: 'runs', unit: 'run dir', verb: 'archived', takenActions: ['archived'], skipActions: ['skipped'] },
  { key: 'branches', unit: 'branch', verb: 'archived', takenActions: ['delete', 'tag-and-delete'], skipActions: ['skip'], kindFilter: (e) => e.kind !== 'tag' },
  { key: 'branches', unit: 'tag', verb: 'aged out', takenActions: ['aged-out'], skipActions: ['skip'], kindFilter: (e) => e.kind === 'tag' },
  { key: 'remoteBranches', unit: 'remote branch', verb: 'pruned', takenActions: ['delete'], skipActions: ['skip'] },
  { key: 'ledgerResidue', unit: 'residue ledger', verb: 'removal PR opened', takenActions: ['pr-opened'], skipActions: ['skip'] },
];

function scopedEntries(cat, arr) {
  return cat.kindFilter ? arr.filter(cat.kindFilter) : arr;
}

function pluralize(unit, n) {
  return n === 1 ? unit : `${unit}s`;
}

function formatMirrorLine(mirror) {
  if (!mirror) return null;
  if (mirror.action === 'fast-forwarded') return 'mirror: fast-forwarded';
  if (mirror.action === 'failed') return `mirror: failed (${mirror.reason})`;
  if (mirror.action === 'skipped') return `mirror: skipped (${mirror.reason})`;
  if (mirror.warning) return `mirror: ${mirror.warning}`;
  if (mirror.reason) return `mirror: not fast-forwarded (${mirror.reason})`;
  return null; // state 'current', action 'none', nothing to report — genuinely in sync
}

function formatRedTipLine(redTip) {
  if (!redTip) return null;
  return `red-tip: ${redTip.message}`;
}

// #3132: origin-head.js's repair attempt, when one was made (no origin —
// nothing attempted — still renders nothing here, same as today).
function formatOriginHeadRepairLine(originHeadRepair) {
  if (!originHeadRepair) return null;
  const { outcome, branch, reason } = originHeadRepair;
  if (outcome === 'repaired') return `origin/HEAD repaired (${branch})`;
  return `origin/HEAD repair: ${outcome}${reason ? ` (${reason})` : ''}`;
}

// #4180: a dry run's residue plan (index.js's `residuePlan`) — what escalation tracking WOULD have
// done, since a dry run files and writes nothing. `would-resolve` counts with `would-clear`: both
// drop the entry. Zero parts are omitted; a null/empty plan renders nothing.
function formatResiduePlanLine(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return null;
  const count = (...actions) => plan.filter((e) => actions.includes(e.action)).length;
  const parts = [
    [count('would-escalate'), 'would escalate'],
    [count('would-track'), 'would track'],
    [count('would-clear', 'would-resolve'), 'would clear'],
  ].filter(([n]) => n > 0).map(([n, label]) => `${label} ${n}`);
  return parts.length ? `residue (dry run): ${parts.join(', ')}` : null;
}

// #4421: the archive pass's count of run dirs with no owner block for run-liveness to ask. Rendered
// for 0 too — "none left" is the signal the legacy route's removal condition waits on. A pass that
// never ran the count leaves the field absent (not an integer), which renders nothing.
function formatOwnerlessLine(n) {
  if (!Number.isInteger(n)) return null;
  return `ownerless non-clean: ${n} ${pluralize('run dir', n)}`;
}

function formatConsoleReadyLine(console_) {
  const ready = console_ && console_.ready;
  if (!Array.isArray(ready) || ready.length === 0) return null;
  return `console: ${ready.length} ${pluralize('item', ready.length)} ready to execute`;
}

// Aggregates every PER-ITEM skip (an item that WAS examined, within a check
// that did run, and individually passed over) into { reason, unit,
// count }[] entries, one per (reason, unit) pair, in first-seen order.
function collectItemSkips(result) {
  const order = [];
  const byKey = new Map();
  function add(reason, unit) {
    const key = `${reason}${unit}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { reason, unit, count: 0 };
      byKey.set(key, entry);
      order.push(entry);
    }
    entry.count += 1;
  }

  for (const cat of CATEGORIES) {
    const arr = result[cat.key];
    if (!Array.isArray(arr)) continue;
    for (const e of scopedEntries(cat, arr)) {
      if (cat.skipActions.includes(e.action)) add(e.reason, cat.unit);
    }
  }
  if (result.console && Array.isArray(result.console.skipped)) {
    for (const e of result.console.skipped) add(e.reason, 'console item');
  }
  return order;
}

function formatItemSkippedLine(result) {
  const skips = collectItemSkips(result);
  if (skips.length === 0) return null;
  const total = skips.reduce((sum, e) => sum + e.count, 0);

  const distinctUnits = new Set(skips.map((e) => e.unit));
  const overallUnit = distinctUnits.size === 1 ? pluralize(skips[0].unit, total) : 'items';

  // Group by reason; a reason spanning more than one unit gets one
  // parenthesized breakdown segment per unit instead of one merged count —
  // the disambiguation the issue text calls for. Entries are already one per
  // (reason, unit) pair, so a reason with more than one entry is exactly the
  // multi-unit case.
  const byReason = new Map();
  for (const e of skips) {
    if (!byReason.has(e.reason)) byReason.set(e.reason, []);
    byReason.get(e.reason).push(e);
  }
  const parts = [];
  for (const entries of byReason.values()) {
    const needsUnit = entries.length > 1;
    for (const e of entries) {
      parts.push(needsUnit ? `${e.reason} (${e.unit}) ${e.count}` : `${e.reason} ${e.count}`);
    }
  }
  return `skipped: ${total} ${overallUnit} (${parts.join(', ')})`;
}

// One line per top-level `result.skipped` entry (index.js's shape:
// `{check, reason}`, `{check, reason, count}`, or `{check, reason, names}` —
// #848's non-canonical-run-dir entry, the one shape here that names concrete
// directories rather than a count) — see the header comment for why these
// render individually rather than folding into the per-item aggregate above.
function formatCheckSkipLines(result) {
  if (!Array.isArray(result.skipped)) return [];
  return result.skipped.map((e) => {
    const countSuffix = e.count > 1 ? ` x${e.count}` : '';
    const namesSuffix = Array.isArray(e.names) && e.names.length ? `: ${e.names.join(', ')}` : '';
    return `skipped: ${e.check} — ${e.reason}${countSuffix}${namesSuffix}`;
  });
}

// result -> compact multi-line string (no trailing newline; caller appends
// one, matching the `--json` branch's own `+ '\n'`). Never returns an empty
// string — a fully-null/fully-skipped result (no-repo, no-remote, the
// reconcile-threw catch) still renders its whole-check skip line(s), so a
// degrade path never looks like a clean no-op.
function formatSummary(result) {
  const lines = [];

  const mirrorLine = formatMirrorLine(result.mirror);
  if (mirrorLine) lines.push(mirrorLine);

  const redTipLine = formatRedTipLine(result.redTip);
  if (redTipLine) lines.push(redTipLine);

  const originHeadRepairLine = formatOriginHeadRepairLine(result.originHeadRepair);
  if (originHeadRepairLine) lines.push(originHeadRepairLine);

  for (const cat of CATEGORIES) {
    const arr = result[cat.key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const taken = scopedEntries(cat, arr).filter((e) => cat.takenActions.includes(e.action));
    if (taken.length) lines.push(`${cat.verb}: ${taken.length} ${pluralize(cat.unit, taken.length)}`);
  }

  const residuePlanLine = formatResiduePlanLine(result.residuePlan);
  if (residuePlanLine) lines.push(residuePlanLine);

  const ownerlessLine = formatOwnerlessLine(result.ownerlessNonClean);
  if (ownerlessLine) lines.push(ownerlessLine);

  const consoleReadyLine = formatConsoleReadyLine(result.console);
  if (consoleReadyLine) lines.push(consoleReadyLine);

  const itemSkippedLine = formatItemSkippedLine(result);
  if (itemSkippedLine) lines.push(itemSkippedLine);

  lines.push(...formatCheckSkipLines(result));

  if (lines.length === 0) return 'reconcile: nothing to do';
  return lines.join('\n');
}

module.exports = { formatSummary };
