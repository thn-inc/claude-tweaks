// bin/lib/hooks/session-residue.js — shared session-start residue detection
// (#2736). Named distinctly from the unrelated bin/residue.js ("outstanding
// residue at close time" — un-archived clean run dirs, stray worktrees,
// stale branches) to avoid conflating the two: this module is about
// unfinished/in-progress pipeline runs and unapproved standalone staged
// proposals, surfaced at SESSION start, not wrap-up's own close-time sweep.
//
// Three detections: unfinished runs, unapproved standalone staged proposals,
// and (#3370) closed or archived runs whose unattended Review Console left
// items no human has reviewed.
//
// Two consumers read this same detection: SessionStart's own advisory
// banners (session-start.js) and `hooks.js check-session-residue`, the CLI
// wrap-up's Review Console runs to re-surface any residue that was flagged
// at this session's start and remains unresolved by the time the console
// renders. One detection, two call sites — deliberately, so the two never
// drift apart on what counts as residue or what resolution command a row
// points at.
//
// Read-only: no writes, no event appends, no git mutations. Callers decide
// what to do with the returned lines; this module only detects and formats.
'use strict';
const fs = require('fs');
const path = require('path');
const ctxLib = require('./context');
const runIntegrity = require('./run-integrity');
const passReentry = require('../flow/consolidated-pass');
const wtDetect = require('./worktree-detect');
const { readWorkBackend } = require('../work-backend');
const { readRunResidue, formatResidueLines } = require('../console/residue');

const { safeReal } = wtDetect;

// Caps both lists at the same size SessionStart has always used — a long
// tail of stale runs is exactly the noise MAX_REPORTED exists to avoid.
const MAX_REPORTED = 3;

// Realpath both sides before comparing: iterRunDirsWithState's `dir` is
// built from mainCheckoutRoot() (realpath'd internally), while a caller's
// `exclude` (e.g. hooks.js's own --run resolution) is typically the
// unresolved `path.resolve` form — a symlinked path component (macOS /tmp
// is the common case) would otherwise make an in-flight run's own dir fail
// to match and get reported as its own residue.
function sameDir(a, b) {
  if (!a || !b) return false;
  return (safeReal(a) || path.resolve(a)) === (safeReal(b) || path.resolve(b));
}

// #3977: the overflow line under the orphaned-runs rows, in CONSOLE_OVERFLOW_LINE's
// style, naming the command that lists every orphan.
function ORPHANED_OVERFLOW_LINE(n, pluginRoot) {
  return `- … and ${n} more orphaned run(s) (newest ${MAX_REPORTED} shown): node "${pluginRoot}/bin/hooks.js" reconcile --dry-run --json --checks archive`;
}

// The `orphaned` list the last real reconcile pass cached (reconcile/cache.js,
// #3977), keyed by run id. Empty before the first pass, or on any read failure.
function cachedOrphans(mainRoot, readReconcileCache) {
  const byId = new Map();
  try {
    const read = readReconcileCache || require('../reconcile/cache').readCache;
    const list = (read(mainRoot) || {}).orphaned;
    for (const e of Array.isArray(list) ? list : []) {
      if (e && typeof e.runId === 'string' && typeof e.reason === 'string') byId.set(e.runId, e);
    }
  } catch { /* no cache, no rows */ }
  return byId;
}

// The verdict reconcile itself judged by (archive-merged.js defaultRunVerdict):
// offline — `ps`, the run's own files and `git worktree list`, never the network.
// The lock probe reads the one worktree listing the run-integrity `cache` holds,
// so a SessionStart with several orphans still lists worktrees once (#381).
// Lazy: archive-merged.js is a large module SessionStart only needs when a cached orphan exists.
function livenessFor(cache) {
  const { lockInUse } = require('../run-liveness/probes').DEFAULT_PROBES;
  const { defaultRunVerdict } = require('../reconcile/archive-merged');
  const listStdout = (root) => runIntegrity.worktreeListStdout(root, cache);
  return (dir) => defaultRunVerdict(dir, Date.now(), { lockInUse: (wt) => lockInUse(wt, { listStdout }) });
}

// The run's record ids for its resume command, sigil per work-backend; [] when
// the slug and manifest name none (or any id is not an integer).
function resumeIds(dir, sigil) {
  try {
    const ids = require('../reconcile/archive-merged').runRecordSet(dir);
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => Number.isInteger(id))) return [];
    return ids.map((id) => sigil + id);
  } catch {
    return [];
  }
}

// Orphaned pipeline runs whose session is gone (#3977): a non-clean run is
// listed only when the last reconcile pass's report-only disposition pass named
// it an orphan (reconcile-cache.json's `orphaned`, so nothing is listed before
// the first pass) AND its run-liveness verdict, re-checked offline now, is
// still `dead` — a live sibling session's run, or one whose liveness cannot be
// told, is never listed. Newest first, capped at MAX_REPORTED; when more pass
// the filter, one trailing `{ dir: null, state: null, overflow: N, line }`
// element carries ORPHANED_OVERFLOW_LINE. `exclude` drops one dir (a caller's
// own in-flight run) so a wrap-up console never reports its own run as
// "residue". `-adhoc-standalone` dirs are skipped (#2783): they hold only
// friction events, and EnterWorktree mints one per session — newest first, they
// would fill MAX_REPORTED ahead of a genuinely orphaned run. `liveness` and
// `readReconcileCache` are test seams.
function collectStaleRuns(cwd, {
  cache, exclude, pluginRoot, liveness, readReconcileCache,
} = {}) {
  const root = pluginRoot || '${CLAUDE_PLUGIN_ROOT}';
  const mainRoot = wtDetect.mainCheckoutRoot(cwd) || cwd;
  const orphans = cachedOrphans(mainRoot, readReconcileCache);
  if (!orphans.size) return [];
  const judge = liveness || livenessFor(cache);
  const stale = [];
  for (const entry of ctxLib.iterRunDirsWithState(cwd)) {
    if (sameDir(entry.dir, exclude)) continue;
    if (ctxLib.isAdHocRunDir(entry.dir)) continue;
    const cached = orphans.get(path.basename(entry.dir));
    if (!cached) continue;
    let verdict = 'unknown';
    try { verdict = (judge(entry.dir) || {}).verdict; } catch { /* unknown: not listed */ }
    if (verdict !== 'dead') continue;
    stale.push({ ...entry, reason: cached.reason });
  }
  if (!stale.length) return [];
  const overflow = stale.length - MAX_REPORTED;
  const sigil = readWorkBackend(mainRoot) === 'local-files' ? '' : '#';
  const rows = stale.slice(0, MAX_REPORTED).map(({ dir, state, reason }) => {
    const prSuffix = state && state.pr && state.pr.url ? ` — PR ${state.pr.url}` : '';
    const base = `- ${path.basename(dir)} (status: ${(state && state.status) || 'unknown'})${prSuffix}`;
    try {
      const verdict = runIntegrity.checkRunIntegrity(dir, { cache });
      if (verdict.state === 'shipped-unclosed') {
        const how = verdict.evidence.merged === 'cherry' ? 'squash/rebase-equivalent' : 'merged';
        return {
          dir,
          state,
          line:
            `${base} — work appears shipped (branch ${verdict.evidence.branch} ${how} into the integration branch, ` +
            'no wrap-up recorded): close out with /claude-tweaks:wrap-up, or bookkeeping-only: ' +
            `node "${root}/bin/hooks.js" close-run --run "${dir}"`,
        };
      }
    } catch { /* integrity check is advisory — never break the scan */ }
    // #3497: a multi-spec run whose consolidated Review Console pass never ran
    // names its re-entry command. Offline only (no `online`) — SessionStart must
    // stay network-free; a squash-merged multi-commit branch can therefore still
    // read as unmerged here, and the review-console skill's online check is what
    // refuses it at invocation. No `sessionId` either — SessionStart has no run
    // of its own to exempt, so a live parent lock, a recent parent commit or an
    // indeterminate liveness answer always suppresses the suffix.
    // The record-reference grammar drops the sigil under `local-files`
    // (_shared/record-batch-input.md), and an unreadable or unknown backend keeps `#`.
    try {
      const pass = passReentry.checkPassReentry(dir, { cache });
      // Manifest ids are other sessions' file content headed for a command line:
      // a non-integer id suppresses the suffix. The full dir is named so the
      // pasted command never falls back to the most-recent-slug heuristic.
      if (pass.eligible && pass.specIds.every((id) => Number.isInteger(id))) {
        const ids = pass.specIds.map((id) => sigil + id).join(',');
        return {
          dir,
          state,
          line: `${base} — consolidated pass never ran: PIPELINE_RUN_DIR="${dir}" /claude-tweaks:flow ${ids} review-console`,
        };
      }
    } catch { /* re-entry check is advisory — never break the scan */ }
    // #3977: the cached disposition reason, and a resume command /flow adopts
    // (an anchored run dir with config.yml is its Step 3 adoption case 1).
    const ids = resumeIds(dir, sigil);
    const how = ids.length
      ? `resume with PIPELINE_RUN_DIR="${dir}" /claude-tweaks:flow ${ids.join(',')}`
      : `list with node "${root}/bin/hooks.js" reconcile --dry-run --json --checks archive`;
    return { dir, state, line: `${base} — ${reason}: ${how}` };
  });
  if (overflow > 0) rows.push({ dir: null, state: null, overflow, line: ORPHANED_OVERFLOW_LINE(overflow, root) });
  return rows;
}

// Standalone runs (`*-tidy-standalone*` / `*-sweep-standalone*`) that
// finished clean but still carry unapproved `staged/` proposals, newest
// first, capped at MAX_REPORTED. Same `exclude` contract as above.
function collectApprovableStandalone(cwd, { exclude } = {}) {
  const approvable = [];
  for (const { dir } of ctxLib.iterRunDirsWithState(cwd, { status: 'clean' })) {
    if (sameDir(dir, exclude)) continue;
    if (!/-(tidy|sweep)-standalone/.test(path.basename(dir))) continue;
    let staged;
    try { staged = fs.readdirSync(path.join(dir, 'staged')); } catch { continue; }
    if (!staged.length) continue;
    approvable.push(dir);
    if (approvable.length >= MAX_REPORTED) break;
  }
  return approvable.map((dir) => ({
    dir,
    line: `- ${path.basename(dir)} — staged proposal(s) awaiting approval: /claude-tweaks:tidy --approve "${dir}"`,
  }));
}

// How many of the newest run names (top-level and archive/ merged) the
// console-residue scan considers. Bounds SessionStart's cost once every
// console is acknowledged and no early stop fires; a high-water-mark file was
// rejected because it mis-skips runs still open when it was written.
const SCAN_WINDOW = 200;

function runIdNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && ctxLib.RUN_ID_RE.test(e.name))
      .map((e) => e.name);
  } catch { return []; }
}

// Closed (clean, top-level) and archived runs whose Review Console left
// `pending` / `keep-staged` items — or PR console items whose outcome is
// `filing-failed` / `reverse-failed` (#4172) — no human has reviewed (#3370), newest first
// by basename, capped at `limit` (default MAX_REPORTED). Candidates are the
// newest `window` run-id names of the top level and archive/ merged, listed
// without reading any state; a basename in both is kept once, top-level
// preferred. An unresolved item whose staged file is gone is `missing`, not
// residue (#3772): `readRunResidue` drops it from the count, so a run whose
// every unresolved item is missing is not reported. A top-level candidate
// counts only when its run-state.json is `clean` and its archive twin is
// neither clean nor freshly `archiving`
// (iterRunDirsWithState's twin skip); otherwise its archive/ copy, when there
// is one, stands in. Only consoles not yet acknowledged count — a run is kept
// when at least one remains, and only those are listed. Reading stops as soon
// as `limit` runs are kept. `more` is true when that stop or the window left
// candidates unread. `readFile` is the readRunResidue test seam.
function scanUnresolvedConsoles(cwd, { exclude, pluginRoot, limit = MAX_REPORTED, window = SCAN_WINDOW, readFile } = {}) {
  const root = pluginRoot || '${CLAUDE_PLUGIN_ROOT}';
  const base = path.join(wtDetect.mainCheckoutRoot(cwd) || cwd, '.claude-tweaks', 'pipelines');
  const archiveBase = path.join(base, 'archive');
  const top = new Set(runIdNames(base));
  const archived = new Set(runIdNames(archiveBase));
  const names = [...new Set([...top, ...archived])].sort().reverse();
  const candidates = names.slice(0, window);
  let more = candidates.length < names.length;

  const candidateDir = (name) => {
    if (top.has(name)) {
      const twin = archived.has(name) ? ctxLib.readRunState(path.join(archiveBase, name)) : null;
      const twinDone = Boolean(twin && (twin.status === 'clean' || (twin.status === 'archiving' && !ctxLib.isStaleClaim(twin))));
      if (!twinDone) {
        const state = ctxLib.readRunState(path.join(base, name));
        if (state && state.status === 'clean') return path.join(base, name);
      }
    }
    return archived.has(name) ? path.join(archiveBase, name) : null;
  };

  const runs = [];
  for (const name of candidates) {
    if (runs.length >= limit) { more = true; break; }
    const dir = candidateDir(name);
    if (!dir || sameDir(dir, exclude)) continue;
    const found = readRunResidue(dir, readFile ? { readFile } : undefined);
    const consoles = found.consoles.filter((c) => !c.acknowledged);
    if (!consoles.length) continue;
    const missingOnly = found.missingOnly.filter((c) => !c.acknowledged);
    runs.push({ dir, consoles, lines: formatResidueLines({ dir, consoles, missingOnly }, { pluginRoot: root }) });
  }
  return { runs, more };
}

function collectUnresolvedConsoles(cwd, opts) {
  return scanUnresolvedConsoles(cwd, opts).runs;
}

// The two lines both renderers add around scanUnresolvedConsoles' runs: the
// overflow line (only when `more`) and the bulk way out of a backlog.
const CONSOLE_OVERFLOW_LINE = `- … more run(s) may have unreviewed console items (newest ${MAX_REPORTED} shown).`;
function consoleAckAllLine(pluginRoot) {
  return 'To dismiss every listed and older unreviewed item at once after reviewing (a human decision): ' +
    `node "${pluginRoot || '${CLAUDE_PLUGIN_ROOT}'}/bin/console-residue.js" --ack-all`;
}

module.exports = {
  MAX_REPORTED, SCAN_WINDOW, CONSOLE_OVERFLOW_LINE, ORPHANED_OVERFLOW_LINE, collectStaleRuns, collectApprovableStandalone,
  scanUnresolvedConsoles, collectUnresolvedConsoles, consoleAckAllLine,
};
