'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { derivePhases, PHASES, NESTED_PARENT, joinTokens, countGuardEvents } = require('../../../plugin/bin/lib/timing/derive');
const { parseManifestYaml } = require('../../../plugin/bin/lib/flow/manifest');

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');
function fixtureEvents() {
  return fs.readFileSync(path.join(FIX, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}
function fixtureManifest() {
  return parseManifestYaml(fs.readFileSync(path.join(FIX, 'manifest.yml'), 'utf8'));
}
const byName = (out) => Object.fromEntries(out.phases.map((p) => [p.phase, p]));

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

test('#1929: countGuardEvents counts the three guard event types and ignores the rest', () => {
  const events = [
    { ts: 't', type: 'gate-denial' }, { ts: 't', type: 'gate-denial' },
    { ts: 't', type: 'wd-ambiguous' }, { ts: 't', type: 'wd-deny' }, { ts: 't', type: 'wd-deny' }, { ts: 't', type: 'wd-deny' },
    { ts: 't', type: 'wd-foreign-session' }, { ts: 't', type: 'commit', action: 'push' },
  ];
  assert.deepEqual(countGuardEvents(events), { gateDenial: 2, wdAmbiguous: 1, wdDeny: 3 });
  assert.deepEqual(countGuardEvents([]), { gateDenial: 0, wdAmbiguous: 0, wdDeny: 0 });
});
