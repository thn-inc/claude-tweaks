// bin/lib/release-state/store.js
// The branch store behind /release's "reviewed through" marker (#5883): one small
// JSON file per name on the `release-state` branch, read over a git leg first
// (fetch the branch tip into a scratch ref, `git show` the file at it) and over
// the contents API when git cannot answer. This task owns the reads and the
// branch bootstrap; the writes join this file in the next task.
//
// The module spawns nothing itself. Both runners are injected:
//   `deps.ghApi(args)`            -> `{stdout, failure, status, error?}`, never throws
//                                    (claim-store.js's contract); the caller has already
//                                    appended any `--hostname`.
//   `deps.gitRunner(args, {input, extraEnv} = {})` -> stdout string, throws on failure;
//                                    the runner owns its cwd and its repo-pinned env and
//                                    layers `extraEnv` on top. Omitted, every call takes
//                                    the contents-API leg (the gh-only / MCP-only seam).
// `slug` is a bare `owner/repo`: a host-qualified slug inside a REST path is the open
// defect #4988, so one throws `TypeError` (a caller bug), as does a `name` that fails
// STATE_FILE_RE.
//
// The one rule every read here obeys: ABSENT is only ever a confirmed answer. A
// contents-API 404 means "no such file", "no such branch" or "no such repository the
// token can see" alike, so a 404 reads absent only after the branch read (and, for a
// 404 there, a repository read) confirms it. Anything else, an inaccessible repository
// included, is `unreadable` and the caller stops. Bytes that were read but are not a
// JSON object are `unreadable` too, and keep their lease so a forced reset can still
// write over them.
//
// `lease` is the compare-and-swap token for a write: the branch tip commit sha on the
// git leg (null when the branch is missing) and the blob sha on the contents-API leg.
// The two are never interchangeable and a lease is never carried across transports.
//
// Mirrors claim-store.js's readClaimBlob / readClaimBlobContentsApi / readClaimsBranch /
// ensureClaimsBranch (parameterized on a file name), and claims-git-cas.js's
// readClaimBlobGit / bootstrapClaimsBranchGit; if either changes, check the other.
// Nothing is extracted from those: their signatures belong to the fleet's most-contended
// write path.
'use strict';

const { refusalText } = require('../issues/claim-store');
const { classifyGitError, errText } = require('../issues/claims-git-cas');

const RELEASE_STATE_BRANCH = 'release-state';
const STATE_FILE_RE = /^[a-z0-9][a-z0-9-]*\.json$/;
// How many times a write re-leases and re-pushes after a rejection a fresh read proves
// spurious (the next task's writes; claim-store.js's constant of the same name).
const MAX_CAS_ATTEMPTS = 3;

const BARE_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SCRATCH_REF_PREFIX = 'refs/release-state-cas';

function assertSlug(slug) {
  const ok = typeof slug === 'string' && BARE_SLUG_RE.test(slug)
    && slug.split('/').every((part) => part !== '.' && part !== '..');
  if (!ok) throw new TypeError(`release-state store: slug must be a bare owner/repo, got ${JSON.stringify(slug)}`);
}

function assertName(name) {
  if (typeof name !== 'string' || !STATE_FILE_RE.test(name)) {
    throw new TypeError(`release-state store: file name must match ${STATE_FILE_RE}, got ${JSON.stringify(name)}`);
  }
}

function scratchRef() {
  return `${SCRATCH_REF_PREFIX}/${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Pure: the one content step both transports (and the MCP emit adapter) share, so two
// transports never classify the same bytes two ways. A plain JSON object is `present`;
// any other bytes are `unreadable`, carrying content, lease and via so a forced reset
// can write over them.
function classifyStateContent(content, { lease = null, via } = {}) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return {
      state: 'unreadable', failure: 'malformed-json', reason: 'the state file is not valid JSON', content, lease, via,
    };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      state: 'unreadable', failure: 'not-an-object', reason: 'the state file is JSON but not an object', content, lease, via,
    };
  }
  return {
    state: 'present', content, value, lease, via,
  };
}

// {stdout, failure, status, error?} -> unreadable. A failure-free answer with a status
// (a 409, a 422 on a read) has no classified failure, so it is named by its status.
function unreadableFrom(r) {
  const failure = r.failure || (r.status ? `http-${r.status}` : 'network-failure');
  return { state: 'unreadable', failure, reason: refusalText(r.error) || failure };
}

// -> the git leg's answer, or null when git could not answer (a transport failure: the
// caller falls back to the contents API, the documented degrade, not an error).
// Fetches into a per-call scratch ref rather than FETCH_HEAD (a single shared pointer a
// concurrent fetch can overwrite) and deletes it afterwards; the object read below
// survives the ref's deletion. A remote with no release-state branch is a normal
// pre-bootstrap state, never a failure.
function readStateGit(runner, name) {
  const ref = scratchRef();
  let tip;
  try {
    runner(['fetch', '-q', 'origin', `${RELEASE_STATE_BRANCH}:${ref}`]);
    tip = runner(['rev-parse', ref]).trim();
  } catch (err) {
    if (classifyGitError(err).kind === 'missing-branch') {
      return {
        state: 'absent', lease: null, via: 'git', branchMissing: true,
      };
    }
    return null;
  } finally {
    try { runner(['update-ref', '-d', ref]); } catch { /* best-effort cleanup, never masks the read's own outcome */ }
  }
  let content;
  try {
    content = runner(['show', `${tip}:${name}`]);
  } catch (err) {
    if (classifyGitError(err).kind === 'missing-path') {
      return {
        state: 'absent', lease: tip, via: 'git', branchMissing: false,
      };
    }
    return null;
  }
  return classifyStateContent(content, { lease: tip, via: 'git' });
}

// (ghApi, slug) -> { exists: true | false | null, result } — mirrors claim-store.js's
// readClaimsBranch. `exists` null = could not tell.
function readStateBranch(ghApi, slug) {
  const result = ghApi([`repos/${slug}/branches/${RELEASE_STATE_BRANCH}`, '-q', '.name']);
  if (result.status === 404) return { exists: false, result };
  if (result.failure || result.status) return { exists: null, result };
  return { exists: true, result };
}

// The 404 on a contents read is ambiguous (no file, no branch, or a repository the token
// cannot see), so this settles it: branch exists -> the file is absent; branch 404 ->
// ask whether the repository itself answers, and only a confirmed one reads as a
// branchless remote; anything else is unreadable.
function settleContents404(ghApi, slug) {
  const branch = readStateBranch(ghApi, slug);
  if (branch.exists === null) return unreadableFrom(branch.result);
  if (branch.exists) {
    return {
      state: 'absent', lease: null, via: 'contents-api', branchMissing: false,
    };
  }
  const repo = ghApi([`repos/${slug}`, '-q', '.full_name']);
  if (repo.status === 404) {
    return {
      state: 'unreadable', failure: 'repo-unconfirmed', reason: `repository ${slug} could not be confirmed (HTTP 404)`,
    };
  }
  if (repo.failure || repo.status) return unreadableFrom(repo);
  if (String(repo.stdout || '').trim().toLowerCase() !== slug.toLowerCase()) {
    return {
      state: 'unreadable', failure: 'repo-unconfirmed', reason: `repository ${slug} could not be confirmed (it answered ${JSON.stringify(String(repo.stdout || '').trim())})`,
    };
  }
  return {
    state: 'absent', lease: null, via: 'contents-api', branchMissing: true,
  };
}

function readStateContentsApi(ghApi, slug, name) {
  const r = ghApi([`repos/${slug}/contents/${name}?ref=${RELEASE_STATE_BRANCH}`, '-q', '{content: (.content | @base64d), sha: .sha}']);
  if (r.status === 404) return settleContents404(ghApi, slug);
  if (r.failure || r.status) return unreadableFrom(r);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed.content !== 'string' || typeof parsed.sha !== 'string' || !parsed.sha) {
    return { state: 'unreadable', failure: 'network-failure', reason: 'the contents API answer was not a {content, sha} object' };
  }
  return classifyStateContent(parsed.content, { lease: parsed.sha, via: 'contents-api' });
}

// (deps: {ghApi, gitRunner?}, slug, name)
// -> { state: 'absent', lease, via, branchMissing }
//  | { state: 'present', content, value, lease, via }
//  | { state: 'unreadable', failure, reason, content?, lease?, via? }
// Mirrors claim-store.js's readClaimBlob: git first, the contents API when git cannot
// answer. `content`, `lease` and `via` on an unreadable appear only when the bytes were
// read but are not a JSON object.
function readStateFile(deps, slug, name) {
  assertSlug(slug);
  assertName(name);
  if (deps.gitRunner) {
    const git = readStateGit(deps.gitRunner, name);
    if (git) return git;
  }
  return readStateContentsApi(deps.ghApi, slug, name);
}

// ---- branch bootstrap ----

// The one transient-vs-refusal rule for the contents-API leg (claim-store.js's
// TRANSIENT_BOOTSTRAP_FAILURES): a network failure or a secondary rate limit may clear
// on a later run; every other answer is one a retry will not change.
const TRANSIENT_BOOTSTRAP_FAILURES = new Set(['network-failure', 'secondary-rate-limit']);

function apiRefusal(r) {
  return {
    ok: false,
    reason: refusalText(r.error) || r.failure || `HTTP ${r.status}`,
    ...(TRANSIENT_BOOTSTRAP_FAILURES.has(r.failure) ? { transient: true, failure: r.failure } : {}),
  };
}

// Mirrors claims-git-cas.js's bootstrapClaimsBranchGit: creates the branch at the remote
// HEAD's tip, never an orphan commit. The push is create-only (an empty
// `--force-with-lease=ref:` expectation means the ref must not exist) so a concurrent
// bootstrapper loses cleanly; `--no-verify` because the branch carries no code and a
// consumer's pre-push suite must not run for it. A rejected create is a lost race only
// when ls-remote shows the branch now exists.
function bootstrapBranchGit(runner) {
  const ref = scratchRef();
  const target = `refs/heads/${RELEASE_STATE_BRANCH}`;
  try {
    runner(['fetch', '-q', 'origin', `HEAD:${ref}`]);
    const base = runner(['rev-parse', ref]).trim();
    runner(['push', '--no-verify', 'origin', `${base}:${target}`, `--force-with-lease=${target}:`]);
    return { ok: true, created: true };
  } catch (err) {
    if (classifyGitError(err).kind === 'contested') {
      try {
        const listed = runner(['ls-remote', '--heads', 'origin', target]);
        if (String(listed).trim()) return { ok: true, created: false };
      } catch { /* an unreadable remote leaves the original rejection as the reason */ }
    }
    return { ok: false, reason: errText(err) };
  } finally {
    try { runner(['update-ref', '-d', ref]); } catch { /* best-effort cleanup, never masks the bootstrap's own outcome */ }
  }
}

// Mirrors claim-store.js's createClaimsBranchContentsApi: `POST git/refs` at the default
// branch's tip. A 422 is ambiguous (the branch exists, or a ruleset forbids creating
// it), so only a re-read of the branch settles it.
function createBranchContentsApi(ghApi, slug) {
  const branchRead = ghApi([`repos/${slug}`, '-q', '.default_branch']);
  if (branchRead.failure || branchRead.status) return apiRefusal(branchRead);
  const defaultBranch = String(branchRead.stdout || '').trim();
  if (!defaultBranch) return { ok: false, reason: 'the repository reported no default branch' };
  const encoded = defaultBranch.split('/').map(encodeURIComponent).join('/');
  const tipRead = ghApi([`repos/${slug}/git/ref/heads/${encoded}`, '-q', '.object.sha']);
  if (tipRead.failure || tipRead.status) return apiRefusal(tipRead);
  const tipSha = String(tipRead.stdout || '').trim();
  if (!tipSha) return { ok: false, reason: `the default branch ${defaultBranch} reported no tip sha` };
  const r = ghApi([
    '--method', 'POST', `repos/${slug}/git/refs`,
    '-f', `ref=refs/heads/${RELEASE_STATE_BRANCH}`,
    '-f', `sha=${tipSha}`,
  ]);
  if (r.failure === null && r.status === null) return { ok: true, created: true };
  if (r.status === 422) {
    // Only a clean re-read proves the lost race; `exists` would count any failure-free
    // non-404 answer as "there".
    const { result } = readStateBranch(ghApi, slug);
    if (result.failure === null && result.status === null) return { ok: true, created: false };
    const postRefusal = apiRefusal(r);
    if (result.status === 404) return postRefusal;
    const reread = apiRefusal(result);
    return { ...reread, reason: `${postRefusal.reason}; branch re-read: ${reread.reason}` };
  }
  return apiRefusal(r);
}

// (deps: {ghApi, gitRunner?}, slug)
// -> { ok: true, created, via: 'git' | 'contents-api' }
//  | { ok: false, reason }
//  | { ok: false, reason, transient: true, failure: 'network-failure' | 'secondary-rate-limit' }
// Mirrors claim-store.js's ensureClaimsBranch: a git push first when a `gitRunner` is
// supplied, the contents API when git cannot. A refusal is never retried; `reason`
// carries each leg's own text.
function ensureReleaseStateBranch(deps, slug) {
  assertSlug(slug);
  const reasons = [];
  if (deps.gitRunner) {
    const g = bootstrapBranchGit(deps.gitRunner);
    if (g.ok) return { ok: true, created: g.created, via: 'git' };
    reasons.push(`git: ${g.reason}`);
  }
  const a = createBranchContentsApi(deps.ghApi, slug);
  if (a.ok) return { ok: true, created: a.created, via: 'contents-api' };
  reasons.push(`contents-api: ${a.reason}`);
  return { ok: false, reason: reasons.join('; '), ...(a.transient ? { transient: true, failure: a.failure } : {}) };
}

module.exports = {
  RELEASE_STATE_BRANCH,
  STATE_FILE_RE,
  MAX_CAS_ATTEMPTS,
  readStateFile,
  classifyStateContent,
  ensureReleaseStateBranch,
};
