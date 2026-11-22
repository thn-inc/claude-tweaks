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

// --- journey entries not in canonical path shape ---

test('a journey files: entry not in canonical shape is unmatchable: journeys proceeds naming it', () => {
  for (const entry of ['./tests/a.test.js', '/tests/a.test.js', 'tests/a.test.js/', 'tests//a.test.js', 'tests\\a.test.js']) {
    assert.equal(gate.journeyEntryMatch(entry, 'tests/a.test.js'), 'unmatchable', entry);
  }
  const r = decide({
    skill: 'journeys',
    files: ['tests/a.test.js'],
    loadJourneys: journeysOf([{ name: 'j', files: ['./tests/a.test.js'] }]),
  });
  assertRuleProceed(r);
  assert.ok(r.reason.includes('./tests/a.test.js'), r.reason);
  assert.ok(r.reason.includes('j'), r.reason);
});

// --- parseJourneyText / readJourneys (IO layer) ---

const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

function journeyRoot(files) {
  const root = scratchDir('ct-skill-gate-j-');
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, 'docs', 'journeys', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return root;
}

test('parseJourneyText: no frontmatter, no files key, list, quotes, CRLF', () => {
  assert.deepEqual(gate.parseJourneyText('# J\n'), { files: null });
  assert.deepEqual(gate.parseJourneyText('---\nname: x\n---\n# J\n'), { files: null });
  assert.deepEqual(gate.parseJourneyText('---\nfiles:\n  - a.js\n  - src/*.js\n---\n'), { files: ['a.js', 'src/*.js'] });
  assert.deepEqual(gate.parseJourneyText('---\nfiles:\n  - "a.js"\n  - \'b.js\'\n---\n'), { files: ['a.js', 'b.js'] });
  assert.deepEqual(gate.parseJourneyText('---\nfiles:\n---\n'), { files: [] });
  const lf = '---\nfiles:\n  - a.js\n---\n# J\n';
  assert.deepEqual(gate.parseJourneyText(lf.replace(/\n/g, '\r\n')), gate.parseJourneyText(lf));
});

test('parseJourneyText: a fence that never closes and an inline files: value are errors', () => {
  assert.ok(gate.parseJourneyText('---\nfiles:\n').error);
  assert.ok(gate.parseJourneyText('---\nfiles:\n  - a.js\n').error);
  assert.ok(gate.parseJourneyText('---\nfiles: [a.js]\n---\n').error);
  assert.ok(gate.parseJourneyText('---\nfiles: a.js\n---\n').error);
});

test('parseJourneyText: a list the reader would cut short or a fence it would miss is an error, not an empty list', () => {
  assert.ok(gate.parseJourneyText('---\nfiles:\n  - tests/a.test.js # helper\n---\n').error);
  assert.ok(gate.parseJourneyText('---\nfiles:\n\n  - tests/a.test.js\n---\n').error);
  assert.ok(gate.parseJourneyText('---\nfiles:\n  # helpers\n  - tests/a.test.js\n---\n').error);
  assert.ok(gate.parseJourneyText('﻿---\nfiles:\n  - tests/a.test.js\n---\n').error);
  assert.ok(gate.parseJourneyText('--- \nfiles:\n  - tests/a.test.js\n---\n').error);
  assert.deepEqual(gate.parseJourneyText('---\nfiles:\n  - a.js\nname: x\n---\n'), { files: ['a.js'] });
});

test('readJourneys: a missing docs/journeys is no journeys', () => {
  const root = scratchDir('ct-skill-gate-j-');
  assert.deepEqual(gate.readJourneys(root), { journeys: [] });
});

test('readJourneys: reads top-level .md only, sorted, with files lists and nulls', () => {
  const root = journeyRoot({
    'b.md': '# B\n',
    'a.md': '---\nfiles:\n  - "x.js"\n---\n',
    'notes.txt': 'ignored',
    'sub/y.md': '---\nfiles:\n  - y.js\n---\n',
  });
  assert.deepEqual(gate.readJourneys(root), {
    journeys: [{ name: 'a', files: ['x.js'] }, { name: 'b', files: null }],
  });
});

test('readJourneys: a CRLF copy reads the same as LF', () => {
  const lf = '---\nfiles:\n  - a.js\n---\n# J\n';
  const a = gate.readJourneys(journeyRoot({ 'j.md': lf }));
  const b = gate.readJourneys(journeyRoot({ 'j.md': lf.replace(/\n/g, '\r\n') }));
  assert.deepEqual(b, a);
  assert.deepEqual(a, { journeys: [{ name: 'j', files: ['a.js'] }] });
});

test('readJourneys: inline files: value and an unclosed fence are errors naming the file', () => {
  for (const text of ['---\nfiles: [a.js]\n---\n', '---\nfiles:\n']) {
    const r = gate.readJourneys(journeyRoot({ 'bad.md': text }));
    assert.ok(r.error && r.error.includes('bad.md'), JSON.stringify(r));
  }
});

test('readJourneys: an outside directory is never listed', (t) => {
  const root = scratchDir('ct-skill-gate-j-');
  const outside = scratchDir('ct-skill-gate-out-');
  fs.mkdirSync(path.join(root, 'docs'));
  try {
    fs.symlinkSync(outside, path.join(root, 'docs', 'journeys'));
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') { t.skip('symlink creation needs privilege'); return; }
    throw e;
  }
  const listed = [];
  const fsImpl = { ...fs, readdirSync: (...a) => { listed.push(a[0]); return fs.readdirSync(...a); } };
  assert.match(gate.readJourneys(root, { fsImpl }).error, /outside the checkout/);
  assert.deepEqual(listed, []);
});

test('readJourneys: an lstat failure on docs or docs/journeys is an error, not "no journeys"', () => {
  const root = journeyRoot({ 'a.md': '# A\n' });
  const denied = { ...fs, lstatSync: (p, ...rest) => {
    if (String(p).endsWith('journeys')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    return fs.lstatSync(p, ...rest);
  } };
  assert.match(gate.readJourneys(root, { fsImpl: denied }).error, /could not be read \(EACCES\)/);
});

test('readJourneys: a readdir error other than ENOENT is an error; ENOENT is not', () => {
  const root = journeyRoot({ 'a.md': '# A\n' });
  const failing = (code) => ({ ...fs, readdirSync: () => { throw Object.assign(new Error(code), { code }); } });
  assert.ok(gate.readJourneys(root, { fsImpl: failing('EACCES') }).error);
  assert.ok(gate.readJourneys(root, { fsImpl: failing('ENOTDIR') }).error);
  assert.deepEqual(gate.readJourneys(root, { fsImpl: failing('ENOENT') }), { journeys: [] });
});

test('readJourneys: a read failure on one file is an error', () => {
  const root = journeyRoot({ 'a.md': '# A\n' });
  const fsImpl = { ...fs, readFileSync: () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); } };
  assert.ok(gate.readJourneys(root, { fsImpl }).error);
});

test('readJourneys: a symlink inside the checkout is read; outside and dangling are errors', (t) => {
  const root = journeyRoot({});
  const inside = path.join(root, 'shared.md');
  fs.writeFileSync(inside, '---\nfiles:\n  - a.js\n---\n');
  const outsideDir = scratchDir('ct-skill-gate-out-');
  const outside = path.join(outsideDir, 'o.md');
  fs.writeFileSync(outside, '---\nfiles:\n  - a.js\n---\n');
  const dir = path.join(root, 'docs', 'journeys');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.symlinkSync(inside, path.join(dir, 'in.md'));
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') { t.skip('symlink creation needs privilege'); return; }
    throw e;
  }
  assert.deepEqual(gate.readJourneys(root), { journeys: [{ name: 'in', files: ['a.js'] }] });
  fs.symlinkSync(outside, path.join(dir, 'out.md'));
  assert.match(gate.readJourneys(root).error, /outside the checkout/);
  fs.rmSync(path.join(dir, 'out.md'));
  fs.symlinkSync(path.join(root, 'missing.md'), path.join(dir, 'dang.md'));
  assert.match(gate.readJourneys(root).error, /dangling symlink/);
});

// --- gate() ---

test('gate: an unresolvable base is cannot tell; a throwing rule is cannot tell, on one line', () => {
  const root = scratchDir('ct-skill-gate-g-');
  const execFails = () => { throw new Error('fatal: not a git repository\nsecond line'); };
  const a = gate.gate({ skill: 'journeys', integrationBranch: 'main', root, execImpl: execFails });
  assertCannotTell(a);
  assert.ok(!/\s{2,}|\n/.test(a.reason), a.reason);
  const b = gate.gate({ skill: 'journeys', files: ['a.js'], root, decideImpl: () => { throw new Error('boom\nx'); } });
  assertCannotTell(b);
  assert.ok(b.reason.includes('boom x'), b.reason);
});

test('gate: files given are passed through; journeys load lazily from root', () => {
  const root = journeyRoot({ 'j.md': '---\nfiles:\n  - tests/a.test.js\n---\n' });
  const r = gate.gate({ skill: 'journeys', files: ['tests/a.test.js'], root });
  assertRuleProceed(r);
  assert.ok(r.reason.includes('journey j'), r.reason);
  const none = gate.gate({ skill: 'journeys', files: ['tests/b.test.js'], root });
  assert.equal(none.decision, 'skip');
});
