'use strict';
// tests/bin-lib/timing/step-yield-schema.test.js — #5556: docs/reference/step-yield.md and
// tests/fixtures/step-yield/key-paths.golden.json are pinned to step-yield.js's KEY_PATHS.
//
// The AC1 fixture output is tests/fixtures/step-yield/review-run.expected.json, the file
// step-yield.test.js already compares deriveStepYield's real output against, so the key walk
// here sees the keys a real derivation emits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { KEY_PATHS, SCHEMA_VERSION, deriveStepYield } = require('../../../plugin/bin/lib/timing/step-yield');
const { PAIR_FORMS } = require('../../../plugin/bin/lib/timing/pair-lines');
const { DECISION_STATUSES, formatEntry, hms } = require('../../../plugin/bin/lib/log-decision/append');
const { appendEvent } = require('../../../plugin/bin/lib/hooks/context');
const { readText } = require('../../helpers/read-skill');

const ROOT = path.join(__dirname, '..', '..', '..');
const DOC = readText(path.join(ROOT, 'docs', 'reference', 'step-yield.md'));
const FIX = path.join(ROOT, 'tests', 'fixtures', 'step-yield');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(FIX, 'key-paths.golden.json'), 'utf8'));

// A live deriveStepYield over a run built here, so the key walk sees what the function emits, not a
// committed copy of an earlier output. It reaches every bucket-level path of both a step and
// `unattributed`: commits, a joined and an orphan question, findings, unparsed samples, and the
// top-level unparsed (a malformed event line).
const BASE = Date.UTC(2026, 10, 12, 9, 0, 0);
const at = (sec) => new Date(BASE + sec * 1000);
function atClock(when, fn) {
  const Real = Date;
  class Frozen extends Real {
    constructor(...args) { if (args.length === 0) super(when.getTime()); else super(...args); }
    static now() { return when.getTime(); }
  }
  global.Date = Frozen;
  try { return fn(); } finally { global.Date = Real; }
}
function liveYield() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-step-yield-schema-'));
  const events = [
    [0, 'skill_invoked', { skill: 'claude-tweaks:build' }], [60, 'commit', { action: 'push' }],
    [600, 'skill_invoked', { skill: 'claude-tweaks:test' }], [660, 'verify', { mode: 'full', pass: true, durationMs: 1000, suitesRun: [] }],
    [1200, 'skill_invoked', { skill: 'claude-tweaks:review' }],
    [1500, 'ask-user-question', { toolUseId: 'toolu_q1', questions: [{ header: 'Merge', question: 'Merge now?', options: [] }], response: 'yes' }],
    [2400, 'skill_invoked', { skill: 'claude-tweaks:wrap-up' }], [2700, 'close-run', {}],
    [5000, 'commit', { action: 'after-close' }], [5100, 'verify', { pass: false }],
  ];
  for (const [sec, type, data] of events) atClock(at(sec), () => appendEvent(dir, type, data));
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{broken\n');
  const line = (sec, status, step, text) => formatEntry({ status, now: at(sec), step, text, reversibility: 'high' });
  fs.writeFileSync(path.join(dir, 'decisions.md'), [
    line(1210, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.'),
    line(1220, 'STAGED', 'Reproduction', 'lens "3b" finding plugin/b.js:20 not reproduced. Staged to Review Console as low-confidence.'),
    `- AUTO ${hms(at(1280))} — Reproduction: lens "3a" mystery shape.`,
    // three hours past the run window: no local day places it, so it is unattributed
    line(1210 + 3 * 3600, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/far.js:1 reproduced. Confirmed.'),
    `- AUTO ${hms(at(1300 + 3 * 3600))} — Reproduction: lens "3a" far mystery shape.`,
  ].join('\n') + '\n');
  fs.copyFileSync(path.join(FIX, 'review-run', 'run-state.json'), path.join(dir, 'run-state.json'));
  const timing = JSON.parse(fs.readFileSync(path.join(FIX, 'review-run', 'timing.json'), 'utf8'));
  timing.questions.push({ id: 'toolu_orphan', askTs: at(9000).toISOString(), questions: ['Asked after the run?'] });
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  try {
    return deriveStepYield(dir, { now: at(3000) });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// Derived on first use, inside the tests that need it: a throw fails those tests by name, not the whole file at load.
let liveOutput;
const output = () => (liveOutput === undefined ? (liveOutput = liveYield()) : liveOutput);

// Concrete output -> the set of KEY_PATHS-style leaf paths: the keys under a map-valued
// field (commits, events, decisions, byVerdict, byOutcome, byLens) become their pattern.
const MAPS = { commits: '<action>', events: '<type>', decisions: '<status>', byVerdict: '<verdict>', byOutcome: '<outcome>', byLens: '<lens>' };
// Entries of an object under a map-valued key take the pattern as their own name.
function paths(y) {
  const out = new Set();
  const go = (v, p, label) => {
    if (Array.isArray(v)) { for (const x of v) go(x, `${p}[]`, label); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) go(x, `${p}${p ? '.' : ''}${label || k}`, label ? null : (MAPS[k] || null));
      return;
    }
    out.add(p);
  };
  go(y, '', null);
  return out;
}

// A walked leaf path is documented when it is a KEY_PATHS entry.
function undocumentedPaths(out, keyPaths) {
  const known = new Set(keyPaths.map((k) => k.path));
  return [...paths(out)].filter((p) => !known.has(p));
}

// Concrete output -> [{ path, value }] for every leaf and every object value, named as paths() names them.
function nodes(y) {
  const out = [];
  const go = (v, p, label) => {
    if (Array.isArray(v)) { for (const x of v) go(x, `${p}[]`, label); return; }
    out.push({ path: p, value: v });
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) go(x, `${p}${p ? '.' : ''}${label || k}`, label ? null : (MAPS[k] || null));
    }
  };
  go(y, '', null);
  return out;
}

// Every declared path's emitted value has the declared type, and null only where it is nullable. A
// node with no KEY_PATHS entry (a map or a container object) has nothing declared to check here: an
// undeclared leaf is undocumentedPaths' finding.
function typeProblems(out, keyPaths) {
  const declared = new Map(keyPaths.map((k) => [k.path, k]));
  const problems = [];
  for (const { path: p, value } of nodes(out)) {
    const k = declared.get(p);
    if (!k) continue;
    if (value === null) { if (!k.nullable) problems.push(`${p}: null but not nullable`); continue; }
    if (typeof value !== k.type) problems.push(`${p}: ${typeof value} but declared ${k.type}`);
  }
  return problems;
}

// The golden is always diffed: a SCHEMA_VERSION bump does not switch the comparison off, it
// obliges whoever bumps it to regenerate the golden (and so the diff is what they review).
const BUMPED = 'SCHEMA_VERSION changed: regenerate the golden and note the change in docs/reference/step-yield.md';
function goldenDiff(keyPaths, schemaVersion, golden) {
  try { assert.deepStrictEqual(JSON.parse(JSON.stringify(keyPaths)), golden.keyPaths); } catch (e) { return e; }
  return schemaVersion === golden.schemaVersion ? null : new Error(BUMPED);
}

test('AC8.1: step-yield.md names every key path', () => {
  const missing = KEY_PATHS.map((k) => k.path).filter((p) => !DOC.includes(`\`${p}\``) && !DOC.includes(`\`${p.replace(/^steps\[\]/, 'unattributed')}\``));
  assert.deepEqual(missing, []);
  // The bucket paths are listed for both steps[] and unattributed.
  for (const k of KEY_PATHS.filter((x) => x.path.startsWith('steps[]') && !/^steps\[\]\.(phase|start|end|minutes|ownMinutes|tokens|agents)/.test(x.path))) {
    const twin = k.path.replace(/^steps\[\]/, 'unattributed');
    assert.ok(DOC.includes(`\`${k.path}\``), `${k.path} missing from the doc`);
    assert.ok(DOC.includes(`\`${twin}\``), `${twin} missing from the doc`);
  }
});

test('AC8.1: the doc names every status, every pair form and the compatibility rule', () => {
  for (const s of DECISION_STATUSES) assert.ok(DOC.includes(`\`${s}\``), `status ${s} missing from the doc`);
  assert.deepEqual(PAIR_FORMS.map((f) => f.id).filter((id) => !DOC.includes(`| \`${id}\` |`)), []);
  assert.match(DOC, /`DECISION_STATUSES`[\s\S]*`plugin\/bin\/lib\/log-decision\/append\.js`/);
  assert.match(DOC, /A field is added, never renamed/);
  assert.match(DOC, /`schemaVersion` bump/);
});

test('AC8.2: a key the function emits that the doc does not name fails', () => {
  assert.deepEqual(undocumentedPaths(output(), KEY_PATHS), []);
  // Every emitted value has its declared type, and null appears only where the path is nullable.
  assert.deepEqual(typeProblems(output(), KEY_PATHS), []);
  const emitted = nodes(output());
  assert.ok(emitted.some((n) => n.path === 'steps[].findings' && n.value === null), 'the live run reaches a null nullable path');
  assert.ok(emitted.some((n) => n.path === 'steps[].findings' && n.value !== null && typeof n.value === 'object'), 'and an object-typed one');
  // The walk really maps concrete keys to patterns.
  const walked = paths(output());
  assert.ok(walked.has('steps[].decisions.<status>'));
  assert.ok(walked.has('steps[].commits.<action>'));
  assert.ok(walked.has('steps[].findings.byLens.<lens>.tiebreak.byOutcome.<outcome>'));
  // The live run reaches the unattributed bucket's own paths and both unparsed sample lists.
  for (const p of ['unattributed.commits.<action>', 'unattributed.questions[].question', 'unattributed.questions[].askedAt', 'unattributed.questions[].answeredAt',
    'unattributed.questions[].waitedMinutes', 'unattributed.questions[].askSource', 'unattributed.findings.raised', 'unattributed.findings.byLens.<lens>.one',
    'unattributed.unparsed.samples[]', 'steps[].unparsed.samples[]', 'unparsed.samples[]', 'steps[].questions[].waitedMinutes', 'steps[].tokens.input']) {
    assert.ok(walked.has(p), `the live fixture run does not reach ${p}`);
  }
  // Every status key the output carries is a DECISION_STATUSES entry, and all of them are present.
  const statusKeys = Object.keys(output().steps[0].decisions).sort();
  assert.deepEqual(statusKeys, [...DECISION_STATUSES].sort());
});

test('AC8.2 go-red: an output with one extra key is reported', () => {
  const extra = JSON.parse(JSON.stringify(output()));
  extra.steps[0].newCounter = 3;
  assert.deepEqual(undocumentedPaths(extra, KEY_PATHS), ['steps[].newCounter']);
  const extraTop = { ...JSON.parse(JSON.stringify(output())), surprise: { nested: 1 } };
  assert.deepEqual(undocumentedPaths(extraTop, KEY_PATHS), ['surprise.nested']);
});

test('AC8.2 go-red: a value of the wrong type, or a null on a non-nullable path, is reported', () => {
  const bad = JSON.parse(JSON.stringify(output()));
  bad.steps[0].minutes = '10';
  bad.steps[0].phase = null;
  bad.steps[0].decisions.AUTO = null;
  assert.deepEqual(typeProblems(bad, KEY_PATHS), [
    'steps[].phase: null but not nullable',
    'steps[].minutes: string but declared number',
    'steps[].decisions.<status>: null but not nullable',
  ]);
});

test('AC8.3: golden key paths and nullability', () => {
  assert.equal(typeof GOLDEN.schemaVersion, 'number');
  const diff = goldenDiff(KEY_PATHS, SCHEMA_VERSION, GOLDEN);
  assert.equal(diff, null, 'a key was removed or its type/nullability changed: bump SCHEMA_VERSION and note it in docs/reference/step-yield.md');
  assert.equal(GOLDEN.schemaVersion, SCHEMA_VERSION, BUMPED);
});

test('AC8.3 go-red: a KEY_PATHS copy with one entry removed or retyped fails the golden comparison', () => {
  const removed = KEY_PATHS.slice(1);
  assert.notEqual(goldenDiff(removed, SCHEMA_VERSION, GOLDEN), null);
  const retyped = KEY_PATHS.map((k, i) => (i === 0 ? { ...k, nullable: !k.nullable } : k));
  assert.notEqual(goldenDiff(retyped, SCHEMA_VERSION, GOLDEN), null);
  // A schemaVersion bump does not switch the comparison off: the same removal still fails after one,
  // and a bump with an unregenerated golden fails on its own.
  assert.notEqual(goldenDiff(removed, SCHEMA_VERSION + 1, GOLDEN), null);
  assert.notEqual(goldenDiff(retyped, SCHEMA_VERSION + 1, GOLDEN), null);
  const stale = goldenDiff(KEY_PATHS, SCHEMA_VERSION + 1, GOLDEN);
  assert.match(String(stale && stale.message), /SCHEMA_VERSION changed: regenerate the golden/);
});
