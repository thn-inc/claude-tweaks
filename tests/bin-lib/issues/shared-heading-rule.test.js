'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');

// AC1.1/AC1.2: no record-body reader keeps its own heading or fence regex; each requires the shared rule.
const OWN_RULE_RE = /\/\^\(?\\?#|`\{3|~\{3/; // a regex literal anchored on '#', or a fence-run quantifier
const ownRuleOffenders = (src) => src.split('\n').filter((l) => OWN_RULE_RE.test(l));
test('the matcher flags a planted heading regex and a planted fence regex (go-red control)', () => {
  assert.equal(ownRuleOffenders('const H = /^## Foo/;').length, 1);
  assert.equal(ownRuleOffenders('const F = /^[ \\t]*(`{3,}|~{3,})/;').length, 1);
});
for (const rel of ['release-note-repair/apply.js', 'issues/near-duplicate.js', 'compose-record/compose.js', 'issues/materialize-format.js', 'issues/ambiguity-resolve.js']) {
  test(`AC1.1 AC1.2: ${rel} keeps no heading/fence regex and requires record-payload's shared rule (#4561)`, () => {
    const src = readText(path.join(__dirname, '../../../plugin/bin/lib', rel));
    assert.deepEqual(ownRuleOffenders(src), []);
    assert.match(src, /headingLine|findHeadingLine|findSection|authoredRegion|sectionText/);
  });
}
