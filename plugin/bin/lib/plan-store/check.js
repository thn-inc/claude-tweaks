// plugin/bin/lib/plan-store/check.js — is a stored plan still valid for the current spec and base? (#6052)
// Four checks run in CHECK_ORDER and the first failure wins; each verdict depends only on its own
// input. Anything undeterminable (a fetch error, an unresolvable base, a throw) reads invalid, never
// valid. checkPlan never throws and returns exactly `{valid, failed}`.
'use strict';

const { extractFileEntries } = require('../plan-audit/parser');
const { DEFAULT_REMOTE } = require('./ref');
const { fetchRef, localRef, planCommitFile, resolveCommit, changedPaths } = require('./git');

const CHECK_ORDER = ['ref', 'hash', 'base', 'files'];

// The Modify and Test paths of the plan's Files sections (Check A's parse), de-duplicated in
// first-seen order. Create and Delete entries are not named: they cannot go stale under the plan.
function namedPaths(planText) {
  const seen = new Set();
  for (const { type, path } of extractFileEntries(planText)) {
    if (type === 'Modify' || type === 'Test') seen.add(path);
  }
  return [...seen];
}

function checkPlan(opts) {
  let running = CHECK_ORDER[0];
  try {
    const { g, remote = DEFAULT_REMOTE, fetch, line, currentSpecHash, base } = opts ?? {};
    // ref: the plan is fetchable, the ref names the line's commit, and the commit is a well-formed plan commit.
    if (fetch && !fetchRef(g, remote, line.ref).ok) return { valid: false, failed: 'ref' };
    if (localRef(g, line.ref) !== line.commit) return { valid: false, failed: 'ref' };
    const file = planCommitFile(g, line.commit);
    if (!file.ok) return { valid: false, failed: 'ref' };

    running = 'hash';
    if (typeof currentSpecHash !== 'string' || currentSpecHash !== line.specHash) return { valid: false, failed: 'hash' };

    running = 'base';
    const baseSha = resolveCommit(g, base);
    if (!baseSha) return { valid: false, failed: 'base' };

    running = 'files';
    // A plan naming no Modify or Test path cannot be shown fresh against any base, so it fails
    // toward a re-plan (spec AC3) rather than reading vacuously valid.
    const named = namedPaths(file.bytes.toString('utf8'));
    if (named.length === 0) return { valid: false, failed: 'files' };
    // The plan commit's parent is the base the plan was reviewed against: writePlan commits the plan
    // onto `--base` (store.js), so parent..base is exactly the drift the plan has not seen.
    const changed = changedPaths(g, file.parent, baseSha, named);
    if (!changed.ok || named.some((p) => changed.paths.has(p))) return { valid: false, failed: 'files' };

    return { valid: true, failed: null };
  } catch {
    return { valid: false, failed: running };
  }
}

module.exports = { CHECK_ORDER, namedPaths, checkPlan };
