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
const { KEY_PATHS, SCHEMA_VERSION } = require('../../../plugin/bin/lib/timing/step-yield');
const { PAIR_FORMS } = require('../../../plugin/bin/lib/timing/pair-lines');
const { DECISION_STATUSES } = require('../../../plugin/bin/lib/log-decision/append');

const ROOT = path.join(__dirname, '..', '..', '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'step-yield.md'), 'utf8');
const FIX = path.join(ROOT, 'tests', 'fixtures', 'step-yield');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(FIX, 'key-paths.golden.json'), 'utf8'));
const OUTPUT = JSON.parse(fs.readFileSync(path.join(FIX, 'review-run.expected.json'), 'utf8'));

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
function undocumentedPaths(output, keyPaths) {
  const known = new Set(keyPaths.map((k) => k.path));
  return [...paths(output)].filter((p) => !known.has(p));
}

function goldenDiff(keyPaths, schemaVersion, golden) {
  if (schemaVersion !== golden.schemaVersion) return null;
  try { assert.deepStrictEqual(JSON.parse(JSON.stringify(keyPaths)), golden.keyPaths); return null; } catch (e) { return e; }
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
  assert.deepEqual(undocumentedPaths(OUTPUT, KEY_PATHS), []);
  // The walk really maps concrete keys to patterns.
  const walked = paths(OUTPUT);
  assert.ok(walked.has('steps[].decisions.<status>'));
  assert.ok(walked.has('steps[].commits.<action>'));
  assert.ok(walked.has('steps[].findings.byLens.<lens>.tiebreak.byOutcome.<outcome>'));
  // Every status key the output carries is a DECISION_STATUSES entry, and all of them are present.
  const statusKeys = Object.keys(OUTPUT.steps[0].decisions).sort();
  assert.deepEqual(statusKeys, [...DECISION_STATUSES].sort());
});

test('AC8.2 go-red: an output with one extra key is reported', () => {
  const extra = JSON.parse(JSON.stringify(OUTPUT));
  extra.steps[0].newCounter = 3;
  assert.deepEqual(undocumentedPaths(extra, KEY_PATHS), ['steps[].newCounter']);
  const extraTop = { ...JSON.parse(JSON.stringify(OUTPUT)), surprise: { nested: 1 } };
  assert.deepEqual(undocumentedPaths(extraTop, KEY_PATHS), ['surprise.nested']);
});

test('AC8.3: golden key paths and nullability', () => {
  assert.equal(typeof GOLDEN.schemaVersion, 'number');
  const diff = goldenDiff(KEY_PATHS, SCHEMA_VERSION, GOLDEN);
  assert.equal(diff, null, 'a key was removed or its type/nullability changed: bump SCHEMA_VERSION and note it in docs/reference/step-yield.md');
});

test('AC8.3 go-red: a KEY_PATHS copy with one entry removed or retyped fails the golden comparison', () => {
  const removed = KEY_PATHS.slice(1);
  assert.notEqual(goldenDiff(removed, SCHEMA_VERSION, GOLDEN), null);
  const retyped = KEY_PATHS.map((k, i) => (i === 0 ? { ...k, nullable: !k.nullable } : k));
  assert.notEqual(goldenDiff(retyped, SCHEMA_VERSION, GOLDEN), null);
  // A schemaVersion bump is the sanctioned way to change the shape.
  assert.equal(goldenDiff(removed, SCHEMA_VERSION + 1, GOLDEN), null);
});
