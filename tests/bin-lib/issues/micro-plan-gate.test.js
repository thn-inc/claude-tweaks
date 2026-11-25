'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { MICRO_PLAN_CONDITIONS, MAX_IMPLEMENTATION_FILES, countImplementationFiles, evaluateMicroPlanGate } = require('../../../plugin/bin/lib/issues/micro-plan-gate');
const { parseRiskFlags } = require('../../../plugin/bin/lib/issues/record-risk-flags');

const entry = (path, note = '') => ({ path, note });
const keyFiles = (...entries) => ({ entries, unparsed: 0 });
const PASSING = () => ({
  ceremony: 'fast-lane',
  size: 'low',
  keyFileEntries: keyFiles(entry('plugin/bin/x.js', '— change'), entry('tests/x.test.js', '— test')),
  body: '## Current State\n\nRisk-flags: none\n',
});

test('MICRO_PLAN_CONDITIONS is frozen and MAX_IMPLEMENTATION_FILES is 3 (#5463 AC1.1)', () => {
  assert.deepStrictEqual([...MICRO_PLAN_CONDITIONS], ['fast-lane-ceremony', 'low-size', 'implementation-file-limit', 'no-risk-flag']);
  assert.ok(Object.isFrozen(MICRO_PLAN_CONDITIONS));
  assert.strictEqual(MAX_IMPLEMENTATION_FILES, 3);
});

test('countImplementationFiles counts code and prompt prose as 1 each', () => {
  assert.strictEqual(countImplementationFiles([entry('plugin/bin/x.js')]), 1);
  assert.strictEqual(countImplementationFiles([entry('plugin/skills/build/a.md')]), 1);
  assert.strictEqual(countImplementationFiles([entry('plugin/bin/x.js'), entry('plugin/skills/build/a.md')]), 2);
});

test('countImplementationFiles counts tests and docs as 0', () => {
  for (const p of ['tests/x.test.js', 'docs/notes.md', 'docs/plans/diagram.html']) {
    assert.strictEqual(countImplementationFiles([entry(p)]), 0, p);
  }
});

test('countImplementationFiles skips entries whose note marks them read-only (#3696)', () => {
  assert.strictEqual(countImplementationFiles([entry('bin/check-staged-stack.js', '— CLI exit path (read only, no change)')]), 0);
  assert.strictEqual(countImplementationFiles([entry('bin/a.js', '(Read-Only)')]), 0);
  assert.strictEqual(countImplementationFiles([entry('bin/a.js', '— NO CHANGE')]), 0);
  assert.strictEqual(countImplementationFiles([entry('bin/a.js', '— read only')]), 0);
  assert.strictEqual(countImplementationFiles([entry('bin/a.js', '— already changed')]), 1);
  assert.strictEqual(countImplementationFiles([entry('plugin/bin/a.js', '(no change.)')]), 0);
  assert.strictEqual(countImplementationFiles([entry('plugin/bin/a.js', '(no changes)')]), 0);
});

test('countImplementationFiles counts a `no change` that does not end the note or a clause (fails closed)', () => {
  for (const note of [
    '(modify — no change to callers)',
    '(modify — no changes to callers)',
    '(modify — no change other than the import)',
    '(modify — no change of behaviour)',
    '(modify — no change in output format)',
  ]) {
    assert.strictEqual(countImplementationFiles([entry('plugin/bin/a.js', note)]), 1, note);
  }
});

test('the #3696 shape passes the gate: one real file plus a read-only second one', () => {
  const r = evaluateMicroPlanGate({
    ...PASSING(),
    keyFileEntries: keyFiles(entry('plugin/bin/x.js', '— fix'), entry('bin/check-staged-stack.js', '— CLI exit path (read only, no change)')),
  });
  assert.deepStrictEqual(r, { passes: true, failed: [], unreadable: null });
});

test('evaluateMicroPlanGate passes the fast-lane low one-implementation case', () => {
  assert.deepStrictEqual(evaluateMicroPlanGate(PASSING()), { passes: true, failed: [], unreadable: null });
});

test('evaluateMicroPlanGate passes with zero implementation entries', () => {
  const r = evaluateMicroPlanGate({ ...PASSING(), keyFileEntries: keyFiles(entry('tests/x.test.js')) });
  assert.strictEqual(r.passes, true);
});

test('evaluateMicroPlanGate fails fast-lane-ceremony for standard and null', () => {
  for (const ceremony of ['standard', null]) {
    assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), ceremony }), { passes: false, failed: ['fast-lane-ceremony'], unreadable: null });
  }
});

test('evaluateMicroPlanGate fails low-size for medium and null', () => {
  for (const size of ['medium', null]) {
    assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), size }), { passes: false, failed: ['low-size'], unreadable: null });
  }
});

test('evaluateMicroPlanGate passes three implementation entries (#5463 AC1.2)', () => {
  const r = evaluateMicroPlanGate({ ...PASSING(), keyFileEntries: keyFiles(entry('plugin/bin/x.js'), entry('plugin/bin/y.js'), entry('plugin/skills/build/a.md')) });
  assert.deepStrictEqual(r, { passes: true, failed: [], unreadable: null });
});

test('evaluateMicroPlanGate fails implementation-file-limit for four implementation entries (#5463 AC1.3)', () => {
  const r = evaluateMicroPlanGate({
    ...PASSING(),
    keyFileEntries: keyFiles(entry('plugin/bin/x.js'), entry('plugin/bin/y.js'), entry('plugin/bin/z.js'), entry('plugin/skills/build/a.md')),
  });
  assert.deepStrictEqual(r, { passes: false, failed: ['implementation-file-limit'], unreadable: null });
});

test('three implementation entries plus tests and a read-only entry still pass', () => {
  const r = evaluateMicroPlanGate({
    ...PASSING(),
    keyFileEntries: keyFiles(
      entry('plugin/bin/x.js'), entry('plugin/bin/y.js'), entry('plugin/skills/build/a.md'),
      entry('tests/x.test.js'), entry('plugin/bin/w.js', '(read only, no change)'),
    ),
  });
  assert.strictEqual(r.passes, true);
});

test('#5463 AC3.1: the #5396 shape passes: a static config file plus the generator that writes it', () => {
  const entries = [entry('app/Info.plist', '— add one key'), entry('plugin/bin/gen-plist.js', '— write the key')];
  assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), keyFileEntries: keyFiles(...entries) }), { passes: true, failed: [], unreadable: null });
  assert.strictEqual(countImplementationFiles(entries), 2);
});

test('evaluateMicroPlanGate fails no-risk-flag for a flagged body', () => {
  const r = evaluateMicroPlanGate({ ...PASSING(), body: 'Risk-flags: auth\n' });
  assert.deepStrictEqual(r, { passes: false, failed: ['no-risk-flag'], unreadable: null });
});

test('a body with no Risk-flags line carries no risk flag', () => {
  assert.strictEqual(evaluateMicroPlanGate({ ...PASSING(), body: 'no flags here' }).passes, true);
});

test('failed lists every failing condition in MICRO_PLAN_CONDITIONS order', () => {
  const r = evaluateMicroPlanGate({
    ceremony: 'standard', size: 'high',
    keyFileEntries: keyFiles(entry('plugin/bin/x.js'), entry('plugin/bin/y.js'), entry('plugin/bin/z.js'), entry('plugin/skills/build/a.md')),
    body: 'Risk-flags: auth\n',
  });
  assert.deepStrictEqual(r.failed, [...MICRO_PLAN_CONDITIONS]);
  assert.strictEqual(r.passes, false);
});

test('an absent or unparsed Key Files section is unreadable, not a pass', () => {
  assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), keyFileEntries: null }), { passes: false, failed: [], unreadable: 'key-files' });
  const partial = { entries: [entry('plugin/bin/x.js')], unparsed: 1 };
  assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), keyFileEntries: partial }), { passes: false, failed: [], unreadable: 'key-files' });
});

test('a Key Files value whose entries is not a list is unreadable, never a throw', () => {
  for (const entries of ['plugin/bin/x.js', { path: 'plugin/bin/x.js' }, undefined]) {
    assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), keyFileEntries: { entries, unparsed: 0 } }), { passes: false, failed: [], unreadable: 'key-files' });
  }
});

test('a malformed Risk-flags line is unreadable', () => {
  const body = 'Risk_flags: auth\n';
  assert.strictEqual(parseRiskFlags(body).status, 'unknown');
  assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), body }), { passes: false, failed: [], unreadable: 'risk-flags' });
});

test('an unfilled template Key Files section is unreadable (end to end with extractKeyFileEntries)', () => {
  const { extractKeyFileEntries } = require('../../../plugin/bin/lib/issues/grouping');
  const keyFileEntries = extractKeyFileEntries('### Key Files\n\n- `{path}` — {what changes}\n');
  assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), keyFileEntries }), { passes: false, failed: [], unreadable: 'key-files' });
});

test('a non-string body fails closed as unreadable risk-flags', () => {
  for (const body of [undefined, null, 42, {}]) {
    assert.deepStrictEqual(evaluateMicroPlanGate({ ...PASSING(), body }), { passes: false, failed: [], unreadable: 'risk-flags' });
  }
});

test('an unreadable input still reports the other failing conditions', () => {
  assert.deepStrictEqual(
    evaluateMicroPlanGate({ ...PASSING(), ceremony: 'standard', keyFileEntries: null }),
    { passes: false, failed: ['fast-lane-ceremony'], unreadable: 'key-files' },
  );
});

test('when Key Files and risk flags are both unreadable, key-files is reported', () => {
  const r = evaluateMicroPlanGate({ ...PASSING(), keyFileEntries: null, body: 'Risk_flags: auth\n' });
  assert.deepStrictEqual(r, { passes: false, failed: [], unreadable: 'key-files' });
});
