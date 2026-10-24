'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { derivePhases, PHASES, NESTED_PARENT, joinTokens, countGuardEvents } = require('../../../plugin/bin/lib/timing/derive');
const { parseManifestYaml } = require('../../../plugin/bin/lib/flow/manifest');
const { readText } = require('../../helpers/read-skill');

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');
function fixtureEvents() {
  return fs.readFileSync(path.join(FIX, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}
function fixtureManifest() {
  return parseManifestYaml(readText(path.join(FIX, 'manifest.yml')));
}
const byName = (out) => Object.fromEntries(out.phases.map((p) => [p.phase, p]));

test('a verify row carries the adjudication verdict beside the raw pass (#3043)', () => {
  const events = fixtureEvents().map((e) => (e.type === 'verify' && e.mode === 'full' ? { ...e, pass: false, baselineAdjudicated: 'pass' } : e));
  const p = byName(derivePhases({ events, manifest: fixtureManifest(), now: new Date('2026-09-05T14:13:00.000Z') }));
  assert.equal(p.test.verify[0].pass, false);
  assert.equal(p.test.verify[0].baselineAdjudicated, 'pass');
  assert.equal(p.tasks.verify[0].baselineAdjudicated, null, 'an event without the field reads null');
});

test('#1928 AC3: the frozen fixture reproduces the reference boundaries within ±1 minute', () => {
  const out = derivePhases({ events: fixtureEvents(), manifest: fixtureManifest(), now: new Date('2026-09-05T14:13:00.000Z') });
  assert.deepEqual(out.phases.map((p) => p.phase), PHASES);
  const p = byName(out);
  const near = (a, b) => Math.abs(a - b) <= 1;
  assert.ok(near(p['call-1'].minutes, 25), `call-1 ${p['call-1'].minutes}`);
  assert.ok(near(p['call-2'].ownMinutes, 24), `call-2 own ${p['call-2'].ownMinutes}`);
  assert.ok(near(p.plan.minutes, 6));
  assert.ok(near(p.tasks.minutes, 14));
  assert.ok(near(p.build.ownMinutes, 2));
  assert.ok(near(p.test.minutes, 2));
  assert.ok(near(p.review.minutes, 8));
  assert.equal(p.polish.minutes, 0);
  assert.equal(p.polish.source, 'unattributed');
  assert.equal(p.polish.start, p['wrap-up'].start);
  assert.ok(near(p['wrap-up'].minutes, 15), `wrap-up ${p['wrap-up'].minutes}`);
  assert.ok(near(p.merge.minutes, 1));
  assert.equal(p.tasks.verify.length, 1);
  assert.equal(p.tasks.verify[0].mode, 'scoped');
  assert.equal(p.test.verify.length, 1);
  assert.equal(p.test.verify[0].mode, 'full');
  assert.equal(out.totals.verifyRuns, 2);
  assert.deepEqual(out.totals.verifyModes, ['scoped', 'full']);
  assert.ok(near(out.totals.minutes, 73), `totals ${out.totals.minutes}`);
  // #1928 fix round 3: totals.minutes is now a union over every row's spans
  // rather than a sum of ownMinutes. The fixture has no overlapping spans,
  // so the union equals the old sum exactly — pin the exact value too.
  assert.equal(out.totals.minutes, 73, `totals ${out.totals.minutes}`);
});

test('#1928: sources are labelled by the boundary that produced them', () => {
  const p = byName(derivePhases({ events: fixtureEvents(), manifest: fixtureManifest() }));
  assert.equal(p['call-1'].source, 'skill_invoked');
  assert.equal(p.tasks.source, 'verify');
  assert.equal(p.merge.source, 'commit');
});

test('#1928 AC4 (derivation half): only session-end ⇒ every canonical phase is unattributed, 0 minutes', () => {
  const out = derivePhases({ events: [{ ts: '2026-09-05T14:13:00.000Z', type: 'session-end' }] });
  assert.deepEqual(out.phases.map((p) => p.phase), PHASES);
  for (const p of out.phases) { assert.equal(p.source, 'unattributed'); assert.equal(p.minutes, 0); }
  assert.equal(out.totals.minutes, 0);
});

test('#1928: an un-mapped claude-tweaks skill opens its own top-level span (never nests silently)', () => {
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:review', ts: '2026-09-05T13:10:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:mystery', ts: '2026-09-05T13:15:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:wrap-up', ts: '2026-09-05T13:20:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:25:00.000Z', type: 'session-end' },
  ];
  const out = derivePhases({ events });
  const p = byName(out);
  assert.equal(p.review.minutes, 5, 'review ends when the un-mapped skill starts');
  assert.ok(out.phases.some((x) => x.phase === 'mystery' && x.minutes === 5));
  assert.equal(NESTED_PARENT.journeys, 'enclosing');
});

test('typed (source user) lifecycle skills open phases exactly like model ones; a typed non-phase skill nests', () => {
  const events = [
    { skill: 'claude-tweaks:flow', source: 'user', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:build', source: 'user', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:help', source: 'user', ts: '2026-09-05T13:05:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:test', ts: '2026-09-05T13:10:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:15:00.000Z', type: 'session-end' },
  ];
  const out = derivePhases({ events });
  const p = byName(out);
  assert.equal(p['call-1'].minutes, 15);
  assert.equal(p.build.minutes, 9, 'a typed help nests in build instead of cutting it short');
  assert.equal(p.test.minutes, 5);
  assert.equal(out.phases.some((x) => x.phase === 'help'), false);
});

test('a model-initiated un-mapped skill still opens its own span (the drift detector is unchanged)', () => {
  const events = [
    { skill: 'claude-tweaks:flow', source: 'user', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:build', source: 'user', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:help', ts: '2026-09-05T13:05:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:test', ts: '2026-09-05T13:10:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:15:00.000Z', type: 'session-end' },
  ];
  const p = byName(derivePhases({ events }));
  assert.equal(p.build.minutes, 4, 'the un-sourced help ends build at 13:05');
  assert.equal(p.help.minutes, 5);
});

test('#2249: stories/deepen/feedback are NESTED_PARENT members and nest into the enclosing phase rather than opening a new top-level span', () => {
  assert.equal(NESTED_PARENT.stories, 'enclosing');
  assert.equal(NESTED_PARENT.deepen, 'enclosing');
  assert.equal(NESTED_PARENT.feedback, 'enclosing');
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:build', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:stories', ts: '2026-09-05T13:05:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:review', ts: '2026-09-05T13:10:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:deepen', ts: '2026-09-05T13:12:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:wrap-up', ts: '2026-09-05T13:20:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:feedback', ts: '2026-09-05T13:22:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:25:00.000Z', type: 'session-end' },
  ];
  const out = derivePhases({ events });
  const p = byName(out);
  assert.ok(!('stories' in p), 'stories never opens its own top-level phase row');
  assert.ok(!('deepen' in p), 'deepen never opens its own top-level phase row');
  assert.ok(!('feedback' in p), 'feedback never opens its own top-level phase row');
  assert.ok(!out.phases.some((x) => x.phase === 'stories' || x.phase === 'deepen' || x.phase === 'feedback'));
  // build's span runs through to review's start — stories' nested invocation
  // inside it does not truncate build's span the way an un-mapped skill would.
  assert.equal(p.build.minutes, 9, `build ${p.build.minutes}`);
  assert.equal(p['wrap-up'].minutes, 5, `wrap-up ${p['wrap-up'].minutes}`);
});

test('#1928: a re-entered phase sums every span attributed to its name', () => {
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:review', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:build', ts: '2026-09-05T13:05:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:review', ts: '2026-09-05T13:15:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:18:00.000Z', type: 'session-end' },
  ];
  assert.equal(byName(derivePhases({ events })).review.minutes, 7);
});

test('#1928: merge ends at runState.pr.mergedAt under pr-first, else at a merge commit or the terminal event', () => {
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:wrap-up', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { action: 'push', ts: '2026-09-05T13:10:00.000Z', type: 'commit' },
    { ts: '2026-09-05T13:30:00.000Z', type: 'session-end' },
  ];
  assert.equal(byName(derivePhases({ events, runState: { pr: { mergedAt: '2026-09-05T13:14:00.000Z' } } })).merge.minutes, 4);
  assert.equal(byName(derivePhases({ events })).merge.minutes, 20);
  const local = [...events.slice(0, 3), { action: 'merge', ts: '2026-09-05T13:12:00.000Z', type: 'commit' }, events[3]];
  assert.equal(byName(derivePhases({ events: local })).merge.minutes, 2);
});

test('#1928 fix round 1: a verify event during `plan` attributes to plan only, not also to build', () => {
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:build', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { skill: 'superpowers:writing-plans', ts: '2026-09-05T13:02:00.000Z', type: 'skill_invoked' },
    { mode: 'scoped', ts: '2026-09-05T13:05:00.000Z', type: 'verify' },
    { skill: 'superpowers:subagent-driven-development', ts: '2026-09-05T13:08:00.000Z', type: 'skill_invoked' },
    { mode: 'full', ts: '2026-09-05T13:22:00.000Z', type: 'verify' },
    { skill: 'claude-tweaks:test', ts: '2026-09-05T13:23:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:30:00.000Z', type: 'session-end' },
  ];
  const out = derivePhases({ events });
  const p = byName(out);
  assert.equal(p.plan.verify.length, 1, `plan.verify ${JSON.stringify(p.plan.verify)}`);
  assert.equal(p.build.verify.length, 0, `build.verify ${JSON.stringify(p.build.verify)}`);
  assert.equal(p.tasks.verify.length, 1, `tasks.verify ${JSON.stringify(p.tasks.verify)}`);
  assert.equal(out.totals.verifyRuns, 2);
});

test('#1928 fix round 1: two subagent-driven-development starts before one verify do not double-count tasks minutes', () => {
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:build', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { skill: 'superpowers:writing-plans', ts: '2026-09-05T13:02:00.000Z', type: 'skill_invoked' },
    { skill: 'superpowers:subagent-driven-development', ts: '2026-09-05T13:08:00.000Z', type: 'skill_invoked' },
    { skill: 'superpowers:subagent-driven-development', ts: '2026-09-05T13:12:00.000Z', type: 'skill_invoked' },
    { mode: 'scoped', ts: '2026-09-05T13:22:00.000Z', type: 'verify' },
    { skill: 'claude-tweaks:test', ts: '2026-09-05T13:23:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:30:00.000Z', type: 'session-end' },
  ];
  const p = byName(derivePhases({ events }));
  assert.equal(p.tasks.minutes, 14, `tasks.minutes ${p.tasks.minutes}`);
  assert.equal(p.plan.minutes, 6, `plan.minutes ${p.plan.minutes}`);
});

test('#1928 fix round 3: merge overlap is accounted once via union, not double-subtracted from a containing call', () => {
  // build invoked AFTER the merge push (like the dispatched real run,
  // record-1503) — its span falls entirely inside merge's span. A sum-based
  // exclusive-minutes pass double-subtracts merge's minutes from call-1
  // (once via the call's own inner-sum, once via a separate merge-overlap
  // pass over the call itself); the union-based pass must not.
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:wrap-up', ts: '2026-09-05T13:30:00.000Z', type: 'skill_invoked' },
    { action: 'push', ts: '2026-09-05T13:35:00.000Z', type: 'commit' },
    { skill: 'claude-tweaks:build', ts: '2026-09-05T13:37:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:40:00.000Z', type: 'session-end' },
  ];
  const out = derivePhases({ events });
  const p = byName(out);
  assert.equal(p.merge.minutes, 5, `merge.minutes ${p.merge.minutes}`);
  assert.equal(p.build.minutes, 3, `build.minutes ${p.build.minutes}`);
  assert.equal(p.build.ownMinutes, 0, `build.ownMinutes ${p.build.ownMinutes}`); // fully inside merge
  // 40 total minus the union of wrap-up (5), merge (5), and build (3, fully
  // inside merge) = 40 - 10 = 30. A sum-based pass would double-subtract
  // build/merge's shared minutes and undercount call-1.ownMinutes.
  assert.equal(p['call-1'].ownMinutes, 30, `call-1.ownMinutes ${p['call-1'].ownMinutes}`);
  assert.equal(out.totals.minutes, 40, `totals.minutes ${out.totals.minutes}`);
});

test('#1928 fix round 2: worktree-reaped as terminal clips endOfRun to the last real event, not the reap ts', () => {
  const events = [
    { skill: 'claude-tweaks:flow', ts: '2026-09-05T13:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:build', ts: '2026-09-05T13:01:00.000Z', type: 'skill_invoked' },
    { ts: '2026-09-05T13:20:00.000Z', type: 'commit' },
    { ts: '2026-09-06T06:00:00.000Z', type: 'worktree-reaped' },
  ];
  const p = byName(derivePhases({ events }));
  assert.equal(p.build.minutes, 19, `build.minutes ${p.build.minutes}`);
  assert.equal(p['call-1'].minutes, 20, `call-1.minutes ${p['call-1'].minutes}`);
});

function usageRow(ts, extra = {}) {
  return { ts, role: 'assistant', inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, toolRoundTrip: false, procedureBytes: 0, ...extra };
}

test('#1929 AC3: joinTokens sums rows into the innermost containing phase on [start, end)', () => {
  const out = derivePhases({ events: fixtureEvents(), manifest: fixtureManifest(), now: new Date('2026-09-05T14:13:00.000Z') });
  const rows = [
    usageRow('2026-09-05T12:59:00.000Z', { inputTokens: 1, outputTokens: 1 }),            // before call-1 → unattributed
    usageRow('2026-09-05T13:50:00.000Z', { inputTokens: 100, outputTokens: 10, cacheRead: 1000 }), // review
    usageRow('2026-09-05T13:56:00.000Z', { role: 'user', toolRoundTrip: true, procedureBytes: 500 }), // review
    usageRow('2026-09-05T13:57:00.000Z', { inputTokens: 7 }),                                  // exactly wrap-up's start → wrap-up, not review
    usageRow('2026-09-05T14:00:00.000Z', { inputTokens: 200, outputTokens: 20, cacheCreate: 50 }), // wrap-up
    usageRow('2026-09-05T13:30:00.000Z', { inputTokens: 3 }),                                  // call-2 preflight gap → call-2
    usageRow('2026-09-05T13:10:00.000Z', { inputTokens: 5, outputTokens: 5 }),                  // inside tasks (innermost), not build/call-1
  ];
  const joined = joinTokens(out.phases, rows);
  const p = Object.fromEntries(joined.phases.map((x) => [x.phase, x]));
  assert.deepEqual(p.review.tokens, { input: 100, output: 10, cacheRead: 1000, cacheCreate: 0 });
  assert.equal(p.review.procedureBytes, 500);
  assert.equal(p.review.toolRoundTrips, 1);
  assert.deepEqual(p['wrap-up'].tokens, { input: 207, output: 20, cacheRead: 0, cacheCreate: 50 });
  assert.equal(p['call-2'].tokens.input, 3);
  assert.equal(p.tasks.tokens.input, 5);
  assert.equal(p.build.tokens.input, 0);
  assert.equal(p['call-1'].tokens.input, 0);
  assert.deepEqual(joined.unattributed.tokens, { input: 1, output: 1, cacheRead: 0, cacheCreate: 0 });
  assert.equal(joined.unattributed.rows, 1);
  assert.deepEqual(joined.totals.tokens, { input: 316, output: 36, cacheRead: 1000, cacheCreate: 50 });
  assert.equal(joined.totals.procedureBytes, 500);
  assert.equal(joined.totals.toolRoundTrips, 1);
});

test('#1929: joinTokens with no rows leaves zeroed columns and never throws on unattributed phases', () => {
  const out = derivePhases({ events: [{ ts: '2026-09-05T14:13:00.000Z', type: 'session-end' }] });
  const joined = joinTokens(out.phases, []);
  assert.equal(joined.phases.length, PHASES.length);
  for (const x of joined.phases) assert.deepEqual(x.tokens, { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
  assert.equal(joined.totals.toolRoundTrips, 0);
});

// #4029: the hand-counted turn-classes fixture, built inline. Ten turns k=1..10
// (context k*1000 + k*10); m3 runs on sonnet, the rest on opus; the user rows
// carry the per-class counts, so the 11 calls ride 10 round trips.
const TC_EVENTS = [
  { skill: 'claude-tweaks:flow', ts: '2026-10-24T10:00:00.000Z', type: 'skill_invoked' },
  { skill: 'claude-tweaks:build', ts: '2026-10-24T10:01:00.000Z', type: 'skill_invoked' },
  { mode: 'full', durationMs: 120000, pass: true, ts: '2026-10-24T10:20:00.000Z', type: 'verify' },
  { ts: '2026-10-24T10:30:00.000Z', type: 'session-end' },
];
const TC_CLASS_BY_TURN = [
  { procedure: 1 }, { orientation: 2 }, { edit: 1 }, { bookkeeping: 1 }, { 'guard-refusal': 1 },
  { dispatch: 1 }, { explore: 1 }, { verify: 1 }, { read: 1 }, { other: 1 },
];
function turnClassRows() {
  const rows = [];
  for (let k = 1; k <= 10; k++) {
    const mm = String(1 + k).padStart(2, '0');
    rows.push(usageRow(`2026-10-24T10:${mm}:00.000Z`, { inputTokens: k * 10, outputTokens: 5, cacheRead: k * 1000, model: k === 3 ? 'claude-sonnet-5' : 'claude-opus-5-5', turnStart: true, contextTokens: k * 1010 }));
    rows.push(usageRow(`2026-10-24T10:${mm}:05.000Z`, { role: 'user', toolRoundTrip: true, turnClasses: TC_CLASS_BY_TURN[k - 1] }));
  }
  // a repeat of m1's stream: not a turn start, never counted as a turn
  rows.push(usageRow('2026-10-24T10:02:01.000Z', { model: 'claude-opus-5-5', turnStart: false, contextTokens: 0 }));
  return rows;
}
const ZERO_CLASSES = { edit: 0, read: 0, explore: 0, procedure: 0, bookkeeping: 0, orientation: 0, verify: 0, 'guard-refusal': 0, dispatch: 0, other: 0 };

test('#4029: joinTokens aggregates turn classes, context percentiles, model mix and ceremony share per phase', () => {
  const out = derivePhases({ events: TC_EVENTS });
  assert.equal(out.totals.verifyMinutes, 2);
  const joined = joinTokens(out.phases, turnClassRows());
  const hand = { edit: 1, read: 1, explore: 1, procedure: 1, bookkeeping: 1, orientation: 2, verify: 1, 'guard-refusal': 1, dispatch: 1, other: 1 };
  const build = joined.phases.find((p) => p.phase === 'build');
  for (const b of [build, joined.totals]) {
    assert.deepEqual(b.turnClasses, hand);
    assert.deepEqual(b.context, { turns: 10, p50: 5050, p90: 9090 });
    assert.deepEqual(b.modelMix, { 'claude-opus-5-5': 9, 'claude-sonnet-5': 1 });
    assert.equal(b.subagents, 1);
    assert.equal(b.ceremonyShare, 0.455);
    assert.equal(b.toolRoundTrips, 10);
  }
  // the internal samples never reach the output
  for (const b of [build, joined.totals, joined.unattributed]) assert.deepEqual(Object.keys(b.context), ['turns', 'p50', 'p90']);
  assert.deepEqual(joined.unattributed.turnClasses, ZERO_CLASSES);
  assert.deepEqual(joined.phases.find((p) => p.phase === 'review').turnClasses, ZERO_CLASSES);
});

test('#4029: an empty bucket has zero-filled classes and null percentiles', () => {
  const joined = joinTokens(derivePhases({ events: TC_EVENTS }).phases, []);
  for (const b of [...joined.phases, joined.unattributed, joined.totals]) {
    assert.deepEqual(b.turnClasses, ZERO_CLASSES);
    assert.deepEqual(b.context, { turns: 0, p50: null, p90: null });
    assert.deepEqual(b.modelMix, {});
    assert.equal(b.subagents, 0);
    assert.equal(b.ceremonyShare, null);
  }
});

test('#4029: legacy rows without turn fields still join, and a null model keys as unknown', () => {
  const joined = joinTokens(derivePhases({ events: TC_EVENTS }).phases, [
    usageRow('2026-10-24T10:05:00.000Z', { inputTokens: 4 }),
    usageRow('2026-10-24T10:06:00.000Z', { turnStart: true, contextTokens: 7, model: null }),
  ]);
  assert.equal(joined.totals.tokens.input, 4);
  assert.deepEqual(joined.totals.context, { turns: 1, p50: 7, p90: 7 });
  assert.deepEqual(joined.totals.modelMix, { unknown: 1 });
  assert.deepEqual(joined.totals.turnClasses, ZERO_CLASSES);
});

test('#4029 M6: an unknown turn-class key folds into other, never a new bucket key', () => {
  const joined = joinTokens(derivePhases({ events: TC_EVENTS }).phases, [
    usageRow('2026-10-24T10:05:00.000Z', { role: 'user', toolRoundTrip: true, turnClasses: { frobnicate: 2, edit: 1 } }),
    // an inherited Object.prototype name is not a class either
    usageRow('2026-10-24T10:06:00.000Z', { role: 'user', toolRoundTrip: true, turnClasses: { toString: 1 } }),
  ]);
  for (const b of [joined.totals, joined.phases.find((p) => p.phase === 'build')]) {
    assert.deepEqual(b.turnClasses, { ...ZERO_CLASSES, edit: 1, other: 3 });
    assert.deepEqual(Object.keys(b.turnClasses), Object.keys(ZERO_CLASSES));
  }
});

test('#4029: verifyMinutes sums every verify durationMs to one decimal, 0 with none', () => {
  const ev = (d) => ({ ts: '2026-10-24T10:20:00.000Z', type: 'verify', durationMs: d });
  assert.equal(derivePhases({ events: [ev(100000), ev(50000)] }).totals.verifyMinutes, 2.5);
  assert.equal(derivePhases({ events: [ev(null), { ts: '2026-10-24T10:21:00.000Z', type: 'verify' }] }).totals.verifyMinutes, 0);
  assert.equal(derivePhases({ events: [] }).totals.verifyMinutes, 0);
});

test('#1929: countGuardEvents counts the three guard event types and ignores the rest', () => {
  const events = [
    { ts: 't', type: 'gate-denial' }, { ts: 't', type: 'gate-denial' },
    { ts: 't', type: 'wd-ambiguous' }, { ts: 't', type: 'wd-deny' }, { ts: 't', type: 'wd-deny' }, { ts: 't', type: 'wd-deny' },
    { ts: 't', type: 'wd-foreign-session' }, { ts: 't', type: 'commit', action: 'push' },
  ];
  assert.deepEqual(countGuardEvents(events), { gateDenial: 2, wdAmbiguous: 1, wdDeny: 3 });
  assert.deepEqual(countGuardEvents([]), { gateDenial: 0, wdAmbiguous: 0, wdDeny: 0 });
});

// --- #3375 dispatch aggregation ---
const { resolveTier, roleOf, aggregateDispatches, unionMinutes } = require('../../../plugin/bin/lib/timing/derive');

const T0 = Date.parse('2026-10-17T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
function disp(over = {}) {
  const startMin = over.startMin ?? 0;
  const endMin = over.endMin ?? 1;
  const { startMin: _s, endMin: _e, ...rest } = over;
  return {
    agentId: 'x', description: 'Implement Task 1: parser', agentType: 'general-purpose', metaModel: 'sonnet',
    transcriptModel: 'claude-sonnet-5-5', parentAgentId: null, spawnDepth: 1,
    startTs: at(startMin), endTs: at(endMin), wallClockMs: (endMin - startMin) * 60000,
    tokens: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }, notFound: null, ...rest,
  };
}

test('AC2.1: tier aggregation reports standard 2 and capable 1 for the three-dispatch fixture', () => {
  const items = [
    disp({ agentId: 'a1', description: 'Implement Task 1: parser', metaModel: 'sonnet', transcriptModel: 'claude-sonnet-5-5' }),
    disp({ agentId: 'a2', description: 'Review Task 1 (spec + quality)', metaModel: 'sonnet', transcriptModel: 'claude-sonnet-5-5' }),
    disp({ agentId: 'a3', description: 'Final whole-branch review #3386', metaModel: 'opus', transcriptModel: 'claude-opus-5-5' }),
  ];
  const r = aggregateDispatches(items);
  assert.equal(r.byTier.standard.dispatches, 2);
  assert.equal(r.byTier.capable.dispatches, 1);
  assert.equal(r.byTier.standard.tokens.cacheRead, 6);
  assert.equal(r.byRole.implementer.dispatches, 1);
  assert.equal(r.byRole['task review'].dispatches, 1);
  assert.equal(r.byRole['whole-branch review'].dispatches, 1);
  assert.deepEqual(r.items.map((i) => [i.tier, i.role]), [['standard', 'implementer'], ['standard', 'task review'], ['capable', 'whole-branch review']]);
});

test('AC2.2: inherit and absent meta models resolve through the transcript model', () => {
  assert.equal(resolveTier({ metaModel: null, transcriptModel: 'claude-opus-5-5' }).tier, 'capable');
  assert.deepEqual(resolveTier({ metaModel: 'inherit', transcriptModel: 'claude-opus-5-5' }), { tier: 'capable', rawModel: 'claude-opus-5-5' });
});

test('AC2.2: claude-opus-5-5 maps to capable', () => {
  assert.equal(resolveTier({ metaModel: null, transcriptModel: 'claude-opus-5-5' }).tier, 'capable');
  assert.equal(resolveTier({ metaModel: 'haiku', transcriptModel: null }).tier, 'fast');
  assert.equal(resolveTier({ metaModel: 'fable', transcriptModel: null }).tier, 'frontier');
  assert.equal(resolveTier({ metaModel: null, transcriptModel: 'claude-sonnet-5-5' }).tier, 'standard');
});

test('AC2.2: a PROFILES alias in meta wins over the transcript model', () => {
  assert.deepEqual(resolveTier({ metaModel: 'haiku', transcriptModel: 'claude-opus-5-5' }), { tier: 'fast', rawModel: 'haiku' });
});

test('AC2.3: a model matching no family reports unmapped with its raw name', () => {
  assert.deepEqual(resolveTier({ metaModel: 'inherit', transcriptModel: 'gpt-x' }), { tier: 'unmapped', rawModel: 'gpt-x' });
  // the family must end at a hyphen or the id's end
  assert.deepEqual(resolveTier({ metaModel: null, transcriptModel: 'claude-sonnetx-1' }), { tier: 'unmapped', rawModel: 'claude-sonnetx-1' });
  assert.equal(resolveTier({ metaModel: null, transcriptModel: 'claude-haiku-4-5-20251001' }).tier, 'fast');
  const r = aggregateDispatches([
    disp({ agentId: 'u1', metaModel: 'inherit', transcriptModel: 'gpt-x' }),
    disp({ agentId: 'u2', metaModel: 'inherit', transcriptModel: 'gpt-x' }),
    disp({ agentId: 'u3', metaModel: null, transcriptModel: null }),
  ]);
  assert.equal(r.byTier.unmapped.dispatches, 3);
  assert.deepEqual(r.byTier.unmapped.rawModels, ['gpt-x', 'null']);
  assert.equal(r.byTier.standard, undefined);
});

test('AC6.1: overlapping spans — agent-seconds is the sum of spans', () => {
  const r = aggregateDispatches([disp({ agentId: 'o1', startMin: 0, endMin: 2 }), disp({ agentId: 'o2', startMin: 1, endMin: 3 })]);
  assert.equal(r.byTier.standard.agentSeconds, 240);
});

test('AC6.1: overlapping spans — elapsed is their union', () => {
  const r = aggregateDispatches([disp({ agentId: 'o1', startMin: 0, endMin: 2 }), disp({ agentId: 'o2', startMin: 1, endMin: 3 })]);
  assert.equal(r.byTier.standard.elapsedMinutes, 3);
  assert.equal(r.byRole.implementer.elapsedMinutes, 3);
  assert.equal(unionMinutes([{ start: 0, end: 120000 }, { start: 60000, end: 180000 }]), 3);
});

test('#3375 M1: elapsed never exceeds agent-seconds by more than rounding — it is the rounded union, not a sum of rounded clusters', () => {
  const sec = (s) => new Date(T0 + s * 1000).toISOString();
  // three disjoint 30 s spans: each cluster rounds to 1 min under the per-cluster rule (3 min) while agent-seconds is 90.
  const items = [0, 120, 240].map((s, i) => disp({ agentId: `m${i}`, startTs: sec(s), endTs: sec(s + 30), wallClockMs: 30000 }));
  const r = aggregateDispatches(items);
  assert.equal(r.byTier.standard.agentSeconds, 90);
  assert.equal(r.byTier.standard.elapsedMinutes, 2);
  assert.ok(r.byTier.standard.elapsedMinutes * 60 <= r.byTier.standard.agentSeconds + 30);
  // a single 30 s span: round(0.5) = 1 min, within the +30 s allowance.
  const one = aggregateDispatches([disp({ agentId: 'm9', startTs: sec(0), endTs: sec(30), wallClockMs: 30000 })]);
  assert.equal(one.byRole.implementer.agentSeconds, 30);
  assert.equal(one.byRole.implementer.elapsedMinutes, 1);
  assert.ok(one.byRole.implementer.elapsedMinutes * 60 <= one.byRole.implementer.agentSeconds + 30);
});

const DESCRIPTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'timing', 'dispatch-descriptions.json'), 'utf8'));

test('AC7.1: every captured description classifies to its intended role', () => {
  assert.ok(DESCRIPTIONS.filter((d) => d.source === 'captured').length >= 19);
  for (const d of DESCRIPTIONS) {
    assert.equal(roleOf(d.description), d.role, `${d.source}: "${d.description}"`);
  }
  // precedence: a description matching both re-review and plan review is a re-review
  assert.equal(roleOf('Re-review plan review fix round 1'), 're-review');
});

test('AC7.1: an unknown string classifies as unlabelled', () => {
  assert.equal(roleOf('Zork the frobnicator'), 'unlabelled');
  assert.equal(roleOf(null), 'unlabelled');
  const r = aggregateDispatches([disp({ description: 'Zork the frobnicator' }), disp({ description: null, notFound: 'meta not found', metaModel: null })]);
  assert.equal(r.byRole.unlabelled.dispatches, 2);
});

test('#3375 review focus 4: a dispatch with no assistant rows and no model anywhere is unmapped with raw null', () => {
  const d = disp({ metaModel: null, transcriptModel: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } });
  assert.deepEqual(resolveTier(d), { tier: 'unmapped', rawModel: null });
  const r = aggregateDispatches([d]);
  assert.equal(r.byTier.unmapped.dispatches, 1);
  assert.deepEqual(r.byTier.unmapped.rawModels, ['null']);
  assert.equal(r.items[0].rawModel, null);
  assert.deepEqual(resolveTier({ metaModel: 'inherit', transcriptModel: null }), { tier: 'unmapped', rawModel: 'inherit' });
});

test('#3375: a transcript-not-readable item stays in items but counts in no bucket', () => {
  const dead = disp({ agentId: 'dead', startTs: null, endTs: null, wallClockMs: null, tokens: null, notFound: 'transcript not readable (ENOENT)' });
  const empty = disp({ agentId: 'empty', startTs: null, endTs: null, wallClockMs: null, tokens: null, notFound: 'transcript has no usage rows' });
  const r = aggregateDispatches([dead, empty, disp({ agentId: 'ok' })]);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].notFound, 'transcript not readable (ENOENT)');
  assert.equal(r.byTier.standard.dispatches, 1);
  assert.equal(r.byRole.implementer.dispatches, 1);
  assert.deepEqual(aggregateDispatches([dead]).byTier, {});
});

test('#3375: an orphan (meta not found) counts, under unlabelled, with its tier from the transcript', () => {
  const orphan = disp({ agentId: 'orph', description: null, metaModel: null, agentType: null, notFound: 'meta not found' });
  const r = aggregateDispatches([orphan]);
  assert.equal(r.byRole.unlabelled.dispatches, 1);
  assert.equal(r.byTier.standard.dispatches, 1);
});

test('#3375: aggregateDispatches of nothing is empty', () => {
  assert.deepEqual(aggregateDispatches([]), { items: [], byTier: {}, byRole: {} });
});
