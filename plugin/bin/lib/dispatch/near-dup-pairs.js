'use strict';

// Near-duplicate pair enumeration for dispatch (#3520). Pure, no I/O: three
// functions the dispatch skill prose calls so that prose stays small.
//
//   nearDuplicatePairsAcrossGroups — the cross-group pair list the #1944
//     warning in queue-pull-script.md prints, in the same iteration order and
//     with the same first-sighting dedup, plus the `strong` flag.
//   predictedConflicts — the pairs whose two members were both selected into
//     different groups of one firing.
//   drainNearDuplicateHits — a selected record whose near-duplicate partner is
//     closed by a drain PR (dispatch-drain-prs.json shape), the partner being
//     outside the selection.
//
// A pair's `records` are issue NUMBERS ([subject, partner]), so the pair list
// can be persisted as JSON without carrying issue bodies, and `first` /
// `second` in a predicted conflict are numbers too. Each function returns []
// on null or malformed shapes; a non-string title still throws inside
// findNearDuplicates.

const { findNearDuplicates, isStrongNearDuplicate } = require('../issues/near-duplicate');

function validGroups(groups) {
  return Array.isArray(groups) && groups.every((g) => Array.isArray(g) && g.every((r) => r && typeof r === 'object'));
}

function validPair(p) {
  return p && Array.isArray(p.records) && p.records.length === 2
    && p.records.every((n) => Number.isFinite(n));
}

function nearDuplicatePairsAcrossGroups(groups) {
  if (!validGroups(groups)) return [];
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < groups.length; i += 1) {
    const others = groups.filter((_, j) => j !== i).flat();
    for (const subject of groups[i]) {
      for (const hit of findNearDuplicates(subject, others)) {
        const key = [subject.number, hit.number].sort((a, b) => a - b).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          records: [subject.number, hit.number],
          signals: hit.signals,
          sharedAnchors: hit.sharedAnchors,
          strong: isStrongNearDuplicate(hit),
        });
      }
    }
  }
  return pairs;
}

function predictedConflicts(pairs, selectedGroups) {
  if (!Array.isArray(pairs) || !validGroups(selectedGroups)) return [];
  const groupOf = new Map();
  selectedGroups.forEach((g, idx) => g.forEach((r) => groupOf.set(r.number, idx)));
  const out = [];
  for (const pair of pairs) {
    if (!validPair(pair)) continue;
    const [a, b] = pair.records;
    const ia = groupOf.get(a);
    const ib = groupOf.get(b);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    const [first, second, fi, si] = ia < ib ? [a, b, ia, ib] : [b, a, ib, ia];
    out.push({ first, second, signals: pair.signals, sharedAnchors: pair.sharedAnchors, fi, si });
  }
  out.sort((x, y) => x.fi - y.fi || x.si - y.si);
  return out.map(({ first, second, signals, sharedAnchors }) => ({ first, second, signals, sharedAnchors }));
}

function drainNearDuplicateHits(memberNumbers, pairs, drainPrs) {
  if (!Array.isArray(memberNumbers) || !Array.isArray(pairs) || !Array.isArray(drainPrs)) return [];
  const members = new Set(memberNumbers);
  const hits = [];
  const seen = new Set();
  for (const pair of pairs) {
    if (!validPair(pair)) continue;
    const [a, b] = pair.records;
    for (const [m, p] of [[a, b], [b, a]]) {
      if (!members.has(m) || members.has(p)) continue;
      for (const pr of drainPrs) {
        if (!pr || !Array.isArray(pr.closingIssueNumbers) || !pr.closingIssueNumbers.includes(p)) continue;
        const key = [pr.number, m, p].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ pr: pr.number, member: m, partner: p });
      }
    }
  }
  hits.sort((x, y) => x.pr - y.pr || x.member - y.member);
  return hits;
}

module.exports = { nearDuplicatePairsAcrossGroups, predictedConflicts, drainNearDuplicateHits };
