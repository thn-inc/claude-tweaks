'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  recordPayload, TYPE_LABELS, CLASSIFICATION_SCORING, LABELS, DEFER_REASONS,
  extractFingerprint, extractVerifiedAsOf, parseRecordFacets, parseDependencies, parseDependencyAssumptions, specShapedBody,
  buildNativeDependencyQuery, hasOpenNativeBlocker, parseSubIssues, buildNativeSubIssuesQuery,
  buildNativeParentQuery,
  partitionByOpenBodyBlockers, partitionByOpenNativeBlockers,
  buildLinkedPRQuery, partitionByOpenLinkedPR,
} = require('../../../plugin/bin/lib/issues/record');

test('recordPayload assembles labels for a born-ready health record', () => {
  const result = recordPayload({
    title: 't', body: 'b', type: 'task', origin: 'code-health',
    risk: 'low', size: 'low', ready: true, fingerprint: 'ch:abc',
  });
  assert.deepStrictEqual(result.labels, ['by:code-health', 'risk:low', 'size:low', 'ready']);
  assert.strictEqual(result.type, 'task');
  assert.strictEqual(result.body, 'b\n\n<!-- work-fingerprint: ch:abc -->\nwork-fingerprint: ch:abc');
});

test('recordPayload assembles a plain capture record', () => {
  const result = recordPayload({ title: 't', body: 'b', type: 'feature', origin: 'capture' });
  assert.deepStrictEqual(result.labels, ['by:capture']);
  assert.strictEqual(result.body, 'b');
});

test('recordPayload with origin omitted emits no by:* label and does not throw', () => {
  const result = recordPayload({ title: 't', body: 'b', type: 'bug' });
  assert.deepStrictEqual(result.labels, []);
});

test('recordPayload throws when title is missing', () => {
  assert.throws(() => recordPayload({ body: 'b', type: 'task' }), /title/);
});

test('recordPayload throws when title is not a string', () => {
  assert.throws(() => recordPayload({ title: 5, body: 'b', type: 'task' }), /title/);
});

test('recordPayload throws when body is missing', () => {
  assert.throws(() => recordPayload({ title: 't', type: 'task' }), /body/);
});

test('recordPayload throws when body is not a string', () => {
  assert.throws(() => recordPayload({ title: 't', body: 5, type: 'task' }), /body/);
});

test('recordPayload throws on unknown type; absence never throws', () => {
  assert.throws(() => recordPayload({ title: 't', body: 'b', type: 'epic' }), /bug|feature|task/);
});

test('recordPayload throws on unknown origin', () => {
  assert.throws(() => recordPayload({ title: 't', body: 'b', type: 'task', origin: 'wrap-up' }), /origin/);
});

test('recordPayload accepts origin: docs-health', () => {
  const payload = recordPayload({ title: 'x', body: 'y', type: 'task', origin: 'docs-health' });
  assert.ok(payload.labels.includes('by:docs-health'));
});

test('recordPayload accepts origin: dispatch', () => {
  const payload = recordPayload({ title: 'x', body: 'y', type: 'task', origin: 'dispatch' });
  assert.ok(payload.labels.includes('by:dispatch'));
});

test('recordPayload throws on unknown risk', () => {
  assert.throws(() => recordPayload({ title: 't', body: 'b', type: 'task', risk: 'critical' }), /risk/);
});

test('recordPayload throws on unknown size', () => {
  assert.throws(() => recordPayload({ title: 't', body: 'b', type: 'task', size: 'gigantic' }), /size/);
});

// The emit side is size-only: a caller still passing `effort` (composed inline
// from pre-rename facets, e.g.) must fail loud rather than silently drop the
// scoring label — matches the throw-on-unknown pattern above for risk/size.
test('recordPayload throws on a legacy effort argument instead of silently dropping it', () => {
  assert.throws(
    () => recordPayload({ title: 't', body: 'b', type: 'task', effort: 'low' }),
    /effort/
  );
});

test('recordPayload throws on unknown priority', () => {
  assert.throws(() => recordPayload({ title: 't', body: 'b', type: 'task', priority: 'urgent' }), /priority/);
});

test('recordPayload throws when both ready and parked are true', () => {
  assert.throws(
    () => recordPayload({ title: 't', body: 'b', type: 'task', ready: true, parked: true }),
    /both ready and parked/
  );
});

test('recordPayload emits parked and priority labels', () => {
  const result = recordPayload({ title: 't', body: 'b', type: 'task', parked: true, priority: 'high' });
  assert.deepStrictEqual(result.labels, ['parked', 'priority:high']);
});

test('TYPE_LABELS has exactly 3 pairs naming type:bug|feature|task with descriptions <= 100 chars', () => {
  assert.strictEqual(TYPE_LABELS.length, 3);
  assert.deepStrictEqual(TYPE_LABELS.map(([name]) => name), ['type:bug', 'type:feature', 'type:task']);
  for (const [, description] of TYPE_LABELS) {
    assert.ok(description.length <= 100, `description too long: "${description}"`);
  }
});

test('recordPayload emits ceremony:{tier} when ceremony is supplied', () => {
  const result = recordPayload({ title: 't', body: 'b', type: 'task', risk: 'low', size: 'low', ceremony: 'fast-lane', ready: true });
  assert.ok(result.labels.includes('ceremony:fast-lane'));
});

test('recordPayload emits no ceremony:* label when ceremony is omitted', () => {
  const result = recordPayload({ title: 't', body: 'b', type: 'task', risk: 'low', size: 'low' });
  assert.ok(!result.labels.some((l) => l.startsWith('ceremony:')));
});

test('recordPayload throws on unknown ceremony value', () => {
  assert.throws(() => recordPayload({ title: 't', body: 'b', type: 'task', ceremony: 'medium' }), /ceremony/);
});

test('recordPayload emits labels in order: by:*, risk:*, size:*, ceremony:*, ready, parked, priority:*', () => {
  const result = recordPayload({
    title: 't', body: 'b', type: 'task', origin: 'capture',
    risk: 'low', size: 'low', ceremony: 'standard', ready: true, priority: 'high',
  });
  assert.deepStrictEqual(result.labels, ['by:capture', 'risk:low', 'size:low', 'ceremony:standard', 'ready', 'priority:high']);
});

test('recordPayload emits solution:unjustified when solutionUnjustified is truthy', () => {
  const result = recordPayload({ title: 't', body: 'b', type: 'task', risk: 'low', size: 'low', ceremony: 'standard', solutionUnjustified: true, ready: true });
  assert.ok(result.labels.includes('solution:unjustified'));
  assert.ok(!result.labels.includes('framing:baked'), 'emit side is new-spelling-only');
});

test('recordPayload emits no solution:unjustified label when solutionUnjustified is omitted', () => {
  const result = recordPayload({ title: 't', body: 'b', type: 'task', risk: 'low', size: 'low', ceremony: 'standard', ready: true });
  assert.ok(!result.labels.includes('solution:unjustified'));
  assert.ok(!result.labels.includes('framing:baked'));
});

test('recordPayload places solution:unjustified between ceremony:* and ready in the emitted array', () => {
  const result = recordPayload({
    title: 't', body: 'b', type: 'task', origin: 'capture',
    risk: 'low', size: 'low', ceremony: 'standard', solutionUnjustified: true, ready: true, priority: 'high',
  });
  assert.deepStrictEqual(result.labels, ['by:capture', 'risk:low', 'size:low', 'ceremony:standard', 'solution:unjustified', 'ready', 'priority:high']);
});

test('recordPayload throws on the pre-rename framing parameter, naming the field (mirrors the effort rejection)', () => {
  assert.throws(
    () => recordPayload({ title: 't', body: 'b', type: 'task', framing: true }),
    /framing/,
  );
});

// The classification -> scoring-axis fold the health issue-payload builders read:
// its second axis is the size facet, so its key is `size`, not `effort`.
test('CLASSIFICATION_SCORING folds each classification onto a risk/size pair', () => {
  assert.deepStrictEqual(CLASSIFICATION_SCORING.additive, { risk: 'low', size: 'low' });
  assert.deepStrictEqual(CLASSIFICATION_SCORING.restructural, { risk: 'medium', size: 'high' });
});

test('CLASSIFICATION_SCORING has no entry for a deliberately unscored kind', () => {
  assert.strictEqual(CLASSIFICATION_SCORING['new-skill'], undefined);
});

// AC 2 — dual-marker extraction

test('extractFingerprint reads the legacy code-health-fingerprint marker', () => {
  assert.strictEqual(extractFingerprint('x\n<!-- code-health-fingerprint: old:1 -->'), 'old:1');
});

test('extractFingerprint reads the new work-fingerprint marker', () => {
  assert.strictEqual(extractFingerprint('x\n<!-- work-fingerprint: new:2 -->'), 'new:2');
});

test('extractFingerprint prefers the new work-fingerprint marker when both are present', () => {
  assert.strictEqual(
    extractFingerprint('<!-- code-health-fingerprint: old:1 -->\n<!-- work-fingerprint: new:2 -->'),
    'new:2'
  );
});

test('extractFingerprint reads the legacy harness-health-fingerprint marker', () => {
  assert.strictEqual(extractFingerprint('x\n<!-- harness-health-fingerprint: hh:1 -->'), 'hh:1');
});

test('extractFingerprint reads the legacy journey-health-fingerprint marker', () => {
  assert.strictEqual(extractFingerprint('x\n<!-- journey-health-fingerprint: jh:1 -->'), 'jh:1');
});

test('extractFingerprint prefers work-fingerprint over harness-health-fingerprint', () => {
  assert.strictEqual(
    extractFingerprint('<!-- harness-health-fingerprint: hh:1 -->\n<!-- work-fingerprint: new:2 -->'),
    'new:2'
  );
});

test('extractFingerprint prefers work-fingerprint over journey-health-fingerprint', () => {
  assert.strictEqual(
    extractFingerprint('<!-- journey-health-fingerprint: jh:1 -->\n<!-- work-fingerprint: new:2 -->'),
    'new:2'
  );
});

test('extractFingerprint returns null when no marker is present', () => {
  assert.strictEqual(extractFingerprint('no markers here'), null);
});

test('extractFingerprint returns null for null, undefined, and empty-string bodies', () => {
  assert.strictEqual(extractFingerprint(null), null);
  assert.strictEqual(extractFingerprint(undefined), null);
  assert.strictEqual(extractFingerprint(''), null);
});

// AC 4 — facets

test('parseRecordFacets: by:capture + parked', () => {
  assert.deepStrictEqual(parseRecordFacets(['by:capture', 'parked']), {
    origin: 'capture', risk: null, size: null, ceremony: null, solutionUnjustified: false, breaking: false, needsDefinition: false, priority: null, stage: 'parked',
    grants: { build: false, merge: false }, bot: { inProgress: false, blocked: false, parked: false },
    acceptance: null, isParentIssue: false, notPlanned: false, shapedHeadless: false,
  });
});

test('parseRecordFacets: ready + auto:build + bot:in-progress', () => {
  const result = parseRecordFacets(['ready', 'auto:build', 'bot:in-progress']);
  assert.strictEqual(result.stage, 'ready');
  assert.deepStrictEqual(result.grants, { build: true, merge: false });
  assert.deepStrictEqual(result.bot, { inProgress: true, blocked: false, parked: false });
  assert.strictEqual(result.origin, null);
});

test('parseRecordFacets: auto:build + auto:merge grants both build and merge', () => {
  const result = parseRecordFacets(['auto:build', 'auto:merge']);
  assert.deepStrictEqual(result.grants, { build: true, merge: true });
});

test('parseRecordFacets: bot:blocked sets bot.blocked without bot.inProgress or bot.parked', () => {
  const result = parseRecordFacets(['bot:blocked']);
  assert.deepStrictEqual(result.bot, { inProgress: false, blocked: true, parked: false });
});

test('parseRecordFacets: bot:parked sets bot.parked without bot.inProgress or bot.blocked', () => {
  const result = parseRecordFacets(['bot:parked']);
  assert.deepStrictEqual(result.bot, { inProgress: false, blocked: false, parked: true });
});

test('parseRecordFacets: empty label list', () => {
  assert.deepStrictEqual(parseRecordFacets([]), {
    origin: null, risk: null, size: null, ceremony: null, solutionUnjustified: false, breaking: false, needsDefinition: false, priority: null, stage: 'backlog',
    grants: { build: false, merge: false }, bot: { inProgress: false, blocked: false, parked: false },
    acceptance: null, isParentIssue: false, notPlanned: false, shapedHeadless: false,
  });
});

// Regression test for the line-by-line finding: normalizeLabelNames's `l.name`
// branch had no null-guard, unlike its sibling helper (metrics.js's
// labelName), so a null/undefined entry in a labels array — e.g. from a
// malformed `gh api`/`gh issue list --json labels` response — threw instead
// of being skipped. (grouping.js previously had its own byte-identical
// `labelNames` copy too; it now imports normalizeLabelNames directly.)
test('parseRecordFacets: a null or undefined entry in the labels array is skipped, not thrown on', () => {
  const result = parseRecordFacets([null, 'ready', undefined, { name: 'risk:high' }]);
  assert.strictEqual(result.stage, 'ready');
  assert.strictEqual(result.risk, 'high');
});

test('parseRecordFacets: {name} label objects for risk/size/priority; wontfix sets notPlanned, not stage', () => {
  const result = parseRecordFacets([
    { name: 'risk:high' }, { name: 'size:low' }, { name: 'priority:medium' }, { name: 'wontfix' },
  ]);
  assert.strictEqual(result.risk, 'high');
  assert.strictEqual(result.size, 'low');
  assert.strictEqual(result.priority, 'medium');
  assert.strictEqual(result.stage, 'backlog');
  assert.strictEqual(result.notPlanned, true);
});

test('parseRecordFacets: wontfix label sets notPlanned', () => {
  const facets = parseRecordFacets(['wontfix']);
  assert.equal(facets.notPlanned, true);
});

test('parseRecordFacets: notPlanned defaults to false', () => {
  const facets = parseRecordFacets(['ready']);
  assert.equal(facets.notPlanned, false);
});

// AC — the size facet, and its permanent effort:* read-side fallback

test('parseRecordFacets: size:* is the primary label for the size facet', () => {
  assert.strictEqual(parseRecordFacets(['size:high']).size, 'high');
  assert.strictEqual(parseRecordFacets(['size:medium']).size, 'medium');
  assert.strictEqual(parseRecordFacets(['size:low']).size, 'low');
});

test('parseRecordFacets: a pre-rename effort:* label still resolves to facets.size', () => {
  assert.strictEqual(parseRecordFacets(['effort:high']).size, 'high');
});

test('parseRecordFacets: facets.effort is never populated — the facet is size', () => {
  assert.strictEqual(parseRecordFacets(['size:high']).effort, undefined);
  assert.strictEqual(parseRecordFacets(['effort:high']).effort, undefined);
});

test('parseRecordFacets: size:* wins over effort:* when both are present, in either array order', () => {
  assert.strictEqual(parseRecordFacets(['size:low', 'effort:high']).size, 'low');
  assert.strictEqual(parseRecordFacets(['effort:high', 'size:low']).size, 'low');
});

test('parseRecordFacets: repeated effort:* labels resolve last-wins, matching facets.size and local-store.js', () => {
  assert.strictEqual(parseRecordFacets(['effort:low', 'effort:high']).size, 'high');
  assert.strictEqual(parseRecordFacets(['effort:high', 'effort:low']).size, 'low');
});

test('parseRecordFacets: an out-of-range size:* value leaves the facet null and does not fall back to effort:*', () => {
  assert.strictEqual(parseRecordFacets(['size:gigantic']).size, null);
  assert.strictEqual(parseRecordFacets(['effort:gigantic']).size, null);
});

test('parseRecordFacets: size defaults to null when neither label is present', () => {
  assert.strictEqual(parseRecordFacets(['ready', 'risk:low']).size, null);
});

test('parseRecordFacets: malformed ready+parked resolves deterministically to ready (ready > parked)', () => {
  assert.strictEqual(parseRecordFacets(['ready', 'parked']).stage, 'ready');
});

test('parseRecordFacets: malformed parked+ready still resolves to ready regardless of array order', () => {
  assert.strictEqual(parseRecordFacets(['parked', 'ready']).stage, 'ready');
});

// AC — acceptance axis (demo skill)

test('parseRecordFacets: demo:pending sets acceptance to pending', () => {
  assert.strictEqual(parseRecordFacets(['demo:pending']).acceptance, 'pending');
});

test('parseRecordFacets: demo:approved sets acceptance to approved', () => {
  assert.strictEqual(parseRecordFacets(['demo:approved']).acceptance, 'approved');
});

test('parseRecordFacets: demo:changes-requested sets acceptance to changes-requested', () => {
  assert.strictEqual(parseRecordFacets(['demo:changes-requested']).acceptance, 'changes-requested');
});

test('parseRecordFacets: acceptance defaults to null when no demo:* label is present', () => {
  assert.strictEqual(parseRecordFacets([]).acceptance, null);
  assert.strictEqual(parseRecordFacets(['ready', 'auto:build']).acceptance, null);
});

test('parseRecordFacets: LABELS exposes the three demo:* acceptance label strings', () => {
  assert.strictEqual(LABELS.DEMO_PENDING, 'demo:pending');
  assert.strictEqual(LABELS.DEMO_APPROVED, 'demo:approved');
  assert.strictEqual(LABELS.DEMO_CHANGES_REQUESTED, 'demo:changes-requested');
});

test('parseRecordFacets: ceremony:fast-lane sets facets.ceremony', () => {
  assert.strictEqual(parseRecordFacets(['ceremony:fast-lane']).ceremony, 'fast-lane');
});

test('parseRecordFacets: ceremony:standard sets facets.ceremony', () => {
  assert.strictEqual(parseRecordFacets(['ceremony:standard']).ceremony, 'standard');
});

test('parseRecordFacets: ceremony defaults to null when the label is absent', () => {
  assert.strictEqual(parseRecordFacets([]).ceremony, null);
});

// AC 2 (record #677) — solution:unjustified axis (challenge framing-check, presence-only label;
// renamed from framing:baked — the old label stays readable forever, [IL-85]-style)

test('parseRecordFacets: solution:unjustified sets facets.solutionUnjustified to true', () => {
  assert.strictEqual(parseRecordFacets(['solution:unjustified']).solutionUnjustified, true);
});

test('parseRecordFacets: legacy framing:baked label also sets facets.solutionUnjustified to true (permanent read-side fallback)', () => {
  assert.strictEqual(parseRecordFacets(['framing:baked']).solutionUnjustified, true);
});

test('parseRecordFacets: solutionUnjustified defaults to false and there is no framing key', () => {
  const facets = parseRecordFacets(['ready', 'risk:low']);
  assert.strictEqual(facets.solutionUnjustified, false);
  assert.strictEqual(parseRecordFacets([]).solutionUnjustified, false);
  assert.ok(!('framing' in facets), 'the pre-rename facets.framing key must be gone');
});

// AC 2 (record #472) — needs:definition axis (presence-only label, /capture + /feedback)

test('parseRecordFacets: needs:definition sets facets.needsDefinition to true', () => {
  assert.strictEqual(parseRecordFacets(['needs:definition']).needsDefinition, true);
});

test('parseRecordFacets: needsDefinition defaults to false when needs:definition is absent', () => {
  assert.strictEqual(parseRecordFacets([]).needsDefinition, false);
  assert.strictEqual(parseRecordFacets(['by:capture']).needsDefinition, false);
});

// AC 5 — dependencies

test('parseDependencies collects line-anchored Blocked-by numbers in order of appearance', () => {
  assert.deepStrictEqual(parseDependencies('intro\nBlocked by #12\nBlocked by #7\ntail'), [12, 7]);
});

test('parseDependencies dedupes repeated numbers', () => {
  assert.deepStrictEqual(parseDependencies('Blocked by #12\nBlocked by #12'), [12]);
});

test('parseDependencies returns an empty array when there are no dependency lines', () => {
  assert.deepStrictEqual(parseDependencies('no deps'), []);
});

test('parseDependencies ignores mid-line occurrences (line-anchored only)', () => {
  assert.deepStrictEqual(parseDependencies('see Blocked by #9 mid-line'), []);
});

test('hasOpenNativeBlocker returns true when any blockedBy node is OPEN', () => {
  assert.strictEqual(
    hasOpenNativeBlocker({ number: 39, blockedBy: { nodes: [{ number: 14, state: 'OPEN' }] } }),
    true
  );
});

test('hasOpenNativeBlocker returns false when all blockedBy nodes are CLOSED', () => {
  assert.strictEqual(
    hasOpenNativeBlocker({ number: 39, blockedBy: { nodes: [{ number: 14, state: 'CLOSED' }] } }),
    false
  );
});

test('hasOpenNativeBlocker returns false when blockedBy has no nodes', () => {
  assert.strictEqual(hasOpenNativeBlocker({ number: 39, blockedBy: { nodes: [] } }), false);
});

test('hasOpenNativeBlocker returns false for null or undefined input', () => {
  assert.strictEqual(hasOpenNativeBlocker(null), false);
  assert.strictEqual(hasOpenNativeBlocker(undefined), false);
});

test('hasOpenNativeBlocker returns false when blockedBy is missing entirely', () => {
  assert.strictEqual(hasOpenNativeBlocker({ number: 39 }), false);
});

test('partitionByOpenBodyBlockers excludes a candidate with an open body-text blocker, naming the blocker id', () => {
  const candidates = [
    { number: 12, body: 'Blocked by #40' },
    { number: 15, body: 'no deps' },
  ];
  const { eligible, excluded } = partitionByOpenBodyBlockers(candidates, new Set([40]));
  assert.deepStrictEqual(eligible.map((c) => c.number), [15]);
  assert.deepStrictEqual(excluded, [{ number: 12, blockedBy: [40] }]);
});

test('partitionByOpenBodyBlockers keeps a candidate whose blocker is not in openNumbers (already closed)', () => {
  const candidates = [{ number: 12, body: 'Blocked by #40' }];
  const { eligible, excluded } = partitionByOpenBodyBlockers(candidates, new Set());
  assert.deepStrictEqual(eligible.map((c) => c.number), [12]);
  assert.deepStrictEqual(excluded, []);
});

test('partitionByOpenBodyBlockers reports a two-member dependency cycle as two entries naming each other', () => {
  // Neither #10 nor #11 needs cycle-specific detection — each independently fails
  // the same open-blocker check the other does, so both land in `excluded`.
  const candidates = [
    { number: 10, body: 'Blocked by #11' },
    { number: 11, body: 'Blocked by #10' },
  ];
  const { eligible, excluded } = partitionByOpenBodyBlockers(candidates, new Set([10, 11]));
  assert.deepStrictEqual(eligible, []);
  assert.deepStrictEqual(excluded, [
    { number: 10, blockedBy: [11] },
    { number: 11, blockedBy: [10] },
  ]);
});

test('partitionByOpenNativeBlockers excludes a candidate with an OPEN native blockedBy node, naming the blocker id', () => {
  const candidates = [{ number: 12 }, { number: 15 }];
  const repoData = {
    i12: { number: 12, blockedBy: { nodes: [{ number: 40, state: 'OPEN' }] } },
    i15: { number: 15, blockedBy: { nodes: [{ number: 41, state: 'CLOSED' }] } },
  };
  const { eligible, excluded } = partitionByOpenNativeBlockers(candidates, repoData);
  assert.deepStrictEqual(eligible.map((c) => c.number), [15]);
  assert.deepStrictEqual(excluded, [{ number: 12, blockedBy: [40] }]);
});

test('partitionByOpenNativeBlockers keeps a candidate missing from repoData (not work-links: native) eligible', () => {
  const candidates = [{ number: 12 }];
  const { eligible, excluded } = partitionByOpenNativeBlockers(candidates, {});
  assert.deepStrictEqual(eligible.map((c) => c.number), [12]);
  assert.deepStrictEqual(excluded, []);
});

test('partitionByOpenNativeBlockers fails safe (never throws) when blockedBy.nodes is malformed (not an array)', () => {
  const candidates = [{ number: 12 }];
  const repoData = { i12: { number: 12, blockedBy: { nodes: 'not-an-array' } } };
  assert.doesNotThrow(() => partitionByOpenNativeBlockers(candidates, repoData));
  const { eligible, excluded } = partitionByOpenNativeBlockers(candidates, repoData);
  assert.deepStrictEqual(eligible.map((c) => c.number), [12]);
  assert.deepStrictEqual(excluded, []);
});

test('partitionByOpenLinkedPR excludes a candidate with an OPEN linked PR, naming the PR number', () => {
  const candidates = [{ number: 1224 }, { number: 257 }];
  const repoData = {
    i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [{ number: 1572, state: 'OPEN' }] } },
    i257: { number: 257, closedByPullRequestsReferences: { nodes: [{ number: 900, state: 'MERGED' }] } },
  };
  const { eligible, excludedByOpenPR } = partitionByOpenLinkedPR(candidates, repoData);
  assert.deepStrictEqual(eligible.map((c) => c.number), [257]);
  assert.deepStrictEqual(excludedByOpenPR, [{ number: 1224, pr: 1572 }]);
});

test('partitionByOpenLinkedPR keeps a candidate with no linked PR eligible', () => {
  const candidates = [{ number: 42 }];
  const repoData = { i42: { number: 42, closedByPullRequestsReferences: { nodes: [] } } };
  const { eligible, excludedByOpenPR } = partitionByOpenLinkedPR(candidates, repoData);
  assert.deepStrictEqual(eligible.map((c) => c.number), [42]);
  assert.deepStrictEqual(excludedByOpenPR, []);
});

test('partitionByOpenLinkedPR keeps a candidate with only a CLOSED (unmerged) linked PR eligible', () => {
  const candidates = [{ number: 1224 }];
  const repoData = { i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [{ number: 1572, state: 'CLOSED' }] } } };
  const { eligible, excludedByOpenPR } = partitionByOpenLinkedPR(candidates, repoData);
  assert.deepStrictEqual(eligible.map((c) => c.number), [1224]);
  assert.deepStrictEqual(excludedByOpenPR, []);
});

test('partitionByOpenLinkedPR keeps a candidate missing from repoData eligible', () => {
  const candidates = [{ number: 42 }];
  const { eligible, excludedByOpenPR } = partitionByOpenLinkedPR(candidates, {});
  assert.deepStrictEqual(eligible.map((c) => c.number), [42]);
  assert.deepStrictEqual(excludedByOpenPR, []);
});

test('partitionByOpenLinkedPR fails safe (never throws) when closedByPullRequestsReferences.nodes is malformed (not an array)', () => {
  const candidates = [{ number: 42 }];
  const repoData = { i42: { number: 42, closedByPullRequestsReferences: { nodes: 'not-an-array' } } };
  assert.doesNotThrow(() => partitionByOpenLinkedPR(candidates, repoData));
  const { eligible, excludedByOpenPR } = partitionByOpenLinkedPR(candidates, repoData);
  assert.deepStrictEqual(eligible.map((c) => c.number), [42]);
  assert.deepStrictEqual(excludedByOpenPR, []);
});

test('buildLinkedPRQuery aliases each number and requests closedByPullRequestsReferences state', () => {
  const q = buildLinkedPRQuery([1224, 257]);
  assert.match(q, /i1224: issue\(number:1224\)/);
  assert.match(q, /i257: issue\(number:257\)/);
  assert.match(q, /closedByPullRequestsReferences\(first:10\)/);
  assert.match(q, /state/);
  assert.match(q, /repository\(owner:\$owner,name:\$repo\)/);
});

test('buildLinkedPRQuery also requests the cross-reference timeline, same-repo PR sources only (#1984)', () => {
  const q = buildLinkedPRQuery([1224]);
  assert.match(q, /timelineItems\(itemTypes:\[CROSS_REFERENCED_EVENT\], first:20\)/);
  assert.match(q, /\.\.\. on CrossReferencedEvent \{ source \{ \.\.\. on PullRequest/);
  assert.match(q, /merged mergedAt repository \{ nameWithOwner \}/);
});

test('buildLinkedPRQuery returns null for an empty array', () => {
  assert.strictEqual(buildLinkedPRQuery([]), null);
});

test('buildLinkedPRQuery returns null for non-array input', () => {
  assert.strictEqual(buildLinkedPRQuery(undefined), null);
});

test('buildNativeDependencyQuery aliases each number and requests blockedBy state', () => {
  const q = buildNativeDependencyQuery([39, 37]);
  assert.match(q, /i39: issue\(number:39\)/);
  assert.match(q, /i37: issue\(number:37\)/);
  assert.match(q, /blockedBy\(first:25\)/);
  assert.match(q, /state/);
  assert.match(q, /repository\(owner:\$owner,name:\$repo\)/);
});

test('buildNativeDependencyQuery returns null for an empty array', () => {
  assert.strictEqual(buildNativeDependencyQuery([]), null);
});

test('buildNativeDependencyQuery returns null for non-array input', () => {
  assert.strictEqual(buildNativeDependencyQuery(undefined), null);
});

test('buildNativeSubIssuesQuery aliases each number and requests subIssues nodes + pageInfo', () => {
  const q = buildNativeSubIssuesQuery([42, 731]);
  assert.match(q, /i42: issue\(number:42\)\{ number subIssues\(first:100\)\{ nodes\{ number \} pageInfo\{ hasNextPage \} \} \}/);
  assert.match(q, /i731: issue\(number:731\)/);
  assert.match(q, /query\(\$owner:String!,\$repo:String!\)/);
});

test('buildNativeSubIssuesQuery returns null for empty or non-array input', () => {
  assert.strictEqual(buildNativeSubIssuesQuery([]), null);
  assert.strictEqual(buildNativeSubIssuesQuery(undefined), null);
  assert.strictEqual(buildNativeSubIssuesQuery('42'), null);
});

test('buildNativeParentQuery aliases each number and requests parent number/title/state', () => {
  const q = buildNativeParentQuery([42, 731]);
  assert.match(q, /i42: issue\(number:42\)\{ number parent\{ number title state \} \}/);
  assert.match(q, /i731: issue\(number:731\)/);
  assert.match(q, /query\(\$owner:String!,\$repo:String!\)/);
});

test('buildNativeParentQuery returns null for empty or non-array input', () => {
  assert.strictEqual(buildNativeParentQuery([]), null);
  assert.strictEqual(buildNativeParentQuery(null), null);
});

// AC — dependency assumptions (cross-spec-promise-tracking)

test('parseDependencyAssumptions captures trailing text after the colon', () => {
  assert.deepStrictEqual(
    parseDependencyAssumptions('Blocked by #14: needs getStatus() to exist'),
    [{ number: 14, assumption: 'needs getStatus() to exist' }],
  );
});

test('parseDependencyAssumptions handles multiple lines in order of appearance', () => {
  assert.deepStrictEqual(
    parseDependencyAssumptions('Blocked by #12: first thing\nBlocked by #7: second thing'),
    [
      { number: 12, assumption: 'first thing' },
      { number: 7, assumption: 'second thing' },
    ],
  );
});

test('parseDependencyAssumptions omits bare Blocked-by lines with no colon', () => {
  assert.deepStrictEqual(
    parseDependencyAssumptions('Blocked by #12\nBlocked by #7: has text'),
    [{ number: 7, assumption: 'has text' }],
  );
});

test('parseDependencyAssumptions returns an empty array when there are no assumption lines', () => {
  assert.deepStrictEqual(parseDependencyAssumptions('Blocked by #9\nno colon here'), []);
});

test('parseDependencyAssumptions ignores mid-line occurrences (line-anchored only)', () => {
  assert.deepStrictEqual(
    parseDependencyAssumptions('see Blocked by #9: mid-line text'),
    [],
  );
});

test('parseDependencyAssumptions trims leading whitespace after the colon', () => {
  assert.deepStrictEqual(
    parseDependencyAssumptions('Blocked by #3:    padded text'),
    [{ number: 3, assumption: 'padded text' }],
  );
});

test('parseDependencyAssumptions does not let a bare colon-only line swallow the next line', () => {
  assert.deepStrictEqual(
    parseDependencyAssumptions('Blocked by #3:\nBlocked by #7: real assumption'),
    [{ number: 7, assumption: 'real assumption' }],
  );
});

test('specShapedBody composes the gate-verified skeleton with string sections', () => {
  const body = specShapedBody({
    header: '**Kind:** x',
    currentState: 'the state',
    deliverables: 'the work',
    acceptanceCriteria: 'the proof',
    filedBy: '/claude-tweaks:harness-health',
  });
  assert.strictEqual(body, [
    '**Kind:** x',
    '## Current State',
    'the state',
    '## Deliverables',
    'the work',
    '## Acceptance Criteria',
    'the proof',
    '_Filed by `/claude-tweaks:harness-health`. Close to resolve; label `wontfix` to suppress future reports of this finding._',
  ].join('\n\n'));
});

test('specShapedBody renders array sections as blank-line-separated blocks', () => {
  const body = specShapedBody({
    header: 'h',
    currentState: ['block one', 'block two'],
    deliverables: 'd',
    acceptanceCriteria: 'a',
    filedBy: '/claude-tweaks:code-health',
  });
  assert.ok(body.includes('## Current State\n\nblock one\n\nblock two\n\n## Deliverables'));
});

test('specShapedBody throws on a missing or empty section', () => {
  assert.throws(() => specShapedBody({ header: 'h', currentState: '', deliverables: 'd', acceptanceCriteria: 'a', filedBy: 'f' }), /currentState/);
  assert.throws(() => specShapedBody({ header: 'h', currentState: 'c', deliverables: 'd', acceptanceCriteria: 'a' }), /filedBy/);
  assert.throws(() => specShapedBody({ header: 'h', currentState: [], deliverables: 'd', acceptanceCriteria: 'a', filedBy: 'f' }), /currentState/);
});

test('parseSubIssues reads a parent task list', () => {
  const body = 'Design summary\n\n- [ ] #46\n- [x] #47\n- [ ] #48\n';
  assert.deepEqual(parseSubIssues(body), [46, 47, 48]);
});

test('parseSubIssues ignores mid-line mentions and dedupes', () => {
  // Mirrors parseDependencies: only a line-anchored entry declares a sub-issue.
  const body = 'see - [ ] #99 inline\n- [ ] #46\n- [ ] #46\n';
  assert.deepEqual(parseSubIssues(body), [46]);
});

test('parseSubIssues returns empty for absent or non-string bodies', () => {
  assert.deepEqual(parseSubIssues(''), []);
  assert.deepEqual(parseSubIssues(undefined), []);
  assert.deepEqual(parseSubIssues('no task list here'), []);
});

test('parseRecordFacets sets isParentIssue from the parent-issue label', () => {
  assert.strictEqual(parseRecordFacets([{ name: 'parent-issue' }]).isParentIssue, true);
});

test('parseRecordFacets sets isParentIssue from the legacy family:parent label', () => {
  // Contract, not implementation echo: legacy labels on adopter repos must keep working ([IL-85]).
  assert.strictEqual(parseRecordFacets([{ name: 'family:parent' }]).isParentIssue, true);
});

test('parseRecordFacets defaults isParentIssue to false', () => {
  assert.strictEqual(parseRecordFacets([]).isParentIssue, false);
  assert.strictEqual(parseRecordFacets([{ name: 'ready' }]).isParentIssue, false);
});

test('parseRecordFacets: shaped:headless sets shapedHeadless: true', () => {
  const facets = parseRecordFacets(['shaped:headless']);
  assert.strictEqual(facets.shapedHeadless, true);
});

test('parseRecordFacets: shapedHeadless defaults to false when absent', () => {
  const facets = parseRecordFacets(['ready']);
  assert.strictEqual(facets.shapedHeadless, false);
});

test('parseRecordFacets: shaped:headless alongside an unrelated third label family leaves every other facet unchanged (orthogonal-category rule)', () => {
  const facets = parseRecordFacets(['shaped:headless', 'risk:high', 'bot:blocked']);
  assert.strictEqual(facets.shapedHeadless, true);
  assert.strictEqual(facets.risk, 'high');
  assert.strictEqual(facets.bot.blocked, true);
  assert.strictEqual(facets.bot.inProgress, false);
  assert.strictEqual(facets.stage, 'backlog');
});

// --- Defer-reason vocabulary (_shared/deferral-gate.md, #620) ---

test('DEFER_REASONS is the frozen six-value closed vocabulary, in contract order', () => {
  assert.deepStrictEqual([...DEFER_REASONS], [
    'tangential', 'needs-human-decision', 'pre-existing-outside-diff',
    'genuinely-larger', 'blocked-external', 'blocked-dependency',
  ]);
  assert.ok(Object.isFrozen(DEFER_REASONS));
});

test('recordPayload: an unknown deferReason throws naming the field', () => {
  assert.throws(
    () => recordPayload({ title: 't', body: 'b', type: 'task', deferReason: 'minor' }),
    /deferReason/,
  );
});

test('recordPayload: a valid deferReason renders as the first body line for a body starting at ## Current State', () => {
  const p = recordPayload({ title: 't', body: '## Current State\nx', type: 'task', deferReason: 'tangential' });
  assert.ok(p.body.startsWith('Defer-reason: tangential\n\n## Current State\nx'));
});

test('recordPayload: a valid deferReason renders as the first body line ahead of pre-heading prose', () => {
  const p = recordPayload({ title: 't', body: 'Intro paragraph.\n\n## Current State\nx', type: 'task', deferReason: 'tangential' });
  assert.ok(p.body.startsWith('Defer-reason: tangential\n\nIntro paragraph.'));
});

test('recordPayload: a body already carrying a matching Defer-reason: line is left unchanged (exactly one line)', () => {
  const body = 'Defer-reason: tangential\n\n## Current State\nx';
  const p = recordPayload({ title: 't', body, type: 'task', deferReason: 'tangential' });
  assert.strictEqual(p.body, body);
  assert.strictEqual((p.body.match(/^Defer-reason: /gm) || []).length, 1);
});

test('recordPayload: a body carrying a mismatching Defer-reason: line throws', () => {
  assert.throws(
    () => recordPayload({ title: 't', body: 'Defer-reason: genuinely-larger\n\n## Current State\nx', type: 'task', deferReason: 'tangential' }),
    /Defer-reason/,
  );
});

test('recordPayload: a body-carried Defer-reason: line with trailing whitespace still suppresses insertion', () => {
  const body = 'Defer-reason: tangential \n\n## Current State\nx';
  const p = recordPayload({ title: 't', body, type: 'task', deferReason: 'tangential' });
  assert.strictEqual((p.body.match(/^Defer-reason: /gm) || []).length, 1);
});

test('recordPayload: omitting deferReason leaves the body byte-identical and adds no label', () => {
  const body = 'Intro.\n\n## Current State\nx';
  const p = recordPayload({ title: 't', body, type: 'task' });
  assert.strictEqual(p.body, body);
  assert.deepStrictEqual(p.labels, []);
});

test('recordPayload: deferReason never becomes a label and leaves label order unchanged', () => {
  const p = recordPayload({ title: 't', body: 'b', type: 'task', origin: 'capture', risk: 'low', ready: true, deferReason: 'blocked-external' });
  assert.deepStrictEqual(p.labels, ['by:capture', 'risk:low', 'ready']);
});

test('recordPayload: deferReason and fingerprint compose — reason first line, fingerprint markers last', () => {
  const p = recordPayload({ title: 't', body: 'b', type: 'task', deferReason: 'tangential', fingerprint: 'fp-1' });
  assert.ok(p.body.startsWith('Defer-reason: tangential\n\nb'));
  assert.ok(p.body.includes('<!-- work-fingerprint: fp-1 -->'));
  assert.ok(p.body.endsWith('\nwork-fingerprint: fp-1'));
});

// --- extractFingerprint: plain-text companion fallback (#1700) ---

test('extractFingerprint reads the plain-text work-fingerprint companion when no HTML-comment marker is present (MCP-stripped body)', () => {
  assert.strictEqual(extractFingerprint('x\nwork-fingerprint: plain:1'), 'plain:1');
});

test('extractFingerprint prefers the HTML-comment work-fingerprint marker over the plain-text companion when both are present', () => {
  assert.strictEqual(
    extractFingerprint('<!-- work-fingerprint: html:1 -->\nwork-fingerprint: html:1'),
    'html:1',
  );
});

test('recordPayload writes both the HTML-comment marker and the plain-text companion, and extractFingerprint recovers the fingerprint from either alone', () => {
  const p = recordPayload({ title: 't', body: 'b', type: 'task', fingerprint: 'dual:1' });
  assert.ok(p.body.includes('<!-- work-fingerprint: dual:1 -->'));
  assert.ok(p.body.includes('work-fingerprint: dual:1'));
  // Simulate an MCP read that strips every HTML-comment span, leaving only the
  // plain-text companion line — extractFingerprint must still recover it.
  const strippedBody = p.body.replace(/<!--[\s\S]*?-->\n?/g, '');
  assert.strictEqual(extractFingerprint(strippedBody), 'dual:1');
});

// --- specShapedBody provenance / footer / openQuestion (#623) ---

const BASE = { currentState: 'c', deliverables: 'd', filedBy: 'x' };

test('specShapedBody: no new args is byte-identical to the pre-change composition (health parity)', () => {
  const body = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a' });
  assert.strictEqual(body, [
    'H', '## Current State', 'c', '## Deliverables', 'd', '## Acceptance Criteria', 'a',
    '_Filed by `x`. Close to resolve; label `wontfix` to suppress future reports of this finding._',
  ].join('\n\n'));
});

test('specShapedBody: provenance origin renders between header and Current State', () => {
  const body = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', provenance: { origin: 'wrap-up leftover from #42' } });
  assert.ok(body.startsWith('H\n\nOrigin: wrap-up leftover from #42\n\n## Current State'));
});

test('specShapedBody: provenance deferReason renders after origin, validated against DEFER_REASONS', () => {
  const body = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', provenance: { origin: 'o', deferReason: 'tangential' } });
  assert.ok(body.includes('Origin: o\n\nDefer-reason: tangential\n\n## Current State'));
  assert.throws(
    () => specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', provenance: { deferReason: 'minor' } }),
    /deferReason/,
  );
});

test('specShapedBody: deferReason alone renders with no Origin line and no stray blanks', () => {
  const body = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', provenance: { deferReason: 'genuinely-larger' } });
  assert.ok(body.startsWith('H\n\nDefer-reason: genuinely-larger\n\n## Current State'));
  assert.ok(!body.includes('Origin:'));
});

test('specShapedBody: custom footer replaces the default; null omits it entirely', () => {
  const custom = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', footer: '_Filed by `wrap-up leftover routing` via specShapedBody._' });
  assert.ok(custom.endsWith('via specShapedBody._'));
  assert.ok(!custom.includes('wontfix'));
  const none = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', footer: null });
  assert.ok(none.endsWith('\n\na'));
});

test('specShapedBody: openQuestion renders in place of Acceptance Criteria; empty header renders nothing', () => {
  const body = specShapedBody({ header: '', ...BASE, openQuestion: 'which store?', footer: null });
  assert.ok(body.startsWith('## Current State'));
  assert.ok(body.includes('## Open Question\n\nwhich store?'));
  assert.ok(!body.includes('## Acceptance Criteria'));
});

test('specShapedBody: acceptanceCriteria and openQuestion are mutually exclusive — both or neither throws', () => {
  assert.throws(() => specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', openQuestion: 'q' }), /exactly one/);
  assert.throws(() => specShapedBody({ header: 'H', ...BASE }), /exactly one/);
});

test('specShapedBody: the required sections still throw when empty, naming the section', () => {
  assert.throws(() => specShapedBody({ header: 'H', currentState: '', deliverables: 'd', acceptanceCriteria: 'a', filedBy: 'x' }), /currentState/);
  assert.throws(() => specShapedBody({ header: 'H', currentState: 'c', deliverables: 'd', acceptanceCriteria: 'a' }), /filedBy/);
  assert.throws(() => specShapedBody({ header: 'H', currentState: 'c', deliverables: 'd', openQuestion: '' , filedBy: 'x'}), /exactly one|openQuestion/);
});

test('specShapedBody: header plus Trigger line renders first, before provenance', () => {
  const body = specShapedBody({ header: 'Trigger: after #42 lands', ...BASE, acceptanceCriteria: 'a', provenance: { origin: 'wrap-up leftover from #42', deferReason: 'tangential' }, footer: '_Filed by `wrap-up leftover routing` via specShapedBody._' });
  assert.ok(body.startsWith('Trigger: after #42 lands\n\nOrigin: wrap-up leftover from #42\n\nDefer-reason: tangential\n\n## Current State'));
});

// --- specShapedBody / extractVerifiedAsOf freshness stamp (#117) ---

test('specShapedBody: omitting verifiedAsOf is byte-identical to the pre-change composition', () => {
  const body = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a' });
  assert.strictEqual(body, [
    'H', '## Current State', 'c', '## Deliverables', 'd', '## Acceptance Criteria', 'a',
    '_Filed by `x`. Close to resolve; label `wontfix` to suppress future reports of this finding._',
  ].join('\n\n'));
});

test('specShapedBody: verifiedAsOf renders between header and Origin, lowercased', () => {
  const body = specShapedBody({
    header: 'H', ...BASE, acceptanceCriteria: 'a', verifiedAsOf: 'ABCDEF1', provenance: { origin: 'o' },
  });
  assert.ok(body.startsWith('H\n\nVerified-as-of: abcdef1\n\nOrigin: o\n\n## Current State'));
});

test('specShapedBody: verifiedAsOf alone (no header, no provenance) renders with no stray blanks', () => {
  const body = specShapedBody({ ...BASE, acceptanceCriteria: 'a', verifiedAsOf: '1234567' });
  assert.ok(body.startsWith('Verified-as-of: 1234567\n\n## Current State'));
});

test('specShapedBody: verifiedAsOf rejects a value that is not a git sha shape', () => {
  assert.throws(
    () => specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', verifiedAsOf: '2026-08-19' }),
    /verifiedAsOf must be a git commit sha/,
  );
  assert.throws(
    () => specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', verifiedAsOf: 'main' }),
    /verifiedAsOf must be a git commit sha/,
  );
});

test('specShapedBody: verifiedAsOf accepts both abbreviated (7-char) and full (40-char) shas', () => {
  assert.doesNotThrow(() => specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', verifiedAsOf: '1234567' }));
  assert.doesNotThrow(() => specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', verifiedAsOf: '1234567890abcdef1234567890abcdef12345678' }));
});

test('extractVerifiedAsOf: reads the sha back off a composed body', () => {
  const body = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', verifiedAsOf: 'abc1234' });
  assert.strictEqual(extractVerifiedAsOf(body), 'abc1234');
});

test('extractVerifiedAsOf: null when absent, when body is empty, and for non-string input', () => {
  assert.strictEqual(extractVerifiedAsOf('## Current State\nno stamp here'), null);
  assert.strictEqual(extractVerifiedAsOf(''), null);
  assert.strictEqual(extractVerifiedAsOf(null), null);
  assert.strictEqual(extractVerifiedAsOf(undefined), null);
});

test('extractVerifiedAsOf: is line-anchored — prose mentioning a commit elsewhere does not match', () => {
  const body = 'See commit abc1234 for background.\n\n## Current State\nx';
  assert.strictEqual(extractVerifiedAsOf(body), null);
});

test('parseRecordFacets: breaking label sets facets.breaking to true (presence-only Compatibility axis, #2251)', () => {
  assert.strictEqual(parseRecordFacets(['breaking']).breaking, true);
  assert.strictEqual(parseRecordFacets([{ name: 'breaking' }]).breaking, true);
});

test('parseRecordFacets: facets.breaking defaults to false, never undefined', () => {
  assert.strictEqual(parseRecordFacets([]).breaking, false);
  assert.strictEqual(parseRecordFacets(['ready', 'type:feature']).breaking, false);
});

test('LABELS.BREAKING is exported and matches the canonical bootstrap row', () => {
  assert.strictEqual(LABELS.BREAKING, 'breaking');
});
