// bin/lib/release-state/store.js
// The branch store behind /release's "reviewed through" marker (#5883): one small
// JSON file per name on the `release-state` branch, read over a git leg first
// (fetch the branch tip into a scratch ref, `git show` the file at it) and over
// the contents API when git cannot answer. The same file owns the branch bootstrap and
// the compare-and-set writes (`writeStateFile`, `createStateFile`).
//
// The module spawns nothing itself. Both runners are injected:
//   `deps.ghApi(args)`            -> `{stdout, failure, status, error?}`, never throws
//                                    (claim-store.js's contract); the caller has already
//                                    appended any `--hostname`.
//   `deps.gitRunner(args, {input, extraEnv} = {})` -> stdout string, throws on failure,
//                                    the thrown error carrying the child's exit code as
//                                    `.status` (execFileSync's shape; marker.js's
//                                    isAncestor relies on it to tell exit 1, "not an
//                                    ancestor", from a failed check); the runner owns
//                                    its cwd and its repo-pinned env and
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
// Mirrors claim-store.js's readClaimBlob / readClaimBlobContentsApi (parameterized on a
// file name) and claims-git-cas.js's readClaimBlobGit; if either changes, check the other.
// The branch bootstrap is not a mirror: both its legs are the claims bootstrap's own,
// claims-git-cas.js's `bootstrapClaimsBranchGit` and claim-store.js's
// `createBranchContentsApi`, each called with this branch.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  refusalText, createBranchContentsApi, casBackoffMs, defaultSleep, isWellFormedClaimContent,
} = require('../issues/claim-store');
const { classifyGitError, errText, bootstrapClaimsBranchGit } = require('../issues/claims-git-cas');

const RELEASE_STATE_BRANCH = 'release-state';
const STATE_FILE_RE = /^[a-z0-9][a-z0-9-]*\.json$/;
// How many times a write re-leases and re-pushes after a rejection a fresh read proves
// spurious (claim-store.js's constant of the same name).
const MAX_CAS_ATTEMPTS = 3;

const BARE_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SCRATCH_REF_PREFIX = 'refs/release-state-cas';

// Non-throwing form of assertSlug's rule, for a caller that wants a usage failure, not a TypeError.
function isBareSlug(slug) {
  return typeof slug === 'string' && BARE_SLUG_RE.test(slug)
    && slug.split('/').every((part) => part !== '.' && part !== '..');
}

function assertSlug(slug) {
  if (!isBareSlug(slug)) throw new TypeError(`release-state store: slug must be a bare owner/repo, got ${JSON.stringify(slug)}`);
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

// {stdout, failure, status, error?} -> { failure, reason }. A failure-free answer with a status
// (a 409, a 422) has no classified failure, so it is named by its status.
function failureFrom(r) {
  const failure = r.failure || (r.status ? `http-${r.status}` : 'network-failure');
  return { failure, reason: refusalText(r.error) || failure };
}

function unreadableFrom(r) {
  return { state: 'unreadable', ...failureFrom(r) };
}

// -> the git leg's answer, or null when git could not answer (a transport failure: the
// caller falls back to the contents API, the documented degrade, not an error).
// Fetches into a per-call scratch ref with `--no-write-fetch-head`, never touching FETCH_HEAD
// (a single shared pointer a concurrent fetch can overwrite), and with `--no-tags`, since a
// fetch that stores into a ref auto-follows tags into the user's clone; it deletes the ref
// afterwards, and the object read below survives the ref's deletion. A remote with no
// release-state branch is a normal pre-bootstrap state, never a failure.
function readStateGit(runner, name) {
  const ref = scratchRef();
  let tip;
  try {
    // Fully qualified: a bare `release-state` could resolve to a same-named tag.
    runner(['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', `refs/heads/${RELEASE_STATE_BRANCH}:${ref}`]);
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

// (ghApi, slug) -> { exists: true | false | null, result }. `exists` null = could not tell.
// Deliberately stricter than claim-store.js's readClaimsBranch: that one counts any
// failure-free, non-404 answer as "there", while this one also reads a failure-free answer
// that carries a status (a 409, a 422) as could-not-tell, because here "there" licenses
// reading a missing file as absent.
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
    return { state: 'unreadable', failure: 'malformed-answer', reason: 'the contents API answer was not a {content, sha} object' };
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

// Both legs are shared with the claims bootstrap. The contents-API leg is claim-store.js's
// `createBranchContentsApi` (the transient-vs-refusal rule lives there); the git leg is
// claims-git-cas.js's bootstrapClaimsBranchGit, which creates the branch at the remote
// HEAD's tip, never an orphan commit, with a create-only push (an empty
// `--force-with-lease=ref:` expectation means the ref must not exist) so a concurrent
// bootstrapper loses cleanly; a rejected create is a lost race only when ls-remote shows the
// branch now exists. This store's options: the fetch passes `--no-tags` and
// `--no-write-fetch-head` (readStateGit's reasons), the push `--no-verify` (the branch
// carries no code and a consumer's pre-push suite must not run for it), and the scratch ref
// sits under this store's prefix. -> { ok: true, created } | { ok: false, reason }.
function bootstrapBranchGit(runner) {
  const g = bootstrapClaimsBranchGit({
    remote: 'origin',
    branch: RELEASE_STATE_BRANCH,
    runner,
    fetchFlags: ['--no-tags', '--no-write-fetch-head'],
    pushFlags: ['--no-verify'],
    scratchRefPrefix: SCRATCH_REF_PREFIX,
  });
  return g.ok ? { ok: true, created: g.created } : { ok: false, reason: g.reason };
}

// (deps: {ghApi, gitRunner?}, slug)
// -> { ok: true, created, via: 'git' | 'contents-api' }
//  | { ok: false, reason }
//  | { ok: false, reason, transient: true, failure: 'network-failure' | 'secondary-rate-limit' }
// Same shape as claim-store.js's ensureClaimsBranch (a git push first when a `gitRunner`
// is supplied, the contents API when git cannot), over the shared contents-API helper.
// A refusal is never retried; `reason` carries each leg's own text.
function ensureReleaseStateBranch(deps, slug) {
  assertSlug(slug);
  const reasons = [];
  if (deps.gitRunner) {
    const g = bootstrapBranchGit(deps.gitRunner);
    if (g.ok) return { ok: true, created: g.created, via: 'git' };
    reasons.push(`git: ${g.reason}`);
  }
  const a = createBranchContentsApi(deps.ghApi, slug, RELEASE_STATE_BRANCH);
  if (a.ok) return { ok: true, created: a.created, via: 'contents-api' };
  reasons.push(`contents-api: ${a.reason}`);
  return { ok: false, reason: reasons.join('; '), ...(a.transient ? { transient: true, failure: a.failure } : {}) };
}

// ---- compare-and-set writes ----

// One line, at most 200 chars, no `#`: the generated track-issue-fixes job's prefilter
// fires on a `#` together with a closing keyword, so a message like `fix #12` would label
// issue #12. Refused here, before any call, never sanitized.
const MESSAGE_RE = /^[^\r\n#]{1,200}$/;
const GIT_LEASE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

// The write rules live here and nowhere else: `writeStateFile`, `createStateFile` and the CLI's
// emit adapter (which captures a write rather than making it) all call these two.

// The argument checks of a conditional write: a caller bug throws TypeError before any call.
// `vias` lists the transports the caller's reads can return (the emit adapter's: the contents API).
function assertConditionalWrite({ lease, via, expectedContent } = {}, vias = ['git', 'contents-api']) {
  if (!vias.includes(via)) {
    throw new TypeError(`release-state store: via must be ${vias.map((v) => `'${v}'`).join(' or ')}, got ${JSON.stringify(via)}`);
  }
  if (typeof lease !== 'string' || lease === '') throw new TypeError('release-state store: a conditional write needs the lease its read returned');
  // A git lease goes to `read-tree` and `commit-tree -p` as a bare argument: an argv array
  // stops shell injection, not a leading `-` read as an option.
  if (via === 'git' && !GIT_LEASE_RE.test(lease)) {
    throw new TypeError(`release-state store: a git lease must be a commit sha, got ${JSON.stringify(lease)}`);
  }
  if (typeof expectedContent !== 'string') {
    throw new TypeError('release-state store: a conditional write needs the content its read returned as expectedContent');
  }
}

// -> the refusal result, or null when both are acceptable. A caller bug surfaces as its
// own failure, never as a contest or a transport problem.
function refuseInvalid(content, message) {
  if (!isWellFormedClaimContent(content)) {
    return { ok: false, failure: 'invalid-content', reason: 'the state content is not a non-empty JSON object' };
  }
  if (typeof message !== 'string' || !MESSAGE_RE.test(message)) {
    return { ok: false, failure: 'invalid-message', reason: 'the commit message must be one line of at most 200 characters with no "#"' };
  }
  return null;
}

// Builds a commit that sets `{name}` to `content` on top of `tip` and pushes it with
// `tip` as the lease. -> { ok: true, commitSha } | { ok: false, contested: true }
// | { ok: false, reason }. A scratch index keeps the build off the working tree's index.
// Mirrors claims-git-cas.js's writeClaimBlobGit; if either changes, check the other.
// Deliberate differences: the path is the file name, the push passes `--no-verify` (the
// branch carries no code, so a consumer's pre-push suite must not run for it), a
// rate-limit rejection is not told apart from any other non-contest failure (both fall
// back to the contents API), and the index layers onto the runner's own repo-pinned env
// through `extraEnv` rather than onto `process.env`.
function writeStateGit(runner, name, content, message, tip) {
  const scratchIndex = path.join(os.tmpdir(), `release-state-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const extraEnv = { GIT_INDEX_FILE: scratchIndex };
  const target = `refs/heads/${RELEASE_STATE_BRANCH}`;
  try {
    const blob = runner(['hash-object', '-w', '--stdin'], { input: content, extraEnv }).trim();
    runner(['read-tree', tip], { extraEnv });
    runner(['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], { extraEnv });
    const tree = runner(['write-tree'], { extraEnv }).trim();
    const commit = runner(['commit-tree', tree, '-p', tip, '-m', message], { extraEnv }).trim();
    runner(['push', '--no-verify', 'origin', `${commit}:${target}`, `--force-with-lease=${target}:${tip}`]);
    return { ok: true, commitSha: commit };
  } catch (err) {
    if (classifyGitError(err).kind === 'contested') return { ok: false, contested: true };
    return { ok: false, reason: errText(err) };
  } finally {
    try {
      fs.rmSync(scratchIndex, { force: true });
    } catch { /* best-effort cleanup, never masks the write's own outcome */ }
  }
}

function putContents(ghApi, slug, name, content, message, lease) {
  const args = [
    '--method', 'PUT', `repos/${slug}/contents/${name}`,
    '-f', `message=${message}`,
    '-f', `content=${Buffer.from(content, 'utf8').toString('base64')}`,
    '-f', `branch=${RELEASE_STATE_BRANCH}`,
  ];
  if (lease) args.push('-f', `sha=${lease}`);
  return ghApi(args);
}

// A PUT that came back with no rejection status: the failure it carried.
function putFailure(r) {
  return { ok: false, ...failureFrom(r) };
}

const REJECTED_PUT_STATUSES = new Set([404, 409, 422]);

// A PUT answered 404, 409 or 422: could be a lost race, our own earlier write whose ack was
// lost, a missing branch, or a refusal. Only a contents re-read tells them apart. `create`
// is the no-prior-read write: a different content is `exists`, not a contest.
// Mirrors the 4xx settle block of claim-store.js's writeClaimBlob; if either changes, check
// the other. Deliberate differences: a re-read that cannot answer is that failure, never a
// manufactured contest (claims keeps `conflict` for every failure but permission-denied);
// and, for a conditional write (`expectedContent` given), a re-read that still shows the
// content the decision was based on is `{retry:true, lease}`, not a contest: blob shas are
// content-addressed, so an unchanged file means the rejection was a transient ref-update
// race, and the caller re-PUTs with the fresh blob sha (claims reports `conflict` there).
function settleRejectedPut(ghApi, slug, name, content, put, { create, expectedContent }) {
  const fresh = readStateContentsApi(ghApi, slug, name);
  if (fresh.state === 'unreadable' && typeof fresh.content !== 'string') {
    return { ok: false, failure: fresh.failure, reason: fresh.reason };
  }
  if (fresh.state === 'absent') {
    if (fresh.branchMissing) return { ok: false, branchMissing: true };
    if (create) return { ok: false, failure: 'put-rejected', reason: refusalText(put.error) || `HTTP ${put.status}` };
    return { ok: false, conflict: true };
  }
  if (fresh.content === content) return create ? { ok: true, created: true, via: 'contents-api' } : { ok: true, via: 'contents-api' };
  if (create) return { ok: false, exists: true };
  if (fresh.content === expectedContent) return { retry: true, lease: fresh.lease };
  return { ok: false, conflict: true };
}

// The contents-API write with the lease it was given. A secondary rate limit and every
// other non-rejection failure is that failure; a rejection is settled by a re-read, and an
// unchanged file re-PUTs with the fresh blob sha, up to MAX_CAS_ATTEMPTS PUTs with a
// backoff, before it is reported as a conflict.
function writeContents(deps, slug, name, {
  content, message, lease, expectedContent,
}) {
  let putLease = lease;
  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
    const r = putContents(deps.ghApi, slug, name, content, message, putLease);
    if (!(r.status && REJECTED_PUT_STATUSES.has(r.status))) {
      return r.failure || r.status ? putFailure(r) : { ok: true, via: 'contents-api' };
    }
    const settled = settleRejectedPut(deps.ghApi, slug, name, content, r, { create: false, expectedContent });
    if (!settled.retry) return settled;
    if (attempt < MAX_CAS_ATTEMPTS) {
      putLease = settled.lease;
      (deps.sleep || defaultSleep)(casBackoffMs(attempt));
    }
  }
  return { ok: false, conflict: true };
}

// (deps: {ghApi, gitRunner?, sleep?}, slug, name, { content, lease, via, expectedContent, message })
// -> { ok: true, via, commitSha? } | { ok: false, conflict: true } | { ok: false, branchMissing: true }
//  | { ok: false, failure, reason }
// The conditional update of a file a read saw present: `lease`/`via` are that read's, and
// `expectedContent` is its `content`. Mirrors claim-store.js's writeClaimBlob (the C1 and I1
// rules of its header comment); if either changes, check the other.
//
//   * `via: 'git'` (lease = the branch tip): the git leg first. The push is leased on the
//     whole branch, so a rejection is ambiguous. A fresh git read settles it: this file
//     changed (or went) = `conflict`, never retried; unchanged = unrelated branch activity,
//     re-lease on the fresh tip and push again, up to MAX_CAS_ATTEMPTS with a backoff. A
//     non-contest git failure (and the last spurious contest) falls to the contents API,
//     with a FRESH contents read: a lease never crosses transports, so the tip is never a
//     blob sha, and the write is never made blind (C1). Fresh content equal to ours is the
//     self-write (an earlier push landed, its ack was lost); different from
//     `expectedContent` is `conflict`, with no PUT.
//   * `via: 'contents-api'` (lease = a blob sha): a PUT carrying that lease, nothing else.
//   * With no `gitRunner` a git lease has no leg to run on, and takes the fresh-read path.
//
// Deliberate differences from writeClaimBlob: the file is the caller's, not a per-issue path;
// the message is validated (see MESSAGE_RE); the lease and `expectedContent` are required (a
// missing one is a TypeError, never a contest); `branchMissing` and `reason` are named in the
// result.
function writeStateFile(deps, slug, name, {
  content, lease, via, expectedContent, message,
} = {}) {
  assertSlug(slug);
  assertName(name);
  assertConditionalWrite({ lease, via, expectedContent });
  const refused = refuseInvalid(content, message);
  if (refused) return refused;

  let putLease = lease;
  if (via === 'git') {
    if (deps.gitRunner) {
      let tip = lease;
      for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
        const g = writeStateGit(deps.gitRunner, name, content, message, tip);
        if (g.ok) return { ok: true, via: 'git', commitSha: g.commitSha };
        if (!g.contested) break; // a non-contest failure: the contents-API fallback below
        const fresh = readStateGit(deps.gitRunner, name);
        if (!fresh) return { ok: false, failure: 'transport-failure', reason: 'the push was rejected and git could not re-read the branch' };
        if (fresh.state === 'absent' && fresh.branchMissing) return { ok: false, branchMissing: true };
        if (fresh.state === 'absent' || fresh.content !== expectedContent) return { ok: false, conflict: true };
        if (attempt === MAX_CAS_ATTEMPTS) break; // spurious every time: land it over the contents API instead
        tip = fresh.lease;
        (deps.sleep || defaultSleep)(casBackoffMs(attempt));
      }
    }
    const fresh = readStateContentsApi(deps.ghApi, slug, name);
    if (fresh.state === 'unreadable' && typeof fresh.content !== 'string') return { ok: false, failure: fresh.failure, reason: fresh.reason };
    if (fresh.state === 'absent') return fresh.branchMissing ? { ok: false, branchMissing: true } : { ok: false, conflict: true };
    if (fresh.content === content) return { ok: true, via: 'contents-api' };
    if (fresh.content !== expectedContent) return { ok: false, conflict: true };
    putLease = fresh.lease;
  }
  return writeContents(deps, slug, name, {
    content, message, lease: putLease, expectedContent,
  });
}

// (deps: {ghApi, gitRunner?, sleep?}, slug, name, { content, message })
// -> { ok: true, created: true, via } | { ok: false, exists: true } | { ok: false, failure, reason }
// Create-if-not-exists with no prior read of the file. Each leg confirms the branch before
// its first write and creates a missing one (`ensureReleaseStateBranch`) first, so no write
// ever names a branch that is not there and "never write state to main" holds by
// construction, not by the forge refusing a PUT to a missing branch. The git leg reads the
// tip before building anything; the contents leg reads the branch before its first PUT, and
// a branch read that cannot answer is that failure, with no PUT. One creation per leg; a
// branch still missing after it is `branch-uncreatable`. The git leg refuses to build a
// commit when the file is already there (`exists`); its push is leased on that tip, and a
// contest is settled by the same fresh read (a creator who got there first is `exists`,
// unrelated activity retries on the new tip). A non-contest git failure falls to the
// contents API, whose PUT carries no `sha`, so the forge refuses to overwrite: a 404, 409 or
// 422 is settled by a re-read (ours = ok, other content = `exists`, a branch that went
// missing after the check = create it, unless this leg already did, and PUT once more,
// anything else absent = `put-rejected`).
// Mirrors writeClaimBlob's `createOnly` mode; if either changes, check the other.
function createStateFile(deps, slug, name, { content, message } = {}) {
  assertSlug(slug);
  assertName(name);
  const refused = refuseInvalid(content, message);
  if (refused) return refused;

  const ensureBranch = () => {
    const e = ensureReleaseStateBranch(deps, slug);
    return e.ok ? null : { ok: false, failure: e.failure || 'branch-uncreatable', reason: e.reason };
  };

  if (deps.gitRunner) {
    let ensured = false;
    let attempt = 0;
    while (attempt < MAX_CAS_ATTEMPTS) {
      const cur = readStateGit(deps.gitRunner, name);
      if (!cur) break; // git could not answer: the contents API below
      if (cur.state !== 'absent') return { ok: false, exists: true }; // present, or bytes that are not an object: either way not creatable
      if (cur.branchMissing) {
        if (ensured) break; // created, yet still missing: let the contents API judge
        ensured = true;
        const failed = ensureBranch();
        if (failed) return failed;
        continue;
      }
      attempt += 1;
      const g = writeStateGit(deps.gitRunner, name, content, message, cur.lease);
      if (g.ok) return { ok: true, created: true, via: 'git' };
      if (!g.contested) break;
      if (attempt < MAX_CAS_ATTEMPTS) (deps.sleep || defaultSleep)(casBackoffMs(attempt));
    }
  }

  const branch = readStateBranch(deps.ghApi, slug);
  if (branch.exists === null) {
    return { ok: false, ...failureFrom(branch.result) };
  }
  let branchEnsured = false;
  if (!branch.exists) {
    branchEnsured = true;
    const failed = ensureBranch();
    if (failed) return failed;
  }
  for (;;) {
    const r = putContents(deps.ghApi, slug, name, content, message, null);
    if (!(r.status && REJECTED_PUT_STATUSES.has(r.status))) {
      return r.failure || r.status ? putFailure(r) : { ok: true, created: true, via: 'contents-api' };
    }
    const settled = settleRejectedPut(deps.ghApi, slug, name, content, r, { create: true });
    if (!settled.branchMissing) return settled;
    if (branchEnsured) {
      return { ok: false, failure: 'branch-uncreatable', reason: 'the branch was created but the write still found it missing' };
    }
    branchEnsured = true;
    const failed = ensureBranch();
    if (failed) return failed;
  }
}

module.exports = {
  RELEASE_STATE_BRANCH,
  STATE_FILE_RE,
  MAX_CAS_ATTEMPTS,
  MESSAGE_RE,
  isBareSlug,
  readStateFile,
  classifyStateContent,
  assertConditionalWrite,
  refuseInvalid,
  ensureReleaseStateBranch,
  writeStateFile,
  createStateFile,
};
