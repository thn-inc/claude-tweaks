'use strict';
// #6056 AC8: a record body carrying a `Plan:` line (written by plan-store.js through
// composePlanLine) gets the same verdict from every existing body parser as the same body without
// it, so a build of such a record still plans as today until #6060 lands. Also pins why
// specify/planning.md inserts `## Overview`: specHash refuses a body without one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  composePlanLine, parsePlanLine, specHash, parseRiskFlags, parseAcceptanceTarget,
  parseDependencies, extractFingerprint,
} = require('../../../plugin/bin/lib/issues/record.js');
const { extractKeyFileEntries, extractKeyFilesSection } = require('../../../plugin/bin/lib/issues/grouping.js');
const { liftMetadata } = require('../../../plugin/bin/lib/issues/materialize-format.js');
const { validateShaped } = require('../../../plugin/bin/lib/compose-record/compose.js');
const { extractAcceptanceClauses, extractSpecPaths } = require('../../../plugin/bin/lib/plan-audit/parser.js');

const LINE = composePlanLine({ record: 6056, commit: 'a'.repeat(40), specHash: 'b'.repeat(64) });

const BODY = [
  'Surface: infra',
  'Risk-flags: none',
  'Acceptance-target: local',
  '',
  '## Overview',
  '',
  'Store a reviewed plan at specify time.',
  '',
  '## Current State',
  '',
  '- `plugin/bin/plan-store.js` stores plans today.',
  '',
  '## Deliverables',
  '',
  '1. A step.',
  '',
  '## Acceptance Criteria',
  '',
  '1. The step runs; the line is written.',
  '',
  '## Release Note',
  '',
  'Specify can store a reviewed plan.',
  '',
  '## Technical Approach',
  '',
  '### Key Files',
  '',
  '- `plugin/skills/specify/planning.md` — new',
  '',
  '## Gotchas',
  '',
  'None.',
  '',
  '## Planning Decisions',
  '',
  'No planning questions arose.',
  '',
  '## Original request',
  '',
  'Plan at specify time. Blocked by #6052',
  '',
].join('\n');

const WITH_LINE = BODY.replace('Acceptance-target: local\n', `Acceptance-target: local\n${LINE}\n`);

const PARSERS = {
  parsePlanLine, specHash, parseRiskFlags, parseAcceptanceTarget, parseDependencies,
  extractFingerprint, extractKeyFileEntries, extractKeyFilesSection, liftMetadata,
  extractAcceptanceClauses, extractSpecPaths,
};

test('AC8.1: every existing body parser gives the same verdict with and without a Plan: line', () => {
  assert.notEqual(WITH_LINE, BODY);
  assert.equal(parsePlanLine(LINE).ok, true);
  for (const [name, fn] of Object.entries(PARSERS)) {
    assert.deepEqual(fn(WITH_LINE), fn(BODY), name);
  }
});

test('AC8.1: the shape gate accepts a body carrying a Plan: line', () => {
  assert.deepEqual(validateShaped(WITH_LINE), { ok: true, gaps: [] });
});

test('control: the comparison sees a metadata change a parser reads', () => {
  const changed = BODY.replace('Risk-flags: none', 'Risk-flags: auth');
  assert.notEqual(changed, BODY);
  assert.notDeepEqual(parseRiskFlags(changed), parseRiskFlags(BODY));
});

test('planning inserts ## Overview because specHash refuses a body without one', () => {
  const stripped = BODY.replace(/## Overview\n\n[^\n]*\n\n/, '');
  assert.notEqual(stripped, BODY);
  assert.throws(() => specHash(stripped), { code: 'SPEC_NO_OVERVIEW' });
  assert.match(specHash(BODY), /^[0-9a-f]{64}$/);
});
