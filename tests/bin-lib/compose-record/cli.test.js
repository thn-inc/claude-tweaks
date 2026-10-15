'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/compose-record');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compose-record-'));
}

function deps(out) {
  return { stdout: (s) => out.push(['out', s]), stderr: (s) => out.push(['err', s]) };
}

const streamOf = (out, kind) => out.filter((o) => o[0] === kind).map((o) => o[1]).join('');

const SHAPED_PAYLOAD = {
  title: 'A title',
  body: '## Current State\n\ntext\n\n## Deliverables\n\n- [ ] thing\n\n## Acceptance Criteria\n\n1. done\n\n## Release Note\n\nDid the thing.',
  type: 'feature',
  fingerprint: 'design-x:unit-y',
};

test('composes and writes the body; prints the envelope', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  const outFile = path.join(dir, 'body.md');
  fs.writeFileSync(payloadFile, JSON.stringify(SHAPED_PAYLOAD));
  const out = [];
  const code = run([payloadFile, '--out', outFile], deps(out));
  assert.equal(code, 0);
  const written = fs.readFileSync(outFile, 'utf8');
  assert.match(written, /## Current State/);
  assert.match(written, /<!-- work-fingerprint: design-x:unit-y -->\nwork-fingerprint: design-x:unit-y$/);
  const envelope = JSON.parse(streamOf(out, 'out'));
  assert.equal(envelope.title, 'A title');
  assert.equal(envelope.type, 'feature');
  assert.equal(envelope.out, outFile);
});

test('escaping-safety: quotes, backticks, newlines, and $() in title/body survive verbatim', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  const outFile = path.join(dir, 'body.md');
  const tricky = {
    title: `A "quoted" title with \`backticks\` and $(rm -rf /)`,
    body: '## Current State\n\nline one\nline two with `code` and "quotes" and $(danger)\n\n## Deliverables\n\n- [ ] x\n\n## Acceptance Criteria\n\n1. y',
    type: 'bug',
  };
  fs.writeFileSync(payloadFile, JSON.stringify(tricky));
  const code = run([payloadFile, '--out', outFile], deps([]));
  assert.equal(code, 0);
  const written = fs.readFileSync(outFile, 'utf8');
  assert.match(written, /line two with `code` and "quotes" and \$\(danger\)/);
});

test('--require-shaped: passes a well-shaped body', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  const outFile = path.join(dir, 'body.md');
  fs.writeFileSync(payloadFile, JSON.stringify(SHAPED_PAYLOAD));
  const code = run([payloadFile, '--out', outFile, '--require-shaped'], deps([]));
  assert.equal(code, 0);
});

test('--require-shaped: fails (exit 4) and lists gaps for an unshaped body', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  const outFile = path.join(dir, 'body.md');
  fs.writeFileSync(payloadFile, JSON.stringify({ title: 't', body: '## Current State\n\nTODO', type: 'feature' }));
  const out = [];
  const code = run([payloadFile, '--out', outFile, '--require-shaped'], deps(out));
  assert.equal(code, 4);
  const err = streamOf(out, 'err');
  assert.match(err, /missing section: ## Deliverables/);
  assert.match(err, /unresolved placeholder marker: TODO/);
  assert.equal(fs.existsSync(outFile), false, 'nothing written on a shape-validation failure');
});

test('without --require-shaped, an unshaped (e.g. parent-record) body still composes and writes', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  const outFile = path.join(dir, 'body.md');
  fs.writeFileSync(payloadFile, JSON.stringify({ title: 'Parent', body: 'Design summary, no sections at all.', type: 'feature' }));
  const code = run([payloadFile, '--out', outFile], deps([]));
  assert.equal(code, 0);
  assert.match(fs.readFileSync(outFile, 'utf8'), /Design summary/);
});

test('malformed invocations exit 2', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify(SHAPED_PAYLOAD));
  assert.equal(run([], deps([])), 2, 'missing payload-file arg');
  assert.equal(run([payloadFile], deps([])), 2, 'missing --out');
  assert.equal(run([path.join(dir, 'missing.json'), '--out', path.join(dir, 'o.md')], deps([])), 2, 'unreadable payload file');
  const badJsonFile = path.join(dir, 'bad.json');
  fs.writeFileSync(badJsonFile, '{not json');
  assert.equal(run([badJsonFile, '--out', path.join(dir, 'o.md')], deps([])), 2, 'invalid JSON');
  assert.equal(run([payloadFile, '--bogus'], deps([])), 2, 'unknown flag');
});

test('a recordPayload rejection exits 3', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify({ title: 't', body: 'b', type: 'not-a-real-type' }));
  const out = [];
  const code = run([payloadFile, '--out', path.join(dir, 'o.md')], deps(out));
  assert.equal(code, 3);
  assert.match(streamOf(out, 'err'), /type/);
});

test('a write failure to --out exits 5', () => {
  const dir = tmpDir();
  const payloadFile = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify(SHAPED_PAYLOAD));
  const outAsDir = path.join(dir, 'body-as-dir.md');
  fs.mkdirSync(outAsDir);
  const out = [];
  const code = run([payloadFile, '--out', outAsDir], deps(out));
  assert.equal(code, 5);
  assert.match(streamOf(out, 'err'), /could not write --out/);
});

test('--help prints usage and exits 0', () => {
  const out = [];
  assert.equal(run(['--help'], deps(out)), 0);
  assert.match(streamOf(out, 'out'), /usage: compose-record\.js/);
});

const SHAPED_BODY = SHAPED_PAYLOAD.body;

test('--check: a conforming body exits 0 with no output', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, SHAPED_BODY);
  const out = [];
  assert.equal(run(['--check', bodyFile], deps(out)), 0);
  assert.equal(out.length, 0);
});

test('--check: a body missing its Release Note exits 4 with the exact --require-shaped stderr', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, SHAPED_BODY.replace('\n\n## Release Note\n\nDid the thing.', ''));
  const out = [];
  assert.equal(run(['--check', bodyFile], deps(out)), 4);
  assert.equal(streamOf(out, 'err'), 'compose-record.js: body is not spec-shaped:\n  - missing section: ## Release Note\n');
  assert.equal(streamOf(out, 'out'), '');
});

test('--check: an empty body file exits 4 naming all four sections', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'empty.md');
  fs.writeFileSync(bodyFile, '');
  const out = [];
  assert.equal(run(['--check', bodyFile], deps(out)), 4);
  const err = streamOf(out, 'err');
  for (const s of ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note']) {
    assert.match(err, new RegExp(`  - missing section: ## ${s}\\n`));
  }
});

test('--check: misuse exits 2', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, SHAPED_BODY);
  const payloadFile = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify(SHAPED_PAYLOAD));
  assert.equal(run(['--check'], deps([])), 2, '--check with no file');
  assert.equal(run(['--check', path.join(dir, 'missing.md')], deps([])), 2, 'unreadable body file');
  assert.equal(run(['--check', bodyFile, '--out', path.join(dir, 'o.md')], deps([])), 2, 'with --out');
  assert.equal(run(['--check', bodyFile, '--require-shaped'], deps([])), 2, 'with --require-shaped');
  assert.equal(run([payloadFile, '--check', bodyFile], deps([])), 2, 'with a positional payload');
  assert.equal(fs.existsSync(path.join(dir, 'o.md')), false, 'nothing written on misuse');
});
