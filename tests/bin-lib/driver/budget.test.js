'use strict';
// The --budget loop (record #5229): pull, pre-screen, rank, drive, count, one summary line.
// A light fixture: no gh harness. `driveOne` stands in for run.js's driveRecord, and
// `rankNext` is the module's real ranking, so the expected order is never re-derived here.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const {
  runBudget, ENDED, STATUS_BY_ENDED, COUNTERS, UNSELECTABLE_REASONS, classifyFacts, preScreen,
} = require(path.join(LIB, 'driver', 'budget'));
const { BUDGET_STEP, STEP } = require(path.join(LIB, 'driver', 'events'));
const { defineStep, eligibilityOptions } = require(path.join(LIB, 'driver', 'steps'));
const { newShared } = require(path.join(LIB, 'driver', 'run'));
const { rankNext, PASSES, STAYING_EXCLUSION_REASONS } = require(path.join(LIB, 'dispatch', 'queue-pull'));

const POLICY_RESOLVED = Object.freeze({
  'express-driver': { value: 'on' },
  'integration-model': { value: 'pr-first' },
  'merge-sensitive-paths': { value: [] },
  // #5224's lane bounds, which eligibilityOptions hands the eligibility call.
  'express-driver-max-size': { value: 'low' },
  'express-driver-max-key-files': { value: 3 },
  'express-driver-review': { value: 'beyond-express' },
  'express-driver-max-risk': { value: 'low' },
});
const DEFAULT_FACTS = Object.freeze({ final: null, outcome: 'pending-review', claimed: true, claimExit: 0 });
const EMPTY_PULL = Object.freeze({ groups: [], exclusions: [] });

function pulled(n, { priority = null, createdAt = `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z` } = {}) {
  return { number: n, title: `r${n}`, body: 'body', labels: [], state: 'OPEN', createdAt, facets: { priority } };
}
const singletons = (...numbers) => numbers.map((n) => [pulled(n)]);

function policyStepWith(policy) {
  return defineStep(STEP.policy, 'refused', async (ctx) => {
    ctx.shared.policy = policy;
    ctx.shared.mainRoot = '/main';
    return { status: 'ok' };
  });
}

// A loop that stops terminating would otherwise hang its test: past this many pulls the fake
// pull throws, so the run ends `pull-failed` and the test's assertions go red instead.
const MAX_PULLS = 100;

// pulls: returned in turn, the last one forever; an Error entry is thrown. Calls are recorded
// inside the fakes and asserted after the run returns.
function fake({ pulls = [EMPTY_PULL], eligibility = () => ({ eligible: true, reasons: [] }), facts = () => undefined, queuePull = null, steps = null } = {}) {
  const calls = { queuePull: [], rankNext: [], eligibility: [], driveOne: [], appendFile: [] };
  const out = [];
  const errs = [];
  let pullIndex = 0;
  const deps = {
    date: () => new Date('2026-11-13T09:08:07Z'),
    now: () => 1000,
    stdout: (s) => { out.push(s); },
    stderr: (s) => { errs.push(s); },
    appendFile: (p, s) => { calls.appendFile.push([p, s]); },
    pid: 4242,
    env: { FAKE_ENV: '1' },
    queuePull: (options, moduleDeps) => {
      calls.queuePull.push({ options, moduleDeps });
      if (calls.queuePull.length > MAX_PULLS) throw new Error(`pull bound exceeded: more than ${MAX_PULLS} pulls`);
      if (queuePull) return queuePull(options, moduleDeps);
      const p = pulls[Math.min(pullIndex, pulls.length - 1)];
      pullIndex += 1;
      if (p instanceof Error) throw p;
      return p;
    },
    rankNext: (groups, entries, opts) => {
      calls.rankNext.push(JSON.parse(JSON.stringify(entries)));
      return rankNext(groups, entries, opts);
    },
    evaluateRecordEligibility: (issue, opts) => {
      calls.eligibility.push({ issue, opts });
      return eligibility(issue, opts);
    },
  };
  const driveOne = async (n) => {
    calls.driveOne.push(n);
    return facts(n) || DEFAULT_FACTS;
  };
  return {
    deps, calls, driveOne,
    steps: steps || [policyStepWith(POLICY_RESOLVED)],
    driven: () => calls.driveOne.slice(),
    lines: () => out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    get out() { return out.join(''); },
    get err() { return errs.join(''); },
  };
}

const run = (f, budget = 'all') => runBudget(budget, newShared(), f.deps, { driveOne: f.driveOne, steps: f.steps });

// The run's one summary line, which is its last line (AC9.5: every summary line carries
// step BUDGET_STEP, run null and record null; its status follows ended).
function summaryOf(f) {
  const lines = f.lines();
  const budgetLines = lines.filter((l) => l.step === BUDGET_STEP);
  assert.equal(budgetLines.length, 1, 'exactly one summary line');
  const summary = lines.at(-1);
  assert.equal(summary.step, BUDGET_STEP, 'the summary is the last line');
  assert.equal(summary.run, null);
  assert.equal(summary.record, null);
  assert.equal(summary.status, STATUS_BY_ENDED[summary.ended]);
  return summary;
}

test('AC1.1, AC1.2, AC1.3: --budget all drives the module-iterated order, restricted to admitted records', async () => {
  // high band: #11 older than #10 (a tie in the band); medium: bundle [20, 21, 22] whose first member admission refuses;
  // low: #30; no priority: #50; [40, 41] is oversized.
  const groups = [[pulled(10, { priority: 'high', createdAt: '2026-01-02T00:00:00Z' })], [pulled(11, { priority: 'high', createdAt: '2026-01-01T00:00:00Z' })],
    [pulled(20, { priority: 'medium', createdAt: '2026-01-03T00:00:00Z' }), pulled(21, { priority: 'medium', createdAt: '2026-01-04T00:00:00Z' }), pulled(22, { priority: 'medium', createdAt: '2026-01-05T00:00:00Z' })],
    [pulled(30, { priority: 'low', createdAt: '2026-01-01T00:00:00Z' })], [pulled(40, { priority: 'high', createdAt: '2025-01-01T00:00:00Z' }), pulled(41, { priority: 'high', createdAt: '2025-01-02T00:00:00Z' })],
    [pulled(50, { createdAt: '2025-06-01T00:00:00Z' })]];
  const exclusions = [{ reason: 'oversized', records: [40, 41], detail: { size: 2, threshold: 1 } }];
  // Expected: the dispatch Loop over the module — rank, take the top group, add it to firing, pull again.
  const reference = []; const firing = [];
  for (let g = rankNext(groups, exclusions, {}); g; g = rankNext(groups, [...exclusions, { reason: 'firing', records: firing.slice() }], {})) {
    for (const r of g) { reference.push(r.number); firing.push(r.number); }
  }
  const refused = new Set([20]);
  const f = fake({ pulls: [{ groups, exclusions }], facts: (n) => (refused.has(n) ? { final: null, outcome: 'refused', claimed: false, claimExit: null } : undefined) });
  assert.equal(await runBudget('all', newShared(), f.deps, { driveOne: f.driveOne, steps: f.steps }), 0);
  assert.deepEqual(f.driven(), reference, 'every handed record, in the reference order');
  assert.deepEqual(f.driven().filter((n) => !refused.has(n)), reference.filter((n) => !refused.has(n)));
  assert.ok(f.driven().indexOf(21) > f.driven().indexOf(20) && f.driven().indexOf(22) > f.driven().indexOf(21), 'the bundle is driven in its own order after a refused first member');
  assert.ok(!f.driven().includes(40) && !f.driven().includes(41), 'the oversized group is never driven');
  const summary = summaryOf(f);
  assert.deepEqual([summary.ended, summary.driven, summary.refused], ['exhausted', reference.length - 1, 1]);
});

test('AC4.1, AC4.2, AC4.4: only a claimed record consumes budget — refused, contested and failed claims do not', async () => {
  // #4's claim fails another way (exit 5): counted claimFailed, consumes nothing, the run goes on.
  const byRecord = {
    1: { final: null, outcome: 'refused', claimed: false, claimExit: null },
    2: { final: null, outcome: 'blocked', claimed: true, claimExit: 0 },
    3: { final: null, outcome: 'blocked', claimed: false, claimExit: 3 },
    4: { final: null, outcome: 'blocked', claimed: false, claimExit: 5 },
  };
  const f = fake({ pulls: [{ groups: singletons(1, 2, 3, 4, 5, 6), exclusions: [] }], facts: (n) => byRecord[n] });
  assert.equal(await run(f, 2), 0);
  assert.deepEqual(f.driven(), [1, 2, 3, 4, 5]);
  assert.ok(!f.driven().includes(6), '#6 is never driven');
  const summary = summaryOf(f);
  assert.deepEqual([summary.driven, summary.refused, summary.contested, summary.claimFailed, summary.ended], [2, 1, 1, 1, 'budget']);
});

test('AC4.3: a record handled once is never selected again in this invocation', async () => {
  const f = fake({
    pulls: [{ groups: singletons(1, 2), exclusions: [] }],
    facts: (n) => (n === 1 ? { final: null, outcome: 'refused', claimed: false, claimExit: null } : undefined),
  });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.driven(), [1, 2]);
  assert.equal(f.driven().filter((n) => n === 1).length, 1);
  assert.equal(summaryOf(f).ended, ENDED.EXHAUSTED);
});

test('AC6.1, AC6.2: the same admission-refused record on every pull is attempted once', async () => {
  const f = fake({
    pulls: [{ groups: singletons(1), exclusions: [] }],
    facts: () => ({ final: null, outcome: 'refused', claimed: false, claimExit: null }),
  });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.driven(), [1]);
  assert.equal(f.calls.queuePull.length, 2);
  const summary = summaryOf(f);
  assert.equal(summary.ended, 'exhausted');
  assert.equal(summary.refused, 1);
  assert.ok(f.calls.rankNext[1].some((e) => e.reason === 'firing' && JSON.stringify(e.records) === JSON.stringify([1])),
    'the second ranking excludes #1 as firing');
});

test('AC6.3: an empty queue ends with zero driven', async () => {
  const f = fake({ pulls: [{ groups: [], exclusions: [] }] });
  assert.equal(await run(f), 0);
  const summary = summaryOf(f);
  assert.equal(summary.ended, 'exhausted');
  assert.equal(summary.status, 'ok');
  for (const c of COUNTERS) assert.equal(summary[c], 0, c);
  assert.equal(f.calls.queuePull.length, 1);
  assert.deepEqual(f.driven(), []);
  // A per-invocation session, the policy step's main root, and the caller's env.
  const { options } = f.calls.queuePull[0];
  assert.deepEqual(options, { transport: 'gh', sessionId: 'drive-2026-11-13T090807-4242', cwd: '/main', env: f.deps.env, inputs: {}, omit: [] });
  assert.deepEqual(f.calls.appendFile, [], 'no file write');
});

test('AC6.4: a top record the pre-screen rules out is skipped once and the run reaches the records below it', async () => {
  const groups = [[pulled(1, { priority: 'high' })], [pulled(2, { priority: 'medium' })], [pulled(3, { priority: 'low' })]];
  const f = fake({
    pulls: [{ groups, exclusions: [] }],
    eligibility: (issue) => (issue.number === 1 ? { eligible: false, reasons: ['no'] } : { eligible: true, reasons: [] }),
  });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.driven(), [2, 3]);
  const summary = summaryOf(f);
  assert.deepEqual([summary.skipped, summary.driven, summary.ended], [1, 2, 'exhausted']);
  assert.match(f.err, /drive\.js: pre-screen skipped #1 \(no\); no live fetch/);
  assert.doesNotMatch(f.err, /pre-screen skipped #[23]/);
  // The all-skip group joins firing at the pull that screened it, so it never costs a pull of
  // its own: one pull each for #2 and #3, and one that ranks nothing.
  assert.equal(f.calls.queuePull.length, 3);
  // Pre-screened once per record per invocation, with the pulled fields and the eligibility step's own options.
  assert.deepEqual(f.calls.eligibility.map((c) => c.issue.number), [1, 2, 3]);
  assert.deepEqual(f.calls.eligibility[0].issue, { number: 1, title: 'r1', body: 'body', labels: [], state: 'OPEN' });
  for (const c of f.calls.eligibility) assert.deepEqual(c.opts, eligibilityOptions(POLICY_RESOLVED));
});

test('pre-screen: a group the pull excluded as oversized or neighbour-in-flight is never screened, counted or driven', async () => {
  const groups = [[pulled(1)], [pulled(40), pulled(41)], [pulled(50)]];
  const exclusions = [
    { reason: 'oversized', records: [40, 41], detail: { size: 2, threshold: 1 } },
    { reason: 'neighbour-in-flight', records: [50] },
  ];
  const f = fake({
    pulls: [{ groups, exclusions }],
    eligibility: (issue) => ({ eligible: ![40, 41, 50].includes(issue.number), reasons: ['no'] }),
  });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.driven(), [1]);
  assert.deepEqual(f.calls.eligibility.map((c) => c.issue.number), [1], 'only the selectable group is pre-screened');
  const summary = summaryOf(f);
  assert.deepEqual([summary.skipped, summary.driven, summary.ended], [0, 1, 'exhausted']);
  assert.ok(f.calls.rankNext.every((entries) => entries.filter((e) => e.reason === 'firing').every((e) => !e.records.some((n) => [40, 41, 50].includes(n)))),
    'the excluded records never join firing');
});

test('UNSELECTABLE_REASONS: every reason is one the real rankNext never selects', () => {
  assert.ok(UNSELECTABLE_REASONS.length > 0 && Object.isFrozen(UNSELECTABLE_REASONS));
  const group = [pulled(1)];
  assert.deepEqual(rankNext([group], [], {}), group, 'control: the lone group is selectable unexcluded');
  for (const reason of UNSELECTABLE_REASONS) {
    assert.equal(rankNext([group], [{ reason, records: [1] }], {}), null, reason);
  }
});

// The other direction: a new non-removing exclusion pass in queue-pull.js (which rankNext must
// then skip too) must land in UNSELECTABLE_REASONS, or the loop would pre-screen and count
// records the ranking can never select. It is the queue-pull module's own list, never a copy.
test('UNSELECTABLE_REASONS is exactly the PASSES registry\'s non-removing exclusion reasons', () => {
  assert.equal(UNSELECTABLE_REASONS, STAYING_EXCLUSION_REASONS, 'the same array the ranking reads, not a hand copy');
  const staying = [...new Set(PASSES.filter((p) => p.kind === 'exclusion' && !p.removes).map((p) => p.reason))];
  assert.ok(staying.length > 0, 'the registry has non-removing exclusion reasons');
  assert.deepEqual([...UNSELECTABLE_REASONS].sort(), staying.sort());
});

test('AC6.5: a queue that never shrinks still ends', async () => {
  const f = fake({ pulls: [{ groups: singletons(1, 2, 3), exclusions: [] }] });
  assert.equal(await run(f), 0);
  assert.equal(summaryOf(f).driven, 3);
  assert.equal(f.calls.queuePull.length, 4);
});

test('AC7.1: claim exit 7 ends the run with the rest of the budget unused', async () => {
  const f = fake({
    pulls: [{ groups: singletons(1, 2, 3), exclusions: [] }],
    facts: (n) => (n === 2 ? { final: null, outcome: 'blocked', claimed: false, claimExit: 7 } : undefined),
  });
  assert.equal(await run(f, 5), 0);
  assert.deepEqual(f.driven(), [1, 2]);
  const summary = summaryOf(f);
  assert.deepEqual([summary.ended, summary.status, summary.permissionStopped, summary.driven, summary.budget], ['permission-stop', 'stop', 1, 1, 5]);
  assert.equal(summary.detail, 'claim-targets.js exit 7 on #2');
});

test('AC8.1: a failed first pull is not an empty queue', async () => {
  const stop = Object.assign(new Error('x'), { name: 'QueuePullStopped', line: 'dispatch: queue-pull stopped -- fetch failed' });
  const f = fake({ pulls: [stop] });
  assert.equal(await run(f), 1);
  assert.match(f.err, /dispatch: queue-pull stopped -- fetch failed/);
  const summary = summaryOf(f);
  assert.deepEqual([summary.ended, summary.status, summary.driven], ['pull-failed', 'fail', 0]);
  assert.match(summary.detail, /dispatch: queue-pull stopped -- fetch failed/);
  assert.deepEqual(f.driven(), []);
});

test('AC8.2: a failed re-pull keeps what was driven', async () => {
  const f = fake({ pulls: [{ groups: singletons(1), exclusions: [] }, new Error('boom')] });
  assert.equal(await run(f), 1);
  assert.deepEqual(f.driven(), [1]);
  const summary = summaryOf(f);
  assert.deepEqual([summary.driven, summary.ended], [1, 'pull-failed']);
});

test('pull-failed: a malformed pull is not an empty queue', async () => {
  const malformed = [
    { groups: 'x', exclusions: [] }, { groups: [[{ number: 1 }], 'x'], exclusions: [] }, { groups: [], exclusions: 'x' }, null,
    // A member that is not a numbered record: null, a primitive, no number, a non-integer or string number.
    { groups: [[pulled(1)], [null]], exclusions: [] }, { groups: [[pulled(1), 'x']], exclusions: [] },
    { groups: [[{ ...pulled(1), number: undefined }]], exclusions: [] }, { groups: [[{ ...pulled(1), number: 1.5 }]], exclusions: [] },
    { groups: [[{ ...pulled(1), number: '1' }]], exclusions: [] },
    // An empty group: the ranking returns [] for it, which would loop forever without this refusal.
    { groups: [[]], exclusions: [] }, { groups: [[pulled(1)], []], exclusions: [] },
  ];
  for (const pull of malformed) {
    // A second pull is an error, so a pull wrongly accepted ends red here rather than looping on the last pull forever.
    const f = fake({ pulls: [pull, new Error('pulled again after a malformed pull')] });
    assert.equal(await run(f), 1, JSON.stringify(pull));
    assert.equal(summaryOf(f).ended, 'pull-failed', JSON.stringify(pull));
    assert.match(f.err, /^drive\.js: queue pull failed: malformed result/, JSON.stringify(pull));
    assert.deepEqual(f.driven(), []);
    assert.deepEqual(f.calls.eligibility, [], 'nothing pre-screened from a malformed pull');
  }
});

test('pull-failed: a ranking that throws is not an empty queue', async () => {
  const f = fake({ pulls: [{ groups: singletons(1), exclusions: [] }] });
  f.deps.rankNext = () => { throw new Error('rank broke'); };
  assert.equal(await run(f), 1);
  assert.equal(summaryOf(f).ended, 'pull-failed');
  assert.match(f.err, /queue pull failed: rank broke/);
});

test('AC9.4, AC9.6: counters partition every handled record', async () => {
  const byRecord = {
    2: { final: null, outcome: 'refused', claimed: false, claimExit: null },
    3: { final: null, outcome: 'blocked', claimed: false, claimExit: 3 },
    4: { final: null, outcome: 'blocked', claimed: false, claimExit: 5 },
    5: { final: null, outcome: 'blocked', claimed: false, claimExit: 0 },
  };
  const f = fake({
    pulls: [{ groups: singletons(1, 2, 3, 4, 5, 6), exclusions: [] }],
    eligibility: (issue) => ({ eligible: issue.number !== 6, reasons: [] }),
    facts: (n) => byRecord[n],
  });
  assert.equal(await run(f), 0);
  const summary = summaryOf(f);
  const pick = (s) => Object.fromEntries(['budget', ...COUNTERS, 'ended', 'status'].map((k) => [k, s[k]]));
  assert.deepEqual(pick(summary), { budget: 'all', driven: 1, refused: 1, skipped: 1, contested: 1, claimFailed: 2, permissionStopped: 0, ended: 'exhausted', status: 'ok' });
  assert.equal(COUNTERS.reduce((sum, c) => sum + summary[c], 0), 6, 'the counters sum to the fixture record count');
});

test('classifyFacts: one counter per fact shape, a killed claim included', () => {
  const rows = [
    [{ outcome: 'pending-review', claimed: true, claimExit: 0 }, 'driven'],
    [{ outcome: 'blocked', claimed: true, claimExit: 0 }, 'driven'],
    [{ outcome: 'refused', claimed: false, claimExit: null }, 'refused'],
    [{ outcome: 'blocked', claimed: false, claimExit: 3 }, 'contested'],
    [{ outcome: 'blocked', claimed: false, claimExit: 7 }, 'permissionStopped'],
    [{ outcome: 'blocked', claimed: false, claimExit: 2 }, 'claimFailed'],
    [{ outcome: 'blocked', claimed: false, claimExit: 4 }, 'claimFailed'],
    [{ outcome: 'blocked', claimed: false, claimExit: 5 }, 'claimFailed'],
    [{ outcome: 'blocked', claimed: false, claimExit: 6 }, 'claimFailed'],
    [{ outcome: 'blocked', claimed: false, claimExit: 0 }, 'claimFailed'],
    // A killed or timed-out claim-targets.js: no exit code, and the record was not refused.
    [{ outcome: 'blocked', claimed: false, claimExit: null }, 'claimFailed'],
  ];
  for (const [facts, counter] of rows) assert.equal(classifyFacts(facts), counter, JSON.stringify(facts));
  for (const [, counter] of rows) assert.ok(COUNTERS.includes(counter));
});

test('AC9.5: status follows ended', () => {
  assert.deepEqual(STATUS_BY_ENDED, { budget: 'ok', exhausted: 'ok', 'permission-stop': 'stop', 'claim-stop': 'stop', 'pull-failed': 'fail', 'policy-refused': 'ok' });
  assert.deepEqual(Object.values(ENDED).sort(), Object.keys(STATUS_BY_ENDED).sort());
  assert.deepEqual(COUNTERS, ['driven', 'refused', 'skipped', 'contested', 'claimFailed', 'permissionStopped']);
  for (const o of [ENDED, STATUS_BY_ENDED, COUNTERS]) assert.ok(Object.isFrozen(o));
  assert.equal(BUDGET_STEP, 'budget');
});

test('PRC1: claim exits 2 and 6 end the run; exits 4 and 5 do not', async () => {
  for (const exit of [2, 6, 4, 5]) {
    const f = fake({
      pulls: [{ groups: singletons(1, 2, 3), exclusions: [] }],
      facts: (n) => (n === 2 ? { final: null, outcome: 'blocked', claimed: false, claimExit: exit } : undefined),
    });
    assert.equal(await run(f), 0, `exit ${exit}`);
    const summary = summaryOf(f);
    if ([2, 6].includes(exit)) {
      assert.deepEqual(f.driven(), [1, 2], `exit ${exit}`);
      assert.deepEqual([summary.ended, summary.status, summary.claimFailed, summary.permissionStopped], ['claim-stop', 'stop', 1, 0], `exit ${exit}`);
      assert.match(summary.detail, new RegExp(`exit ${exit} on #2`));
    } else {
      assert.deepEqual(f.driven(), [1, 2, 3], `exit ${exit}`);
      assert.equal(summary.ended, 'exhausted', `exit ${exit}`);
    }
  }
});

test('AC11.1: a pulled record lacking a field the eligibility function needs passes through', async () => {
  const noLabels = pulled(1);
  delete noLabels.labels;
  const numericBody = { ...pulled(2), body: 42 };
  const f = fake({ pulls: [{ groups: [[noLabels], [numericBody]], exclusions: [] }] });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.driven(), [1, 2]);
  assert.deepEqual(f.calls.eligibility, [], 'the eligibility function is never called for them');
  assert.equal(summaryOf(f).skipped, 0);
  // The unparseable case is surfaced on stderr, never silently, and stdout stays JSON-only.
  assert.match(f.err, /drive\.js: pre-screen could not read #1 \(labels is not an array\); taking the full path/);
  assert.match(f.err, /drive\.js: pre-screen could not read #2 \(body is not a string\); taking the full path/);
  for (const line of f.out.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line), line);
  assert.doesNotMatch(f.out, /pre-screen/);

  const throwing = { evaluateRecordEligibility: () => { throw new Error('bad record'); } };
  const verdict = preScreen(pulled(3), eligibilityOptions(POLICY_RESOLVED), throwing);
  assert.equal(verdict.verdict, 'unparseable');
  assert.deepEqual(preScreen(null, {}, throwing).verdict, 'unparseable');
  const g = fake({ pulls: [{ groups: singletons(3), exclusions: [] }] });
  g.deps.evaluateRecordEligibility = throwing.evaluateRecordEligibility;
  assert.equal(await run(g), 0);
  assert.deepEqual(g.driven(), [3], 'an unparseable record reaches the full path');
  assert.equal(summaryOf(g).skipped, 0);
});

test('preScreen: skip when not eligible, pass when eligible, with the pulled fields only', () => {
  const seen = [];
  const deps = (eligible) => ({ evaluateRecordEligibility: (issue, opts) => { seen.push([issue, opts]); return { eligible, reasons: eligible ? [] : ['why'] }; } });
  const opts = eligibilityOptions(POLICY_RESOLVED);
  assert.deepEqual(preScreen(pulled(4), opts, deps(false)), { verdict: 'skip', reasons: ['why'] });
  assert.equal(preScreen(pulled(4), opts, deps(true)).verdict, 'pass');
  assert.deepEqual(seen[0], [{ number: 4, title: 'r4', body: 'body', labels: [], state: 'OPEN' }, opts]);
});

test('budget: the module\'s stdout goes to stderr', async () => {
  const f = fake({
    queuePull: (options, moduleDeps) => {
      moduleDeps.stdout('Warning: x\n');
      moduleDeps.stderr('queue-pull: y\n');
      return EMPTY_PULL;
    },
  });
  assert.equal(await run(f), 0);
  for (const line of f.out.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line), line);
  assert.doesNotMatch(f.out, /Warning: x/);
  assert.match(f.err, /Warning: x/);
  assert.match(f.err, /queue-pull: y/);
});

test('policy: an unreadable policy exits 1 with no pull and no summary line', async () => {
  const failing = defineStep(STEP.policy, 'refused', async () => ({ status: 'fail', detail: 'policy unreadable: express-driver (unknown-key)' }));
  const f = fake({ steps: [failing] });
  assert.equal(await run(f), 1);
  assert.deepEqual(f.lines().map((l) => [l.step, l.status, l.run, l.record, l.detail]),
    [[STEP.policy, 'fail', null, null, 'policy unreadable: express-driver (unknown-key)']]);
  assert.match(f.err, /^drive\.js: policy unreadable: express-driver \(unknown-key\)/);
  assert.deepEqual([f.calls.queuePull.length, f.calls.rankNext.length, f.calls.eligibility.length, f.driven().length, f.calls.appendFile.length], [0, 0, 0, 0, 0]);
});

test('policy: express-driver off drives nothing and ends policy-refused', async () => {
  const f = fake({ steps: [policyStepWith({ ...POLICY_RESOLVED, 'express-driver': { value: 'off' } })] });
  assert.equal(await run(f, 2), 0);
  const lines = f.lines();
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0].step, lines[0].status, lines[0].run, lines[0].record], [STEP.policy, 'stop', null, null]);
  assert.match(lines[0].detail, /express-driver off/);
  const summary = summaryOf(f);
  assert.deepEqual([summary.ended, summary.status, summary.budget], ['policy-refused', 'ok', 2]);
  for (const c of COUNTERS) assert.equal(summary[c], 0, c);
  assert.deepEqual([f.calls.queuePull.length, f.calls.rankNext.length, f.calls.eligibility.length, f.driven().length, f.calls.appendFile.length], [0, 0, 0, 0, 0]);
});

test('policy: a signal queued during the policy read ends the run with no line, even under express-driver off', async () => {
  const shared = newShared();
  const signalling = defineStep(STEP.policy, 'refused', async (ctx) => {
    ctx.shared.policy = { ...POLICY_RESOLVED, 'express-driver': { value: 'off' } };
    ctx.shared.mainRoot = '/main';
    setImmediate(() => { shared.interrupted = 'SIGINT'; });
    return { status: 'ok' };
  });
  const f = fake({ steps: [signalling] });
  assert.equal(await runBudget(2, shared, f.deps, { driveOne: f.driveOne, steps: f.steps }), 0);
  assert.deepEqual(f.lines(), [], 'no refusal line and no summary line');
  assert.equal(f.calls.queuePull.length, 0);
});

test('budget: --budget n ends once n records are driven, with no further pull', async () => {
  const f = fake({ pulls: [{ groups: singletons(1, 2, 3), exclusions: [] }] });
  assert.equal(await run(f, 2), 0);
  assert.deepEqual(f.driven(), [1, 2]);
  const summary = summaryOf(f);
  assert.deepEqual([summary.ended, summary.driven, summary.budget], ['budget', 2, 2]);
  assert.equal(f.calls.queuePull.length, 2);
});

test('budget: a signal queued during a record\'s last call ends the loop with nothing further emitted', async () => {
  // Delivered only when the event loop turns: without the loop's turn after driveOne, #1 would
  // be counted, the budget of 1 read as spent and a summary line written under a pending signal.
  const shared = newShared();
  const f = fake({ pulls: [{ groups: singletons(1, 2), exclusions: [] }] });
  const driveOne = async (n) => {
    const r = await f.driveOne(n);
    setImmediate(() => { shared.interrupted = 'SIGTERM'; });
    return r;
  };
  assert.equal(await runBudget(1, shared, f.deps, { driveOne, steps: f.steps }), 0);
  assert.deepEqual(f.driven(), [1]);
  assert.equal(f.calls.queuePull.length, 1);
  assert.equal(f.lines().filter((l) => l.step === BUDGET_STEP).length, 0, 'no summary line');
});
