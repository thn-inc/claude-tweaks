// bin/lib/release-state/marker.js
// The "reviewed through" marker /release keeps on the `release-state` branch (#5883):
// its frozen file shape, and the first-parent descent check every marker move is judged
// by. The marker only ever moves forward along the integration branch's first-parent
// line; a sha merged in through a second parent is an ancestor of the branch but was
// never its tip, so it is `off-line`, not a descendant (merge-shape-landed-proof).
//
// Two histories answer the descent question, and both spawn nothing themselves:
//   * local   `git(args, {input, extraEnv} = {})` -> stdout, throws on failure (the store's
//             gitRunner contract). Fetches the branch into a scratch ref, then reads the
//             first-parent line with `rev-list`, and the direction with `merge-base
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
// that must read as a descendant, never as orphaned (Review Focus 1).
'use strict';

const { refusalText } = require('../issues/claim-store');
const { errText } = require('../issues/claims-git-cas');

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
};
