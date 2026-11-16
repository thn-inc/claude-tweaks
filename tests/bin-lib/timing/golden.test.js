'use strict';
// Pins today's timing.json and the shape of derivePhases' result (#5160 Task 1),
// so the ci-gate derivation can prove the no-event output stays byte-identical.
// The golden was captured from the real CLI over record-1535, never hand-typed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { derivePhases, joinTokens, countGuardEvents } = require('../../../plugin/bin/lib/timing/derive');
const { evaluateBudgets, budgetProposal } = require('../../../plugin/bin/lib/timing/budget');
const { renderMarkdown } = require('../../../plugin/bin/phase-timing');
const { parseManifestYaml } = require('../../../plugin/bin/lib/flow/manifest');
const { readText } = require('../../helpers/read-skill');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'phase-timing.js');
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');
const GOLDEN = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535-golden-timing.json');
const NOW = new Date('2026-09-05T14:13:00.000Z');

// The one comparison form every golden assertion uses: the two run-specific
// values replaced by placeholders, then the CLI's own serialization.
function normalizeTiming(obj) {
  return JSON.stringify({ ...obj, runDir: '<RUN_DIR>', generatedAt: '<GENERATED_AT>' }, null, 2) + '\n';
}

// Runs the real CLI over a temp copy of record-1535 and returns the timing.json it wrote.
// One spawn per file: the golden test and its go-red share this lazily computed value.
let writtenTimingCache;
function writtenTiming() {
  if (writtenTimingCache !== undefined) return writtenTimingCache;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-golden-'));
  try {
    for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
    const r = spawnSync(process.execPath, [CLI, '--run', dir, '--markdown'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    writtenTimingCache = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
    return writtenTimingCache;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fixtureEvents() {
  return readText(path.join(FIX, 'events.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
}
function fixtureManifest() {
  return parseManifestYaml(readText(path.join(FIX, 'manifest.yml')));
}

test('AC6.1 golden: phase-timing.js over record-1535 writes timing.json byte-identical to the pre-#5160 golden (runDir, generatedAt normalized)', () => {
  assert.equal(normalizeTiming(writtenTiming()), readText(GOLDEN));
});

test('AC6.1 golden go-red: an extra totals.ciWallMinutes or a ciGate key breaks the golden comparison', () => {
  const w = writtenTiming();
  const golden = readText(GOLDEN);
  // The controls below only discriminate if the unmodified object matches.
  assert.equal(normalizeTiming(w), golden);
  assert.notEqual(normalizeTiming({ ...w, totals: { ...w.totals, ciWallMinutes: 0 } }), golden);
  assert.notEqual(normalizeTiming({ ...w, ciGate: [] }), golden);
});

test('characterization: derivePhases returns exactly { phases, totals } with totals keys minutes, verifyRuns, verifyMinutes, verifyModes', () => {
  const cases = [
    { name: 'record-1535', input: { events: fixtureEvents(), manifest: fixtureManifest(), now: NOW } },
    { name: 'no events', input: { events: [], now: NOW } },
    { name: 'session-end only', input: { events: [{ ts: '2026-09-05T14:13:00.000Z', type: 'session-end' }], now: NOW } },
    { name: 'null events', input: { events: null, now: NOW } },
    { name: 'malformed events', input: { events: [null, 'x', { type: 'verify' }, { ts: 'not-a-date', type: 'verify' }], now: NOW } },
  ];
  for (const { name, input } of cases) {
    const out = derivePhases(input);
    assert.deepEqual(Object.keys(out), ['phases', 'totals'], name);
    assert.deepEqual(Object.keys(out.totals), ['minutes', 'verifyRuns', 'verifyMinutes', 'verifyModes'], name);
  }
});

test('Deliverable reader invariance: evaluateBudgets, budgetProposal and renderMarkdown give identical output with and without totals.ciWallMinutes', () => {
  const { phases, totals: T } = derivePhases({ events: fixtureEvents(), manifest: fixtureManifest(), now: NOW });
  const T2 = { ...T, ciWallMinutes: 20 };
  const ceilings = { roundTrips: 5, procedureKb: 100, verifyMinutes: 1 };

  const checks = evaluateBudgets({ totals: T, ceilings });
  assert.deepEqual(evaluateBudgets({ totals: T2, ceilings }), checks);
  // verifyMinutes 5.1 over a ceiling of 1 is a breach, so budgetProposal renders rather than throws.
  assert.ok(checks.some((c) => c.status === 'breach'));

  const proposal = (totals) => budgetProposal({ runId: 'r', profile: 'standard', checks, totals, unattributed: null });
  assert.equal(proposal(T2), proposal(T));

  assert.equal(renderMarkdown({ phases, totals: T2 }), renderMarkdown({ phases, totals: T }));

  // The with-tokens branches: token columns, the total row's token cells, guard and turn lines.
  const tokens = joinTokens(phases, []);
  tokens.totals.rows = 1;
  const guard = countGuardEvents(fixtureEvents());
  const withTokens = renderMarkdown({ phases, totals: T }, tokens, guard);
  assert.match(withTokens, /\| Tokens \(in\/out\) \|/, 'the with-tokens table rendered');
  assert.equal(renderMarkdown({ phases, totals: T2 }, tokens, guard), withTokens);
});
