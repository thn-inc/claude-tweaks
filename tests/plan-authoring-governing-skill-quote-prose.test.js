'use strict';
// The governing-skill quote check: a plan quotes the project-skill rules that govern its files (#3763, after #3712).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const CHECKS = readText(path.join(__dirname, '..', 'plugin/skills/build/plan-authoring-checks.md'));
const LEAD = '**Governing-skill quote check:**';
const FACTS = [
  '`.claude/skills/`',
  'for each file the plan creates or modifies',
  'whose description or body names that file or its module',
  "quote their applicable rules (bullets, paragraphs, table rows) verbatim into the plan's Global Constraints",
  '(never a paraphrase)',
  'or say there why none apply',
  '#3712',
];

// The paragraph runs from its lead to the next blank line; it may be the file's
// last paragraph, so a missing terminator deliberately means "rest of file".
function paragraph(text) {
  const start = text.indexOf(LEAD);
  assert.ok(start >= 0, `missing lead: ${LEAD}`);
  assert.equal(text.indexOf(LEAD, start + 1), -1, `lead appears more than once: ${LEAD}`);
  const end = text.indexOf('\n\n', start);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

function missingFacts(text) {
  const p = paragraph(text);
  return FACTS.filter((fact) => !p.includes(fact));
}

test('AC1.1 (#3763): plan-authoring-checks.md carries the governing-skill quote check', () => {
  assert.deepEqual(missingFacts(CHECKS), []);
});

test('AC2.1 (#3763): the pin goes red when the check paragraph is removed', () => {
  const paragraphs = CHECKS.split(/\n\n/);
  const kept = paragraphs.filter((p) => !p.startsWith(LEAD));
  assert.equal(paragraphs.length - kept.length, 1, 'exactly one paragraph must carry the lead');
  const removed = kept.join('\n\n');
  assert.notEqual(removed, CHECKS);
  assert.throws(() => missingFacts(removed), { message: /missing lead/ });
});

test('AC2.1 (#3763): each fact goes red on its own when stripped', () => {
  const live = paragraph(CHECKS);
  for (const fact of FACTS) {
    const mutated = CHECKS.replace(live, () => live.replace(fact, ''));
    assert.notEqual(mutated, CHECKS, `fact not found to strip: ${fact}`);
    assert.deepEqual(missingFacts(mutated), [fact]);
  }
});
