'use strict';
// relaunch.js: the implementer relaunch decision and prompt text (#5997).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');

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
    (e) => e.code === MODEL_REFUSED_CODE && e.message.startsWith('no model for driver role implementer: implementer-tier')
      && e.message.split('implementer-tier:').length === 2,
  );
});

test('relaunchNote names trigger and both profiles', () => {
  assert.strictEqual(relaunchNote({ trigger: 'red-tests', from: 'fast', to: 'standard' }), 'after one relaunch (red-tests, fast to standard)');
  // A refused plan has no profile to step up to: its null `to` reads as no profile.
  assert.strictEqual(relaunchNote({ trigger: 'cannot-complete', from: 'fast', to: null }), 'after one relaunch (cannot-complete, fast to no profile)');
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
  // Every path reads as a valid red report, so only the string guard on reportPath can yield null.
  const anyReport = (events) => ({ readFile: (p) => (String(p).endsWith('events.jsonl') ? events : REPORT_TEXT) });
  assert.strictEqual(call(anyReport(events({ type: 'verify', reportPath: 5 }))), null, 'reportPath not a string');
  assert.ok(call(anyReport(events({ type: 'verify', reportPath: '/r.json' }))), 'control: a string reportPath reads');
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

test('failingTests: a file named by two failed checks is listed once, first seen first', () => {
  const report = JSON.stringify({ checks: {
    a: { exitCode: 1, failingRegion: '✖ failing tests:\n\ntest at b.test.js:1:1\n✖ one\n\ntest at a.test.js:2:2\n✖ two\n' },
    b: { exitCode: 2, failingRegion: '✖ failing tests:\n\ntest at a.test.js:3:3\n✖ three\n\ntest at c.test.js:4:4\n✖ four\n' },
  } });
  assert.deepStrictEqual(call(withReport(report)).files, ['b.test.js', 'a.test.js', 'c.test.js']);
});

test('failingTests: a readable report naming no placeable file returns files: [], not null', () => {
  const r = call(withReport(reportWith('not ok 1 - adds\nboom')));
  assert.deepStrictEqual(r, { files: [], lines: ['not ok 1 - adds', 'boom'] });
});

test('redTestsPrompt(null) is the fixed text with no report-shaped words', () => {
  const p = redTestsPrompt(null);
  assert.strictEqual(p, 'Relaunch. Your first attempt is committed, and the driver\'s test step found failing tests, but the driver could not read which ones. Run the tests that cover your change to find them, then fix the code inside the Key Files and the limits above, and report the commit title and summary of this fix alone.');
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
  assert.ok(between(p).endsWith('\n[failure output truncated]'));
  assert.ok(!redTestsPrompt({ files: [], lines: ['short'] }).includes('truncated'));
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

// --- the effort ladder (#6002): planRelaunch under `ladder: true` ---------------------------------
// A roleLaunch stand-in: standard at medium, capable at max (clamped to high by nextAttempt).
const LADDER_LAUNCH = { fast: { model: M('fast'), effort: null }, standard: { model: M('standard'), effort: 'medium' }, capable: { model: M('capable'), effort: 'max' } };
const ladderLaunch = (table = LADDER_LAUNCH) => (_role, _policy, { profile }) => {
  if (!Object.hasOwn(table, profile)) { const e = new Error('x'); e.code = MODEL_REFUSED_CODE; throw e; }
  return table[profile];
};
const ladderPlan = (over, table) => planRelaunch({ model: M('standard'), policy: {}, ladder: true, ...over }, { roleLaunchFn: ladderLaunch(table) });

test('planRelaunch (ladder): a first red run steps effort on the same profile', () => {
  assert.deepStrictEqual(ladderPlan({ profile: 'standard', effort: 'low', escalations: 0, trigger: 'red-tests' }), { relaunch: true, to: 'standard', effort: 'medium', escalations: 1 });
});

test('planRelaunch (ladder): the second escalation steps the profile at its launchEffort, clamped to high', () => {
  assert.deepStrictEqual(ladderPlan({ profile: 'standard', effort: 'medium', escalations: 1, trigger: 'red-tests' }), { relaunch: true, to: 'capable', effort: 'high', escalations: 2 });
  assert.deepStrictEqual(ladderPlan({ profile: 'standard', effort: 'low', escalations: 0, trigger: 'cannot-complete' }), { relaunch: true, to: 'capable', effort: 'high', escalations: 1 });
});

test('planRelaunch (ladder): no profile above reads as no-step-up with today\'s note', () => {
  const r = ladderPlan({ profile: 'capable', model: M('capable'), effort: 'high', escalations: 1, trigger: 'red-tests' });
  assert.deepStrictEqual(r, { relaunch: false, noRelaunch: 'no-step-up', note: 'no relaunch: no profile above capable' });
});

test('planRelaunch (ladder): a step-up resolving to the same model reads as clamped with today\'s note', () => {
  const r = ladderPlan({ profile: 'standard', effort: 'medium', escalations: 1, trigger: 'red-tests' }, { ...LADDER_LAUNCH, capable: { model: M('standard'), effort: 'medium' } });
  assert.deepStrictEqual(r, { relaunch: false, noRelaunch: 'clamped', note: `no relaunch: capable resolves to ${M('standard')}, the first attempt's model` });
});

test('planRelaunch (ladder): an unresolvable step-up still relaunches (its launch refuses itself)', () => {
  const { capable, ...rest } = LADDER_LAUNCH;
  assert.deepStrictEqual(ladderPlan({ profile: 'standard', effort: 'low', escalations: 0, trigger: 'cannot-complete' }, rest), { relaunch: true, to: 'capable', effort: null, escalations: 1 });
});

test('planRelaunch (ladder): an unknown profile refuses as DRIVER_MODEL_REFUSED', () => {
  assert.throws(() => ladderPlan({ profile: 'turbo', effort: 'low', escalations: 0, trigger: 'red-tests' }), (e) => e.code === MODEL_REFUSED_CODE && e.message.startsWith('no model for driver role implementer: implementer-tier'));
});

test('planRelaunch (inherit): ladder false keeps today\'s result, no effort or escalations', () => {
  const r = planRelaunch({ profile: 'standard', model: M('standard'), effort: 'low', escalations: 0, trigger: 'red-tests', policy: {}, ladder: false }, { roleLaunchFn: ladderLaunch() });
  assert.deepStrictEqual(r, { relaunch: true, to: 'capable' });
});

test('relaunchNote (ladder): each side renders profile@effort, two relaunches joined', () => {
  const one = { history: [{ trigger: 'red-tests', from: 'standard', to: 'standard', fromEffort: 'low', toEffort: 'medium' }] };
  assert.strictEqual(relaunchNote(one), 'after one relaunch (red-tests, standard@low to standard@medium)');
  const two = { history: [...one.history, { trigger: 'red-tests', from: 'standard', to: 'capable', fromEffort: 'medium', toEffort: 'medium' }] };
  assert.strictEqual(relaunchNote(two), 'after two relaunches (red-tests, standard@low to standard@medium; red-tests, standard@medium to capable@medium)');
  // A null effort renders the profile alone, so an inherit history reads as today's note.
  assert.strictEqual(relaunchNote({ history: [{ trigger: 'red-tests', from: 'fast', to: 'standard', fromEffort: null, toEffort: null }] }), 'after one relaunch (red-tests, fast to standard)');
  assert.strictEqual(relaunchNote({ history: [{ trigger: 'cannot-complete', from: 'fast', to: null, fromEffort: null, toEffort: null }] }), 'after one relaunch (cannot-complete, fast to no profile)');
});

test('the attempt-3 prompts say "previous attempt"; attempt 2 is byte-identical to the default', () => {
  const failing = { files: ['a.test.js'], lines: ['not ok 1'] };
  assert.strictEqual(redTestsPrompt(failing, { attempt: 2 }), redTestsPrompt(failing));
  assert.strictEqual(redTestsPrompt(null, { attempt: 2 }), redTestsPrompt(null));
  assert.strictEqual(cannotCompletePrompt('x', { attempt: 2 }), cannotCompletePrompt('x'));
  for (const p of [redTestsPrompt(failing, { attempt: 3 }), redTestsPrompt(null, { attempt: 3 }), cannotCompletePrompt('x', { attempt: 3 })]) {
    assert.ok(p.includes('Your previous attempt') && !p.includes('Your first attempt'), p);
  }
  assert.strictEqual(redTestsPrompt(failing, { attempt: 3 }), redTestsPrompt(failing).replace('Your first attempt', 'Your previous attempt'));
  assert.strictEqual(cannotCompletePrompt('x', { attempt: 3 }), cannotCompletePrompt('x').replace('Your first attempt', 'Your previous attempt'));
});

test('header lists the three outcomes and never requires steps.js', () => {
  const src = readText(path.join(lib, 'driver', 'relaunch.js'));
  const header = src.split('\n').filter((l) => l.startsWith('//')).join('\n');
  for (const word of ['relaunch: true', 'no-step-up', 'clamped', 'never requires `steps.js`']) assert.ok(header.includes(word), word);
  // The require check reads code only (bin-source-scan-conformance): a comment naming steps.js is not a require.
  const code = stripComments(src);
  const verdict = stripperVerdict(src, code);
  assert.equal(verdict, 'ok', STRIPPER_VERDICT_MESSAGES[verdict]);
  assert.ok(!/require\([^)]*steps/.test(code));
});
