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
  assert.deepStrictEqual(calls.map((c) => c.keys), [['express-lane', 'express-driver']]);
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
  assert.deepStrictEqual(calls.map((c) => c.keys), [['express-lane', 'express-driver'], ['integration-model', 'merge-sensitive-paths', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-review']]);
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
  for (const [failOn, named, notNamed] of [[1, /\(express-lane, express-driver\)/, /express-driver-review/], [2, /express-driver-review/, /\(express-lane, express-driver\)/]]) {
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
  assert.deepStrictEqual(recorded.calls.map((c) => c.keys), [['express-lane', 'express-driver']]);
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
