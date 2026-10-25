// tests/bin-lib/flow/closing-links.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('../../helpers/read-skill');
const {
  findClosingRefs, neutralizeClosingPhrases, parseFixesSpan, prRepoFromUrl, sameRepoNumbers,
} = require('../../../plugin/bin/lib/flow/closing-links');

const REPO = { owner: 'thn-inc', repo: 'claude-tweaks' };
const fixture = readText(
  path.join(__dirname, '..', '..', 'fixtures', 'closing-links', 'pr-4144-body.md'),
);

test('findClosingRefs matches every probed form', () => {
  const cases = [
    ['closes #2724', 2724],
    ['Fixes: #5', 5],
    ['resolves thn-inc/claude-tweaks#4233', 4233],
    ['Fixed: https://github.com/thn-inc/claude-tweaks/issues/4233', 4233],
  ];
  for (const [text, number] of cases) {
    const refs = findClosingRefs(text, REPO);
    assert.equal(refs.length, 1, text);
    assert.equal(refs[0].number, number, text);
    assert.equal(refs[0].phrase, text, text);
    assert.equal(text.slice(refs[0].start, refs[0].end), text, text);
  }
});

test('each probed form neutralizes by inserting "issue " before the reference', () => {
  const cases = [
    ['closes #2724', 2724, 'closes issue #2724'],
    ['Fixes: #5', 5, 'Fixes: issue #5'],
    ['resolves thn-inc/claude-tweaks#4233', 4233, 'resolves issue thn-inc/claude-tweaks#4233'],
    ['Fixed: https://github.com/thn-inc/claude-tweaks/issues/4233', 4233,
      'Fixed: issue https://github.com/thn-inc/claude-tweaks/issues/4233'],
  ];
  for (const [text, number, expected] of cases) {
    const result = neutralizeClosingPhrases(text, { targets: [number], ...REPO });
    assert.equal(result.text, expected, text);
    assert.deepEqual(result.neutralized, [{ number, phrase: text }], text);
    assert.deepEqual(findClosingRefs(result.text, REPO), [], text);
    assert.equal('stillLive' in result, false);
  }
});

test('findClosingRefs ignores non-links', () => {
  assert.deepEqual(findClosingRefs('Refs #5', REPO), []);
  assert.deepEqual(findClosingRefs('Fixes\n#5', REPO), []);
});

test('findClosingRefs does no markdown masking: a phrase in code is reported (deliberate superset, the safe direction)', () => {
  assert.deepEqual(findClosingRefs('see `closes #5`', REPO).map((r) => r.number), [5]);
  assert.deepEqual(findClosingRefs('```\ncloses #5\n```', REPO).map((r) => r.number), [5]);
});

test('a phrase in a code span or fenced block is neutralized too (superset, the safe direction)', () => {
  assert.equal(neutralizeClosingPhrases('see `closes #5`', { targets: [5] }).text, 'see `closes issue #5`');
  assert.equal(
    neutralizeClosingPhrases('```\ncloses #5\n```', { targets: [5] }).text,
    '```\ncloses issue #5\n```',
  );
});

test('stray backticks cannot keep a phrase live', () => {
  for (const text of ['it is `x closes #5', 'a `b\nRefs #1 closes #5']) {
    const result = neutralizeClosingPhrases(text, { targets: [5] });
    assert.equal(result.text, text.replace('closes #5', 'closes issue #5'));
    assert.deepEqual(findClosingRefs(result.text), [], text);
  }
});

test('word boundary', () => {
  for (const text of ['prefixes #5', 'suffixed #5', 'unresolved #5', 'Fixes-ish #5']) {
    assert.deepEqual(findClosingRefs(text, REPO), [], text);
  }
});

test('cross-repo', () => {
  assert.deepEqual(findClosingRefs('closes other/repo#5', REPO), []);
  assert.deepEqual(findClosingRefs('closes https://github.com/other/repo/issues/5', REPO), []);
  assert.equal(findClosingRefs('closes other/repo#5').length, 1);
  assert.equal(findClosingRefs('closes THN-INC/Claude-Tweaks#5', REPO).length, 1);
});

test('no match when a word character follows the number', () => {
  assert.deepEqual(findClosingRefs('closes #5abc'), []);
  assert.deepEqual(findClosingRefs('closes #55x'), []);
  assert.equal(findClosingRefs('closes #5.').length, 1);
  assert.equal(findClosingRefs('closes #5, and more').length, 1);
});

test('neutralize the real #4144 body', () => {
  const result = neutralizeClosingPhrases(fixture, { targets: [2724], ...REPO });
  assert.equal(result.neutralized.length, 2);
  assert.deepEqual(result.neutralized.map((n) => n.phrase), ['closes #2724', 'closes #2724']);
  assert.deepEqual(findClosingRefs(result.text, REPO).map((r) => r.number), [3997]);
  assert.equal(result.text, fixture.split('closes #2724').join('closes issue #2724'));
});

test('neutralize leaves expected Fixes lines untouched', () => {
  const result = neutralizeClosingPhrases(fixture, { targets: [2724], ...REPO });
  assert.ok(result.text.split('\n').includes('Fixes #3997'));
  assert.equal(result.neutralized.some((n) => n.number === 3997), false);
});

test('neutralize is idempotent', () => {
  const once = neutralizeClosingPhrases(fixture, { targets: [2724], ...REPO });
  const twice = neutralizeClosingPhrases(once.text, { targets: [2724], ...REPO });
  assert.equal(twice.text, once.text);
  assert.deepEqual(twice.neutralized, []);
});

test('neutralize with targets null covers every phrase, with a number-keyed report', () => {
  const result = neutralizeClosingPhrases('Fixes #1 and closes #2', {});
  assert.equal(result.text, 'Fixes issue #1 and closes issue #2');
  assert.deepEqual(result.neutralized, [
    { number: 1, phrase: 'Fixes #1' }, { number: 2, phrase: 'closes #2' },
  ]);
});

test('neutralize honors owner/repo: another repo\'s reference is left alone', () => {
  const text = 'closes other/repo#5 and closes thn-inc/claude-tweaks#5';
  const result = neutralizeClosingPhrases(text, { targets: [5], ...REPO });
  assert.equal(result.text, 'closes other/repo#5 and closes issue thn-inc/claude-tweaks#5');
});

test('CRLF round-trips', () => {
  const body = 'Fixes #1\r\nRefs #2 — deferred: closes #2\r\n';
  const result = neutralizeClosingPhrases(body, { targets: [2] });
  assert.equal(result.text, 'Fixes #1\r\nRefs #2 — deferred: closes issue #2\r\n');
  assert.equal(result.text.split('\r\n').length, body.split('\r\n').length);
});

test('parseFixesSpan reads Fixes and Refs lines', () => {
  assert.deepEqual(parseFixesSpan(fixture), { found: true, fixes: [3997], refs: [2724] });
  assert.deepEqual(parseFixesSpan('no markers here\nFixes #1'), { found: false, fixes: [], refs: [] });
  const crlf = fixture.replace(/\n/g, '\r\n');
  assert.deepEqual(parseFixesSpan(crlf), { found: true, fixes: [3997], refs: [2724] });
});

test('parseFixesSpan reads the HTML-comment pair when the bracket pair is absent', () => {
  const body = 'x\n<!-- fixes-start -->\nFixes #7\nRefs #8 — not run/failed: not run\n<!-- fixes-end -->\n';
  assert.deepEqual(parseFixesSpan(body), { found: true, fixes: [7], refs: [8] });
  assert.deepEqual(parseFixesSpan('[claude-tweaks-fixes-start]\nFixes #7\n'), { found: false, fixes: [], refs: [] });
});

test('sameRepoNumbers filters by repository', () => {
  const refs = [
    { number: 2724, repository: { name: 'claude-tweaks', owner: { login: 'thn-inc' } } },
    { number: 7, repository: { name: 'x', owner: { login: 'y' } } },
    { number: 9 },
    { number: 2724, repository: { name: 'Claude-Tweaks', owner: { login: 'THN-INC' } } },
  ];
  assert.deepEqual(sameRepoNumbers(refs, REPO), [2724]);
});

test('sameRepoNumbers skips entries without a positive integer number', () => {
  const repository = { name: 'claude-tweaks', owner: { login: 'thn-inc' } };
  const refs = [
    { number: 0, repository }, { number: -3, repository }, { number: 1.5, repository },
    { number: '12', repository }, { repository }, { number: 8, repository },
  ];
  assert.deepEqual(sameRepoNumbers(refs, REPO), [8]);
});

test('prRepoFromUrl', () => {
  assert.deepEqual(prRepoFromUrl('https://github.com/thn-inc/claude-tweaks/pull/4144'),
    { host: 'github.com', owner: 'thn-inc', repo: 'claude-tweaks' });
  assert.equal(prRepoFromUrl('not a url'), null);
});

// The reader (parseFixesSpan) and the writer (pr-body.js composeFixesSpan) each hold the span
// markers as literals; a rename on one side alone would turn the guard into a silent
// no-fixes-span. Round-trip the real writer's output through the reader.
test('parseFixesSpan reads what composeFixesSpan writes', () => {
  const { composeFixesSpan } = require('../../../plugin/bin/lib/flow/pr-body');
  const { composeFixesBlock } = require('../../../plugin/bin/lib/flow/manifest');
  const lines = composeFixesBlock(
    [{ id: 3997, status: 'complete' }, { id: 2724, status: 'complete' }, { id: 5, status: 'failed', phase: 'build' }],
    new Map([['2724', 'the pass that closes #2724 is pending']]),
  );
  const parsed = parseFixesSpan(`intro\n\n${composeFixesSpan(lines)}\n\ntail`);
  assert.deepEqual(parsed, { found: true, fixes: [3997], refs: [2724, 5] });
});
