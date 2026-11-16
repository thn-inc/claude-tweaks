'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CUTOFF_DAYS, ARCHIVE_THRESHOLD, UNCOMMITTED, RETENTION_VALUES,
  ageInDays, isPastCutoff, routePlans,
} = require('../../../plugin/bin/lib/plan-retention/route');

const TODAY = '2026-10-31';

// An ISO date `days` calendar days before TODAY.
function daysBeforeToday(days) {
  const [y, m, d] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

function plansAged(n, days, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    plan: `docs/superpowers/plans/${prefix}-${i}.md`,
    firstAdded: daysBeforeToday(days),
  }));
}

const UNCOMMITTED_PLAN = 'docs/superpowers/plans/uncommitted.md';
const RECENT_PLAN = 'docs/superpowers/plans/recent.md';

function uncommittedAndRecentPlans() {
  return [
    { plan: UNCOMMITTED_PLAN, firstAdded: UNCOMMITTED },
    { plan: RECENT_PLAN, firstAdded: daysBeforeToday(1) },
  ];
}

const noLookup = () => { throw new Error('lookupDecline must not be called'); };
// A call-counting stand-in: a throw-if-called helper can be swallowed by a try around the lookup.
function spyLookup() {
  const spy = () => { spy.calls += 1; return null; };
  spy.calls = 0;
  return spy;
}
const routes = (result) => result.plans.map((p) => p.route);

test('constants carry the documented values', () => {
  assert.equal(CUTOFF_DAYS, 7);
  assert.equal(ARCHIVE_THRESHOLD, 30);
  assert.equal(UNCOMMITTED, 'uncommitted');
  assert.deepEqual(RETENTION_VALUES, ['keep-forever', 'prune-after-wrapup', 'ask']);
  assert.ok(Object.isFrozen(RETENTION_VALUES));
});

test('the 7-day boundary: 6 days within, 7 days past, across a month and a leap day', () => {
  assert.equal(ageInDays('2026-10-24', TODAY), 7);
  assert.equal(isPastCutoff('2026-10-24', TODAY), true);
  assert.equal(isPastCutoff('2026-10-25', TODAY), false);
  assert.equal(ageInDays('2026-09-28', '2026-10-05'), 7);
  assert.equal(ageInDays('2028-02-28', '2028-03-06'), 7);
});

test('a first-add date after today is within the cutoff', () => {
  assert.equal(ageInDays('2026-11-02', TODAY), -2);
  assert.equal(isPastCutoff('2026-11-02', TODAY), false);
});

test('AC2.1 (unit): 29 past-cutoff plans all keep, citationCheck false, no decline lookup', () => {
  const lookup = spyLookup();
  const result = routePlans({
    retention: 'keep-forever', plans: plansAged(29, 30, 'old'), today: TODAY, cited: null, lookupDecline: lookup,
  });
  assert.equal(lookup.calls, 0);
  assert.ok(routes(result).every((r) => r === 'keep'));
  assert.equal(result.plans.length, 29);
  assert.equal(result.citationCheck, false);
  assert.deepEqual(result.citationCandidates, []);
  assert.equal(result.decline, null);
});

test('AC1.1 (unit): 30 past-cutoff plans route prune-archive and a 1-day-old plan keeps', () => {
  const old = plansAged(30, 30, 'old');
  const fresh = plansAged(1, 1, 'fresh');
  const result = routePlans({
    retention: 'keep-forever', plans: [...old, ...fresh], today: TODAY, cited: null, lookupDecline: () => null,
  });
  assert.deepEqual(routes(result), [...old.map(() => 'prune-archive'), 'keep']);
  assert.equal(result.citationCheck, true);
  assert.deepEqual(result.citationCandidates, old.map((p) => p.plan));
  assert.deepEqual(result.decline, { live: false, error: null });
  assert.deepEqual(result.plans[0], {
    plan: old[0].plan, firstAdded: old[0].firstAdded, pastCutoff: true, cited: false, route: 'prune-archive',
  });
  assert.equal(result.plans[30].pastCutoff, false);
});

test('the second pass recounts uncited plans', () => {
  const thirtyOne = plansAged(31, 30, 'old');
  const citedSet = new Set([thirtyOne[0].plan, thirtyOne[1].plan]);
  const lookup = spyLookup();
  const below = routePlans({
    retention: 'keep-forever', plans: thirtyOne, today: TODAY, cited: citedSet, lookupDecline: lookup,
  });
  assert.equal(lookup.calls, 0);
  assert.ok(routes(below).every((r) => r === 'keep'));
  assert.equal(below.citationCheck, false);
  assert.equal(below.decline, null);

  const thirtyTwo = plansAged(32, 30, 'old');
  const cited2 = new Set([thirtyTwo[0].plan, thirtyTwo[1].plan]);
  const at = routePlans({
    retention: 'keep-forever', plans: thirtyTwo, today: TODAY, cited: cited2, lookupDecline: () => null,
  });
  assert.equal(at.plans[0].route, 'keep');
  assert.equal(at.plans[1].route, 'keep');
  assert.equal(at.plans[0].cited, true);
  assert.equal(at.plans[1].cited, true);
  assert.deepEqual(at.decline, { live: false, error: null });
  assert.ok(at.plans.slice(2).every((p) => p.route === 'prune-archive' && p.cited === false));
  assert.equal(at.citationCheck, false);
  assert.deepEqual(at.citationCandidates, []);
});

test('a live decline or a failed lookup keeps every plan, and the first pass still asks for the citation check', () => {
  const thirty = plansAged(30, 30, 'old');
  const live = routePlans({
    retention: 'keep-forever', plans: thirty, today: TODAY, cited: null,
    lookupDecline: () => ({ declinedAt: 'x', reason: 'r', source: 'tidy' }),
  });
  assert.ok(routes(live).every((r) => r === 'keep'));
  assert.equal(live.citationCheck, true);
  assert.equal(live.citationCandidates.length, 30);
  assert.deepEqual(live.decline, { live: true, error: null });

  const failed = routePlans({
    retention: 'keep-forever', plans: thirty, today: TODAY, cited: null,
    lookupDecline: () => { throw new Error('boom'); },
  });
  assert.ok(routes(failed).every((r) => r === 'keep'));
  assert.equal(failed.citationCheck, true);
  assert.deepEqual(failed.decline, { live: false, error: 'boom' });

  const second = routePlans({
    retention: 'keep-forever', plans: thirty, today: TODAY, cited: new Set(),
    lookupDecline: () => ({ declinedAt: 'x', reason: 'r', source: 'tidy' }),
  });
  assert.ok(routes(second).every((r) => r === 'keep'));
  assert.equal(second.citationCheck, false);
});

test('a lookup that throws a non-Error still keeps every plan and reports the thrown value', () => {
  const thirty = plansAged(30, 30, 'old');
  for (const [thrown, error] of [[null, 'null'], ['str', 'str']]) {
    const result = routePlans({
      retention: 'keep-forever', plans: thirty, today: TODAY, cited: null,
      lookupDecline: () => { throw thrown; },
    });
    assert.ok(routes(result).every((r) => r === 'keep'), String(thrown));
    assert.deepEqual(result.decline, { live: false, error }, String(thrown));
  }
});

test('AC3.1 (unit): an uncommitted plan keeps under keep-forever and ask; ask has no cutoff', () => {
  const plans = uncommittedAndRecentPlans();

  const forever = routePlans({ retention: 'keep-forever', plans, today: TODAY, cited: null, lookupDecline: noLookup });
  assert.deepEqual(routes(forever), ['keep', 'keep']);
  assert.equal(forever.plans[0].pastCutoff, false);

  const ask = routePlans({ retention: 'ask', plans, today: TODAY, cited: null, lookupDecline: noLookup });
  assert.deepEqual(routes(ask), ['keep', 'prune-ask']);
  assert.deepEqual(ask.citationCandidates, [RECENT_PLAN]);
  assert.equal(ask.citationCheck, true);
  assert.equal(ask.decline, null);
});

test('an uncommitted plan never counts toward the 30 or joins the archive, at and below the threshold', () => {
  const uncommitted = { plan: UNCOMMITTED_PLAN, firstAdded: UNCOMMITTED };
  // 29 past-cutoff plus 1 uncommitted: counting the uncommitted plan would reach 30 and archive them all.
  const belowThreshold = routePlans({
    retention: 'keep-forever', plans: [...plansAged(29, 30, 'old'), uncommitted], today: TODAY, cited: null, lookupDecline: noLookup,
  });
  assert.ok(routes(belowThreshold).every((r) => r === 'keep'));
  assert.equal(belowThreshold.citationCheck, false);

  // 30 past-cutoff plus 1 uncommitted: the 30 archive, the uncommitted plan stays out of the archive and of the check.
  const old = plansAged(30, 30, 'old');
  const atThreshold = routePlans({
    retention: 'keep-forever', plans: [...old, uncommitted], today: TODAY, cited: null, lookupDecline: () => null,
  });
  assert.deepEqual(routes(atThreshold), [...old.map(() => 'prune-archive'), 'keep']);
  assert.deepEqual(atThreshold.citationCandidates, old.map((p) => p.plan));
});

test('prune-after-wrapup routes every plan delete and lists all for the citation check', () => {
  const plans = uncommittedAndRecentPlans();
  const result = routePlans({ retention: 'prune-after-wrapup', plans, today: TODAY, cited: null, lookupDecline: noLookup });
  assert.deepEqual(routes(result), ['delete', 'delete']);
  assert.deepEqual(result.citationCandidates, [UNCOMMITTED_PLAN, RECENT_PLAN]);
  assert.equal(result.citationCheck, true);
  assert.equal(result.decline, null);

  const empty = routePlans({ retention: 'prune-after-wrapup', plans: [], today: TODAY, cited: null, lookupDecline: noLookup });
  assert.equal(empty.citationCheck, false);
});

test('an unknown retention value throws', () => {
  assert.throws(
    () => routePlans({ retention: 'sometimes', plans: [], today: TODAY, cited: null, lookupDecline: noLookup }),
    /unknown retention value: sometimes/,
  );
});
