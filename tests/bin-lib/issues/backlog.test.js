'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  splitScoredUnscored,
  filterCritical,
  rankRiskValue,
  filterCleanup,
  selectBudgetSlice,
  mergeUnsyncedRecords,
  deriveCreatedAtFromGit,
  funnelBuckets,
  machineGrantOutlook,
  readyGrantedSubset,
} = require('../../../plugin/bin/lib/issues/backlog');
const { parseRecordFacets } = require('../../../plugin/bin/lib/issues/record');

function record(overrides) {
  return {
    number: 1,
    title: 'untitled',
    createdAt: '2026-01-01T00:00:00Z',
    facets: { risk: null, size: null, priority: null },
    ...overrides,
  };
}

test('splitScoredUnscored buckets by presence of both risk and size', () => {
  const scored = record({ number: 1, facets: { risk: 'high', size: 'low', priority: null } });
  const riskOnly = record({ number: 2, facets: { risk: 'high', size: null, priority: null } });
  const unscored = record({ number: 3, facets: { risk: null, size: null, priority: null } });
  const result = splitScoredUnscored([scored, riskOnly, unscored]);
  assert.deepStrictEqual(result.scored, [scored]);
  assert.deepStrictEqual(result.unscored, [riskOnly, unscored]);
});

test('filterCritical keeps only risk:high, sorted by priority band then oldest-first', () => {
  const high1 = record({ number: 1, createdAt: '2026-02-01T00:00:00Z', facets: { risk: 'high', size: 'low', priority: null } });
  const high2 = record({ number: 2, createdAt: '2026-01-01T00:00:00Z', facets: { risk: 'high', size: 'low', priority: 'high' } });
  const medium = record({ number: 3, facets: { risk: 'medium', size: 'low', priority: 'high' } });
  const result = filterCritical([high1, high2, medium]);
  assert.deepStrictEqual(result.map((r) => r.number), [2, 1]);
});

test('bandOf/riskBandOf treat an out-of-vocabulary facet value like the null/absent case (band 3), never NaN', () => {
  // local-store.js's frontmatter parser accepts priority:/risk: values
  // verbatim with no enum check, so a hand-edited or future-taxonomy record
  // can carry a value outside PRIORITIES/TIERS. Before the fix, RANK['critical']
  // was undefined, and `undefined - 0` is NaN — a NaN-valued sort comparator
  // has spec-undefined ordering, so 'critical' could sort AHEAD of a real
  // 'high' record instead of behind it.
  const bogus = record({ number: 1, createdAt: '2026-01-01T00:00:00Z', facets: { risk: 'high', size: 'low', priority: 'critical' } });
  const high = record({ number: 2, createdAt: '2026-01-01T00:00:00Z', facets: { risk: 'high', size: 'low', priority: 'high' } });
  const result = filterCritical([bogus, high]);
  assert.deepStrictEqual(result.map((r) => r.number), [2, 1], 'an out-of-vocabulary priority must sort AFTER a real "high", not corrupt the order');
});

test('rankRiskValue sorts scored records by priority band then risk band then oldest-first, trailing unscored separately', () => {
  const a = record({ number: 1, createdAt: '2026-01-01T00:00:00Z', facets: { risk: 'low', size: 'low', priority: 'high' } });
  const b = record({ number: 2, createdAt: '2026-01-02T00:00:00Z', facets: { risk: 'high', size: 'low', priority: 'high' } });
  const c = record({ number: 3, createdAt: '2026-01-01T00:00:00Z', facets: { risk: 'high', size: 'low', priority: null } });
  const unscored1 = record({ number: 4, createdAt: '2026-01-05T00:00:00Z', facets: { risk: null, size: null, priority: null } });
  const unscored2 = record({ number: 5, createdAt: '2026-01-03T00:00:00Z', facets: { risk: null, size: null, priority: null } });
  const result = rankRiskValue([a, b, c, unscored1, unscored2]);
  assert.deepStrictEqual(result.ranked.map((r) => r.number), [2, 1, 3]);
  assert.deepStrictEqual(result.unscored.map((r) => r.number), [5, 4]);
});

test('filterCleanup keeps only size:low, sorted by priority band then oldest-first', () => {
  const low1 = record({ number: 1, createdAt: '2026-02-01T00:00:00Z', facets: { risk: 'low', size: 'low', priority: null } });
  const low2 = record({ number: 2, createdAt: '2026-01-01T00:00:00Z', facets: { risk: 'low', size: 'low', priority: 'high' } });
  const sizeHigh = record({ number: 3, facets: { risk: 'low', size: 'high', priority: 'high' } });
  const result = filterCleanup([low1, low2, sizeHigh]);
  assert.deepStrictEqual(result.map((r) => r.number), [2, 1]);
});

test('selectBudgetSlice picks the oldest N and reports an honest remaining count', () => {
  const records = [
    record({ number: 1, createdAt: '2026-01-03T00:00:00Z' }),
    record({ number: 2, createdAt: '2026-01-01T00:00:00Z' }),
    record({ number: 3, createdAt: '2026-01-02T00:00:00Z' }),
  ];
  const result = selectBudgetSlice(records, 2);
  assert.deepStrictEqual(result.selected.map((r) => r.number), [2, 3]);
  assert.strictEqual(result.remaining, 1);
});

test('selectBudgetSlice reports zero remaining when the budget covers everything', () => {
  const records = [record({ number: 1 }), record({ number: 2 })];
  const result = selectBudgetSlice(records, 5);
  assert.strictEqual(result.remaining, 0);
  assert.strictEqual(result.selected.length, 2);
});

test('deriveCreatedAtFromGit resolves createdAt for every record from a SINGLE batched git-log call, not one call per record', () => {
  const calls = [];
  const execFn = (cmd) => {
    calls.push(cmd);
    return [
      '\x012026-01-05T12:00:00+00:00',
      'specs/1-foo.md',
      '',
      '\x012026-01-01T00:00:00+00:00',
      'specs/2-bar.md',
      'specs/1-foo.md',
      '',
    ].join('\n');
  };
  const records = [
    { number: 1, path: 'specs/1-foo.md' },
    { number: 2, path: 'specs/2-bar.md' },
  ];
  const result = deriveCreatedAtFromGit(records, { execFn });
  assert.strictEqual(calls.length, 1, 'must resolve every record from a single git-log invocation, not one per record');
  assert.match(calls[0], /^git log --name-only --format=/);
  assert.strictEqual(result[0].createdAt, '2026-01-05T12:00:00+00:00', 'must use the MOST RECENT commit touching the path (first-seen in newest-first git log order)');
  assert.strictEqual(result[0].number, 1);
  assert.strictEqual(result[1].createdAt, '2026-01-01T00:00:00+00:00');
});

test('deriveCreatedAtFromGit falls back to the current time for a record whose path never appears in the git-log history', () => {
  const execFn = () => '\x012026-01-01T00:00:00+00:00\nspecs/1-foo.md\n';
  const before = Date.now();
  const records = [{ number: 2, path: 'specs/2-missing.md' }];
  const result = deriveCreatedAtFromGit(records, { execFn });
  const after = Date.now();
  const fallbackTime = new Date(result[0].createdAt).getTime();
  assert.ok(fallbackTime >= before && fallbackTime <= after, 'createdAt should fall back to now()');
});

test('deriveCreatedAtFromGit falls back to the current time for every record when git log fails (no history / not a git repo)', () => {
  const execFn = () => {
    throw new Error('fatal: not a git repository');
  };
  const before = Date.now();
  const records = [{ number: 2, path: 'specs/2-bar.md' }];
  const result = deriveCreatedAtFromGit(records, { execFn });
  const after = Date.now();
  const fallbackTime = new Date(result[0].createdAt).getTime();
  assert.ok(fallbackTime >= before && fallbackTime <= after, 'createdAt should fall back to now()');
});

test('deriveCreatedAtFromGit falls back to the current time for every record when git log returns empty output', () => {
  const execFn = () => '   \n';
  const records = [{ number: 3, path: 'specs/3-baz.md' }];
  const result = deriveCreatedAtFromGit(records, { execFn });
  assert.ok(!Number.isNaN(new Date(result[0].createdAt).getTime()));
  assert.notStrictEqual(result[0].createdAt, '');
});

test('deriveCreatedAtFromGit preserves record order and does not mutate the input records', () => {
  const execFn = () => [
    '\x012026-02-02T00:00:00+00:00',
    'specs/2-bar.md',
    '',
    '\x012026-01-01T00:00:00+00:00',
    'specs/1-foo.md',
    '',
  ].join('\n');
  const records = [
    { number: 1, path: 'specs/1-foo.md' },
    { number: 2, path: 'specs/2-bar.md' },
  ];
  const result = deriveCreatedAtFromGit(records, { execFn });
  assert.deepStrictEqual(result.map((r) => r.number), [1, 2]);
  assert.strictEqual(records[0].createdAt, undefined, 'must not mutate the input record objects');
});

test('deriveCreatedAtFromGit returns [] immediately (no git call at all) for an empty records array', () => {
  const calls = [];
  const execFn = (cmd) => { calls.push(cmd); return ''; };
  assert.deepStrictEqual(deriveCreatedAtFromGit([], { execFn }), []);
  assert.strictEqual(calls.length, 0);
});

test('mergeUnsyncedRecords concatenates github-first then unsynced, tagging facets.unsynced explicitly on both', () => {
  const githubRecord = record({
    number: 1,
    // parseRecordFacets never sets an `unsynced` key at all — simulate that shape.
    facets: { risk: 'low', size: 'low', priority: null },
  });
  const unsyncedRecord = record({
    number: 2,
    facets: { risk: null, size: null, priority: null, unsynced: true },
  });
  const result = mergeUnsyncedRecords([githubRecord], [unsyncedRecord]);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].number, 1);
  assert.strictEqual(result[0].facets.unsynced, false);
  assert.strictEqual(result[1].number, 2);
  assert.strictEqual(result[1].facets.unsynced, true);
});

// --- real-parser coverage (record #217) ---
// Every fixture above hand-builds its `.facets` object, so the effort -> size
// facet rename left this whole suite green while both gates below silently read
// an `undefined` key. These two tests route labels through record.js's ACTUAL
// parseRecordFacets, so the next change to the facet key fails here instead of
// shipping. Expected sets are stated from the scenario, not read off the filter.

function recordFromLabels(number, labels, createdAt) {
  return { number, title: `record ${number}`, createdAt, facets: parseRecordFacets(labels) };
}

test('the scored gate and the cleanup lane read the same facet key the real label parser writes', () => {
  // Scenario: #1 is fully scored and small, #2 is fully scored and large,
  // #3 carries a risk label only. So: scored = {1, 2}, unscored = {3},
  // cleanup lane = {1} (the only size:low record).
  const smallScored = recordFromLabels(1, ['risk:high', 'size:low'], '2026-01-02T00:00:00Z');
  const largeScored = recordFromLabels(2, ['risk:low', 'size:high'], '2026-01-01T00:00:00Z');
  const riskOnly = recordFromLabels(3, ['risk:high'], '2026-01-03T00:00:00Z');
  const all = [smallScored, largeScored, riskOnly];

  const split = splitScoredUnscored(all);
  assert.deepStrictEqual(split.scored.map((r) => r.number), [1, 2], 'both records carrying risk AND size are scored');
  assert.deepStrictEqual(split.unscored.map((r) => r.number), [3], 'a record with no size label is unscored');

  assert.deepStrictEqual(filterCleanup(all).map((r) => r.number), [1], 'only the size:low record belongs to the cleanup lane');
});

test('a pre-rename effort:* label reaches both gates through the parser permanent fallback', () => {
  // record.js keeps a permanent read-side effort:* fallback for other repos'
  // records, so a legacy-labelled record must score and land in the cleanup
  // lane exactly as its size:low equivalent does.
  const legacy = recordFromLabels(9, ['risk:low', 'effort:low'], '2026-01-01T00:00:00Z');
  assert.deepStrictEqual(splitScoredUnscored([legacy]).scored.map((r) => r.number), [9]);
  assert.deepStrictEqual(filterCleanup([legacy]).map((r) => r.number), [9]);
});

// --- funnelBuckets (record #513) ---

// Minimal faceted-record builder for funnelBuckets cases. Mirrors
// sharedFacetDefaults()'s shape — keys funnelBuckets reads are explicit;
// solutionUnjustified defaults false here exactly as the shared shape does
// (live since record #677's rename). needsDefinition is deliberately absent
// from these defaults: a fixture that wants it opts in via facetOverrides.
function rec(number, facetOverrides = {}, extra = {}) {
  return {
    number,
    facets: {
      origin: null, risk: null, size: null, ceremony: null, solutionUnjustified: false, breaking: false,
      priority: null, stage: 'backlog',
      grants: { build: false, merge: false },
      bot: { inProgress: false, blocked: false, parked: false },
      acceptance: null, isParentIssue: false, notPlanned: false,
      ...facetOverrides,
    },
    ...extra,
  };
}

test('funnelBuckets: every open record lands in exactly one bucket and sizes sum to input length', () => {
  const records = [
    rec(1, { bot: { inProgress: true, blocked: false } }),                                    // inFlight
    rec(2, { stage: 'parked' }),                                                              // parked
    rec(3, { notPlanned: true }),                                                             // notPlanned
    rec(4, { stage: 'ready', grants: { build: true, merge: false } }, { blockedBy: [5] }),    // granted (5 in set)
    rec(5, { stage: 'ready', grants: { build: true, merge: false } }),                        // dispatchable
    rec(6, { stage: 'ready' }),                                                               // specified
    rec(7, { priority: 'high' }),                                                             // prioritized
    rec(8),                                                                                   // captured
    rec(9, { isParentIssue: true, risk: 'low', size: 'medium' }),                             // parents
  ];
  const b = funnelBuckets(records);
  const all = [...b.captured, ...b.prioritized, ...b.specified, ...b.granted, ...b.dispatchable, ...b.inFlight, ...b.parked, ...b.notPlanned, ...b.parents];  assert.equal(all.length, records.length);
  assert.equal(new Set(all.map((r) => r.number)).size, records.length);
  assert.deepEqual(b.inFlight.map((r) => r.number), [1]);
  assert.deepEqual(b.parked.map((r) => r.number), [2]);
  assert.deepEqual(b.notPlanned.map((r) => r.number), [3]);
  assert.deepEqual(b.granted.map((r) => r.number), [4]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [5]);
  assert.deepEqual(b.specified.map((r) => r.number), [6]);
  assert.deepEqual(b.prioritized.map((r) => r.number), [7]);
  assert.deepEqual(b.captured.map((r) => r.number), [8]);
  assert.deepEqual(b.parents.map((r) => r.number), [9]);
});

test('funnelBuckets: empty input yields empty buckets and overlay', () => {
  const b = funnelBuckets([]);
  for (const key of ['captured', 'prioritized', 'specified', 'granted', 'dispatchable', 'inFlight', 'parked', 'notPlanned', 'parents']) {
    assert.deepEqual(b[key], []);
  }
  assert.deepEqual(b.needsYou, []);
});

test('funnelBuckets: a parent record with risk/size labels lands in parents, not prioritized or captured', () => {
  const b = funnelBuckets([
    rec(1, { isParentIssue: true, risk: 'low', size: 'medium' }),
    rec(2, { isParentIssue: true }),
  ]);
  assert.deepEqual(b.parents.map((r) => r.number), [1, 2]);
  assert.deepEqual(b.prioritized, []);
  assert.deepEqual(b.captured, []);
});

test('funnelBuckets: a parent record is never specified, granted, or dispatchable even if stage is ready', () => {
  const b = funnelBuckets([
    rec(1, { isParentIssue: true, stage: 'ready' }),
    rec(2, { isParentIssue: true, stage: 'ready', grants: { build: true, merge: false } }),
  ]);
  assert.deepEqual(b.parents.map((r) => r.number), [1, 2]);
  assert.deepEqual(b.specified, []);
  assert.deepEqual(b.dispatchable, []);
  assert.deepEqual(b.granted, []);
});

test('funnelBuckets: the three buckets above parents still outrank isParentIssue', () => {
  // parents sits fourth in the if-chain: existing precedence is unchanged, so a
  // parent that is also in-flight, parked, or not-planned keeps that bucket.
  const cases = [
    ['inFlight', { bot: { inProgress: true, blocked: false } }],
    ['parked', { stage: 'parked' }],
    ['notPlanned', { notPlanned: true }],
  ];
  for (const [bucket, facetOverrides] of cases) {
    const b = funnelBuckets([rec(1, { isParentIssue: true, ...facetOverrides })]);
    assert.deepEqual(b[bucket].map((r) => r.number), [1], `parent record should land in ${bucket}`);
    assert.deepEqual(b.parents, [], `parents should stay empty for the ${bucket} case`);
  }
});

// Adjacent-precedence pins (spec Deliverables): bot-state outranks stage labels;
// granted outranks dispatchable.
test('funnelBuckets precedence: bot:in-progress + parked resolves to inFlight', () => {
  const b = funnelBuckets([rec(1, { stage: 'parked', bot: { inProgress: true, blocked: false } })]);
  assert.deepEqual(b.inFlight.map((r) => r.number), [1]);
  assert.deepEqual(b.parked, []);
});

test('funnelBuckets precedence: bot:in-progress + ready + grant resolves to inFlight', () => {
  const b = funnelBuckets([rec(1, { stage: 'ready', grants: { build: true, merge: false }, bot: { inProgress: true, blocked: false } })]);
  assert.deepEqual(b.inFlight.map((r) => r.number), [1]);
  assert.deepEqual(b.dispatchable, []);
});

test('funnelBuckets precedence: ready + grant + non-empty in-set blockedBy is granted, not dispatchable', () => {
  const records = [
    rec(1, { stage: 'ready', grants: { build: true, merge: false } }, { blockedBy: [2] }),
    rec(2, { stage: 'ready', grants: { build: false, merge: true } }),
  ];
  const b = funnelBuckets(records);
  assert.deepEqual(b.granted.map((r) => r.number), [1]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [2]);
});

test('funnelBuckets: blockedBy ids outside the open input set do not demote to granted', () => {
  const b = funnelBuckets([rec(1, { stage: 'ready', grants: { build: true, merge: false } }, { blockedBy: [999] })]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [1]);
  assert.deepEqual(b.granted, []);
});

test('funnelBuckets: blockedBy absent means every granted record is dispatchable (pre-#514 dormancy)', () => {
  const b = funnelBuckets([rec(1, { stage: 'ready', grants: { build: true, merge: true } })]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [1]);
  assert.deepEqual(b.granted, []);
});

test('funnelBuckets: facets.blockedBy (local-files driver fallback) demotes ready+granted to granted, not dispatchable', () => {
  const records = [
    rec(1, { stage: 'ready', grants: { build: true, merge: false }, blockedBy: [2] }),
    rec(2, { stage: 'ready', grants: { build: false, merge: true } }),
  ];
  const b = funnelBuckets(records);
  assert.deepEqual(b.granted.map((r) => r.number), [1]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [2]);
});

test('funnelBuckets: top-level r.blockedBy wins over facets.blockedBy when both are present', () => {
  const b = funnelBuckets([
    rec(1, { stage: 'ready', grants: { build: true, merge: false }, blockedBy: [2] }, { blockedBy: [] }),
  ]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [1]);
  assert.deepEqual(b.granted, []);
});

test('funnelBuckets: prioritized keys on priority alone — risk/size-only records fall to captured for re-triage', () => {
  const b = funnelBuckets([rec(1, { risk: 'low' }), rec(2, { size: 'medium' }), rec(3, { priority: 'low' }), rec(4)]);
  assert.deepEqual(b.prioritized.map((r) => r.number), [3]);
  assert.deepEqual(b.captured.map((r) => r.number), [1, 2, 4]);
});

test('funnelBuckets: body-text canonical declaration now resolves via blockersOf — granted, not dispatchable', () => {
  const records = [
    rec(1, { stage: 'ready', grants: { build: true, merge: false } }, { body: 'Blocked by #2' }),
    rec(2, { stage: 'ready', grants: { build: false, merge: true } }),
  ];
  const b = funnelBuckets(records);
  assert.deepEqual(b.granted.map((r) => r.number), [1]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [2]);
});

test('funnelBuckets: unsynced record blockers are never resolved against the merged set (namespace rule)', () => {
  const records = [
    rec(1, { stage: 'ready', grants: { build: true, merge: false }, unsynced: true, blockedBy: [2] }),
    rec(2, { stage: 'ready', grants: { build: false, merge: true } }),
  ];
  const b = funnelBuckets(records);
  // Record 1's facets.blockedBy [2] references a LOCAL id; record 2 here is a
  // GitHub record — cross-namespace matching is forbidden, so 1 is dispatchable.
  assert.deepEqual(b.dispatchable.map((r) => r.number), [1, 2]);
  assert.deepEqual(b.granted, []);
});

test('funnelBuckets: dormant regression pin — no needs-facets leaves every bucket byte-identical and needsYou empty', () => {
  const records = [
    rec(1, { bot: { inProgress: true, blocked: false } }),
    rec(2, { stage: 'parked' }),
    rec(3, { stage: 'ready', grants: { build: true, merge: false } }),
    rec(4, { priority: 'high' }),
    rec(5),
  ];
  const b = funnelBuckets(records);
  assert.deepEqual(b.needsYou, []);
  assert.deepEqual(b.inFlight.map((r) => r.number), [1]);
  assert.deepEqual(b.parked.map((r) => r.number), [2]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [3]);
  assert.deepEqual(b.prioritized.map((r) => r.number), [4]);
  assert.deepEqual(b.captured.map((r) => r.number), [5]);
  assert.deepEqual(b.granted, []);
  assert.deepEqual(b.specified, []);
  assert.deepEqual(b.notPlanned, []);
});

test('funnelBuckets: needs:definition record joins needsYou AND keeps its primary stage bucket (overlay semantics)', () => {
  const records = [
    rec(1, { needsDefinition: true }),
    rec(2, { stage: 'ready' }),
  ];
  const b = funnelBuckets(records);
  assert.deepEqual(b.needsYou, [{ id: 1, kind: 'definition' }]);
  assert.deepEqual(b.captured.map((r) => r.number), [1]);
  assert.deepEqual(b.specified.map((r) => r.number), [2]);
});

// solutionUnjustified is the live facet key both drivers set (record #677 rename).
test('funnelBuckets: solutionUnjustified facet joins needsYou as kind unjustified', () => {
  const b = funnelBuckets([rec(1, { solutionUnjustified: true, priority: 'low' })]);
  assert.deepEqual(b.needsYou, [{ id: 1, kind: 'unjustified' }]);
  assert.deepEqual(b.prioritized.map((r) => r.number), [1]);
});

// Both facets present: the hard gate dominates — one entry, kind definition (#471).
test('funnelBuckets: both needs-facets yield exactly one needsYou entry with kind definition (#471 precedence)', () => {
  const b = funnelBuckets([rec(1, { needsDefinition: true, solutionUnjustified: true })]);
  assert.deepEqual(b.needsYou, [{ id: 1, kind: 'definition' }]);
});

// Overlay bucket filter (spec #516, Imp 6): a record whose primary bucket is
// inFlight, parked, or notPlanned never joins needsYou even when it also
// carries a needs-facet — a bot is already building it, or it's /tidy's
// domain, not the session's recommended move.
test('funnelBuckets: bot:in-progress record with needsDefinition does NOT appear in needsYou', () => {
  const b = funnelBuckets([rec(1, { bot: { inProgress: true, blocked: false }, needsDefinition: true })]);
  assert.deepEqual(b.needsYou, []);
  assert.deepEqual(b.inFlight.map((r) => r.number), [1]);
});

test('funnelBuckets: notPlanned record with solutionUnjustified does NOT appear in needsYou', () => {
  const b = funnelBuckets([rec(1, { notPlanned: true, solutionUnjustified: true })]);
  assert.deepEqual(b.needsYou, []);
  assert.deepEqual(b.notPlanned.map((r) => r.number), [1]);
});

// #766: a decomposition parent routes to the `parents` bucket, never
// dispatchable — its needsYou launcher would misroute to `/specify #N` on a
// parent (the same defect class #616 fixed on the Specify paste block, missed
// on this overlay surface). Mirrors the inFlight/notPlanned overlay-filter
// tests above.
test('funnelBuckets: parent record with needsDefinition does NOT appear in needsYou', () => {
  const b = funnelBuckets([rec(1, { isParentIssue: true, needsDefinition: true })]);
  assert.deepEqual(b.needsYou, []);
  assert.deepEqual(b.parents.map((r) => r.number), [1]);
});

test('funnelBuckets: parent record with solutionUnjustified does NOT appear in needsYou', () => {
  const b = funnelBuckets([rec(1, { isParentIssue: true, solutionUnjustified: true })]);
  assert.deepEqual(b.needsYou, []);
  assert.deepEqual(b.parents.map((r) => r.number), [1]);
});

test('readyGrantedSubset: returns only ready+granted records, in input order', () => {
  const records = [
    rec(1, { stage: 'ready', grants: { build: true, merge: false } }),   // included (build grant)
    rec(2, { stage: 'ready', grants: { build: false, merge: true } }),   // included (merge grant)
    rec(3, { stage: 'ready', grants: { build: false, merge: false } }),  // excluded (ready, not granted)
    rec(4, { stage: 'backlog', grants: { build: true, merge: true } }),  // excluded (not ready)
    rec(5, { stage: 'parked', grants: { build: true, merge: true } }),   // excluded (not ready)
  ];
  const subset = readyGrantedSubset(records);
  assert.deepEqual(subset.map((r) => r.number), [1, 2]);
});

test('readyGrantedSubset: empty input yields empty output', () => {
  assert.deepEqual(readyGrantedSubset([]), []);
});

test('funnelBuckets: a record with native-attached top-level blockedBy lands in granted (Step 2 pre-attach target behavior)', () => {
  // Simulates what overview-mode.md Step 2's native pre-attach fetch produces: a
  // ready+granted record whose only blocker link is native (no body text, no
  // facets.blockedBy) gets its blocker attached as top-level r.blockedBy.
  const records = [
    rec(10, { stage: 'ready', grants: { build: true, merge: false } }, { body: 'no dependency prose here', blockedBy: [11] }),
    rec(11, { stage: 'ready', grants: { build: false, merge: true } }),
  ];
  const b = funnelBuckets(records);
  assert.deepEqual(b.granted.map((r) => r.number), [10]);
  assert.deepEqual(b.dispatchable.map((r) => r.number), [11]);
});

test('funnelBuckets: same native-blocked record with no pre-attach (probe-failure no-op) still lands in dispatchable, not a crash', () => {
  // Simulates the degrade path: probe/fetch failure means Step 2 attaches
  // nothing, so the record falls through to the existing behavior unchanged.
  const records = [
    rec(10, { stage: 'ready', grants: { build: true, merge: false } }, { body: 'no dependency prose here' }),
    rec(11, { stage: 'ready', grants: { build: false, merge: true } }),
  ];
  const b = funnelBuckets(records);
  assert.deepEqual(b.dispatchable.map((r) => r.number).sort(), [10, 11]);
});

// --- machineGrantOutlook (overview bare mode's config-aware `specified` annotation) ---

// Records mirror grant-gate.test.js's baseRecord — labels drive provenance/band,
// facets are derived by evaluateGrantGate when absent. Phase-1 only: `eligible`
// means "reaches grant-check", so a clear grantCheck is never part of these cases.
function outlookRecord(number, labels, overrides = {}) {
  return { number, labels, body: 'Surface: backend', ...overrides };
}

const cleanCodeHealthRow = [{ key: 'producer:code-health|low', verdict: 'clean' }];
const unattendedPolicy = { ceiling: 'unattended', grantOriginationEnabled: true };

test('machineGrantOutlook: clean-trust agent-filed record is eligible (pending grant-check)', () => {
  const out = machineGrantOutlook(
    [outlookRecord(1, ['by:code-health', 'ready', 'risk:low', 'size:low'])],
    unattendedPolicy,
    cleanCodeHealthRow,
  );
  assert.deepEqual(out.eligible, [1]);
  assert.deepEqual(out.refused, {});
});

test('machineGrantOutlook: mixed class trust refuses under failedKey trust', () => {
  const out = machineGrantOutlook(
    [outlookRecord(2, ['by:code-health', 'ready', 'risk:low', 'size:low'])],
    unattendedPolicy,
    [{ key: 'producer:code-health|low', verdict: 'mixed' }],
  );
  assert.deepEqual(out.eligible, []);
  assert.deepEqual(out.refused, { trust: [2] });
});

test('machineGrantOutlook: absent trust rows read as no-cell and refuse under trust', () => {
  const out = machineGrantOutlook(
    [outlookRecord(3, ['by:code-health', 'ready', 'risk:low', 'size:low'])],
    unattendedPolicy,
    undefined,
  );
  assert.deepEqual(out.refused, { trust: [3] });
});

test('machineGrantOutlook: human-filed record is pre-filtered via excludedOrigin, never reaches the gate chain', () => {
  const out = machineGrantOutlook(
    [outlookRecord(4, ['ready', 'risk:low', 'size:low'])],
    unattendedPolicy,
    [{ key: 'human:human|low', verdict: 'clean' }],
  );
  assert.deepEqual(out.eligible, []);
  assert.deepEqual(out.refused, {});
  assert.strictEqual(out.excludedOrigin, 1);
});

test('machineGrantOutlook: needs:definition refuses ahead of trust (gate order preserved)', () => {
  const out = machineGrantOutlook(
    [outlookRecord(5, ['by:code-health', 'ready', 'risk:low', 'size:low', 'needs:definition'])],
    unattendedPolicy,
    [],
  );
  assert.deepEqual(out.refused, { 'needs-definition': [5] });
});

test('machineGrantOutlook: refused ids aggregate per failedKey in input order alongside eligibles', () => {
  const out = machineGrantOutlook(
    [
      outlookRecord(6, ['by:code-health', 'ready', 'risk:low', 'size:low']),
      outlookRecord(7, ['ready', 'risk:low', 'size:low']),
      outlookRecord(8, ['ready', 'risk:low', 'size:low']),
    ],
    unattendedPolicy,
    [
      { key: 'producer:code-health|low', verdict: 'clean' },
      { key: 'human:human|low', verdict: 'clean' },
    ],
  );
  assert.deepEqual(out.eligible, [6]);
  assert.deepEqual(out.refused, {});
  assert.strictEqual(out.excludedOrigin, 2);
});

test('machineGrantOutlook: human-filed record with failing trust is excluded via excludedOrigin, not misattributed to refused.trust (#1387)', () => {
  const out = machineGrantOutlook(
    [outlookRecord(10, ['ready', 'risk:low', 'size:low'])],
    unattendedPolicy,
    [{ key: 'human:human|low', verdict: 'mixed' }],
  );
  assert.deepEqual(out.eligible, []);
  assert.deepEqual(out.refused, {});
  assert.strictEqual(out.excludedOrigin, 1);
});

test('machineGrantOutlook: a non-unattended ceiling refuses everything under ceiling (caller guard backstop)', () => {
  const out = machineGrantOutlook(
    [outlookRecord(9, ['by:code-health', 'ready', 'risk:low', 'size:low'])],
    { ceiling: 'trusted', grantOriginationEnabled: true },
    cleanCodeHealthRow,
  );
  assert.deepEqual(out.refused, { ceiling: [9] });
});

test('machineGrantOutlook: origin pre-filter does not engage under a non-unattended ceiling — human-filed record refuses under ceiling like everyone else (#1387 follow-up)', () => {
  const out = machineGrantOutlook(
    [outlookRecord(11, ['ready', 'risk:low', 'size:low'])],
    { ceiling: 'trusted', grantOriginationEnabled: true },
    [],
  );
  assert.deepEqual(out.eligible, []);
  assert.deepEqual(out.refused, { ceiling: [11] });
  assert.strictEqual(out.excludedOrigin, 0);
});
