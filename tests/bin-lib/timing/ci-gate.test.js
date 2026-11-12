'use strict';
// #5160 Task 4: ci-gate events derive totals.ciWallMinutes and a ciGate list,
// and phase-timing.js renders one "CI gate:" line per PR. With no ci-gate
// event the derivation and the output are unchanged (golden.test.js pins the
// bytes; this suite pins the key absence).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { derivePhases } = require('../../../plugin/bin/lib/timing/derive');
const { renderCiGate } = require('../../../plugin/bin/phase-timing');
const { readText } = require('../../helpers/read-skill');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'phase-timing.js');
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');
const NOW = new Date('2026-09-05T14:13:00.000Z');

const CIG = (over = {}) => ({
  ts: '2026-11-12T10:30:00.000Z',
  type: 'ci-gate',
  pr: 123,
  headSha: 'a'.repeat(40),
  verdict: 'green',
  gateWaitMs: 120000,
  runsReadAt: '2026-11-12T10:30:00.000Z',
  runs: [],
  ciWallMs: 1200000,
  ...over,
});

function fixtureEvents() {
  return readText(path.join(FIX, 'events.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
}

// Runs the real CLI over a temp run dir whose events.jsonl holds `lines`
// (plus record-1535's manifest when withManifest). Returns stdout and the
// timing.json it wrote.
function runCli(lines, { withManifest = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-cigate-'));
  try {
    fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n');
    if (withManifest) fs.copyFileSync(path.join(FIX, 'manifest.yml'), path.join(dir, 'manifest.yml'));
    const r = spawnSync(process.execPath, [CLI, '--run', dir, '--markdown'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return { stdout: r.stdout, timing: JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8')) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const countLine = (stdout, line) => stdout.split('\n').filter((l) => l === line).length;

test('AC5.1: one ci-gate event with ciWallMs 1200000 gives totals.ciWallMinutes 20 and ciGate with that one entry', () => {
  const out = derivePhases({ events: [CIG()], now: NOW });
  assert.equal(out.totals.ciWallMinutes, 20);
  assert.deepEqual(out.ciGate, [CIG()]);
});

test('AC5.2: two events for the same pr (600000 then 1200000) give 20 and ciGate with two entries', () => {
  const events = [CIG({ ciWallMs: 600000 }), CIG({ ts: '2026-11-12T10:40:00.000Z' })];
  const out = derivePhases({ events, now: NOW });
  assert.equal(out.totals.ciWallMinutes, 20);
  assert.deepEqual(out.ciGate, events);
});

test('AC5.3: events for two distinct PRs (1200000 and 300000) give 25', () => {
  const out = derivePhases({ events: [CIG(), CIG({ pr: 124, ciWallMs: 300000 })], now: NOW });
  assert.equal(out.totals.ciWallMinutes, 25);
  assert.equal(out.ciGate.length, 2);
});

test('AC5.4: an event whose ciWallMs is null contributes 0 and still appears in ciGate', () => {
  const out = derivePhases({ events: [CIG({ ciWallMs: null })], now: NOW });
  assert.equal(out.totals.ciWallMinutes, 0);
  assert.equal(out.ciGate.length, 1);
});

test('latest null wins: same pr 1200000 then null contributes 0', () => {
  const out = derivePhases({ events: [CIG(), CIG({ ts: '2026-11-12T10:40:00.000Z', ciWallMs: null })], now: NOW });
  assert.equal(out.totals.ciWallMinutes, 0);
  assert.equal(out.ciGate.length, 2);
});

test('AC6.1: with no ci-gate event derivePhases has no ciGate key and totals has no ciWallMinutes', () => {
  for (const [name, events] of [['record-1535', fixtureEvents()], ['empty', []], ['null', null], ['undefined', undefined]]) {
    const out = derivePhases({ events, now: NOW });
    assert.equal('ciGate' in out, false, name);
    assert.equal('ciWallMinutes' in out.totals, false, name);
  }
});

test('a ci-gate event without a valid ts still counts, in file order', () => {
  const events = [CIG({ ts: undefined, ciWallMs: 600000 }), CIG()];
  const out = derivePhases({ events, now: NOW });
  assert.equal(out.totals.ciWallMinutes, 20);
  assert.equal(out.ciGate.length, 2);
  assert.equal(out.ciGate[0].ciWallMs, 600000);
});

test('AC7.1: phase-timing --markdown prints exactly "CI gate: green, 20 min wall, gate waited 2 min (PR #123)"', () => {
  const { stdout } = runCli([CIG()]);
  assert.equal(countLine(stdout, 'CI gate: green, 20 min wall, gate waited 2 min (PR #123)'), 1, stdout);
});

test('AC7.2: pendingAtBound prints "CI gate: timeout-park, 20 min wall (lower bound), gate waited 2 min (PR #123)"', () => {
  const { stdout } = runCli([CIG({ verdict: 'timeout-park', pendingAtBound: true })]);
  assert.equal(countLine(stdout, 'CI gate: timeout-park, 20 min wall (lower bound), gate waited 2 min (PR #123)'), 1, stdout);
});

test('AC7.3: ciWallMs null prints "CI gate: green, n/a min wall, gate waited 2 min (PR #123)"', () => {
  const { stdout } = runCli([CIG({ ciWallMs: null })]);
  assert.equal(countLine(stdout, 'CI gate: green, n/a min wall, gate waited 2 min (PR #123)'), 1, stdout);
});

test('AC7.4: with no ci-gate event no line starts with "CI gate:"', () => {
  const { stdout } = runCli(fixtureEvents(), { withManifest: true });
  assert.ok(stdout.includes('| total |'), stdout); // the table really rendered
  assert.equal(stdout.split('\n').some((l) => l.startsWith('CI gate:')), false, stdout);
});

test('the CI line also renders under the phase table: record-1535 plus one ci-gate event', () => {
  const { stdout } = runCli([...fixtureEvents(), CIG()], { withManifest: true });
  const lines = stdout.split('\n');
  const ci = lines.indexOf('CI gate: green, 20 min wall, gate waited 2 min (PR #123)');
  const total = lines.findIndex((l) => l.startsWith('| total |'));
  assert.ok(total >= 0, stdout);
  assert.ok(ci > total, stdout);
});

test('timing.json carries ciGate and totals.ciWallMinutes when an event exists', () => {
  const { timing } = runCli([CIG()]);
  assert.equal(timing.totals.ciWallMinutes, 20);
  assert.deepEqual(timing.ciGate, [CIG()]);
});

test('render n/a: a missing or non-numeric gateWaitMs renders "gate waited n/a min"', () => {
  const { gateWaitMs, ...noWait } = CIG();
  assert.equal(gateWaitMs, 120000);
  assert.equal(renderCiGate([noWait]), 'CI gate: green, 20 min wall, gate waited n/a min (PR #123)\n');
  assert.equal(renderCiGate([CIG({ gateWaitMs: 'soon' })]), 'CI gate: green, 20 min wall, gate waited n/a min (PR #123)\n');
  assert.equal(renderCiGate([CIG({ ciWallMs: '20' })]), 'CI gate: green, n/a min wall, gate waited 2 min (PR #123)\n');
  assert.equal(renderCiGate(undefined), '');
  assert.equal(renderCiGate([]), '');
});

test('minutes round to one decimal in derive and render: 1234567 ms is 20.6, 90000 ms is 1.5', () => {
  assert.equal(derivePhases({ events: [CIG({ ciWallMs: 1234567 })], now: NOW }).totals.ciWallMinutes, 20.6);
  assert.equal(renderCiGate([CIG({ ciWallMs: 1234567, gateWaitMs: 90000 })]), 'CI gate: green, 20.6 min wall, gate waited 1.5 min (PR #123)\n');
});

test('one line per PR, latest event per PR, first-appearance order', () => {
  const text = renderCiGate([
    CIG({ pr: 1, verdict: 'red', ciWallMs: 60000 }),
    CIG({ pr: 2, ciWallMs: 120000 }),
    CIG({ pr: 1, verdict: 'green', ciWallMs: 180000 }),
  ]);
  assert.equal(text, 'CI gate: green, 3 min wall, gate waited 2 min (PR #1)\nCI gate: green, 2 min wall, gate waited 2 min (PR #2)\n');
});
