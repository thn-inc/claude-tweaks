// bin/lib/hooks/sweep-shadow.js — pure logic behind `node bin/hooks.js
// sweep-shadow --run <anchored-run-dir> --worktree <path>` (#738).
//
// Promotes curation-engine.md §4's post-fan-out shadow sweep from a 29-line
// bash snippet embedded in that skill's prose to a unit-testable JS module,
// mirroring how run-dir-resolve.js already replaced an equivalent hand-
// written snippet (#692). Reproduces the documented bash exactly:
//
//   RUN_ROOT=$(node hooks.js resolve-run-dir --root-only)
//   RUN_DIR=$( [ -n "$PIPELINE_RUN_DIR" ] && cd "$PIPELINE_RUN_DIR" 2>/dev/null && pwd -P )
//   WT=$( [ -n "$WORKTREE" ] && cd "$WORKTREE" 2>/dev/null && pwd -P )
//   ... (see curation-engine.md §4 for the full reference snippet this
//   module is the JS mirror of, until that prose is updated to cite this
//   module instead of restating the snippet)
//
// A judge running inside a linked worktree can resolve the run dir
// RELATIVELY and write its staged proposal into the worktree's own shadow
// of `.claude-tweaks/pipelines/{run-id}/staged/` instead of the anchored
// run directory. This sweep relocates anything left behind there — never
// `work/`, whose materialized `{n}-spec.md` legitimately lives in the
// worktree and reaches the main checkout by merge.
'use strict';
const fs = require('fs');
const path = require('path');
const { isPathContained } = require('../shared-primitives');

// Mirrors the bash `cd "$X" 2>/dev/null && pwd -P` idiom: resolves symlinks
// and returns the canonical absolute path only when `p` is a real,
// existing directory. Anything else (unset, missing, not a directory)
// returns null — the same "stale/unset — fall through to the diagnostic"
// shape the reference snippet's own `[ -n ... ] && cd ... && pwd -P` chain
// produces on failure (an empty string).
function realDir(p) {
  if (typeof p !== 'string' || !p) return null;
  let real;
  try { real = fs.realpathSync(p); } catch { return null; }
  try { return fs.statSync(real).isDirectory() ? real : null; } catch { return null; }
}

// The `code` off a Node fs error when it has one, else the error itself —
// shared by every `sweep:` diagnostic line below.
function errCode(e) {
  return (e && e.code) || e;
}

// Runs `statFn(target)` and returns its result, or null if `target` is
// genuinely absent (ENOENT — the only clean no-op case). Any other failure
// — e.g. a permission-denied parent directory one level up the shadow path,
// ENOTDIR, ELOOP, EIO — pushes a `sweep: failed to check for {label}`
// diagnostic rather than being silently treated as "nothing to sweep"
// (#1305). Shared by the staged/ and decisions.md entry gates below.
function statOrDiagnose(statFn, target, label, lines) {
  try {
    return statFn(target);
  } catch (e) {
    if (!e || e.code !== 'ENOENT') {
      lines.push(`sweep: failed to check for ${label} — ${errCode(e)}`);
    }
    return null;
  }
}

// Atomically claims a free destination for `src`: `preferred` first, falling
// back to `preferred.shadow-dup`, `.shadow-dup-1`, ... — mirrors the bash
// `dest="$dest.shadow-dup"; n=1; while [ -e "$dest" ]; do
// dest="...shadow-dup-$n"; n=$((n+1)); done` loop's end state, but claims
// each candidate with fs.linkSync (atomic, EEXIST-safe: it throws rather
// than clobbering an existing destination) instead of a separate
// existsSync-then-renameSync pair. Two overlapping sweepShadow invocations
// racing the same slot can therefore never both win it — a plain
// exists-check followed by a separate rename let the second racer silently
// overwrite the first's already-relocated file (review finding); linkSync
// fails loudly on the exact path a rename would have clobbered. Once a
// candidate is claimed, unlinks `src` to complete the move.
function claimFreeDest(src, preferred) {
  let candidate = preferred;
  let n = 0;
  for (;;) {
    try {
      fs.linkSync(src, candidate);
      fs.unlinkSync(src);
      return candidate;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      n += 1;
      candidate = n === 1 ? `${preferred}.shadow-dup` : `${preferred}.shadow-dup-${n - 1}`;
    }
  }
}

// opts: { runRoot, pipelineRunDir, worktree }
// `runRoot` is the anchored main-checkout root (resolve-run-dir --root-only's
// own return value, or wtDetect.mainCheckoutRoot(cwd) called in-process —
// the CLI wiring in hooks.js does the latter). `pipelineRunDir`/`worktree`
// are the raw PIPELINE_RUN_DIR/WORKTREE values as given — normalized here,
// not by the caller.
//
// Returns { lines, diagnostic }: `lines` is one string per action, in the
// same wording the bash snippet echoed (so a caller substituting a JS call
// for the CLI/bash form sees byte-identical output); `diagnostic` is true
// iff any line is a tooling-failure diagnostic (every such line is
// prefixed `sweep:` — the same rule curation-engine.md §4 states for what
// gets logged `AUTO`/ledger-itemized rather than treated as a clean sweep).
function sweepShadow({ runRoot, pipelineRunDir, worktree }) {
  const runDir = realDir(pipelineRunDir);
  const wt = realDir(worktree);

  if (!runDir || !wt) {
    return { lines: ['sweep: PIPELINE_RUN_DIR or WORKTREE unset/missing — not swept'], diagnostic: true };
  }

  let root;
  try { root = fs.realpathSync(runRoot); } catch { root = runRoot; }

  if (!isPathContained(runDir, root)) {
    return { lines: [`sweep: ${runDir} is not under ${root} — not swept`], diagnostic: true };
  }

  const rel = path.relative(root, runDir);
  const shadow = path.join(wt, rel);

  // #1493/#1494: a `*-tidy-standalone*` (or, since sweep's shared run dir,
  // `*-sweep-standalone*` — Task 1's `{ISO}-sweep-standalone/`, whose Step 1
  // runs tidy inside it) run's worktree copy of `staged/`/`decisions.md` is
  // intentionally left in place — Step 7.5 commits it onto the branch and the
  // pr-first PR merge is what lands it in the anchored $RUN_ROOT copy. Sweeping
  // it back here would defeat that copy-then-commit path, so this run-dir shape
  // is exempt the same way `work/` above is (never touched by this sweep at all).
  if (/-(tidy|sweep)-standalone/.test(path.basename(runDir))) {
    return { lines: [], diagnostic: false };
  }

  let shadowReal = null;
  try { shadowReal = fs.realpathSync(shadow); } catch { /* shadow doesn't exist — fine, treated as not-same-path */ }
  const samePath = shadowReal !== null && shadowReal === runDir;

  const lines = [];
  if (samePath) return { lines, diagnostic: false }; // running from the main checkout — clean no-op, matches the `-ef` guard

  // ---- staged/ relocation ----
  // The readdir and every step below it are wrapped so a mid-sweep throw
  // (e.g. a permission-denied staged/ dir) becomes a `sweep:`-prefixed
  // diagnostic line instead of propagating to hooks.js's blanket
  // `.catch(() => process.exit(0))` — which would otherwise turn a failed
  // partial sweep into a silent, indistinguishable-from-clean exit 0.
  const shadowStaged = path.join(shadow, 'staged');
  const stagedStat = statOrDiagnose(fs.statSync, shadowStaged, 'shadow staged/', lines);
  if (stagedStat && stagedStat.isDirectory()) {
    let entries;
    try {
      entries = fs.readdirSync(shadowStaged).sort();
    } catch (e) {
      lines.push(`sweep: failed to read shadow staged/ — ${errCode(e)}`);
      entries = [];
    }
    for (const base of entries) {
      const f = path.join(shadowStaged, base);
      let lst;
      try { lst = fs.lstatSync(f); } catch { continue; } // vanished between readdir and lstat — nothing to report
      if (!lst.isFile()) {
        // Catches both a symlink (bash `-L`) and a directory/other non-regular
        // entry (bash `! -f`) in one check: lstat's isFile() is false for
        // both, since it never follows a symlink and a directory isn't a
        // regular file either way.
        lines.push(`sweep: skipped ${base} — not a regular file`);
        continue;
      }
      const dest = path.join(runDir, 'staged', base);
      try {
        const claimed = claimFreeDest(f, dest);
        lines.push(claimed === dest
          ? `relocated: ${base}`
          : `collision: ${base} (kept as ${path.basename(claimed)})`);
      } catch {
        lines.push(`sweep: FAILED to move ${base} — still in the shadow`);
      }
    }
    try {
      fs.rmdirSync(shadowStaged);
    } catch {
      lines.push(`sweep: shadow staged/ not empty after sweep — inspect ${shadowStaged}`);
    }
  }

  // ---- stray shadow decisions.md ----
  const shadowDecisions = path.join(shadow, 'decisions.md');
  const decisionsLstat = statOrDiagnose(fs.lstatSync, shadowDecisions, 'shadow decisions.md', lines);
  if (decisionsLstat && decisionsLstat.isFile()) {
    // lstat().isFile() is already false for a symlink (it never follows),
    // so this one check subsumes the bash pair `[ -f ... ] && [ ! -L ... ]`.
    try {
      const content = fs.readFileSync(shadowDecisions, 'utf8');
      const entryLines = content.split('\n').filter((l) => l.startsWith('- '));
      // Unlink before append (reversed from the read/append/unlink order this
      // block used to run): a mid-operation failure now either leaves the
      // shadow file untouched (unlink not yet attempted — readFileSync threw)
      // or fully consumed (unlink succeeded, so a retry has nothing left to
      // re-read and re-append). The old append-then-unlink order could append
      // successfully, then fail to unlink, and duplicate the same entries
      // into the anchored decisions.md on the next sweep. The tradeoff: if
      // appendFileSync itself now fails after the unlink already succeeded,
      // the entries exist only in memory for the remainder of this call and
      // are lost — surfaced via the diagnostic below rather than silently
      // dropped, which is strictly better than the old silent-duplication
      // failure mode.
      fs.unlinkSync(shadowDecisions);
      if (entryLines.length) {
        fs.appendFileSync(path.join(runDir, 'decisions.md'), entryLines.join('\n') + '\n');
        lines.push('relocated: decisions.md (entries appended)');
      } else {
        lines.push('sweep: shadow decisions.md had no entries — dropped');
      }
    } catch (e) {
      lines.push(`sweep: failed to relocate shadow decisions.md — ${errCode(e)}`);
    }
  }

  return { lines, diagnostic: lines.some((l) => l.startsWith('sweep:')) };
}

module.exports = { sweepShadow, claimFreeDest };
