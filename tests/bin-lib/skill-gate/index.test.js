// tests/bin-lib/skill-gate/index.test.js — pins the skill-load gate's pure
// rules (record #5605): the design-wrapper parity with design-detect's
// evaluate(), the pre-build surface rule, the visual-review surface/file
// rule, the journeys no-surface-set rule, and every fail-open case the rules
// themselves reach. Fixture-only; no fs, no git.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const gate = require('../../../plugin/bin/lib/skill-gate');
const { evaluate, SKIP_REASONS } = require('../../../plugin/bin/lib/design-detect');

const { decide, CANNOT_TELL } = gate;

const journeysOf = (list) => () => ({ journeys: list });
const noLoad = () => { throw new Error('must not load'); };

function assertCannotTell(r) {
  assert.equal(r.decision, 'proceed');
  assert.equal(r.cannotTell, true);
  assert.ok(r.reason.startsWith(CANNOT_TELL), r.reason);
}

function assertRuleProceed(r) {
  assert.equal(r.decision, 'proceed', JSON.stringify(r));
  assert.equal(r.cannotTell, undefined);
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0);
  assert.ok(!r.reason.startsWith(CANNOT_TELL), r.reason);
}

// --- constants ---

test('constants: exported values', () => {
  assert.deepEqual(gate.SKILLS, ['journeys', 'visual-review', 'design-wrapper']);
  assert.deepEqual(gate.WRAPPER_MODES, ['pre-build', 'test', 'review', 'polish', 'survey']);
  assert.equal(CANNOT_TELL, 'cannot tell: ');
  assert.deepEqual(gate.NO_SURFACE_SET, [
    'test/**',
    'tests/**',
    '**/__tests__/**',
    '**/*.test.{js,jsx,ts,tsx,cjs,mjs,cts,mts}',
    '**/*.spec.{js,jsx,ts,tsx,cjs,mjs,cts,mts}',
    '.claude-tweaks/pipelines/**',
    'docs/superpowers/plans/**',
    'docs/plans/*-ledger.md',
  ]);
  assert.ok(Object.isFrozen(gate.NO_SURFACE_SET));
  assert.deepEqual(gate.VISUAL_SIGNAL_SURFACES, ['web', 'mobile', 'desktop']);
  assert.deepEqual(gate.VISUAL_NO_SIGNAL_SURFACES, ['backend', 'infra', 'terminal']);
});

test('normalizeSurface: absent, known, frontend alias, unrecognised', () => {
  for (const v of [null, undefined, '']) assert.deepEqual(gate.normalizeSurface(v), { kind: 'absent' });
  assert.deepEqual(gate.normalizeSurface('Web'), { kind: 'known', value: 'web' });
  assert.deepEqual(gate.normalizeSurface('Frontend'), { kind: 'known', value: 'web' });
  for (const v of ['mobile', 'desktop', 'terminal', 'backend', 'infra']) {
    assert.deepEqual(gate.normalizeSurface(v), { kind: 'known', value: v });
  }
  assert.deepEqual(gate.normalizeSurface('kiosk'), { kind: 'unrecognised', raw: 'kiosk' });
});

// --- design-wrapper parity with evaluate() ---

test('AC2.1/AC2.2: design-wrapper test/review/polish/survey equal evaluate() on decision and reason', () => {
  let n = 0;
  for (const mode of ['test', 'review', 'polish', 'survey']) {
    for (const surface of [undefined, 'web', 'mobile', 'desktop', 'terminal', 'backend', 'infra']) {
      for (const designIntegration of ['enabled', 'disabled', null]) {
        for (const files of [['plugin/bin/x.js'], ['src/components/Button.tsx']]) {
          const g = decide({ skill: 'design-wrapper', mode, surface, files, designIntegration });
          const e = evaluate({ mode, designIntegrationValue: designIntegration, surface, files });
          const label = JSON.stringify({ mode, surface, designIntegration, files });
          assert.equal(g.decision, e.decision, label);
          if (e.reason === undefined) {
            assert.equal(typeof g.reason, 'string', label);
            assert.ok(g.reason.length > 0, label);
            assert.ok(!g.reason.startsWith(CANNOT_TELL), label);
          } else {
            assert.equal(g.reason, e.reason, label);
          }
          n++;
        }
      }
    }
  }
  assert.equal(n, 168);
});

test('design-wrapper test: files error is cannot tell', () => {
  assertCannotTell(decide({ skill: 'design-wrapper', mode: 'test', surface: 'web', files: { error: 'no base' }, designIntegration: 'enabled' }));
});

// --- visual-review ---

test('AC3.1: visual-review proceeds on a signal surface or a UI trigger file', () => {
  assertRuleProceed(decide({ skill: 'visual-review', surface: 'web', files: ['plugin/bin/x.js'], loadJourneys: noLoad }));
  assertRuleProceed(decide({ skill: 'visual-review', surface: 'backend', files: ['src/components/Button.tsx'], loadJourneys: noLoad }));
  assertRuleProceed(decide({ skill: 'visual-review', surface: undefined, files: ['app/page.tsx'], loadJourneys: noLoad }));
});

test('AC3.2: visual-review skips on infra with no UI file and names the overlapping journey', () => {
  const r = decide({
    skill: 'visual-review',
    surface: 'infra',
    files: ['plugin/bin/x.js'],
    loadJourneys: journeysOf([{ name: 'dev-cli', files: ['plugin/bin/x.js'] }, { name: 'other', files: ['src/a.js'] }]),
  });
  assert.equal(r.decision, 'skip');
  assert.deepEqual(r.journeys, ['dev-cli']);
  assert.ok(!r.reason.startsWith(CANNOT_TELL));
  assert.equal(r.cannotTell, undefined);
});

test('visual-review skip: journeys sorted, deduped, unmatchable entries do not overlap', () => {
  const r = decide({
    skill: 'visual-review',
    surface: 'terminal',
    files: ['plugin/bin/x.js', 'plugin/bin/y.js'],
    loadJourneys: journeysOf([
      { name: 'zeta', files: ['plugin/bin/*.js'] },
      { name: 'alpha', files: ['plugin/bin/x.js', 'plugin/bin/y.js'] },
      { name: 'glob', files: ['plugin/**'] },
      { name: 'none', files: null },
    ]),
  });
  assert.equal(r.decision, 'skip');
  assert.deepEqual(r.journeys, ['alpha', 'zeta']);
});

test('visual-review skip with no surface names the absence in the reason', () => {
  const r = decide({ skill: 'visual-review', files: ['plugin/bin/x.js'], loadJourneys: journeysOf([]) });
  assert.equal(r.decision, 'skip');
  assert.deepEqual(r.journeys, []);
  assert.match(r.reason, /no surface declared/);
});

test('AC3.3: Frontend reads as web; kiosk is cannot tell (visual-review and pre-build)', () => {
  const base = { files: ['plugin/bin/x.js'], designIntegration: 'enabled', loadJourneys: journeysOf([]) };
  for (const call of [{ skill: 'visual-review' }, { skill: 'design-wrapper', mode: 'pre-build' }]) {
    const fe = decide({ ...base, ...call, surface: 'Frontend' });
    const web = decide({ ...base, ...call, surface: 'web' });
    assertRuleProceed(fe);
    assert.equal(fe.reason, web.reason);
    assertCannotTell(decide({ ...base, ...call, surface: 'kiosk' }));
  }
});

test('visual-review: empty list is cannot tell whatever the surface', () => {
  assertCannotTell(decide({ skill: 'visual-review', files: [], loadJourneys: noLoad }));
  assertCannotTell(decide({ skill: 'visual-review', surface: 'web', files: [], loadJourneys: noLoad }));
});

test('visual-review: files error and journeys error are cannot tell', () => {
  assertCannotTell(decide({ skill: 'visual-review', surface: 'web', files: { error: 'x' }, loadJourneys: noLoad }));
  assertCannotTell(decide({ skill: 'visual-review', surface: 'backend', files: ['plugin/bin/x.js'], loadJourneys: () => ({ error: 'x' }) }));
});

// --- design-wrapper pre-build ---

test('AC3.4/AC3.5: pre-build guards each decide alone', () => {
  const pb = (surface, designIntegration) => decide({ skill: 'design-wrapper', mode: 'pre-build', surface, designIntegration, files: { error: 'no diff' } });
  let r = pb(undefined, 'enabled');
  assert.equal(r.decision, 'skip');
  assert.ok(!r.reason.startsWith(CANNOT_TELL));
  assert.deepEqual(pb('backend', 'enabled'), { decision: 'skip', reason: SKIP_REASONS.NON_FRONTEND_SURFACE });
  assert.deepEqual(pb('infra', 'enabled'), { decision: 'skip', reason: SKIP_REASONS.NON_FRONTEND_SURFACE });
  assert.deepEqual(pb('web', 'disabled'), { decision: 'skip', reason: SKIP_REASONS.DISABLED });
  assert.deepEqual(pb('web', null), { decision: 'skip', reason: SKIP_REASONS.MISSING });
  r = pb('terminal', 'enabled');
  assertRuleProceed(r);
  assertRuleProceed(pb('mobile', 'plugin-only'));
});

// --- journeys ---

test('AC4.1/AC4.3/AC4.4/AC4.5: journeys proceeds', () => {
  const j = (files, loadJourneys = journeysOf([])) => decide({ skill: 'journeys', files, loadJourneys });
  assertRuleProceed(j(['plugin/bin/x.js'], noLoad));
  assertRuleProceed(j(['docs/journeys/a.md', 'tests/a.test.js'], noLoad));
  assertRuleProceed(j(['tests/a.test.js'], journeysOf([{ name: 'j', files: ['tests/a.test.js'] }])));
  assertRuleProceed(j(['tests/a.test.js'], journeysOf([{ name: 'j', files: ['tests/*.test.js'] }])));
  assertRuleProceed(j(['tests/a.test.js'], journeysOf([{ name: 'j', files: ['tests/**'] }])));
  assertRuleProceed(j(['tests/a.test.js'], journeysOf([{ name: 'j', files: ['src/**/x.js'] }])));
  assertCannotTell(j([], noLoad));
});

test('AC4.2/AC4.6: journeys skips', () => {
  const j = (files, loadJourneys) => decide({ skill: 'journeys', files, loadJourneys });
  for (const r of [
    j(['tests/a.test.js'], journeysOf([])),
    j(['src/__tests__/a.js', 'docs/superpowers/plans/p.md'], journeysOf([])),
    j(['tests/a.test.js'], journeysOf([{ name: 'j', files: null }])),
    j(['tests/a.test.js'], journeysOf([{ name: 'j', files: ['tests/b.test.js', 'tests/*.spec.js'] }])),
  ]) {
    assert.equal(r.decision, 'skip');
    assert.ok(!r.reason.startsWith(CANNOT_TELL));
    assert.equal(r.journeys, undefined);
  }
});

test('Review Focus 3: a nested docs/journeys file proceeds', () => {
  assertRuleProceed(decide({ skill: 'journeys', files: ['docs/journeys/sub/x.md'], loadJourneys: noLoad }));
});

test('journeys: a journey path that is also in the no-surface set still proceeds', () => {
  assert.equal(gate.inNoSurfaceSet('docs/journeys/a.test.js'), true);
  assertRuleProceed(decide({ skill: 'journeys', files: ['docs/journeys/a.test.js'], loadJourneys: noLoad }));
});

test('journeys: lazy load — no-surface miss never calls loadJourneys', () => {
  assertRuleProceed(decide({ skill: 'journeys', files: ['plugin/bin/x.js'], loadJourneys: noLoad }));
});

test('journeys: loadJourneys error and files error are cannot tell', () => {
  assertCannotTell(decide({ skill: 'journeys', files: ['tests/a.test.js'], loadJourneys: () => ({ error: 'x' }) }));
  assertCannotTell(decide({ skill: 'journeys', files: { error: 'x' }, loadJourneys: noLoad }));
});

// --- AC1 rule-level ---

test('AC1 (rules): test file + pipeline artifact, surface backend skips everywhere', () => {
  const files = ['tests/a.test.js', '.claude-tweaks/pipelines/r/work/1-spec.md'];
  const base = { surface: 'backend', files, designIntegration: 'enabled', loadJourneys: journeysOf([]) };
  assert.equal(decide({ ...base, skill: 'journeys' }).decision, 'skip');
  assert.equal(decide({ ...base, skill: 'visual-review' }).decision, 'skip');
  for (const mode of gate.WRAPPER_MODES) {
    assert.equal(decide({ ...base, skill: 'design-wrapper', mode }).decision, 'skip', mode);
  }
});

// --- whole-segment matching and path shapes ---

test('AC5.1/AC5.5/AC5.6: whole-segment, case-sensitive no-surface set and journey path', () => {
  for (const f of ['contests/a.js', 'src/tests-data/a.js', 'packages/test/src/a.js', 'src/tests/a.js', '.claude-tweaks/pipelines-old/a.md', 'Tests/a.js']) {
    assert.equal(gate.inNoSurfaceSet(f), false, f);
  }
  assert.equal(gate.isJourneyPath('docs/journeys-archive/a.md'), false);
  assert.equal(gate.isJourneyPath('docs/journeys/a.md'), true);
  assert.equal(gate.isJourneyPath('docs/journeys'), false);
});

test('NO_SURFACE_SET: one positive per entry and the negatives', () => {
  for (const f of [
    'test/a.js',
    'tests/a.js',
    'src/__tests__/a.js',
    'src/a.test.mts',
    'src/a.spec.jsx',
    '.claude-tweaks/pipelines/r/work/1-spec.md',
    'docs/superpowers/plans/p.md',
    'docs/plans/2026-11-16-x-ledger.md',
  ]) {
    assert.equal(gate.inNoSurfaceSet(f), true, f);
  }
  for (const f of ['docs/plans/sub/x-ledger.md', 'src/a.test.py', 'test', 'tests', 'src/__tests__', 'docs/plans/x.md']) {
    assert.equal(gate.inNoSurfaceSet(f), false, f);
  }
});

test('AC5.2/AC5.3/AC5.4/AC5.6: unnormalised path shapes proceed under journeys and visual-review', () => {
  const shapes = ['tests/./a.test.js', 'tests/../a.test.js', '/tests/a.test.js', 'tests/', 'tests\\a.test.js', 'tests/a%2etest.js', 'file://tests/a.test.js'];
  for (const f of shapes) {
    assert.ok(gate.pathShapeProblem(f), f);
    assertRuleProceed(decide({ skill: 'journeys', files: [f], loadJourneys: journeysOf([]) }));
    assertRuleProceed(decide({ skill: 'visual-review', surface: 'backend', files: [f], loadJourneys: journeysOf([]) }));
  }
  assert.equal(gate.pathShapeProblem('tests/a.test.js'), null);
});

test('journeyEntryMatch table', () => {
  assert.equal(gate.journeyEntryMatch('src/*.js', 'src/a.js'), 'match');
  assert.equal(gate.journeyEntryMatch('src/*.js', 'src/sub/a.js'), 'no-match');
  assert.equal(gate.journeyEntryMatch('src/*/a.js', 'src/x/a.js'), 'unmatchable');
  assert.equal(gate.journeyEntryMatch('src/a?.js', 'src/ab.js'), 'unmatchable');
  assert.equal(gate.journeyEntryMatch('src/[ab].js', 'src/a.js'), 'unmatchable');
  assert.equal(gate.journeyEntryMatch('src/**', 'src/a.js'), 'unmatchable');
  assert.equal(gate.journeyEntryMatch('src/a.js', 'src/a.js'), 'match');
  assert.equal(gate.journeyEntryMatch('src/a.js', 'src/b.js'), 'no-match');
  assert.equal(gate.journeyEntryMatch('src/*.js', 'lib/a.js'), 'no-match');
  assert.equal(gate.journeyEntryMatch('src/a+(1).js', 'src/a+(1).js'), 'match');
  assert.equal(gate.journeyEntryMatch('src/a.*', 'src/a.js'), 'match');
  assert.equal(gate.journeyEntryMatch('src/a.*', 'src/aXjs'), 'no-match');
});

// --- unknown inputs ---

test('unknown skill or wrapper mode throws', () => {
  assert.throws(() => decide({ skill: 'nope', files: [] }));
  assert.throws(() => decide({ skill: 'design-wrapper', mode: 'live', files: [] }));
  assert.throws(() => decide({ skill: 'design-wrapper', files: [] }));
});
