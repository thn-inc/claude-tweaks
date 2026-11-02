'use strict';

// #4611: wrap-up's prose around the acceptance packet. This suite reads the live skill
// files on purpose: the parent gate keeps the legacy `## Verification Brief` (Decision Q1)
// and the no-parent path posts a packet on either side of the oversight floor (Decision Q5).
// Go-red evidence is a mutation run against a scratch checkout (the task report's mutant table).

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));
const PARENT_GATE = 'wrap-up/verification-brief-parent-gate.md';

function section(doc, startHeading, endHeading) {
  const start = doc.indexOf(`\n${startHeading}\n`);
  assert.notStrictEqual(start, -1, `missing heading ${startHeading}`);
  const end = doc.indexOf(`\n${endHeading}\n`, start);
  assert.notStrictEqual(end, -1, `missing heading ${endHeading}`);
  return doc.slice(start, end);
}

function paragraphAt(doc, opening) {
  const start = doc.indexOf(opening);
  assert.notStrictEqual(start, -1, `missing paragraph ${opening}`);
  const end = doc.indexOf('\n\n', start);
  assert.notStrictEqual(end, -1, `unterminated paragraph ${opening}`);
  return doc.slice(start, end);
}

test('parent gate holds the legacy brief template', () => {
  const compose = section(read(PARENT_GATE), '## Compose the parent brief', '## Apply the gate');
  const fence = compose.match(/\n```markdown\n([\s\S]*?)\n```\n/);
  assert.ok(fence, 'the section must hold a fenced markdown block');
  const body = fence[1];
  assert.ok(body.startsWith('## Verification Brief\n\n### The ask'), 'the fence opens on the brief heading');
  for (const literal of ['### Confirmed', '### Observation plan', '_Posted by {poster}. Resolve with `/claude-tweaks:demo`._']) {
    assert.ok(body.includes(literal), `the fence holds ${literal}`);
  }
  assert.ok(!compose.includes('Render the same'), 'the section no longer points at a template elsewhere');
});

test('the template sentence follows the fence and names the record that retires it', () => {
  const compose = section(read(PARENT_GATE), '## Compose the parent brief', '## Apply the gate');
  const sentence = compose.indexOf(
    'Render this template — the legacy Verification Brief, kept for the parent gate until the feature-level '
    + 'acceptance record (#4617) moves parents to the acceptance packet (`_shared/acceptance-packet.md`) — with:',
  );
  assert.notStrictEqual(sentence, -1, 'the replacement sentence is present on one line');
  assert.ok(compose.indexOf('\n```markdown\n') < sentence, 'the fence sits above the sentence');
});

test('the fail-open fallback lands the Try it block in the packet, with the label only above the floor (Decision Q5)', () => {
  const ret = paragraphAt(read(PARENT_GATE), '**Return to the Try it post').replace(/\s+/g, ' ');
  const fallback = ret.slice(ret.indexOf('The one exception is the fail-open fallback'), ret.indexOf('The parent-side'));
  assert.ok(fallback.includes('`_shared/acceptance-packet.md`'), 'the fallback names the packet contract');
  assert.ok(fallback.includes('Test guide'), 'the fallback names where the block lands');
  assert.ok(fallback.includes('with the pending label only above it'), 'the label stays above the floor');
  assert.ok(!fallback.includes('Posting it alone'), 'the below-floor post is retired on this path');
  assert.ok(!fallback.includes("Step 4's template"), 'the fallback no longer points at the brief template');
});
