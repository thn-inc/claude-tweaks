// bin/lib/hooks/session-residue.js — shared session-start residue detection
// (#2736). Named distinctly from the unrelated bin/residue.js ("outstanding
// residue at close time" — un-archived clean run dirs, stray worktrees,
// stale branches) to avoid conflating the two: this module is about
// unfinished/in-progress pipeline runs and unapproved standalone staged
// proposals, surfaced at SESSION start, not wrap-up's own close-time sweep.
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
const { safeReal } = require('./worktree-detect');

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
// wrap-up console never reports its own run as "residue".
function collectStaleRuns(cwd, { cache, exclude, pluginRoot } = {}) {
  const root = pluginRoot || '${CLAUDE_PLUGIN_ROOT}';
  const stale = [];
  for (const entry of ctxLib.iterRunDirsWithState(cwd)) {
    if (sameDir(entry.dir, exclude)) continue;
    stale.push(entry);
    if (stale.length >= MAX_REPORTED) break;
  }
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

module.exports = { MAX_REPORTED, collectStaleRuns, collectApprovableStandalone };
