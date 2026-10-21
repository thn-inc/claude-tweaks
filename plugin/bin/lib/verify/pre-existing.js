// plugin/bin/lib/verify/pre-existing.js — declared pre-existing/unrelated test
// failures (#3129). A sibling mechanism to flaky.js's planRetry, at the same
// file-level granularity and the same fail-closed posture, but with no retry:
// a run whose entire failing-file set is covered by the declared `preExisting`
// allowlist is adjudicated as passing, exactly as a baseline-adjudicated run
// is (verify.js's `--baseline`), without needing to re-run anything.
'use strict';

const { execFileSync } = require('child_process');
const { globToRegExp } = require('../issues/blast-radius');
const { TEST_FILE_RE } = require('./extract');

// `failingFiles`: the deduped, log-order failing-file set across every
// non-skipped failing check in the run (verify.js main() extracts this the
// same way retryHook does — extractFailingFiles, `[]` on no-parse).
// `preExisting`: decl.preExisting, the declared glob/path allowlist.
//
// Empty failingFiles is 'no-parse' — never adjudicated (a caller that cannot
// name what failed must never be told everything is covered). An empty
// allowlist is 'not-declared' — same shape, so a project with no `preExisting`
// key never silently waives anything.
function matchPreExisting({ failingFiles, preExisting }) {
  if (!Array.isArray(failingFiles) || failingFiles.length === 0) return { eligible: false, reason: 'no-parse' };
  const patterns = preExisting || [];
  if (patterns.length === 0) return { eligible: false, reason: 'not-declared' };
  const unmatched = failingFiles.filter((f) => !patterns.some((entry) => globToRegExp(entry).test(f)));
  if (unmatched.length) return { eligible: false, reason: `unlisted: [${unmatched.join(', ')}]`, unmatched };
  return { eligible: true, matched: [...new Set(failingFiles)] };
}

// #3313: the tracked files of the checkout at `cwd` that exist in its working
// tree, or null when git cannot say (not a repo, git absent) — null, never [],
// so a caller cannot read an unreadable list as "nothing is tracked". Listed
// once each (git lists an unmerged path once per stage) and minus the tracked
// files deleted from the working tree, which a suite could not have run.
// `execImpl` is injectable like report.js's gitInfo.
function trackedFiles(cwd, execImpl = execFileSync) {
  const list = (...flags) => String(execImpl('git', ['ls-files', '-z', ...flags], { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true })).split('\0').filter((f) => f !== '');
  try {
    const deleted = new Set(list('--deleted'));
    return [...new Set(list())].filter((f) => !deleted.has(f));
  } catch {
    return null;
  }
}

// #3313: the new/fixed split reported beside the adjudication verdict.
// `new` — failing files the allowlist does not cover (empty when the run is
// eligible). `fixed` — tracked test files an allowlist entry covers that did not
// fail this run: report-only, it never feeds the verdict. Only a full-scope
// run exercised every suite, so any narrower mode cannot claim a file passed
// (`fixed: null` with a reason, never `[]`); an unreadable tracked list is the
// same null. `allRan` is false when any check was skipped (fail-fast stops
// every later suite after a failure): a skipped suite proves nothing passed,
// so it is the same null. `verdict` is matchPreExisting's return value.
function newAndFixed({ verdict, failingFiles, preExisting, mode, allRan, listTracked }) {
  const newFiles = verdict.eligible ? [] : [...new Set(verdict.unmatched || [])];
  if (mode !== 'full') return { new: newFiles, fixed: null, fixedReason: `scope mode ${mode} did not run every suite` };
  if (!allRan) return { new: newFiles, fixed: null, fixedReason: 'a check was skipped (fail-fast)' };
  const tracked = listTracked();
  if (tracked === null) return { new: newFiles, fixed: null, fixedReason: 'git ls-files failed' };
  const failing = new Set(failingFiles);
  const matchers = (preExisting || []).map((entry) => globToRegExp(entry));
  // Only test files can have failed in a suite: a fixture an allowlist glob
  // happens to cover was never a failure candidate, so it is never "fixed".
  const fixed = tracked.filter((f) => TEST_FILE_RE.test(f) && !failing.has(f) && matchers.some((re) => re.test(f)));
  return { new: newFiles, fixed };
}

module.exports = { matchPreExisting, trackedFiles, newAndFixed };
