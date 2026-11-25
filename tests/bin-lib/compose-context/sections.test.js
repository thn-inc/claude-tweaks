'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectSections, SectionError } = require('../../../plugin/bin/lib/compose-context/sections');
const { compose, MarkerError, KEYS, UNRESOLVED } = require('../../../plugin/bin/lib/compose-context/compose');

const LEAD = 'x\n\n**Rule.** one\ntwo\n\n**Other.** z\n';

test('heading selector takes the section up to the next same-or-higher heading', () => {
  const content = '# T\n## A\na1\n### A.1\na2\n## B\nb1\n';
  assert.equal(selectSections(content, ['## A'], 'f.md'), '## A\na1\n### A.1\na2\n');
});

test('lead selector takes one paragraph', () => {
  assert.equal(selectSections(LEAD, ['**Rule.**'], 'f.md'), '**Rule.** one\ntwo\n');
});

test('slices join in selector order with one blank line', () => {
  assert.equal(selectSections(LEAD, ['**Other.**', '**Rule.**'], 'f.md'), '**Other.** z\n\n**Rule.** one\ntwo\n');
});

test('a heading inside a code fence neither matches nor ends a section', () => {
  const content = '## A\n```\n## B\n```\nafter\n## C\n';
  assert.equal(selectSections(content, ['## A'], 'f.md'), '## A\n```\n## B\n```\nafter\n');
  assert.throws(() => selectSections(content, ['## B'], 'f.md'), (err) => err instanceof SectionError && /not found/.test(err.message));
});

test('a selector matching twice throws', () => {
  assert.throws(
    () => selectSections('**R.** a\n\n**R.** b\n', ['**R.**'], 'f.md'),
    (err) => err instanceof SectionError && /matches 2 lines/.test(err.message) && err.file === 'f.md' && err.selector === '**R.**',
  );
});

test('a missing selector throws naming file and selector', () => {
  assert.throws(
    () => selectSections(LEAD, ['**Gone.**'], 'f.md'),
    (err) => err.name === 'SectionError' && err.message === 'section selector "**Gone.**" not found' && err.file === 'f.md',
  );
});

test('an unknown selector shape throws', () => {
  assert.throws(() => selectSections(LEAD, ['Rule'], 'f.md'), (err) => err instanceof SectionError && /unknown selector shape/.test(err.message));
});

test('CRLF content selects the same section', () => {
  const lf = '# T\n## A\na1\n### A.1\na2\n## B\nb1\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(selectSections(crlf.replace(/\r\n/g, '\n'), ['## A'], 'f.md'), '## A\na1\n### A.1\na2\n');
  assert.ok(selectSections('## A\r\nb\n', ['## A'], 'f.md').startsWith('## A'));
});

test('a blank line inside a fence does not end a lead slice', () => {
  const content = '**R.** a\n```\nx\n\ny\n```\nz\n\n**O.** q\n';
  assert.equal(selectSections(content, ['**R.**'], 'f.md'), '**R.** a\n```\nx\n\ny\n```\nz\n');
});

test('an empty selector list throws', () => {
  assert.throws(() => selectSections(LEAD, [], 'f.md'), (err) => err instanceof SectionError && /no section selectors/.test(err.message));
});

test('a slice that opens a when-block without its close is a MarkerError at compose', () => {
  const slice = selectSections('**R.** a\n<!-- when: mode=auto -->\nb\n\n<!-- /when -->\n', ['**R.**'], 'f.md');
  const allUnresolved = Object.fromEntries(KEYS.map((k) => [k, UNRESOLVED]));
  assert.throws(() => compose([{ path: 'x', content: slice }], allUnresolved), (err) => err instanceof MarkerError && /unclosed/.test(err.message));
});
