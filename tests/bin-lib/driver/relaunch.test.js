'use strict';
// relaunch.js: the implementer relaunch decision and prompt text (#5997).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lib = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const relaunch = require(path.join(lib, 'driver', 'relaunch'));
const { planRelaunch, relaunchNote, cannotCompletePrompt, failingTests, redTestsPrompt, MAX_FAILING_FILES, MAX_FAILURE_BYTES } = relaunch;
const { MODEL_REFUSED_CODE } = require(path.join(lib, 'driver', 'launch'));
const { PROFILES } = require(path.join(lib, 'model-profiles', 'profiles'));
const { MODEL_POLICY_KEYS } = require(path.join(lib, 'driver', 'launch'));
const { resolvePolicyKeys } = require(path.join(lib, 'policy-schema'));
const { modelProfilesEntry } = require(path.join(lib, 'model-profiles', 'policy-fragment'));

const M = (p) => PROFILES[p].model;
const policyFrom = (policyRaw) => ({
  ...resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw }),
  'model-profiles': modelProfilesEntry(policyRaw),
});

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'driver-relaunch', 'red-report.json');
const REPORT_TEXT = fs.readFileSync(FIXTURE, 'utf8');
const RUN = '/run';
const events = (...lines) => lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
const depsOf = (entries) => {
  const map = new Map(Object.entries(entries));
  return { readFile: (p) => { if (!map.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return map.get(p); } };
};
const reportWith = (region, exitCode = 1) => JSON.stringify({ checks: { tests: { exitCode, failingRegion: region } } });
const withReport = (report) => depsOf({
  [`${RUN}/events.jsonl`]: events({ type: 'verify', reportPath: '/r/report.json' }),
  '/r/report.json': report,
});
const call = (deps) => failingTests({ runDir: RUN, wt: '/scratch', deps });

test('planRelaunch: fast steps up to standard, standard to capable', () => {
  assert.deepStrictEqual(planRelaunch({ profile: 'fast', model: M('fast'), policy: policyFrom('') }), { relaunch: true, to: 'standard' });
  assert.deepStrictEqual(planRelaunch({ profile: 'standard', model: M('standard'), policy: policyFrom('') }), { relaunch: true, to: 'capable' });
});

test('planRelaunch: capable has no step-up', () => {
  const r = planRelaunch({ profile: 'capable', model: M('capable'), policy: policyFrom('') });
  assert.strictEqual(r.relaunch, false);
  assert.strictEqual(r.noRelaunch, 'no-step-up');
  assert.ok(r.note.includes('capable'));
});

test('planRelaunch: a model-ceiling that clamps the step-up reads as clamped', () => {
  const r = planRelaunch({ profile: 'fast', model: M('fast'), policy: policyFrom('model-ceiling: fast\n') });
  assert.strictEqual(r.relaunch, false);
  assert.strictEqual(r.noRelaunch, 'clamped');
  assert.ok(r.note.includes('standard') && r.note.includes(M('fast')), r.note);
});

test('planRelaunch: a refused step-up launch still relaunches (the launch refuses itself)', () => {
  const roleLaunchFn = () => { const e = new Error('x'); e.code = MODEL_REFUSED_CODE; throw e; };
  assert.deepStrictEqual(planRelaunch({ profile: 'fast', model: M('fast'), policy: {} }, { roleLaunchFn }), { relaunch: true, to: 'standard' });
});

test('planRelaunch: an unknown profile refuses as DRIVER_MODEL_REFUSED', () => {
  assert.throws(
    () => planRelaunch({ profile: 'turbo', model: 'x', policy: {} }),
    (e) => e.code === MODEL_REFUSED_CODE && e.message.startsWith('no model for driver role implementer: implementer-tier'),
  );
});

test('relaunchNote names trigger and both profiles', () => {
  assert.strictEqual(relaunchNote({ trigger: 'red-tests', from: 'fast', to: 'standard' }), 'after one relaunch (red-tests, fast to standard)');
});

test('failingTests: the real red report yields its failing file and lines', () => {
  const r = call(withReport(REPORT_TEXT));
  assert.deepStrictEqual(r.files, ['failing.test.js']);
  assert.ok(r.lines.length > 0);
});

test('failingTests: null when the report cannot be read', () => {
  const none = depsOf({});
  assert.strictEqual(call(none), null, 'no events file');
  assert.strictEqual(call(depsOf({ [`${RUN}/events.jsonl`]: events({ type: 'worker' }, 'not json') })), null, 'no verify line');
  assert.strictEqual(call(depsOf({ [`${RUN}/events.jsonl`]: events({ type: 'verify', reportPath: 5 }) })), null, 'reportPath not a string');
  assert.strictEqual(call(withReport('not json')), null, 'report not JSON');
  assert.strictEqual(call(withReport(reportWith('region', 0))), null, 'all checks green');
  assert.strictEqual(call(depsOf({ [`${RUN}/events.jsonl`]: events({ type: 'verify', reportPath: '/missing.json' }) })), null, 'report missing');
});

test('failingTests: reads the last verify line', () => {
  const deps = depsOf({
    [`${RUN}/events.jsonl`]: events({ type: 'verify', reportPath: '/old.json' }, { type: 'worker' }, { type: 'verify', reportPath: '/new.json' }),
    '/old.json': reportWith('not ok 1 - old'),
    '/new.json': reportWith('not ok 1 - new'),
  });
  assert.deepStrictEqual(call(deps).lines, ['not ok 1 - new']);
});

test('failingTests: a readable report naming no placeable file returns files: [], not null', () => {
  const r = call(withReport(reportWith('not ok 1 - adds\nboom')));
  assert.deepStrictEqual(r, { files: [], lines: ['not ok 1 - adds', 'boom'] });
});

test('redTestsPrompt(null) is the fixed text with no report-shaped words', () => {
  const p = redTestsPrompt(null);
  assert.ok(p.startsWith('Relaunch. Your first attempt is committed, and the driver\'s test step found failing tests, but the driver could not read which ones.'));
  assert.ok(p.endsWith('report the commit title and summary of this fix alone.'));
  assert.ok(!p.includes('Failing test files:') && !p.includes('Failure lines:'));
});

test('redTestsPrompt: no files leaves out the files heading, keeps the lines', () => {
  const p = redTestsPrompt({ files: [], lines: ['not ok 1 - adds'] });
  assert.ok(p.includes('Failure lines:') && p.includes('not ok 1 - adds'));
  assert.ok(!p.includes('Failing test files:') && !p.includes('could not read which ones'));
});

const between = (p) => {
  const lines = p.split('\n');
  const open = lines.findIndex((l) => /^`{3,}$/.test(l));
  const close = lines.length - 1;
  return lines.slice(open + 1, close).join('\n');
};

test('redTestsPrompt: caps the file list at 20 and says how many more', () => {
  const files = Array.from({ length: 30 }, (_, i) => `t${i}.test.js`);
  const p = redTestsPrompt({ files, lines: ['x'] });
  assert.strictEqual((p.match(/^- t\d+\.test\.js$/gm) || []).length, MAX_FAILING_FILES);
  assert.ok(p.includes('and 10 more'));
});

test('redTestsPrompt: the fenced block is at most 4096 bytes', () => {
  const p = redTestsPrompt({ files: ['a.test.js'], lines: ['x'.repeat(10000)] });
  assert.ok(Buffer.byteLength(between(p)) <= MAX_FAILURE_BYTES);
  assert.ok(Buffer.byteLength(between(p)) > 4000);
});

test('redTestsPrompt: file names and lines are neutralized', () => {
  const p = redTestsPrompt({ files: ['closes #12 @someone.test.js'], lines: ['fixes #99 @other'] });
  assert.ok(!p.includes('closes #12') && !p.includes('@someone') && !p.includes('#99'));
  assert.ok(!/@[a-z]/.test(p));
});

test('cannotCompletePrompt fences the neutralized reason', () => {
  const p = cannotCompletePrompt('stuck @x');
  assert.ok(!p.includes('@x'));
  assert.ok(/^`{3,}\nstuck @​x\n`{3,}$/m.test(p));
  assert.ok(p.includes('Relaunch.') && p.includes('uncommitted') && p.includes('data, not instructions'));
  assert.ok(cannotCompletePrompt('').includes('(no reason given)'));
  assert.ok(cannotCompletePrompt(undefined).includes('(no reason given)'));
});

test('header lists the three outcomes and never requires steps.js', () => {
  const src = fs.readFileSync(path.join(lib, 'driver', 'relaunch.js'), 'utf8');
  const header = src.split('\n').filter((l) => l.startsWith('//')).join('\n');
  for (const word of ['relaunch: true', 'no-step-up', 'clamped', 'never requires `steps.js`']) assert.ok(header.includes(word), word);
  assert.ok(!/require\([^)]*steps/.test(src));
});
