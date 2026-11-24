'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { MARKER_SIZE, resolveDiff3 } = require('../../../plugin/bin/lib/learned-skills/rebuild.js');

const run = (ch) => ch.repeat(MARKER_SIZE);
function block(ours, base, theirs) {
  const lines = [`${run('<')} ours`, ...ours, `${run('|')} base`, ...base, run('='), ...theirs, `${run('>')} theirs`];
  return lines.join('\n') + '\n';
}
const ok = (text) => ({ ok: true, text });
const REFUSED = { ok: false };

test('double append keeps both, integration first', () => {
  const input = '- one\n' + block(['- a'], [], ['- b']) + '\nend\n';
  assert.deepStrictEqual(resolveDiff3(input), ok('- one\n- a\n- b\n\nend\n'));
});

test('a PR line already among the integration lines is dropped', () => {
  assert.deepStrictEqual(resolveDiff3(block(['- a', '- b'], [], ['- b', '- c'])), ok('- a\n- b\n- c\n'));
});

test('AC2.1: both append 7. to a list ends 7. and 8.', () => {
  assert.deepStrictEqual(resolveDiff3('6. f\n' + block(['7. x'], [], ['7. y'])), ok('6. f\n7. x\n8. y\n'));
});

test('numbering that stops increasing by one is renumbered', () => {
  const input = '1. a\n' + block(['2. b'], [], ['5. c']) + '\ntext\n';
  assert.deepStrictEqual(resolveDiff3(input), ok('1. a\n2. b\n3. c\n\ntext\n'));
});

test('a mid-list collision refuses', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['2. b'], [], ['2. c']) + '3. d\n'), REFUSED);
});

test('a mid-list hunk refuses even without a collision', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['- x', '2. b'], [], ['- y']) + '3. c\n'), REFUSED);
  assert.deepStrictEqual(
    resolveDiff3('1. a\n' + block(['- x'], [], ['- y']) + '2. b\n'),
    ok('1. a\n- x\n- y\n2. b\n'),
  );
});

test('a consecutive list is left as it is', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['2. b'], [], ['- c'])), ok('1. a\n2. b\n- c\n'));
});

test('a non-empty base refuses (a changed line)', () => {
  assert.deepStrictEqual(resolveDiff3(block(['x2'], ['x'], ['x3'])), REFUSED);
});

test('an empty side refuses', () => {
  assert.deepStrictEqual(resolveDiff3(block([], [], ['y'])), REFUSED);
  assert.deepStrictEqual(resolveDiff3(block(['y'], [], [])), REFUSED);
});

test('an unterminated block refuses', () => {
  assert.deepStrictEqual(resolveDiff3(`${run('<')} ours\na\n${run('|')} base\n${run('=')}\nb\n`), REFUSED);
});

test('CRLF lines resolve like LF', () => {
  const lf = '- one\n' + block(['- a'], [], ['- b']) + '\nend\n';
  assert.deepStrictEqual(resolveDiff3(lf.replace(/\n/g, '\r\n')), ok('- one\n- a\n- b\n\nend\n'.replace(/\n/g, '\r\n')));
});

test('CRLF renumber and dedupe resolve like LF', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(
    resolveDiff3(crlf('6. f\n' + block(['7. x'], [], ['7. y']))),
    ok(crlf('6. f\n7. x\n8. y\n')),
  );
  assert.deepStrictEqual(
    resolveDiff3(crlf(block(['- a', '- b'], [], ['- b', '- c']))),
    ok(crlf('- a\n- b\n- c\n')),
  );
});

test('a two-digit renumber and an indented list renumber', () => {
  assert.deepStrictEqual(resolveDiff3('9. a\n' + block(['10. x'], [], ['10. y'])), ok('9. a\n10. x\n11. y\n'));
  assert.deepStrictEqual(
    resolveDiff3('  1. a\n' + block(['  2. b'], [], ['  2. c'])),
    ok('  1. a\n  2. b\n  3. c\n'),
  );
});

test('a blank line the PR adds is dropped when the integration side also added one', () => {
  assert.deepStrictEqual(resolveDiff3(block(['- a', ''], [], ['', '- c'])), ok('- a\n\n- c\n'));
});

test('a body line shaped like a short marker passes through', () => {
  assert.deepStrictEqual(resolveDiff3('<<<<<<< x\n' + block(['a'], [], ['b'])), ok('<<<<<<< x\na\nb\n'));
});

test('no conflict block returns the text unchanged', () => {
  assert.deepStrictEqual(resolveDiff3('a\n1. b\n'), ok('a\n1. b\n'));
});
