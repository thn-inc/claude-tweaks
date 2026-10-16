// plugin/bin/lib/verify/pre-existing.js — declared pre-existing/unrelated test
// failures (#3129). A sibling mechanism to flaky.js's planRetry, at the same
// file-level granularity and the same fail-closed posture, but with no retry:
// a run whose entire failing-file set is covered by the declared `preExisting`
// allowlist is adjudicated as passing, exactly as a baseline-adjudicated run
// is (verify.js's `--baseline`), without needing to re-run anything.
'use strict';

const { globToRegExp } = require('../issues/blast-radius');

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

module.exports = { matchPreExisting };
