'use strict';

// Neighbour-in-flight exclusions for dispatch's queue-pull script (#3278, #3520).
//
// Dispatch builds each record as its own group, so the one concurrency guard
// left is this: a candidate waits while a record that neighbours it holds a
// LIVE claim. Two rules make a record a neighbour: it shares a specific key
// file with the candidate (#3278), or it is a strong near-duplicate of it
// (#3520, near-duplicate.js isStrongNearDuplicate) — the second rule covers
// records with no `### Key Files` section, which the first cannot see. This
// module turns those live-claimed direct neighbours into
// {reason: 'neighbour-in-flight', records, detail} entries in the shape
// exclusions.js owns. findNearDuplicates' key-files-overlap signal is not
// hub-filtered, so a shared hub file plus one more signal can make a strong
// neighbour; #3520 accepted that (a small share of strong pairs).
//
// Liveness comes from the claim blob (claims.js classifyClaimBlob), never from
// a bot:in-progress label — a label outlives its claim. Only in-flight records
// that actually neighbour some candidate are read, each at most once.
//
// A failed read (a thrown read, or a {failure} result) fails open: the record
// counts as not live and is reported in `unreadable` for the caller to surface.
// #3278 accepts that gap on purpose — a conflict the guard misses is resolved
// at merge time by _shared/pr-first-merge.md's Conflict path, which costs less
// than starving a record on a flaky read. An unparseable blob is a different
// case: the read succeeded, the content simply is not a live claim, so it is
// not listed in `unreadable`.
//
// The MCP transport (dispatch/mcp-transport.md) reads claims agent-side and
// hands them in through claimReaderFromMap.

const { findInFlightNeighbours, extractKeyFiles } = require('../issues/grouping');
const { classifyClaimBlob } = require('../issues/claims');
const { findNearDuplicates, isStrongNearDuplicate } = require('../issues/near-duplicate');

const REASON = 'neighbour-in-flight';

function toItem(issue) {
  return { id: issue.number, keyFiles: extractKeyFiles(issue) };
}

// Every direct neighbour of each candidate, keyed by candidate number: the
// file-sharing neighbours first, in findInFlightNeighbours' order, then the
// near-duplicate-only ones by ascending number. A record matching both rules
// is one element carrying files and signals. A file-only element stays exactly
// {number, files}. The near-duplicate pool excludes every candidate: an
// in-flight record that is also a candidate is the caller's own queue entry,
// not a neighbour.
function collectNeighbours(candidates, inFlight, hubOptions) {
  const pool = inFlight || [];
  const byCandidate = findInFlightNeighbours(candidates.map(toItem), pool.map(toItem), hubOptions);
  const candidateNumbers = new Set(candidates.map((c) => c.number));
  const nearPool = pool.filter((r) => !candidateNumbers.has(r.number));

  const merged = new Map();
  for (const candidate of candidates) {
    const elements = (byCandidate.get(candidate.number) || []).map((n) => ({ ...n }));
    const byNumber = new Map(elements.map((e) => [e.number, e]));
    const nearOnly = [];
    for (const hit of findNearDuplicates(candidate, nearPool)) {
      if (!isStrongNearDuplicate(hit)) continue;
      const existing = byNumber.get(hit.number);
      if (existing) {
        existing.signals = hit.signals;
        existing.sharedAnchors = hit.sharedAnchors;
      } else {
        nearOnly.push({ number: hit.number, files: [], signals: hit.signals, sharedAnchors: hit.sharedAnchors });
      }
    }
    nearOnly.sort((a, b) => a.number - b.number);
    const all = [...elements, ...nearOnly];
    if (all.length > 0) merged.set(candidate.number, all);
  }
  return merged;
}

// candidates, inFlight: issue objects ({ number, body, labels? }).
// readClaimContent(number) -> { content: string|null } | { failure: string }; may throw.
// now: epoch milliseconds. hubOptions: forwarded to findInFlightNeighbours.
// Returns { exclusions, unreadable } — exclusions ordered by candidate number,
// unreadable a sorted, unique list of in-flight numbers whose read failed.
function neighbourInFlightExclusions({ candidates, inFlight, readClaimContent, now, hubOptions = {} }) {
  const neighbours = collectNeighbours(candidates, inFlight, hubOptions);

  const liveByNumber = new Map();
  const unreadable = new Set();
  for (const list of neighbours.values()) {
    for (const { number } of list) {
      if (liveByNumber.has(number)) continue;
      let live = false;
      try {
        const result = readClaimContent(number);
        if (result && Object.prototype.hasOwnProperty.call(result, 'content')) {
          live = classifyClaimBlob(result.content, now).state === 'live';
        } else {
          unreadable.add(number);
        }
      } catch {
        unreadable.add(number);
      }
      liveByNumber.set(number, live);
    }
  }

  const exclusions = [];
  for (const [candidateId, list] of neighbours) {
    const liveNeighbours = list.filter((n) => liveByNumber.get(n.number));
    if (liveNeighbours.length === 0) continue;
    exclusions.push({
      reason: REASON,
      records: [candidateId],
      detail: {
        neighbours: liveNeighbours.map(({ number, files, signals, sharedAnchors }) => (
          signals ? { number, files, signals, sharedAnchors } : { number, files }
        )),
      },
    });
  }
  exclusions.sort((a, b) => a.records[0] - b.records[0]);

  return { exclusions, unreadable: [...unreadable].sort((a, b) => a - b) };
}

// The in-flight issue numbers neighbourInFlightExclusions would call
// readClaimContent for: every in-flight record that neighbours some candidate.
// Sorted, unique. The MCP path fetches exactly these claim blobs agent-side.
function neighbourClaimTargets({ candidates, inFlight, hubOptions = {} }) {
  const neighbours = collectNeighbours(candidates, inFlight, hubOptions);
  const numbers = new Set();
  for (const list of neighbours.values()) {
    for (const { number } of list) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b);
}

// A claim blob is a live claim (carries `claimedAt`) or a tombstone (`released`).
// classifyClaimBlob calls any other JSON object live, so an agent that records an
// MCP error or response wrapper ({"message":"Not Found"}, {content, sha}, {}) as a
// claim would otherwise produce a false exclusion.
function isClaimShaped(blob) {
  return blob.released === true || typeof blob.claimedAt === 'string';
}

function parseObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Adapts a plain object of agent-fetched claims (keyed by issue number as a
// string) to the readClaimContent contract. null -> absent blob, string ->
// blob content, a plain object without a `failure` key -> the parsed blob
// (re-serialised as its content), { failure } -> failed read, absent key ->
// never read; any other value (array, number, boolean) is malformed, as is a
// JSON object (or string holding one) that is neither a claim nor a tombstone.
// A non-JSON string passes through as content (the classifier calls it
// unreadable, so it never excludes). A failed or unread entry fails open as an
// unreadable read, never as a live or absent claim. A missing map reads as an
// empty one: every entry unread.
function claimReaderFromMap(map) {
  const entries = map !== null && typeof map === 'object' ? map : {};
  return (number) => {
    const key = String(number);
    if (!Object.prototype.hasOwnProperty.call(entries, key)) return { failure: 'claim-not-read' };
    const value = entries[key];
    if (value === null) return { content: null };
    if (typeof value === 'string') {
      const parsed = parseObject(value);
      if (parsed !== null && !isClaimShaped(parsed)) return { failure: 'malformed-claim-entry' };
      return { content: value };
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(value, 'failure')) return { failure: String(value.failure) };
      return isClaimShaped(value) ? { content: JSON.stringify(value) } : { failure: 'malformed-claim-entry' };
    }
    return { failure: 'malformed-claim-entry' };
  };
}

module.exports = { neighbourInFlightExclusions, neighbourClaimTargets, claimReaderFromMap };
