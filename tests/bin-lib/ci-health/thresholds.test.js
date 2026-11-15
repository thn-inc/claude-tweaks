'use strict';
// Record #5161 — plugin/bin/lib/ci-health/thresholds.js: breach detection over the stats and
// billing results, the one breach issue's composition, and dedup-then-file over injected deps.
// Fake deps record their calls; assertions run after. No fixture carries an amount.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  BREACH_TITLE, breachesOf, composeBreachIssue, fileBreaches,
} = require('../../../plugin/bin/lib/ci-health/thresholds');
const { MERGE_GATE_WATCH_SECONDS, DEFAULT_MIN_HEADROOM_PCT } = require('../../../plugin/bin/lib/ci-health/constants');

const OPTS = { minHeadroomPct: DEFAULT_MIN_HEADROOM_PCT, watchSeconds: MERGE_GATE_WATCH_SECONDS };
const NO_BILLING = { available: false, status: 404, reason: 'HTTP 404' };
const AMOUNT_RE = /[$€£]\s?\d|\bUSD\b/;

function wf(over) {
  return {
    name: 'CI',
    path: '.github/workflows/ci.yml',
    events: ['pull_request', 'push'],
    runs: 5,
    completedRuns: 5,
    skippedRuns: 0,
    noWorkRuns: 0,
    p50Seconds: 600,
    p90Seconds: 1300,
    ...over,
  };
}

function compose(workTypes) {
  return { repo: 'example-org/example-repo', days: 30, watchSeconds: 900, minHeadroomPct: 10, workTypes };
}

function fakeDeps({ titles = [], titlesError = null, createError = null } = {}) {
  const calls = { openIssueTitles: 0, createIssue: [] };
  const deps = {
    openIssueTitles: () => {
      calls.openIssueTitles += 1;
      if (titlesError) throw titlesError;
      return titles;
    },
    createIssue: (payload) => {
      calls.createIssue.push(payload);
      if (createError) throw createError;
      return { number: 42 };
    },
  };
  return { calls, deps };
}

// `truncatedRanges` is fetch.js's list, which the CLI passes in the compose args.
function fileFor(workflows, billing, { workTypes = 'native', file = true, truncatedRanges = [], partial = false, deps } = {}) {
  const breaches = breachesOf({ workflows, billing }, OPTS);
  return fileBreaches({ breaches, partial, file }, deps, { ...compose(workTypes), truncatedRanges });
}
// fetch.js's range labels: both ends inclusive UTC days, as GitHub's own `created=a..b` reads them.
const CAPPED = [{ from: '2026-10-27', to: '2026-11-02', reason: 'cap' }];
const SAMPLED_RE = /sampled/;

test('BREACH_TITLE is the spec title, verbatim', () => {
  assert.strictEqual(BREACH_TITLE, 'CI health: workflow p90 duration or Actions budget headroom breaches a threshold');
});

test('AC8.1: a pull_request workflow over the watch files one native-typed issue', () => {
  const { calls, deps } = fakeDeps();
  const result = fileFor([wf()], NO_BILLING, { deps });
  assert.strictEqual(calls.openIssueTitles, 1);
  assert.strictEqual(calls.createIssue.length, 1);
  const payload = calls.createIssue[0];
  assert.strictEqual(payload.title, BREACH_TITLE);
  for (const label of ['by:harness-health', 'risk:low', 'size:low']) assert.ok(payload.labels.includes(label), label);
  assert.ok(!payload.labels.some((l) => l.startsWith('type:')), payload.labels.join(','));
  assert.ok(!payload.labels.includes('ready'), 'not born ready');
  assert.strictEqual(payload.type, 'task');
  assert.ok(payload.body.includes('ci.yml'));
  assert.ok(payload.body.includes('1300'));
  assert.doesNotMatch(payload.body, AMOUNT_RE);
  assert.deepStrictEqual(result, { filed: { title: BREACH_TITLE, number: 42 }, skipped: null, failure: null });
});

test('AC8.1: work-types labels adds type:task and returns type null', () => {
  const { calls, deps } = fakeDeps();
  fileFor([wf()], NO_BILLING, { deps, workTypes: 'labels' });
  assert.strictEqual(calls.createIssue.length, 1);
  const payload = calls.createIssue[0];
  for (const label of ['by:harness-health', 'risk:low', 'size:low', 'type:task']) assert.ok(payload.labels.includes(label), label);
  assert.strictEqual(payload.type, null);
});

test('AC8.1: work-types unset (null) takes the native shape', () => {
  const { calls, deps } = fakeDeps();
  fileFor([wf()], NO_BILLING, { deps, workTypes: null });
  assert.strictEqual(calls.createIssue.length, 1);
  const payload = calls.createIssue[0];
  assert.ok(!payload.labels.some((l) => l.startsWith('type:')), payload.labels.join(','));
  assert.strictEqual(payload.type, 'task');
});

test('AC8.2: a p90 breach plus a headroom breach file one issue naming both', () => {
  const { calls, deps } = fakeDeps();
  const billing = { available: true, scope: 'org', headroomPct: 5 };
  const breaches = breachesOf({ workflows: [wf()], billing }, { minHeadroomPct: 10, watchSeconds: 900 });
  assert.deepStrictEqual(breaches.map((b) => b.kind), ['p90-over-watch', 'headroom-below-floor']);
  fileBreaches({ breaches, file: true }, deps, compose('native'));
  assert.strictEqual(calls.createIssue.length, 1);
  const { body } = calls.createIssue[0];
  assert.ok(body.includes('ci.yml'));
  assert.ok(body.includes('- Actions budget headroom 5%, below the 10% floor.'));
  assert.doesNotMatch(body, AMOUNT_RE);
});

test('AC8.3: an open issue with the exact title skips filing', () => {
  const { calls, deps } = fakeDeps({ titles: ['Something else', BREACH_TITLE] });
  const result = fileFor([wf()], NO_BILLING, { deps });
  assert.strictEqual(calls.createIssue.length, 0);
  assert.deepStrictEqual(result, { filed: null, skipped: 'open issue exists', failure: null });
});

test('dedup is an exact title match: a suffixed or lower-cased title still files', () => {
  const { calls, deps } = fakeDeps({ titles: [`${BREACH_TITLE} (old)`, BREACH_TITLE.toLowerCase()] });
  const result = fileFor([wf()], NO_BILLING, { deps });
  assert.strictEqual(calls.createIssue.length, 1);
  assert.deepStrictEqual(result, { filed: { title: BREACH_TITLE, number: 42 }, skipped: null, failure: null });
});

test('AC8.4: push-only and schedule-only slow workflows, p90 at the watch, unreadable billing: no breach', () => {
  const workflows = [
    wf({ name: 'Release', path: '.github/workflows/release.yml', events: ['push'], p90Seconds: 2000 }),
    wf({ name: 'Nightly', path: '.github/workflows/nightly.yml', events: ['schedule'], p90Seconds: 2000 }),
    wf({ p90Seconds: 900 }),
  ];
  assert.deepStrictEqual(breachesOf({ workflows, billing: NO_BILLING }, OPTS), []);
  const { calls, deps } = fakeDeps();
  const result = fileFor(workflows, NO_BILLING, { deps });
  assert.strictEqual(calls.openIssueTitles, 0);
  assert.strictEqual(calls.createIssue.length, 0);
  assert.strictEqual(result.skipped, 'no breach');
});

test('AC8.5: a breach without --file files nothing', () => {
  const { calls, deps } = fakeDeps();
  const result = fileFor([wf()], NO_BILLING, { deps, file: false });
  assert.strictEqual(calls.openIssueTitles, 0);
  assert.strictEqual(calls.createIssue.length, 0);
  assert.deepStrictEqual(result, { filed: null, skipped: 'no --file', failure: null });
});

test('AC7.5: headroom 5% breaches a 10% floor and not a 3% floor', () => {
  const billing = { available: true, scope: 'org', headroomPct: 5 };
  assert.deepStrictEqual(
    breachesOf({ workflows: [], billing }, { minHeadroomPct: 10, watchSeconds: 900 }),
    [{ kind: 'headroom-below-floor', headroomPct: 5, floor: 10 }],
  );
  assert.deepStrictEqual(breachesOf({ workflows: [], billing }, { minHeadroomPct: 3, watchSeconds: 900 }), []);
});

test('headroom exactly at the floor is not below it', () => {
  const billing = { available: true, scope: 'org', headroomPct: 10 };
  assert.deepStrictEqual(breachesOf({ workflows: [], billing }, { minHeadroomPct: 10, watchSeconds: 900 }), []);
});

test('AC7.7: a null headroom never breaches', () => {
  const billing = { available: true, scope: 'org', headroomPct: null, reason: 'no Actions budget to compare' };
  assert.deepStrictEqual(breachesOf({ workflows: [], billing }, OPTS), []);
});

test('the p90 breach floor reads completedRuns: 4 completed runs never breach', () => {
  assert.deepStrictEqual(breachesOf({ workflows: [wf({ runs: 4, completedRuns: 4 })], billing: NO_BILLING }, OPTS), []);
});

test('a skipped no-work run never lifts a workflow to the p90 floor', () => {
  const workflows = [wf({ runs: 5, noWorkRuns: 1, completedRuns: 4 })];
  assert.deepStrictEqual(breachesOf({ workflows, billing: NO_BILLING }, OPTS), []);
});

test('the p90 breach carries the workflow name, path and p90', () => {
  assert.deepStrictEqual(breachesOf({ workflows: [wf()], billing: NO_BILLING }, OPTS), [
    { kind: 'p90-over-watch', workflow: 'CI', path: '.github/workflows/ci.yml', p90Seconds: 1300 },
  ]);
});

test('a truncated window files its p90 breach, and the body names the sampled weeks', () => {
  const { calls, deps } = fakeDeps();
  const result = fileFor([wf()], NO_BILLING, { deps, truncatedRanges: CAPPED });
  assert.deepStrictEqual(result, { filed: { title: BREACH_TITLE, number: 42 }, skipped: null, failure: null });
  assert.strictEqual(calls.createIssue.length, 1);
  const { title, body } = calls.createIssue[0];
  assert.strictEqual(title, BREACH_TITLE);
  assert.ok(body.includes("Run figures for 1 of 5 weeks are sampled from each week's newest 1000 runs (2026-10-27..2026-11-02 cap); durations are sampled, counts for those weeks are partial."), body);
  assert.doesNotMatch(body, AMOUNT_RE);
});

test('a truncated window files a headroom-only breach, the sampled weeks named', () => {
  const { calls, deps } = fakeDeps();
  const billing = { available: true, scope: 'org', headroomPct: 5 };
  const result = fileFor([wf({ p90Seconds: 600 })], billing, { deps, truncatedRanges: CAPPED });
  assert.deepStrictEqual(result.filed, { title: BREACH_TITLE, number: 42 });
  assert.strictEqual(calls.createIssue.length, 1);
  const { body } = calls.createIssue[0];
  assert.ok(body.includes('- Actions budget headroom 5%, below the 10% floor.'), body);
  assert.ok(body.includes('(2026-10-27..2026-11-02 cap)'), body);
  assert.doesNotMatch(body, AMOUNT_RE);
});

test('a budget week is named unread or partly read, never as sampled from runs it may not have read', () => {
  const ranges = [{ from: '2026-10-13', to: '2026-10-19', reason: 'budget' }, ...CAPPED];
  const { body } = composeBreachIssue(breachesOf({ workflows: [wf()], billing: NO_BILLING }, OPTS), { ...compose('native'), truncatedRanges: ranges });
  assert.ok(body.includes('Run figures for 2 of 5 weeks are partial (2026-10-13..2026-10-19 budget, 2026-10-27..2026-11-02 cap): a `cap` week is sampled from its newest 1000 runs, and a `budget` week is unread or partly read, as far as the 50-page read budget or the run\'s time deadline reached; durations come from the runs read.'), body);
});

test('a fully read window\'s issue body carries no sampled-weeks line', () => {
  const breaches = breachesOf({ workflows: [wf()], billing: NO_BILLING }, OPTS);
  for (const args of [{ ...compose('native'), truncatedRanges: [] }, compose('native')]) {
    const { body } = composeBreachIssue(breaches, args);
    assert.doesNotMatch(body, SAMPLED_RE, body);
  }
});

test('a failed runs read never files, a truncated window included', () => {
  const { calls, deps } = fakeDeps();
  const result = fileFor([wf()], NO_BILLING, { deps, partial: true });
  assert.strictEqual(calls.openIssueTitles, 0);
  assert.strictEqual(calls.createIssue.length, 0);
  assert.deepStrictEqual(result, { filed: null, skipped: 'runs read failed', failure: null });
  assert.strictEqual(fileFor([wf()], NO_BILLING, { deps, partial: true, truncatedRanges: CAPPED }).skipped, 'runs read failed');
  assert.strictEqual(calls.createIssue.length, 0);
  assert.strictEqual(fileFor([], NO_BILLING, { deps, partial: true }).skipped, 'no breach');
});

test('an openIssueTitles failure files nothing and names the query', () => {
  const { calls, deps } = fakeDeps({ titlesError: new Error('HTTP 502') });
  const result = fileFor([wf()], NO_BILLING, { deps });
  assert.strictEqual(calls.createIssue.length, 0);
  assert.deepStrictEqual(result, { filed: null, skipped: null, failure: { query: 'open issue titles', status: null, error: 'HTTP 502' } });
});

test('a non-list openIssueTitles result files nothing', () => {
  for (const titles of [{}, `prefix ${BREACH_TITLE} suffix`]) {
    const { calls, deps } = fakeDeps({ titles });
    const result = fileFor([wf()], NO_BILLING, { deps });
    assert.strictEqual(calls.createIssue.length, 0, typeof titles);
    assert.deepStrictEqual(result, {
      filed: null, skipped: null, failure: { query: 'open issue titles', status: null, error: 'open issue titles is not a list' },
    });
  }
});

test('a createIssue result without a finite number files with number null', () => {
  const { deps } = fakeDeps();
  deps.createIssue = () => ({});
  const result = fileFor([wf()], NO_BILLING, { deps });
  assert.deepStrictEqual(result.filed, { title: BREACH_TITLE, number: null });
  assert.strictEqual(result.failure, null);
});

test('a createIssue failure is reported as the file issue query', () => {
  const { calls, deps } = fakeDeps({ createError: new Error('HTTP 422') });
  const result = fileFor([wf()], NO_BILLING, { deps });
  assert.strictEqual(calls.createIssue.length, 1);
  assert.strictEqual(result.filed, null);
  assert.strictEqual(result.skipped, null);
  // The same {query, status, error} shape as every other failures[] entry.
  assert.deepStrictEqual(result.failure, { query: 'file issue', status: null, error: 'HTTP 422' });
});

test('the body states p90 is advisory run duration excluding queue wait', () => {
  const { body } = composeBreachIssue(breachesOf({ workflows: [wf()], billing: NO_BILLING }, OPTS), compose('native'));
  assert.ok(body.includes("p90 is run duration and excludes queue wait — advisory evidence for the merge gate's 900 s watch, not a verdict on it"));
  assert.ok(body.includes('## Release Note\n\nNo user-visible change — CI health evidence.'));
  assert.ok(body.includes('work-fingerprint: ci-health-threshold-breach'));
});

test('the footer states the open-title dedup rule, never a close or wontfix promise', () => {
  const { body } = composeBreachIssue(breachesOf({ workflows: [wf()], billing: NO_BILLING }, OPTS), compose('native'));
  assert.doesNotMatch(body, /wontfix/);
  assert.doesNotMatch(body, /Close to resolve/);
  assert.ok(body.includes('A later `--file` run files again while a breach remains and no open issue carries this exact title.'));
});

test('a fork-controlled workflow name is neutralized in the body', () => {
  const workflows = [wf({ name: 'CI `x`\n## Pwn @someone', path: '.github/workflows/ci.yml' })];
  const { body } = composeBreachIssue(breachesOf({ workflows, billing: NO_BILLING }, OPTS), compose('native'));
  assert.ok(body.includes("- Workflow `CI 'x' ## Pwn (at)someone` (`.github/workflows/ci.yml`)"), body);
  assert.doesNotMatch(body, /@someone/);
  assert.doesNotMatch(body, /\n## Pwn/);
});

test('a fork-controlled workflow path is neutralized in the body too', () => {
  const workflows = [wf({ name: 'CI', path: '.github/workflows/x`y\n## Pwn @someone.yml' })];
  const { body } = composeBreachIssue(breachesOf({ workflows, billing: NO_BILLING }, OPTS), compose('native'));
  assert.ok(body.includes("- Workflow `CI` (`.github/workflows/x'y ## Pwn (at)someone.yml`)"), body);
  assert.doesNotMatch(body, /@someone/);
  assert.doesNotMatch(body, /\n## Pwn/);
});

test('composeBreachIssue defaults the watch and the headroom floor to the constants', () => {
  const breaches = breachesOf({ workflows: [wf()], billing: NO_BILLING }, OPTS);
  const { body } = composeBreachIssue(breaches, { repo: 'example-org/example-repo', days: 30, workTypes: 'native' });
  assert.doesNotMatch(body, /undefined/);
  assert.ok(body.includes(`merge gate's ${MERGE_GATE_WATCH_SECONDS} s watch and a ${DEFAULT_MIN_HEADROOM_PCT}% Actions budget headroom floor`));
});
