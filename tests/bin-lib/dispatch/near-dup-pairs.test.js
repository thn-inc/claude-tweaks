'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  nearDuplicatePairsAcrossGroups,
  predictedConflicts,
  drainNearDuplicateHits,
} = require('../../../plugin/bin/lib/dispatch/near-dup-pairs.js');
const { findNearDuplicates, isStrongNearDuplicate } = require('../../../plugin/bin/lib/issues/near-duplicate.js');

function rec(number, title, anchors = []) {
  return {
    number,
    title,
    labels: [{ name: 'priority:medium' }],
    body: anchors.length ? '## Current State\n\n' + anchors.map((a) => `- \`${a}\``).join('\n') + '\n' : '',
  };
}

// 10/11 share three anchors (strong); 10/12 share only a title (weak); 13 is unrelated.
const r10 = rec(10, 'Rework the queue ordering heuristic', ['alpha.js', 'beta.js', 'gamma.js']);
const r11 = rec(11, 'Unrelated words entirely here', ['alpha.js', 'beta.js', 'gamma.js']);
const r12 = rec(12, 'Rework the queue ordering heuristic', []);
const r13 = rec(13, 'Something else wholly', ['delta.js']);

// Today's queue-pull-script.md heredoc loop, verbatim, as the reference.
function heredocLines(groups) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < groups.length; i += 1) {
    for (const subject of groups[i]) {
      const others = groups.filter((_, j) => j !== i).flat();
      for (const hit of findNearDuplicates(subject, others)) {
        const key = [subject.number, hit.number].sort((a, b) => a - b).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push('#' + subject.number + ' / #' + hit.number + ' (' + hit.signals.join(', ') + ')');
      }
    }
  }
  return out;
}


test('pairs across groups reproduce the heredoc order and dedup on a three-group fixture', () => {
  const groups = [[r12, r13], [r10], [r11]];
  const pairs = nearDuplicatePairsAcrossGroups(groups);
  const lines = pairs.map((p) => '#' + p.records[0] + ' / #' + p.records[1] + ' (' + p.signals.join(', ') + ')');
  assert.deepStrictEqual(lines, heredocLines(groups));
  assert.deepStrictEqual(pairs.map((p) => p.records), [[12, 10], [10, 11]]);
});

test('the first sighting of an unordered pair wins (no reversed duplicate)', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  assert.strictEqual(pairs.length, 1);
  assert.deepStrictEqual(pairs[0].records, [10, 11]);
});

test('strong follows isStrongNearDuplicate and sharedAnchors are carried', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11], [r12]]);
  const byKey = Object.fromEntries(pairs.map((p) => [p.records.join('/'), p]));
  assert.strictEqual(byKey['10/11'].strong, true);
  assert.deepStrictEqual(byKey['10/11'].sharedAnchors, ['alpha.js', 'beta.js', 'gamma.js']);
  assert.strictEqual(byKey['10/12'].strong, false);
  assert.deepStrictEqual(byKey['10/12'].sharedAnchors, []);
  for (const p of pairs) {
    const byNum = new Map([r10, r11, r12, r13].map((r) => [r.number, r]));
    const hit = findNearDuplicates(byNum.get(p.records[0]), [byNum.get(p.records[1])])[0];
    assert.strictEqual(p.strong, isStrongNearDuplicate(hit));
  }
});

test('a same-group pair is omitted', () => {
  assert.deepStrictEqual(nearDuplicatePairsAcrossGroups([[r10, r11]]), []);
});

test('predictedConflicts keeps only pairs spanning two selected groups, ordered by group index', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11], [r12], [r13]]);
  assert.deepStrictEqual(pairs.map((p) => p.records), [[10, 11], [10, 12]]);
  // Selected groups in a different order than the pair encounter order.
  const out = predictedConflicts(pairs, [[r12], [r11], [r10]]);
  assert.deepStrictEqual(out.map((c) => [c.first, c.second]), [[12, 10], [11, 10]]);
  assert.deepStrictEqual(out[1].signals, pairs[0].signals);
  assert.deepStrictEqual(out[1].sharedAnchors, pairs[0].sharedAnchors);
});

test('predictedConflicts drops a pair with a member outside the selected groups', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11], [r12]]);
  assert.deepStrictEqual(predictedConflicts(pairs, [[r10], [r13]]), []);
  const partial = predictedConflicts(pairs, [[r10], [r11]]);
  assert.deepStrictEqual(partial.map((c) => [c.first, c.second]), [[10, 11]]);
});

test('predictedConflicts drops a pair whose members share one selected group', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  assert.deepStrictEqual(predictedConflicts(pairs, [[r10, r11]]), []);
});

test('drainNearDuplicateHits finds a partner closed by a drain PR', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  const hits = drainNearDuplicateHits([10], pairs, [
    { number: 900, closingIssueNumbers: [11] },
    { number: 901, closingIssueNumbers: [99] },
  ]);
  assert.deepStrictEqual(hits, [{ pr: 900, member: 10, partner: 11 }]);
});

test('drainNearDuplicateHits works when the member is the pair second record', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  const hits = drainNearDuplicateHits([11], pairs, [{ number: 900, closingIssueNumbers: [10] }]);
  assert.deepStrictEqual(hits, [{ pr: 900, member: 11, partner: 10 }]);
});

test('drainNearDuplicateHits yields [] when the partner is itself a member', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  assert.deepStrictEqual(drainNearDuplicateHits([10, 11], pairs, [{ number: 900, closingIssueNumbers: [11] }]), []);
});

test('drainNearDuplicateHits yields [] for a PR closing an unrelated issue', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  assert.deepStrictEqual(drainNearDuplicateHits([10], pairs, [{ number: 900, closingIssueNumbers: [77] }]), []);
});

test('drainNearDuplicateHits sorts by pr then member', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11], [r12]]);
  const hits = drainNearDuplicateHits([12, 11], pairs, [
    { number: 905, closingIssueNumbers: [10] },
    { number: 900, closingIssueNumbers: [10] },
  ]);
  assert.deepStrictEqual(hits.map((h) => [h.pr, h.member, h.partner]), [
    [900, 11, 10],
    [900, 12, 10],
    [905, 11, 10],
    [905, 12, 10],
  ]);
});

test('records, first and second are plain issue numbers that render and persist without bodies', () => {
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  assert.deepStrictEqual(pairs[0].records, [10, 11]);
  assert.ok(!JSON.stringify(pairs).includes('Current State'), 'a persisted pair must not carry issue bodies');
  const [c] = predictedConflicts(pairs, [[r10], [r11]]);
  assert.strictEqual('#' + c.first + ' / #' + c.second, '#10 / #11');
  assert.strictEqual(typeof c.first, 'number');
});

test('null and malformed inputs give [] and never throw', () => {
  for (const bad of [null, undefined, 'x', 7, {}, [null], [[null]], [[{}]]]) {
    assert.deepStrictEqual(nearDuplicatePairsAcrossGroups(bad), []);
  }
  const pairs = nearDuplicatePairsAcrossGroups([[r10], [r11]]);
  const prs = [{ number: 1, closingIssueNumbers: [11] }];
  for (const bad of [null, undefined, 'x', {}, [null], [{}], [{ records: null }]]) {
    assert.deepStrictEqual(predictedConflicts(bad, [[r10], [r11]]), []);
    assert.deepStrictEqual(predictedConflicts(pairs, bad), []);
    assert.deepStrictEqual(drainNearDuplicateHits([10], bad, prs), []);
    assert.deepStrictEqual(drainNearDuplicateHits([10], pairs, bad), []);
    assert.deepStrictEqual(drainNearDuplicateHits(bad, pairs, prs), []);
  }
  assert.deepStrictEqual(
    drainNearDuplicateHits([10], pairs, [{ number: 1 }, null, { number: 2, closingIssueNumbers: 'x' }]),
    [],
  );
});
