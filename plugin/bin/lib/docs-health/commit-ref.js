'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { acquireLock, releaseLock } = require('../file-lock');

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
// Known limit: not-found means absent from every ref this clone has
// fetched, as of its last fetch — a non-shallow clone is never fetched by
// this module, so a commit pushed upstream since then reads not-found. A
// non-shallow single-branch clone also still lacks other branches' commits.

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

// Basename of the cross-process lock file-lock.js creates under
// `{root}/.git/` to serialize concurrent --unshallow fetches against the
// same repo (#2988). Exported so tests construct the exact same path the
// implementation below uses, rather than duplicating the literal.
const DEEPEN_LOCK_FILENAME = 'docs-health-verify-commit.lock';

// Probe-style runner: calls here are expected to fail routinely (a missing
// ref, a non-ancestor), so stderr is captured, not leaked. Throws on a
// non-zero exit; err.status carries the exit code.
function defaultGit(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    windowsHide: true,
  });
}

function errorText(err) {
  const text = [err && err.stderr, err && err.message].filter(Boolean).map(String).join(' ').trim();
  return text.split('\n')[0] || String(err);
}

function isShallow(git, root) {
  const out = git(['-C', root, 'rev-parse', '--is-shallow-repository']).trim();
  if (out === 'true') return true;
  if (out === 'false') return false;
  throw new Error(`unexpected is-shallow-repository output: ${out}`);
}

// git rev-parse --disambiguate truncates an over-length prefix to the
// repository's own hash length (#2866), so it cannot by itself tell an
// over-long (and therefore malformed) hash from a real one. Read the object
// format once, up front, so callers can classify any input longer than it
// as invalid rather than letting a truncated match read as reachable.
function objectHashLength(git, root) {
  const out = git(['-C', root, 'rev-parse', '--show-object-format']).trim();
  if (out === 'sha1') return 40;
  if (out === 'sha256') return 64;
  throw new Error(`unexpected object-format output: ${out}`);
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
// An annotated tag object is kept alongside commits (not filtered out) —
// classifyOne below peels it to the commit it points at before the ancestry
// check, so a citation of a tag object's own hash is classified rather than
// misreported as not-found (#2866 whole-branch review M4).
function commitCandidates(git, root, prefix) {
  const out = git(['-C', root, 'rev-parse', `--disambiguate=${prefix}`]);
  const shas = out.split('\n').map((l) => l.trim()).filter(Boolean);
  // Belt-and-braces against --disambiguate's own prefix truncation (#2866):
  // keep only candidates that actually start with the (lowercased) prefix.
  return shas
    .filter((sha) => sha.startsWith(prefix)
      && ['commit', 'tag'].includes(git(['-C', root, 'cat-file', '-t', sha]).trim()))
    .sort();
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
  let commitSha = sha;
  try {
    if (git(['-C', root, 'cat-file', '-t', sha]).trim() === 'tag') {
      commitSha = git(['-C', root, 'rev-parse', '--verify', '--end-of-options', `${sha}^{commit}`]).trim();
    }
  } catch (err) {
    return { input, outcome: 'unverifiable', sha, reason: `could not peel tag to commit: ${errorText(err)}` };
  }
  try {
    git(['-C', root, 'merge-base', '--is-ancestor', commitSha, integrationRef]);
    return { input, outcome: 'reachable', sha: commitSha };
  } catch (err) {
    if (err && err.status === 1) return { input, outcome: 'exists-unreachable', sha: commitSha };
    return { input, outcome: 'unverifiable', sha: commitSha, reason: `ancestry check failed: ${errorText(err)}` };
  }
}

// Serializes the --unshallow fetch for `root` across every concurrent
// caller -- across OS processes via file-lock.js's cross-process mkdir
// mutex (#2988): under docs-health --budget > 1, concurrent judge agents
// each run the verify-commit CLI as a separate process against the same
// shared shallow checkout, so an in-process-only guard would not
// serialize them.
//
// Returns { stillShallow: boolean } on success (the fetch outcome,
// whichever caller actually performed it, or the already-deepened state
// found on re-check) or { error: string } on failure.
function deepenShallowClone(git, root, remote) {
  const cacheKey = path.resolve(root);
  const lockPath = path.join(cacheKey, '.git', DEEPEN_LOCK_FILENAME);
  // file-lock's default wait (500ms) is far too short to block a waiting
  // caller through another process's own DEEPEN_TIMEOUT_MS-bounded fetch
  // -- override it just for this acquisition, restoring whatever the
  // calling process had (or lacked) immediately after, so this module
  // never leaves a process-wide env mutation behind.
  const prevWait = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = String(DEEPEN_TIMEOUT_MS);
  let held;
  try {
    held = acquireLock(lockPath);
  } finally {
    if (prevWait === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
    else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prevWait;
  }
  try {
    // Re-check after acquiring (or failing to acquire) the lock: another
    // caller -- the lock's prior holder -- may have already deepened this
    // exact repo while this caller waited. Skipping a redundant fetch
    // here is what turns the loser's old "fetch fails, report
    // unverifiable" outcome into a correct classification against the
    // now-complete history instead.
    let shallowNow;
    try {
      shallowNow = isShallow(git, root);
    } catch (err) {
      return { error: `could not re-check shallow state: ${errorText(err)}` };
    }
    if (!shallowNow) return { stillShallow: false };
    try {
      git(['-C', root, 'fetch', '--quiet', '--unshallow', '--no-tags', remote,
        `+refs/heads/*:refs/remotes/${remote}/*`], {
        timeout: DEEPEN_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (err) {
      return { error: errorText(err) };
    }
    try {
      return { stillShallow: isShallow(git, root) };
    } catch (err) {
      return { error: `could not re-check after deepening: ${errorText(err)}` };
    }
  } finally {
    releaseLock(held);
  }
}

function verifyCommits({
  root, hashes, integrationBranch = null, remote = 'origin', deepen = true, git = defaultGit,
} = {}) {
  // A non-array hashes value (programmatic misuse — the CLI always passes an
  // array) used to throw the cryptic "hashes.map is not a function" from the
  // line below; fail with a clear, named error instead (#2866 whole-branch
  // review M11).
  if (hashes != null && !Array.isArray(hashes)) {
    throw new TypeError(`verifyCommits: hashes must be an array, got ${typeof hashes}`);
  }
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

  // Resolve the branch NAME before paying for the deepen fetch (#2866), so a
  // run that cannot reach a verdict never pays for the network side effect.
  // resolveIntegrationRef stays after the deepen below — the fetch can
  // create the ref it needs.
  const branch = resolveIntegrationBranch(git, root, remote, integrationBranch);
  if (!branch || !NAME_RE.test(branch)) {
    return allUnverifiable(`integration branch unresolved: pass --integration-branch or set ${remote}/HEAD`);
  }
  result.integrationBranch = branch;

  if (result.shallow.initial) {
    if (!deepen) return allUnverifiable('shallow clone: history is incomplete and deepening was disabled');
    const deepenOutcome = deepenShallowClone(git, root, remote);
    if (deepenOutcome.error) {
      result.shallow.error = deepenOutcome.error;
      return allUnverifiable(`shallow clone: deepening fetch from ${remote} failed (${deepenOutcome.error})`);
    }
    if (deepenOutcome.stillShallow) return allUnverifiable('shallow clone: still shallow after deepening');
    result.shallow.deepened = true;
  }

  const ref = resolveIntegrationRef(git, root, remote, branch);
  if (!ref) return allUnverifiable(`integration ref not found for branch ${branch}`);
  result.integrationRef = ref;

  // Over-length inputs must be classified invalid before classifyOne ever
  // sees them — see objectHashLength's own comment above (#2866): a
  // truncated --disambiguate match would otherwise read as reachable.
  let hashLength;
  try {
    hashLength = objectHashLength(git, root);
  } catch (err) {
    return allUnverifiable(`could not determine the repository's object hash format: ${errorText(err)}`);
  }

  result.commits = inputs.map((input) => (
    HASH_RE.test(input) && input.length <= hashLength
      ? classifyOne(git, root, input, ref)
      : invalid(input)));
  return result;
}

module.exports = { verifyCommits, defaultGit, OUTCOMES, DEEPEN_TIMEOUT_MS, DEEPEN_LOCK_FILENAME };
