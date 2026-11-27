'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sectionStatus, readStatus } = require('../../../plugin/bin/lib/design-session/status');
const { PERSPECTIVES } = require('../../../plugin/bin/lib/design-session/notes');

const EVIDENCE = '# Evidence\n\nStatus: done\n\n- a claim — source: #6352\n';

function section(heading, status, extra = []) {
  return [`## ${heading}`, '', `Status: ${status}`, '', ...extra, 'body', ''].join('\n');
}

function storyboard(status, roundN) {
  return section('Storyboard', status, [`Round: ${roundN}`, 'File: storyboard.md']);
}

function notes(n, status, severities, outcome = 'changed — fixed') {
  const lines = [`# Perspective notes — round ${n}`, '', `Status: ${status}`, ''];
  PERSPECTIVES.forEach((p, i) => {
    const sev = severities[i] || 'none';
    lines.push(`## ${n}.${i + 1} — ${p} — ${sev}`);
    if (sev !== 'none') lines.push('a note', `Outcome: ${outcome}`);
    lines.push('');
  });
  return lines.join('\n');
}

// files: { name: text }; returns the folder path.
function folderWith(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-status-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

function design(...sections) {
  return ['# Design', '', ...sections].join('\n');
}

const UP_TO_STORYBOARD = [section('Frame', 'done'), storyboard('done', 1)];

test('AC6.1: evidence and frame present resumes at step 3 and repeats nothing', (t) => {
  const dir = folderWith(t, { 'evidence.md': EVIDENCE, 'design.md': design(section('Frame', 'done')) });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[1], 'done');
  assert.strictEqual(s.steps[2], 'done');
  assert.strictEqual(s.steps[3], 'missing');
  assert.strictEqual(s.resumeAt, 3);
  assert.strictEqual(s.round, 1);
  assert.strictEqual(s.action, 'start');
  assert.deepStrictEqual(s.openSerious, []);
});

test('empty or absent folder starts at step 1', (t) => {
  const empty = folderWith(t, {});
  assert.deepStrictEqual(readStatus(empty), {
    steps: { 1: 'missing', 2: 'missing', 3: 'missing', 4: 'missing', 5: 'missing', 6: 'missing', 7: 'missing' },
    resumeAt: 1, round: null, action: 'start', openSerious: [],
  });
  assert.strictEqual(readStatus(path.join(empty, 'nope')).resumeAt, 1);
});

test('evidence with an unsourced bullet is partial', (t) => {
  const dir = folderWith(t, { 'evidence.md': EVIDENCE + '- no source\n' });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[1], 'partial');
  assert.strictEqual(s.resumeAt, 1);
  assert.strictEqual(s.action, 'continue');
});

test('storyboard section done but its file absent is partial', (t) => {
  const dir = folderWith(t, { 'evidence.md': EVIDENCE, 'design.md': design(...UP_TO_STORYBOARD) });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[3], 'partial');
  assert.strictEqual(s.resumeAt, 3);
  assert.strictEqual(s.action, 'continue');
  assert.strictEqual(s.round, 1);
});

test('a File: line in a later section does not count for the storyboard', (t) => {
  const dir = folderWith(t, {
    'evidence.md': EVIDENCE, 'storyboard.md': 'x',
    'design.md': design(section('Frame', 'done'), section('Storyboard', 'done', ['Round: 1']),
      section('Perspectives', 'in-progress', ['File: storyboard.md'])),
  });
  assert.strictEqual(readStatus(dir).steps[3], 'partial');
});

test('a closed Perspectives section takes a half-written storyboard out of the loop', (t) => {
  const dir = folderWith(t, {
    'evidence.md': EVIDENCE, 'storyboard.md': 'x', 'notes-round-1.md': notes(1, 'done', ['minor']),
    'design.md': design(section('Frame', 'done'), storyboard('in-progress', 1), section('Perspectives', 'done')),
  });
  const s = readStatus(dir);
  assert.deepStrictEqual([s.resumeAt, s.round, s.action], [3, null, 'continue']);
});

test('storyboard done and no notes yet starts round 1', (t) => {
  const dir = folderWith(t, { 'evidence.md': EVIDENCE, 'design.md': design(...UP_TO_STORYBOARD), 'storyboard.md': 'x' });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[3], 'done');
  assert.deepStrictEqual([s.resumeAt, s.round, s.action], [4, 1, 'start-round']);
});

test('a round with a pending outcome or not marked done is finished first', (t) => {
  const base = { 'evidence.md': EVIDENCE, 'design.md': design(...UP_TO_STORYBOARD), 'storyboard.md': 'x' };
  const pending = folderWith(t, { ...base, 'notes-round-1.md': notes(1, 'done', ['serious'], 'pending') });
  assert.deepStrictEqual(
    [readStatus(pending).resumeAt, readStatus(pending).round, readStatus(pending).action], [4, 1, 'finish-round']);
  const open = folderWith(t, { ...base, 'notes-round-1.md': notes(1, 'in-progress', ['minor']) });
  assert.strictEqual(readStatus(open).action, 'finish-round');
});

test('revise-storyboard vs start-round by storyboard Round:', (t) => {
  const r1 = notes(1, 'done', ['serious']);
  const stale = folderWith(t, {
    'evidence.md': EVIDENCE, 'design.md': design(...UP_TO_STORYBOARD), 'storyboard.md': 'x', 'notes-round-1.md': r1,
  });
  assert.deepStrictEqual(
    (({ resumeAt, round, action }) => [resumeAt, round, action])(readStatus(stale)), [3, 2, 'revise-storyboard']);

  const revised = folderWith(t, {
    'evidence.md': EVIDENCE, 'design.md': design(section('Frame', 'done'), storyboard('done', 2)),
    'storyboard.md': 'x', 'notes-round-1.md': r1,
  });
  assert.deepStrictEqual(
    (({ resumeAt, round, action }) => [resumeAt, round, action])(readStatus(revised)), [4, 2, 'start-round']);

  const halfRevised = folderWith(t, {
    'evidence.md': EVIDENCE, 'design.md': design(section('Frame', 'done'), storyboard('in-progress', 2)),
    'storyboard.md': 'x', 'notes-round-1.md': r1,
  });
  assert.deepStrictEqual(
    (({ resumeAt, round, action }) => [resumeAt, round, action])(readStatus(halfRevised)), [3, 2, 'revise-storyboard']);
});

test('a done round with no serious note closes perspectives', (t) => {
  const dir = folderWith(t, {
    'evidence.md': EVIDENCE, 'design.md': design(section('Frame', 'done'), storyboard('done', 2)),
    'storyboard.md': 'x', 'notes-round-1.md': notes(1, 'done', ['serious']), 'notes-round-2.md': notes(2, 'done', ['minor']),
  });
  const s = readStatus(dir);
  assert.deepStrictEqual([s.resumeAt, s.round, s.action], [4, 2, 'close-perspectives']);
});

function capFolder(t, perspectivesSection) {
  const files = {
    'evidence.md': EVIDENCE,
    'design.md': design(section('Frame', 'done'), storyboard('done', 5), ...perspectivesSection),
    'storyboard.md': 'x',
  };
  for (let n = 1; n <= 4; n++) files[`notes-round-${n}.md`] = notes(n, 'done', ['serious', 'minor', 'serious'], 'declined — no');
  return folderWith(t, files);
}

test('AC4.1: a fifth round is never started', (t) => {
  const s = readStatus(capFolder(t, [section('Perspectives', 'in-progress')]));
  assert.strictEqual(s.resumeAt, 4);
  assert.strictEqual(s.round, 4);
  assert.strictEqual(s.action, 'cap-reached');
  assert.deepStrictEqual(s.openSerious, ['4.1', '4.3']);
  assert.notStrictEqual(s.round, 5);
});

test('cap reached, then continued', (t) => {
  const s = readStatus(capFolder(t, [section('Perspectives', 'done')]));
  assert.strictEqual(s.steps[4], 'done');
  assert.strictEqual(s.resumeAt, 5);
  assert.strictEqual(s.action, 'start');
  assert.strictEqual(s.round, null);
});

const THROUGH_PERSPECTIVES = [section('Frame', 'done'), storyboard('done', 1), section('Perspectives', 'done')];
const BASE = { 'evidence.md': EVIDENCE, 'storyboard.md': 'x', 'notes-round-1.md': notes(1, 'done', ['minor']) };

test('half-written section resumes that step', (t) => {
  const dir = folderWith(t, { ...BASE, 'design.md': design(...THROUGH_PERSPECTIVES, section('Approaches', 'in-progress')) });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[5], 'partial');
  assert.strictEqual(s.resumeAt, 5);
  assert.strictEqual(s.action, 'continue');
});

test('resumes at step 6', (t) => {
  const dir = folderWith(t, { ...BASE, 'design.md': design(...THROUGH_PERSPECTIVES, section('Approaches', 'done')) });
  const s = readStatus(dir);
  assert.deepStrictEqual([s.resumeAt, s.action, s.round], [6, 'start', null]);
});

test('resumes at step 7', (t) => {
  const dir = folderWith(t, {
    ...BASE, 'design.md': design(...THROUGH_PERSPECTIVES, section('Approaches', 'done'), section('Pre-mortem', 'done')),
  });
  const s = readStatus(dir);
  assert.deepStrictEqual([s.resumeAt, s.action], [7, 'start']);
});

test('complete session', (t) => {
  const dir = folderWith(t, {
    ...BASE,
    'design.md': design(...THROUGH_PERSPECTIVES, section('Approaches', 'done'), section('Pre-mortem', 'done'),
      section('Builder check', 'done'), '## Decisions', '', '- 2026-11-27 — keep it small — by: maintainer'),
  });
  const s = readStatus(dir);
  assert.deepStrictEqual(Object.values(s.steps), ['done', 'done', 'done', 'done', 'done', 'done', 'done']);
  assert.deepStrictEqual([s.resumeAt, s.round, s.action], ['complete', null, null]);
});

test('status line is whitespace- and case-tolerant', () => {
  const text = ['# D', '## Frame', '', '  status:   DONE ', 'x', '## Approaches', 'no status here', '## Pre-mortem', 'Status: in-progress'].join('\n');
  assert.strictEqual(sectionStatus(text, 'Frame'), 'done');
  assert.strictEqual(sectionStatus(text, 'Approaches'), 'partial');
  assert.strictEqual(sectionStatus(text, 'Pre-mortem'), 'partial');
  assert.strictEqual(sectionStatus(text, 'Builder check'), 'missing');
});

test('sectionStatus slices at the next ## heading, not at ### or fenced lines', () => {
  const text = ['## Frame', 'Status: in-progress', '```', '## Approaches', 'Status: in-progress', '```', '### sub',
    '## Approaches', 'Status: done'].join('\n');
  assert.strictEqual(sectionStatus(text, 'Frame'), 'partial');
  assert.strictEqual(sectionStatus(text, 'Approaches'), 'done');
  assert.strictEqual(sectionStatus(text.replace(/\n/g, '\r\n'), 'Approaches'), 'done');
});
