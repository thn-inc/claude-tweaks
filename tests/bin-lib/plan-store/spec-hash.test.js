'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { specHash, composePlanLine } = require('../../../plugin/bin/lib/issues/plan-line');

const FENCE = '```';
const SPEC = [
  '---',
  'title: Example',
  'status: ready',
  '---',
  '# Example spec',
  '',
  'Surface: infra',
  'Risk-flags: public-contract',
  '',
  '## Overview',
  'The overview says one thing.',
  '',
  '## Non-Goals',
  'Nothing else is built.',
  '',
  '## Technical Approach',
  'Quote of the layout:',
  FENCE,
  '## Planning Decisions',
  '## Overview',
  FENCE,
  'After the fence.',
  '',
  '## Planning Decisions',
  'We chose option A.',
  '',
  '## Original request',
  'The user typed this.',
  '',
  '<!-- work-fingerprint: abc123 -->',
  'work-fingerprint: abc123',
  '',
].join('\n');

const H = 'b'.repeat(64);
const sub = (text, from, to) => {
  assert.ok(text.includes(from), `fixture lacks ${from}`);
  return text.replace(from, to);
};

test('AC3.3 editing a covered section changes the hash', () => {
  const base = specHash(SPEC);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(specHash(sub(SPEC, 'one thing', 'two things')), base);
  assert.notStrictEqual(specHash(sub(SPEC, 'Nothing else', 'Something else')), base);
  assert.notStrictEqual(specHash(sub(SPEC, 'option A', 'option B')), base);
});

test('AC3.4 Risk-flags and Related edits keep the hash', () => {
  const base = specHash(SPEC);
  assert.strictEqual(specHash(sub(SPEC, 'Risk-flags: public-contract', 'Risk-flags: other')), base);
  assert.strictEqual(specHash(sub(SPEC, 'We chose option A.', 'We chose option A.\n**Related:** #12')), base);
  const withDeps = sub(SPEC, 'We chose option A.', 'We chose option A.\nBlocked by #9\nBlocked by o/r#9\n' +
    composePlanLine({ record: 7, commit: 'a'.repeat(40), specHash: H }));
  assert.strictEqual(specHash(withDeps), base);
  assert.strictEqual(specHash(sub(SPEC, 'abc123 -->', 'zzz999 -->')), base);
  assert.strictEqual(specHash(sub(SPEC, 'work-fingerprint: abc123\n', 'work-fingerprint: zzz999\n')), base);
  assert.strictEqual(specHash(sub(SPEC, 'status: ready', 'status: shipped')), base);
});

test('a Blocked by line that is not a well-formed dependency is hashed', () => {
  const base = specHash(SPEC);
  for (const line of ['Blocked by someone', 'Blocked by #', 'Blocked by o/r', 'Blocked byte #9']) {
    assert.notStrictEqual(specHash(sub(SPEC, 'We chose option A.', `We chose option A.\n${line}`)), base, line);
  }
});

test('sections after Planning Decisions are not covered', () => {
  const base = specHash(SPEC);
  assert.strictEqual(specHash(sub(SPEC, 'The user typed this.', 'Edited.')), base);
  const noPd = SPEC.split('\n').filter((l, i, a) => !(l === '## Planning Decisions' && i === a.lastIndexOf(l)) ).join('\n');
  const noPdBase = specHash(noPd);
  assert.notStrictEqual(specHash(sub(noPd, 'The user typed this.', 'Edited.')), noPdBase);
});

test('specHash ignores fenced headings', () => {
  const base = specHash(SPEC);
  // the fenced `## Planning Decisions` must not end coverage: text after it, still in the same section, is hashed
  assert.notStrictEqual(specHash(sub(SPEC, 'After the fence.', 'After the fence, edited.')), base);
  // removing the fenced heading line is itself a covered edit
  assert.notStrictEqual(specHash(SPEC.replace(`${FENCE}\n## Planning Decisions\n`, `${FENCE}\n`)), base);
});

test('a metadata-prefix line inside a fence is still hashed', () => {
  const withFenced = sub(SPEC, 'After the fence.', `${FENCE}\nRisk-flags: auth\n${FENCE}\nAfter the fence.`);
  const base = specHash(withFenced);
  assert.notStrictEqual(specHash(sub(withFenced, 'Risk-flags: auth', 'Risk-flags: migrations')), base);
});

test('normalization', () => {
  const base = specHash(SPEC);
  assert.strictEqual(specHash(SPEC.replace(/\n/g, '\r\n')), base);
  assert.strictEqual(specHash(SPEC.split('\n').map((l) => `${l} \t`).join('\n')), base);
  assert.strictEqual(specHash(`${SPEC}\n\n\n`), base);
  const malformed = sub(SPEC, 'We chose option A.', 'We chose option A.\nPlan: refs/claude-tweaks/plans/07 nope');
  assert.notStrictEqual(specHash(malformed), base);
});

test('specHash throws SPEC_NO_OVERVIEW', () => {
  const none = '# t\n\n## Non-Goals\nx\n';
  assert.throws(() => specHash(none), (e) => e.code === 'SPEC_NO_OVERVIEW');
  const fencedOnly = `# t\n${FENCE}\n## Overview\nx\n${FENCE}\n## Non-Goals\ny\n`;
  assert.throws(() => specHash(fencedOnly), (e) => e.code === 'SPEC_NO_OVERVIEW');
});
