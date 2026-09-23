'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeBody, validateShaped, splitSections } = require('../../../plugin/bin/lib/compose-record/compose');

const SHAPED = [
  '## Current State',
  '',
  'Some current state text.',
  '',
  '## Deliverables',
  '',
  '- [ ] Do the thing.',
  '',
  '## Acceptance Criteria',
  '',
  '1. The thing is done.',
  '',
  '## Release Note',
  '',
  'Did the thing.',
].join('\n');

test('composeBody wraps recordPayload — fingerprint marker appended', () => {
  const result = composeBody({ title: 'x', body: 'body text', type: 'feature', fingerprint: 'design:unit' });
  assert.equal(result.title, 'x');
  assert.equal(result.type, 'feature');
  assert.match(result.body, /body text\n\n<!-- work-fingerprint: design:unit -->\nwork-fingerprint: design:unit$/);
});

test('composeBody propagates recordPayload validation errors', () => {
  assert.throws(() => composeBody({ title: 'x', body: 'b', type: 'not-a-real-type' }), /type/);
  assert.throws(() => composeBody({ title: '', body: 'b', type: 'feature' }), /title/);
});

test('validateShaped: ok on a well-formed spec-shaped body', () => {
  const result = validateShaped(SHAPED);
  assert.deepEqual(result, { ok: true, gaps: [] });
});

test('validateShaped: flags a missing section', () => {
  const body = SHAPED.replace('## Acceptance Criteria\n\n1. The thing is done.', '');
  const result = validateShaped(body);
  assert.equal(result.ok, false);
  assert.ok(result.gaps.some((g) => /missing section: ## Acceptance Criteria/.test(g)));
});

test('validateShaped: flags a missing ## Release Note section (the fourth required section)', () => {
  const body = SHAPED.replace('\n\n## Release Note\n\nDid the thing.', '');
  const result = validateShaped(body);
  assert.equal(result.ok, false);
  assert.ok(result.gaps.some((g) => /missing section: ## Release Note/.test(g)));
});

test('validateShaped: flags an empty (whitespace-only) section', () => {
  const body = SHAPED.replace('- [ ] Do the thing.', '');
  const result = validateShaped(body);
  assert.equal(result.ok, false);
  assert.ok(result.gaps.some((g) => /empty section: ## Deliverables/.test(g)));
});

test('validateShaped: flags TBD/TODO/<!-- ambiguity: anywhere in the body, not only inside the three sections', () => {
  assert.equal(validateShaped(SHAPED + '\n\n## Gotchas\n\nTBD').ok, false);
  assert.equal(validateShaped(SHAPED + '\n\n## Gotchas\n\nTODO: fill in').ok, false);
  assert.equal(validateShaped(SHAPED + '\n\n## Gotchas\n\n<!-- ambiguity: which flag -->').ok, false);
});

test('validateShaped: multiple gaps are all reported at once, not just the first', () => {
  const result = validateShaped('## Deliverables\n\nTBD');
  assert.equal(result.ok, false);
  assert.ok(result.gaps.length >= 3, `expected >=3 gaps, got ${JSON.stringify(result.gaps)}`);
});

test('validateShaped: ok when a TBD/TODO/<!-- ambiguity: marker sits only inside a verbatim ## Original request section (refs #1240)', () => {
  const body = SHAPED + '\n\n## Original request\n\nOld title with a TBD in it\n\nTODO: revisit\n\n<!-- ambiguity: which flag -->';
  const result = validateShaped(body);
  assert.deepEqual(result, { ok: true, gaps: [] });
});

test('validateShaped: a marker before the ## Original request heading still fails even when that section is present', () => {
  const body = SHAPED.replace('- [ ] Do the thing.', '- [ ] Do the thing TBD.') + '\n\n## Original request\n\nOld title\n\nclean original text';
  const result = validateShaped(body);
  assert.equal(result.ok, false);
  assert.ok(result.gaps.some((g) => /unresolved placeholder marker: TBD/.test(g)));
});

test('validateShaped: a marker quoted inside a fenced code block passes; the same bare marker fails (#1839, agrees with shapeGate)', () => {
  const fenced = SHAPED.replace('- [ ] Do the thing.', '- [ ] Do the thing.\n\n```\nquoted line with a TODO word inside\n```');
  assert.deepEqual(validateShaped(fenced), { ok: true, gaps: [] });

  const bare = SHAPED.replace('- [ ] Do the thing.', '- [ ] Do the thing TODO.');
  assert.equal(validateShaped(bare).ok, false);
});

test('validateShaped: a marker quoted inside an inline code span passes (#1839)', () => {
  const inline = SHAPED.replace('- [ ] Do the thing.', '- [ ] mentions `TODO` in code');
  assert.deepEqual(validateShaped(inline), { ok: true, gaps: [] });
});

test('splitSections: line-anchored ## headings only — a mid-line "## " is not a heading', () => {
  const sections = splitSections('## Current State\n\ntext with ## not a heading inline\n\n## Deliverables\n\nmore');
  assert.equal(Object.keys(sections).length, 2);
  assert.match(sections['Current State'], /## not a heading inline/);
});
