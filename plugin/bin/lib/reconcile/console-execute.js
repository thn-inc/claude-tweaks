// bin/lib/reconcile/console-execute.js — convergence check 5: detect
// answered-but-unexecuted console comments (`_shared/console-on-pr.md`'s
// "Resolve console" box ticked). Detection only, in Node — several item
// kinds are judgment-bearing (memory drafting, upstream-filing scrubs), and
// only an agent session can execute them; this module finds the work, an
// agent session does it (`_shared/console-execution.md`). Deliberately
// gh-CLI-only, same constraint every other reconcile check states: a Node
// subprocess cannot reach an agent session's MCP tools, so a gh-absent
// environment reports that reason rather than attempting an MCP fallback.
// #1294: also passes console.json's persisted `mergeCheckVerdict` straight
// through on a `ready` result — the executing agent session's own
// `consoleAutoResolve` wiring (`_shared/console-execution.md`) reads it from
// there rather than re-deriving it, since a foreign session has no other way
// to learn a `needs-human` verdict computed by an earlier session's
// `assess-agent-autonomy merge-check` call.
// #1802: also mechanizes the "ungranted group member" exception — a live
// re-fetch of every `Fixes #{n}` record named on the PR body, checked against
// `evaluateMaturation` — that `_shared/console-execution.md` previously left
// to an executing session's own unmechanized, untested prose re-derivation
// (#1966). `mergeGrantGap` on a `ready` result names the withholding member
// the same way `mergeCheckVerdict` names a withheld needs-human verdict.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { iterRunDirsWithState } = require('../hooks/context');
const { runWithConcurrency } = require('./gh-pool');
const { evaluateMaturation, extractPendingGrantedAt } = require('../issues/grant-maturation');
const { resolvePolicyConfig } = require('../policy-schema');

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 5000;
// _shared/console-execution.md's Pre-execution claim section — a claim older
// than this with no executedAt is reclaimable by a fresh executor.
const RECLAIM_STALE_MS = 30 * 60 * 1000;

// null = no console.json at all; undefined = present but unparseable (fails
// closed, distinct from absent, mirroring archive-merged.js's readConsoleState).
function readConsoleJson(runDir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(runDir, 'console.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// A claim is reclaimable when absent, corrupt (fails open — never lets a bad
// timestamp permanently lock a console), or older than the reclaim window.
function isClaimReclaimable(executingAt, now) {
  if (!executingAt) return true;
  const claimedAt = Date.parse(executingAt);
  if (Number.isNaN(claimedAt)) return true;
  return (now - claimedAt) > RECLAIM_STALE_MS;
}

// `<!-- console-item: resolve -->` immediately followed by its checkbox row
// (`_shared/console-on-pr.md`'s Row shape) -> ticked boolean.
function isResolveTicked(body) {
  if (typeof body !== 'string') return false;
  const m = /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[([ xX])\]/.exec(body);
  return !!m && m[1].toLowerCase() === 'x';
}

// Every `<!-- console-item: {id} -->` row (excluding `resolve`, read
// separately above) -> { id: ticked }.
function parseItemTicks(body) {
  const ticks = {};
  if (typeof body !== 'string') return ticks;
  const re = /<!--\s*console-item:\s*([^\s>]+)\s*-->\s*\n-\s*\[([ xX])\]/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const id = match[1];
    if (id === 'resolve') continue;
    ticks[id] = match[2].toLowerCase() === 'x';
  }
  return ticks;
}

// Async (promisified execFile, non-blocking) so this module's per-run-dir
// fetches can genuinely run concurrently through gh-pool's
// runWithConcurrency below, unlike the old execFileSync, which blocks the
// event loop regardless of how the calling code is structured (#820, D5).
async function fetchPrData(repoRoot, prNumber) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(prNumber), '--json', 'comments,body'],
      { cwd: repoRoot, encoding: 'utf8', timeout: FETCH_TIMEOUT_MS, windowsHide: true },
    ));
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, reason: 'gh-absent' };
    return { ok: false, reason: 'network-failure' };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: 'network-failure' };
  }
  const comments = Array.isArray(parsed && parsed.comments) ? parsed.comments : [];
  const body = typeof (parsed && parsed.body) === 'string' ? parsed.body : '';
  return { ok: true, comments, body };
}

// One `Fixes #{n}` line per record (`_shared/pr-early-run-lifecycle.md`'s
// Step 3 template) -> the deduplicated, ordered list of member issue numbers
// named on the PR body. Pure string parsing, no I/O — mirrors isResolveTicked/
// parseItemTicks above.
function parseFixesMembers(body) {
  if (typeof body !== 'string') return [];
  const out = [];
  const seen = new Set();
  const re = /^Fixes #(\d+)\s*$/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    const n = Number(match[1]);
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

// gh issue view {n} --json labels,comments -> {labels, pendingSince} the same
// shape console-resolve.js's own ghReadGrants builds, for evaluateMaturation.
async function fetchIssueGrant(repoRoot, issueNumber) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', String(issueNumber), '--json', 'labels,comments'],
      { cwd: repoRoot, encoding: 'utf8', timeout: FETCH_TIMEOUT_MS, windowsHide: true },
    ));
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, reason: 'gh-absent' };
    return { ok: false, reason: 'network-failure' };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: 'network-failure' };
  }
  const labels = (parsed.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const bodies = (parsed.comments || []).map((c) => (typeof c === 'string' ? c : c.body || ''));
  return { ok: true, labels, pendingSince: extractPendingGrantedAt(bodies) };
}

// The `grant-veto-window-hours` policy value for this run dir, resolved
// synchronously (a cheap local git+file read, unlike every gh call above) —
// only ever invoked when an isMergeRow item is actually present, mirroring
// console-resolve.js's own readPolicy. Fails open to `undefined`
// (evaluateMaturation's own DEFAULT_VETO_WINDOW_HOURS fallback) on any error,
// same posture as every other best-effort read in this file.
function resolveVetoWindowHours(runDir, repoRoot) {
  try {
    const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
    const { result } = resolvePolicyConfig({ git, readFile, runDir, keys: ['grant-veto-window-hours'] });
    const entry = result['grant-veto-window-hours'];
    const raw = entry && entry.error === undefined ? entry.value : null;
    const veto = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(veto) ? veto : undefined;
  } catch {
    return undefined;
  }
}

// Pure: consoleJson + now -> the pre-fetch skip reason, or null when
// eligible. Shared by decideConsoleExecute below (the full post-fetch
// decision) and consoleExecuteDetect's synchronous scan further down — the
// two-phase split (#820, D5) needs the scan to reject everything it can
// BEFORE issuing a `gh pr view` fetch, using exactly the same checks
// decideConsoleExecute re-applies once comments are in hand. One ladder
// instead of two copies that could drift.
function preFetchSkipReason(consoleJson, now) {
  if (consoleJson === null) return 'no-console';
  if (consoleJson === undefined) return 'unparseable-console-json';
  // #1130 review: a non-empty executedAt is execution's own completion stamp
  // — consoles written before the write order also set `resolved: true`
  // (console-execution.md) carry executedAt alone. Without this,
  // an executed-but-unarchived console whose executingAt claim aged past
  // RECLAIM_STALE_MS re-detected as `ready` on every pass (the PR checkbox
  // stays ticked), re-applying Q#/M#/U# items that have no drift guard —
  // and archive-merged.js's readConsoleState (which does accept executedAt)
  // would classify the same file 'resolved' in the same reconcile pass.
  // Same acceptance rule as readConsoleState: keep the two readers agreeing.
  if (consoleJson.resolved === true
    || (typeof consoleJson.executedAt === 'string' && consoleJson.executedAt.trim().length > 0)) {
    return 'already-resolved';
  }
  if (!isClaimReclaimable(consoleJson.executingAt, now)) return 'claimed';
  const commentIds = Array.isArray(consoleJson.commentIds) ? consoleJson.commentIds : [];
  if (!commentIds.length) return 'no-comment-ids';
  if (!consoleJson.prNumber) return 'no-pr-number';
  return null;
}

// Pure: consoleJson + fetched comments + now (+ optional ctx for the #1802
// merge-grant check below) -> a detection verdict. No I/O, so the
// race/claim/idempotence logic is unit-testable without gh.
//   { action: 'ready', prNumber, commentIds, items } | { action: 'skip', reason }
// ctx: { prBody?, memberGrants?: {[issueNumber]: {labels, pendingSince}}, vetoWindowHours?, now? }
// — all optional; omitted entirely (the pre-#1802 call shape) always yields
// mergeGrantGap: null, unchanged from before.
function decideConsoleExecute(consoleJson, comments, now, ctx = {}) {
  const skipReason = preFetchSkipReason(consoleJson, now);
  if (skipReason) return { action: 'skip', reason: skipReason };

  const commentIds = consoleJson.commentIds;

  const byId = new Map();
  for (const c of comments || []) {
    if (c && typeof c.id === 'string') byId.set(c.id, c);
  }

  const primary = byId.get(commentIds[0]);
  if (!primary) return { action: 'skip', reason: 'comment-not-found' };
  if (!isResolveTicked(primary.body)) return { action: 'skip', reason: 'not-resolved-yet' };

  // Overflow comments (console-on-pr.md's Post-or-update procedure step 4)
  // each carry their own item ticks; the primary carries the Resolve box.
  const ticksByComment = new Map();
  for (const id of commentIds) {
    const c = byId.get(id);
    ticksByComment.set(id, c ? parseItemTicks(c.body) : {});
  }

  const items = Array.isArray(consoleJson.items) ? consoleJson.items : [];
  const resolvedItems = items.map((item) => {
    const commentId = item.commentId && commentIds.includes(item.commentId) ? item.commentId : commentIds[0];
    const ticks = ticksByComment.get(commentId) || {};
    return {
      id: item.id, kind: item.kind, summary: item.summary, stagedHash: item.stagedHash, approved: ticks[item.id] === true, ...(item.isMergeRow === true ? { isMergeRow: true } : {}),
    };
  });

  // #1294: pass the persisted merge-check verdict through untouched — it comes from
  // console.json (written by `_shared/console-on-pr.md`'s post procedure), never from the
  // comment body, since a tick can't carry it. `null` when the record's group never had a
  // merge-check verdict computed at render time (no `auto:merge`/`auto:merge-pending` in
  // play that session) — absence means "unknown", not "cleared for auto-merge".
  const mergeCheckVerdict = consoleJson.mergeCheckVerdict === 'needs-human' ? 'needs-human' : null;

  // #1802: the second, narrower exception — withheld independent of
  // mergeCheckVerdict, since it reads directly observable current label
  // state rather than a persisted, once-computed LLM judgment. Only
  // evaluated when an isMergeRow item is actually present AND the caller
  // supplied both a PR body and pre-fetched member grants (consoleExecuteDetect
  // does; a direct unit-test call omitting ctx gets mergeGrantGap: null,
  // preserving every pre-#1802 test's expectations unchanged).
  let mergeGrantGap = null;
  const hasMergeRow = items.some((item) => item.isMergeRow === true);
  if (hasMergeRow && typeof ctx.prBody === 'string' && ctx.memberGrants && typeof ctx.memberGrants === 'object') {
    const members = parseFixesMembers(ctx.prBody);
    if (!members.length) {
      // A merge row exists but no `Fixes #{n}` line could be parsed — the
      // same fail-closed posture as resolve.js's own 'members-unresolved':
      // a withheld grant is a human decision, never silently assumed clear
      // for want of a membership list this session could not determine.
      mergeGrantGap = { member: null, reason: 'members-unresolved' };
    } else {
      for (const n of members) {
        const grant = ctx.memberGrants[n];
        if (!grant) { mergeGrantGap = { member: n, reason: 'grant-unreadable' }; break; }
        const mat = evaluateMaturation({
          hasMergeLabel: (grant.labels || []).includes('auto:merge'),
          hasPendingLabel: (grant.labels || []).includes('auto:merge-pending'),
          pendingSince: grant.pendingSince || null,
          vetoWindowHours: ctx.vetoWindowHours,
          now: ctx.now !== undefined ? ctx.now : now,
        });
        if (!mat.mature) { mergeGrantGap = { member: n, reason: mat.reason }; break; }
      }
    }
  }

  return {
    action: 'ready', prNumber: consoleJson.prNumber, commentIds, items: resolvedItems, mergeCheckVerdict, mergeGrantGap,
  };
}

// opts: { cwd? } -> { ready: [{ runDir, prNumber, commentIds, items, mergeCheckVerdict, mergeGrantGap }], skipped: [{ runDir, reason }] }
// Runs in two phases (#820, D5): a synchronous scan collecting every run dir
// that needs a `gh pr view` fetch (fast fs reads + pure pre-checks), then
// one gh-pool `runWithConcurrency` batch resolving all of those fetches at
// once, then a final synchronous pass deciding each — since each fetch
// result feeds its own `decideConsoleExecute` call, decide happens after,
// not inside, the parallel batch. A third phase (#1802), gated on an
// isMergeRow item actually being present in a candidate's own console.json,
// batch-fetches every `Fixes #{n}` member's live grant before deciding that
// candidate — see decideConsoleExecute's ctx.memberGrants.
async function consoleExecuteDetect(opts = {}) {
  const ready = [];
  const skipped = [];
  const start = opts.cwd || process.cwd();
  const root = mainCheckoutRoot(start);
  if (!root) return { ready, skipped };
  const now = opts.now || Date.now();

  const candidates = [];
  for (const { dir } of iterRunDirsWithState(root)) {
    const consoleJson = readConsoleJson(dir);
    const skipReason = preFetchSkipReason(consoleJson, now);
    if (skipReason) { skipped.push({ runDir: dir, reason: skipReason }); continue; }
    candidates.push({ dir, consoleJson });
  }

  const fetches = await runWithConcurrency(candidates, (c) => fetchPrData(root, c.consoleJson.prNumber));

  // #1802: collect every (candidate, member) pair that needs a live grant
  // re-fetch — only candidates whose console.json carries an isMergeRow item
  // AND whose PR-body fetch succeeded ever reach here, so an unattended run
  // with no merge row pending (the common case) pays zero extra gh calls.
  // Every such candidate's memberGrants entry is seeded to {} BEFORE any
  // fetch resolves (not only on a successful one) — decideConsoleExecute
  // treats a member missing from memberGrants as 'grant-unreadable' and
  // withholds, so a candidate whose fetches all fail still fails closed
  // instead of silently falling back to ctx: {} (which would read as "no
  // merge row to check" and let the row through unchecked).
  const grantJobs = [];
  const mergeRowCandidateIndices = new Set();
  candidates.forEach((c, i) => {
    const fetch = fetches[i];
    if (!(fetch && fetch.ok)) return;
    const items = Array.isArray(c.consoleJson.items) ? c.consoleJson.items : [];
    if (!items.some((item) => item.isMergeRow === true)) return;
    mergeRowCandidateIndices.add(i);
    for (const n of parseFixesMembers(fetch.body)) grantJobs.push({ candidateIndex: i, member: n });
  });
  const memberGrantsByCandidate = new Map();
  for (const i of mergeRowCandidateIndices) memberGrantsByCandidate.set(i, {});
  const grantResults = await runWithConcurrency(grantJobs, (job) => fetchIssueGrant(root, job.member));
  grantJobs.forEach((job, i) => {
    const g = grantResults[i] instanceof Error ? { ok: false } : grantResults[i];
    if (!g.ok) return;
    memberGrantsByCandidate.get(job.candidateIndex)[job.member] = { labels: g.labels, pendingSince: g.pendingSince };
  });

  candidates.forEach((c, i) => {
    const fetch = fetches[i] instanceof Error ? { ok: false, reason: 'network-failure' } : fetches[i];
    if (!fetch.ok) { skipped.push({ runDir: c.dir, reason: fetch.reason }); return; }
    const ctx = memberGrantsByCandidate.has(i)
      ? { prBody: fetch.body, memberGrants: memberGrantsByCandidate.get(i), vetoWindowHours: resolveVetoWindowHours(c.dir, root), now }
      : {};
    const decision = decideConsoleExecute(c.consoleJson, fetch.comments, now, ctx);
    if (decision.action === 'skip') { skipped.push({ runDir: c.dir, reason: decision.reason }); return; }
    ready.push({
      runDir: c.dir, prNumber: decision.prNumber, commentIds: decision.commentIds, items: decision.items, mergeCheckVerdict: decision.mergeCheckVerdict, mergeGrantGap: decision.mergeGrantGap,
    });
  });

  return { ready, skipped };
}

module.exports = {
  consoleExecuteDetect,
  decideConsoleExecute,
  isResolveTicked,
  parseItemTicks,
  isClaimReclaimable,
  readConsoleJson,
  parseFixesMembers,
  RECLAIM_STALE_MS,
};
