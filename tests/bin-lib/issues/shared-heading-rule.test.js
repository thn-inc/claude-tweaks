'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');

// AC1.1/AC1.2: no record-body reader keeps its own heading or fence regex; each requires the shared rule.
const OWN_RULE_RE = new RegExp([
  // a regex literal anchored on '#', after an optional leading-whitespace prefix (\s*, [ \t]*, ' {0,3}')
  String.raw`\/\^(?:(?:\\s|\\t|\[[^\]\n]*\]| )(?:[*+?]|\{\d*(?:,\d*)?\})?)*\(?(?:\?:)?\\?#`,
  String.raw`\/\^[^/\n]*(?:\x60{3}|~{3})`, // a '^'-anchored regex literal holding a literal fence run
  String.raw`\x60\{3|~\{3`, // a fence-run quantifier
].join('|'));
const ownRuleOffenders = (src) => src.split('\n').filter((l) => OWN_RULE_RE.test(l));
test('the matcher flags a planted heading regex and a planted fence regex (go-red control)', () => {
  for (const planted of [
    'const H = /^## Foo/;',
    'const F = /^[ \\t]*(`{3,}|~{3,})/;',
    'const F = /^```/;',
    'const F = /^[ \\t]*(```|~~~)/;',
    'const H = /^\\s*## /;',
    'const H = /^ {0,3}## /;',
    'const H = /^[ \\t]*#/;',
  ]) assert.equal(ownRuleOffenders(planted).length, 1, planted);
});
test('the matcher leaves non-heading regexes and prose fence mentions alone (false-positive control)', () => {
  for (const clean of [
    "const lines = body.split(/\\r\\n/g);",
    'const n = /^\\d+$/;',
    'if (/[:#]/.test(v) || /^\\s|\\s$/.test(v)) {}',
    'const sep = /^\\|[\\s:|-]+\\|$/;',
    '// marker word. Removes, in order: fenced blocks (``` or ~~~, any info',
  ]) assert.deepEqual(ownRuleOffenders(clean), [], clean);
});
const REQUIRES_SHARED_RULE_RE = /require\('(?:\.\/|\.\.\/issues\/)record-payload'\)/;
for (const rel of ['release-note-repair/apply.js', 'issues/near-duplicate.js', 'compose-record/compose.js', 'issues/materialize-format.js', 'issues/ambiguity-resolve.js']) {
  test(`AC1.1 AC1.2: ${rel} keeps no heading/fence regex and requires record-payload's shared rule (#4561)`, () => {
    const src = readText(path.join(__dirname, '../../../plugin/bin/lib', rel));
    assert.deepEqual(ownRuleOffenders(src), []);
    assert.match(src, REQUIRES_SHARED_RULE_RE);
  });
}
