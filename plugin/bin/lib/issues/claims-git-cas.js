// bin/lib/issues/claims-git-cas.js
// Git compare-and-swap core for the claims-registry blob lock (#787). Tries
// to perform claim/release reads and writes via local `git` plumbing against
// the `claims-registry` branch, using `git push --force-with-lease` as the
// atomic test-and-set — the fleet's most-contended endpoint moves off the
// contents API (rate-limited) onto a transport that costs zero API budget.
// `claim-store.js` tries this first and falls back to its own contents-API
// implementation when this module reports a transport failure or a
// secondary rate limit (see that module's `readClaimBlob`/`writeClaimBlob`).
//
// Deliberately NOT built on `bin/lib/health-core/durable-state.js`'s
// `createNamespacedState` (#1466) — that generic CAS primitive looks like a
// duplicate of this one at a glance, but the two engines have real,
// load-bearing API-shape differences that a naive merge would either lose
// or would require complicating `createNamespacedState`'s existing four
// health-skill callers and `merge-lane-breaker.js` to accommodate:
//   - This module reads/writes ONE raw string blob per issue.
//     `createNamespacedState` always JSON.parses on read and JSON.stringifies
//     on write, for a whole namespace's multi-file set.
//   - This module's failure classification is four-way (`contested` /
//     `secondary-rate-limit` / `missing-path` / `transport-failure`) — the
//     `conflict`/`secondaryRateLimit` distinction specifically is consumed by
//     `claim-store.js`'s contents-API-fallback decision. `createNamespacedState`
//     collapses every write failure to `{ok, error}` with no such signal.
//   - This module targets `CLAIMS_BRANCH` (`claims-registry`);
//     `createNamespacedState` hardcodes `HEALTH_STATE_BRANCH` (`health-state`).
//   - `createNamespacedState` owns its own CAS retry loop internally
//     (`MAX_CAS_ATTEMPTS`, backoff/jitter, a post-failure re-fetch check).
//     Retrying a rejected write here is the CALLER's job (`claim-store.js`'s
//     `writeClaimBlob`) — folding that ownership into this module would
//     change `claim-store.js`'s own disambiguation contract.
// Extending `createNamespacedState` to cover all of the above (a raw/
// non-JSON file-spec option, a parameterized branch, a failure-classification
// passthrough) is possible in principle, but was judged not worth the risk
// to its existing byte-identical-behavior guarantee for `createDurableState`
// and `merge-lane-breaker.js` — see that file's own header comment for the
// reciprocal note. If either engine's contract changes, check the other.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claimFilePath, CLAIMS_BRANCH } = require('./claims');

function errText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  return parts.length ? parts.join(' ') : String(err);
}

// One classification for every git-CAS failure this module can hit — the
// git-side counterpart to claim-store.js's classifyGhApiError. `missing-path`
// is a normal 'absent' outcome (git show against a tree that doesn't have
// this file yet), never an error; `contested` is a lost force-with-lease
// race — someone else's commit landed on `claims-registry` between our
// fetch and this push; `secondary-rate-limit` must never be folded into
// `contested` (record-697's incident read exactly that way before
// diagnosis) — checked before the generic rejection match since GitHub's
// abuse-detection rejection is also a non-fast-forward-shaped push failure.
function classifyGitError(err) {
  const text = errText(err);
  if (/secondary rate limit|abuse detection mechanism|Retry-After/i.test(text)) {
    return { kind: 'secondary-rate-limit' };
  }
  if (/does not exist in|exists on disk, but not in/.test(text)) {
    return { kind: 'missing-path' };
  }
  if (/\[rejected\]|stale info|fetch first|non-fast-forward/i.test(text)) {
    return { kind: 'contested' };
  }
  return { kind: 'transport-failure' };
}

const GIT_TIMEOUT_MS = 10000;

function defaultRunner(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, ...opts,
  });
}

// {issueNumber, remote, branch, runner, knownTip?} -> {content, tipSha, absent, failure}
// Fetches the branch fresh every call (cheap — one ref) so `tipSha` is
// always the live remote tip, never a locally-cached one that could be
// stale by the time writeClaimBlobGit uses it as the compare-and-swap lease
// — UNLESS the caller passes `knownTip` (#1467's batch-amortization seam):
// a commit sha this same process already knows is current (seeded from an
// earlier call's own fetch, or advanced by a `writeClaimBlobGit` success in
// this same batch). When present, this function skips its own fetch +
// scratch-ref dance entirely and reads straight from that commit — safe
// because a stale-but-trusted tip is never a correctness hazard here: this
// function only ever informs a claim/contest DECISION from content, and the
// actual compare-and-swap lease enforcement happens at `writeClaimBlobGit`'s
// `--force-with-lease` push, which rejects (and gets re-verified with a
// FRESH read — see claim-store.js's writeClaimBlob) the instant the real
// remote tip has moved away from whatever this call assumed. Every non-batch
// caller omits `knownTip` and gets the unconditional-fetch behavior below,
// unchanged.
//
// Fetches into a per-call scratch ref rather than reading FETCH_HEAD: that
// pseudo-ref is a single shared pointer, not scoped to this call, so a
// concurrent `git fetch` elsewhere in the same checkout (a sibling
// claim-targets.js/release-claim.js invocation, or this same process fetching
// again before this call finishes) can overwrite it between the fetch above
// and the read below — this call would then resolve someone else's fetch
// instead of its own. A unique ref name has no such collision; the object
// itself (read via `show` below) survives its own deletion, so cleanup here
// never races the read that follows.
function readClaimBlobGit({
  issueNumber, remote = 'origin', branch = CLAIMS_BRANCH, runner = defaultRunner, knownTip = null,
}) {
  let tipSha;
  if (knownTip) {
    tipSha = knownTip;
  } else {
    const scratchRef = `refs/claims-cas-read/${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      runner(['fetch', '-q', remote, `${branch}:${scratchRef}`]);
      tipSha = runner(['rev-parse', scratchRef]).trim();
    } catch {
      return { content: null, tipSha: null, absent: false, failure: 'transport-failure' };
    } finally {
      try { runner(['update-ref', '-d', scratchRef]); } catch { /* best-effort cleanup — never mask the read's own outcome */ }
    }
  }
  const targetPath = claimFilePath(issueNumber);
  try {
    const content = runner(['show', `${tipSha}:${targetPath}`]);
    return { content, tipSha, absent: false, failure: null };
  } catch (err) {
    const { kind } = classifyGitError(err);
    if (kind === 'missing-path') return { content: null, tipSha, absent: true, failure: null };
    return { content: null, tipSha, absent: false, failure: 'transport-failure' };
  }
}

// {issueNumber, content, message, expectedTipSha, remote, branch, runner} ->
// {ok, commitSha?, conflict?, secondaryRateLimit?, failure}
// Builds the new commit via the index (read-tree + update-index + write-tree
// + commit-tree) rather than manual tree-walking — git's own machinery
// handles the nested `claims/` path and leaves every other entry in the
// tree untouched. A scratch GIT_INDEX_FILE keeps this off the real working
// tree's index. The push itself is the compare-and-swap: `--force-with-lease`
// against `expectedTipSha` fails closed the instant the remote tip has
// moved since this write's own read.
//
// On success, `commitSha` is the just-pushed commit — the new branch tip —
// so a batch caller (#1467's `claim-targets.js`) can chain it straight into
// the next item's `readClaimBlobGit({ knownTip: commitSha })` without a
// fetch, instead of re-deriving it from a fresh read it doesn't otherwise
// need. Present only on a genuine git-CAS success; every other outcome
// (contents-API fallback success, conflict, transport failure) has no
// commit sha a caller could safely chain from — see claim-store.js's
// `writeClaimBlob` for how those cases propagate.
function writeClaimBlobGit({
  issueNumber, content, message, expectedTipSha, remote = 'origin', branch = CLAIMS_BRANCH, runner = defaultRunner,
}) {
  const targetPath = claimFilePath(issueNumber);
  const scratchIndex = path.join(os.tmpdir(), `claims-git-cas-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env, GIT_INDEX_FILE: scratchIndex };
  try {
    const blobSha = runner(['hash-object', '-w', '--stdin'], { input: content, env }).trim();
    runner(['read-tree', expectedTipSha], { env });
    runner(['update-index', '--add', '--cacheinfo', `100644,${blobSha},${targetPath}`], { env });
    const treeSha = runner(['write-tree'], { env }).trim();
    const commitSha = runner(['commit-tree', treeSha, '-p', expectedTipSha, '-m', message], { env }).trim();
    runner(['push', remote, `${commitSha}:refs/heads/${branch}`, `--force-with-lease=refs/heads/${branch}:${expectedTipSha}`]);
    return { ok: true, commitSha, failure: null };
  } catch (err) {
    const { kind } = classifyGitError(err);
    if (kind === 'contested') return { ok: false, conflict: true, failure: null };
    if (kind === 'secondary-rate-limit') return { ok: false, secondaryRateLimit: true, failure: null };
    return { ok: false, failure: 'transport-failure' };
  } finally {
    // Synchronous, to match the rest of this module: an async unlink's
    // callback can be dropped when a short-lived CLI caller exits first,
    // leaking one scratch index per claim attempt. `force: true` already
    // swallows ENOENT; the catch is for the EPERM/EBUSY case, so a cleanup
    // failure can never replace this function's real return value from a
    // `finally` block.
    try {
      fs.rmSync(scratchIndex, { force: true });
    } catch {
      /* best-effort cleanup — never mask the write's own outcome */
    }
  }
}

// Parse `git cat-file --batch`'s streamed output. Each requested object is
// framed as one header line (`{sha} {type} {size}\n`, or `{sha} missing\n`
// for a sha that doesn't resolve) followed — for a resolved object — by
// exactly `{size}` content bytes and a single trailing newline. Slicing by
// the declared byte length (never by splitting on '\n') is what keeps this
// correct for claim JSON pretty-printed with embedded newlines (#2613's own
// Gotcha) — a naive line-based split would truncate at the object's first
// internal newline instead of its real end.
function parseCatFileBatch(buf) {
  const entries = [];
  let offset = 0;
  while (offset < buf.length) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl === -1) break;
    const header = buf.slice(offset, nl).toString('utf8');
    offset = nl + 1;
    const parts = header.split(' ');
    if (parts.length === 2 && parts[1] === 'missing') {
      entries.push({ sha: parts[0], missing: true });
      continue;
    }
    const [sha, , sizeStr] = parts;
    const size = parseInt(sizeStr, 10);
    const content = buf.slice(offset, offset + size);
    offset += size + 1; // +1 skips the single trailing newline git appends after content
    entries.push({ sha, missing: false, content });
  }
  return entries;
}

// {issueNumbers?, tip, runner} -> {tipSha, results: {[issueNumber]: {content,
// tipSha, absent, failure}}, failure}
// Batched counterpart to readClaimBlobGit (#2613) — replaces N per-blob `git
// show` subprocess calls with exactly 2 total, regardless of registry size:
// one `git ls-tree -r {tip} -- claims/` (which doubles as the full-keyspace
// listing itself — `issue-claims-backstops.md`'s "Primary: list the claims/
// blob keyspace" step) and one `git cat-file --batch` fed every target
// blob's sha over stdin. `tip` is a caller-resolved commit sha (the same
// `knownTip` shape #1467 established for readClaimBlobGit) — this function
// never fetches on its own, so its own call count stays fixed at 2 whether
// the caller already had a tip from a prior read/write in the same batch, or
// resolved one via a single upstream fetch+rev-parse.
// `issueNumbers` is optional: omit it to read the FULL keyspace discovered
// by the ls-tree call (every `claims/issue-{n}.json` entry present at `tip`)
// — the common audit-scan case, where there is no candidate list yet to pass
// in. Pass an explicit list to read only those issues; a number absent from
// the tree resolves to `{absent: true}`, exactly as a missing path does for
// readClaimBlobGit.
function readClaimBlobsGitBatch({ issueNumbers = null, tip, runner = defaultRunner }) {
  let lsTreeOut;
  try {
    lsTreeOut = runner(['ls-tree', '-r', tip, '--', 'claims/']);
  } catch {
    return { tipSha: tip, results: null, failure: 'transport-failure' };
  }
  const lsTreeText = Buffer.isBuffer(lsTreeOut) ? lsTreeOut.toString('utf8') : lsTreeOut;

  // path -> sha, and issueNumber -> path, for every claims/issue-{n}.json
  // entry the tree actually has.
  const pathToSha = new Map();
  const issueToPath = new Map();
  for (const line of lsTreeText.split('\n')) {
    if (!line) continue;
    const tabIdx = line.indexOf('\t');
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).trim().split(/\s+/);
    const sha = meta[2];
    const filePath = line.slice(tabIdx + 1);
    pathToSha.set(filePath, sha);
    const m = /^claims\/issue-(\d+)\.json$/.exec(filePath);
    if (m) issueToPath.set(Number(m[1]), filePath);
  }

  const targetNumbers = issueNumbers === null ? [...issueToPath.keys()] : issueNumbers;

  const results = {};
  const shaToIssues = new Map();
  const orderedShas = [];
  for (const issueNumber of targetNumbers) {
    const targetPath = claimFilePath(issueNumber);
    const sha = pathToSha.get(targetPath);
    if (!sha) {
      results[issueNumber] = {
        content: null, tipSha: tip, absent: true, failure: null,
      };
      continue;
    }
    if (!shaToIssues.has(sha)) {
      shaToIssues.set(sha, []);
      orderedShas.push(sha);
    }
    shaToIssues.get(sha).push(issueNumber);
  }

  if (orderedShas.length === 0) {
    return { tipSha: tip, results, failure: null };
  }

  const markTransportFailure = () => {
    for (const sha of orderedShas) {
      for (const issueNumber of shaToIssues.get(sha)) {
        results[issueNumber] = {
          content: null, tipSha: tip, absent: false, failure: 'transport-failure',
        };
      }
    }
  };

  let batchRaw;
  try {
    batchRaw = runner(['cat-file', '--batch'], { input: `${orderedShas.join('\n')}\n`, encoding: 'buffer' });
  } catch {
    markTransportFailure();
    return { tipSha: tip, results, failure: null };
  }

  const buf = Buffer.isBuffer(batchRaw) ? batchRaw : Buffer.from(batchRaw, 'utf8');
  for (const entry of parseCatFileBatch(buf)) {
    const issues = shaToIssues.get(entry.sha) || [];
    for (const issueNumber of issues) {
      results[issueNumber] = entry.missing
        ? {
          content: null, tipSha: tip, absent: false, failure: 'transport-failure',
        }
        : {
          content: entry.content.toString('utf8'), tipSha: tip, absent: false, failure: null,
        };
    }
  }
  // Defensive: any target sha `cat-file --batch` didn't echo back at all
  // (shouldn't happen against a real git object store) still resolves to a
  // classifiable outcome rather than silently vanishing from `results`.
  for (const sha of orderedShas) {
    for (const issueNumber of shaToIssues.get(sha)) {
      if (!(issueNumber in results)) {
        results[issueNumber] = {
          content: null, tipSha: tip, absent: false, failure: 'transport-failure',
        };
      }
    }
  }

  return { tipSha: tip, results, failure: null };
}

module.exports = {
  classifyGitError,
  CLAIMS_BRANCH,
  errText,
  readClaimBlobGit,
  writeClaimBlobGit,
  readClaimBlobsGitBatch,
  defaultRunner,
};
