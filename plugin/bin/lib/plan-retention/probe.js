// The two environment-facing pieces of `tidy/scan-procedures.md` Step 4's Plan
// retention arithmetic (#4594): a plan's first-add date from git, and the
// fingerprint of the archive prune's declined-learning entry. route.js stays
// pure; this file holds the git argv and the fingerprint computation so each
// has one definition.
'use strict';

const { createFingerprint } = require('../health-core/fingerprint');
const { UNCOMMITTED } = require('./route');

// The `--source` and description `declined-learning.js lookup` is given for the
// archive prune; `archiveDeclineFingerprint()` is byte-for-byte what that verb
// computes (`createFingerprint(source, ['description']).fingerprint(...)`).
const DECLINE_SOURCE = 'tidy';
const DECLINE_DESCRIPTION = 'tidy Prune plan (archive): docs/superpowers/plans/';

function archiveDeclineFingerprint() {
  return createFingerprint(DECLINE_SOURCE, ['description']).fingerprint({ description: DECLINE_DESCRIPTION });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The calendar date (`%cs`) of the commit that added `plan` — its first add,
// except for a plan deleted and re-added, where `-1` takes the latest add and
// the cutoff counts from the re-add (the conservative reading: younger, so Keep)
// — or 'uncommitted' when git has none (untracked, never committed) or cannot say.
// `git(args)` returns the output string or null; a throw reads the same as null.
// `--literal-pathspecs` makes the plan a path, never a glob.
function firstAddedDate(plan, git) {
  try {
    const out = git(['--literal-pathspecs', 'log', '--diff-filter=A', '--format=%cs', '-1', '--', plan]);
    if (typeof out !== 'string') return UNCOMMITTED;
    const date = out.trim();
    return DATE_RE.test(date) ? date : UNCOMMITTED;
  } catch {
    return UNCOMMITTED;
  }
}

module.exports = { DECLINE_SOURCE, DECLINE_DESCRIPTION, archiveDeclineFingerprint, firstAddedDate };
