'use strict';
// plugin/bin/deferral-route.js (#5930): the CLI over routeDeferral. The routing
// rules themselves are pinned exhaustively in tests/bin-lib/deferral-route/route.test.js;
// this file pins the flag parsing, the JSON line, the exit codes and the no-write promise.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { scratchDir } = require('./helpers/tmp-dir');
const { installStub, STUB_SKIP } = require('./helpers/path-stub');
const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record');

const CLI = path.resolve(__dirname, '..', 'plugin', 'bin', 'deferral-route.js');
const { realDeps, USAGE } = require(CLI);

const LOW = ['--size', 'low', '--priority', 'low', '--risk', 'low'];
const SEVERITIES_TEXT = 'critical, high, medium, low, info';

function call(...argv) {
  const res = runCliSync(CLI, argv);
  const lines = res.stdout.split('\n');
  assert.equal(lines.pop(), '', 'stdout ends with a newline');
  assert.equal(lines.length, 1, 'exactly one stdout line');
  return { code: res.code, stderr: res.stderr, json: JSON.parse(lines[0]) };
}

function verdictOf(...argv) {
  const { code, json } = call(...argv);
  return { code, verdict: json.verdict, rule: json.rule };
}

test('AC1.1 floor digests, and echoes the inputs as given', () => {
  const { code, stderr, json } = call('--defer-reason', 'pre-existing-outside-diff', ...LOW, '--agent-raised');
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.deepStrictEqual(json, {
    verdict: 'digest',
    rule: 'floor',
    input: { deferReason: 'pre-existing-outside-diff', severity: null, size: 'low', priority: 'low', risk: 'low', agentRaised: true },
  });
});

test('AC2.1 risk medium files; AC2.2 priority omitted files', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--size', 'low', '--priority', 'low', '--risk', 'medium', '--agent-raised'), { code: 0, verdict: 'file', rule: 'not-low' });
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--size', 'low', '--risk', 'low', '--agent-raised'), { code: 0, verdict: 'file', rule: 'not-low' });
});

test('AC3.1 tangential files', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'tangential', ...LOW, '--agent-raised'), { code: 0, verdict: 'file', rule: 'tangential' });
});

test('AC4.1/4.2 severity high and critical file; AC4.3 medium digests', () => {
  for (const severity of ['high', 'critical']) {
    assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--severity', severity, ...LOW, '--agent-raised'), { code: 0, verdict: 'file', rule: 'severity' }, severity);
  }
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--severity', 'medium', ...LOW, '--agent-raised'), { code: 0, verdict: 'digest', rule: 'floor' });
});

test('AC5.1 human files whatever the flags', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', ...LOW, '--human'), { code: 0, verdict: 'file', rule: 'human' });
  assert.equal(call('--defer-reason', 'pre-existing-outside-diff', ...LOW, '--human').json.input.agentRaised, false);
});

test('AC6.1 unknown reason refused, naming the value and every allowed reason', () => {
  const { code, stderr, json } = call('--defer-reason', 'not-a-reason', '--agent-raised');
  assert.equal(code, 2);
  assert.equal(json.verdict, 'refused');
  assert.ok(json.reason.includes('"not-a-reason"'));
  for (const r of DEFER_REASONS) assert.ok(json.reason.includes(r), r);
  assert.equal(stderr, json.reason + '\n');
});

test('AC9.1 severity typo refused; AC9.2 severity omitted is valid', () => {
  for (const bad of ['High', 'urgent']) {
    const { code, json } = call('--defer-reason', 'tangential', '--severity', bad, '--agent-raised');
    assert.equal(code, 2, bad);
    assert.equal(json.verdict, 'refused');
    assert.equal(json.reason, `--severity "${bad}" is not one of: ${SEVERITIES_TEXT}`);
  }
  assert.equal(call('--defer-reason', 'tangential', '--agent-raised').code, 0);
});

test('AC10 rule order: severity beats tangential; a bad reason refuses, human or not', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'tangential', '--severity', 'high', ...LOW, '--agent-raised'), { code: 0, verdict: 'file', rule: 'severity' });
  assert.deepStrictEqual(verdictOf('--defer-reason', 'not-a-reason', '--severity', 'high', ...LOW, '--agent-raised'), { code: 2, verdict: 'refused', rule: 'refused' });
  assert.deepStrictEqual(verdictOf('--defer-reason', 'not-a-reason', ...LOW, '--human'), { code: 2, verdict: 'refused', rule: 'refused' });
});

test('review focus 1: a value flag as the last token refuses, never throws', () => {
  const { code, json } = call('--defer-reason', 'tangential', '--agent-raised', '--size');
  assert.equal(code, 2);
  assert.equal(json.verdict, 'refused');
  assert.equal(json.reason, '--size needs a value');
});

test('review focus 2: a value that is itself a flag is a missing value', () => {
  const { code, json } = call('--defer-reason', 'tangential', '--agent-raised', '--size', '--risk', 'low');
  assert.equal(code, 2);
  assert.equal(json.reason, '--size needs a value');
  assert.equal(json.input.risk, 'low', 'the flag after the missing value is still read');
});

test('review focus 3: a case-differing axis value files as not-low, never digests', () => {
  assert.deepStrictEqual(verdictOf('--defer-reason', 'pre-existing-outside-diff', '--size', 'low', '--priority', 'low', '--risk', 'Low', '--agent-raised'), { code: 0, verdict: 'file', rule: 'not-low' });
});

test('review focus 4: empty values — reason and severity refuse, size files', () => {
  const emptyReason = call('--defer-reason', '', '--agent-raised');
  assert.equal(emptyReason.code, 2);
  assert.equal(emptyReason.json.verdict, 'refused');
  assert.equal(emptyReason.json.reason, `--defer-reason "" is not one of: ${DEFER_REASONS.join(', ')}`);
  const emptySeverity = call('--defer-reason', 'tangential', '--severity', '', '--agent-raised');
  assert.equal(emptySeverity.code, 2);
  assert.equal(emptySeverity.json.verdict, 'refused');
  assert.equal(emptySeverity.json.reason, `--severity "" is not one of: ${SEVERITIES_TEXT}`);
  const { code, json } = call('--defer-reason', 'pre-existing-outside-diff', '--size', '', '--priority', 'low', '--risk', 'low', '--agent-raised');
  assert.equal(code, 0);
  assert.deepStrictEqual({ verdict: json.verdict, rule: json.rule, size: json.input.size }, { verdict: 'file', rule: 'not-low', size: '' });
});

test('review focus 5: a repeated flag refuses', () => {
  const bare = call('--defer-reason', 'tangential', '--agent-raised', '--agent-raised');
  assert.equal(bare.code, 2);
  assert.equal(bare.json.reason, '--agent-raised given more than once');
  const valued = call('--defer-reason', 'tangential', '--size', 'low', '--size', 'low', '--agent-raised');
  assert.equal(valued.code, 2);
  assert.equal(valued.json.reason, '--size given more than once');
});

test('refusals: both origins, neither origin, unknown flag', () => {
  const both = call('--defer-reason', 'tangential', '--agent-raised', '--human');
  assert.equal(both.code, 2);
  assert.equal(both.json.reason, 'exactly one of --agent-raised or --human is required');
  assert.equal(both.json.input.agentRaised, null);
  const neither = call('--defer-reason', 'tangential');
  assert.equal(neither.code, 2);
  assert.equal(neither.json.reason, 'exactly one of --agent-raised or --human is required');
  const unknown = call('--defer-reason', 'tangential', '--agent-raised', '--bogus');
  assert.equal(unknown.code, 2);
  assert.equal(unknown.json.reason, 'unknown flag --bogus; accepted: --defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --help');
});

test('the both-origins refusal is raised where the second origin appears, so it beats a later unknown flag', () => {
  const { code, json } = call('--agent-raised', '--human', '--bogus');
  assert.equal(code, 2);
  assert.equal(json.reason, 'exactly one of --agent-raised or --human is required');
});

test('a stray positional is an unknown argument, not an unknown flag', () => {
  const { code, json } = call('tangential');
  assert.equal(code, 2);
  assert.equal(json.reason, 'unknown argument tangential; accepted: --defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --help');
});

test('a parse refusal still carries every known flag in input; the first refusal decides the reason', () => {
  const { code, json } = call('--bogus', '--defer-reason', 'tangential', '--agent-raised');
  assert.equal(code, 2);
  assert.equal(json.reason.startsWith('unknown flag --bogus'), true);
  assert.equal(json.input.deferReason, 'tangential');
  assert.equal(json.input.agentRaised, true);
});

test('--help prints usage and exits 0', () => {
  for (const flag of ['--help', '-h']) {
    const res = runCliSync(CLI, [flag]);
    assert.equal(res.code, 0);
    assert.equal(res.stdout, USAGE);
    assert.equal(res.stderr, '');
  }
});

test('--help in flag position wins over an earlier parse refusal', () => {
  const res = runCliSync(CLI, ['--bogus', '--help']);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, USAGE);
});

test('--help counts only in flag position: a value flag followed by it refuses', () => {
  const { code, json } = call('--defer-reason', '--help');
  assert.equal(code, 2);
  assert.equal(json.reason, '--defer-reason needs a value');
});

test('-h as a value is an ordinary value, refused by the function as a bad severity', () => {
  const { code, json } = call('--defer-reason', 'tangential', '--severity', '-h', '--agent-raised');
  assert.equal(code, 2);
  assert.equal(json.reason, `--severity "-h" is not one of: ${SEVERITIES_TEXT}`);
});

test('AC8.1 writes nothing and calls no gh', { skip: STUB_SKIP }, () => {
  const cwd = scratchDir('ct-deferral-route-');
  const marker = path.join(cwd, '..', `gh-called-${path.basename(cwd)}`);
  const restore = installStub('gh', `#!/bin/sh\ntouch '${marker}'\n`);
  try {
    const digest = spawnCli(CLI, ['--defer-reason', 'pre-existing-outside-diff', ...LOW, '--agent-raised'], { cwd });
    const refused = spawnCli(CLI, ['--defer-reason', 'not-a-reason', '--agent-raised'], { cwd });
    assert.equal(digest.code, 0);
    assert.equal(JSON.parse(digest.stdout).verdict, 'digest');
    assert.equal(refused.code, 2);
    assert.equal(JSON.parse(refused.stdout).verdict, 'refused');
    assert.deepStrictEqual(fs.readdirSync(cwd), []);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    restore();
    fs.rmSync(marker, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('AC8.2 in-process deps are stdout and stderr only', () => {
  assert.deepStrictEqual(Object.keys(realDeps).sort(), ['stderr', 'stdout']);
});
