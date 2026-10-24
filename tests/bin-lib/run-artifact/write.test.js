'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ARTIFACT_NAMES, isArtifactName, writeArtifact, deleteArtifact } = require('../../../plugin/bin/lib/run-artifact/write');

const NAME = 'sdd-dispatch-sample.txt';

function tmpRunDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('isArtifactName accepts only the allowlist', () => {
  assert.equal(isArtifactName(NAME), true);
  assert.equal(isArtifactName('decisions.md'), false);
  assert.equal(isArtifactName('config.yml'), false);
  assert.equal(isArtifactName('../sdd-dispatch-sample.txt'), false);
  assert.equal(isArtifactName('staged/sdd-dispatch-sample.txt'), false);
  assert.equal(isArtifactName(''), false);
  assert.equal(isArtifactName(undefined), false);
});

test('writeArtifact round-trips content byte-identically', (t) => {
  const runDir = tmpRunDir(t);
  const content = 'line `one` $HOME "q" \'s\'\n— two\n';
  const r = writeArtifact({ runDir, name: NAME, content });
  assert.equal(r.file, path.join(runDir, NAME));
  assert.equal(fs.readFileSync(r.file, 'utf8'), content);
});

test('writeArtifact overwrites in place and leaves no tmp file', (t) => {
  const runDir = tmpRunDir(t);
  writeArtifact({ runDir, name: NAME, content: 'a' });
  const r = writeArtifact({ runDir, name: NAME, content: 'b' });
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'b');
  assert.deepEqual(fs.readdirSync(runDir), [NAME]);
});

test('writeArtifact refuses a non-allowlisted name', (t) => {
  const runDir = tmpRunDir(t);
  assert.throws(() => writeArtifact({ runDir, name: 'decisions.md', content: 'x' }));
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false);
});

test('deleteArtifact removes and is idempotent', (t) => {
  const runDir = tmpRunDir(t);
  writeArtifact({ runDir, name: NAME, content: 'a' });
  const first = deleteArtifact({ runDir, name: NAME });
  assert.equal(first.existed, true);
  assert.equal(fs.existsSync(path.join(runDir, NAME)), false);
  const second = deleteArtifact({ runDir, name: NAME });
  assert.equal(second.existed, false);
});

test('deleteArtifact refuses a non-allowlisted name', (t) => {
  const runDir = tmpRunDir(t);
  assert.throws(() => deleteArtifact({ runDir, name: 'config.yml' }));
});

test('#3496: sdd-final-review.md is allowlisted; traversal forms of it are not', (t) => {
  const runDir = tmpRunDir(t);
  const name = 'sdd-final-review.md';
  assert.equal(isArtifactName(name), true);
  assert.equal(isArtifactName('../sdd-final-review.md'), false);
  assert.equal(isArtifactName('staged/sdd-final-review.md'), false);
  const content = 'line `one` $HOME "q" \'s\'\n— two\n';
  const r = writeArtifact({ runDir, name, content });
  assert.equal(r.file, path.join(runDir, name));
  assert.equal(fs.readFileSync(r.file, 'utf8'), content);
});

test('#3945: review-findings.json is allowlisted; traversal forms of it are not', (t) => {
  const runDir = tmpRunDir(t);
  const name = 'review-findings.json';
  assert.equal(isArtifactName(name), true);
  assert.equal(isArtifactName('../review-findings.json'), false);
  assert.equal(isArtifactName('staged/review-findings.json'), false);
  const content = '[{"id":"abc123def456","lens":"x","path":"p.js","line":1,"claim":"c","reporterSeverity":"high","kind":"unconfirmed"}]\n';
  const r = writeArtifact({ runDir, name, content });
  assert.equal(r.file, path.join(runDir, name));
  assert.equal(fs.readFileSync(r.file, 'utf8'), content);
});

test('ARTIFACT_NAMES is exactly the allowlist (#3496, #3945)', () => {
  assert.deepEqual([...ARTIFACT_NAMES], ['sdd-dispatch-sample.txt', 'sdd-final-review.md', 'review-findings.json']);
});
