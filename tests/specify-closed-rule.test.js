'use strict';
// A state-classifying deliverable carries a Closed rule so plan review amends the
// plan for an unlisted state instead of escalating it as a needs-human gap (#4588).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const TEMPLATE = readText(path.join(__dirname, '..', 'plugin/skills/specify/spec-template.md'));

function closedRuleSection(text) {
  const start = text.indexOf('## State-Classification Deliverables\n');
  assert.ok(start >= 0, 'spec-template.md must have ## State-Classification Deliverables');
  const end = text.indexOf('\n## ', start);
  assert.ok(end > start, 'the State-Classification Deliverables section must end at the next ## heading');
  return text.slice(start, end);
}

test('the state-classification section names the deliverable shapes it applies to', () => {
  const section = closedRuleSection(TEMPLATE);
  assert.match(section, /an eligibility verdict/);
  assert.match(section, /a refusal ladder/);
  assert.match(section, /a status classifier/);
});

test('the state-classification section requires a Closed rule bullet beside the state list', () => {
  assert.match(closedRuleSection(TEMPLATE), /\*\*Closed rule\*\* bullet/);
});

test('the Closed rule makes the listed states exhaustive', () => {
  assert.match(closedRuleSection(TEMPLATE), /exhaustive/i);
});

test('the Closed rule refuses an unlisted state with a line naming its remedy', () => {
  assert.match(closedRuleSection(TEMPLATE), /refused with one line naming the state and its remedy/);
});

test('plan review applies the Closed rule as an amendment, never as a needs-human gap', () => {
  const section = closedRuleSection(TEMPLATE);
  assert.match(section, /amendment/);
  assert.match(section, /needs-human/);
});

test('the Closed rule cites the #4588 incident', () => {
  assert.match(closedRuleSection(TEMPLATE), /#4588/);
});

test('go-red: the suite fails when the State-Classification section is removed', () => {
  const section = closedRuleSection(TEMPLATE);
  const withoutSection = TEMPLATE.replace(section, '');
  assert.throws(() => closedRuleSection(withoutSection));
});

// Each Closed-rule part is pinned by its own bullet: removing only that bullet's
// line must defeat that part's pattern.
const PARTS = [
  { bullet: '- **Exhaustive** — ', pattern: /exhaustive/i },
  { bullet: '- **Refused with a named remedy** — ', pattern: /refused with one line naming the state and its remedy/ },
  { bullet: '- **Amendment, not escalation** — ', pattern: /amendment/ },
];

test('go-red: each Closed-rule part is pinned by its own bullet line', () => {
  const section = closedRuleSection(TEMPLATE);
  const lines = section.split('\n');
  for (const { bullet, pattern } of PARTS) {
    assert.equal(lines.filter((line) => line.startsWith(bullet)).length, 1, `exactly one line starts with ${bullet}`);
    const withoutBullet = lines.filter((line) => !line.startsWith(bullet)).join('\n');
    assert.match(section, pattern);
    assert.doesNotMatch(withoutBullet, pattern, `removing ${bullet} must defeat ${pattern}`);
  }
});
