'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const { expressQueuePolicy } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'express', 'queue.js'));

const BODY = [
  '## Current State', '', 'The template lacks a line.', '',
  '## Deliverables', '', '- Add the line.', '',
  '## Acceptance Criteria', '', '- The line is present.', '',
  '## Release Note', '', 'Adds a line.', '',
  '## Technical Approach', '', '### Key Files', '',
  '- `plugin/skills/init/claude-md-template.md` (modify)', '',
].join('\n');

function issue(number, labels = ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task']) {
  return { number, body: BODY, labels: labels.map((name) => ({ name })) };
}

const ELIGIBLE = issue(1);
const MEDIUM_RISK = issue(2, ['risk:medium', 'size:low', 'ceremony:fast-lane', 'type:task']);

function policy(values) {
  const calls = [];
  const resolvePolicy = (keys, opts) => {
    calls.push({ keys, opts });
    // The real resolver always returns a value for express-driver (default off).
    return Object.fromEntries(keys.map((k) => [k, { value: k === 'express-driver' && !(k in values) ? 'off' : values[k], source: 'policy' }]));
  };
  return { resolvePolicy, calls };
}

function stderrSink() {
  const lines = [];
  return { lines, stderr: (s) => lines.push(s) };
}

test('express-lane false: keepSingleton is false for an eligible record and grouping is per-record', () => {
  const { resolvePolicy, calls } = policy({ 'express-lane': false, 'express-driver': 'off', 'integration-model': 'pr-first', 'merge-sensitive-paths': [] });
  const p = expressQueuePolicy({ resolvePolicy });
  assert.equal(p.enabled, false);
  assert.equal(p.grouping, 'per-record');
  assert.equal(p.keepSingleton(ELIGIBLE), false);
  // A disabled lane must not resolve integration-model (an unpinned one probes `gh repo view`).
  assert.deepStrictEqual(calls.map((c) => c.keys), [['express-lane', 'express-driver', 'dispatch-fastlane-bundle-cap', 'work-links']]);
});

test('express-lane true + pr-first: eligible stays a singleton, risk:medium does not, grouping is per-record+express', () => {
  const { resolvePolicy, calls } = policy({
    'express-lane': true, 'express-driver': 'off', 'integration-model': 'pr-first', 'merge-sensitive-paths': [],
    'express-driver-max-size': 'low', 'express-driver-max-key-files': 1, 'express-driver-review': 'beyond-express',
  });
  const p = expressQueuePolicy({ resolvePolicy });
  assert.equal(p.enabled, true);
  assert.equal(p.grouping, 'per-record+express');
  assert.equal(p.keepSingleton(ELIGIBLE), true);
  assert.equal(p.keepSingleton(MEDIUM_RISK), false);
  assert.deepStrictEqual(calls.map((c) => c.keys), [['express-lane', 'express-driver', 'dispatch-fastlane-bundle-cap', 'work-links'], ['integration-model', 'merge-sensitive-paths', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-risk', 'express-driver-review']]);
});

test('express-lane true + local-merge: the integration model is passed through, so nothing stays a singleton', () => {
  const { resolvePolicy } = policy({ 'express-lane': true, 'integration-model': 'local-merge', 'merge-sensitive-paths': [] });
  assert.equal(expressQueuePolicy({ resolvePolicy }).keepSingleton(ELIGIBLE), false);
});

test('merge-sensitive-paths as a comma string is normalized to a list', () => {
  const { resolvePolicy } = policy({ 'express-lane': true, 'integration-model': 'pr-first', 'merge-sensitive-paths': 'docs/**, plugin/skills/init/claude-md-template.md' });
  assert.equal(expressQueuePolicy({ resolvePolicy }).keepSingleton(ELIGIBLE), false);
});

test('a throwing resolvePolicy behaves as disabled with exactly one stderr line', () => {
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy: () => { throw new Error('policy.yml unreadable'); }, stderr: sink.stderr });
  assert.equal(p.enabled, false);
  assert.equal(p.grouping, 'per-record');
  assert.equal(p.keepSingleton(ELIGIBLE), false);
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /policy\.yml unreadable/);
  assert.ok(sink.lines[0].endsWith('\n') && sink.lines[0].indexOf('\n') === sink.lines[0].length - 1);
});

test('a throwing eligibility check keeps the record bundleable, with exactly one stderr line', () => {
  const { resolvePolicy } = policy({ 'express-lane': true, 'integration-model': 'pr-first', 'merge-sensitive-paths': [] });
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy, stderr: sink.stderr });
  const malformed = { number: 7, body: BODY, get labels() { throw new Error('labels unreadable'); } };
  assert.equal(p.keepSingleton(malformed), false);
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /#7/);
  assert.match(sink.lines[0], /labels unreadable/);
  assert.ok(sink.lines[0].endsWith('\n') && sink.lines[0].indexOf('\n') === sink.lines[0].length - 1);
  assert.equal(p.keepSingleton(ELIGIBLE), true);
});

test('loading queue.js does not load the express CLI module (the queue-pull path stays light)', () => {
  const queue = path.join(ROOT, 'plugin', 'bin', 'lib', 'express', 'queue.js');
  const probe = 'require(process.argv[1]); console.log(Object.keys(require.cache).some((k) => /express[\\\\/]cli\\.js$/.test(k)));';
  const out = execFileSync(process.execPath, ['-e', probe, queue], { encoding: 'utf8' });
  assert.equal(out.trim(), 'false');
  const driverProbe = 'require(process.argv[1]); console.log(Object.keys(require.cache).some((k) => /driver[\\\\/](steps|budget|admission|review)\\.js$/.test(k)));';
  const driverOut = execFileSync(process.execPath, ['-e', driverProbe, queue], { encoding: 'utf8' });
  assert.equal(driverOut.trim(), 'false');
});

// Two Key Files, none protected or merge-sensitive (AC1's records).
const BODY_TWO_KEYS = BODY.replace(
  '- `plugin/skills/init/claude-md-template.md` (modify)',
  '- `plugin/skills/init/claude-md-template.md` (modify)\n- `plugin/skills/init/rules-template.md` (modify)',
);
const FAST_MEDIUM = ['risk:low', 'size:medium', 'ceremony:fast-lane', 'type:task'];
const medium = (number, labels = FAST_MEDIUM) => ({ number, body: BODY_TWO_KEYS, labels: labels.map((name) => ({ name })) });
const DRIVER_POLICY = {
  'express-lane': true, 'express-driver': 'on', 'integration-model': 'pr-first', 'merge-sensitive-paths': [],
  'express-driver-max-size': 'medium', 'express-driver-max-key-files': 3, 'express-driver-review': 'beyond-express',
};
const groupsOf = (records, values) => {
  const { buildDispatchGroups } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'grouping.js'));
  return buildDispatchGroups(records, { bundleCap: 3, keepSingleton: expressQueuePolicy({ resolvePolicy: policy(values).resolvePolicy }).keepSingleton });
};
const numbers = (r) => r.groups.map((g) => g.map((i) => i.number));

test('AC1.1, AC1.2: express-driver on + max-size medium keeps three size:medium fast-lane records as singletons; off bundles them', () => {
  const recs = [medium(20), medium(21), medium(22)];
  const on = groupsOf(recs, DRIVER_POLICY);
  assert.deepEqual(numbers(on), [[20], [21], [22]]);
  assert.deepEqual(on.bundles, []);
  const off = groupsOf(recs, { ...DRIVER_POLICY, 'express-driver': 'off' });
  assert.deepEqual(numbers(off), [[20, 21, 22]]);
  assert.equal(off.bundles.length, 1);
});

test('AC2.1: express-lane false + express-driver on still keeps them; enabled is false, grouping is per-record+driver', () => {
  const values = { ...DRIVER_POLICY, 'express-lane': false };
  assert.deepEqual(numbers(groupsOf([medium(20), medium(21), medium(22)], values)), [[20], [21], [22]]);
  const p = expressQueuePolicy({ resolvePolicy: policy(values).resolvePolicy });
  assert.equal(p.enabled, false);
  assert.equal(p.grouping, 'per-record+driver');
});

test('AC3.1, AC3.2: express-driver split keeps even #10 and bundles odd #11', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver': 'split' }).resolvePolicy });
  assert.equal(p.keepSingleton(medium(10)), true);
  assert.equal(p.keepSingleton(medium(11)), false);
});

test('AC4.1: express-driver-review off bundles a size:medium record (reviewerGateReason refuses it)', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver-review': 'off' }).resolvePolicy });
  assert.equal(p.keepSingleton(medium(20)), false);
  // Discrimination: the same record with the reviewer on is kept, so only the reviewer gate decides.
  assert.equal(expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy }).keepSingleton(medium(20)), true);
});

test('AC5.1: a record both lanes refuse (size:high, or a protected Key File) is bundled exactly as today', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy });
  assert.equal(p.keepSingleton(medium(20, ['risk:low', 'size:high', 'ceremony:fast-lane', 'type:task'])), false);
  const protectedBody = { number: 22, body: BODY_TWO_KEYS.replace('plugin/skills/init/rules-template.md', 'plugin/skills/_shared/ledger-format.md'), labels: FAST_MEDIUM.map((name) => ({ name })) };
  assert.equal(p.keepSingleton(protectedBody), false);
});

test('AC6.1: with the driver half on, grouping differs from per-record and per-record+express', () => {
  const g = expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy }).grouping;
  assert.equal(g, 'per-record+express+driver');
  assert.notEqual(g, 'per-record');
  assert.notEqual(g, 'per-record+express');
});

test('AC7.1: a resolver that throws on the first or the second call disables both halves with exactly one stderr line naming the failed read', () => {
  for (const [failOn, named, notNamed] of [[1, /\(express-lane, express-driver, dispatch-fastlane-bundle-cap, work-links\)/, /express-driver-review/], [2, /express-driver-review/, /\(express-lane, express-driver, dispatch-fastlane-bundle-cap, work-links\)/]]) {
    let n = 0;
    const resolvePolicy = (keys) => {
      n += 1;
      if (n === failOn) throw new Error('policy.yml unreadable');
      return Object.fromEntries(keys.map((k) => [k, { value: DRIVER_POLICY[k], source: 'policy' }]));
    };
    const sink = stderrSink();
    const p = expressQueuePolicy({ resolvePolicy, stderr: sink.stderr });
    assert.equal(p.keepSingleton(medium(20)), false);
    assert.equal(p.keepSingleton(ELIGIBLE), false);
    assert.equal(p.grouping, 'per-record');
    assert.equal(sink.lines.length, 1);
    assert.match(sink.lines[0], named);
    assert.doesNotMatch(sink.lines[0], notNamed);
    assert.match(sink.lines[0], /policy\.yml unreadable/);
  }
});

test('AC10.1: split with a non-integer number never keeps a driver-only record; an unrecognised express-driver value keeps no record at all', () => {
  const split = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver': 'split' }).resolvePolicy });
  assert.equal(split.keepSingleton({ ...medium(20), number: '20' }), false);
  assert.equal(split.keepSingleton({ ...medium(20), number: 20.5 }), false);
  const sink = stderrSink();
  const recorded = policy({ ...DRIVER_POLICY, 'express-driver': 'sometimes' });
  const unknown = expressQueuePolicy({ resolvePolicy: recorded.resolvePolicy, stderr: sink.stderr });
  assert.equal(unknown.keepSingleton(medium(20)), false);
  assert.equal(unknown.keepSingleton(ELIGIBLE), false, 'an express-eligible record is bundled too');
  assert.equal(unknown.grouping, 'per-record');
  assert.equal(unknown.enabled, false);
  assert.deepStrictEqual(recorded.calls.map((c) => c.keys), [['express-lane', 'express-driver', 'dispatch-fastlane-bundle-cap', 'work-links']]);
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /sometimes/);
});

test('AC11.1: routingReason is exported from admission.js with its split rule', () => {
  const { routingReason, ADMISSION_REASONS: R } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'driver', 'admission.js'));
  assert.equal(routingReason('on', 3), null);
  assert.equal(routingReason('split', 4), null);
  assert.equal(routingReason('split', 5), R.splitOdd);
  assert.equal(routingReason('split', '4'), R.splitUnreadable);
  assert.equal(routingReason('off', 4), R.routingOff);
});

test('both halves on: a size:low record eligible for both is kept once, with no stderr', () => {
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy: policy(DRIVER_POLICY).resolvePolicy, stderr: sink.stderr });
  assert.equal(p.keepSingleton(ELIGIBLE), true);
  assert.deepEqual(sink.lines, []);
});

test('a throwing driver check keeps that record bundleable, with one stderr line naming it', () => {
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-lane': false }).resolvePolicy, stderr: sink.stderr });
  const malformed = { number: 8, body: BODY_TWO_KEYS, get labels() { throw new Error('labels unreadable'); } };
  assert.equal(p.keepSingleton(malformed), false);
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /#8/);
});

// A resolver whose `merge-sensitive-paths` entry answers differently per read of `.value`: the express
// half reads it first (setup), the driver's eligibilityOptions second.
function sensitivePathsReads(...answers) {
  let n = 0;
  const resolvePolicy = (keys) => Object.fromEntries(keys.map((k) => {
    if (k === 'merge-sensitive-paths') {
      return [k, { get value() { const a = answers[Math.min(n, answers.length - 1)]; n += 1; if (a instanceof Error) throw a; return a; }, source: 'policy' }];
    }
    return [k, { value: DRIVER_POLICY[k], source: 'policy' }];
  }));
  return resolvePolicy;
}

test('a driver module load failure is named as such, not as a policy read, with one stderr line', () => {
  const sink = stderrSink();
  const resolvePolicy = (keys) => Object.fromEntries(keys.map((k) => [k, k === 'merge-sensitive-paths'
    ? { get value() { throw new Error('sensitive paths\nunreadable'); }, source: 'policy' }
    : { value: { ...DRIVER_POLICY, 'express-lane': false }[k], source: 'policy' }]));
  const p = expressQueuePolicy({ resolvePolicy, stderr: sink.stderr });
  assert.equal(p.grouping, 'per-record');
  assert.equal(p.keepSingleton(medium(20)), false);
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /^express-driver: driver modules failed to load, fast-lane bundling unchanged this pull: sensitive paths unreadable\n$/);
  assert.doesNotMatch(sink.lines[0], /policy read failed/);
  assert.notEqual(p.fingerprint, groupingFingerprint({}), '#6062: not a failed read, so the fingerprint covers the values read');
});

test('an unrecognised express-driver value is collapsed to one stderr line', () => {
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...DRIVER_POLICY, 'express-driver': 'some\nvalue' }).resolvePolicy, stderr: sink.stderr });
  assert.equal(p.grouping, 'per-record');
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /some value/);
  assert.equal(sink.lines[0].indexOf('\n'), sink.lines[0].length - 1);
});

test('a throwing express check still lets the driver half keep the record, with one express-lane stderr line', () => {
  const sink = stderrSink();
  const throwing = new Proxy([], { get() { throw new Error('sensitive paths unusable'); } });
  const p = expressQueuePolicy({ resolvePolicy: sensitivePathsReads(throwing, []), stderr: sink.stderr });
  assert.equal(p.keepSingleton(ELIGIBLE), true);
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /^express-lane: eligibility check failed for #1/);
  assert.match(sink.lines[0], /sensitive paths unusable/);
});

// #5230: the queue pull's three consumers of expressQueuePolicy() (the cache check's grouping, the
// grouping pass's keepSingleton and the write-back blob's grouping) are pinned through an injected
// recording policy in tests/bin-lib/dispatch/queue-pull.test.js ("#5230 express: …").

// #6018: the driver half asks the driver's widened question.
const WIDENED_POLICY = { ...DRIVER_POLICY, 'express-lane': false, 'express-driver-max-size': 'low', 'express-driver-max-key-files': 1, 'express-driver-max-risk': 'medium', 'express-driver-review': 'on' };

test('#6018: the driver half resolves express-driver-max-risk, so the real resolver shape never throws', () => {
  const sink = stderrSink();
  const calls = [];
  // Like the real resolver: an entry only for a key it was asked for.
  const resolvePolicy = (keys) => {
    calls.push(keys);
    return Object.fromEntries(keys.map((k) => [k, { value: WIDENED_POLICY[k], source: 'policy' }]));
  };
  const p = expressQueuePolicy({ resolvePolicy, stderr: sink.stderr });
  assert.ok(calls[1].includes('express-driver-max-risk'));
  assert.equal(p.keepSingleton(MEDIUM_RISK), true);
  assert.deepStrictEqual(sink.lines, []);
});

test('#6018: a risk-widened record is not driver-routable with express-driver-review off', () => {
  const sink = stderrSink();
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...WIDENED_POLICY, 'express-driver-review': 'off' }).resolvePolicy, stderr: sink.stderr });
  assert.equal(p.keepSingleton(MEDIUM_RISK), false);
  assert.deepStrictEqual(sink.lines, []);
  // A record inside the unwidened lane is unaffected by the reviewer being off.
  assert.equal(p.keepSingleton(ELIGIBLE), true);
});

test('#6018: with express-driver-max-risk at its default (low) the driver half keeps today\'s answer for risk:medium', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...WIDENED_POLICY, 'express-driver-max-risk': 'low' }).resolvePolicy });
  assert.equal(p.keepSingleton(MEDIUM_RISK), false);
  assert.equal(p.keepSingleton(ELIGIBLE), true);
});

test('#6018: an any-ceremony widened record follows the same reviewer rule', () => {
  const SLOW = issue(3, ['risk:low', 'size:low', 'ceremony:standard', 'type:task']);
  const on = expressQueuePolicy({ resolvePolicy: policy(WIDENED_POLICY).resolvePolicy });
  assert.equal(on.keepSingleton(SLOW), true);
  const off = expressQueuePolicy({ resolvePolicy: policy({ ...WIDENED_POLICY, 'express-driver-review': 'off' }).resolvePolicy });
  assert.equal(off.keepSingleton(SLOW), false);
});

test('#6018: under beyond-express a risk-widened record turns the reviewer on and stays driver-routable', () => {
  const p = expressQueuePolicy({ resolvePolicy: policy({ ...WIDENED_POLICY, 'express-driver-review': 'beyond-express' }).resolvePolicy });
  assert.equal(p.keepSingleton(MEDIUM_RISK), true);
});

// #6062: the settings fingerprint, the queue-order cache's key beside the grouping stamp.
const { GROUPING_INPUTS, groupingFingerprint } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'express', 'queue.js'));
const FP_BASE = {
  'express-lane': true, 'express-driver': 'on', 'dispatch-fastlane-bundle-cap': 3, 'work-links': 'body-text',
  'integration-model': 'pr-first', 'merge-sensitive-paths': ['a/**'], 'express-driver-max-size': 'low',
  'express-driver-max-key-files': 3, 'express-driver-max-risk': 'low', 'express-driver-review': 'beyond-express',
};
const FP_CHANGED = {
  'express-lane': false, 'express-driver': 'split', 'dispatch-fastlane-bundle-cap': 2, 'work-links': 'native',
  'integration-model': 'local-merge', 'merge-sensitive-paths': ['b/**'], 'express-driver-max-size': 'medium',
  'express-driver-max-key-files': 4, 'express-driver-max-risk': 'medium', 'express-driver-review': 'on',
};
const fpOf = (values) => expressQueuePolicy({ resolvePolicy: policy(values).resolvePolicy });

test('#6062 AC5: groupingFingerprint is order-independent and stable for equal inputs', () => {
  const a = groupingFingerprint({ 'merge-sensitive-paths': ['b/**', 'a/**'] });
  assert.equal(groupingFingerprint({ 'merge-sensitive-paths': ['a/**', 'b/**', 'a/**'] }), a);
  assert.equal(groupingFingerprint({ 'merge-sensitive-paths': 'a/**, b/**' }), a);
  assert.equal(groupingFingerprint({ ...FP_BASE }), groupingFingerprint({ ...FP_BASE }));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('#6062 AC1/AC2: the policy fingerprint changes when any one grouping input changes', () => {
  const base = fpOf(FP_BASE);
  const covered = [];
  for (const key of GROUPING_INPUTS) {
    const changed = fpOf({ ...FP_BASE, [key]: FP_CHANGED[key] });
    assert.notEqual(changed.fingerprint, base.fingerprint, key);
    if (key !== 'express-lane') assert.equal(changed.grouping, base.grouping, key);
    covered.push(key);
  }
  assert.deepEqual(covered, [...GROUPING_INPUTS]);
});

test('#6062 AC3: equal grouping inputs give an equal policy fingerprint', () => {
  assert.equal(fpOf(FP_BASE).fingerprint, fpOf({ ...FP_BASE }).fingerprint);
});

test('#6062 lanes off: the fingerprint still covers the bundle cap without the second resolver call', () => {
  const off = { 'express-lane': false, 'express-driver': 'off', 'dispatch-fastlane-bundle-cap': 3, 'work-links': 'body-text' };
  const a = policy(off);
  const pa = expressQueuePolicy({ resolvePolicy: a.resolvePolicy });
  assert.equal(a.calls.length, 1);
  assert.equal(pa.enabled, false);
  assert.equal(pa.grouping, 'per-record');
  assert.notEqual(fpOf({ ...off, 'dispatch-fastlane-bundle-cap': 2 }).fingerprint, pa.fingerprint);
  assert.notEqual(fpOf({ ...off, 'work-links': 'native' }).fingerprint, pa.fingerprint);
});

test('#6062 failed read: a throwing resolver carries groupingFingerprint({}), on either call', () => {
  const sink = stderrSink();
  const thrown = expressQueuePolicy({ resolvePolicy: () => { throw new Error('boom'); }, stderr: sink.stderr });
  assert.equal(thrown.fingerprint, groupingFingerprint({}));
  let n = 0;
  const second = expressQueuePolicy({ resolvePolicy: (keys) => { n += 1; if (n === 2) throw new Error('boom'); return policy(FP_BASE).resolvePolicy(keys); }, stderr: sink.stderr });
  assert.equal(second.fingerprint, groupingFingerprint({}));
});

test('#6062 an unrecognised express-driver is disabled but its fingerprint still tracks the bundle cap and work-links', () => {
  const sink = stderrSink();
  const bad = { ...FP_BASE, 'express-driver': 'maybe' };
  const p = expressQueuePolicy({ resolvePolicy: policy(bad).resolvePolicy, stderr: sink.stderr });
  assert.equal(p.enabled, false);
  assert.equal(p.grouping, 'per-record');
  assert.equal(p.keepSingleton(ELIGIBLE), false);
  assert.notEqual(p.fingerprint, groupingFingerprint({}));
  for (const [key, value] of [['dispatch-fastlane-bundle-cap', 2], ['work-links', 'native']]) {
    assert.notEqual(expressQueuePolicy({ resolvePolicy: policy({ ...bad, [key]: value }).resolvePolicy, stderr: sink.stderr }).fingerprint, p.fingerprint, key);
  }
});

test('#6062 AC7: every key expressQueuePolicy requests is a grouping input', () => {
  const { resolvePolicy, calls } = policy(FP_BASE);
  expressQueuePolicy({ resolvePolicy });
  const requested = new Set(calls.flatMap((c) => c.keys));
  for (const k of requested) assert.ok(GROUPING_INPUTS.includes(k), k);
  assert.deepEqual([...requested].sort(), [...GROUPING_INPUTS].sort());
});

test('#6062 AC7: every policy entry the queue policy reads is a grouping input', () => {
  const read = [];
  const resolvePolicy = (keys) => {
    const entries = Object.fromEntries(keys.map((k) => [k, { value: FP_BASE[k], source: 'policy' }]));
    return new Proxy(entries, { get(target, prop) { if (typeof prop === 'string') read.push(prop); return target[prop]; } });
  };
  const p = expressQueuePolicy({ resolvePolicy });
  p.keepSingleton(ELIGIBLE);
  assert.ok(read.length > 0);
  for (const k of read) assert.ok(GROUPING_INPUTS.includes(k), k);
});
