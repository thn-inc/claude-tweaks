// tests/bin-lib/flow/closing-links.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  findClosingRefs, neutralizeClosingPhrases, parseFixesSpan, prRepoFromUrl, sameRepoNumbers,
} = require('../../../plugin/bin/lib/flow/closing-links');

const REPO = { owner: 'thn-inc', repo: 'claude-tweaks' };
const fixture = fs.readFileSync(
  path.join(__dirname, '..', '..', 'fixtures', 'closing-links', 'pr-4144-body.md'), 'utf8',
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

test('findClosingRefs ignores non-links', () => {
  assert.deepEqual(findClosingRefs('Refs #5', REPO), []);
  assert.deepEqual(findClosingRefs('see `closes #5`', REPO), []);
  assert.deepEqual(findClosingRefs('```\ncloses #5\n```', REPO), []);
  assert.deepEqual(findClosingRefs('Fixes\n#5', REPO), []);
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

test('neutralize the real #4144 body', () => {
  const result = neutralizeClosingPhrases(fixture, { targets: [2724], ...REPO });
  assert.equal(result.neutralized.length, 2);
  assert.deepEqual(result.neutralized.map((n) => n.phrase), ['closes #2724', 'closes #2724']);
  assert.deepEqual(findClosingRefs(result.text, REPO).map((r) => r.number), [3997]);
  assert.deepEqual(result.stillLive, []);
  // The Spec-summary paragraph already holds single backticks, so its wrapper is
  // a double-backtick run; the fixes-span line has none, so it gets a single.
  const parts = fixture.split('closes #2724');
  assert.equal(parts.length, 3);
  assert.equal(result.text, parts[0] + '``closes #2724``' + parts[1] + '`closes #2724`' + parts[2]);
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

test('neutralize with targets null wraps every phrase, with a number-keyed report', () => {
  const result = neutralizeClosingPhrases('Fixes #1 and closes #2', {});
  assert.equal(result.text, '`Fixes #1` and `closes #2`');
  assert.deepEqual(result.neutralized, [
    { number: 1, phrase: 'Fixes #1' }, { number: 2, phrase: 'closes #2' },
  ]);
});

test('CRLF round-trips', () => {
  const body = 'Fixes #1\r\nRefs #2 — deferred: closes #2\r\n';
  const result = neutralizeClosingPhrases(body, { targets: [2] });
  assert.equal(result.text, 'Fixes #1\r\nRefs #2 — deferred: `closes #2`\r\n');
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

test('prRepoFromUrl', () => {
  assert.deepEqual(prRepoFromUrl('https://github.com/thn-inc/claude-tweaks/pull/4144'),
    { host: 'github.com', owner: 'thn-inc', repo: 'claude-tweaks' });
  assert.equal(prRepoFromUrl('not a url'), null);
});

// --- Fix round 1: paragraph-scoped code spans, CommonMark fences, minors ---

function assertNeutralized(text, number) {
  const result = neutralizeClosingPhrases(text, { targets: [number] });
  assert.deepEqual(findClosingRefs(result.text).filter((r) => r.number === number), [], result.text);
  assert.deepEqual(result.stillLive, [], result.text);
  assert.deepEqual(neutralizeClosingPhrases(result.text, { targets: [number] }).neutralized, [], 'idempotent');
  return result;
}

test('stray backtick before the phrase: wrapper must not pair with it', () => {
  const text = 'it is `x closes #5';
  assert.equal(findClosingRefs(text).length, 1);
  const result = assertNeutralized(text, 5);
  assert.equal(result.text, 'it is `x ``closes #5``');
});

test('stray backtick on an earlier line of the paragraph', () => {
  const text = 'a `b\nRefs #1 closes #5';
  assert.deepEqual(findClosingRefs(text).map((r) => r.number), [5]);
  const result = assertNeutralized(text, 5);
  assert.equal(result.text, 'a `b\nRefs #1 ``closes #5``');
});

test('a code span pairs across lines within one paragraph', () => {
  assert.deepEqual(findClosingRefs('see `a\ncloses #5` end'), []);
  assert.deepEqual(findClosingRefs('see `a\n\ncloses #5` end').map((r) => r.number), [5]);
});

test('wrapper length skips every run length present in the paragraph', () => {
  const result = assertNeutralized('`a` ``b`` x`y closes #5', 5);
  assert.equal(result.text, '`a` ``b`` x`y ```closes #5```');
});

test('a backtick adjacent to the phrase does not merge into the wrapper', () => {
  assertNeutralized('x`closes #5', 5);
  assertNeutralized('`a`closes #5`', 5);
});

test('stillLive is empty after a successful wrap and ignores non-targets', () => {
  assert.deepEqual(neutralizeClosingPhrases('closes #5', { targets: [5] }).stillLive, []);
  assert.deepEqual(neutralizeClosingPhrases('closes #5 closes #6', { targets: [5] }).stillLive, []);
});

test('an inline triple-backtick span is not a fence', () => {
  assert.deepEqual(findClosingRefs('```a``` ok\ncloses #5').map((r) => r.number), [5]);
  assert.deepEqual(findClosingRefs('x ```closes #5``` y'), []);
});

test('a 4-space-indented fence marker is not a fence', () => {
  assert.deepEqual(findClosingRefs('    ```\ncloses #5').map((r) => r.number), [5]);
  assert.deepEqual(findClosingRefs('   ```\ncloses #5\n   ```'), []);
});

test('a tilde fence masks, and a tilde line does not close a backtick fence', () => {
  assert.deepEqual(findClosingRefs('~~~\ncloses #5\n~~~\ncloses #6').map((r) => r.number), [6]);
  assert.deepEqual(findClosingRefs('```\ncloses #5\n~~~\ncloses #6\n```\ncloses #7').map((r) => r.number), [7]);
});

test('a shorter closer does not close a fence; a longer one does', () => {
  assert.deepEqual(findClosingRefs('````\ncloses #5\n```\ncloses #6\n````\ncloses #7').map((r) => r.number), [7]);
  assert.deepEqual(findClosingRefs('```\ncloses #5\n`````\ncloses #6').map((r) => r.number), [6]);
});

test('a closer with trailing text does not close the fence', () => {
  assert.deepEqual(findClosingRefs('```\ncloses #5\n``` x\ncloses #6\n```\ncloses #7').map((r) => r.number), [7]);
});

test('an unclosed fence masks to the end of the text', () => {
  assert.deepEqual(findClosingRefs('```\ncloses #5\ncloses #6'), []);
});

test('a tilde fence info string may contain a backtick', () => {
  assert.deepEqual(findClosingRefs('~~~ a`b\ncloses #5\n~~~'), []);
});

test('CRLF fences mask the same as LF', () => {
  assert.deepEqual(findClosingRefs('```\r\ncloses #5\r\n```\r\ncloses #6\r\n').map((r) => r.number), [6]);
});

test('no match when a word character follows the number', () => {
  assert.deepEqual(findClosingRefs('closes #5abc'), []);
  assert.deepEqual(findClosingRefs('closes #55x'), []);
  assert.equal(findClosingRefs('closes #5.').length, 1);
  assert.equal(findClosingRefs('closes #5, and more').length, 1);
});

test('Fixes-ish is not a keyword phrase', () => {
  assert.deepEqual(findClosingRefs('Fixes-ish #5'), []);
});

test('sameRepoNumbers skips entries without a positive integer number', () => {
  const repository = { name: 'claude-tweaks', owner: { login: 'thn-inc' } };
  const refs = [
    { number: 0, repository }, { number: -3, repository }, { number: 1.5, repository },
    { number: '12', repository }, { repository }, { number: 8, repository },
  ];
  assert.deepEqual(sameRepoNumbers(refs, REPO), [8]);
});
