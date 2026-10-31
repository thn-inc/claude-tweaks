// bin/lib/branch-name.js — the one branch-name validator the plugin's CLIs and
// libs share (#4648). Four callers, each putting a caller-supplied name into
// a git argument or a rendered file:
//   - bin/pre-review-catchup.js — `--integration-branch`
//   - bin/release-bootstrap.js — `--branch`
//   - lib/init/release-bootstrap.js — the branch the rendered workflow triggers on
//   - lib/worktree/remote-branch-collision.js — the `refs/heads/{branch}` argument
'use strict';

// The practical subset of `git check-ref-format --branch`: a non-empty
// string, no whitespace or control characters, none of the ref-forbidding
// characters, no "..", no leading "-", no trailing "/" or ".lock", no "//".
const INVALID_BRANCH_CHARS_RE = /[~^:?*[\\]/;
function isValidBranchName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (/[\s\x00-\x1f\x7f]/.test(name)) return false;
  if (INVALID_BRANCH_CHARS_RE.test(name)) return false;
  if (name.includes('..')) return false;
  if (name.includes('//')) return false;
  if (name.startsWith('-')) return false;
  if (name.endsWith('/') || name.endsWith('.lock')) return false;
  return true;
}

module.exports = { isValidBranchName };
