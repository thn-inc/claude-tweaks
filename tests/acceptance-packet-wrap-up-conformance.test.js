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

test('the no-parent descriptions state the packet, with the label only above the floor (Decision Q5)', () => {
  const doc = read(PARENT_GATE);
  const failOpen = paragraphAt(doc, '**Fail open on every `gh` call').replace(/\s+/g, ' ');
  assert.ok(failOpen.includes('a packet either way, with the pending label only above the floor'), 'Fail open states the packet');
  assert.ok(!failOpen.includes('when it clears the floor'), 'Fail open no longer limits the fallback to above the floor');
  const noParent = paragraphAt(doc, '**No parent resolvable**').replace(/\s+/g, ' ');
  assert.ok(noParent.includes('gets a packet, with the pending label only above the floor'), 'the no-parent branch states the packet');
  assert.ok(!noParent.includes('exactly as today'), 'the no-parent branch no longer describes the old path');
});

test('a note ahead of the template says whose sections its references mean, and those sections exist', () => {
  const compose = section(read(PARENT_GATE), '## Compose the parent brief', '## Apply the gate');
  const fence = compose.indexOf('\n```markdown\n');
  const note = compose.slice(compose.lastIndexOf('\n\n', fence - 2), fence);
  for (const literal of ['**Try it block**', "`verification-brief.md`'s `## Try it block`, its Step 2 and its Step 3"]) {
    assert.ok(note.includes(literal), `the note names ${literal}`);
  }
  const brief = read('wrap-up/verification-brief.md');
  for (const heading of ['\n## Try it block', '\n## Step 2:', '\n## Step 3:']) {
    assert.ok(brief.includes(heading), `verification-brief.md keeps ${heading.trim()}`);
  }
});

test('the parent gate no longer cites Step 4 for a template or a write it does not hold', () => {
  const doc = read(PARENT_GATE);
  const compose = section(doc, '## Compose the parent brief', '## Apply the gate');
  for (const stale of ["Step 4's kind-keyed", "Step 4's per-record", 'same condition Step 4']) {
    assert.ok(!compose.includes(stale), `Compose no longer says ${stale}`);
  }
  assert.ok(compose.includes('composes no `### Branch` section'), 'Compose states the Branch rule itself');
  const apply = doc.slice(doc.indexOf('\n## Apply the gate\n')).replace(/\s+/g, ' ');
  assert.ok(!apply.includes('same write Step 4'), 'Apply no longer cites Step 4 for the local-files write');
  assert.ok(!apply.includes("Step 4 (`verification-brief.md`)'s existing invariant"), 'Apply no longer cites a brief invariant in Step 4');
  assert.ok(apply.includes('the same order Step 4 (`verification-brief.md`) keeps for its own comment'), 'Apply keeps the post-before-label citation');
});
