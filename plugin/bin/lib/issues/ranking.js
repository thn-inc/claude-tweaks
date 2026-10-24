// bin/lib/issues/ranking.js
// Pure: "what should I build next" ranking, shared by /claude-tweaks:backlog's
// overview mode and /claude-tweaks:help's Priority Order/Tie-Breaking (extracted
// from /help's prose-only rules so both consumers compute the identical order).
// Tie-break order: priority band (high first) -> unblocks-count (most other
// candidates in the same input array it unblocks, first) -> file-overlap-free
// (no shared keyFiles with another candidate in the array, first) -> size band
// (low first) -> hasPlan (true first). Every input this needs (the unblocks
// graph, file-overlap groups, hasPlan) must be precomputed by the caller and
// attached to each candidate — this function does no I/O, mirroring record.js
// and grouping.js's purity contract. Candidates *may* carry a top-level
// `blockedBy` or `facets.blockedBy` array (native/local-driver blocker data);
// when absent, blockers fall back to body-text parsing — see blockersOf for
// the exact precedence.
'use strict';

const { PRIORITIES, TIERS, parseDependencies } = require('./record');
const { groupByFileOverlap } = require('./grouping');

const RANK = { high: 0, medium: 1, low: 2 };
const SIZE_ORDER = { low: 0, medium: 1, high: 2 };
const priorityBandOf = (c) => (c.facets.priority && PRIORITIES.includes(c.facets.priority) ? RANK[c.facets.priority] : 3);
const sizeBandOf = (c) => (c.facets.size && TIERS.includes(c.facets.size) ? SIZE_ORDER[c.facets.size] : 3);

// candidate -> number[]. THE single blocker-precedence decision, shared by
// computeUnblocksCount here, funnelBuckets (backlog.js), and #515's import —
// never re-implement it at a call site. Precedence: an unsynced fallback
// record (`facets.unsynced === true`) short-circuits to `[]` FIRST — its
// blocker ids (when present) live in the local-record namespace, a different
// id space from the GitHub numbers in a merged set, and must never
// cross-match them (parent #512 promise F1); this helper owns the rule so
// every consumer inherits it. Then: top-level `blockedBy` (attached by the
// overview's native fetch, or any caller that resolved blockers itself)
// wins; then the local-files driver's `facets.blockedBy` (already
// native-shaped frontmatter data); then record.js's parseDependencies over
// the body (work-links: body-text). Both explicit tiers are authoritative
// even when empty — `[]` means "confirmed no blockers", never "fall through
// to prose". Callers must not mutate the returned array — the two explicit
// tiers return live references into the candidate's own data.
function blockersOf(candidate) {
  if (candidate.facets && candidate.facets.unsynced === true) return [];
  if (Array.isArray(candidate.blockedBy)) return candidate.blockedBy;
  if (candidate.facets && Array.isArray(candidate.facets.blockedBy)) return candidate.facets.blockedBy;
  return parseDependencies(candidate.body || '');
}

// candidates[] -> Map<id, count>. For each candidate, how many OTHER candidates
// in the SAME input array declare it as a blocker (blockersOf's precedence — not
// only body text). A blocker id outside this array's id set contributes
// nothing — this only ranks within the candidate set actually passed in, not
// the whole backlog's dependency graph.
function computeUnblocksCount(candidates) {
  const counts = new Map(candidates.map((c) => [c.id, 0]));
  for (const c of candidates) {
    for (const blockerId of blockersOf(c)) {
      if (counts.has(blockerId)) counts.set(blockerId, counts.get(blockerId) + 1);
    }
  }
  return counts;
}

// candidates[] -> Set<id> of candidates that share a keyFile with at least one
// other candidate in the array (grouping.js's groupByFileOverlap, filtered to
// groups of size > 1 — a singleton group has no overlap).
function computeOverlapSet(candidates) {
  const items = candidates.map((c) => ({ id: c.id, keyFiles: c.keyFiles || [] }));
  const groups = groupByFileOverlap(items);
  const overlapping = new Set();
  for (const group of groups) {
    if (group.length > 1) for (const id of group) overlapping.add(id);
  }
  return overlapping;
}

// candidates[] -> [{id, mention}] for every candidate whose body mentions a
// dependency anywhere (/blocked by\b[^\n#]*#\d+/i — deliberately broader than
// record-dependencies.js's line-anchored DEP_RE, mid-line prose included, and broader than
// a bare "blocked by #N": same-line words between "blocked by" and the first
// "#N" are allowed, e.g. "Blocked by links: #418", since that's real observed
// incident prose, not a hypothetical) while blockersOf(c) resolves empty:
// prose claims a dependency, but neither the native graph, the local driver,
// nor a canonical line backs it — the ranker is about to treat this candidate
// as unblocked, and the caller should say so loudly. The breadth is
// deliberate: this only fires when resolved blockers are empty and only ever
// renders a flag, never acts — an occasional false positive costs a human a
// glance, while a false negative here is exactly the silent mis-ranking this
// check exists to prevent, so it still never crosses a newline. Fires only on
// EMPTY resolved blockers by design: a partially wired record (non-empty
// blockedBy missing some prose-mentioned id) is not flagged — prose #N
// mentions have no mechanical ground truth, so partial-coverage checking
// would guess. `mention` is the trimmed full containing line of the first
// match.
const PROSE_DEP_RE = /blocked by\b[^\n#]*#\d+/i;
function findUnresolvedDependencyProse(candidates) {
  const hits = [];
  for (const c of candidates) {
    const body = c.body || '';
    if (!PROSE_DEP_RE.test(body)) continue;
    if (blockersOf(c).length > 0) continue;
    // An unsynced record's blockers resolve [] by the namespace rule above,
    // not because nothing is wired — its own facets.blockedBy is the local
    // ground truth. Wired-in-own-namespace suppresses the flag; only an
    // unsynced record with prose and NO wired local blockers is a mismatch.
    if (c.facets && c.facets.unsynced === true
      && Array.isArray(c.facets.blockedBy) && c.facets.blockedBy.length > 0) continue;
    const line = body.split('\n').find((l) => PROSE_DEP_RE.test(l));
    hits.push({ id: c.id, mention: line.trim() });
  }
  return hits;
}

function rankNextToBuild(candidates) {
  const unblocksCountOf = computeUnblocksCount(candidates);
  const overlapping = computeOverlapSet(candidates);
  return candidates.slice().sort((a, b) =>
    priorityBandOf(a) - priorityBandOf(b) ||
    unblocksCountOf.get(b.id) - unblocksCountOf.get(a.id) ||
    Number(overlapping.has(a.id)) - Number(overlapping.has(b.id)) ||
    sizeBandOf(a) - sizeBandOf(b) ||
    Number(b.hasPlan) - Number(a.hasPlan)
  );
}

module.exports = {
  rankNextToBuild, blockersOf, findUnresolvedDependencyProse, priorityBandOf,
};
