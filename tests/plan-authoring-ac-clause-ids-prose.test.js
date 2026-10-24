// tests/plan-authoring-ac-clause-ids-prose.test.js — pins #3099's
// plan-authoring rule: plugin/skills/build/plan-authoring-checks.md tells
// plan authors to cite AC{item}.{clause} ids so plan-audit.js Check E matches
// coverage by id. Reads the live skill file (prose we just wrote — the
// skill-prose-conformance-tests live-vs-fixture distinction). The paragraph
// is located by its bold label, then every assertion runs on that paragraph
// alone, so a token elsewhere in the file can never satisfy it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const TEXT = readText(path.join(__dirname, '..', 'plugin', 'skills', 'build', 'plan-authoring-checks.md'));

function paragraph() {
  const hits = TEXT.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**Acceptance-criterion clause-id check:**'));
  assert.strictEqual(hits.length, 1, 'expected exactly one Acceptance-criterion clause-id check paragraph');
  return hits[0];
}

test('AC7.1 (#3099): plan-authoring-checks.md tells plan authors to cite AC{item}.{clause} ids in the test step', () => {
  const p = paragraph();
  assert.match(p, /cite every clause of the spec's `## Acceptance Criteria` by its id, `AC\{item\}\.\{clause\}`, in the test step/);
  assert.match(p, /`plan-audit\.js \{plan\} --spec \{spec\}`/);
  assert.match(p, /`Waived AC\{item\}\.\{clause\}: \{reason\}`/);
  assert.match(p, /\(`AC2`\) covers none of its clauses/);
});
