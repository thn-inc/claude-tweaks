// tests/bin-lib/flow/pr-body.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  composePrEarlyBody, repairPrBody, hasRunMarker, hasPhasesPair, hasFixesPair,
} = require('../../../plugin/bin/lib/flow/pr-body');

test('composePrEarlyBody puts the run marker as the unconditional first line, plain-text companion immediately after', () => {
  const body = composePrEarlyBody({
    runId: '2026-10-06T031832-record-2997',
    specSummary: 'One paragraph.',
    target: '#2997',
    nextStep: 'build',
    fixesLines: ['Fixes #2997'],
  });
  assert.match(
    body,
    /^<!-- claude-tweaks-run: 2026-10-06T031832-record-2997 -->\nclaude-tweaks-run: 2026-10-06T031832-record-2997\n\n### Spec summary/,
  );
});

test('composePrEarlyBody contains both delimiter pairs and one Fixes line per target (#2997 AC1)', () => {
  const body = composePrEarlyBody({
    runId: 'r1', specSummary: 's', target: '#1,#2', nextStep: 'build',
    fixesLines: ['Fixes #1', 'Fixes #2'],
  });
  assert.match(body, /<!-- phases-start -->/);
  assert.match(body, /<!-- phases-end -->/);
  assert.match(body, /\[claude-tweaks-phases-start\]/);
  assert.match(body, /\[claude-tweaks-phases-end\]/);
  assert.match(body, /<!-- fixes-start -->/);
  assert.match(body, /<!-- fixes-end -->/);
  assert.match(body, /\[claude-tweaks-fixes-start\]/);
  assert.match(body, /\[claude-tweaks-fixes-end\]/);
  assert.match(body, /Fixes #1/);
  assert.match(body, /Fixes #2/);
  assert.equal(hasRunMarker(body), true);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
});

test('composePrEarlyBody defaults the phase checklist to the canonical five phases, all unchecked', () => {
  const body = composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1', nextStep: 'build', fixesLines: ['Fixes #1'] });
  for (const phase of ['build', 'test', 'review', 'polish', 'wrap-up']) {
    assert.match(body, new RegExp(`- \\[ \\] ${phase}`));
  }
});

test('composePrEarlyBody requires runId/target/nextStep', () => {
  assert.throws(() => composePrEarlyBody({ specSummary: 's', target: '#1', nextStep: 'build' }), /runId/);
  assert.throws(() => composePrEarlyBody({ runId: 'r1', specSummary: 's', nextStep: 'build' }), /target/);
  assert.throws(() => composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1' }), /nextStep/);
});

test('repairPrBody restores all three marker pairs when none are present, preserving the freeform text (#2997 AC2/AC4 — the #2996 shape)', () => {
  const freeform = '## Summary\n\nThis PR does a thing. It was opened without the template.\n';
  const { body, restored } = repairPrBody({
    body: freeform,
    runId: '2026-10-05T071404-record-2982',
    fixesLines: ['Fixes #2982'],
  });

  assert.deepEqual(restored, ['run marker', 'phases block', 'fixes block']);
  assert.ok(body.includes(freeform.trim()), 'freeform content must survive the repair byte-for-byte');
  assert.equal(hasRunMarker(body), true);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
  assert.match(body, /Fixes #2982/);
  // The run marker is restored as the new first line, same as a fresh compose.
  assert.match(body, /^<!-- claude-tweaks-run: 2026-10-05T071404-record-2982 -->\nclaude-tweaks-run: 2026-10-05T071404-record-2982\n/);
});

test('repairPrBody is a no-op (restores nothing) on a body that already carries every marker', () => {
  const composed = composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1', nextStep: 'build', fixesLines: ['Fixes #1'] });
  const { body, restored } = repairPrBody({ body: composed, runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.deepEqual(restored, []);
  assert.equal(body, composed);
});

test('repairPrBody restores only the pieces actually missing', () => {
  const partial = [
    '<!-- claude-tweaks-run: r1 -->',
    'claude-tweaks-run: r1',
    '',
    'some freeform notes',
    '',
    '<!-- phases-start -->',
    '[claude-tweaks-phases-start]',
    '- [ ] build',
    '[claude-tweaks-phases-end]',
    '<!-- phases-end -->',
    '',
  ].join('\n');
  const { restored, body } = repairPrBody({ body: partial, runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.deepEqual(restored, ['fixes block']);
  assert.equal(hasRunMarker(body), true);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
  assert.ok(body.includes('some freeform notes'));
});

test('repairPrBody strips an orphaned half-marker instead of appending a duplicate unclosed span (wrap-up #2997 follow-up)', () => {
  // A phases-start with no matching phases-end — e.g. a body truncated mid-write.
  // Human content sits between the orphan and the real fixes block.
  const malformed = [
    '<!-- phases-start -->',
    'some human notes between the orphan and the fixes block',
    '<!-- fixes-start -->',
    '[claude-tweaks-fixes-start]',
    'Fixes #42',
    '[claude-tweaks-fixes-end]',
    '<!-- fixes-end -->',
  ].join('\n');
  const { body, restored } = repairPrBody({ body: malformed, runId: 'r1', fixesLines: ['Fixes #42'] });

  assert.deepEqual(restored, ['run marker', 'phases block']);
  // The orphaned start is gone, not left dangling alongside a freshly appended pair.
  const phasesStartCount = (body.match(/<!-- phases-start -->/g) || []).length;
  const phasesEndCount = (body.match(/<!-- phases-end -->/g) || []).length;
  assert.equal(phasesStartCount, 1, 'exactly one phases-start — the orphan must not survive alongside the new pair');
  assert.equal(phasesEndCount, 1);
  // The freeform content between the orphan and the real fixes block must survive.
  assert.ok(body.includes('some human notes between the orphan and the fixes block'));
  // The original fixes block (never touched — it was already a real pair) must survive untouched.
  assert.match(body, /Fixes #42/);
  assert.equal(hasPhasesPair(body), true);
  assert.equal(hasFixesPair(body), true);
});

test('repairPrBody strips an orphaned fixes-end with no matching fixes-start', () => {
  const malformed = [
    '<!-- claude-tweaks-run: r1 -->',
    'claude-tweaks-run: r1',
    '',
    '<!-- phases-start -->',
    '[claude-tweaks-phases-start]',
    '- [ ] build',
    '[claude-tweaks-phases-end]',
    '<!-- phases-end -->',
    '',
    'stray trailing content',
    '[claude-tweaks-fixes-end]',
  ].join('\n');
  const { body, restored } = repairPrBody({ body: malformed, runId: 'r1', fixesLines: ['Fixes #7'] });

  assert.deepEqual(restored, ['fixes block']);
  const fixesEndCount = (body.match(/\[claude-tweaks-fixes-end\]/g) || []).length;
  assert.equal(fixesEndCount, 1, 'the orphaned end must not survive alongside the new pair\'s own end');
  assert.ok(body.includes('stray trailing content'));
  assert.match(body, /Fixes #7/);
  assert.equal(hasFixesPair(body), true);
});

test('hasRunMarker/hasPhasesPair/hasFixesPair recognize either the HTML-comment or the plain-text form alone (#929 MCP-read case)', () => {
  assert.equal(hasRunMarker('claude-tweaks-run: r1\n'), true);
  assert.equal(hasRunMarker('no marker here'), false);
  assert.equal(hasPhasesPair('[claude-tweaks-phases-start]\n[claude-tweaks-phases-end]'), true);
  assert.equal(hasPhasesPair('<!-- phases-start -->\n<!-- phases-end -->'), true);
  assert.equal(hasPhasesPair('<!-- phases-start -->'), false);
  assert.equal(hasFixesPair('[claude-tweaks-fixes-start]\n[claude-tweaks-fixes-end]'), true);
  assert.equal(hasFixesPair('nothing'), false);
});
