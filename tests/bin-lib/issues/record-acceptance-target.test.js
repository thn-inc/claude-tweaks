'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseAcceptanceTarget, itemOverrideOf } = require('../../../plugin/bin/lib/issues/record-acceptance-target');
const { parseRiskFlags } = require('../../../plugin/bin/lib/issues/record-risk-flags');
const { resolveAcceptanceTarget } = require('../../../plugin/bin/lib/accept/target');

const OK_BODY = 'Surface: web\nAcceptance-target: local\n\n## Overview\n';

test('exact line reads ok local', () => {
  const p = parseAcceptanceTarget(OK_BODY);
  assert.deepStrictEqual(p, { status: 'ok', value: 'local', raw: 'Acceptance-target: local' });
  assert.strictEqual(itemOverrideOf(p), 'local');
});

test('exact dev line reads ok dev (and Task 1 rejects it)', () => {
  const p = parseAcceptanceTarget('Surface: web\nAcceptance-target: dev\n\n## Overview\n');
  assert.strictEqual(p.status, 'ok');
  assert.strictEqual(p.value, 'dev');
  const r = resolveAcceptanceTarget({ keptRiskFlags: [], itemOverride: itemOverrideOf(p), policyDefault: 'dev' });
  assert.strictEqual(r.reason, 'invalid-input');
});

test('AC2.1: duplicated line reads malformed', () => {
  const p = parseAcceptanceTarget('Acceptance-target: local\nAcceptance-target: local\n\n## Overview\n');
  assert.strictEqual(p.status, 'malformed');
  assert.strictEqual(itemOverrideOf(p), null);
});

const VARIANTS = [
  'acceptance-target: local', 'Acceptance-target: Local', '**Acceptance-target:** local',
  '- Acceptance-target: local', '> Acceptance-target: local', 'Acceptance_target: local',
  'Acceptance-target: staging', 'Acceptance-target:',
];

test('variants read malformed, not absent', () => {
  for (const line of VARIANTS) {
    const p = parseAcceptanceTarget(`Surface: web\n${line}\n\n## Overview\n`);
    assert.strictEqual(p.status, 'malformed', line);
    assert.strictEqual(itemOverrideOf(p), null, line);
  }
});

test('a malformed line never falls through to the policy default', () => {
  for (const body of ['Acceptance-target: local\nAcceptance-target: local\n\n## Overview\n', 'acceptance-target: local\n\n## Overview\n']) {
    const result = resolveAcceptanceTarget({
      keptRiskFlags: [], itemOverride: itemOverrideOf(parseAcceptanceTarget(body)), policyDefault: 'dev',
    });
    assert.deepStrictEqual(result, { target: 'local', reason: 'invalid-input' }, body);
  }
});

test('trailing whitespace reads malformed', () => {
  const p = parseAcceptanceTarget('Surface: web\nAcceptance-target: local \n\n## Overview\n');
  assert.strictEqual(p.status, 'malformed');
  assert.strictEqual(itemOverrideOf(p), null);
});

test('an unclosed frontmatter block is read as preamble, like parseRiskFlags', () => {
  const body = '---\nAcceptance-target: local\nRisk-flags: none\n\n## Overview\n';
  assert.strictEqual(parseAcceptanceTarget(body).status, 'ok');
  assert.strictEqual(parseRiskFlags(body).status, 'ok');
});

test('a blockquote variant beside an exact line reads malformed', () => {
  const p = parseAcceptanceTarget('> Acceptance-target: local\nAcceptance-target: local\n\n## Overview\n');
  assert.strictEqual(p.status, 'malformed');
  assert.strictEqual(itemOverrideOf(p), null);
});

test('absent when missing, fenced, or below the first ## heading, or inside frontmatter', () => {
  const bodies = [
    'Surface: web\n\n## Overview\n',
    'Surface: web\n\n```\nAcceptance-target: local\n```\n\n## Overview\n',
    'Surface: web\n\n## Overview\nAcceptance-target: local\n',
    '---\nAcceptance-target: local\n---\nSurface: web\n\n## Overview\n',
  ];
  for (const body of bodies) {
    const p = parseAcceptanceTarget(body);
    assert.strictEqual(p.status, 'absent', body);
    assert.strictEqual(itemOverrideOf(p), undefined, body);
  }
});

test('CRLF body reads the same as LF', () => {
  const p = parseAcceptanceTarget(OK_BODY.replace(/\n/g, '\r\n'));
  assert.strictEqual(p.status, 'ok');
  assert.strictEqual(p.value, 'local');
});

test('record.js re-exports the reader', () => {
  assert.strictEqual(require('../../../plugin/bin/lib/issues/record').parseAcceptanceTarget, parseAcceptanceTarget);
});
