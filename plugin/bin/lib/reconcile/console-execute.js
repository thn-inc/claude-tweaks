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

// #2568: the write path behind `hooks.js resolve-console` — a session that
// answered a pending-review console in chat ("merge") rather than by
// ticking the PR comment's checkboxes performs the same three coupled
// writes `_shared/console-execution.md`'s "Write order after execution"
// section documents, in the documented order, instead of hand-deriving
// them. Composes this file's own read-only helpers (readConsoleJson,
// isClaimReclaimable, parseItemTicks) with a new write path — never a
// parallel re-derivation of console state.
//
// `deps.gh(args) -> Promise<stdout>` is the one injectable seam every gh
// call (the read, the reply post, the marker-edit PATCH) goes through, per
// `gh-api-module-pattern`'s injectable-runner convention — a fake in tests
// asserts the three writes' exact call order without shelling out to real
// `gh`. `deps.writeFile(path, content)` is the sync console.json write;
// `deps.now()` defaults to `Date.now`.
//
// Returns (never throws for an expected outcome):
//   { status: 'executed', outcomes, resolved, prNumber }
//   { status: 'noop', reason: 'already-resolved' | 'claimed', executingSession? }
//   { status: 'error', reason: 'no-console' | 'unparseable-console-json' |
//       'no-comment-ids' | 'no-pr-number' | 'network-failure' |
//       'comment-not-found' | 'unknown-item-ids' | 'reply-comment-failed' |
//       'marker-edit-failed', ids?, error? }
async function resolveConsoleExecution(runDir, { approve = [], decline = [] } = {}, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const consoleJson = readConsoleJson(runDir);
  if (consoleJson === null) return { status: 'error', reason: 'no-console' };
  if (consoleJson === undefined) return { status: 'error', reason: 'unparseable-console-json' };

  // Idempotence — matches preFetchSkipReason's own acceptance rule (a
  // non-empty executedAt is sufficient on its own; consoles written before
  // this write order set `resolved: true` carry executedAt alone).
  if (consoleJson.resolved === true
    || (typeof consoleJson.executedAt === 'string' && consoleJson.executedAt.trim().length > 0)) {
    return { status: 'noop', reason: 'already-resolved' };
  }
  // Pre-execution claim (`_shared/console-execution.md`'s own section): a
  // live (non-stale) executingAt claim belongs to another session; no-op
  // rather than race it. A stale or absent claim is reclaimable — this verb
  // does not itself write executingAt (it goes straight to the completion
  // write below), matching a chat-driven resolution's single-shot nature.
  if (!isClaimReclaimable(consoleJson.executingAt, now)) {
    return { status: 'noop', reason: 'claimed', executingSession: consoleJson.executingSession || null };
  }

  const commentIds = Array.isArray(consoleJson.commentIds) ? consoleJson.commentIds : [];
  if (!commentIds.length) return { status: 'error', reason: 'no-comment-ids' };
  if (!consoleJson.prNumber) return { status: 'error', reason: 'no-pr-number' };

  let stdout;
  try {
    stdout = await deps.gh(['pr', 'view', String(consoleJson.prNumber), '--json', 'comments,body']);
  } catch (err) {
    return { status: 'error', reason: 'network-failure', error: errorText(err) };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { status: 'error', reason: 'network-failure' };
  }
  const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
  const byId = new Map();
  for (const c of comments) if (c && typeof c.id === 'string') byId.set(c.id, c);
  const primary = byId.get(commentIds[0]);
  if (!primary) return { status: 'error', reason: 'comment-not-found' };

  // Validate every named id against the comment's own parsed rows BEFORE
  // any write — a partial write followed by an error would leave the
  // console in an inconsistent state.
  const ticks = parseItemTicks(primary.body);
  const knownIds = new Set(Object.keys(ticks));
  const namedIds = [...new Set([...approve, ...decline])];
  const unknownIds = namedIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length) return { status: 'error', reason: 'unknown-item-ids', ids: unknownIds };

  const items = Array.isArray(consoleJson.items) ? consoleJson.items : [];
  const approveSet = new Set(approve);
  const declineSet = new Set(decline);
  // Every item this console names gets an outcome — one explicitly declined
  // via `--decline`, one explicitly (or already-tick) approved, and
  // anything named in neither list defaults to declined ("declined, no
  // reason given" — the same Override-drill decline convention
  // `_shared/console-execution.md`'s Execution routing section already
  // documents) rather than silently guessing an intent nobody stated.
  const outcomes = items.map((item) => {
    if (!declineSet.has(item.id) && (approveSet.has(item.id) || ticks[item.id] === true)) {
      return { id: item.id, kind: item.kind, outcome: 'executed', isMergeRow: item.isMergeRow === true };
    }
    return {
      id: item.id, kind: item.kind, outcome: 'declined', note: 'declined, no reason given', isMergeRow: item.isMergeRow === true,
    };
  });
  // Resolve ticks only when every item in the console is floor-clearing —
  // matching the partial-resolution behavior `_shared/console-execution.md`'s
  // `consoleAutoResolve` section already describes for a non-floor item
  // (an isMergeRow item declined while others remain unticked leaves both
  // that item and Resolve unticked).
  const allExecuted = outcomes.length > 0 && outcomes.every((o) => o.outcome === 'executed');

  // 1. Reply comment first — the source of truth a foreign detection pass
  // keys "already executed" off, per the Write order section.
  const replyBody = buildExecutedReplyBody(outcomes);
  try {
    await deps.gh(['pr', 'comment', String(consoleJson.prNumber), '--body', replyBody]);
  } catch (err) {
    return { status: 'error', reason: 'reply-comment-failed', error: errorText(err) };
  }

  // 2. Resolved marker edit on the console comment's first line — ticking
  // the Resolve checkbox only when every item resolved favorably.
  const editedBody = addConsoleResolvedMarker(tickResolveBoxIfAllExecuted(primary.body, allExecuted));
  try {
    await deps.gh(['api', `repos/{owner}/{repo}/issues/comments/${primary.id}`, '-X', 'PATCH', '-f', `body=${editedBody}`]);
  } catch (err) {
    return { status: 'error', reason: 'marker-edit-failed', error: errorText(err) };
  }

  // 3. console.json.executedAt + resolved: true, together, in one write.
  const nextConsoleJson = { ...consoleJson, executedAt: new Date(now).toISOString(), resolved: allExecuted };
  deps.writeFile(path.join(runDir, 'console.json'), JSON.stringify(nextConsoleJson, null, 2));

  return {
    status: 'executed', outcomes, resolved: allExecuted, prNumber: consoleJson.prNumber,
  };
}

// Same shape as bin/lib/feedback/file-feedback.js's errorText — a thrown
// value from an injected fake (or a real gh failure) may not be a plain
// Error; never let the reported reason come back empty.
function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  return parts.length ? parts.join(' ') : String(err);
}

// One reply comment naming every item's outcome — `_shared/console-execution.md`'s
// Write order section's own `<!-- console-item: executed -->` marker, plus
// one line per item so a human (or a later foreign session) reading the PR
// sees exactly what this verb decided.
function buildExecutedReplyBody(outcomes) {
  const lines = outcomes.map((o) => (o.outcome === 'executed'
    ? `- \`${o.id}\`: executed`
    : `- \`${o.id}\`: ${o.note}`));
  return `<!-- console-item: executed -->\n${lines.join('\n')}`;
}

// Ticks the Resolve checkbox row (isResolveTicked's own row shape, in
// reverse) only when every item resolved favorably — a partial resolution
// must never silently tick Resolve, since that would tell a later detection
// pass "a human confirmed everything," which isn't true.
function tickResolveBoxIfAllExecuted(body, allExecuted) {
  if (!allExecuted || typeof body !== 'string') return body;
  return body.replace(/(<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[)[ ]?(\])/i, '$1x$2');
}

// Prepends the resolved marker as the comment's first line — idempotent
// (the pre-execution claim/idempotence checks above already refuse to reach
// here on an already-resolved console, so this never double-prepends in
// practice, but a bare prepend is trivially safe either way).
function addConsoleResolvedMarker(body) {
  const marker = '<!-- claude-tweaks-console-resolved -->';
  if (typeof body !== 'string') return marker;
  return `${marker}\n${body}`;
}

module.exports = {
  consoleExecuteDetect,
  decideConsoleExecute,
  isResolveTicked,
  parseItemTicks,
  isClaimReclaimable,
  readConsoleJson,
  parseFixesMembers,
  resolveConsoleExecution,
  RECLAIM_STALE_MS,
};
