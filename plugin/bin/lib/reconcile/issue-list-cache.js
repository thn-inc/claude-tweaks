// plugin/bin/lib/reconcile/issue-list-cache.js — #2505: a shared, in-memory
// memo for the one `gh issue list --repo ... --state all --json ...
// --limit 10000` shape escalateResidue/resolveResidue's own
// findResidueDuplicate (escalate-residue.js) issues — that fetch is
// identical for every caller within one reconcile pass regardless of which
// (reason, path) or marker it's filtering for afterward, so N stuck
// dirs/paths escalating or resolving in the same pass were each paying for
// their own full-repo `gh issue list` round trip (#2505's Current State).
// Scoped to ONE createIssueListCache() instance's own lifetime —
// reconcile/index.js creates exactly one per reconcile() pass and threads
// its `runner` down through archiveMerged/reapMerged/cache.js's
// trackResidue/pruneResidueFailures into escalateResidue/resolveResidue's
// own injectable `runner` param (escalate-residue.js needs no changes —
// it already accepts one), so nothing here persists across passes or
// processes (the AC's "no stale cross-pass reuse").
'use strict';
const { defaultRunner } = require('../feedback/file-feedback');

// Only this exact shape is memoized — every other runner call (issue
// create/edit/comment/reopen/close) is a write and must always execute, so
// it passes straight through uncached.
function isIssueListCall(argv) {
  return Array.isArray(argv) && argv[0] === 'issue' && argv[1] === 'list';
}

function repoFromArgv(argv) {
  const i = argv.indexOf('--repo');
  return i === -1 ? null : argv[i + 1];
}

// { base?: (argv) => string } -> { runner: (argv) => string }
// `base` defaults to the real `gh` runner (file-feedback.js's
// defaultRunner) so production callers (reconcile/index.js) need pass
// nothing; tests inject a counting fake instead. A thrown `base` call is
// never cached — the memo is only populated after a successful read, so
// the next call for that repo retries rather than replaying a failure.
function createIssueListCache({ base = defaultRunner } = {}) {
  const memo = new Map();
  function runner(argv) {
    if (!isIssueListCall(argv)) return base(argv);
    const repo = repoFromArgv(argv);
    if (repo === null) return base(argv);
    if (memo.has(repo)) return memo.get(repo);
    const out = base(argv);
    memo.set(repo, out);
    return out;
  }
  return { runner };
}

module.exports = { createIssueListCache, isIssueListCall, repoFromArgv };
