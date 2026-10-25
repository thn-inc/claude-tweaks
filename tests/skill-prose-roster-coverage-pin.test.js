'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');

// #4185: the skill-prose-conformance-tests Decision Framework row and Reference bullet that
// document the roster-coverage pin pattern (forward sweep plus reverse staleness check).
const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, '.claude', 'skills', 'skill-prose-conformance-tests', 'SKILL.md');
const TIMING = 'tests/timing-nested-parent-roster.test.js';
const CEREMONY = 'tests/ceremony-profile-roster.test.js';
const NONSENSE = 'tests/zzz-no-such-roster-4185.test.js'; // a hit on this token being real means re-pick the control

const text = readText(SKILL);

function decisionFrameworkSection(t) {
  const start = t.indexOf('\n## Decision Framework');
  const end = t.indexOf('\n## Project Conventions');
  assert.notStrictEqual(start, -1, 'SKILL.md lacks "## Decision Framework"');
  assert.notStrictEqual(end, -1, 'SKILL.md lacks "## Project Conventions"');
  return t.slice(start, end);
}

function referenceSection(t) {
  const start = t.indexOf('\n## Reference\n');
  assert.notStrictEqual(start, -1, 'SKILL.md lacks "## Reference"');
  return t.slice(start);
}

function liveRow(t) {
  const hits = decisionFrameworkSection(t).split('\n').filter((l) => l.startsWith('| ') && l.includes(`\`${TIMING}\``));
  assert.strictEqual(hits.length, 1, `expected exactly one Decision Framework row citing ${TIMING}, found ${hits.length}`);
  return hits[0];
}

// Each fact is the literal the row must carry; the fact name is the literal itself.
const ROW_FACTS = ['forward sweep', 'reverse staleness check', `\`${TIMING}\``, `\`${CEREMONY}\``];
const REF_FACTS = [`\`${TIMING}\``, `\`${CEREMONY}\``];

function missingFacts(rowText) {
  return ROW_FACTS.filter((f) => !rowText.includes(f));
}

function missingRefFacts(refText) {
  return REF_FACTS.filter((f) => !refText.includes(f));
}

function citedPaths(t) {
  return t.match(/tests\/[A-Za-z0-9._/-]+\.test\.js/g) ?? [];
}

function missingPaths(t) {
  return citedPaths(t).filter((p) => !fs.existsSync(path.join(ROOT, p)));
}

test('the Decision Framework row names the pattern and cites both roster test paths (#4185)', () => {
  assert.deepStrictEqual(missingFacts(liveRow(text)), []);
});

test('the Reference section cites both roster test paths (#4185)', () => {
  assert.deepStrictEqual(missingRefFacts(referenceSection(text)), []);
});

test('every tests/*.test.js path cited in the row and the Reference section exists on disk (#4185)', () => {
  const row = liveRow(text);
  const ref = referenceSection(text);
  assert.ok(citedPaths(row).length >= 2, 'row cites fewer than two test paths');
  assert.ok(citedPaths(ref).length >= 2, 'Reference section cites fewer than two test paths');
  assert.deepStrictEqual(missingPaths(row), []);
  assert.deepStrictEqual(missingPaths(ref), []);
});

test('go-red: stripping each row fact returns exactly that fact (doctored-text proof, #4185)', () => {
  const row = liveRow(text);
  for (const fact of ROW_FACTS) {
    // split/join, not a single replace: "forward sweep" occurs twice in the row.
    const doctored = row.split(fact).join('removed');
    assert.notStrictEqual(doctored, row, `doctoring found no text for ${fact}`);
    assert.deepStrictEqual(missingFacts(doctored), [fact]);
  }
});

test('go-red: stripping each Reference citation returns exactly that citation (doctored-text proof, #4185)', () => {
  const ref = referenceSection(text);
  for (const fact of REF_FACTS) {
    const doctored = ref.split(fact).join('removed');
    assert.notStrictEqual(doctored, ref, `doctoring found no text for ${fact}`);
    assert.deepStrictEqual(missingRefFacts(doctored), [fact]);
  }
});

test('go-red: swapping a cited path for a nonsense token makes the existence check report exactly that token (#4185)', () => {
  const row = liveRow(text);
  const doctored = row.split(`\`${CEREMONY}\``).join(`\`${NONSENSE}\``);
  assert.notStrictEqual(doctored, row, `doctoring found no ${CEREMONY} citation`);
  assert.deepStrictEqual(missingPaths(doctored), [NONSENSE]);
});
