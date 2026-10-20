'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  composeQaReport, classifyFailure, STATUSES, CATEGORIES,
} = require('../../../plugin/bin/lib/qa-report/compose');

const NOW = () => '2026-10-20T00:00:00.000Z';

function story(id, status, extra) {
  return {
    id, name: `Story ${id}`, source_file: 'app.yaml', status,
    steps_passed: 1, steps_total: 2, elapsed_seconds: 10,
    error: null, caveats: [], trace: null, screenshot_dir: `shots/${id}`,
    ...extra,
  };
}
function compose(stories, extra) {
  return composeQaReport({ run_dir: '/r', stories_dir: 'stories', wall_clock_seconds: 20, stories, ...extra }, { now: NOW });
}

test('exports the status and category vocabularies', () => {
  assert.deepEqual([...STATUSES], ['PASS', 'PASS_WITH_CAVEATS', 'FAIL', 'SKIPPED']);
  assert.deepEqual([...CATEGORIES].sort(), ['code-bug', 'flaky-env', 'stale-selector', 'story-bug', 'ux-issue']);
});

test('summary agrees with the stories array', () => {
  const { report, error } = compose([
    story('a', 'PASS'), story('b', 'PASS_WITH_CAVEATS', { caveats: ['x'] }),
    story('c', 'FAIL', { error: 'boom' }), story('d', 'SKIPPED'),
  ]);
  assert.equal(error, undefined);
  assert.deepEqual(report.summary, {
    total: 4, passed: 2, pass_with_caveats: 1, failed: 1, skipped: 1,
  });
  const count = (...ss) => report.stories.filter((s) => ss.includes(s.status)).length;
  assert.equal(report.summary.total, report.stories.length);
  assert.equal(report.summary.passed, count('PASS', 'PASS_WITH_CAVEATS'));
  assert.equal(report.summary.pass_with_caveats, count('PASS_WITH_CAVEATS'));
  assert.equal(report.summary.failed, count('FAIL'));
  assert.equal(report.summary.skipped, count('SKIPPED'));
});

test('classifyFailure applies rules 1-3 and defaults to code-bug', () => {
  assert.equal(classifyFailure('Locator "Submit" not found'), 'stale-selector');
  assert.equal(classifyFailure('Navigation failed: net::ERR'), 'flaky-env');
  assert.equal(classifyFailure('Expected "Dashboard" in title'), 'code-bug');
  assert.equal(classifyFailure(null), 'code-bug');
  assert.equal(classifyFailure('locator not found'), 'stale-selector');
  assert.equal(classifyFailure("Element 'nav' not found"), 'stale-selector');
  assert.equal(classifyFailure('something unrecognised'), 'code-bug');
  assert.equal(classifyFailure('Element not found after TIMEOUT'), 'stale-selector');
});

test('rule 1 matches the repo locator syntax and respects word boundaries', () => {
  assert.equal(classifyFailure('Step 2: Locator role:button "Submit" not found'), 'stale-selector');
  assert.equal(classifyFailure('locator testid:submit-cta not found'), 'stale-selector');
  assert.equal(classifyFailure('element with text "Hi" not found'), 'stale-selector');
  assert.notEqual(classifyFailure('allocator not found'), 'stale-selector');
  assert.equal(classifyFailure('allocator not found'), 'code-bug');
  assert.notEqual(classifyFailure(`locator ${'x'.repeat(200)} not found`), 'stale-selector');
});

test('rule 1 gap cap is exactly 120 characters between the noun and "not found"', () => {
  // gap = the space, the x-run, and the space before "not found"
  assert.equal(classifyFailure(`locator ${'x'.repeat(118)} not found`), 'stale-selector');
  assert.equal(classifyFailure(`locator ${'x'.repeat(119)} not found`), 'code-bug');
});

test('a flaky-env fix without run_dir offers a plain re-run, not retry=null', () => {
  const { report } = composeQaReport({ stories: [story('a', 'FAIL', { error: 'Timeout 30s' })] }, { now: NOW });
  assert.equal(report.findings[0].suggested_fix, 'Re-run: `/test qa`');
});

test('rules apply in order and each flaky-env signal stands alone', () => {
  assert.equal(classifyFailure('Timeout waiting; expected dialog'), 'flaky-env');
  assert.equal(classifyFailure('net::ERR_CONNECTION_REFUSED'), 'flaky-env');
  assert.equal(classifyFailure('navigation failed'), 'flaky-env');
});

test('FAIL findings carry severity, suggested fix and trace', () => {
  const { report } = compose([
    story('a', 'FAIL', { error: 'Locator "Submit" not found', trace: 't.zip' }),
    story('b', 'FAIL', { error: 'Timeout 30s' }),
    story('c', 'FAIL', { error: 'Expected x' }),
  ]);
  assert.deepEqual(report.findings, [
    {
      story_id: 'a', category: 'stale-selector', severity: 'Low', finding: 'Locator "Submit" not found',
      suggested_fix: 'Update locator in story YAML', trace: 't.zip',
    },
    {
      story_id: 'b', category: 'flaky-env', severity: 'Low', finding: 'Timeout 30s',
      suggested_fix: 'Re-run: `/test qa retry=/r`', trace: null,
    },
    {
      story_id: 'c', category: 'code-bug', severity: 'High', finding: 'Expected x',
      suggested_fix: 'Investigate component behavior', trace: null,
    },
  ]);
});

test('FAIL with null error still yields a finding', () => {
  const { report } = compose([story('a', 'FAIL', { error: null })]);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].category, 'code-bug');
  assert.equal(report.findings[0].severity, 'High');
  assert.equal(report.findings[0].finding, 'Story failed with no error text');
});

test('FAIL with empty-string error yields the fallback finding text', () => {
  const { report } = compose([story('a', 'FAIL', { error: '' })]);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].category, 'code-bug');
  assert.equal(report.findings[0].finding, 'Story failed with no error text');
});

test('category override wins and is validated', () => {
  const { report } = compose([story('s1', 'FAIL', { error: 'Locator not found', category: 'story-bug' })]);
  assert.equal(report.findings[0].category, 'story-bug');
  assert.equal(report.findings[0].severity, 'Medium');
  assert.equal(report.findings[0].suggested_fix, 'Regenerate story: `/stories focus=s1`');
  assert.deepEqual(compose([story('s1', 'FAIL', { category: 'bogus' })]), { error: 'invalid-category: s1 bogus' });
});

test('caveats become ux-issue findings and caveats entries', () => {
  const { report } = compose([
    story('a', 'FAIL', { error: 'Expected x' }),
    story('b', 'PASS_WITH_CAVEATS', { caveats: ['slow load', 'missing aria-label'] }),
  ]);
  assert.deepEqual(report.findings.slice(1), [
    {
      story_id: 'b', category: 'ux-issue', severity: 'Medium', finding: 'slow load',
      suggested_fix: 'Review the observation', trace: null,
    },
    {
      story_id: 'b', category: 'ux-issue', severity: 'Medium', finding: 'missing aria-label',
      suggested_fix: 'Review the observation', trace: null,
    },
  ]);
  assert.deepEqual(report.caveats, [
    { story_id: 'b', observation: 'slow load' },
    { story_id: 'b', observation: 'missing aria-label' },
  ]);
});

test('recovered locators and page inventories flatten with story ids', () => {
  const rl = { step_index: 0, original_locator: 'o', recovered_locator: 'n', reason: 'r' };
  const pi = { url: 'http://x/', interactive_elements: {}, forms: {}, navigation: {}, accessibility: {}, layout: {} };
  const { report } = compose([
    story('a', 'PASS', { source_file: 'a.yaml', recovered_locators: [rl], page_inventories: [pi] }),
    story('b', 'PASS'),
  ]);
  assert.deepEqual(report.recovered_locators, [{ story_id: 'a', source_file: 'a.yaml', ...rl }]);
  assert.deepEqual(report.page_inventories, [{ story_id: 'a', ...pi }]);
  assert.equal('recovered_locators' in report.stories[0], false);
  assert.equal('page_inventories' in report.stories[0], false);
  assert.equal('category' in report.stories[0], false);
});

test('the composed story_id / source_file win over an entry\'s own stray keys', () => {
  const rl = { story_id: 'bogus', source_file: 'bogus.yaml', step_index: 0 };
  const pi = { story_id: 'bogus', url: 'http://x/' };
  const { report } = compose([
    story('a', 'PASS', { source_file: 'a.yaml', recovered_locators: [rl], page_inventories: [pi] }),
  ]);
  assert.equal(report.recovered_locators[0].story_id, 'a');
  assert.equal(report.recovered_locators[0].source_file, 'a.yaml');
  assert.equal(report.page_inventories[0].story_id, 'a');
});

test('stories entries default missing fields to null and caveats to []', () => {
  const { report } = compose([{ id: 'a', status: 'SKIPPED' }]);
  assert.deepEqual(report.stories[0], {
    id: 'a', name: null, source_file: null, status: 'SKIPPED', steps_passed: null, steps_total: null,
    elapsed_seconds: null, error: null, caveats: [], trace: null, screenshot_dir: null,
  });
});

test('validation errors', () => {
  const c = (input) => composeQaReport(input, { now: NOW });
  assert.deepEqual(c(null), { error: 'input-not-object' });
  assert.deepEqual(c([]), { error: 'input-not-object' });
  assert.deepEqual(c({ stories: {} }), { error: 'stories-not-array' });
  assert.deepEqual(c({ stories: [null] }), { error: 'story-not-object: 0' });
  assert.deepEqual(c({ stories: [{ id: 's1', status: 'pass' }] }), { error: 'invalid-status: s1 pass' });
  assert.deepEqual(
    c({ stories: [{ id: 's1', status: 'PASS' }, { id: 's1', status: 'PASS' }] }),
    { error: 'duplicate-story-id: s1' },
  );
  assert.deepEqual(c({ stories: [{ id: '', status: 'PASS' }] }), { error: 'story-missing-id: 0' });
});

test('wrong-typed per-story lists are rejected instead of silently dropped', () => {
  const c = (extra) => composeQaReport({ stories: [{ id: 's1', status: 'PASS_WITH_CAVEATS', ...extra }] }, { now: NOW });
  assert.deepEqual(c({ caveats: 'slow load' }), { error: 'invalid-caveats: s1' });
  assert.deepEqual(c({ caveats: ['ok', ''] }), { error: 'invalid-caveats: s1' });
  assert.deepEqual(c({ caveats: [{ text: 'x' }] }), { error: 'invalid-caveats: s1' });
  assert.deepEqual(c({ recovered_locators: 'x' }), { error: 'invalid-recovered_locators: s1' });
  assert.deepEqual(c({ recovered_locators: ['x'] }), { error: 'invalid-recovered_locators: s1' });
  assert.deepEqual(c({ page_inventories: {} }), { error: 'invalid-page_inventories: s1' });
  assert.ok(c({ caveats: null, recovered_locators: [], page_inventories: [{ url: '/' }] }).report, 'null/empty/object lists stay valid');
});

test('timing and timestamp defaults', () => {
  const stories = [story('a', 'PASS'), story('b', 'PASS'), story('c', 'SKIPPED', { elapsed_seconds: 99 })];
  assert.deepEqual(compose(stories).report.timing, { wall_clock_seconds: 20, parallelism_factor: 1 });
  assert.equal(compose(stories).report.timestamp, NOW());
  const noClock = compose(stories, { wall_clock_seconds: undefined }).report.timing;
  assert.deepEqual(noClock, { wall_clock_seconds: null, parallelism_factor: null });
  assert.equal(compose(stories, { wall_clock_seconds: 0 }).report.timing.parallelism_factor, null);
  assert.equal(compose(stories, { wall_clock_seconds: -1 }).report.timing.wall_clock_seconds, null);
  assert.equal(compose(stories, { wall_clock_seconds: 7 }).report.timing.parallelism_factor, 2.9);
  assert.equal(compose(stories, { timestamp: '2026-01-01T00:00:00Z' }).report.timestamp, '2026-01-01T00:00:00Z');
});

test('filters default to null and pass through', () => {
  assert.deepEqual(compose([]).report.filters, {
    tag: null, priority: null, retry: null, journey: null,
  });
  assert.deepEqual(compose([], { filters: { tag: 'smoke' } }).report.filters, {
    tag: 'smoke', priority: null, retry: null, journey: null,
  });
});
