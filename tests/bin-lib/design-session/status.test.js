'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sectionStatus, readStatus } = require('../../../plugin/bin/lib/design-session/status');
const { PERSPECTIVES } = require('../../../plugin/bin/lib/design-session/notes');
const { TABLE_HEADER, approvalLine, partsDigest } = require('../../../plugin/bin/lib/design-session/parts');

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
    steps: {
      1: 'missing', 2: 'missing', 3: 'missing', 4: 'missing', 5: 'missing', 6: 'missing', 7: 'missing',
      8: 'missing', 9: 'missing', 10: 'missing',
    },
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

const LOOP_BASE = { 'evidence.md': EVIDENCE, 'storyboard.md': 'x' };
const triple = (s) => [s.resumeAt, s.round, s.action];

test('Perspectives marked done with a pending outcome finishes the round', (t) => {
  const dir = folderWith(t, {
    ...LOOP_BASE, 'notes-round-1.md': notes(1, 'done', ['serious'], 'pending'),
    'design.md': design(...UP_TO_STORYBOARD, section('Perspectives', 'done')),
  });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[4], 'partial');
  assert.deepStrictEqual(triple(s), [4, 1, 'finish-round']);
});

test('Perspectives marked done with no notes file does not reach step 5', (t) => {
  const dir = folderWith(t, { ...LOOP_BASE, 'design.md': design(...UP_TO_STORYBOARD, section('Perspectives', 'done')) });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[4], 'partial');
  assert.deepStrictEqual(triple(s), [4, 1, 'start-round']);
});

test('Perspectives marked done while round 1 still has a serious note is not closed', (t) => {
  const dir = folderWith(t, {
    ...LOOP_BASE, 'notes-round-1.md': notes(1, 'done', ['serious']),
    'design.md': design(...UP_TO_STORYBOARD, section('Perspectives', 'done')),
  });
  assert.deepStrictEqual(triple(readStatus(dir)), [3, 2, 'revise-storyboard']);
});

test('a notes-round-5.md is ignored and round 5 is never returned', (t) => {
  const files = {
    ...LOOP_BASE, 'design.md': design(section('Frame', 'done'), storyboard('done', 5), section('Perspectives', 'in-progress')),
    'notes-round-5.md': notes(5, 'in-progress', ['serious'], 'pending'),
  };
  for (let n = 1; n <= 4; n++) files[`notes-round-${n}.md`] = notes(n, 'done', ['serious'], 'declined — no');
  const s = readStatus(folderWith(t, files));
  assert.deepStrictEqual(triple(s), [4, 4, 'cap-reached']);
  const only5 = readStatus(folderWith(t, {
    ...LOOP_BASE, 'design.md': design(...UP_TO_STORYBOARD), 'notes-round-5.md': notes(5, 'done', ['serious']),
  }));
  assert.deepStrictEqual(triple(only5), [4, 1, 'start-round']);
});

test('a storyboard with a missing or non-numeric Round: is revised, not re-read', (t) => {
  for (const extra of [['File: storyboard.md'], ['Round: two', 'File: storyboard.md']]) {
    const dir = folderWith(t, {
      ...LOOP_BASE, 'notes-round-1.md': notes(1, 'done', ['serious']),
      'design.md': design(section('Frame', 'done'), section('Storyboard', 'done', extra)),
    });
    const s = readStatus(dir);
    assert.strictEqual(s.steps[3], 'done');
    assert.deepStrictEqual(triple(s), [3, 2, 'revise-storyboard'], extra.join(' | '));
  }
});

test('finish-round when a perspective is missing or a heading is malformed', (t) => {
  const design1 = design(...UP_TO_STORYBOARD);
  const full = notes(1, 'done', ['minor']);
  const missing = full.replace('## 1.5 — introduction — none', '');
  // Every perspective still recorded; only the extra heading is wrong.
  const bad = `${full}\n## 1.6 user serious\nx\nOutcome: changed — y\n`;
  for (const text of [missing, bad]) {
    assert.notStrictEqual(text, full);
    const dir = folderWith(t, { ...LOOP_BASE, 'design.md': design1, 'notes-round-1.md': text });
    assert.deepStrictEqual(triple(readStatus(dir)), [4, 1, 'finish-round']);
  }
  const ok = folderWith(t, { ...LOOP_BASE, 'design.md': design1, 'notes-round-1.md': full });
  assert.deepStrictEqual(triple(readStatus(ok)), [4, 1, 'close-perspectives']);
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

const REPO = 'thn-inc/claude-tweaks';
const PART_ROWS = [
  `| 1 | Parser | size:low | ${REPO} | — |  |`,
  `| 2 | Skill steps | size:medium | ${REPO} | Parser |  |`,
];
const TABLE = [`| ${TABLE_HEADER.join(' | ')} |`, `|${TABLE_HEADER.map(() => '---').join('|')}|`];

// Frame, storyboard, perspectives, approaches, pre-mortem and builder check, all done.
const THROUGH_STEP_7 = [...THROUGH_PERSPECTIVES, section('Approaches', 'done'), section('Pre-mortem', 'done'), section('Builder check', 'done')];

function partsSection(status, rows = PART_ROWS) {
  return ['## Parts', '', `Status: ${status}`, '', ...TABLE, ...rows, '', 'Estimate: 2 parts', ''].join('\n');
}
function approvalSection(status, line) {
  return ['## Approval', '', `Status: ${status}`, '', ...(line ? [line] : []), ''].join('\n');
}
// design.md text through step 7 plus the given later sections.
function designThrough7(...later) { return design(...THROUGH_STEP_7, ...later); }
function approvedLine() {
  return approvalLine('2026-11-28', partsDigest(designThrough7(partsSection('done'))));
}
function filingSection(status) { return section('Filing', status); }

test('complete session', (t) => {
  const dir = folderWith(t, {
    ...BASE,
    'design.md': designThrough7(partsSection('done', [
      `| 1 | Parser | size:low | ${REPO} | — | ${REPO}#7001 |`,
      `| 2 | Skill steps | size:medium | ${REPO} | Parser | left for ${REPO} |`,
    ]), approvalSection('done', approvedLine()), filingSection('done'),
    '## Decisions', '', '- 2026-11-27 — keep it small — by: maintainer'),
  });
  const s = readStatus(dir);
  assert.deepStrictEqual(Object.values(s.steps), Array(10).fill('done'));
  assert.deepStrictEqual([s.resumeAt, s.round, s.action], ['complete', null, null]);
});

test('steps 1-7 done and no Parts section resumes at 8 start', (t) => {
  const dir = folderWith(t, { ...BASE, 'design.md': designThrough7() });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[8], 'missing');
  assert.deepStrictEqual([s.resumeAt, s.round, s.action, s.openSerious], [8, null, 'start', []]);
});

test('Parts done with an invalid row resumes at 8 continue', (t) => {
  const bad = [`| 1 | Parser | size:huge | ${REPO} | — |  |`];
  const dir = folderWith(t, { ...BASE, 'design.md': designThrough7(partsSection('done', bad)) });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[8], 'partial');
  assert.deepStrictEqual(triple(s), [8, null, 'continue']);
});

test('Parts done and valid but no Approval section resumes at 9 start', (t) => {
  const dir = folderWith(t, { ...BASE, 'design.md': designThrough7(partsSection('done')) });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[8], 'done');
  assert.deepStrictEqual(triple(s), [9, null, 'start']);
});

test('Approval Status done without an Approved: line resumes at 9 continue', (t) => {
  const dir = folderWith(t, { ...BASE, 'design.md': designThrough7(partsSection('done'), approvalSection('done', '')) });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[9], 'partial');
  assert.deepStrictEqual(triple(s), [9, null, 'continue']);
});

test('AC6.1: an edit to the parts table after approval asks for a new approval first', (t) => {
  const line = approvedLine();
  const edited = PART_ROWS.map((r) => r.replace('size:medium', 'size:high'));
  assert.notDeepStrictEqual(edited, PART_ROWS);
  const dir = folderWith(t, {
    ...BASE, 'design.md': designThrough7(partsSection('done', edited), approvalSection('done', line)),
  });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[9], 'partial');
  assert.deepStrictEqual(s, { steps: s.steps, resumeAt: 9, round: null, action: 'reapprove', openSerious: [] });
});

test('Approved and Filing not started resumes at 10 start', (t) => {
  const dir = folderWith(t, {
    ...BASE, 'design.md': designThrough7(partsSection('done'), approvalSection('done', approvedLine())),
  });
  assert.deepStrictEqual(triple(readStatus(dir)), [10, null, 'start']);
});

test('Filing done but one part unmarked resumes at 10 continue', (t) => {
  const rows = [`| 1 | Parser | size:low | ${REPO} | — | ${REPO}#7001 |`, PART_ROWS[1]];
  const dir = folderWith(t, {
    ...BASE,
    'design.md': designThrough7(partsSection('done', rows), approvalSection('done', approvedLine()), filingSection('done')),
  });
  const s = readStatus(dir);
  assert.strictEqual(s.steps[10], 'partial');
  assert.deepStrictEqual(triple(s), [10, null, 'continue']);
});

test('status line is whitespace- and case-tolerant', () => {
  const text = ['# D', '## Frame', '', '  status:   DONE ', 'x', '## Approaches', 'no status here', '## Pre-mortem', 'Status: in-progress'].join('\n');
  assert.strictEqual(sectionStatus(text, 'Frame'), 'done');
  assert.strictEqual(sectionStatus(text, 'Approaches'), 'partial');
  assert.strictEqual(sectionStatus(text, 'Pre-mortem'), 'partial');
  assert.strictEqual(sectionStatus(text, 'Builder check'), 'missing');
});

test('a directory named notes-round-N.md or by the storyboard File: resumes, never crashes', (t) => {
  const notesDir = folderWith(t, { ...LOOP_BASE, 'design.md': design(...UP_TO_STORYBOARD) });
  fs.mkdirSync(path.join(notesDir, 'notes-round-1.md'));
  assert.deepStrictEqual(triple(readStatus(notesDir)), [4, 1, 'finish-round']);

  const boardDir = folderWith(t, { 'evidence.md': EVIDENCE, 'design.md': design(...UP_TO_STORYBOARD) });
  fs.mkdirSync(path.join(boardDir, 'storyboard.md'));
  const s = readStatus(boardDir);
  assert.strictEqual(s.steps[3], 'partial');
  assert.deepStrictEqual(triple(s), [3, 1, 'continue']);
});

test('a storyboard File that is not a bare name in the folder leaves step 3 partial', (t) => {
  for (const file of ['../storyboard.md', 'sub/storyboard.md']) {
    const dir = folderWith(t, {
      ...LOOP_BASE, 'design.md': design(section('Frame', 'done'), section('Storyboard', 'done', ['Round: 1', `File: ${file}`])),
    });
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'storyboard.md'), 'x');
    assert.strictEqual(readStatus(dir).steps[3], 'partial', file);
  }
});

test('a heading inside a tilde or longer backtick fence does not start a section', () => {
  for (const [open, inner, close] of [['~~~', null, '~~~'], ['````', '```', '````']]) {
    const quoted = [open, inner, '## Approaches', 'Status: done', inner, close].filter((l) => l !== null);
    const text = ['## Frame', 'Status: done', ...quoted, '## Approaches', 'Status: in-progress'].join('\n');
    assert.strictEqual(sectionStatus(text, 'Approaches'), 'partial', open);
    assert.strictEqual(sectionStatus(text, 'Frame'), 'done', open);
  }
});

test('sectionStatus slices at the next ## heading, not at ### or fenced lines', () => {
  const text = ['## Frame', 'Status: in-progress', '```', '## Approaches', 'Status: in-progress', '```', '### sub',
    '## Approaches', 'Status: done'].join('\n');
  assert.strictEqual(sectionStatus(text, 'Frame'), 'partial');
  assert.strictEqual(sectionStatus(text, 'Approaches'), 'done');
  assert.strictEqual(sectionStatus(text.replace(/\n/g, '\r\n'), 'Approaches'), 'done');
});
