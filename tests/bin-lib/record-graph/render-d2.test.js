// tests/bin-lib/record-graph/render-d2.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderD2 } = require('../../../plugin/bin/lib/record-graph/render-d2');
const { ORIGIN_COLORS, BORDER_COLORS } = require('../../../plugin/bin/lib/record-graph/palette');
const { buildGraph } = require('../../../plugin/bin/lib/record-graph/layout');
const { FIXTURE_RECORDS } = require('./fixtures');

const GENERATED_AT = '2026-08-03T12:00:00.000Z';

test('renderD2 emits a generated-at header and a re-run hint', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /# Generated 2026-08-03T12:00:00\.000Z/);
  assert.match(output, /re-run \/claude-tweaks:visualize record-graph to refresh/);
});

test('renderD2 emits one container per stage column with its label', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /backlog: "Backlog" \{/);
  assert.match(output, /parked: "Parked" \{/);
  assert.match(output, /ready: "Ready" \{/);
});

test('renderD2 emits a node per record with title + badges joined by \\n, and origin/border colors', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /n10: "#10 Backlog record with no scoring" \{/);
  assert.match(output, /n20: "#20 Ready record blocked by #10\\nR:low S:medium" \{/);
  assert.match(output, /n30: "#30 Parked record with grants\\n\[bug\]\\nAUTO-BUILD\\nAUTO-MERGE\\naccept:pending" \{/);
  assert.ok(output.includes(`style.fill: "${ORIGIN_COLORS['code-health']}"`));
  assert.ok(output.includes(`style.stroke: "${BORDER_COLORS.blocked}"`));
  assert.match(output, /style\.stroke-dash: 3/);
});

test('renderD2 emits a cross-container edge using qualified node paths', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /ready\.n20 -> backlog\.n10/);
});

test('renderD2 emits the edges-omitted note and no edge lines under work-links: native', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'native' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /# Dependency edges unavailable under work-links: native/);
  assert.ok(!output.includes(' -> '));
});

test('renderD2 emits a truncation note when graph.truncated is set', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'body-text', truncated: true });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /# Showing the fetch cap.s worth of records/);
});

test('renderD2 escapes double quotes in a title', () => {
  const record = { ...FIXTURE_RECORDS[0], title: 'A "quoted" title' };
  const graph = buildGraph([record], { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /n10: "#10 A \\"quoted\\" title" \{/);
});

test('renderD2 emits a legend container covering every origin fill and bot-state border', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /^legend: "Legend — fill: Origin, border: Bot state" \{$/m);
  for (const [key, hex] of Object.entries(ORIGIN_COLORS)) {
    assert.ok(output.includes(`: "${key}" {`), `legend is missing an origin entry for ${key}`);
    assert.ok(output.includes(`style.fill: "${hex}"`), `legend is missing origin fill ${hex}`);
  }
  for (const [key, hex] of Object.entries(BORDER_COLORS)) {
    assert.ok(output.includes(`: "${key}" {`), `legend is missing a bot-state entry for ${key}`);
    assert.ok(output.includes(`style.stroke: "${hex}"`), `legend is missing bot-state stroke ${hex}`);
  }
});

test('renderD2 legend entry ids are valid D2 identifiers (no hyphens from the palette keys)', () => {
  const graph = buildGraph(FIXTURE_RECORDS, { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /^ {2}origin_code_health: "code-health" \{$/m);
  assert.match(output, /^ {2}bot_in_progress: "in-progress" \{$/m);
});

test('renderD2 still renders the legend when there are no records at all', () => {
  const graph = buildGraph([], { workLinks: 'body-text' });
  const output = renderD2(graph, { generatedAt: GENERATED_AT });
  assert.match(output, /^legend: /m);
  assert.ok(output.includes(': "human" {'));
});
