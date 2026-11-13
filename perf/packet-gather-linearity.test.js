// Acceptance-packet gather and render linearity budget (#4611) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// packet-gather.js reads a spec, a story file and a decisions log, none of them bounded in line length. Five patterns
// were quadratic on a long whitespace run inside one line: the heading pattern's trailing `\s*$`, the YAML comment
// strip's `\s+#`, and the two decision-log clause patterns' leading `\s*` (about 6 to 12 s at 100k characters). The
// render side has two more: the truncation loop recounted the whole section after every dropped row, and the plan
// screen, which now looks one line ahead of a bare credential key. Lives outside tests/ for the same reason the other
// perf/ files do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { MAX_PACKET_CHARS } = require('../plugin/bin/lib/wrap-up/packet-contract');
const { parseAcceptanceCriteria, parseStoryFile, lowConfidenceFindings } = require('../plugin/bin/lib/wrap-up/packet-gather');
const { inline, renderPacket } = require('../plugin/bin/lib/wrap-up/packet-render');

const BUDGET_MS = 2000;
const timed = (run) => {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
};

const SPACES = ' '.repeat(200000);

const decisionText = (line) => {
  const hash = crypto.createHash('sha256').update(line).digest('hex').slice(0, 8);
  const items = [{ id: `decision:${line.slice(2, 60)}#${hash}`, section: 'Low-confidence findings' }];
  return lowConfidenceFindings({ items, findings: [], decisions: line }, () => null)[0].text;
};

for (const [label, run, expected] of [
  ['a heading with a 200k whitespace run inside', () => parseAcceptanceCriteria(`## Acceptance${SPACES}Criteria\n1. a\n`), []],
  ['a heading with a 200k trailing whitespace run', () => parseAcceptanceCriteria(`## Acceptance Criteria${SPACES}\n1. a\n`), [{ id: '1', text: 'a' }]],
  ['a heading of only a marker and a 200k whitespace run', () => parseAcceptanceCriteria(`## Acceptance Criteria\n1. a\n##${SPACES}\n2. b\n`), [{ id: '1', text: 'a' }]],
  ['a story id with a 200k whitespace run and no comment', () => parseStoryFile(`stories:\n  - id: a${SPACES}b\n`), [{ id: `a${SPACES}b`, negative: false }]],
  ['a story id with a 200k whitespace run before a comment', () => parseStoryFile(`stories:\n  - id: a${SPACES}# c\n`), [{ id: 'a', negative: false }]],
]) {
  test(`gather: ${label} stays linear`, () => {
    const { value, ms } = timed(run);
    // assert.ok, not deepEqual: a failing deepEqual would print 200k characters.
    assert.ok(JSON.stringify(value) === JSON.stringify(expected), `wrong output (${JSON.stringify(value).length} chars)`);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

for (const [label, line, expected] of [
  ['a 200k whitespace run, no clause', `- STAGED 10:00:00 — a${SPACES}b`, `a${SPACES}b`],
  ['a 200k whitespace run before a Reversibility clause', `- STAGED 10:00:00 — a${SPACES}Reversibility: high.`, 'a'],
  ['a 200k whitespace run before the low-confidence note', `- STAGED 10:00:00 — a${SPACES}Staged to Review Console as low-confidence.`, 'a'],
  ['a 200k whitespace run between two clauses', `- STAGED 10:00:00 — a Staged to Review Console as low-confidence.${SPACES}Reversibility: high.`, 'a'],
]) {
  test(`decision finding: ${label} stays linear`, () => {
    const { value, ms } = timed(() => decisionText(line));
    assert.ok(value === expected, `wrong output (${value.length} chars)`);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

for (const [label, input, expected] of [
  ['a 200k-digit `GH-` reference', `GH-${'1'.repeat(200000)}`, `\`GH-${'1'.repeat(200000)}\``],
  ['100k `GH-` repeats', 'GH-'.repeat(100000), 'GH-'.repeat(100000)],
  ['100k `GH-1` repeats', 'GH-1'.repeat(100000), 'GH-1'.repeat(100000)],
]) {
  test(`inline: ${label} stays linear`, () => {
    const { value, ms } = timed(() => inline(input));
    assert.ok(value === expected, `wrong output (${value.length} chars)`);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

const FACTS = { schemaVersion: 1, record: 1, partial: [], surface: null, allowedHosts: [], refused: [], facts: [] };
const NARRATIVE = { schemaVersion: 1, claims: [] };

test('truncation: 100k droppable rows stay linear and meet the cap', () => {
  const ROWS = 100000;
  const facts = Array.from({ length: ROWS }, (_, i) => ({
    id: `decision:d${i}`, kind: 'decision', status: 'passed', source: 'fixture', text: `decision number ${i}`,
  }));
  const { value, ms } = timed(() => renderPacket({ ...FACTS, facts }, NARRATIVE));
  const { markdown, truncated, chars } = value;
  const kept = markdown.split('\n').filter((line) => line.startsWith('- decision number ')).length;
  assert.ok(chars === markdown.length && chars <= MAX_PACKET_CHARS, `size ${chars}`);
  assert.ok(truncated > 0 && kept + truncated === ROWS, `kept ${kept}, truncated ${truncated}`);
  assert.ok(markdown.includes(`truncated: ${truncated} items omitted`));
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
});

test('observation plan: 50k bare credential keys, each over a sibling value, stay linear', () => {
  const plan = '- --api-key\n- SECRET\n'.repeat(50000);
  const { value, ms } = timed(() => renderPacket(FACTS, NARRATIVE, { observationPlan: plan }));
  assert.ok(!value.markdown.includes('SECRET'), 'a value was published');
  assert.ok(value.markdown.endsWith('### Observation plan\nall lines omitted for credential-shaped content'), 'wrong output');
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
});

test('observation plan: a credential key line with a 200k whitespace run stays linear', () => {
  const plan = `- --api-key${SPACES}\n- SECRET\n- shown`;
  const { value, ms } = timed(() => renderPacket(FACTS, NARRATIVE, { observationPlan: plan }));
  assert.ok(!value.markdown.includes('SECRET'), 'a value was published');
  assert.ok(value.markdown.endsWith('### Observation plan\n- shown'), 'wrong output');
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
});
