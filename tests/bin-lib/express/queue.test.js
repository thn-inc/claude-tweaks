'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('../../helpers/read-skill');

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
    return Object.fromEntries(keys.map((k) => [k, { value: values[k], source: 'policy' }]));
  };
  return { resolvePolicy, calls };
}

function stderrSink() {
  const lines = [];
  return { lines, stderr: (s) => lines.push(s) };
}

test('express-lane false: keepSingleton is false for an eligible record and grouping is per-record', () => {
  const { resolvePolicy, calls } = policy({ 'express-lane': false, 'integration-model': 'pr-first', 'merge-sensitive-paths': [] });
  const p = expressQueuePolicy({ resolvePolicy });
  assert.equal(p.enabled, false);
  assert.equal(p.grouping, 'per-record');
  assert.equal(p.keepSingleton(ELIGIBLE), false);
  // A disabled lane must not resolve integration-model (an unpinned one probes `gh repo view`).
  assert.deepStrictEqual(calls.map((c) => c.keys), [['express-lane']]);
});

test('express-lane true + pr-first: eligible stays a singleton, risk:medium does not, grouping is per-record+express', () => {
  const { resolvePolicy, calls } = policy({ 'express-lane': true, 'integration-model': 'pr-first', 'merge-sensitive-paths': [] });
  const p = expressQueuePolicy({ resolvePolicy });
  assert.equal(p.enabled, true);
  assert.equal(p.grouping, 'per-record+express');
  assert.equal(p.keepSingleton(ELIGIBLE), true);
  assert.equal(p.keepSingleton(MEDIUM_RISK), false);
  assert.deepStrictEqual(calls.map((c) => c.keys), [['express-lane'], ['integration-model', 'merge-sensitive-paths']]);
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
});

test('queue-pull-script.md passes expressQueuePolicy() into the cache check, the write-back and the grouping pass', () => {
  const script = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md'));
  const call = '/bin/lib/express/queue.js\').expressQueuePolicy()';
  const lineWith = (needle) => script.split('\n').filter((l) => l.includes(needle));
  assert.deepStrictEqual(lineWith('cacheUsable(persisted, current').map((l) => l.includes(`${call}.grouping`)), [true]);
  assert.deepStrictEqual(lineWith('buildDispatchGroups(finalEligible').map((l) => l.includes(`keepSingleton: require(`) && l.includes(`${call}.keepSingleton`)), [true]);
  const writeBack = script.slice(script.indexOf('const blob = composeOrderBlob({'), script.indexOf('const result = writeOrder(root, blob);'));
  assert.ok(writeBack.includes(`grouping: require(`) && writeBack.includes(`${call}.grouping`), 'the write-back must stamp expressQueuePolicy().grouping');
});
