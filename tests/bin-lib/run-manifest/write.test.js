'use strict';
// #5903: the run manifest writer — initRunManifest at mint, fill-only-null fillRunManifest afterwards.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { chmodDenialSkip } = require('../../helpers/root');
const { writeFileAtomic } = require('../../../plugin/bin/lib/atomic-write');
const {
  MANIFEST_FILE, MANIFEST_VERSION, LANES, CEREMONY_PROFILES, CLOSE_FIELDS, COST_GROUP, initRunManifest, fillRunManifest,
} = require('../../../plugin/bin/lib/run-manifest/write');

const FACTS = {
  pluginVersion: '6.174.0',
  policyHash: `sha256:${'a'.repeat(64)}`,
  baseCommit: 'b'.repeat(40),
  modelProfile: { stance: 'default', ceiling: 'frontier' },
};
const NULL_FACTS = { pluginVersion: null, policyHash: null, baseCommit: null, modelProfile: null };
const NINE_KEYS = [
  'baseCommit', 'ceremonyProfile', 'createdAt', 'lane', 'modelProfile', 'pluginVersion', 'policyHash', 'runId', 'v',
];

function runDir(name = 'run') {
  const parent = scratchDir('run-manifest-write-');
  const dir = path.join(parent, `2026-11-19T000000-${name}`);
  fs.mkdirSync(dir);
  return dir;
}

function collector() {
  const lines = [];
  return { lines, stderr: (line) => lines.push(line) };
}

const gather = (facts = FACTS) => () => ({ ...facts });
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
const manifestBytes = (dir) => fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8');

test('vocabulary constants', () => {
  assert.equal(MANIFEST_FILE, 'manifest.json');
  assert.equal(MANIFEST_VERSION, 1);
  assert.deepEqual(LANES, ['standard', 'express', 'driver', 'unknown']);
  assert.deepEqual(CEREMONY_PROFILES, ['fast-lane', 'standard']);
});

test('init writes the v1 file with exactly the documented key set', () => {
  const dir = runDir('spec-1');
  const { stderr, lines } = collector();
  const out = initRunManifest(dir, { cwd: dir }, {
    gatherFacts: gather(), now: () => new Date('2026-11-19T07:31:30.000Z'), stderr,
  });
  assert.deepEqual(out, { written: true });
  assert.deepEqual(lines, []);
  const text = manifestBytes(dir);
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed), NINE_KEYS);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.runId, path.basename(dir));
  assert.equal(parsed.createdAt, '2026-11-19T07:31:30.000Z');
  assert.equal(new Date(parsed.createdAt).toISOString(), parsed.createdAt);
  assert.equal(parsed.lane, 'unknown');
  assert.equal(parsed.ceremonyProfile, null);
  assert.equal(parsed.pluginVersion, FACTS.pluginVersion);
  assert.equal(parsed.policyHash, FACTS.policyHash);
  assert.equal(parsed.baseCommit, FACTS.baseCommit);
  assert.deepEqual(Object.keys(parsed.modelProfile), ['ceiling', 'stance']);
  assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'), 'single trailing newline');
  assert.ok(text.startsWith('{\n  "baseCommit"'), 'two-space indent, sorted from the first key');
  assert.ok(text.includes('\n    "ceiling": "frontier"'), 'nested object is indented and sorted too');
});

test('init gathers facts for the passed cwd and forwards a test-only env', () => {
  const dir = runDir();
  const seen = [];
  initRunManifest(dir, { cwd: '/some/cwd', env: { X: '1' } }, {
    gatherFacts: (arg) => { seen.push(arg); return { ...FACTS }; }, stderr: () => {},
  });
  assert.deepEqual(seen, [{ cwd: '/some/cwd', env: { X: '1' } }]);
  const seenDefault = [];
  const dir2 = runDir();
  initRunManifest(dir2, { cwd: '/some/cwd' }, {
    gatherFacts: (arg) => { seenDefault.push(arg); return { ...FACTS }; }, stderr: () => {},
  });
  assert.equal(seenDefault[0].cwd, '/some/cwd');
  assert.equal(seenDefault[0].env, undefined, 'production callers pass no env, so gatherFacts defaults to process.env');
});

test('init with lane driver writes driver', () => {
  const dir = runDir();
  initRunManifest(dir, { lane: 'driver', cwd: dir }, { gatherFacts: gather(), stderr: () => {} });
  assert.equal(readManifest(dir).lane, 'driver');
});

test('init with an out-of-vocabulary lane writes unknown', () => {
  const dir = runDir();
  const { stderr, lines } = collector();
  const out = initRunManifest(dir, { lane: 'turbo', cwd: dir }, { gatherFacts: gather(), stderr });
  assert.deepEqual(out, { written: true });
  assert.equal(readManifest(dir).lane, 'unknown');
  assert.deepEqual(lines, []);
});

test('init never overwrites an existing manifest', () => {
  const dir = runDir();
  const existing = '{"v":1,"lane":"express","note":"keep me"}';
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), existing);
  let writes = 0;
  const out = initRunManifest(dir, { lane: 'driver', cwd: dir }, {
    gatherFacts: gather(), writeFileAtomic: () => { writes += 1; }, stderr: () => {},
  });
  assert.deepEqual(out, { written: false });
  assert.equal(writes, 0);
  assert.equal(manifestBytes(dir), existing);
});

test('init uses the atomic writer and leaves no tmp file', () => {
  const dir = runDir();
  const calls = [];
  initRunManifest(dir, { cwd: dir }, {
    gatherFacts: gather(),
    writeFileAtomic: (filePath, content) => { calls.push(filePath); writeFileAtomic(filePath, content); },
    stderr: () => {},
  });
  assert.deepEqual(calls, [path.join(dir, MANIFEST_FILE)]);
  assert.deepEqual(fs.readdirSync(dir), [MANIFEST_FILE]);
});

test('init into a missing run dir returns written:false, creates nothing, and writes one stderr line', () => {
  const parent = scratchDir('run-manifest-write-');
  const dir = path.join(parent, 'gone');
  const { stderr, lines } = collector();
  const out = initRunManifest(dir, { cwd: parent }, { gatherFacts: gather(), stderr });
  assert.deepEqual(out, { written: false });
  assert.equal(fs.existsSync(dir), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^claude-tweaks: run-manifest: .+\n$/);
});

test('init on a read-only directory returns written:false, throws nothing, and writes exactly one stderr line',
  chmodDenialSkip('running as root: chmod cannot deny access'), (t) => {
    const dir = runDir();
    fs.chmodSync(dir, 0o555);
    t.after(() => fs.chmodSync(dir, 0o755));
    const { stderr, lines } = collector();
    const out = initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(), stderr });
    assert.deepEqual(out, { written: false });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^claude-tweaks: run-manifest: .+\n$/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

test('init does not throw when gathering throws', () => {
  const dir = runDir();
  const { stderr, lines } = collector();
  const out = initRunManifest(dir, { cwd: dir }, { gatherFacts: () => { throw new Error('boom'); }, stderr });
  assert.deepEqual(out, { written: false });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /boom/);
});

test('fill sets a null pluginVersion/policyHash/baseCommit/modelProfile and leaves a populated one', () => {
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather({ ...NULL_FACTS, pluginVersion: '6.0.0' }), stderr: () => {} });
  const { stderr, lines } = collector();
  const out = fillRunManifest(dir, {
    pluginVersion: '9.9.9', policyHash: FACTS.policyHash, baseCommit: FACTS.baseCommit, modelProfile: FACTS.modelProfile,
  }, { stderr });
  assert.deepEqual(out.changed.sort(), ['baseCommit', 'modelProfile', 'policyHash']);
  assert.deepEqual(lines, []);
  const got = readManifest(dir);
  assert.equal(got.pluginVersion, '6.0.0', 'a populated field is never overwritten');
  assert.equal(got.policyHash, FACTS.policyHash);
  assert.equal(got.baseCommit, FACTS.baseCommit);
  assert.deepEqual(got.modelProfile, FACTS.modelProfile);
  const again = fillRunManifest(dir, { policyHash: `sha256:${'f'.repeat(64)}`, baseCommit: 'c'.repeat(40) }, { stderr });
  assert.deepEqual(again, { changed: [] });
  assert.equal(readManifest(dir).policyHash, FACTS.policyHash);
  assert.equal(readManifest(dir).baseCommit, FACTS.baseCommit);
});

test('fill replaces lane unknown with standard but never replaces driver or express', () => {
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(), stderr: () => {} });
  assert.deepEqual(fillRunManifest(dir, { lane: 'standard' }, { stderr: () => {} }), { changed: ['lane'] });
  assert.equal(readManifest(dir).lane, 'standard');

  for (const first of ['driver', 'express']) {
    const d = runDir(first);
    initRunManifest(d, { lane: first, cwd: d }, { gatherFacts: gather(), stderr: () => {} });
    for (const later of ['standard', 'express', 'driver']) {
      assert.deepEqual(fillRunManifest(d, { lane: later }, { stderr: () => {} }), { changed: [] });
      assert.equal(readManifest(d).lane, first, `${first} survives a later ${later}`);
    }
  }
  // the first known lane wins even over a later known lane written by fill
  assert.deepEqual(fillRunManifest(dir, { lane: 'express' }, { stderr: () => {} }), { changed: [] });
  assert.equal(readManifest(dir).lane, 'standard');
  // passing unknown never changes anything
  const u = runDir();
  initRunManifest(u, { cwd: u }, { gatherFacts: gather(), stderr: () => {} });
  assert.deepEqual(fillRunManifest(u, { lane: 'unknown' }, { stderr: () => {} }), { changed: [] });
});

test('fill overwrites ceremonyProfile when the value differs and changes no other field', () => {
  const dir = runDir();
  initRunManifest(dir, { lane: 'express', cwd: dir }, { gatherFacts: gather(), stderr: () => {} });
  assert.deepEqual(fillRunManifest(dir, { ceremonyProfile: 'fast-lane' }, { stderr: () => {} }), { changed: ['ceremonyProfile'] });
  assert.equal(readManifest(dir).ceremonyProfile, 'fast-lane');
  const before = readManifest(dir);
  // the downgrade case: a later value replaces the earlier one
  assert.deepEqual(fillRunManifest(dir, { ceremonyProfile: 'standard' }, { stderr: () => {} }), { changed: ['ceremonyProfile'] });
  const after = readManifest(dir);
  assert.equal(after.ceremonyProfile, 'standard');
  assert.deepEqual({ ...after, ceremonyProfile: null }, { ...before, ceremonyProfile: null });
  // the same value is no change
  assert.deepEqual(fillRunManifest(dir, { ceremonyProfile: 'standard' }, { stderr: () => {} }), { changed: [] });
});

test('fill ignores an out-of-vocabulary lane and ceremonyProfile', () => {
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(), stderr: () => {} });
  const before = manifestBytes(dir);
  const out = fillRunManifest(dir, { lane: 'turbo', ceremonyProfile: 'ludicrous' }, { stderr: () => {} });
  assert.deepEqual(out, { changed: [] });
  assert.equal(manifestBytes(dir), before);
});

test('fill creates a missing manifest in an existing run dir with only the passed fields set and every other unknown field null, and calls no gatherFacts', () => {
  const dir = runDir('spec-7');
  let gathered = 0;
  const { stderr, lines } = collector();
  const out = fillRunManifest(dir, { ceremonyProfile: 'fast-lane', baseCommit: FACTS.baseCommit }, {
    gatherFacts: () => { gathered += 1; return { ...FACTS }; }, now: () => new Date('2026-11-19T08:00:00.000Z'), stderr,
  });
  assert.deepEqual(out.changed.sort(), ['baseCommit', 'ceremonyProfile']);
  assert.equal(gathered, 0);
  assert.deepEqual(lines, []);
  const got = readManifest(dir);
  assert.deepEqual(Object.keys(got), NINE_KEYS);
  assert.deepEqual(got, {
    baseCommit: FACTS.baseCommit,
    ceremonyProfile: 'fast-lane',
    createdAt: '2026-11-19T08:00:00.000Z',
    lane: 'unknown',
    modelProfile: null,
    pluginVersion: null,
    policyHash: null,
    runId: path.basename(dir),
    v: 1,
  });
  assert.deepEqual(fs.readdirSync(dir), [MANIFEST_FILE]);
  const withLane = runDir();
  fillRunManifest(withLane, { lane: 'express' }, { stderr: () => {} });
  assert.equal(readManifest(withLane).lane, 'express');
});

test('fill creates no manifest on a missing manifest when nothing valid was passed', () => {
  for (const fields of [{}, { lane: 'turbo' }, { lane: 'unknown' }, { ceremonyProfile: 'ludicrous' }]) {
    const dir = runDir();
    const { stderr, lines } = collector();
    assert.deepEqual(fillRunManifest(dir, fields, { stderr }), { changed: [] }, JSON.stringify(fields));
    assert.deepEqual(fs.readdirSync(dir), [], `${JSON.stringify(fields)}: no file is created`);
    assert.deepEqual(lines, []);
  }
});

test('fill into a multi-spec spec-N child dir creates no manifest, but fills one that already exists', () => {
  const parent = scratchDir('run-manifest-write-');
  const child = path.join(parent, 'spec-3');
  fs.mkdirSync(child);
  const { stderr, lines } = collector();
  assert.deepEqual(fillRunManifest(child, { ceremonyProfile: 'fast-lane', lane: 'standard' }, { stderr }), { changed: [] });
  assert.deepEqual(fs.readdirSync(child), [], 'a spec-N child dir is never given a manifest');
  assert.deepEqual(lines, []);

  const held = path.join(parent, 'spec-4');
  fs.mkdirSync(held);
  fs.writeFileSync(path.join(held, MANIFEST_FILE), JSON.stringify({ v: 1, lane: 'unknown', ceremonyProfile: null }));
  assert.deepEqual(fillRunManifest(held, { ceremonyProfile: 'standard' }, { stderr }).changed, ['ceremonyProfile']);
  assert.equal(readManifest(held).ceremonyProfile, 'standard');

  // only the exact spec-N basename is a child dir: a run id ending in spec-N still gets its manifest
  const run = runDir('spec-3');
  assert.deepEqual(fillRunManifest(run, { lane: 'standard' }, { stderr }), { changed: ['lane'] });
});

test('fill accepts the four fill-only-null facts only in their documented shapes', () => {
  const valid = {
    pluginVersion: '6.174.0',
    policyHash: `sha256:${'a'.repeat(64)}`,
    baseCommit: 'b'.repeat(40),
    modelProfile: { stance: 'max-rigor', ceiling: null },
  };
  const wrong = [
    ['pluginVersion', 42],
    ['pluginVersion', ''],
    ['policyHash', 'sha256:abc'],
    ['policyHash', 'a'.repeat(64)],
    ['baseCommit', 'b'.repeat(39)],
    ['baseCommit', 'B'.repeat(40)],
    ['modelProfile', 'default'],
    ['modelProfile', ['default']],
    ['modelProfile', { stance: 'balanced', ceiling: null }],
    ['modelProfile', { stance: 'default', ceiling: 7 }],
  ];
  for (const [key, value] of wrong) {
    const dir = runDir();
    initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(NULL_FACTS), stderr: () => {} });
    assert.deepEqual(fillRunManifest(dir, { [key]: value }, { stderr: () => {} }), { changed: [] }, `${key}=${JSON.stringify(value)}`);
    assert.equal(readManifest(dir)[key], null, `${key}=${JSON.stringify(value)} is never written`);
  }
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(NULL_FACTS), stderr: () => {} });
  assert.deepEqual(fillRunManifest(dir, valid, { stderr: () => {} }).changed.sort(), Object.keys(valid).sort());
  assert.deepEqual(readManifest(dir).modelProfile, valid.modelProfile);
});

test('fill leaves a manifest whose content is JSON null untouched, with one stderr line', () => {
  const dir = runDir();
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), 'null\n');
  const { stderr, lines } = collector();
  assert.deepEqual(fillRunManifest(dir, { lane: 'standard' }, { stderr }), { changed: [] });
  assert.equal(manifestBytes(dir), 'null\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /not a JSON object/);
});

test('fill does not create a missing run dir', () => {
  const parent = scratchDir('run-manifest-write-');
  const dir = path.join(parent, 'gone');
  const { stderr, lines } = collector();
  let writes = 0;
  const out = fillRunManifest(dir, { lane: 'standard' }, { stderr, writeFileAtomic: () => { writes += 1; } });
  assert.deepEqual(out, { changed: [] });
  assert.equal(writes, 0, 'no write is attempted into a directory that is not there');
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(fs.readdirSync(parent), []);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^claude-tweaks: run-manifest: run directory does not exist/);
});

test('fill leaves a corrupt manifest untouched', () => {
  const cases = [
    ['garbage bytes', 'not json {{{'],
    ['an empty file', ''],
    ['a JSON array', '[1,2,3]'],
    ['JSON null', 'null'],
  ];
  for (const [label, bytes] of cases) {
    const dir = runDir();
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), bytes);
    const { stderr, lines } = collector();
    const out = fillRunManifest(dir, { lane: 'standard', policyHash: FACTS.policyHash }, { stderr });
    assert.deepEqual(out, { changed: [] }, label);
    assert.equal(manifestBytes(dir), bytes, `${label}: bytes untouched`);
    assert.equal(lines.length, 1, `${label}: exactly one stderr line`);
    assert.match(lines[0], /^claude-tweaks: run-manifest: .+\n$/, label);
    assert.deepEqual(fs.readdirSync(dir), [MANIFEST_FILE], `${label}: no tmp file`);
  }
});

test('fill preserves v:2 and unknown fields', () => {
  const dir = runDir();
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({ v: 2, x: { b: 2, a: 1 } }));
  const out = fillRunManifest(dir, { lane: 'driver' }, { stderr: () => {} });
  assert.deepEqual(out, { changed: ['lane'] });
  const got = readManifest(dir);
  assert.equal(got.v, 2);
  assert.deepEqual(got.x, { a: 1, b: 2 });
  assert.equal(got.lane, 'driver');
  assert.deepEqual(Object.keys(got), ['lane', 'v', 'x'], 'no field is invented for a file the writer did not mint');
});

test('two sequential fills of different fields both survive', () => {
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(NULL_FACTS), stderr: () => {} });
  fillRunManifest(dir, { policyHash: FACTS.policyHash }, { stderr: () => {} });
  fillRunManifest(dir, { baseCommit: FACTS.baseCommit, ceremonyProfile: 'standard' }, { stderr: () => {} });
  const got = readManifest(dir);
  assert.equal(got.policyHash, FACTS.policyHash);
  assert.equal(got.baseCommit, FACTS.baseCommit);
  assert.equal(got.ceremonyProfile, 'standard');
  assert.equal(got.pluginVersion, null);
  assert.deepEqual(Object.keys(got), NINE_KEYS);
});

test('fill uses the atomic writer and leaves no tmp file', () => {
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(NULL_FACTS), stderr: () => {} });
  const calls = [];
  fillRunManifest(dir, { baseCommit: FACTS.baseCommit }, {
    writeFileAtomic: (filePath, content) => { calls.push(filePath); writeFileAtomic(filePath, content); }, stderr: () => {},
  });
  assert.deepEqual(calls, [path.join(dir, MANIFEST_FILE)]);
  assert.deepEqual(fs.readdirSync(dir), [MANIFEST_FILE]);
});

test('fill that changes nothing does not rewrite the file', () => {
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(), stderr: () => {} });
  let writes = 0;
  const out = fillRunManifest(dir, { pluginVersion: '1.2.3' }, { writeFileAtomic: () => { writes += 1; }, stderr: () => {} });
  assert.deepEqual(out, { changed: [] });
  assert.equal(writes, 0);
});

test('a directory holding only manifest.json still has no decisions.md, run-state.json or config.yml', () => {
  const dir = runDir();
  initRunManifest(dir, { cwd: dir }, { gatherFacts: gather(), stderr: () => {} });
  fillRunManifest(dir, { lane: 'standard' }, { stderr: () => {} });
  assert.deepEqual(fs.readdirSync(dir), [MANIFEST_FILE]);
  for (const name of ['decisions.md', 'run-state.json', 'config.yml']) {
    assert.equal(fs.existsSync(path.join(dir, name)), false, name);
  }
});

const TOK = { input: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 0 };
const group = (over = {}) => ({
  tokensByModel: { 'claude-opus-5-5': TOK }, costUsd: 1.25, priceDate: '2026-11-01', unpricedModels: [], costPartial: false, ...over,
});
const UNREAD = { tokensByModel: null, costUsd: null, priceDate: null, unpricedModels: null, costPartial: null };
const quiet = { stderr: () => {} };

test('close-out vocabulary constants', () => {
  assert.deepEqual(CLOSE_FIELDS, ['closedAt', 'minutes']);
  assert.deepEqual(COST_GROUP, ['tokensByModel', 'costUsd', 'priceDate', 'unpricedModels', 'costPartial']);
});

test('AC8.1: a pre-change nine-field manifest filled at close gains the fields and keeps v 1 and its values', () => {
  const dir = runDir('spec-9');
  initRunManifest(dir, { lane: 'standard' }, { gatherFacts: gather(), now: () => new Date('2026-11-19T07:31:30.000Z'), stderr: () => {} });
  const before = readManifest(dir);
  assert.deepEqual(Object.keys(before), NINE_KEYS);
  const out = fillRunManifest(dir, { closedAt: '2026-11-19T08:00:00.000Z', minutes: 28.5, cost: group() }, quiet);
  assert.deepEqual(out.changed.sort(), ['closedAt', 'costPartial', 'costUsd', 'minutes', 'priceDate', 'tokensByModel', 'unpricedModels']);
  const after = readManifest(dir);
  assert.equal(after.v, 1);
  for (const k of NINE_KEYS) assert.deepEqual(after[k], before[k]);
  assert.equal(after.closedAt, '2026-11-19T08:00:00.000Z');
  assert.equal(after.minutes, 28.5);
  assert.deepEqual(after.tokensByModel, group().tokensByModel);
  assert.equal(after.costUsd, 1.25);
});

test('AC8.2: MANIFEST_VERSION is still 1', () => {
  assert.equal(MANIFEST_VERSION, 1);
});

test('AC8.3: a stored partial group is replaced by a later complete group', () => {
  for (const stored of [group({ costPartial: true }), UNREAD]) {
    const dir = runDir();
    fillRunManifest(dir, { cost: stored }, quiet);
    const next = group({ costUsd: 9.5 });
    const out = fillRunManifest(dir, { cost: next }, quiet);
    assert.ok(out.changed.includes('costUsd'));
    assert.equal(readManifest(dir).costUsd, 9.5);
    assert.equal(readManifest(dir).costPartial, false);
  }
});

test('AC8.4: a stored complete group is not replaced by a later complete or partial group', () => {
  const dir = runDir();
  fillRunManifest(dir, { cost: group() }, quiet);
  const before = manifestBytes(dir);
  assert.deepEqual(fillRunManifest(dir, { cost: group({ costUsd: 7 }) }, quiet), { changed: [] });
  assert.deepEqual(fillRunManifest(dir, { cost: group({ costUsd: 7, costPartial: true }) }, quiet), { changed: [] });
  assert.equal(manifestBytes(dir), before);
});

test('AC8.5: a stored partial group is not replaced by another partial group', () => {
  const dir = runDir();
  fillRunManifest(dir, { cost: group({ costPartial: true }) }, quiet);
  const before = manifestBytes(dir);
  assert.deepEqual(fillRunManifest(dir, { cost: group({ costUsd: 7, costPartial: true }) }, quiet), { changed: [] });
  assert.equal(manifestBytes(dir), before);
});

test('AC8.5b: a stored unread group yields to a partial read group, which no other partial replaces', () => {
  const dir = runDir();
  fillRunManifest(dir, { cost: UNREAD }, quiet);
  const partial = group({ costUsd: 2, costPartial: true });
  assert.ok(fillRunManifest(dir, { cost: partial }, quiet).changed.includes('costUsd'));
  assert.equal(readManifest(dir).costPartial, true);
  const before = manifestBytes(dir);
  assert.deepEqual(fillRunManifest(dir, { cost: group({ costUsd: 8, costPartial: true }) }, quiet), { changed: [] });
  assert.deepEqual(fillRunManifest(dir, { cost: UNREAD }, quiet), { changed: [] });
  assert.equal(manifestBytes(dir), before);
});

test('an identical group writes nothing', () => {
  const dir = runDir();
  fillRunManifest(dir, { cost: UNREAD }, quiet);
  const before = manifestBytes(dir);
  assert.deepEqual(fillRunManifest(dir, { cost: { ...UNREAD } }, quiet), { changed: [] });
  assert.equal(manifestBytes(dir), before);
});

test('closedAt and minutes are fill-only-null', () => {
  const dir = runDir();
  fillRunManifest(dir, { closedAt: '2026-11-19T08:00:00.000Z', minutes: 3 }, quiet);
  assert.deepEqual(fillRunManifest(dir, { closedAt: '2026-11-20T08:00:00.000Z', minutes: 9 }, quiet), { changed: [] });
  assert.equal(readManifest(dir).closedAt, '2026-11-19T08:00:00.000Z');
  assert.equal(readManifest(dir).minutes, 3);
  const zero = runDir();
  fillRunManifest(zero, { minutes: 0 }, quiet);
  assert.equal(readManifest(zero).minutes, 0);
  const bad = runDir();
  assert.deepEqual(fillRunManifest(bad, { closedAt: 'not a date', minutes: -1 }, quiet), { changed: [] });
  assert.deepEqual(fillRunManifest(bad, { closedAt: 5, minutes: Infinity }, quiet), { changed: [] });
  assert.deepEqual(fillRunManifest(bad, { closedAt: null, minutes: null }, quiet), { changed: [] });
});

test('an invalid cost group is ignored', () => {
  const bads = [
    group({ costUsd: -1 }), group({ costUsd: NaN }), group({ costUsd: '1' }), group({ priceDate: 5 }),
    group({ unpricedModels: [1] }), group({ unpricedModels: 'x' }), group({ costPartial: 'no' }),
    group({ tokensByModel: { m: { ...TOK, input: -1 } } }), group({ tokensByModel: { m: { input: 1 } } }),
    group({ tokensByModel: [TOK] }), group({ costUsd: null, costPartial: true }),
    group({ costUsd: 3, costPartial: null }), { ...UNREAD, costUsd: 0 }, { ...UNREAD, priceDate: '2026-11-01' }, { costUsd: 1 }, 'x', [],
  ];
  for (const bad of bads) {
    const dir = runDir();
    assert.deepEqual(fillRunManifest(dir, { cost: bad }, quiet), { changed: [] });
    assert.equal(fs.existsSync(path.join(dir, MANIFEST_FILE)), false);
  }
});
