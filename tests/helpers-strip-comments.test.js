'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripComments, stripperVerdict } = require('./helpers/strip-comments');

function newlineIndices(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') out.push(i);
  return out;
}

test('blanks comments to spaces and keeps every offset and newline', () => {
  const input = "a(); // x\n/* y\nz */ b();";
  const out = stripComments(input);
  assert.equal(out.length, input.length);
  assert.deepEqual(newlineIndices(out), newlineIndices(input));
  assert.ok(out.includes('a();'));
  assert.ok(out.includes('b();'));
  assert.ok(!out.includes('x'));
  assert.ok(!out.includes('y'));
  assert.ok(!out.includes('z'));
});

test('a /* or // inside a string, template or line comment opens no comment', () => {
  const input = [
    "const g = '/*';",
    'live1();',
    '// see work/*-spec.md',
    'live2();',
    'const t = `${d}//x/*`;',
    'live3();',
    '/* end */',
  ].join('\n');
  const out = stripComments(input);
  assert.ok(out.includes('live1();'));
  assert.ok(out.includes('live2();'));
  assert.ok(out.includes('live3();'));
});

test('an escaped quote does not end the string', () => {
  const out = stripComments("const s = 'it\\'s /* no'; live(); /* x */");
  assert.ok(out.includes('live();'));
  assert.ok(out.includes('/* no'));
});

test('a multi-line template keeps its // and /*; a quoted string does not cross a newline', () => {
  const template = 'const t = `a\n// b\n/* c`; live();';
  assert.equal(stripComments(template), template);

  const unterminated = "const s = 'x\n// gone";
  const out = stripComments(unterminated);
  assert.equal(out.length, unterminated.length);
  assert.ok(!out.includes('// gone'));
});

test('a regex ending in an escaped slash is not a // comment', () => {
  const out = stripComments("r.replace(/^origin\\//, ''); live();");
  assert.ok(out.includes('live();'));
});

test('a quote inside a regex with no later literal on the line blanks no code', () => {
  const out = stripComments("/'/.test(s); live(); // note");
  assert.ok(out.includes('live();'));
});

test('stripperVerdict reads real comments, a hashbang and a top-level return as ok', () => {
  assert.equal(stripperVerdict("// a /* b\nconst s = 'x // y'; /* multi\n line */ live();"), 'ok');
  assert.equal(stripperVerdict('#!/usr/bin/env node\n// x\nlive();'), 'ok');
  assert.equal(stripperVerdict('if (x) return 1;\nlive();'), 'ok');
});

test('stripperVerdict reports each reproducing mis-parse shape as misparsed', () => {
  assert.equal(stripperVerdict("const x = 'a'; const a = /'/.test(x); const b = 'p//q'; fs.realpathSync(b);"), 'misparsed');
  assert.equal(stripperVerdict('const a = /"/; const b = "//"; live();'), 'misparsed');
  assert.equal(stripperVerdict('const a = /`/; const b = `x // y`; live();'), 'misparsed');
  assert.equal(stripperVerdict('const re = /[/*]/; live(); /* c */'), 'misparsed');
  // A lazily compiled body: the mis-parse sits inside a function.
  assert.equal(
    stripperVerdict('function outer() { function inner() { const re = /[/*]/; live(); } return inner; } /* c */'),
    'misparsed',
  );
});

test('stripperVerdict reports raw text that does not compile as unparseable', () => {
  assert.equal(stripperVerdict('const a = ;'), 'unparseable');
});

test('stripperVerdict judges a supplied stripped text', () => {
  assert.equal(stripperVerdict('live();', 'live('), 'misparsed');
});
