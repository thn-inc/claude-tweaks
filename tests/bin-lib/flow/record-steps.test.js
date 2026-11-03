'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseRecordSteps, formatRecordSteps } = require('../../../plugin/bin/lib/flow/record-steps');
const { run } = require('../../../plugin/bin/record-steps');

const BIN = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'record-steps.js');

function assertReason(value, reason, opts) {
  const r = parseRecordSteps(value, opts);
  assert.equal(r.ok, false, `${JSON.stringify(value)} should be refused`);
  assert.equal(r.reason, reason, `${JSON.stringify(value)}: ${r.message}`);
  assert.equal(typeof r.message, 'string');
  assert.ok(r.message.length > 0);
}

function capture(argv) {
  let out = '';
  let err = '';
  const code = run(argv, { stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
  return { code, out, err };
}

test('parses a none entry beside a stepped entry; canonical round-trips the input', () => {
  const input = '#12:none;#34:build,test';
  assert.deepEqual(parseRecordSteps(input), {
    ok: true,
    records: ['#12', '#34'],
    recordSteps: { '#12': [], '#34': ['build', 'test'] },
    steps: ['build', 'test'],
    canonical: input,
  });
});

test('whitespace around ;, : and , normalizes away', () => {
  const r = parseRecordSteps('  #12 : none ;  #34 :  build , test  ');
  assert.equal(r.ok, true);
  assert.deepEqual(r.recordSteps, { '#12': [], '#34': ['build', 'test'] });
  assert.equal(r.canonical, '#12:none;#34:build,test');
});

test('steps is the union in lifecycle order, not entry order', () => {
  const r = parseRecordSteps('#1:wrap-up;#2:test,review');
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps, ['test', 'review', 'wrap-up']);
});

test('records keep the value\'s order', () => {
  assert.deepEqual(parseRecordSteps('#34:test;#12:test').records, ['#34', '#12']);
});

test('formatRecordSteps prints an empty list as none', () => {
  assert.equal(formatRecordSteps({ '#1': [], '#2': ['test', 'review'] }), '#1:none;#2:test,review');
});

test('reason: empty', () => {
  assertReason('', 'empty');
  assertReason('   ', 'empty');
  assertReason(undefined, 'empty');
});

test('reason: malformed-entry', () => {
  assertReason('#1', 'malformed-entry');
  assertReason('#1:', 'malformed-entry');
  assertReason('build,test', 'malformed-entry');
  assertReason(':test', 'malformed-entry');
  assertReason('#1:test;', 'malformed-entry');
});

test('reason: bad-record', () => {
  assertReason('1:test', 'bad-record');
  assertReason('#0:test', 'bad-record');
  assertReason('#1a:test', 'bad-record');
});

test('reason: duplicate-record', () => {
  assertReason('#1:test;#1:review', 'duplicate-record');
});

test('reason: invalid-step', () => {
  assertReason('#1:tset', 'invalid-step');
  assertReason('#1:test,,review', 'invalid-step');
  assertReason('#1:review-console', 'invalid-step');
  assertReason('#1:test:review', 'invalid-step');
  assertReason('#1:build,test', 'invalid-step', { allowed: ['test', 'review'] });
});

test('a passed allowed admits only its own steps, and can admit review-console', () => {
  const r = parseRecordSteps('#1:review-console', { allowed: ['review-console'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps, ['review-console']);
});

test('reason: duplicate-step', () => {
  assertReason('#1:test,test', 'duplicate-step');
});

test('reason: out-of-order', () => {
  assertReason('#1:review,test', 'out-of-order');
});

test('reason: mixed-none', () => {
  assertReason('#1:none,test', 'mixed-none');
  assertReason('#1:test,none', 'mixed-none');
  assertReason('#1:none,none', 'mixed-none');
});

test('reason: nothing-left', () => {
  assertReason('#1:none;#2:none', 'nothing-left');
});

test('reason: target-mismatch, in the missing and the extra direction', () => {
  assertReason('#1:test;#2:test', 'target-mismatch', { targets: ['#1', '#3'] });
  assertReason('#1:test', 'target-mismatch', { targets: ['#1', '#2'] });
  assertReason('#1:test;#2:test', 'target-mismatch', { targets: ['#1'] });
});

test('targets in a different order alone pass', () => {
  const r = parseRecordSteps('#1:test;#2:test', { targets: ['#2', '#1'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.records, ['#1', '#2']);
});

test('CLI: exit 0 prints exactly {records, recordSteps, steps, canonical}', () => {
  const { code, out, err } = capture(['--value', '#12:none;#34:build,test', '--targets', '#34, #12']);
  assert.equal(code, 0);
  assert.equal(err, '');
  assert.deepEqual(JSON.parse(out), {
    records: ['#12', '#34'],
    recordSteps: { '#12': [], '#34': ['build', 'test'] },
    steps: ['build', 'test'],
    canonical: '#12:none;#34:build,test',
  });
});

test('CLI: --targets reaches the parser', () => {
  const { code, out, err } = capture(['--value', '#1:test', '--targets', '#2']);
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.match(err, /target-mismatch/);
});

const MALFORMED = [
  ['a trailing bare --value', ['--value']],
  ['an empty value', ['--value', '']],
  ['a blank value', ['--value', '   ']],
  ['a flag in the value\'s place', ['--value', '--targets', '#1']],
  ['an unknown flag', ['--value', '#1:test', '--nope']],
  ['an inherited key as a flag', ['--value', '#1:test', 'constructor']],
  ['no --value', []],
  ['a trailing bare --targets', ['--value', '#1:test', '--targets']],
  ['an empty --targets', ['--value', '#1:test', '--targets', '']],
  ['a --targets entry that is not a record', ['--value', '#1:test', '--targets', '1']],
  ['a --targets with an empty part', ['--value', '#1:test', '--targets', '#1,']],
  ['a --targets naming a record twice', ['--value', '#1:test', '--targets', '#1,#1']],
];
for (const [name, argv] of MALFORMED) {
  test(`CLI: exit 2 with nothing on stdout for ${name}`, () => {
    const { code, out, err } = capture(argv);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /^record-steps\.js: /);
  });
}

test('CLI: exit 2 for an invalid value, stderr naming the reason', () => {
  const { code, out, err } = capture(['--value', '#1:tset']);
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.match(err, /invalid-step/);
});

test('CLI: --help exits 0 and prints the usage', () => {
  const { code, out, err } = capture(['--help']);
  assert.equal(code, 0);
  assert.equal(err, '');
  assert.match(out, /^usage: record-steps\.js /);
});

test('CLI: the real binary round-trips a value', () => {
  const r = spawnSync(process.execPath, [BIN, '--value', '#1:none;#2:test'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).canonical, '#1:none;#2:test');
});
