'use strict';
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { readText } = require('../../helpers/read-skill');
const {
  MANIFESTO_LEVERS, RUN_PINS, leverValues, validateLever, setConfigLever,
} = require('../../../plugin/bin/lib/set-config/write');

const runManifest = require('../../../plugin/bin/lib/run-manifest/write');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function fixtureRunDir() {
  const root = scratchDir('setcfg-');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-20T090000-spec-12');
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

test('validateLever: every canonical Manifesto lever is accepted with a known-good value', () => {
  const good = {
    mode: 'auto',
    'scope-creep': 'add-to-plan',
    overlap: 'companion',
    'design-intent': 'none',
    'leftover-default': 'defer',
    'auto-fix-threshold': 'lint+type',
    'review-auto-apply-ceiling': 'low',
    'tidy-aggressiveness': 'moderate',
    'ceremony-profile': 'standard',
    'model-stance': 'default',
    'merge-verification': 'merge-when-green',
    'design-critique': 'auto',
    'merge-authorization': 'ask',
  };
  assert.deepEqual(Object.keys(good).sort(), [...MANIFESTO_LEVERS].sort());
  for (const [key, value] of Object.entries(good)) {
    assert.deepEqual(validateLever(key, value), { ok: true }, `${key}=${value} should validate`);
  }
});

test('RUN_PINS: integration-model and spec are run pins, not Manifesto levers', () => {
  assert.deepEqual([...RUN_PINS], ['integration-model', 'spec']);
  assert.equal(MANIFESTO_LEVERS.includes('integration-model'), false);
  assert.equal(MANIFESTO_LEVERS.includes('spec'), false);
  assert.deepEqual(leverValues('integration-model'), ['pr-first', 'local-merge']);
});

test('validateLever: integration-model accepts pr-first/local-merge and rejects other values', () => {
  assert.equal(validateLever('integration-model', 'pr-first').ok, true);
  assert.deepEqual(validateLever('integration-model', 'github'), {
    ok: false, reason: 'invalid-value', allowed: ['pr-first', 'local-merge'],
  });
});

test('AC1.1: validateLever accepts spec as a positive-integer run pin', () => {
  assert.deepEqual(validateLever('spec', '5347'), { ok: true });
  assert.deepEqual(validateLever('spec', '7'), { ok: true });
  for (const bad of ['0', '-1', 'abc', '12x', '07', '']) {
    assert.deepEqual(validateLever('spec', bad), {
      ok: false, reason: 'invalid-value', allowed: ['a positive integer record number'],
    }, `spec=${JSON.stringify(bad)} should be refused`);
  }
});

test('validateLever: a key outside the lever enum is refused (unknown-key) — including config.yml bookkeeping fields', () => {
  for (const key of ['created', 'worktree-always', 'not-a-lever']) {
    assert.deepEqual(validateLever(key, 'x'), { ok: false, reason: 'unknown-key' });
  }
});

test('validateLever: a value outside the lever\'s enum is refused with the allowed list', () => {
  const res = validateLever('ceremony-profile', 'turbo');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid-value');
  assert.deepEqual(res.allowed, ['fast-lane', 'standard']);
  const res2 = validateLever('design-critique', 'sometimes');
  assert.equal(res2.ok, false);
  assert.deepEqual(res2.allowed, ['off', 'auto', 'full']);
});

test('leverValues: schema-backed levers surface POLICY_KEYS enums; config-only levers surface local enums; non-levers null', () => {
  assert.deepEqual(leverValues('mode'), ['auto', 'hybrid', 'interactive']);
  assert.deepEqual(leverValues('ceremony-profile'), ['fast-lane', 'standard']);
  assert.deepEqual(leverValues('model-stance'), ['economy', 'default', 'max-rigor']);
  assert.equal(leverValues('spec'), null);
});

test('MANIFESTO_LEVERS matches manifesto.md\'s config.yml example block (the canonical lever set)', () => {
  const manifesto = readText(path.join(REPO_ROOT, 'plugin', 'skills', 'flow', 'manifesto.md'));
  const approvalIdx = manifesto.indexOf('On approval (option 1)');
  assert.ok(approvalIdx !== -1, 'manifesto.md: "On approval (option 1)" section not found — anchor may have moved');
  const fenceStart = manifesto.indexOf('```yaml', approvalIdx);
  assert.ok(fenceStart !== -1, 'manifesto.md: no ```yaml fence after "On approval (option 1)"');
  const fenceEnd = manifesto.indexOf('```', fenceStart + 7);
  const block = manifesto.slice(fenceStart + 7, fenceEnd);
  const keys = [];
  for (const rawLine of block.split('\n')) {
    const m = /^([a-z0-9-]+):/.exec(rawLine.trim());
    if (m && m[1] !== 'spec' && m[1] !== 'created' && !RUN_PINS.includes(m[1])) keys.push(m[1]);
  }
  assert.deepEqual(keys, [...MANIFESTO_LEVERS],
    'MANIFESTO_LEVERS must track manifesto.md\'s config.yml example block, in order');
});

test('setConfigLever: replaces an existing lever line in place, preserving every other line (comments included)', () => {
  const runDir = fixtureRunDir();
  const file = path.join(runDir, 'config.yml');
  fs.writeFileSync(file, [
    'mode: auto',
    '# a comment line',
    'ceremony-profile: fast-lane   # ceiling note',
    'spec: 12',
    '',
  ].join('\n'));
  const res = setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
  assert.equal(res.file, file);
  assert.equal(res.previous, 'fast-lane');
  assert.equal(fs.readFileSync(file, 'utf8'), [
    'mode: auto',
    '# a comment line',
    'ceremony-profile: standard',
    'spec: 12',
    '',
  ].join('\n'));
});

test('setConfigLever: appends the lever when the line is absent, and creates config.yml when missing', () => {
  const runDir = fixtureRunDir();
  const file = path.join(runDir, 'config.yml');
  fs.writeFileSync(file, 'mode: auto\n');
  const res = setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
  assert.equal(res.previous, null);
  assert.equal(fs.readFileSync(file, 'utf8'), 'mode: auto\nceremony-profile: standard\n');

  const runDir2 = fixtureRunDir();
  const res2 = setConfigLever({ runDir: runDir2, key: 'mode', value: 'interactive' });
  assert.equal(res2.previous, null);
  assert.equal(fs.readFileSync(path.join(runDir2, 'config.yml'), 'utf8'), 'mode: interactive\n');
});

test('setConfigLever: idempotent — setting the same value twice leaves one line', () => {
  const runDir = fixtureRunDir();
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'ceremony-profile: fast-lane\n');
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
  const second = setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
  assert.equal(second.previous, 'standard');
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.equal(body, 'ceremony-profile: standard\n');
  assert.equal(body.match(/ceremony-profile:/g).length, 1);
});

test('setConfigLever: the written line is readable by policy-schema\'s parseFlatLines', () => {
  const { parseFlatLines } = require('../../../plugin/bin/lib/policy-schema');
  const runDir = fixtureRunDir();
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'ceremony-profile: fast-lane   # note\n');
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
  const parsed = parseFlatLines(fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'));
  assert.equal(parsed['ceremony-profile'], 'standard');
});

test('setConfigLever: a duplicated lever line collapses to one, previous is the LAST occurrence\'s value (matching parseFlatLines)', () => {
  const { parseFlatLines } = require('../../../plugin/bin/lib/policy-schema');
  const runDir = fixtureRunDir();
  const file = path.join(runDir, 'config.yml');
  fs.writeFileSync(file, [
    'ceremony-profile: fast-lane',
    'mode: auto',
    'ceremony-profile: fast-lane',
    '',
  ].join('\n'));
  const res = setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
  assert.equal(res.previous, 'fast-lane');
  const body = fs.readFileSync(file, 'utf8');
  const matches = body.match(/^ceremony-profile:.*$/gm);
  assert.deepEqual(matches, ['ceremony-profile: standard']);
  assert.ok(body.includes('mode: auto'), 'other lines must be preserved');
  const parsed = parseFlatLines(body);
  assert.equal(parsed['ceremony-profile'], 'standard');
});

test('setConfigLever: prefix-anchored — setting `mode` does not touch `model-stance` (and vice versa)', () => {
  const runDir = fixtureRunDir();
  const file = path.join(runDir, 'config.yml');
  fs.writeFileSync(file, [
    'mode: auto',
    'model-stance: default',
    '',
  ].join('\n'));
  setConfigLever({ runDir, key: 'mode', value: 'interactive' });
  const body = fs.readFileSync(file, 'utf8');
  assert.equal(body, ['mode: interactive', 'model-stance: default', ''].join('\n'));
});

// --- run manifest fill (#5903): ceremony-profile writes ride into manifest.json ---------------

const FACTS = { pluginVersion: '6.200.0', policyHash: 'abc123', baseCommit: 'deadbeef', modelProfile: 'standard' };
const seedManifest = (runDir) => runManifest.initRunManifest(runDir, { cwd: runDir }, { gatherFacts: () => ({ ...FACTS }), stderr: () => {} });
const readManifest = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, runManifest.MANIFEST_FILE), 'utf8'));

test('setConfigLever: setting ceremony-profile fills the manifest ceremonyProfile', () => {
  const runDir = fixtureRunDir();
  seedManifest(runDir);
  assert.equal(readManifest(runDir).ceremonyProfile, null);
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'fast-lane' });
  assert.equal(readManifest(runDir).ceremonyProfile, 'fast-lane');
});

test('setConfigLever: a later ceremony-profile change overwrites ceremonyProfile and changes no other manifest field', () => {
  const runDir = fixtureRunDir();
  seedManifest(runDir);
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'fast-lane' });
  const first = readManifest(runDir);
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
  const second = readManifest(runDir);
  assert.equal(second.ceremonyProfile, 'standard');
  assert.deepEqual({ ...second, ceremonyProfile: null }, { ...first, ceremonyProfile: null });
});

const { STARTING_LISTS } = require('../../../plugin/bin/lib/station-events/plan');
const { STATION, KIND } = require('../../../plugin/bin/lib/station-events/stations');

// The scratch root above fixtureRunDir()'s run dir doubles as the main root; its log holds a standard-claim `planned` line.
function replanFixture() {
  const runDir = fixtureRunDir();
  seedManifest(runDir);
  const mainRoot = path.resolve(runDir, '..', '..', '..');
  fs.mkdirSync(path.join(mainRoot, '.git')); // resolvable by mainCheckoutRoot, so a default-sink regression would append here
  const logFile = path.join(mainRoot, '.claude-tweaks', 'station-events.jsonl');
  fs.writeFileSync(logFile, JSON.stringify({
    v: 1, repoName: 'acme/w', recordNumber: 7, kind: KIND.PLANNED, station: STATION.BUILD, lane: 'unknown',
    runId: path.basename(runDir), payload: { stations: STARTING_LISTS.standard },
  }) + '\n');
  return { runDir, mainRoot, logFile };
}

test('downgrading the ceremony profile on a claimed record writes one replanned with reason ceremony-downgrade', () => {
  const { runDir, mainRoot } = replanFixture();
  const events = [];
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'fast-lane', stationDeps: { stationEvent: (e) => events.push(e), mainRoot } });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, KIND.REPLANNED);
  assert.equal(events[0].payload.reasonCode, 'ceremony-downgrade');
  assert.equal(events[0].payload.cause.kind, 'config');
  assert.equal(events[0].payload.stations.includes('polish'), false);
});

test('fixing the profile to standard after a standard claim writes nothing via setConfigLever', () => {
  const { runDir, mainRoot } = replanFixture();
  const events = [];
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard', stationDeps: { stationEvent: (e) => events.push(e), mainRoot } });
  assert.deepEqual(events, []);
});

test('setConfigLever without stationDeps writes no event', () => {
  const { runDir, logFile } = replanFixture();
  const before = fs.readFileSync(logFile, 'utf8');
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'fast-lane' });
  assert.equal(fs.readFileSync(logFile, 'utf8'), before);
  assert.equal(before.split('\n').filter(Boolean).length, 1);
});

test('setConfigLever with a failed manifest fill still replans from the written value', () => {
  const { runDir, mainRoot } = replanFixture();
  fs.rmSync(path.join(runDir, runManifest.MANIFEST_FILE));
  fs.mkdirSync(path.join(runDir, runManifest.MANIFEST_FILE));
  const events = [];
  setConfigLever({ runDir, key: 'ceremony-profile', value: 'fast-lane', stationDeps: { stationEvent: (e) => events.push(e), mainRoot } });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload.stations, STARTING_LISTS['fast-lane']);
});

test('setConfigLever: setting another key leaves manifest.json untouched, and does not create one', () => {
  const runDir = fixtureRunDir();
  setConfigLever({ runDir, key: 'mode', value: 'auto' });
  assert.equal(fs.existsSync(path.join(runDir, runManifest.MANIFEST_FILE)), false);
  seedManifest(runDir);
  const before = fs.readFileSync(path.join(runDir, runManifest.MANIFEST_FILE), 'utf8');
  setConfigLever({ runDir, key: 'mode', value: 'interactive' });
  setConfigLever({ runDir, key: 'spec', value: '5903' });
  assert.equal(fs.readFileSync(path.join(runDir, runManifest.MANIFEST_FILE), 'utf8'), before);
});

test('setConfigLever: a fill failure does not change the set-config result or the config.yml write', () => {
  const runDir = fixtureRunDir();
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'ceremony-profile: fast-lane\n');
  const fill = mock.method(runManifest, 'fillRunManifest', () => { throw new Error('manifest writer exploded'); });
  try {
    const res = setConfigLever({ runDir, key: 'ceremony-profile', value: 'standard' });
    assert.equal(fill.mock.callCount(), 1);
    assert.deepEqual(res, { file: path.join(runDir, 'config.yml'), previous: 'fast-lane' });
    assert.equal(fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'), 'ceremony-profile: standard\n');
  } finally {
    fill.mock.restore();
  }
});
