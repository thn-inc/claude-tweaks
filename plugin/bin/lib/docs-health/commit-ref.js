'use strict';
const { execFileSync } = require('child_process');

// Classifies commit hashes a docs-health finding cites against complete
// repository history (#2866) — the check #2785's own build had to redo by
// hand after its filed replacement text named one commit that exists but is
// unreachable from main and another that never touched the cited files.
//
// Outcomes:
//   reachable           one commit, an ancestor of the integration ref
//   exists-unreachable  one commit, not on the integration branch
//   not-found           no commit in any ref this clone has fetched
//   unverifiable        history could not be made complete (a shallow clone
//                       that could not be deepened, no integration ref, a git
//                       failure) — no verdict, never reported as not-found
//   ambiguous           an abbreviated hash matching more than one commit —
//                       never silently resolved to one of them
//   invalid             not a 4-64 character hexadecimal string (a
//                       could-not-parse signal, distinct from not-found)
//
// Shallow clones: a shallow view can neither prove a commit absent nor prove
// ancestry, so one bounded fetch deepens the clone over every branch head
// (refs/heads/* only — no tags, no pull-request refs) before anything is
// classified. Every head, not only the integration branch: clone --depth
// implies --single-branch, so a targeted fetch would leave a commit living
// only on another branch absent and misreport it as not-found. A failed
// fetch, or a clone still shallow afterwards, makes every hash unverifiable;
// deepen:false skips the fetch and returns unverifiable outright.
//
// Known limit: not-found means absent from every ref this clone has fetched.
// A non-shallow single-branch clone is not deepened and still lacks other
// branches' commits.

const OUTCOMES = Object.freeze([
  'reachable', 'exists-unreachable', 'not-found', 'unverifiable', 'ambiguous', 'invalid',
]);

const HASH_RE = /^[0-9a-f]{4,64}$/i;
// Remote and branch names reach git as positional arguments; refusing a
// leading '-' (and anything outside ref-safe characters) stops flag injection.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// Deepening downloads the repository's whole history, which a 5s
// single-call bound would cut off on any real repository; still bounded so a
// black-holed remote ends in unverifiable rather than a hang.
const DEEPEN_TIMEOUT_MS = 120000;

// Probe-style runner: calls here are expected to fail routinely (a missing
// ref, a non-ancestor), so stderr is captured, not leaked. Throws on a
// non-zero exit; err.status carries the exit code.
function defaultGit(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
  });
}

function errorText(err) {
  const text = [err && err.stderr, err && err.message].filter(Boolean).map(String).join(' ').trim();
  return text.split('\n')[0] || String(err);
}

function isShallow(git, root) {
  return git(['-C', root, 'rev-parse', '--is-shallow-repository']).trim() === 'true';
}

function resolveIntegrationBranch(git, root, remote, explicit) {
  if (explicit) return explicit;
  try {
    const out = git(['-C', root, 'symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]).trim();
    const prefix = `${remote}/`;
    return out.startsWith(prefix) ? out.slice(prefix.length) : null;
  } catch {
    return null;
  }
}

function resolveIntegrationRef(git, root, remote, branch) {
  for (const ref of [`refs/remotes/${remote}/${branch}`, `refs/heads/${branch}`]) {
    try {
      git(['-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
      return ref;
    } catch {
      // not this ref — try the next
    }
  }
  return null;
}

// rev-parse --verify cannot tell an unknown prefix from an ambiguous one
// (both exit 1); --disambiguate lists every object carrying the prefix.
function commitCandidates(git, root, prefix) {
  const out = git(['-C', root, 'rev-parse', `--disambiguate=${prefix}`]);
  const shas = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return shas.filter((sha) => git(['-C', root, 'cat-file', '-t', sha]).trim() === 'commit').sort();
}

function classifyOne(git, root, input, integrationRef) {
  let candidates;
  try {
    candidates = commitCandidates(git, root, input.toLowerCase());
  } catch (err) {
    return { input, outcome: 'unverifiable', reason: `could not resolve hash: ${errorText(err)}` };
  }
  if (candidates.length === 0) return { input, outcome: 'not-found' };
  if (candidates.length > 1) return { input, outcome: 'ambiguous', candidates };
  const sha = candidates[0];
  try {
    git(['-C', root, 'merge-base', '--is-ancestor', sha, integrationRef]);
    return { input, outcome: 'reachable', sha };
  } catch (err) {
    if (err && err.status === 1) return { input, outcome: 'exists-unreachable', sha };
    return { input, outcome: 'unverifiable', sha, reason: `ancestry check failed: ${errorText(err)}` };
  }
}

function verifyCommits({
  root, hashes, integrationBranch = null, remote = 'origin', deepen = true, git = defaultGit,
} = {}) {
  const inputs = (hashes || []).map(String);
  const result = {
    root,
    remote,
    integrationBranch: null,
    integrationRef: null,
    shallow: { initial: null, deepened: false, error: null },
    commits: [],
  };
  const invalid = (input) => ({
    input, outcome: 'invalid', reason: 'not a 4-64 character hexadecimal commit hash',
  });
  const allUnverifiable = (reason) => {
    result.commits = inputs.map((input) => (
      HASH_RE.test(input) ? { input, outcome: 'unverifiable', reason } : invalid(input)));
    return result;
  };

  if (!NAME_RE.test(remote)) return allUnverifiable(`invalid remote name: ${remote}`);
  if (integrationBranch !== null && !NAME_RE.test(integrationBranch)) {
    return allUnverifiable(`invalid integration branch name: ${integrationBranch}`);
  }

  try {
    result.shallow.initial = isShallow(git, root);
  } catch (err) {
    return allUnverifiable(`not a git repository, or git unavailable: ${errorText(err)}`);
  }

  if (result.shallow.initial) {
    if (!deepen) return allUnverifiable('shallow clone: history is incomplete and deepening was disabled');
    try {
      git(['-C', root, 'fetch', '--quiet', '--unshallow', '--no-tags', remote,
        `+refs/heads/*:refs/remotes/${remote}/*`], { timeout: DEEPEN_TIMEOUT_MS });
    } catch (err) {
      result.shallow.error = errorText(err);
      return allUnverifiable(`shallow clone: deepening fetch from ${remote} failed (${result.shallow.error})`);
    }
    try {
      if (isShallow(git, root)) return allUnverifiable('shallow clone: still shallow after deepening');
    } catch (err) {
      return allUnverifiable(`shallow clone: could not re-check after deepening: ${errorText(err)}`);
    }
    result.shallow.deepened = true;
  }

  const branch = resolveIntegrationBranch(git, root, remote, integrationBranch);
  if (!branch || !NAME_RE.test(branch)) {
    return allUnverifiable(`integration branch unresolved: pass --integration-branch or set ${remote}/HEAD`);
  }
  result.integrationBranch = branch;
  const ref = resolveIntegrationRef(git, root, remote, branch);
  if (!ref) return allUnverifiable(`integration ref not found for branch ${branch}`);
  result.integrationRef = ref;

  result.commits = inputs.map((input) => (
    HASH_RE.test(input) ? classifyOne(git, root, input, ref) : invalid(input)));
  return result;
}

module.exports = { verifyCommits, defaultGit, OUTCOMES, DEEPEN_TIMEOUT_MS };
