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
// Each returns [] on null or malformed input and never throws.

const { findNearDuplicates, isStrongNearDuplicate } = require('../issues/near-duplicate');

function validGroups(groups) {
  return Array.isArray(groups) && groups.every((g) => Array.isArray(g) && g.every((r) => r && typeof r === 'object'));
}

function validPair(p) {
  return p && Array.isArray(p.records) && p.records.length === 2
    && p.records.every((r) => r && typeof r === 'object' && Number.isInteger(r.number));
}

function nearDuplicatePairsAcrossGroups(groups) {
  if (!validGroups(groups)) return [];
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < groups.length; i += 1) {
    for (const subject of groups[i]) {
      const others = groups.filter((_, j) => j !== i).flat();
      for (const hit of findNearDuplicates(subject, others)) {
        const key = [subject.number, hit.number].sort((a, b) => a - b).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const partner = others.find((r) => r.number === hit.number);
        pairs.push({
          records: [subject, partner],
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
    const ia = groupOf.get(a.number);
    const ib = groupOf.get(b.number);
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
    for (const [m, p] of [pair.records, [pair.records[1], pair.records[0]]]) {
      if (!members.has(m.number) || members.has(p.number)) continue;
      for (const pr of drainPrs) {
        if (!pr || !Array.isArray(pr.closingIssueNumbers) || !pr.closingIssueNumbers.includes(p.number)) continue;
        const key = [pr.number, m.number, p.number].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ pr: pr.number, member: m.number, partner: p.number });
      }
    }
  }
  hits.sort((x, y) => x.pr - y.pr || x.member - y.member);
  return hits;
}

module.exports = { nearDuplicatePairsAcrossGroups, predictedConflicts, drainNearDuplicateHits };
