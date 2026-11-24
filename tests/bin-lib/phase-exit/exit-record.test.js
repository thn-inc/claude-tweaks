'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatEntry, appendEntry } = require('../../../plugin/bin/lib/log-decision/append');
const { PHASE_EXIT_STEP, phaseExitText, readRunDecisions, phaseExitRecorded } = require('../../../plugin/bin/lib/phase-exit/exit-record');

const created = [];
test.after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-exit-record-')); created.push(d); return d; };

const now = new Date(2026, 10, 23, 12, 0, 0);
const line = (phase, { status = 'AUTO', step = PHASE_EXIT_STEP, text = phaseExitText(phase, 'abc123') } = {}) =>
  formatEntry({ status, step, text, now });
// The decisions.md text appendEntry writes for these (section, entry) pairs.
function decisionsText(items) {
  const dir = tmp();
  for (const { section, entry } of items) appendEntry({ runDir: dir, section, entry });
  return fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
}

test('phaseExitText names the phase and head, else unknown HEAD', () => {
  assert.equal(PHASE_EXIT_STEP, 'Phase exit');
  assert.equal(phaseExitText('build', 'abc123'), 'build phase exited at abc123');
  assert.equal(phaseExitText('test', null), 'test phase exited at unknown HEAD');
});

test('a build exit under /build is recorded for build; the same line under /test is not', () => {
  assert.equal(phaseExitRecorded(decisionsText([{ section: '/build', entry: line('build') }]), 'build'), true);
  assert.equal(phaseExitRecorded(decisionsText([{ section: '/test', entry: line('build') }]), 'build'), false);
});

test('a test exit under /test is recorded for test, not for build', () => {
  const text = decisionsText([{ section: '/test', entry: line('test') }]);
  assert.equal(phaseExitRecorded(text, 'test'), true);
  assert.equal(phaseExitRecorded(text, 'build'), false);
});

test('a SKIP line with the Phase exit step is not recorded', () => {
  const text = decisionsText([{ section: '/build', entry: line('build', { status: 'SKIP' }) }]);
  assert.equal(phaseExitRecorded(text, 'build'), false);
});

test('a "build phase exited" line under /review is not recorded for build', () => {
  const text = decisionsText([{ section: '/review', entry: line('build', { text: 'build phase exited' }) }]);
  assert.equal(phaseExitRecorded(text, 'build'), false);
});

test('a hand-written line, another step, or a text without the head suffix is not recorded', () => {
  const hand = '## /build\nbuild phase exited at abc123\n- AUTO — Phase exit: build phase exited at abc123.\n';
  assert.equal(phaseExitRecorded(hand, 'build'), false);
  assert.equal(phaseExitRecorded(decisionsText([{ section: '/build', entry: line('build', { step: 'Phase-exit push' }) }]), 'build'), false);
  assert.equal(phaseExitRecorded(decisionsText([{ section: '/build', entry: line('build', { text: 'build phase exited' }) }]), 'build'), false);
});

test('every ## heading with the section name counts, CRLF included', () => {
  const text = '## /build\n- AUTO 10:00:00 — other: x. Reversibility: n/a.\n## /test\n\n## /build\n' + `${line('build')}\n`;
  assert.equal(phaseExitRecorded(text, 'build'), true);
  assert.equal(phaseExitRecorded(text.replace(/\n/g, '\r\n'), 'build'), true);
});

test('polish reads its PHASE_SECTIONS section (/flow)', () => {
  assert.equal(phaseExitRecorded(decisionsText([{ section: '/flow', entry: line('polish') }]), 'polish'), true);
  assert.equal(phaseExitRecorded(decisionsText([{ section: '/polish', entry: line('polish') }]), 'polish'), false);
});

test('an empty text, a non-string, or an unknown phase returns false', () => {
  assert.equal(phaseExitRecorded('', 'build'), false);
  assert.equal(phaseExitRecorded(null, 'build'), false);
  assert.equal(phaseExitRecorded(decisionsText([{ section: '/build', entry: line('build') }]), 'nope'), false);
});

test('readRunDecisions returns the parent text first, then each spec-N file; a spec dir without a file is skipped', () => {
  const run = tmp();
  fs.writeFileSync(path.join(run, 'decisions.md'), 'parent\n');
  fs.mkdirSync(path.join(run, 'spec-1'));
  fs.writeFileSync(path.join(run, 'spec-1', 'decisions.md'), 'spec one\n');
  fs.mkdirSync(path.join(run, 'spec-2'));
  assert.deepEqual(readRunDecisions(run), ['parent\n', 'spec one\n']);
});

test('readRunDecisions ignores a spec-x dir, a spec-N file, and a symlinked spec-N dir', () => {
  const run = tmp();
  const elsewhere = tmp();
  fs.writeFileSync(path.join(elsewhere, 'decisions.md'), 'foreign\n');
  fs.writeFileSync(path.join(run, 'decisions.md'), 'parent\n');
  fs.mkdirSync(path.join(run, 'spec-x'));
  fs.writeFileSync(path.join(run, 'spec-x', 'decisions.md'), 'x\n');
  fs.writeFileSync(path.join(run, 'spec-4'), 'not a dir\n');
  fs.symlinkSync(elsewhere, path.join(run, 'spec-3'), 'junction');
  assert.deepEqual(readRunDecisions(run), ['parent\n']);
});

test('readRunDecisions throws on a missing parent decisions.md, and on an unreadable present spec file', () => {
  const run = tmp();
  assert.throws(() => readRunDecisions(run), { code: 'ENOENT' });
  fs.writeFileSync(path.join(run, 'decisions.md'), 'parent\n');
  fs.mkdirSync(path.join(run, 'spec-1'));
  fs.writeFileSync(path.join(run, 'spec-1', 'decisions.md'), 'spec\n');
  const fsImpl = {
    ...fs,
    readFileSync: (f, enc) => {
      if (f === path.join(run, 'spec-1', 'decisions.md')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return fs.readFileSync(f, enc);
    },
  };
  assert.throws(() => readRunDecisions(run, fsImpl), { code: 'EACCES' });
});

// ---- readRunSpecs and phaseExitReached (multi-spec runs, #6143) ----
const { readRunSpecs, phaseExitReached } = require('../../../plugin/bin/lib/phase-exit/exit-record');
const { manifestInit, transitionSpec } = require('../../../plugin/bin/lib/flow/manifest');

test('readRunSpecs is null for a run with no manifest.yml', () => {
  assert.equal(readRunSpecs(tmp()), null);
});

test('readRunSpecs returns each manifest spec in order with its status, phase and own spec-N decisions.md text', () => {
  const run = tmp();
  assert.equal(manifestInit({ runDir: run, specs: [1, 2, 3] }).ok, true);
  assert.equal(transitionSpec({ runDir: run, specId: 1, status: 'complete', phase: 'wrap-up', now }).ok, true);
  assert.equal(transitionSpec({ runDir: run, specId: 2, status: 'running', phase: 'build', now }).ok, true);
  appendEntry({ runDir: path.join(run, 'spec-1'), section: '/build', entry: line('build') });
  fs.mkdirSync(path.join(run, 'spec-2'));
  const specs = readRunSpecs(run);
  assert.deepEqual(specs.map(({ id, status, phase }) => ({ id, status, phase })), [
    { id: 1, status: 'complete', phase: 'wrap-up' },
    { id: 2, status: 'running', phase: 'build' },
    { id: 3, status: 'pending', phase: undefined },
  ]);
  assert.equal(phaseExitRecorded(specs[0].decisions, 'build'), true);
  assert.equal(specs[1].decisions, '', 'a spec dir with no decisions.md reads empty');
  assert.equal(specs[2].decisions, '', 'a spec with no dir reads empty');
});

test('readRunSpecs throws on a manifest.yml that does not parse, and on an unreadable present spec file', () => {
  const run = tmp();
  fs.writeFileSync(path.join(run, 'manifest.yml'), 'not a manifest\n');
  assert.throws(() => readRunSpecs(run), /does not parse/);
  const ok = tmp();
  manifestInit({ runDir: ok, specs: [1] });
  appendEntry({ runDir: path.join(ok, 'spec-1'), section: '/build', entry: line('build') });
  const fsImpl = {
    ...fs,
    readFileSync: (f, enc) => {
      if (f === path.join(ok, 'spec-1', 'decisions.md')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return fs.readFileSync(f, enc);
    },
  };
  assert.throws(() => readRunSpecs(ok, fsImpl), { code: 'EACCES' });
});

test('phaseExitReached counts the phase\'s own exit or any later phase\'s, never an earlier one\'s', () => {
  const testExit = decisionsText([{ section: '/test', entry: line('test') }]);
  assert.equal(phaseExitReached(testExit, 'build'), true);
  assert.equal(phaseExitReached(testExit, 'test'), true);
  assert.equal(phaseExitReached(decisionsText([{ section: '/build', entry: line('build') }]), 'test'), false);
  assert.equal(phaseExitReached(testExit, 'nope'), false);
});
