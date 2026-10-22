// bin/lib/hooks/context.js
'use strict';
const fs = require('fs');
const path = require('path');
const wtDetect = require('./worktree-detect');
const { writeFileAtomic } = require('../atomic-write');
const { runGit } = require('./git-exec');
const { parseWorktreeList, isPidAlive } = require('./worktree-reap');
const runDirResolve = require('./run-dir-resolve');
const { classifyDecisions } = require('../log-decision/claim-log');
const { canonicalRealpath } = require('../path-guard');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function parseInput(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function readRunState(runDir) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8')); } catch { return null; }
}

// How long an archive twin's 'archiving' claim (archive-merged.js's
// archiveRunDir) blocks other archival attempts on the same run dir before
// it's treated as abandoned. Minutes, not hours (unlike ORPHAN_MINT_TTL_MS,
// archive-merged.js's own 24h constant for a different case) — a real
// archival completes in seconds; anything still 'archiving' after this long
// crashed or hung, and the run dir must become archivable again rather than
// staying stuck behind a dead claim.
const ARCHIVE_CLAIM_TTL_MS = 5 * 60 * 1000;

function isStaleClaim(archiveState, now = Date.now()) {
  const updatedAt = Date.parse(archiveState.updatedAt);
  if (Number.isNaN(updatedAt)) return true;
  return (now - updatedAt) > ARCHIVE_CLAIM_TTL_MS;
}

function hasRunStateFile(dir) {
  return fs.existsSync(path.join(dir, 'run-state.json'));
}

// An unadopted mint — a directory mkdir'd by dispatch Step 4 or flow Step 2.8
// that no invocation ever initialized — carries neither run-state.json nor
// decisions.md, or (#3363) a decisions.md holding ONLY flow Step 2.8's claim
// line: that claim is written before Step 3 initializes anything, so a mint
// that has only been claimed is still unadopted. Fallback attribution must
// never guess into one: a mint that sorts newest absorbs foreign sessions'
// events until swept (#721). Keyed on file presence and content shape, not
// parse success — a corrupt run-state.json is still an adopted run, and
// readRunState's null covers both cases — and never on config.yml: standalone
// run dirs legitimately carry decisions.md but no config.yml. An empty
// decisions.md, or one with any non-claim content, is adopted; an unreadable
// one (non-ENOENT error) is adopted rather than guessed into. Consequence:
// hooks.js CLI verbs that rely on this fallback with no --run (record-pr,
// close-run — record-worktree no longer does, #1124: it now hard-requires an
// explicit --run, never guessing) only ever resolve an adopted run — safe
// because every sanctioned caller runs after flow Step 3 has already
// initialized the run dir (decisions.md with more than Step 2.8's claim-log
// lines (claim plus bookkeeping, #3665), or
// run-state.json, already exists by then). Exception: in `interactive` mode
// Step 3 skips the Manifesto, so a current-branch run stays claim-log-only
// with no run-state.json until wrap-up and its own session's events get no
// fallback attribution — the same as an empty mint pre-#2492 (the #721 design).
function isUnadoptedMint(dir, state) {
  if (state) return false;
  if (hasRunStateFile(dir)) return false;
  let text;
  try {
    text = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
  } catch (err) {
    return err.code === 'ENOENT';
  }
  return classifyDecisions(text) === 'claim-log-only';
}

// #3515 (the #3401 incident): the claim-log-only half of isUnadoptedMint above
// (#3363), checked on its own so isSkippableFallbackCandidate can test it
// FIRST and mark it `dropped` — a strict resolveRun then names the skipped mint
// instead of reporting a silent 'unadopted-mint'. The skip itself applies to
// EVERY fallback resolution — E1's non-strict runDir as well as the strict
// ownedRun (the incident's write was pre-tool-use's gitignored-exemption
// breadcrumb, logged against ctx.runDir). A read error is not-a-mint — never
// skip a candidate on evidence we could not read.
function isClaimLogOnlyMint(dir, state) {
  if (state) return false;
  if (hasRunStateFile(dir)) return false;
  try {
    return classifyDecisions(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8')) === 'claim-log-only';
  } catch { return false; }
}

// #3515 (the #3401 incident): the fallback guess may only land in a run bound
// to the CALLER's own checkout. classifyOwnership (#1410) already skips a
// binding provably foreign to a caller inside a different LIVE linked worktree,
// but a caller in the main checkout — where most hook firings happen — or one
// whose binding is gone from disk classifies 'indeterminate' and still guessed
// in. Strict attribution skips any candidate whose recorded `worktree` is not
// the caller's resolved toplevel. Fail-open on an unanswerable git question
// (indeterminate, or no repo at all): no evidence, no skip. `callerRepoInfo`
// is resolveRun's lazy per-call memo of wtDetect.repoInfo(cwd) — the caller's
// cwd is the same for every candidate, so it is computed at most once, and
// only once a bound candidate is actually met.
function isOtherWorktreeBound(callerRepoInfo, state, fsImpl) {
  const binding = state && typeof state.worktree === 'string' && state.worktree ? state.worktree : null;
  if (!binding) return false;
  const info = callerRepoInfo();
  if (info.indeterminate || !info.repoRoot) return false;
  // Both sides canonicalized through path-guard's .native canonicalRealpath: the
  // JS-form realpath keeps the input's letter case on a case-insensitive volume (#3836).
  return (canonicalRealpath(binding, { fsImpl }) || path.resolve(binding)) !== (canonicalRealpath(info.repoRoot, { fsImpl }) || info.repoRoot);
}

// #1177: best-effort removal of a mint's own layout (staged/, decisions.md,
// then the directory itself) — used by post-tool-use.js's stampAdHocRunDir
// when writeRunState fails after the mint has already touched decisions.md
// (which isUnadoptedMint above would otherwise read as "adopted", leaving a
// mis-attributable candidate behind for a different session, #721). Each
// step is independently best-effort — an already-partial mint (e.g. no
// staged/ dir yet) must not abort the later steps.
function rollbackMint(dirPath) {
  try { fs.rmdirSync(path.join(dirPath, 'staged')); } catch { /* best-effort */ }
  try { fs.unlinkSync(path.join(dirPath, 'decisions.md')); } catch { /* best-effort */ }
  try { fs.rmdirSync(dirPath); } catch { /* best-effort */ }
}

// Canonical run-dir name matcher; defined in run-dir-resolve.js, which owns
// the rationale for filtering out non-run siblings such as archive/.
const RUN_ID_RE = runDirResolve.RUN_ID_RE;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function hasPrNumber(state) {
  return isPlainObject(state.pr) && Number.isInteger(state.pr.number);
}

// The one multi-spec parent fallback (#2858). A /flow multi-spec run hands
// each spec's skills a per-spec run dir ({parent-run-id}/spec-{N}/) that
// carries its own status, while the run's shared worktree/PR stamps live on
// the PARENT run dir (record-worktree / record-pr write there). Reads the
// per-spec run-state.json and, behind the /^spec-/ basename gate, fills a
// missing worktree / pr / prExempt field by field from the parent's — a
// usable per-spec value always wins. `requireRunIdParent` adds the stricter
// "parent basename is run-id-shaped" gate pre-tool-use.js's perSpecPathspec
// applies. `read` is injectable for callers that read through their own deps.
// Never throws: a missing, unreadable, malformed, or non-object file reads as
// null. Returns { state, parentRunDir, filled } — parentRunDir is set
// whenever the gate passed (even when the parent file is unreadable), and
// `filled` names the fields taken from the parent.
function readRunStateWithParent(runDir, { read = readRunState, requireRunIdParent = false } = {}) {
  if (typeof runDir !== 'string' || !runDir) return { state: null, parentRunDir: null, filled: [] };
  const safeRead = (dir) => {
    try {
      const v = read(dir);
      return isPlainObject(v) ? v : null;
    } catch { return null; }
  };
  const own = safeRead(runDir);
  if (!/^spec-/.test(path.basename(runDir))) return { state: own, parentRunDir: null, filled: [] };
  const parentRunDir = path.dirname(runDir);
  if (requireRunIdParent && !RUN_ID_RE.test(path.basename(parentRunDir))) return { state: own, parentRunDir: null, filled: [] };
  const parent = safeRead(parentRunDir);
  if (!parent) return { state: own, parentRunDir, filled: [] };
  const state = { ...(own || {}) };
  const filled = [];
  // The per-spec side is judged by shape (a usable value wins); the parent
  // side only by truthiness, so a hand-corrupted parent stamp still reaches
  // the caller exactly as written and each caller keeps its own verdict on it
  // (precondition.js fails open on one; resolvePrNumber returns it).
  if (!(typeof state.worktree === 'string' && state.worktree) && parent.worktree) {
    state.worktree = parent.worktree;
    filled.push('worktree');
  }
  if (!hasPrNumber(state) && parent.pr) {
    state.pr = parent.pr;
    filled.push('pr');
  }
  if (!state.prExempt && parent.prExempt) {
    state.prExempt = parent.prExempt;
    filled.push('prExempt');
  }
  return { state: own || filled.length ? state : null, parentRunDir, filled };
}

// #848: a near-miss shape — the same 8-digit-date + T + 6-digit-time prefix
// as a canonical run-id, minus the dashes (e.g. `20260817T173343-spec-764`,
// the exact form a hand-composed `date -u +%Y%m%dT%H%M%S` mint produced
// before every mint site delegated to run-dir-resolve.js's formatTimestamp()).
// RUN_ID_RE silently excludes this shape from iterRunDirsWithState — by
// design, that generator only yields directories it can confidently treat as
// runs, since it drives both the fallback event-attribution scan and every
// reconcile check's enumeration. findNonCanonicalRunDirs is the surfacing
// half: report-only, never renamed or adopted, so a caller (reconcile) can
// warn a human instead of silently omitting the run from every pass forever.
const NON_CANONICAL_RUN_ID_RE = /^\d{8}T\d{6}/;

// Directories under `.claude-tweaks/pipelines/` that look run-dir-shaped
// (NON_CANONICAL_RUN_ID_RE) but don't match the canonical dash format
// (RUN_ID_RE) and aren't `archive`. Anchored the same way
// iterRunDirsWithState is — the main checkout, not raw cwd. Read-only: never
// renames, deletes, or touches anything under the returned names.
function findNonCanonicalRunDirs(cwd) {
  const start = cwd || process.cwd();
  const root = wtDetect.mainCheckoutRoot(start) || start;
  const base = path.join(root, '.claude-tweaks', 'pipelines');
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'archive' && !RUN_ID_RE.test(e.name) && NON_CANONICAL_RUN_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

// Lazily yields each candidate run dir (newest-first) paired with its
// already-read state, reading run-state.json for one dir at a time instead
// of mapping every candidate up front — callers that only need the first
// match (resolveRunDir) or the first few (session-start's MAX_REPORTED
// stale-run report) can stop early and never pay for the rest. Callers that
// genuinely need the whole list (pre-tool-use's other-worktrees scan)
// exhaust it via listRunDirsWithState below, which is unchanged in output.
function* iterRunDirsWithState(cwd, opts = {}) {
  // Anchored to the MAIN checkout, not raw cwd. A run dir created inside a
  // linked worktree was previously invisible from the main checkout and vice
  // versa, which is why a worktree could hold the only copy of decisions.md /
  // staged/ and why E1 fell open for commits issued from a worktree carrying
  // no .claude-tweaks/. One anchor means every session resolves the same run
  // set. Falls back to cwd when the main checkout can't be determined — that
  // is the pre-anchoring behavior, so an unknown answer changes nothing.
  //
  // That fallback is reachable from inside a worktree, not only outside a repo:
  // mainCheckoutRoot returns null for an unreadable or unparseable `.git` file
  // as well as for "no repo here". In the worktree case this un-anchors and
  // reads the worktree's own pipelines dir. Deliberately not guarded further —
  // distinguishing the two would cost either a git spawn (this path runs on
  // every hook invocation) or a second walk, and the state it can reach is the
  // one a worktree with a broken `.git` file actually has. The scenario it
  // matters for is wrap-up's transitional copy-out guard, which does its own
  // `pwd -P` resolution rather than trusting this one.
  const start = cwd || process.cwd();
  const root = wtDetect.mainCheckoutRoot(start) || start;
  const base = path.join(root, '.claude-tweaks', 'pipelines');
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return; }
  const names = entries
    .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  // #1738: an opt-in filter, not a widened yield — the default (`opts.status`
  // unset) is byte-identical to the exclude-clean behavior every existing
  // caller relies on. `{ status: 'clean' }` inverts the same test to yield
  // ONLY clean runs (session-start.js's #1493 AC5 staged-proposals scan,
  // archive-merged.js's #1544 clean-status sweep), so both shapes still
  // share the anchor, ordering, archive-twin skip, and `archiving`-claim skip
  // below this line.
  const wantClean = opts.status === 'clean';
  for (const name of names) {
    const dir = path.join(base, name);
    const state = readRunState(dir);
    if (Boolean(state && state.status === 'clean') !== wantClean) continue;
    // Defense in depth (#593): a stray top-level dir left behind by a
    // filesystem-only (non-git-aware) archival move — pre-fix, or any future
    // regression that reintroduces one — still has no local run-state.json
    // (or a stale non-terminal one, e.g. resurrected by `git checkout` after
    // `work/` was git-mv'd out from under it), but its archive twin at
    // archive/{name}/ may already carry a terminal run-state.json — the real
    // signal this run is done. Checked at the SHARED iterator level (not
    // just session-start.js, which has no branching logic of its own) so
    // every caller of this generator benefits: resolveRun's fallback scan,
    // the reconciler's archiveMerged pass, and session-start's unfinished-run
    // report all stop treating an already-archived run as still-open.
    //
    // #1103 fix-wave-1: this content-aware check is now the ONLY archive-twin
    // check in this loop. An earlier existence-only check (`isArchivedRunId`,
    // an fs.existsSync/statSync(...).isDirectory() probe with no read of the
    // twin's own state) used to run first and skip on mere existence of
    // archive/{name}/ — but archiveRunDir (archive-merged.js) creates that
    // directory via fs.mkdirSync as its very FIRST action, before any
    // content actually moves. Any failure after that point (git-mv-failed,
    // commit-failed, tracked-entry, move-failed, …) left an empty or
    // partially-populated archive/{name}/ with no cleanup path — which the
    // existence-only check then treated as "already archived" forever,
    // permanently stranding the live run dir and its real content (the
    // literal double-nesting bug #1103 reports). Removed rather than
    // reworked: this check already subsumes the sanctioned case (a
    // genuinely completed archive) and, unlike the removed one, cannot be
    // fooled by an incomplete archive attempt.
    const archiveState = readRunState(path.join(base, 'archive', name));
    if (archiveState && archiveState.status === 'clean') continue;
    // #1103 follow-up: a fresh 'archiving' claim (archive-merged.js writes
    // this the instant it mkdir's archiveDir, before moving anything) means
    // another process is already mid-archival of this exact run dir right
    // now — skip it here too, or a second unlocked `reconcile` invocation
    // (dispatch/tidy's pre-step; `reconcile-background` holds its own lock
    // and never races itself) racing the same run dir would double-move it.
    // TTL-bounded, unlike the removed existence-only check, so a claim left
    // behind by a crashed or failed attempt expires and stops blocking this
    // run dir instead of stranding it forever — the exact failure mode the
    // existence-only check's removal (above) fixed.
    if (archiveState && archiveState.status === 'archiving' && !isStaleClaim(archiveState)) continue;
    yield { dir, state };
  }
}

function listRunDirsWithState(cwd, opts) {
  return [...iterRunDirsWithState(cwd, opts)];
}

function listRunDirs(cwd, opts) {
  return listRunDirsWithState(cwd, opts).map(({ dir }) => dir);
}

// Which run an event belongs to, and how confidently we know it (#62).
//
//   'env'      — PIPELINE_RUN_DIR named it. Certain.
//   'session'  — the run records this session as its owner. Certain.
//   'fallback' — nobody claims it and nobody else owns it, so the newest
//                non-terminal run is the best guess. This is the pre-#62
//                behavior, kept only for runs whose ownership is unknown.
//   null dir   — every non-terminal run is owned by a DIFFERENT session.
//                Guessing here is what cross-contaminated events.jsonl and
//                left finished runs stamped `interrupted` forever.
//
// The asymmetry is deliberate: an unowned run may still be ours (ownership is
// only stamped by `record-worktree`, which a run without a worktree never
// calls), but a run owned by someone else never is.
//
// Sanctioned exception (#413): console execution (`_shared/console-execution.md`)
// deliberately acts on a run whose owning session is gone by design — the
// session that built the run and rendered its console may have ended long
// before a human ticks boxes on the PR. A foreign-owned or `null` ownedRun.dir
// during console execution is expected there, not a bug; that file's own
// writes (console.json, the reply comment, the resolved marker) go directly
// to the run dir and the PR regardless of this resolution, the same way
// `bin/lib/reconcile/*` already reads and writes runs regardless of session
// ownership. Do not "fix" this by tightening the ownership check.
//
// #1410: a fallback candidate is also filtered on WORKTREE binding, via
// classifyOwnership (#1098) — an axis orthogonal to the session-ownership
// filtering the two comments below deliberately skip. A candidate whose
// recorded `worktree` provably belongs to a different, still-live worktree
// than the caller's own `cwd` classifies 'foreign' regardless of session id
// (classifyOwnership degrades to 'indeterminate', never 'foreign', whenever
// the caller's own repo/worktree can't be determined, so this never narrows
// the fallback beyond what #62's original "newest non-terminal, not
// session-foreign" guess already allowed for a candidate lacking a provable
// worktree binding). This is what stops a concurrent sibling worktree's
// event (e.g. an AskUserQuestion answered in one session) from landing in an
// unrelated run's events.jsonl, without touching the 'env'/'session' arms
// above, or #413's console-execution exception, at all.
function isForeignWorktreeCandidate(cwd, sessionId, state) {
  return classifyOwnership({ sessionId, cwd }, state) === 'foreign';
}
// Shared by both resolveRun fallback arms below: a candidate is never
// eligible to be guessed into if it's an unadopted mint (#721). It is also
// skipped as provably worktree-foreign (#1410) UNLESS `includeWorktreeForeign`
// is set — the opt-out close-run's own fallback resolution passes (see the
// resolveRun doc comment below), so the mint check still applies regardless
// of the caller's own session id, but the worktree-binding axis does not.
// An `-adhoc-standalone` dir is never guessed into either (#2783): it holds one
// session's friction events only, reachable by that session through the
// 'session' arm. As a guess it became ctx.runDir — E1 then denied a commit
// from the main checkout against the ad-hoc dir's worktree.
//
// Returns `{ reason, dropped }` or null, so both call sites keep testing it for
// truthiness. `dropped: true` marks the #3515 guards: (a) claim-log-only mint,
// applied to EVERY resolution, and (b) bound to another worktree, applied only
// under the opt-in `strict`; a strict resolveRun reports exactly those in its
// `dropped` list. `includeWorktreeForeign` disables the worktree-binding
// guards, (b) included. `callerRepoInfo` is the lazy memo isOtherWorktreeBound
// reads (see there).
function isSkippableFallbackCandidate(cwd, sessionId, dir, state, includeWorktreeForeign, strict, callerRepoInfo, fsImpl) {
  if (isClaimLogOnlyMint(dir, state)) return { reason: 'claim-log-only mint', dropped: true };
  if (isUnadoptedMint(dir, state)) return { reason: 'unadopted-mint', dropped: false };
  if (isAdHocRunDir(dir)) return { reason: 'ad-hoc', dropped: false };
  if (includeWorktreeForeign) return null;
  if (isForeignWorktreeCandidate(cwd, sessionId, state)) return { reason: 'worktree-foreign', dropped: false };
  if (strict && isOtherWorktreeBound(callerRepoInfo, state, fsImpl)) return { reason: `bound to ${state.worktree}`, dropped: true };
  return null;
}
function resolveRun(cwd, env, sessionId, opts = {}) {
  if (env && env.PIPELINE_RUN_DIR) {
    try {
      if (fs.statSync(env.PIPELINE_RUN_DIR).isDirectory()) {
        return { dir: env.PIPELINE_RUN_DIR, attribution: 'env' };
      }
    } catch { /* fall through */ }
  }
  const me = typeof sessionId === 'string' && sessionId ? sessionId : null;
  // includeWorktreeForeign (whole-branch review finding, pre-v6.110.0):
  // close-run's implicit (no --run) fallback resolution passes this so it can
  // still find and report on a run bound to a different, still-live worktree
  // — closeRunState's own sessionId comparison is the actual safety net that
  // decides whether it's safe to act on what's found, so filtering the
  // worktree axis out here only hides the run from that check entirely,
  // regressing close-run's "belongs to another session" report into a false
  // "no run found." Every other caller (in particular post-tool-use.js's
  // event-attribution fallback, which is what #1410 was written for) omits
  // this and keeps the worktree filter.
  const includeWorktreeForeign = opts.includeWorktreeForeign === true;
  // #3515: both fallback arms skip a claim-log-only mint for EVERY caller.
  // strictAttribution is the opt-in for the WRITE path (hooks.js's ownedRun):
  // it also skips any candidate bound to a worktree other than the caller's,
  // and when the skips leave nothing, the null return carries `dropped` (one
  // "<run-id> (<reason>)" per #3515 skip) so the caller can say why nothing
  // was attributed. Non-strict callers keep the pre-#3515 return shapes (no
  // `dropped` key).
  const strict = opts.strictAttribution === true;
  const dropped = [];
  let callerInfo;
  const callerRepoInfo = () => {
    if (callerInfo === undefined) callerInfo = wtDetect.repoInfo(resolvedCwd);
    return callerInfo;
  };
  const skipReason = (dir, state) => {
    const skip = isSkippableFallbackCandidate(resolvedCwd, me, dir, state, includeWorktreeForeign, strict, callerRepoInfo, opts.fsImpl);
    if (skip && skip.dropped) dropped.push(`${path.basename(dir)} (${skip.reason})`);
    return skip;
  };
  const noRun = () => (strict && dropped.length ? { dir: null, attribution: null, dropped } : { dir: null, attribution: null });
  // Resolve once, up front, so the worktree-binding check below always sees
  // the same cwd the candidate scan itself uses — iterRunDirsWithState falls
  // back to process.cwd() internally on a falsy cwd, but isForeignWorktreeCandidate
  // (via classifyOwnership) treats a falsy cwd as 'indeterminate', never
  // 'foreign' — passing the raw, unresolved cwd there would silently no-op
  // the filter for any falsy-cwd caller.
  const resolvedCwd = cwd || process.cwd();
  if (!me) {
    // Caller identity unknown — behave exactly as before #62. Filtering by an
    // owner we cannot compare against would just be the old guess with fewer
    // candidates, and `record-worktree`/`close-run` deliberately resolve runs
    // they do NOT own so they can report that fact (see bin/hooks.js). The
    // worktree-binding check above is a different axis and applies here too,
    // unless the caller opted out via includeWorktreeForeign.
    for (const { dir, state } of iterRunDirsWithState(resolvedCwd)) {
      if (skipReason(dir, state)) continue;
      return { dir, attribution: 'fallback' };
    }
    return noRun();
  }
  let unowned = null;
  let ownAdHoc = null;
  for (const { dir, state } of iterRunDirsWithState(resolvedCwd)) {
    const owner = state && typeof state.sessionId === 'string' && state.sessionId ? state.sessionId : null;
    // #1099: session-id equality alone is not sufficient — a sibling agent of
    // this same session, bound to a DIFFERENT live worktree, must not be
    // returned as this caller's own run. classifyOwnership's 'foreign' verdict
    // is the only one that skips here; 'mine' (the ordinary case: cwd inside
    // the recorded worktree, or a binding-less run from the main checkout) and
    // 'indeterminate' (unprovable — a deleted binding, an unresolved cwd) both
    // preserve today's behavior and still return 'session' attribution, which
    // is what keeps single-session resolution byte-identical (#1099's Deliverables).
    const verdict = owner === me ? classifyOwnership({ sessionId: me, cwd: resolvedCwd }, state) : null;
    if (owner === me && verdict !== 'foreign') {
      // #2783: an ad-hoc dir is a placeholder minted when no owned run existed
      // yet. The first session match that is NOT ad-hoc returns at once (the
      // pre-#2783 behavior). Once an ad-hoc dir matched first, only an older
      // formal run proven 'mine' still wins — /flow mints its dir BEFORE
      // EnterWorktree, so the ad-hoc mint sorts newer, and record-worktree binds
      // the formal run to the caller's cwd. An 'indeterminate' older run (its
      // worktree since removed) must not displace the ad-hoc dir.
      if (isAdHocRunDir(dir)) {
        if (!ownAdHoc) ownAdHoc = dir;
        continue;
      }
      if (!ownAdHoc || verdict === 'mine') return { dir, attribution: 'session' };
      continue;
    }
    // Newest-first, so the first unowned, worktree-compatible run is the one
    // the old code returned unconditionally.
    if (!owner && !unowned && !skipReason(dir, state)) unowned = dir;
  }
  if (ownAdHoc) return { dir: ownAdHoc, attribution: 'session' };
  return unowned ? { dir: unowned, attribution: 'fallback' } : noRun();
}

function resolveRunDir(cwd, env, sessionId, opts) {
  return resolveRun(cwd, env, sessionId, opts).dir;
}

// Ownership classification (#1098): composite identity — session id AND
// worktree binding. Session-id equality is NOT sufficient evidence of
// ownership: CLAUDE_CODE_SESSION_ID is shared across all subagents of a
// session (measured 2026-08-20, #965), so N parallel siblings are
// indistinguishable by it — only the worktree binding separates them.
// Fail-open: unprovable evidence (deleted binding, indeterminate git answer,
// caller outside any known checkout, missing cwd) degrades to
// 'indeterminate', never 'foreign' — preserving resolveRun's documented
// asymmetry: an unowned run may still be ours; a provably-foreign run never is.
// `caller.cwd` must be absolute (same convention as findRunByWorktreePath's
// pre-resolved target). This predicate only classifies — it enforces
// nothing; consumers (#1012, #1099) own what each verdict does.
//
// `opts.fsImpl` (#3836) is the fs-like object the binding is canonicalized
// through (path-guard's canonicalRealpath) and the foreign proof stats through;
// production callers omit it and get the real fs.
//
// runState fields read — exactly two, nothing else: `sessionId` and
// `worktree`.
//
// A binding match yields 'mine' even when the run records no sessionId —
// binding outranks incomplete identity.
//
// A caller in any live worktree other than the one recorded in the binding
// classifies 'foreign' — same repo or different, both trees provably exist and differ.
//
// Authoritative semantics table: docs/hooks.md's Ownership section (the
// spec-1098 run-dir this predicate originated from was archived to
// .claude-tweaks/pipelines/archive/2026-08-20T185022-spec-1098/work/1098-spec.md
// on wrap-up — that path dies on archival, so docs/hooks.md is the live pointer).
function classifyOwnership(caller, runState, opts = {}) {
  const callerId = caller && typeof caller.sessionId === 'string' && caller.sessionId ? caller.sessionId : null;
  const ownerId = runState && typeof runState.sessionId === 'string' && runState.sessionId ? runState.sessionId : null;
  if (callerId && ownerId && callerId !== ownerId) return 'foreign';
  const cwd = caller && typeof caller.cwd === 'string' && caller.cwd ? caller.cwd : null;
  if (!cwd) return 'indeterminate';
  if (!path.isAbsolute(cwd)) return 'indeterminate'; // relative input must never resolve against the hook process's own cwd
  const binding = runState && typeof runState.worktree === 'string' && runState.worktree ? runState.worktree : null;
  const info = wtDetect.repoInfo(cwd);
  if (info.indeterminate) return 'indeterminate';
  if (binding) {
    // Both sides resolve through path-guard's .native canonicalRealpath, bound
    // to the caller's fsImpl (#3836). repoInfo's repoRoot is a JS realpath of
    // git's toplevel, which keeps the input's letter case, so it is canonicalized
    // here too; a caller anywhere inside the recorded worktree resolves to that
    // worktree's root and matches, and a case-only mismatch on a case-insensitive
    // volume reads 'mine'.
    function canonical(p) { return canonicalRealpath(p, { fsImpl: opts.fsImpl }); }
    const top = info.repoRoot ? (canonical(info.repoRoot) || info.repoRoot) : null;
    if (info.repoRoot && worktreeMatches({ worktree: binding }, top, info.repoRoot, canonical)) return 'mine';
    if (!info.repoRoot || !info.isLinkedWorktree) return 'indeterminate'; // outside any repo, or main checkout — cannot prove foreign
    const real = canonical(binding);
    if (!real) return 'indeterminate'; // binding gone from disk — fail open
    try { if (!(opts.fsImpl || fs).statSync(real).isDirectory()) return 'indeterminate'; } catch { return 'indeterminate'; }
    return 'foreign'; // caller is in a different live worktree than a binding that provably exists
  }
  if (!callerId || !ownerId) return 'indeterminate'; // no binding and incomplete identity
  // ids are both present and equal (different already returned foreign above)
  if (info.isLinkedWorktree) return 'indeterminate'; // equal ids from inside a worktree prove nothing about an unbound run
  if (info.repoRoot) return 'mine'; // main checkout + equal ids + no binding
  return 'indeterminate'; // outside any repo
}

// Shared by findRunByWorktreePath, findRunsByWorktreePath and classifyOwnership:
// does this run-state's recorded `worktree` match targetPath? Both sides resolve
// through the caller's canonicalizer — path-guard's .native canonicalRealpath,
// bound to the caller's fsImpl (#3769, #3836) — so a mis-cased spelling on a
// case-insensitive volume matches its on-disk form. A torn-down worktree's path
// may no longer resolve, so the raw string is kept as a fallback comparison
// rather than failing the match.
function worktreeMatches(state, target, targetPath, canonical) {
  if (!state || typeof state.worktree !== 'string' || !state.worktree) return false;
  const recorded = canonical(state.worktree) || state.worktree;
  return recorded === target || state.worktree === targetPath;
}

// Reverse lookup: which non-terminal run holds this worktree path as its
// recorded assignment? Canonicalizes both sides via realpath where the paths
// exist (recorded assignments are already absolute; the caller resolves a
// relative teardown target against the Bash call's cwd BEFORE calling this).
// First match wins (newest-first, same ordering as resolveRun's scan).
// `opts.skipAdHoc` (#2783): skip `-adhoc-standalone` dirs. One holds only
// friction events, never pipeline state, yet EnterWorktree mints it AFTER
// /flow's formal run, so it sorts newer and would otherwise win the match.
// Callers asking "which pipeline run is this worktree assigned to?" opt in.
// `opts.fsImpl` (#3769) is forwarded to path-guard's canonicalRealpath, which
// asks the OS for on-disk casing (`.native`): a mis-cased teardown target on a
// case-insensitive volume canonicalizes to its recorded spelling, not its own.
function findRunByWorktreePath(cwd, targetPath, opts = {}) {
  if (typeof targetPath !== 'string' || !targetPath) return null;
  function canonical(p) { return canonicalRealpath(p, { fsImpl: opts.fsImpl }); }
  const target = canonical(targetPath) || targetPath;
  for (const { dir, state } of iterRunDirsWithState(cwd)) {
    if (opts.skipAdHoc && isAdHocRunDir(dir)) continue;
    if (worktreeMatches(state, target, targetPath, canonical)) return { runDir: dir, state };
  }
  return null;
}

// Plural sibling of findRunByWorktreePath (#500): every non-terminal run
// dir — not just the first — assigned to this worktree path, newest first.
// Exists for the reflect Friction Lens's ad-hoc-session fallback
// (skills/reflect/full-mode.md): a worktree dev session that never reached a
// formal pipeline can leave behind more than one lightweight ad-hoc run dir
// (post-tool-use.js's stampAdHocRunDir, one per EnterWorktree that found no
// owned run yet) before a later /claude-tweaks:wrap-up finally reads them —
// a single first-match lookup would silently drop every ad-hoc run but the
// newest. `excludeDir`, when given, omits that one directory from the
// result (the caller's own primary/current run dir, already read via its
// normal path — never double-counted as a second source here).
// `opts.fsImpl` (#3836) is forwarded to path-guard's canonicalRealpath for the
// worktree comparison, exactly as findRunByWorktreePath's is (#3769).
function findRunsByWorktreePath(cwd, targetPath, excludeDir, opts = {}) {
  if (typeof targetPath !== 'string' || !targetPath) return [];
  function canonical(p) { return canonicalRealpath(p, { fsImpl: opts.fsImpl }); }
  const target = canonical(targetPath) || targetPath;
  // #1175: excludeDir must be realpath-canonicalized before comparing — a
  // plain path.resolve() never matches when the caller's --run was spelled
  // through a symlink (e.g. macOS /tmp, whose real path is /private/tmp), so
  // the primary run's own events were never excluded and got re-emitted
  // tagged `_source: 'adhoc'`. `dir` (from iterRunDirsWithState) is only
  // realpath'd when mainCheckoutRoot resolves a real git repo — the raw-cwd
  // fallback leaves it unresolved — so `dir` needs the same treatment at
  // comparison time too, not just excludeDir, or the two sides stay on
  // unequal footing whenever that fallback is the active path.
  let excl = excludeDir ? path.resolve(excludeDir) : null;
  if (excl) { try { excl = fs.realpathSync(excl); } catch { /* keep as-resolved */ } }
  const out = [];
  for (const { dir, state } of iterRunDirsWithState(cwd)) {
    if (excl) {
      let dirReal = path.resolve(dir);
      try { dirReal = fs.realpathSync(dirReal); } catch { /* keep as-resolved */ }
      if (dirReal === excl) continue;
    }
    if (worktreeMatches(state, target, targetPath, canonical)) out.push({ runDir: dir, state });
  }
  return out;
}

// #2783: the session-keyed sibling of findRunsByWorktreePath, for the Friction
// Lens's read side. The ordinary ad-hoc sequence ends with ExitWorktree(remove)
// BEFORE wrap-up, so wrap-up runs from the main checkout and the ad-hoc dir's
// recorded `worktree` no longer matches anything — but the dir is still
// non-terminal (reconcile sweeps it only after ADHOC_SUPERSEDED_TTL_MS) and
// still carries the owning session id. Ad-hoc dirs only: a formal run of the
// same session is a different run's record, not this session's ad-hoc friction.
// Removed worktrees only: CLAUDE_CODE_SESSION_ID is shared by every subagent of
// a session, so an id match proves nothing about ownership (docs/hooks.md's
// Ownership section). A dir whose recorded worktree still exists is skipped —
// the worktree-path lookup already covers a live one matching the target.
function findAdHocRunsBySessionId(cwd, sessionId, excludeDir) {
  if (typeof sessionId !== 'string' || !sessionId) return [];
  let excl = excludeDir ? path.resolve(excludeDir) : null;
  if (excl) { try { excl = fs.realpathSync(excl); } catch { /* keep as-resolved */ } }
  const out = [];
  for (const { dir, state } of iterRunDirsWithState(cwd)) {
    if (!isAdHocRunDir(dir)) continue;
    if (!state || state.sessionId !== sessionId) continue;
    if (typeof state.worktree === 'string' && path.isAbsolute(state.worktree) && fs.existsSync(state.worktree)) continue;
    if (excl) {
      let d = dir;
      try { d = fs.realpathSync(dir); } catch { /* keep as-listed */ }
      if (d === excl) continue;
    }
    out.push({ runDir: dir, state });
  }
  return out;
}

// True synchronous sleep (no CPU-spinning) for writeRunState's lock retry
// below — Node has no sync sleep primitive without a native/external dep,
// but blocking on a zero-length SharedArrayBuffer via Atomics.wait achieves
// the same effect. Falls back to a no-op if unavailable (e.g. a sandboxed
// environment without SharedArrayBuffer/Atomics) — the caller's own retry
// loop still eventually gives up either way.
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best-effort */ }
}

// Max total time to wait for the lock before proceeding unlocked. Overridable
// via CLAUDE_TWEAKS_LOCK_WAIT_MS when it parses as a non-negative integer —
// a test-only knob (production never sets this env var, so it always gets
// the 500ms default) that lets tests pin the budget instead of racing it.
function resolveLockWaitMs() {
  const raw = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  const n = Number(raw);
  // raw.trim() !== '' guards the JS quirk that Number('') === 0 — an empty
  // or whitespace-only value is garbage and falls back like any other.
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : 500;
}
const LOCK_WAIT_MS = resolveLockWaitMs();
const LOCK_POLL_MS = 10;
const LOCK_STALE_MS = 5000; // a lock dir older than this is treated as abandoned (holder crashed) and reclaimed

// Directory-based mutex for writeRunState's read-modify-write below.
// `fs.mkdirSync` is atomic on every platform Node supports (EEXIST if
// another writer already holds it), unlike a plain file write. Returns
// true if the lock was acquired; false means "could not acquire in time —
// proceed unlocked" (this project's own posture: never break a session
// over bookkeeping state; a missed lock just reopens the pre-existing race
// window instead of hanging a hook process indefinitely). The cause list
// reaching this fail-open path now demonstrably includes CI-runner
// contention (observed on the v6.73.0 release CI run, not just a slow local
// machine) — see CLAUDE_TWEAKS_LOCK_WAIT_MS above for the test-only knob
// that lets a test pin an effectively-unbounded budget to isolate the lock
// mechanism from this wait cap.
// #1348 checked this sibling for file-lock.js's acquireLock ENOENT-fail-open gap (#1269) and
// found it NOT reachable here: every writeRunState caller passes a `runDir` that already
// exists on disk — close-run-state.js/pre-compact.js/pre-tool-use.js/session-end.js and
// hooks.js's record-worktree/record-pr verbs all pass an already-owned, already-discovered run
// dir (resolveRunArg/resolveRunDir only ever return a directory that already exists);
// post-tool-use.js's stampAdHocRunDir passes a runDir that runDirResolve.resolve({...,
// create: true}) has just mkdirSync(..., {recursive:true})'d moments earlier; and
// archive-merged.js's archiveRunDir passes archiveDir, which it mkdirSync(...,
// {recursive:true})'d at its own top before either of its two writeRunState calls. Unlike
// declined-learning's store (N concurrent *first-ever* writers racing a parent nobody had
// created), acquireRunStateLock's ENOENT branch below is a genuine defensive fallback, not a
// live race — left unchanged deliberately, not an oversight.
function acquireRunStateLock(runDir) {
  const lockPath = path.join(runDir, '.run-state.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      return lockPath;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return null; // e.g. runDir itself doesn't exist — nothing to lock
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) { fs.rmdirSync(lockPath); continue; } // reclaim an abandoned lock, retry immediately
      } catch { /* raced with another reclaimer, or the lock is already gone — just retry below */ }
      if (Date.now() >= deadline) return null;
      sleepSync(LOCK_POLL_MS);
    }
  }
}

function releaseRunStateLock(lockPath) {
  if (!lockPath) return;
  try { fs.rmdirSync(lockPath); } catch { /* best-effort */ }
}

// Read-modify-write on run-state.json, guarded by acquireRunStateLock above.
// Two concurrent writers (e.g. a `close-run` racing session-end's own hook,
// or two record-worktree/close-run invocations against the same run dir —
// both anticipated scenarios per this file's own wd-foreign-session logic)
// previously could each read the same pre-write state and one writer's
// patch would silently overwrite the other's, e.g. resurrecting a worktree
// assignment a close-run call had just cleared.
function writeRunState(runDir, patch) {
  const lock = acquireRunStateLock(runDir);
  const finalPath = path.join(runDir, 'run-state.json');
  try {
    const next = { ...(readRunState(runDir) || {}), ...patch, updatedAt: new Date().toISOString() };
    // bin/lib/atomic-write.js's writeFileAtomic (#1653): writes a per-process
    // tmp file then fs.renameSync's atomically over the real path, so a
    // reader or a racing unlocked writer can never observe a torn/partial
    // JSON file, and a crash mid-write leaves the previous state intact
    // instead of a half-written file.
    writeFileAtomic(finalPath, JSON.stringify(next, null, 2) + '\n');
    return next;
  } catch {
    return null;
  } finally {
    releaseRunStateLock(lock);
  }
}

// #2783/#2813: resolveRun's 'fallback' arm is a GUESS — the newest unowned,
// worktree-compatible run, routinely a sibling session's *-standalone dir in a
// busy checkout. It is never this session's own run, so no write path that
// stamps or logs friction may treat it as owned.
function isTrustedOwnedRun(ownedRun) {
  return !!(ownedRun && ownedRun.dir && ownedRun.attribution !== 'fallback');
}

// #3845: owner-process identity. Measured premise (probe, Claude Code 2.1.302):
// Claude Code sets CLAUDE_PID to its own pid in every process it spawns — its
// Bash tool and its hooks alike — so one session's Bash tool and its hooks see
// the same value; a nested `claude -p` run from that Bash tool sets its own,
// different value. record-worktree stamps run-state `ownerPid` from the former;
// session-end compares the latter against it to tell a nested session from the
// run's owner. Fail open: an unknown pid on either side is never "nested", so
// a missing/garbled CLAUDE_PID or an unstamped (pre-#3845) run-state keeps the
// existing session-end behavior.
//
// Liveness rule: a differing pair is "nested" only while the owner process is
// still alive. A nested child's SessionEnd always fires while its parent is
// alive (the parent's Bash tool is blocked on the child), so the incident case
// keeps its protection. A dead owner is the crash + `claude --resume` shape: the
// original process died without a SessionEnd, the resumed process (new pid, same
// session id) never re-stamps ownerPid, and its ending is the run's real
// interruption — suppressing it would regress to a never-flagged run. Probe
// errors other than "alive" fail open (never nested, never throw from a hook).
function claudePid(env) {
  const raw = env && env.CLAUDE_PID;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) ? pid : null;
}

// The run-state patch that stamps this process as the run's owner — empty when
// the pid is unknown, so a stamp site never writes a garbled `ownerPid`. Shared
// by every site that mints or re-stamps ownership (record-worktree, the ad-hoc
// mints, the resume re-stamp in session-start.js).
function ownerPidPatch(env) {
  const pid = claudePid(env);
  return pid === null ? {} : { ownerPid: pid };
}

function isNestedSession(runState, env, { isAlive = isPidAlive } = {}) {
  const owner = runState && runState.ownerPid;
  if (!Number.isInteger(owner) || owner <= 0) return false;
  const mine = claudePid(env);
  return mine !== null && mine !== owner && isAlive(owner);
}

// `{ts}-adhoc-standalone` — the suffix run-dir-resolve.js mints for
// `standalone: 'adhoc'` (post-tool-use.js's stampAdHocRunDir and
// stampAdHocRunDirForDenial). Same test as reconcile/archive-merged.js's
// isAdHocStandaloneMint's first clause.
function isAdHocRunDir(dir) {
  return typeof dir === 'string' && path.basename(dir).endsWith('-adhoc-standalone');
}

// Ad-hoc run-dir stamping for a PreToolUse gate denial with no owned run dir
// yet (#2351). post-tool-use.js's own stampAdHocRunDir (the #500/#1333
// mechanism) fires only on an EnterWorktree call or a session's cwd resolving
// to a NON-main worktree — deliberately excluding the main checkout, since
// firing on every ordinary main-checkout hook call would be pure noise. A
// gate denial is a narrower, safer trigger: it only fires when a real deny is
// about to be logged, so it can cover the main checkout too without that
// noise risk — a session running /claude-tweaks:wrap-up entirely in the main
// checkout (no worktree at all) still needs its wd-deny/gate-denial events to
// land somewhere (friction-events.js's Friction Lens input), or appendEvent's
// own null-runDir no-op silently drops them, exactly the gap two real
// denials (a push deny, a teardown-gate deny) hit in run
// 2026-09-13T101924-dispatch-drain-merge-release-v6123-standalone.
//
// Called from pre-tool-use.js's own denial sites, immediately before an
// appendEvent call whose target dir would otherwise be null. Mirrors
// stampAdHocRunDir's own minting mechanics (runDirResolve + writeRunState +
// the same-session collision guard) but keys the `worktree` field on
// whatever `ctx.cwd` resolves to in `git worktree list`, main checkout
// included, rather than excluding it — the narrower trigger above is what
// makes that safe.
function stampAdHocRunDirForDenial(ctx) {
  if (isTrustedOwnedRun(ctx.ownedRun)) return ctx.ownedRun.dir;
  const sessionId = ctx.input && ctx.input.session_id;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const cwd = ctx.cwd;
  if (typeof cwd !== 'string' || !cwd) return null;
  try {
    const { stdout, failure } = runGit(['worktree', 'list', '--porcelain'], cwd);
    if (failure || stdout === null) return null;
    const entries = parseWorktreeList(stdout);
    const idx = entries.findIndex((e) => e.path === cwd);
    if (idx === -1) return null; // cwd isn't a listed worktree at all — nothing to key the stamp on
    const worktreePath = entries[idx].path;
    // Deliberately NOT process.env — a stray PIPELINE_RUN_DIR left over from
    // an unrelated earlier command in this shell must never redirect this
    // stamp onto someone else's run dir (same rationale as stampAdHocRunDir).
    const result = runDirResolve.resolve({ cwd, env: {}, create: true, standalone: 'adhoc' });
    if (!result.ok) return null;
    // Never let this stamp clobber a DIFFERENT session's already-written
    // ownership on a same-second sibling-session collision (mirrors
    // stampAdHocRunDir's identical guard).
    const existing = readRunState(result.path);
    if (existing && typeof existing.sessionId === 'string' && existing.sessionId && existing.sessionId !== sessionId) return null;
    const written = writeRunState(result.path, { worktree: path.resolve(worktreePath), status: 'active', sessionId, ...ownerPidPatch(process.env) });
    if (!written) { rollbackMint(result.path); return null; }
    return result.path;
  } catch { return null; }
}

// The one resolver every pre-tool-use denial site uses (#2783): trusted owned
// run first; else mint a session-owned ad-hoc dir; only when minting is
// impossible (cwd not a listed worktree, no session id) fall back to the guess,
// keeping its 'fallback' attribution so appendEvent stamps it as a guess.
// A fresh mint carries no attribution — it is this session's own run.
function resolveDenialRunDir(ctx) {
  const ownedRun = (ctx && ctx.ownedRun) || {};
  if (isTrustedOwnedRun(ownedRun)) return { dir: ownedRun.dir, attribution: ownedRun.attribution };
  const stamped = stampAdHocRunDirForDenial(ctx);
  if (stamped) return { dir: stamped, attribution: undefined };
  return { dir: ownedRun.dir || null, attribution: ownedRun.attribution };
}

// #1737: the raw read-and-parse both events.jsonl consumers in this codebase
// implement inline — read the file, split lines, skip blanks, JSON.parse each,
// skip unparseable ones. `null` (absent or unreadable file) and `[]` (readable
// but empty, or readable with every line unparseable) stay distinguishable —
// callers that need to tell "we don't know" from "we know there's nothing"
// (run-integrity.js's checkRunIntegrity via scanWrapupEvents below,
// archive-merged.js's ownEventRecency) rely on that split.
function readEventLines(runDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { return null; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    out.push(ev);
  }
  return out;
}

// events.jsonl scan for skill_invoked / claude-tweaks:wrap-up events; missing
// file or unreadable -> null (indeterminate). Shared by run-integrity.js's
// checkRunIntegrity and close-run-state.js's closeRunState — the single
// reader for the paired appendEvent writer above (#380).
const WRAP_UP_SKILL = 'claude-tweaks:wrap-up';
function scanWrapupEvents(runDir) {
  const lines = readEventLines(runDir);
  if (lines === null) return null;
  let any = false;
  let wrapup = false;
  for (const ev of lines) {
    if (!ev || ev.type !== 'skill_invoked') continue;
    any = true;
    if (ev.skill === WRAP_UP_SKILL) wrapup = true;
  }
  return { any, wrapup };
}

function appendEvent(runDir, type, data, attribution) {
  try {
    // Derived/trusted fields (ts, type) spread LAST so they always win —
    // never spread caller-supplied `data` after them (see CLAUDE.md's
    // "Don't spread parsed external JSON after derived/trusted fields"). No
    // current call site passes a `data` object containing `ts`/`type` keys,
    // but nothing enforced that invariant before; a future call site
    // spreading a richer/less-curated object could otherwise silently
    // overwrite this event's own classification or timestamp.
    // `attribution` is stamped only when the run was a guess (#62). Its absence
    // means the run was named by PIPELINE_RUN_DIR or claims this session as its
    // owner; its presence marks the line as evidence that may belong to another
    // session, so a reader auditing a contaminated events.jsonl can filter on it
    // rather than having to reconstruct which worktree each commit came from.
    const guessed = attribution === 'fallback' ? { attribution } : null;
    const line = JSON.stringify({ ...(data || {}), ...guessed, ts: new Date().toISOString(), type });
    fs.appendFileSync(path.join(runDir, 'events.jsonl'), line + '\n');
  } catch { /* best-effort */ }
}

module.exports = {
  readStdin, parseInput, resolveRun, resolveRunDir, classifyOwnership, listRunDirs, listRunDirsWithState, iterRunDirsWithState,
  readRunState, readRunStateWithParent, writeRunState, appendEvent, scanWrapupEvents, readEventLines, findRunByWorktreePath, findRunsByWorktreePath, findAdHocRunsBySessionId, RUN_ID_RE, findNonCanonicalRunDirs,
  rollbackMint, isStaleClaim, stampAdHocRunDirForDenial, isTrustedOwnedRun, isAdHocRunDir, resolveDenialRunDir,
  claudePid, ownerPidPatch, isPidAlive, isNestedSession,
};
