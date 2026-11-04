'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  rankNextToBuild, blockersOf, findUnresolvedDependencyProse, priorityBandOf,
} = require('../../../plugin/bin/lib/issues/ranking');
const { parseRecordFacets } = require('../../../plugin/bin/lib/issues/record');

function candidate(overrides) {
  return {
    id: 1,
    facets: { priority: null, size: null },
    body: '',
    keyFiles: [],
    hasPlan: false,
    ...overrides,
  };
}

test('rankNextToBuild sorts by priority band first (high before medium before low before unset)', () => {
  const low = candidate({ id: 1, facets: { priority: 'low', size: null } });
  const high = candidate({ id: 2, facets: { priority: 'high', size: null } });
  const unset = candidate({ id: 3, facets: { priority: null, size: null } });
  const medium = candidate({ id: 4, facets: { priority: 'medium', size: null } });
  const result = rankNextToBuild([low, high, unset, medium]);
  assert.deepStrictEqual(result.map((c) => c.id), [2, 4, 1, 3]);
});

test('an out-of-vocabulary priority value sorts like unset (band 3), never NaN', () => {
  const bogus = candidate({ id: 1, facets: { priority: 'critical', size: null } });
  const high = candidate({ id: 2, facets: { priority: 'high', size: null } });
  const result = rankNextToBuild([bogus, high]);
  assert.deepStrictEqual(result.map((c) => c.id), [2, 1], 'an out-of-vocabulary priority must sort AFTER a real "high", not corrupt the order');
});

test('within the same priority band, a candidate that unblocks more other candidates ranks first', () => {
  const unblocksTwo = candidate({ id: 1, facets: { priority: 'high', size: null } });
  const unblocksNone = candidate({ id: 2, facets: { priority: 'high', size: null } });
  const blocker = candidate({ id: 3, facets: { priority: 'high', size: null }, body: 'Blocked by #1' });
  const blocker2 = candidate({ id: 4, facets: { priority: 'high', size: null }, body: 'Blocked by #1' });
  const result = rankNextToBuild([unblocksNone, unblocksTwo, blocker, blocker2]);
  assert.strictEqual(result[0].id, 1, 'id 1 unblocks 2 other candidates (ids 3 and 4) and must rank first among same-priority candidates');
});

test('within the same priority and unblocks-count, a candidate with no file overlap with another candidate ranks first', () => {
  const overlapping1 = candidate({ id: 1, facets: { priority: 'high', size: null }, keyFiles: ['src/a.js'] });
  const overlapping2 = candidate({ id: 2, facets: { priority: 'high', size: null }, keyFiles: ['src/a.js'] });
  const clean = candidate({ id: 3, facets: { priority: 'high', size: null }, keyFiles: ['src/b.js'] });
  const result = rankNextToBuild([overlapping1, clean, overlapping2]);
  assert.strictEqual(result[0].id, 3, 'id 3 has no file overlap with any other candidate and must rank first among ties');
});

test('within the same priority/unblocks/overlap tier, smaller size ranks first', () => {
  const sizeHigh = candidate({ id: 1, facets: { priority: 'high', size: 'high' } });
  const sizeLow = candidate({ id: 2, facets: { priority: 'high', size: 'low' } });
  const result = rankNextToBuild([sizeHigh, sizeLow]);
  assert.deepStrictEqual(result.map((c) => c.id), [2, 1]);
});

test('as the final tie-break, a candidate with an existing plan ranks first', () => {
  const noPlan = candidate({ id: 1, facets: { priority: 'high', size: 'low' }, hasPlan: false });
  const hasPlan = candidate({ id: 2, facets: { priority: 'high', size: 'low' }, hasPlan: true });
  const result = rankNextToBuild([noPlan, hasPlan]);
  assert.deepStrictEqual(result.map((c) => c.id), [2, 1]);
});

test('unblocks-count only counts candidates within the same input array, and only exact-match blocker ids', () => {
  const target = candidate({ id: 5, facets: { priority: 'high', size: null } });
  const otherTarget = candidate({ id: 6, facets: { priority: 'high', size: null } });
  const blocksTarget = candidate({ id: 7, facets: { priority: 'high', size: null }, body: 'Blocked by #5' });
  const blocksSomethingElse = candidate({ id: 8, facets: { priority: 'high', size: null }, body: 'Blocked by #999' });
  const result = rankNextToBuild([target, otherTarget, blocksTarget, blocksSomethingElse]);
  assert.strictEqual(result[0].id, 5, 'id 5 is unblocked by one in-array candidate; id 6 by zero, so 5 ranks first among the priority:high tier');
});

test('a candidate with a real size value ranks before a candidate with unset (null) size', () => {
  const sizeUnset = candidate({ id: 1, facets: { priority: 'high', size: null } });
  const sizeLow = candidate({ id: 2, facets: { priority: 'high', size: 'low' } });
  const result = rankNextToBuild([sizeUnset, sizeLow]);
  assert.deepStrictEqual(result.map((c) => c.id), [2, 1], 'a candidate with size: "low" (band 0) must rank BEFORE one with size: null (band 3), not after');
});

// --- real-parser coverage (record #217) ---
// Every candidate above hand-builds its `.facets`, so the effort -> size facet
// rename left this suite green while the size tie-break read an `undefined` key
// for every real candidate. This test routes labels through record.js's ACTUAL
// parseRecordFacets, so the next facet-key change fails here instead of shipping.
test('the size tie-break reads the facet key the real label parser writes', () => {
  const fromLabels = (id, labels) => ({ id, facets: parseRecordFacets(labels), body: '', keyFiles: [], hasPlan: false });

  // Scenario: two candidates identical on every earlier tie-break (same
  // priority, no dependencies between them, no shared keyFiles, no plan) and
  // separated only by their size label. The tie-break rule is low-size-first,
  // so #2 must lead — an expectation from the rule, not from running the sort.
  const large = fromLabels(1, ['priority:high', 'size:high']);
  const small = fromLabels(2, ['priority:high', 'size:low']);
  assert.deepStrictEqual(rankNextToBuild([large, small]).map((c) => c.id), [2, 1]);

  // record.js keeps a permanent read-side effort:* fallback for other repos'
  // records, so a legacy-labelled small candidate must lead the same way.
  const largeAgain = fromLabels(3, ['priority:high', 'size:high']);
  const legacySmall = fromLabels(4, ['priority:high', 'effort:low']);
  assert.deepStrictEqual(rankNextToBuild([largeAgain, legacySmall]).map((c) => c.id), [4, 3]);
});

// --- blockersOf precedence (record #514) ---

test('blockersOf: top-level blockedBy wins over body text when both present and disagree', () => {
  const c = { id: 1, blockedBy: [2], facets: {}, body: 'Blocked by #3' };
  assert.deepEqual(blockersOf(c), [2]);
});

test('blockersOf: no blockedBy key falls back to parseDependencies on the body', () => {
  const c = { id: 1, facets: {}, body: 'Blocked by #3\nsome text' };
  assert.deepEqual(blockersOf(c), [3]);
});

test('blockersOf: blockedBy [] is authoritative — no body fallback', () => {
  const c = { id: 1, blockedBy: [], facets: {}, body: 'Blocked by #3' };
  assert.deepEqual(blockersOf(c), []);
});

test('blockersOf: facets.blockedBy (local driver) used when top-level absent, and [] there is authoritative too', () => {
  assert.deepEqual(blockersOf({ id: 1, facets: { blockedBy: [7] }, body: 'Blocked by #3' }), [7]);
  assert.deepEqual(blockersOf({ id: 1, facets: { blockedBy: [] }, body: 'Blocked by #3' }), []);
});

test('rankNextToBuild: candidate with blockedBy [2] and body "Blocked by #3" ranks using blocker 2, not 3', () => {
  // Three candidates, same priority/size: 2 should gain the unblocks count (1 blocks on it), 3 should not.
  const candidates = [
    { id: 1, blockedBy: [2], facets: {}, body: 'Blocked by #3', keyFiles: [], hasPlan: false },
    { id: 2, facets: {}, body: '', keyFiles: [], hasPlan: false },
    { id: 3, facets: {}, body: '', keyFiles: [], hasPlan: false },
  ];
  const ranked = rankNextToBuild(candidates);
  assert.equal(ranked[0].id, 2); // unblocks 1 other candidate; 3 unblocks none
});

test('rankNextToBuild: no blockedBy keys — body parsing result unchanged (regression pin for /help)', () => {
  const candidates = [
    { id: 1, facets: {}, body: 'Blocked by #2', keyFiles: [], hasPlan: false },
    { id: 2, facets: {}, body: '', keyFiles: [], hasPlan: false },
  ];
  const ranked = rankNextToBuild(candidates);
  assert.equal(ranked[0].id, 2);
});

// --- unsynced namespace rule (record #514) ---
// Mirrors backlog.test.js's funnelBuckets namespace pin: blockersOf owns the
// rule now (moved, not changed), so this pins it at the source.

test('blockersOf: an unsynced candidate resolves [] even though facets.blockedBy is non-empty — never crosses into the GitHub id namespace', () => {
  const unsyncedCandidate = { id: 1, facets: { unsynced: true, blockedBy: [3] }, body: '' };
  assert.deepEqual(blockersOf(unsyncedCandidate), []);
});

test("rankNextToBuild: an unsynced candidate's phantom blockedBy reference does not inflate another candidate's unblocks-count", () => {
  const unsyncedWithBlockedBy = { id: 1, facets: { unsynced: true, blockedBy: [3], priority: 'high', size: null }, body: '', keyFiles: [], hasPlan: false };
  const unsyncedWithoutBlockedBy = { id: 1, facets: { unsynced: true, priority: 'high', size: null }, body: '', keyFiles: [], hasPlan: false };
  const target = { id: 3, facets: { priority: 'high', size: null }, body: '', keyFiles: [], hasPlan: false };
  // Direct assertion is sufficient per #514's contract — id 3's unblocks-count
  // must not count the unsynced candidate's local-namespace reference to it.
  assert.deepEqual(blockersOf(unsyncedWithBlockedBy), []);
  // Comparative rather than a hardcoded tie-order: whether or not the phantom
  // blockedBy reference is present, id 3's unblocks-count is unaffected, so
  // the resulting order must be identical either way — this survives a
  // future stable-sort/tie-break change instead of pinning to it.
  const rankedWith = rankNextToBuild([unsyncedWithBlockedBy, target]).map((c) => c.id);
  const rankedWithout = rankNextToBuild([unsyncedWithoutBlockedBy, target]).map((c) => c.id);
  assert.deepEqual(rankedWith, rankedWithout, "the unsynced candidate's phantom blockedBy reference changes nothing about the ranked order");
});

test('blockersOf: facets.blockedBy [] (the local driver\'s default) is authoritative even with a canonical body line — the explicit empty tier short-circuits the body fallback', () => {
  const c = { id: 1, facets: { blockedBy: [] }, body: 'Blocked by #2' };
  assert.deepEqual(blockersOf(c), [], "documents the deliberate behavior change for local-driver callers: an explicit empty blockedBy wins over prose, it is not merely 'no data yet'");
});

// --- findUnresolvedDependencyProse (record #514) ---

test('findUnresolvedDependencyProse: mid-line prose with empty resolved blockers is flagged, mention is the trimmed line', () => {
  const c = { id: 418, facets: {}, body: 'Overview text.\n  Hard prerequisites, wired as Blocked by links: #418 and #419.  \nMore.' };
  const hits = findUnresolvedDependencyProse([c]);
  assert.deepEqual(hits, [{ id: 418, mention: 'Hard prerequisites, wired as Blocked by links: #418 and #419.' }]);
});

test('findUnresolvedDependencyProse: not flagged when blockedBy is attached non-empty', () => {
  const c = { id: 420, blockedBy: [418, 419], facets: {}, body: 'wired as Blocked by links: #418 and #419' };
  assert.deepEqual(findUnresolvedDependencyProse([c]), []);
});

test('findUnresolvedDependencyProse: not flagged when a canonical line-start declaration resolves via fallback', () => {
  const c = { id: 5, facets: {}, body: 'Blocked by #418\nrest of body' };
  assert.deepEqual(findUnresolvedDependencyProse([c]), []);
});

test('findUnresolvedDependencyProse: case-insensitive match', () => {
  const c = { id: 6, facets: {}, body: 'This is BLOCKED BY #7 in prose only' };
  assert.deepEqual(findUnresolvedDependencyProse([c]), [{ id: 6, mention: 'This is BLOCKED BY #7 in prose only' }]);
});

test('findUnresolvedDependencyProse: no prose mention, no flag (negative control)', () => {
  const c = { id: 8, facets: {}, body: 'No dependencies at all.' };
  assert.deepEqual(findUnresolvedDependencyProse([c]), []);
});

// --- unsynced + wired-local-blockers suppression (record #514) ---
// blockersOf resolves [] for an unsynced record by the namespace rule, but
// that [] means "cross-namespace blockers hidden", not "nothing wired" — an
// unsynced record with its own facets.blockedBy populated must NOT be
// false-flagged just because blockersOf's return value is empty.

test('findUnresolvedDependencyProse: unsynced candidate with prose mention AND wired facets.blockedBy is NOT flagged', () => {
  const c = { id: 30, facets: { unsynced: true, blockedBy: [3] }, body: 'Blocked by #3 in prose' };
  assert.deepEqual(findUnresolvedDependencyProse([c]), []);
});

test('findUnresolvedDependencyProse: unsynced candidate with prose mention and NO wired local blockers IS flagged', () => {
  const noBlockedBy = { id: 31, facets: { unsynced: true }, body: 'Blocked by #3 in prose' };
  const emptyBlockedBy = { id: 32, facets: { unsynced: true, blockedBy: [] }, body: 'Blocked by #3 in prose' };
  assert.deepEqual(findUnresolvedDependencyProse([noBlockedBy]), [{ id: 31, mention: 'Blocked by #3 in prose' }]);
  assert.deepEqual(findUnresolvedDependencyProse([emptyBlockedBy]), [{ id: 32, mention: 'Blocked by #3 in prose' }]);
});

// --- priorityBandOf (#1101: exported so overview-mode.md's Shape stage can
// reuse the guarded band lookup instead of reimplementing it without the
// PRIORITIES.includes() check, which produced NaN on an out-of-vocabulary
// facets.priority value) ---

test('priorityBandOf: ranks high < medium < low', () => {
  assert.ok(priorityBandOf({ facets: { priority: 'high' } }) < priorityBandOf({ facets: { priority: 'medium' } }));
  assert.ok(priorityBandOf({ facets: { priority: 'medium' } }) < priorityBandOf({ facets: { priority: 'low' } }));
});

test('priorityBandOf: absent priority sorts last (band 3), not NaN', () => {
  assert.equal(priorityBandOf({ facets: {} }), 3);
});

test('priorityBandOf: an out-of-vocabulary priority value falls back to band 3 instead of NaN', () => {
  assert.equal(priorityBandOf({ facets: { priority: 'urgent' } }), 3);
  assert.ok(Number.isFinite(priorityBandOf({ facets: { priority: 'urgent' } })));
});

test('a qualified foreign blocker ref (#4793) never credits this repository\'s same-numbered record, yet counts as wired', () => {
  const foreign = candidate({ id: 9, body: 'Blocked by other/repo#5', blockedBy: ['other/repo#5'] });
  const five = candidate({ id: 5 });
  assert.deepStrictEqual(rankNextToBuild([foreign, five]).map((c) => c.id), [9, 5]);
  assert.deepStrictEqual(findUnresolvedDependencyProse([foreign, five]), []);
  // Control: a bare number does credit #5 and moves it first.
  const local = candidate({ id: 9, blockedBy: [5] });
  assert.deepStrictEqual(rankNextToBuild([local, five]).map((c) => c.id), [5, 9]);
});

test('Plan Review Clarifications: a canonical Blocked by owner/name#N line is wired — never flagged as unwired prose', () => {
  assert.deepStrictEqual(findUnresolvedDependencyProse([candidate({ id: 9, body: 'Blocked by other/repo#5' })]), []);
  assert.deepStrictEqual(findUnresolvedDependencyProse([candidate({ id: 9, body: 'Blocked by other/repo#5\nalso blocked by #7 upstream' })]), []);
});

test('a mid-line qualified mention is never read as this repository\'s #N; a bare #N beside it still flags', () => {
  assert.deepStrictEqual(findUnresolvedDependencyProse([candidate({ id: 9, body: 'This is blocked by other/repo#5 upstream' })]), []);
  assert.deepStrictEqual(findUnresolvedDependencyProse([candidate({ id: 9, body: 'blocked by other/repo#5 and #7' })]), [{ id: 9, mention: 'blocked by other/repo#5 and #7' }]);
});
