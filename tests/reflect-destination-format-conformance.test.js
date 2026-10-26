'use strict';
// tests/reflect-destination-format-conformance.test.js — /reflect's stage-file format names the
// `**Destination:**` line the Review Console classifies into Skill updates and bin/reflect-apply.js
// applies (#4168). Reads live prose because reflect/SKILL.md IS the declared contract of what
// reflect writes (skill-prose-conformance-tests, "read live prose only when the prose is the
// declared contract"); the verbs, the section heading and the legacy token are imported from the
// parser that reads them, so the prose cannot drift from the grammar. The go-red control mutates
// the live text in memory and expects exactly the removed fact back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const {
  DESTINATION_VERBS, RECORD_PROPOSAL_HEADING, REFLECT_NO_DESTINATION,
} = require('../plugin/bin/lib/console/reflect-destination');

const REFLECT = readText(path.join(__dirname, '..', 'plugin/skills/reflect/SKILL.md'));

// The stage-file format block: the first markdown fence after the "**Stage-file format**" lead.
function formatBlock(text) {
  const lead = text.indexOf('**Stage-file format**');
  assert.notEqual(lead, -1, 'the Stage-file format lead must be present');
  const open = text.indexOf('```markdown\n', lead);
  assert.notEqual(open, -1, 'the format block fence must open');
  const close = text.indexOf('\n```', open + 1);
  assert.notEqual(close, -1, 'the format block fence must close');
  return text.slice(open, close);
}

// Every fact the parser's grammar needs the prose to state, as the verb/heading/token it is.
function missingDestinationForms(text) {
  const line = formatBlock(text).split('\n').find((l) => l.startsWith('**Destination:**')) || '';
  const missing = DESTINATION_VERBS.filter((verb) => !new RegExp(`\\b${verb}\\b`).test(line));
  if (!text.includes(RECORD_PROPOSAL_HEADING)) missing.push(RECORD_PROPOSAL_HEADING);
  if (!text.includes(REFLECT_NO_DESTINATION)) missing.push(REFLECT_NO_DESTINATION);
  return missing;
}

test('reflect/SKILL.md names every destination verb the parser accepts', () => {
  assert.deepEqual(DESTINATION_VERBS, ['edit', 'record', 'decline'], 'the verb list this pin was written against');
  assert.deepEqual(missingDestinationForms(REFLECT), []);
});

test('a copy with the decline form removed is reported', () => {
  const mutated = REFLECT.replace('decline {reason}', '');
  assert.notEqual(mutated, REFLECT, 'the mutation must change the text');
  assert.deepEqual(missingDestinationForms(mutated), ['decline']);
});

test('a copy with the edit form removed is reported', () => {
  const mutated = REFLECT.replace('edit {repo-relative path}', '');
  assert.notEqual(mutated, REFLECT, 'the mutation must change the text');
  assert.deepEqual(missingDestinationForms(mutated), ['edit']);
});

test('a copy with the record form removed from the format block is reported', () => {
  const mutated = REFLECT.replace('| record |', '|');
  assert.notEqual(mutated, REFLECT, 'the mutation must change the text');
  assert.deepEqual(missingDestinationForms(mutated), ['record']);
});

test('a copy without the Record proposal heading or the legacy token is reported', () => {
  const noHeading = REFLECT.split(RECORD_PROPOSAL_HEADING).join('');
  assert.notEqual(noHeading, REFLECT);
  assert.deepEqual(missingDestinationForms(noHeading), [RECORD_PROPOSAL_HEADING]);
  const noToken = REFLECT.split(REFLECT_NO_DESTINATION).join('');
  assert.notEqual(noToken, REFLECT);
  assert.deepEqual(missingDestinationForms(noToken), [REFLECT_NO_DESTINATION]);
});

test('the format block carries the Destination line after Category, with Category unchanged', () => {
  const block = formatBlock(REFLECT);
  const category = block.indexOf('**Category:** {convention | tangential | observation}');
  const destination = block.indexOf('**Destination:** {edit {repo-relative path} | record | decline {reason}}');
  assert.notEqual(category, -1, 'the Category line is unchanged');
  assert.notEqual(destination, -1, 'the Destination line is present');
  assert.ok(destination > category, 'the Destination line follows Category');
});

test('the Destination paragraph warns that a line-start Destination marker may appear only once', () => {
  const lead = '**Destination (observation/convention only).**';
  assert.equal(REFLECT.split(lead).length - 1, 1, 'the paragraph lead appears exactly once');
  const start = REFLECT.indexOf(lead);
  const end = REFLECT.indexOf('\n\n', start);
  assert.notEqual(end, -1);
  const p = REFLECT.slice(start, end).replace(/\s+/g, ' ');
  assert.match(p, /exactly one `\*\*Destination:\*\*` line/);
  assert.match(p, /never start a line with `\*\*Destination:\*\*`/);
  assert.match(p, /`bin\/reflect-apply\.js`/);
  assert.match(p, /`wrap-up\/refused-proposals\.md`/);
  assert.match(p, /malformed line stays in Pending review/);
});

test('the old Skills-curation-row routing claim is gone', () => {
  assert.doesNotMatch(REFLECT, /Most go to skill updates handled by/);
  assert.doesNotMatch(REFLECT.replace(/\s+/g, ' '), /Most go to skill updates handled by/);
});
