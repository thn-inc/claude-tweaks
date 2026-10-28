// bin/lib/reconcile/pr-state-batch.js — one aliased GraphQL read for many PR
// states (#4032). pr-state-cache.js's prefetch used to spawn one `gh pr view`
// per stamped number and one `gh pr list --head` per branch; each `gh` process
// costs ~1 s under concurrency, so a pass over a repo with dozens of run dirs
// spent seconds there. A 50-alias query answers the same questions in one
// round trip at GraphQL rate-limit cost 1 (live read-only probe, 2026-10-24:
// 4 numbers + 4 heads in 789 ms).
//
// The batch is an accelerator, never an authority: every answer is reshaped to
// exactly what the per-item `gh` call would have returned, and anything not
// PROVEN complete — a NOT_FOUND alias, a truncated page, a malformed node, any
// other error — is simply left out of the result so the caller resolves that
// key per item. That keeps the per-item path the sole owner of `pr-not-found`
// classification and of every failure string. Distinct from pr-state.js's
// `resolvePrStatesBulk`, a ref()-based branch screen for preferOpen callers.
'use strict';
const { execFileAsyncTimed } = require('./timing');
const { pickGoverningPr } = require('./pr-state');
const { runGit } = require('../hooks/git-exec');
const { parseRepo } = require('../repo-resolve');
const { runWithConcurrency } = require('./gh-pool');

const BATCH_CHUNK = 50; // aliases per query (numbers + heads) — one rate-limit point
const BATCH_CONCURRENCY = 4;
const BATCH_TIMEOUT_MS = 15000; // one call covers up to 50 lookups — roomier than pr-state.js's per-item 5s, same as its BULK_TIMEOUT_MS
const BATCH_MAX_BUFFER = 8 * 1024 * 1024;

// Selection verbatim from the live probe.
const PR_FIELDS = 'number state isDraft mergedAt updatedAt mergeCommit{ oid } closingIssuesReferences(first:20){ nodes{ number repository{ name owner{ login } } } pageInfo{ hasNextPage } }';

const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;
const toNumber = (n) => ((typeof n === 'number' || typeof n === 'string') && POSITIVE_INTEGER_RE.test(String(n)) ? Number(n) : null);

// Pure. `numbers` become `n{i}` pullRequest aliases, `heads` become `h{i}`
// pullRequests(headRefName) aliases, indexed by position — parseBatchResponse
// must be given the same arrays. A number that is not a positive integer is
// never spliced in (its alias is simply omitted, so the parser sees it absent);
// head names are JSON-escaped; owner/name are typed `String!` variables.
function buildBatchQuery({ numbers = [], heads = [] } = {}) {
  const fields = [];
  numbers.forEach((n, i) => {
    const num = toNumber(n);
    if (num !== null) fields.push(`n${i}: pullRequest(number:${num}){ ${PR_FIELDS} mergeable mergeStateStatus }`);
  });
  heads.forEach((h, i) => {
    fields.push(`h${i}: pullRequests(headRefName:${JSON.stringify(String(h))}, first:10, states:[OPEN,CLOSED,MERGED], orderBy:{field:CREATED_AT,direction:DESC}){ nodes{ ${PR_FIELDS} } pageInfo{ hasNextPage } }`);
  });
  return `query($owner:String!,$name:String!){\n  repository(owner:$owner,name:$name){\n    ${fields.join('\n    ')}\n  }\n}`;
}

// A PR node -> `gh pr view` / `gh pr list --json` shape, or null when the node
// is not provably complete (closing references truncated or malformed).
function reshapeNode(node, withMergeFields) {
  if (!node || typeof node !== 'object') return null;
  const refs = node.closingIssuesReferences;
  if (!refs || !Array.isArray(refs.nodes) || !refs.pageInfo || refs.pageInfo.hasNextPage !== false) return null;
  if (refs.nodes.some((r) => !r || typeof r !== 'object')) return null;
  const pr = {
    number: node.number,
    state: node.state,
    isDraft: node.isDraft === true,
    mergedAt: node.mergedAt,
    updatedAt: node.updatedAt,
    mergeCommit: node.mergeCommit || null,
    closingIssuesReferences: refs.nodes,
  };
  if (withMergeFields) {
    pr.mergeable = node.mergeable;
    pr.mergeStateStatus = node.mergeStateStatus;
  }
  return pr;
}

// Pure. -> { byNumber: Map<number, pr>, byHead: Map<string, pr|null> }. A key
// is present only when its answer is proven complete; every other key is absent
// and the caller resolves it per item. Any error that is not a NOT_FOUND on one
// of this query's own aliases poisons the whole response (both maps empty).
function parseBatchResponse(stdout, { numbers = [], heads = [] } = {}) {
  const byNumber = new Map();
  const byHead = new Map();
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { byNumber, byHead };
  }
  const repo = parsed && parsed.data && parsed.data.repository;
  if (!repo || typeof repo !== 'object') return { byNumber, byHead };

  const aliases = new Set([...numbers.map((_, i) => `n${i}`), ...heads.map((_, i) => `h${i}`)]);
  const notFound = new Set();
  if (parsed.errors !== undefined) {
    if (!Array.isArray(parsed.errors)) return { byNumber, byHead };
    for (const e of parsed.errors) {
      const ownAlias = e && e.type === 'NOT_FOUND' && Array.isArray(e.path) && e.path.length === 2
        && e.path[0] === 'repository' && aliases.has(e.path[1]);
      if (!ownAlias) return { byNumber, byHead };
      notFound.add(e.path[1]);
    }
  }

  numbers.forEach((n, i) => {
    const alias = `n${i}`;
    const num = toNumber(n);
    const node = repo[alias];
    if (num === null || notFound.has(alias) || !node || node.number !== num) return;
    const pr = reshapeNode(node, true);
    if (pr) byNumber.set(num, pr);
  });

  heads.forEach((head, i) => {
    const alias = `h${i}`;
    const conn = repo[alias];
    if (notFound.has(alias) || !conn || !Array.isArray(conn.nodes)) return;
    if (!conn.pageInfo || conn.pageInfo.hasNextPage !== false) return;
    if (conn.nodes.length === 0) {
      byHead.set(head, null);
      return;
    }
    // A null node means the connection is not trustworthy: fail the head closed.
    if (conn.nodes.some((node) => !node || typeof node !== 'object')) return;
    // Only the governing PR's completeness matters: the tie-break reads state
    // and updatedAt, never the closing references.
    const pr = reshapeNode(pickGoverningPr(conn.nodes), false);
    if (pr) byHead.set(head, pr);
  });

  return { byNumber, byHead };
}

function defaultRunner(root) {
  return async (args) => {
    const { stdout } = await execFileAsyncTimed('gh', args, {
      cwd: root, encoding: 'utf8', timeout: BATCH_TIMEOUT_MS, maxBuffer: BATCH_MAX_BUFFER, windowsHide: true,
    });
    return stdout;
  };
}

// The only host the batch talks to. `gh api graphql` is pinned to it with
// --hostname, so a GH_HOST (or a different default login) cannot send the query
// to a same-named repo elsewhere, whose answer would then be memoized and
// persisted.
const GITHUB_HOST = 'github.com';

// origin -> { owner, repo } only when it is provably on GITHUB_HOST. On any
// other (or unparseable) origin host the batch is skipped and such roots take
// the per-item path, which follows origin's own host.
function githubOrigin(root) {
  try {
    const remote = runGit(['remote', 'get-url', 'origin'], root);
    if (remote.failure || !remote.stdout) return null;
    const parsed = parseRepo(remote.stdout);
    return parsed && parsed.host.toLowerCase() === GITHUB_HOST ? parsed : null;
  } catch {
    return null;
  }
}

// -> { byNumber, byHead } over every key the batch could prove. NEVER throws:
// `gh api graphql` exits 1 when `errors` is present yet still writes the body,
// so a rejection's `stdout` is parsed like a success (parseBatchResponse
// discards it when the errors are not the per-alias NOT_FOUND kind); a chunk
// that cannot be read at all contributes nothing, and its keys fall to the
// per-item path. An origin that is not on github.com (or cannot be resolved)
// -> nothing is spawned.
async function fetchBatch(root, { numbers = [], heads = [] } = {}, { runner } = {}) {
  const byNumber = new Map();
  const byHead = new Map();
  const keys = [
    ...numbers.map((n) => ({ kind: 'number', value: n })),
    ...heads.map((h) => ({ kind: 'head', value: h })),
  ];
  if (keys.length === 0) return { byNumber, byHead };
  const origin = githubOrigin(root);
  if (!origin) return { byNumber, byHead };
  const { owner, repo: name } = origin;
  const run = runner || defaultRunner(root);

  const chunks = [];
  for (let at = 0; at < keys.length; at += BATCH_CHUNK) {
    const slice = keys.slice(at, at + BATCH_CHUNK);
    chunks.push({
      numbers: slice.filter((k) => k.kind === 'number').map((k) => k.value),
      heads: slice.filter((k) => k.kind === 'head').map((k) => k.value),
    });
  }

  await runWithConcurrency(chunks, async (chunk) => {
    let stdout;
    try {
      // -f, never -F: String! variables must not be type-coerced (#610's shipped bug shape)
      stdout = await run(['api', 'graphql', '--hostname', GITHUB_HOST, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${buildBatchQuery(chunk)}`]);
    } catch (e) {
      stdout = e && typeof e.stdout === 'string' ? e.stdout : '';
    }
    const part = parseBatchResponse(stdout, chunk);
    for (const [k, v] of part.byNumber) byNumber.set(k, v);
    for (const [k, v] of part.byHead) byHead.set(k, v);
  }, BATCH_CONCURRENCY);

  return { byNumber, byHead };
}

module.exports = { buildBatchQuery, parseBatchResponse, fetchBatch, BATCH_CHUNK };
