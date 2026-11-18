// bin/lib/release-state/marker.js
// The "reviewed through" marker /release keeps on the `release-state` branch (#5883):
// its frozen file shape, and the first-parent descent check every marker move is judged
// by. The marker only ever moves forward along the integration branch's first-parent
// line; a sha merged in through a second parent is an ancestor of the branch but was
// never its tip, so it is `off-line`, not a descendant (merge-shape-landed-proof).
//
// Two histories answer the descent question, and both spawn nothing themselves:
//   * local   `git(args, {input, extraEnv} = {})` -> stdout, throws on failure (the store's
//             gitRunner contract), the thrown error carrying the child's exit code as
//             `.status` (execFileSync's shape): `isAncestor` reads exit 1 as "not an
//             ancestor" and any other failure as undetermined. Fetches the branch into a
//             scratch ref, then reads the first-parent line with `rev-list`, and the
//             direction with `merge-base
//             --is-ancestor`. A shallow clone answers every question whose shas it holds;
//             only a miss there is `undetermined`, never `orphaned` or `off-line`, because
//             the answer may sit below the shallow boundary.
//   * compare `ghApi(args)` -> {stdout, failure, status, error?}, never throws (the
//             caller has already appended any `--hostname`). Reads the branch tip, then
//             walks `parents[0]` through the REST compare listing of `{base}...{tip}`.
//             The tip read happens first, so a compare 404 (an unknown base) comes from a
//             repository that just answered, never from one the token cannot see.
// `createHistory` is the ladder: local first, compare only when local is undetermined.
//
// Every failure resolves to `undetermined` (exit 5), never to a verdict that refuses or
// resets. Each history object takes one snapshot of the branch and refreshes it once on a
// membership miss: a competitor's advance can name a commit newer than the snapshot, and
// that must read as a descendant, never as orphaned.
//
// The three operations (`advanceMarker`, `initMarker`, `resetMarker`) take
// `ctx = { store: { read, write, create }, history, now }` (`storeFacade` binds the store) and
// return `{ outcome, ... }` with `outcome` one of OUTCOMES, which the CLI maps to its exit
// codes. A bad argument is a caller bug and throws TypeError before anything is read.
'use strict';

const { refusalText } = require('../issues/claim-store');
const { errText } = require('../issues/claims-git-cas');
const {
  RELEASE_STATE_BRANCH, MESSAGE_RE, readStateFile, writeStateFile, createStateFile,
} = require('./store');

const MARKER_FILE = 'reviewed-through.json';
const MARKER_VERSION = 1;
const SHA_RE = /^[0-9a-f]{40}$/;
const RUN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REASON_RE = /^[^\r\n#]{1,200}$/;
const INIT_RUN = 'init';
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const VERDICTS = Object.freeze(['descendant', 'same', 'backward', 'off-line', 'orphaned', 'undetermined']);

const NO_HISTORY = 'no local clone and gh unavailable';
const SCRATCH_REF_PREFIX = 'refs/release-state-history';
const COMPARE_PER_PAGE = 100;
const MAX_COMPARE_PAGES = 100;
const COMPARE_Q = '{status, total_commits, commits: [.commits[] | {sha, parents: [.parents[].sha]}]}';
const COMPARE_STATUSES = new Set(['identical', 'ahead', 'behind', 'diverged']);

const short = (sha) => String(sha).slice(0, 12);

// ---- shape ----

// (parsed JSON value) -> { marker: {version, sha, advancedAt, run} } | { error }
// Exactly the four keys, any others ignored; every other shape is an error, never a marker.
function parseMarker(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { error: 'the marker is not a JSON object' };
  const {
    version, sha, advancedAt, run,
  } = value;
  if (version !== MARKER_VERSION) return { error: `the marker version is ${JSON.stringify(version)}, not ${MARKER_VERSION}` };
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) return { error: `the marker sha ${JSON.stringify(sha)} is not 40 lowercase hex` };
  if (typeof advancedAt !== 'string' || !ISO_UTC_RE.test(advancedAt) || !Number.isFinite(Date.parse(advancedAt))) {
    return { error: `the marker advancedAt ${JSON.stringify(advancedAt)} is not an ISO-8601 UTC time` };
  }
  if (typeof run !== 'string' || !(RUN_RE.test(run) || run === INIT_RUN)) return { error: `the marker run ${JSON.stringify(run)} is not a run id` };
  return {
    marker: {
      version, sha, advancedAt, run,
    },
  };
}

// -> the file's exact bytes. Throws TypeError on a marker a reader would refuse, so a
// writer can never store one.
function serializeMarker({ sha, advancedAt, run }) {
  const parsed = parseMarker({
    version: MARKER_VERSION, sha, advancedAt, run,
  });
  if (parsed.error) throw new TypeError(`release-state marker: ${parsed.error}`);
  return `${JSON.stringify(parsed.marker, null, 2)}\n`;
}

// ---- verdicts (pure) ----

// (from, to, { line: Set of first-parent shas, complete, isAncestor(a, b) -> true|false|'undetermined' })
// -> { verdict, reason }. An incomplete (shallow) line turns every membership miss into
// `undetermined`.
function descentVerdict(from, to, { line, complete, isAncestor }) {
  if (!line.has(from)) {
    return complete
      ? { verdict: 'orphaned', reason: `${short(from)} is not on the first-parent line` }
      : { verdict: 'undetermined', reason: `${short(from)} is not in the shallow history; it may be below the boundary` };
  }
  if (to === from) return { verdict: 'same', reason: `${short(to)} is the marker itself` };
  if (!line.has(to)) {
    return complete
      ? { verdict: 'off-line', reason: `${short(to)} is not on the first-parent line` }
      : { verdict: 'undetermined', reason: `${short(to)} is not in the shallow history; it may be below the boundary` };
  }
  const ancestor = isAncestor(from, to);
  if (ancestor === true) return { verdict: 'descendant', reason: `${short(to)} descends from ${short(from)} on the first-parent line` };
  if (ancestor === false) return { verdict: 'backward', reason: `${short(to)} is older than ${short(from)} on the first-parent line` };
  return { verdict: 'undetermined', reason: `could not tell whether ${short(from)} is an ancestor of ${short(to)}` };
}

// The compare listing of `{base}...{tip}` -> { kind: 'identical' } | { kind: 'walked', path }
// | { kind: 'orphaned', reason } | { kind: 'undetermined', reason }. `path` holds every sha
// from `tip` down to (not including) `base`, following `parents[0]` only.
function walkFirstParent(base, { tip, compare }) {
  if (compare && compare.notFound) return { kind: 'orphaned', reason: `the compare API does not know ${short(base)} on this branch (HTTP 404)` };
  const ok = compare && COMPARE_STATUSES.has(compare.status) && Number.isInteger(compare.total_commits)
    && compare.total_commits >= 0 && Array.isArray(compare.commits);
  if (!ok) return { kind: 'undetermined', reason: 'the compare answer is not {status, total_commits, commits}' };
  const { status, total_commits: total, commits } = compare;
  if (status === 'identical') {
    return total === 0 && commits.length === 0
      ? { kind: 'identical' }
      : { kind: 'undetermined', reason: 'the compare answer is identical but lists commits' };
  }
  if (status !== 'ahead') return { kind: 'orphaned', reason: `${short(base)} is ${status} the branch tip, not on its line` };
  if (commits.length < total) return { kind: 'undetermined', reason: `the compare API listed ${commits.length} of ${total} commits` };
  // Every listed sha and every parent must be a full sha: a malformed entry would otherwise
  // end the walk early and read as orphaned. An empty `parents` is a root commit, where a
  // first-parent walk legitimately ends.
  const isSha = (s) => typeof s === 'string' && SHA_RE.test(s);
  const bySha = new Map();
  for (const c of commits) {
    if (!c || !isSha(c.sha) || !Array.isArray(c.parents) || !c.parents.every(isSha)) {
      return { kind: 'undetermined', reason: 'a listed commit is not {sha, parents} with full shas' };
    }
    bySha.set(c.sha, c.parents);
  }
  const path = new Set();
  let cur = tip;
  while (cur !== base) {
    if (path.has(cur)) return { kind: 'undetermined', reason: 'the compare listing loops' };
    const parents = bySha.get(cur);
    if (!parents) return { kind: 'orphaned', reason: `the first-parent walk from the tip leaves the range before reaching ${short(base)}` };
    path.add(cur);
    [cur] = parents;
  }
  return { kind: 'walked', path };
}

// (from, to, { tip, compare }) -> { verdict, reason }, with `compare` the listing of
// `{from}...{tip}`. An older first-parent `to` is not listed, so it reads `off-line` where
// the local history says `backward`; both refuse.
function compareVerdict(from, to, { tip, compare }) {
  const w = walkFirstParent(from, { tip, compare });
  if (w.kind === 'undetermined' || w.kind === 'orphaned') return { verdict: w.kind, reason: w.reason };
  if (to === from) return { verdict: 'same', reason: `${short(to)} is the marker itself` };
  if (w.kind === 'walked' && w.path.has(to)) return { verdict: 'descendant', reason: `${short(to)} descends from ${short(from)} on the first-parent line` };
  return { verdict: 'off-line', reason: `${short(to)} is not on the first-parent line past ${short(from)}` };
}

// (sha, { tip, compare }) -> true | false | 'undetermined', with `compare` the listing of
// `{sha}...{tip}`.
function compareOnLine(sha, { tip, compare }) {
  const w = walkFirstParent(sha, { tip, compare });
  if (w.kind === 'undetermined') return 'undetermined';
  return w.kind !== 'orphaned';
}

// ---- histories ----

const isMissVerdict = (r) => r.verdict === 'orphaned' || r.verdict === 'off-line' || r.verdict === 'undetermined';
const gitFailure = (err) => refusalText(errText(err)).split('\n').join('; ') || String(err);

// ({ git, branch }) -> { verdict(from, to), onLine(sha) }
function createLocalHistory({ git, branch = 'main' }) {
  let snapshot = null;
  let refreshed = false;

  // -> { tip, complete, line } | { undetermined }. A per-call scratch ref, deleted whatever
  // happens, and `--no-write-fetch-head`: FETCH_HEAD is one shared pointer a concurrent
  // fetch can overwrite, so this read neither uses nor clobbers it.
  const load = () => {
    const scratch = `${SCRATCH_REF_PREFIX}/${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      try {
        // Fully qualified: a same-named tag must not shadow the branch.
        git(['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${scratch}`]);
      } catch (err) {
        return { undetermined: `fetch failed — ${gitFailure(err)}` };
      }
      try {
        const tip = git(['rev-parse', '--verify', '--end-of-options', scratch]).trim();
        const complete = git(['rev-parse', '--is-shallow-repository']).trim() !== 'true';
        const listed = git(['rev-list', '--first-parent', '--end-of-options', tip, '--']);
        const line = new Set(listed.split('\n').map((s) => s.trim()).filter(Boolean));
        return { tip, complete, line };
      } catch (err) {
        return { undetermined: `could not read the fetched ${branch} line — ${gitFailure(err)}` };
      }
    } finally {
      try { git(['update-ref', '-d', scratch]); } catch { /* best-effort cleanup, never masks the read's own outcome */ }
    }
  };

  // The snapshot, refreshed once per history object when a sha misses a snapshot an
  // earlier call took (never on the call that took it). A failed refresh answers the miss
  // that triggered it as undetermined (the fresh state is unknown) and keeps the previous
  // snapshot for every later call.
  const snapshotFor = (shas) => {
    if (!snapshot) {
      snapshot = load();
      return snapshot;
    }
    if (!refreshed && !snapshot.undetermined && shas.some((s) => !snapshot.line.has(s))) {
      refreshed = true;
      const next = load();
      if (next.undetermined) return next;
      snapshot = next;
    }
    return snapshot;
  };

  const isAncestor = (a, b) => {
    try {
      git(['merge-base', '--is-ancestor', '--end-of-options', a, b]);
      return true;
    } catch (err) {
      return err && err.status === 1 ? false : 'undetermined';
    }
  };

  return {
    verdict(from, to) {
      const snap = snapshotFor([from, to]);
      if (snap.undetermined) return { verdict: 'undetermined', reason: snap.undetermined };
      return descentVerdict(from, to, { line: snap.line, complete: snap.complete, isAncestor });
    },
    onLine(sha) {
      const snap = snapshotFor([sha]);
      if (snap.undetermined) return { undetermined: snap.undetermined };
      if (snap.line.has(sha)) return { onLine: true };
      return snap.complete
        ? { onLine: false }
        : { undetermined: `${short(sha)} is not in the shallow history; it may be below the boundary` };
    },
  };
}

const ghFailure = (r) => refusalText(r.error).split('\n').join('; ') || r.failure || (r.status ? `HTTP ${r.status}` : 'network-failure');

// ({ ghApi, slug, branch }) -> { verdict(from, to), onLine(sha) }
function createCompareHistory({ ghApi, slug, branch = 'main' }) {
  // A ref name in a REST path is encoded per segment: `#` and `%` are legal in a branch.
  const tipPath = `repos/${slug}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
  let tipRead = null;
  let refreshed = false;
  const listings = new Map();

  // -> { tip } | { undetermined }. A 404 here is a missing branch or a repository the token
  // cannot see: either way not something to judge a marker against.
  const readTip = () => {
    const r = ghApi([tipPath, '-q', '.object.sha']);
    if (r.failure || r.status) return { undetermined: `could not read the tip of ${branch} — ${ghFailure(r)}` };
    const tip = String(r.stdout || '').trim();
    if (!SHA_RE.test(tip)) return { undetermined: `the tip of ${branch} read back as ${JSON.stringify(tip)}, not a sha` };
    return { tip };
  };

  // -> { notFound: true } | { status, total_commits, commits } | { undetermined }
  const readListing = (base, tip) => {
    // The base goes into a REST path: only a full sha may.
    if (typeof base !== 'string' || !SHA_RE.test(base)) throw new TypeError(`release-state marker: compare base must be a 40-hex sha, got ${JSON.stringify(base)}`);
    let first = null;
    const commits = [];
    for (let n = 1; n <= MAX_COMPARE_PAGES; n += 1) {
      const r = ghApi([`repos/${slug}/compare/${base}...${tip}?per_page=${COMPARE_PER_PAGE}&page=${n}`, '-q', COMPARE_Q]);
      if (r.status === 404 && n === 1) return { notFound: true };
      if (r.failure || r.status) return { undetermined: `the compare read failed — ${ghFailure(r)}` };
      let page;
      try {
        page = JSON.parse(r.stdout);
      } catch {
        page = null;
      }
      if (!page || !Array.isArray(page.commits)) return { undetermined: 'the compare answer is not {status, total_commits, commits}' };
      if (!first) first = page;
      commits.push(...page.commits);
      const total = first.total_commits;
      if (!Number.isInteger(total) || page.commits.length === 0 || commits.length >= total) {
        return { status: first.status, total_commits: total, commits };
      }
    }
    return { undetermined: `the compare listing runs past ${MAX_COMPARE_PAGES} pages` };
  };

  // Answers `judge(listing, tip)` for `base`; on a miss, re-reads the tip once per history
  // object (never on the call that first read it) and answers again when it moved. A failed
  // re-read answers that miss as undetermined and keeps the previous tip and listings.
  const answer = (base, judge, isMiss) => {
    let fresh = false;
    if (!tipRead) {
      tipRead = readTip();
      fresh = true;
    }
    for (;;) {
      if (tipRead.undetermined) return { undetermined: tipRead.undetermined };
      if (!listings.has(base)) listings.set(base, readListing(base, tipRead.tip));
      const listing = listings.get(base);
      if (listing.undetermined) return { undetermined: listing.undetermined };
      const result = judge(listing, tipRead.tip);
      if (fresh || refreshed || !isMiss(result)) return { result };
      refreshed = true;
      const next = readTip();
      if (next.undetermined) return { undetermined: next.undetermined };
      if (next.tip === tipRead.tip) return { result };
      tipRead = next;
      listings.clear();
    }
  };

  return {
    verdict(from, to) {
      const a = answer(from, (compare, tip) => compareVerdict(from, to, { tip, compare }), isMissVerdict);
      return a.undetermined ? { verdict: 'undetermined', reason: a.undetermined } : a.result;
    },
    onLine(sha) {
      const a = answer(sha, (compare, tip) => compareOnLine(sha, { tip, compare }), (on) => on !== true);
      if (a.undetermined) return { undetermined: a.undetermined };
      if (a.result === 'undetermined') return { undetermined: `could not walk the first-parent line to ${short(sha)}` };
      return { onLine: a.result };
    },
  };
}

// ({ local?, compare? }) -> { verdict(from, to), onLine(sha) }: the local answer, unless it
// is undetermined and a compare history exists.
function createHistory({ local, compare } = {}) {
  return {
    verdict(from, to) {
      const l = local ? local.verdict(from, to) : null;
      if (l && (l.verdict !== 'undetermined' || !compare)) return l;
      if (!compare) return { verdict: 'undetermined', reason: NO_HISTORY };
      const c = compare.verdict(from, to);
      return l && c.verdict === 'undetermined' ? { verdict: 'undetermined', reason: `local: ${l.reason}; compare: ${c.reason}` } : c;
    },
    onLine(sha) {
      const l = local ? local.onLine(sha) : null;
      if (l && (!('undetermined' in l) || !compare)) return l;
      if (!compare) return { undetermined: NO_HISTORY };
      const c = compare.onLine(sha);
      return l && 'undetermined' in c ? { undetermined: `local: ${l.undetermined}; compare: ${c.undetermined}` } : c;
    },
  };
}

// ---- operations ----

const OUTCOMES = Object.freeze(['ok', 'refused', 'unreadable', 'contested', 'insufficient-history', 'orphaned']);

// A verdict that ends an advance before any write. An unknown verdict fails closed.
const VERDICT_STOPS = Object.freeze({
  orphaned: 'orphaned', undetermined: 'insufficient-history', backward: 'refused', 'off-line': 'refused',
});

const NO_MARKER = 'no marker — run marker init';
// Absent on the re-read after a lost compare-and-set: a competitor removed the marker, so
// "run marker init" would be the wrong advice.
const MARKER_VANISHED = 'the marker disappeared after a lost compare-and-set — another writer removed it; read it again before acting';

// (deps: {ghApi, gitRunner?, sleep?}, slug, name) -> ctx.store: the store's read,
// compare-and-set write and create, bound to one file.
function storeFacade(deps, slug, name = MARKER_FILE) {
  return {
    read: () => readStateFile(deps, slug, name),
    write: (args) => writeStateFile(deps, slug, name, args),
    create: (args) => createStateFile(deps, slug, name, args),
  };
}

function assertSha(sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new TypeError(`release-state marker: --to must be 40 lowercase hex, got ${JSON.stringify(sha)}`);
}

function assertRun(run) {
  if (typeof run !== 'string' || !RUN_RE.test(run) || run === INIT_RUN) {
    throw new TypeError(`release-state marker: --run must match ${RUN_RE} and is never "${INIT_RUN}", got ${JSON.stringify(run)}`);
  }
}

const markerContent = (ctx, sha, run) => serializeMarker({ sha, advancedAt: ctx.now().toISOString(), run });

// A store write result that is neither ok nor a conflict -> its reason (the outcome is
// unreadable: a refused push and PUT, an uncreatable or vanished branch).
function writeFailure(w) {
  if (w.branchMissing) return `the ${RELEASE_STATE_BRANCH} branch is missing`;
  return w.reason || w.failure || 'the write failed';
}

// -> { read, marker } | { stop: an outcome result }. Absent is `absent` (default: refused,
// there is nothing to advance; the re-read after a lost write passes a contested one); a
// transport failure, and bytes that are not a marker, are unreadable.
function readMarker(store, absent = { outcome: 'refused', reason: NO_MARKER }) {
  const read = store.read();
  if (read.state === 'unreadable') return { stop: { outcome: 'unreadable', reason: read.reason } };
  if (read.state === 'absent') return { stop: { ...absent } };
  const parsed = parseMarker(read.value);
  if (parsed.error) return { stop: { outcome: 'unreadable', reason: parsed.error } };
  return { read, marker: parsed.marker };
}

// The one at-or-past rule, shared by advanceMarker's lost-write re-read and the emit path's
// `recheckAfterConflict`: a marker `fresh` is at or past `to` when it is `to`, or `to` is an
// ancestor of it along the first-parent line.
function isAtOrPast(ctx, to, fresh) {
  return fresh === to || ctx.history.verdict(to, fresh).verdict === 'descendant';
}

// (ctx, { to }) -> an ok at-or-past result | { outcome: 'contested', reason } | null.
// The emit path's stand-in for advanceMarker's lost-write re-read (the agent, not the CLI, made
// the write that lost): `ctx.store` reads the marker the agent just re-fetched. A marker at or
// past `to` is success with no write; a vanished one is contested; anything else (behind
// `to`, unreadable, malformed) is null, and the caller runs the normal advance over it.
function recheckAfterConflict(ctx, { to } = {}) {
  assertSha(to);
  const again = readMarker(ctx.store, { outcome: 'contested', reason: MARKER_VANISHED });
  if (again.stop) return again.stop.outcome === 'contested' ? again.stop : null;
  const fresh = again.marker.sha;
  if (!isAtOrPast(ctx, to, fresh)) return null;
  return {
    outcome: 'ok', advanced: false, sha: fresh, reason: 'at-or-past',
  };
}

// (ctx, { to, run }) -> { outcome: 'ok', advanced: true, from, to }
//  | { outcome: 'ok', advanced: false, sha, reason: 'same' | 'at-or-past' } | { outcome, reason }
// Forward-only along the first-parent line, with at most two compare-and-set writes. A lost
// write re-reads: a marker a competitor moved to or past `to` is success with no write.
// After the first lost write anything else is judged again from scratch (never a blind write
// on the fresh lease; a marker that vanished is contested, not refused: a competing writer
// changed the state, the target is not bad); after the second, anything else (an unreadable
// or vanished marker, an undetermined verdict) is contested.
//
// `ctx.history` is this operation's own, never one an earlier operation used: the at-or-past
// check below relies on the history's one snapshot refresh being unspent when the operation
// starts. The CLI builds a fresh history for every operation it runs, a recheck included.
function advanceMarker(ctx, { to, run } = {}) {
  assertSha(to);
  assertRun(run);
  let cur = readMarker(ctx.store);
  if (cur.stop) return cur.stop;
  for (let pass = 1; ; pass += 1) {
    const { read, marker } = cur;
    const v = ctx.history.verdict(marker.sha, to);
    if (v.verdict === 'same') {
      return {
        outcome: 'ok', advanced: false, sha: marker.sha, reason: 'same',
      };
    }
    if (v.verdict !== 'descendant') {
      // Own keys only: a verdict such as 'constructor' must not resolve through the prototype.
      const outcome = Object.hasOwn(VERDICT_STOPS, v.verdict) ? VERDICT_STOPS[v.verdict] : 'insufficient-history';
      return { outcome, reason: v.reason };
    }
    const w = ctx.store.write({
      content: markerContent(ctx, to, run),
      lease: read.lease,
      via: read.via,
      expectedContent: read.content,
      message: `Advance reviewed-through to ${short(to)} from ${short(marker.sha)} — run ${run}`,
    });
    if (w.ok) {
      return {
        outcome: 'ok', advanced: true, from: marker.sha, to,
      };
    }
    if (!w.conflict) return { outcome: 'unreadable', reason: writeFailure(w) };
    // A marker gone on the re-read is a competing writer's change, not a bad target.
    const again = readMarker(ctx.store, { outcome: 'contested', reason: MARKER_VANISHED });
    // A competitor may have advanced to a commit newer than the history's snapshot of the
    // branch, which only the history's one refresh can see. After the first
    // lost write that refresh is still unspent here: pass 1's verdict took the snapshot (the
    // call that takes it never refreshes), and a pass-1 verdict that missed the snapshot is
    // orphaned, off-line or undetermined, each of which ended the operation above before any
    // write. So the first conflict, and this check, only ever follow a pass whose shas were
    // all in the snapshot. After the second lost write the refresh may be spent; a marker past
    // the snapshot then reads as not at-or-past, which is contested, never orphaned.
    if (!again.stop) {
      const fresh = again.marker.sha;
      if (isAtOrPast(ctx, to, fresh)) {
        return {
          outcome: 'ok', advanced: false, sha: fresh, reason: 'at-or-past',
        };
      }
    }
    if (pass === 2) return { outcome: 'contested', reason: `the marker moved again while advancing to ${short(to)}` };
    if (again.stop) return again.stop;
    cur = again;
  }
}

// (ctx, { to }) -> { outcome: 'ok', initialized: true, sha } | { outcome, reason }
// Creates the marker (and the branch, when missing) at an on-line `to`, with run "init".
function initMarker(ctx, { to } = {}) {
  assertSha(to);
  const on = ctx.history.onLine(to);
  if ('undetermined' in on) return { outcome: 'insufficient-history', reason: on.undetermined };
  if (!on.onLine) return { outcome: 'refused', reason: `${short(to)} is not on the first-parent line` };
  const c = ctx.store.create({ content: markerContent(ctx, to, INIT_RUN), message: `Initialize reviewed-through at ${short(to)}` });
  if (c.ok) return { outcome: 'ok', initialized: true, sha: to };
  if (c.exists) return { outcome: 'refused', reason: 'a marker already exists — use marker advance, or marker reset to recover' };
  return { outcome: 'unreadable', reason: writeFailure(c) };
}

// The basis a reset logs: a forced reset always logs the operator's reason,
// whatever the marker's line state; `orphaned` is only the basis of an unforced reset.
const resetBasisText = (force, reason) => (force ? `forced: ${reason}` : 'orphaned');
const resetMessage = (fromLabel, to, run, basisText) => `Reset reviewed-through from ${fromLabel} to ${short(to)} — run ${run} — ${basisText}`;

// ({ run, force, reason }) -> { fits, length }: whether the longest reset commit message
// these arguments can compose (a 12-char `from` and `to`) fits the store's commit-message
// rule. `resetMarker` throws when it does not; the CLI calls this first, so an
// overlong run id or reason is a usage error, never a write that fails as unreadable.
function resetMessageFits({ run, force = false, reason } = {}) {
  const longest = resetMessage('0'.repeat(12), '0'.repeat(40), run, resetBasisText(force, reason));
  return { fits: MESSAGE_RE.test(longest), length: longest.length };
}

// (ctx, { to, run, force, reason }) -> { outcome: 'ok', reset: true, from, to, basis }
//  | { outcome, from, reason }, with `from` the old marker's sha, or null when there was no
// readable marker. The guarded recovery: without `force` the marker must be orphaned
// (basis `orphaned`); with `force` and a logged reason any readable or unreadable-bytes
// marker is overwritten (basis `forced`) and its line state is not consulted. The target
// must be on the line; one write, and a lost one is contested, never retried.
function resetMarker(ctx, {
  to, run, force = false, reason,
} = {}) {
  assertSha(to);
  assertRun(run);
  if (force && (typeof reason !== 'string' || !REASON_RE.test(reason))) {
    throw new TypeError(`release-state marker: a forced reset needs a --reason matching ${REASON_RE}, got ${JSON.stringify(reason)}`);
  }
  const fit = resetMessageFits({ run, force, reason });
  if (!fit.fits) {
    throw new TypeError(`release-state marker: the reset commit message would be ${fit.length} characters, over the store's 200-character budget — shorten --run or --reason`);
  }

  const read = ctx.store.read();
  if (read.state === 'absent') return { outcome: 'refused', from: null, reason: NO_MARKER };
  // A transport failure carries no bytes and no lease: there is nothing a reset could replace.
  if (read.state === 'unreadable' && typeof read.content !== 'string') return { outcome: 'unreadable', from: null, reason: read.reason };
  const parsed = read.state === 'present' ? parseMarker(read.value) : { error: read.reason };
  const from = parsed.error ? null : parsed.marker.sha;
  if (parsed.error && !force) return { outcome: 'unreadable', from: null, reason: `${parsed.error} — pass --force --reason to overwrite it` };
  if (!force) {
    const on = ctx.history.onLine(from);
    if ('undetermined' in on) return { outcome: 'insufficient-history', from, reason: on.undetermined };
    if (on.onLine) return { outcome: 'refused', from, reason: `the marker ${short(from)} is not orphaned (it is on the first-parent line) — pass --force --reason to reset it anyway` };
  }
  const basis = force ? 'forced' : 'orphaned';
  const target = ctx.history.onLine(to);
  if ('undetermined' in target) return { outcome: 'insufficient-history', from, reason: target.undetermined };
  if (!target.onLine) return { outcome: 'refused', from, reason: `${short(to)} is not on the first-parent line` };
  const w = ctx.store.write({
    content: markerContent(ctx, to, run),
    lease: read.lease,
    via: read.via,
    expectedContent: read.content,
    message: resetMessage(from ? short(from) : 'unreadable', to, run, resetBasisText(force, reason)),
  });
  if (w.ok) {
    return {
      outcome: 'ok', reset: true, from, to, basis,
    };
  }
  if (w.conflict) return { outcome: 'contested', from, reason: 'the marker changed after it was read — read it again before resetting' };
  return { outcome: 'unreadable', from, reason: writeFailure(w) };
}

module.exports = {
  MARKER_FILE,
  MARKER_VERSION,
  SHA_RE,
  RUN_RE,
  REASON_RE,
  INIT_RUN,
  ISO_UTC_RE,
  VERDICTS,
  parseMarker,
  serializeMarker,
  descentVerdict,
  compareVerdict,
  compareOnLine,
  createLocalHistory,
  createCompareHistory,
  createHistory,
  OUTCOMES,
  storeFacade,
  advanceMarker,
  isAtOrPast,
  recheckAfterConflict,
  initMarker,
  resetMarker,
  resetMessageFits,
};
