// tests/bin-lib/issues/near-duplicate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  findNearDuplicates,
  tokenizeTitle,
  jaccard,
  isReconcileResidueTitle,
  DEFAULT_TITLE_SIMILARITY_THRESHOLD,
  extractCurrentStateAnchors,
  isGenericAnchor,
  shapingRefusal,
  buildShapingState,
  MIN_REFUSAL_SCORE,
  STRONG_NEAR_DUPLICATE_MIN,
  isStrongNearDuplicate,
} = require('../../../plugin/bin/lib/issues/near-duplicate');

function withKeyFiles(files) {
  return `## Current State\n\nn/a\n\n## Technical Approach\n\n### Key Files\n\n${files.map((f) => `- \`${f}\` — modify`).join('\n')}\n`;
}

// ── each signal fires alone ─────────────────────────────────────────────────

test('key-files-overlap fires alone on 2+ shared paths, unrelated title/body', () => {
  const subject = { number: 1, title: 'Completely unrelated title alpha', body: withKeyFiles(['a.js', 'b.js']) };
  const record = { number: 2, title: 'Something else entirely zeta', body: withKeyFiles(['a.js', 'b.js', 'c.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['key-files-overlap']);
});

test('key-files-overlap fires on a single shared path when either list has <=2 entries', () => {
  const subject = { number: 1, title: 'Grapefruit orchard survey plan', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'Winter hiking boot review notes', body: withKeyFiles(['a.js', 'x.js', 'y.js', 'z.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['key-files-overlap']);
});

test('a single shared path does NOT fire when both lists have 3+ entries', () => {
  const subject = { number: 1, title: 'Grapefruit orchard survey plan', body: withKeyFiles(['a.js', 'b.js', 'c.js']) };
  const record = { number: 2, title: 'Winter hiking boot review notes', body: withKeyFiles(['a.js', 'x.js', 'y.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('title-similarity fires alone on unrelated key files/bodies', () => {
  const subject = { number: 1, title: 'Detect near-duplicate open records before build', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'Detect near-duplicate open records at build time', body: withKeyFiles(['z.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['title-similarity']);
});

test('body-anchor-overlap fires alone on a shared backticked symbol in Current State, unrelated titles/key files', () => {
  const subject = {
    number: 1,
    title: 'Alpha unrelated title here',
    body: '## Current State\n\nThe check lives in `bin/lib/issues/grouping.js`.\n\n## Technical Approach\n\n### Key Files\n\n- `a.js` — modify\n',
  };
  const record = {
    number: 2,
    title: 'Zeta unrelated title elsewhere',
    body: '## Current State\n\nAlso touches `bin/lib/issues/grouping.js` directly.\n\n## Technical Approach\n\n### Key Files\n\n- `z.js` — modify\n',
  };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['body-anchor-overlap']);
});

// ── thresholds honoured ──────────────────────────────────────────────────────

test(`title similarity below the default ${DEFAULT_TITLE_SIMILARITY_THRESHOLD} threshold does not fire`, () => {
  const subject = { number: 1, title: 'dispatch queue pull script', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'wrap-up review console summary', body: withKeyFiles(['z.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('title similarity threshold is overridable via opts', () => {
  const subject = { number: 1, title: 'alpha beta gamma delta', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'alpha beta zeta eta', body: withKeyFiles(['z.js']) };
  // shared {alpha,beta} of union {alpha,beta,gamma,delta,zeta,eta} = 2/6 = 0.333
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
  const [hit] = findNearDuplicates(subject, [record], { titleSimilarityThreshold: 0.3 });
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['title-similarity']);
});

// ── exclusions honoured ──────────────────────────────────────────────────────

test('a record carrying parent-issue is excluded entirely', () => {
  const subject = { number: 1, title: 'dispatch pre-build duplicate check', body: withKeyFiles(['a.js', 'b.js']) };
  const record = {
    number: 2,
    title: 'dispatch pre-build duplicate check',
    body: withKeyFiles(['a.js', 'b.js']),
    labels: ['parent-issue'],
  };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('a record carrying parked is excluded entirely', () => {
  const subject = { number: 1, title: 'dispatch pre-build duplicate check', body: withKeyFiles(['a.js', 'b.js']) };
  const record = {
    number: 2,
    title: 'dispatch pre-build duplicate check',
    body: withKeyFiles(['a.js', 'b.js']),
    labels: ['parked'],
  };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('the subject\'s own number is excluded even if present in the records pool', () => {
  const subject = { number: 1, title: 'dispatch pre-build duplicate check', body: withKeyFiles(['a.js', 'b.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [subject]), []);
});

test('a reconcile: residue title is excluded from the title-similarity signal only, not from key-files overlap', () => {
  const subject = { number: 1, title: 'reconcile: structurally-stuck on worktree X', body: withKeyFiles(['a.js', 'b.js']) };
  const record = { number: 2, title: 'reconcile: structurally-stuck on worktree Y', body: withKeyFiles(['a.js', 'b.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit, 'key-files-overlap must still fire for a reconcile-residue pair');
  assert.deepStrictEqual(hit.signals, ['key-files-overlap']);
});

test('isReconcileResidueTitle is case-insensitive and requires the leading colon form', () => {
  assert.strictEqual(isReconcileResidueTitle('Reconcile: structurally-stuck on X'), true);
  assert.strictEqual(isReconcileResidueTitle('reconciled the worktree'), false);
});

// ── #1821/#1224-shaped fixture: each returns the other as a candidate ───────

test('a fixture built from the #1821/#1224 shape returns each as the other\'s candidate', () => {
  const record1821 = {
    number: 1821,
    title: 'dispatch: open-linked-PR exclusion misses a merged PR mentioning the record without a closing keyword',
    body: '## Current State\n\n`bin/lib/issues/record.js`\'s `partitionByOpenLinkedPR` only reads `closedByPullRequestsReferences`.\n\n## Technical Approach\n\n### Key Files\n\n- `plugin/bin/lib/issues/record.js` — extend query\n- `plugin/skills/dispatch/queue-pull-script.md` — new step\n',
  };
  const record1224 = {
    number: 1224,
    title: 'dispatch: open linked PR exclusion misses a merged PR that mentions the record without a closing keyword',
    body: '## Current State\n\nSame root cause in `bin/lib/issues/record.js`\'s `partitionByOpenLinkedPR`.\n\n## Technical Approach\n\n### Key Files\n\n- `plugin/bin/lib/issues/record.js` — extend query\n- `plugin/skills/dispatch/queue-pull-script.md` — new step\n',
  };
  const forward = findNearDuplicates(record1821, [record1224]);
  assert.strictEqual(forward.length, 1);
  assert.strictEqual(forward[0].number, 1224);
  assert.ok(forward[0].signals.includes('key-files-overlap'));
  assert.ok(forward[0].signals.includes('title-similarity'));

  const backward = findNearDuplicates(record1224, [record1821]);
  assert.strictEqual(backward.length, 1);
  assert.strictEqual(backward[0].number, 1821);
});

// ── unrelated records return nothing ─────────────────────────────────────────

test('unrelated fixtures return []', () => {
  const subject = { number: 1, title: 'Add a statusline git segment', body: withKeyFiles(['plugin/bin/statusline.js']) };
  const record = { number: 2, title: 'Fix flaky Playwright timeout in QA harness', body: withKeyFiles(['tests/qa/timeout.test.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('findNearDuplicates([]) and empty records pool both return []', () => {
  assert.deepStrictEqual(findNearDuplicates({ number: 1, title: 'x', body: '' }, []), []);
  assert.deepStrictEqual(findNearDuplicates({ number: 1, title: 'x', body: '' }, null), []);
});

// ── tokenizer / jaccard unit coverage ───────────────────────────────────────

test('tokenizeTitle strips #refs, numbers, and stop words', () => {
  const tokens = tokenizeTitle('Fix #1224 — the dispatch check for a duplicate 42 record');
  assert.ok(!tokens.includes('1224'));
  assert.ok(!tokens.includes('42'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('a'));
  assert.ok(!tokens.includes('for'));
  assert.ok(tokens.includes('dispatch'));
  assert.ok(tokens.includes('duplicate'));
  assert.ok(tokens.includes('record'));
});

test('jaccard of two empty token sets is 0, never throws', () => {
  assert.strictEqual(jaccard([], []), 0);
});

test('sorting: multiple candidates sort by score descending then number ascending', () => {
  const subject = {
    number: 1,
    title: 'dispatch pre-build near-duplicate check',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `a.js` — modify\n',
  };
  const twoSignal = {
    number: 20,
    title: 'dispatch pre-build near-duplicate check',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `z.js` — modify\n',
  };
  const oneSignalLow = {
    number: 5,
    title: 'totally unrelated',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `y.js` — modify\n',
  };
  const oneSignalHigh = {
    number: 30,
    title: 'totally unrelated too',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `w.js` — modify\n',
  };
  const results = findNearDuplicates(subject, [oneSignalHigh, twoSignal, oneSignalLow]);
  assert.deepStrictEqual(results.map((r) => r.number), [20, 5, 30]);
});

// ── #3141: generic tokens are not body anchors ──────────────────────────────

test('extractCurrentStateAnchors drops flag, skill-invocation and label-name spans', () => {
  const body = '## Current State\n\nRuns `--run-dir` and `-x` and `--run <dir>`; see `/claude-tweaks:dispatch`, `/claude-tweaks:flow #3124 build`; labels `bot:in-progress`, `risk:low`, `ready`, `parked`.\n\n## Deliverables\n';
  assert.deepStrictEqual([...extractCurrentStateAnchors(body)], []);
});

test('extractCurrentStateAnchors keeps file paths, symbols and file:line locations', () => {
  const body = '## Current State\n\n`plugin/skills/simplify/SKILL.md`, `classifyClaimBlob`, `near-duplicate.js:92`, `## Current State`.\n';
  assert.deepStrictEqual(
    [...extractCurrentStateAnchors(body)].sort(),
    ['## Current State', 'classifyClaimBlob', 'near-duplicate.js:92', 'plugin/skills/simplify/SKILL.md'],
  );
});

test('AC3.1: extractCurrentStateAnchors keeps anchors after a fenced # comment line inside Current State (#4369)', () => {
  const body = '## Current State\n\n`alpha.js`\n```bash\n# comment\nrun it\n```\n`beta.js`\n\n## Deliverables\n`gamma.js`\n';
  assert.deepStrictEqual([...extractCurrentStateAnchors(body)].sort(), ['alpha.js', 'beta.js']);
});

test('extractCurrentStateAnchors: a fenced ## Current State line does not start the section (#4369)', () => {
  const body = '## Summary\n```\n## Current State\n`fake.js`\n```\n';
  assert.deepStrictEqual([...extractCurrentStateAnchors(body)], []);
});

test('extractCurrentStateAnchors: a CRLF body still finds its Current State anchors (#4369)', () => {
  const body = '## Current State\r\n\r\n`alpha.js`\r\n```bash\r\n# comment\r\n```\r\n`beta.js`\r\n\r\n## Deliverables\r\n`gamma.js`\r\n';
  assert.deepStrictEqual([...extractCurrentStateAnchors(body)].sort(), ['alpha.js', 'beta.js']);
});

test('isGenericAnchor classifies each shape', () => {
  for (const g of ['--run-dir', '-x', '--run <dir>', '--key=value', '/claude-tweaks:dispatch', '/claude-tweaks:flow #3124 build', '/flow', '/specify', '/tmp', 'bot:in-progress', 'needs:decision', 'ready', 'parked']) {
    assert.strictEqual(isGenericAnchor(g), true, g);
  }
  for (const k of ['plugin/bin/lib/issues/claims.js', 'classifyClaimBlob', 'near-duplicate.js:92', 'origin/main:claims/issue-1.json', 'readiness', 'c:\\Users\\x', '--run path rejected', '/usr/bin/node', '/settings page 500', 'plugin/bin/lib/issues/near-duplicate.js']) {
    assert.strictEqual(isGenericAnchor(k), false, k);
  }
});

test('a flag-only shared anchor no longer fires body-anchor-overlap; a shared file path still does', () => {
  const subject = { number: 1, title: 'Materialize docs drift', body: '## Current State\n\nUses `--run-dir` and `bin/lib/x.js`.\n' };
  const flagOnly = { number: 2, title: 'Wrap-up verify checks', labels: [], body: '## Current State\n\nPasses `--run-dir`.\n' };
  const fileToo = { number: 3, title: 'Unrelated title words', labels: [], body: '## Current State\n\nEdits `bin/lib/x.js`.\n' };
  const hits = findNearDuplicates(subject, [flagOnly, fileToo]);
  assert.deepStrictEqual(hits.map((h) => [h.number, h.signals]), [[3, ['body-anchor-overlap']]]);
});

// ── #3366: slash-command anchors are generic, repo file paths are not ───────

test('AC1.1: a pair sharing only /flow and /claude-tweaks:dispatch anchors fires no body-anchor-overlap', () => {
  const subject = {
    number: 1,
    title: 'Grapefruit orchard survey plan',
    body: '## Current State\n\nRuns `/flow` then `/claude-tweaks:dispatch`.\n',
  };
  const record = {
    number: 2,
    title: 'Winter hiking boot review notes',
    body: '## Current State\n\nAlso runs `/flow` and `/claude-tweaks:dispatch`.\n',
  };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('AC2.1: a pair sharing a repo file-path anchor still fires body-anchor-overlap', () => {
  const subject = {
    number: 1,
    title: 'Grapefruit orchard survey plan',
    body: '## Current State\n\nRuns `/flow`, edits `plugin/skills/dispatch/task-prompt.md`.\n',
  };
  const record = {
    number: 2,
    title: 'Winter hiking boot review notes',
    body: '## Current State\n\nAlso runs `/flow`, edits `plugin/skills/dispatch/task-prompt.md`.\n',
  };
  const hits = findNearDuplicates(subject, [record]);
  assert.deepStrictEqual(hits.map((h) => [h.number, h.signals]), [[2, ['body-anchor-overlap']]]);
});

// ── #3141: shapingRefusal ───────────────────────────────────────────────────

const LIVE = { ready: true, liveClaim: true, claimRunId: 'run-a', openLinkedPR: null };
const IDLE = { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null };

test('the four 2026-10-15 refusals are not refused (no title-similarity)', () => {
  const cases = [
    { number: 2552, signals: ['body-anchor-overlap'] },
    { number: 2552, signals: ['body-anchor-overlap'] },
    { number: 2634, signals: ['key-files-overlap', 'body-anchor-overlap'] },
    { number: 2789, signals: ['key-files-overlap', 'body-anchor-overlap'] },
  ];
  for (const hit of cases) {
    assert.strictEqual(shapingRefusal([hit], { [hit.number]: LIVE }), null, String(hit.number));
  }
});

test('a true duplicate (title-similarity, ready, live claim) is refused', () => {
  const hit = { number: 9, signals: ['title-similarity', 'key-files-overlap'] };
  assert.strictEqual(shapingRefusal([hit], { 9: LIVE }), hit);
});

test('a score-1 title-similarity duplicate is surfaced, not refused (#3366)', () => {
  assert.strictEqual(shapingRefusal([{ number: 9, signals: ['title-similarity'] }], { 9: LIVE }), null);
  assert.strictEqual(MIN_REFUSAL_SCORE, 2);
});

test('the same duplicate with only bot:in-progress (stale claim) is not refused', () => {
  const hit = { number: 9, signals: ['title-similarity', 'key-files-overlap'] };
  assert.strictEqual(shapingRefusal([hit], { 9: IDLE }), null);
});

test('an open linked PR with no live claim is refused', () => {
  const hit = { number: 9, signals: ['title-similarity', 'key-files-overlap'] };
  assert.strictEqual(shapingRefusal([hit], { 9: { ...IDLE, openLinkedPR: 77 } }), hit);
});

test('a non-ready candidate is not refused even with a live claim', () => {
  const hit = { number: 9, signals: ['title-similarity', 'key-files-overlap'] };
  assert.strictEqual(shapingRefusal([hit], { 9: { ...LIVE, ready: false } }), null);
});

test('a candidate missing from stateByNumber is not refused', () => {
  assert.strictEqual(shapingRefusal([{ number: 9, signals: ['title-similarity', 'key-files-overlap'] }], {}), null);
});

test('shapingRefusal returns the first qualifying hit in the given order', () => {
  const a = { number: 1, signals: ['key-files-overlap', 'body-anchor-overlap', 'title-similarity'] };
  const b = { number: 2, signals: ['title-similarity', 'key-files-overlap'] };
  assert.strictEqual(shapingRefusal([a, b], { 1: IDLE, 2: LIVE }), b);
  assert.strictEqual(shapingRefusal([], {}), null);
  assert.strictEqual(shapingRefusal(null, {}), null);
});

// ── #3141: buildShapingState ────────────────────────────────────────────────

const NOW = Date.parse('2026-10-15T12:00:00Z');
const liveBlob = JSON.stringify({ issue: 5, runId: 'run-live', claimedAt: '2026-10-15T11:00:00Z', ttlHours: 72 });
const staleBlob = JSON.stringify({ issue: 6, runId: 'run-old', claimedAt: '2026-10-01T11:00:00Z', ttlHours: 72 });
const tombstone = JSON.stringify({ issue: 7, runId: 'run-done', released: true });

test('buildShapingState reads ready from labels, liveness from classifyClaimBlob, and the open linked PR', () => {
  const state = buildShapingState({
    numbers: [5, 6, 7, 8, 9],
    labelsByNumber: { 5: ['ready'], 6: [{ name: 'ready' }, { name: 'bot:in-progress' }], 7: ['ready'], 8: [], 9: ['ready'] },
    claimContentByNumber: { 5: liveBlob, 6: staleBlob, 7: tombstone, 8: null, 9: '{not json' },
    linkedPRRepoData: { i9: { closedByPullRequestsReferences: { nodes: [{ number: 41, state: 'OPEN' }] } }, i6: { closedByPullRequestsReferences: { nodes: [{ number: 40, state: 'MERGED' }] } } },
    now: NOW,
  });
  assert.deepStrictEqual(state[5], { ready: true, liveClaim: true, claimRunId: 'run-live', openLinkedPR: null });
  assert.deepStrictEqual(state[6], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null });
  assert.deepStrictEqual(state[7], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null });
  assert.deepStrictEqual(state[8], { ready: false, liveClaim: false, claimRunId: null, openLinkedPR: null });
  assert.deepStrictEqual(state[9], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: 41 });
});

test('buildShapingState degrades a missing claim map and a null linked-PR response to not in flight', () => {
  const state = buildShapingState({ numbers: [5], labelsByNumber: { 5: ['ready'] }, claimContentByNumber: undefined, linkedPRRepoData: null, now: NOW });
  assert.deepStrictEqual(state[5], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null });
});

test('buildShapingState never reads a stale claim as live when the clock is not a finite number', () => {
  for (const now of [NaN, undefined, null]) {
    const state = buildShapingState({ numbers: [6], labelsByNumber: { 6: ['ready'] }, claimContentByNumber: { 6: staleBlob }, linkedPRRepoData: null, now });
    assert.strictEqual(state[6].liveClaim, false, String(now));
  }
});

test('malformed shapes degrade to no refusal instead of throwing', () => {
  assert.strictEqual(shapingRefusal({ number: 5, signals: ['title-similarity'] }, { 5: LIVE }), null);
  assert.deepStrictEqual(buildShapingState({ numbers: { a: 1 }, labelsByNumber: {}, claimContentByNumber: {}, linkedPRRepoData: null, now: NOW }), {});
  const state = buildShapingState({ numbers: [5], labelsByNumber: { 5: { labels: ['ready'] } }, claimContentByNumber: {}, linkedPRRepoData: null, now: NOW });
  assert.strictEqual(state[5].ready, false);
});

// ── #3520: sharedAnchors and the strong predicate ───────────────────────────

test('AC4: every hit carries sharedAnchors, empty when body-anchor-overlap did not fire', () => {
  const kfSubject = { number: 1, title: 'Completely unrelated title alpha', body: withKeyFiles(['a.js', 'b.js']) };
  const kfRecord = { number: 2, title: 'Something else entirely zeta', body: withKeyFiles(['a.js', 'b.js', 'c.js']) };
  const [kfHit] = findNearDuplicates(kfSubject, [kfRecord]);
  assert.deepStrictEqual(kfHit.signals, ['key-files-overlap']);
  assert.deepStrictEqual(kfHit.sharedAnchors, []);

  const subject = { number: 1, title: 'Alpha unrelated title here', body: '## Current State\n\nThe check lives in `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `a.js` — modify\n' };
  const record = { number: 2, title: 'Zeta unrelated title elsewhere', body: '## Current State\n\nAlso touches `bin/lib/issues/grouping.js` directly.\n\n### Key Files\n\n- `z.js` — modify\n' };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.deepStrictEqual(hit.sharedAnchors, ['bin/lib/issues/grouping.js']);
});

test('AC4: existing fields, scores and ordering are unchanged', () => {
  const body = (f) => `## Current State\n\nUses \`bin/lib/issues/grouping.js\`.\n\n### Key Files\n\n- \`${f}\` — modify\n`;
  const subject = { number: 1, title: 'dispatch pre-build near-duplicate check', body: body('a.js') };
  const records = [
    { number: 30, title: 'totally unrelated too', body: body('w.js') },
    { number: 20, title: 'dispatch pre-build near-duplicate check', body: body('z.js') },
    { number: 5, title: 'totally unrelated', body: body('y.js') },
  ];
  const hits = findNearDuplicates(subject, records);
  assert.deepStrictEqual(
    hits.map(({ number, title, score, signals }) => ({ number, title, score, signals })),
    [
      { number: 20, title: 'dispatch pre-build near-duplicate check', score: 2, signals: ['title-similarity', 'body-anchor-overlap'] },
      { number: 5, title: 'totally unrelated', score: 1, signals: ['body-anchor-overlap'] },
      { number: 30, title: 'totally unrelated too', score: 1, signals: ['body-anchor-overlap'] },
    ],
  );
});

test('sharedAnchors lists every shared Current State anchor, sorted', () => {
  const mk = (order) => `## Current State\n\n${order.map((a) => `Cites \`${a}\`.`).join('\n')}\n`;
  const subject = { number: 1, title: 'Alpha unrelated title here', body: mk(['fs.realpathSync.native', 'docs/donts.md', 'fs.realpathSync', 'only-subject.js']) };
  const record = { number: 2, title: 'Zeta unrelated title elsewhere', body: mk(['fs.realpathSync', 'fs.realpathSync.native', 'docs/donts.md', 'only-record.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.deepStrictEqual(hit.sharedAnchors, ['docs/donts.md', 'fs.realpathSync', 'fs.realpathSync.native']);
  assert.strictEqual(hit.score, 1);
});

test('isStrongNearDuplicate: 2+ shared anchors or score >= 2 is strong; one anchor alone is not', () => {
  assert.strictEqual(STRONG_NEAR_DUPLICATE_MIN, 2);
  assert.strictEqual(isStrongNearDuplicate({ score: 1, sharedAnchors: ['a', 'b'] }), true);
  assert.strictEqual(isStrongNearDuplicate({ score: 2, sharedAnchors: [] }), true);
  assert.strictEqual(isStrongNearDuplicate({ score: 1, sharedAnchors: ['a'] }), false);
  assert.strictEqual(isStrongNearDuplicate({ score: 1 }), false);
  assert.strictEqual(isStrongNearDuplicate(null), false);
  assert.strictEqual(isStrongNearDuplicate({}), false);
});

test('generic shared anchors never count toward sharedAnchors', () => {
  const body = '## Current State\n\nRuns `--run-dir` via `/claude-tweaks:dispatch`.\n';
  const subject = { number: 1, title: 'Alpha unrelated title here', body };
  const record = { number: 2, title: 'Zeta unrelated title elsewhere', body };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});
