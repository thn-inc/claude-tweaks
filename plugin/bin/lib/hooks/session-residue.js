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

// Unfinished pipeline runs (interrupted or still-active) under
// .claude-tweaks/pipelines/, newest first, capped at MAX_REPORTED. `exclude`
// drops one dir (a caller's own in-flight run) from the result so a
// wrap-up console never reports its own run as "residue". `-adhoc-standalone`
// dirs are skipped (#2783): they hold only friction events, nothing to resume
// or close, and EnterWorktree mints one per session — newest first, they
// would fill MAX_REPORTED ahead of a genuinely interrupted run.
function collectStaleRuns(cwd, { cache, exclude, pluginRoot } = {}) {
  const root = pluginRoot || '${CLAUDE_PLUGIN_ROOT}';
  const stale = [];
  for (const entry of ctxLib.iterRunDirsWithState(cwd)) {
    if (sameDir(entry.dir, exclude)) continue;
    if (ctxLib.isAdHocRunDir(entry.dir)) continue;
    stale.push(entry);
    if (stale.length >= MAX_REPORTED) break;
  }
  if (!stale.length) return [];
  const sigil = readWorkBackend(wtDetect.mainCheckoutRoot(cwd) || cwd) === 'local-files' ? '' : '#';
  return stale.map(({ dir, state }) => {
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
    return { dir, state, line: base };
  });
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
  MAX_REPORTED, SCAN_WINDOW, CONSOLE_OVERFLOW_LINE, collectStaleRuns, collectApprovableStandalone,
  scanUnresolvedConsoles, collectUnresolvedConsoles, consoleAckAllLine,
};
