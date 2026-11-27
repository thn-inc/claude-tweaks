'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readBlocks, composeBrief } = require('../../../plugin/bin/lib/design-session/brief');
const { PERSPECTIVES } = require('../../../plugin/bin/lib/design-session/notes');

const BRIEFS_PATH = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills', 'design', 'reader-briefs.md');
const BRIEFS = fs.readFileSync(BRIEFS_PATH, 'utf8');
const BLOCKS = readBlocks(BRIEFS);

const DECISIONS_SENTINEL = 'SENTINEL-DECISION-7731';
const EVIDENCE_SENTINEL = 'SENTINEL-EVIDENCE-9042';
const FRAME_BODY = 'Problem: the frame text.\nGoals: one goal.';
const BOARD_TEXT = 'Step one: a picture.\nStep two: another.';

function design({ boardRound = 1, file = 'storyboard.md', frame = true, board = true } = {}) {
  const parts = ['# Topic — design', ''];
  if (frame) parts.push('## Frame', '', 'Status: done', '', FRAME_BODY, '');
  if (board) parts.push('## Storyboard', '', 'Status: done', '', `Round: ${boardRound}`, `File: ${file}`, '');
  parts.push('## Perspectives', '', 'Status: in-progress', '', '## Decisions', '', `- 2026-11-27 — ${DECISIONS_SENTINEL} — by: maintainer`, '');
  return parts.join('\n');
}

function notesFile(n, { pending = false } = {}) {
  const lines = [`# Perspective notes — round ${n}`, '', 'Status: done', ''];
  PERSPECTIVES.forEach((p, i) => {
    lines.push(`## ${n}.${i + 1} — ${p} — ${i === 0 ? 'minor' : 'none'}`);
    if (i === 0) lines.push('> a note', pending ? 'Outcome: pending' : 'Outcome: changed — fixed');
    lines.push('');
  });
  return lines.join('\n');
}

function folderWith(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-brief-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const all = { 'design.md': design(), 'storyboard.md': BOARD_TEXT, 'evidence.md': EVIDENCE_SENTINEL, ...files };
  for (const [name, text] of Object.entries(all)) {
    if (text !== null) fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const compose = (folder, reader, round) => composeBrief({ folder, reader, round, briefsText: BRIEFS });
const piece = (name) => BLOCKS.get(name);

test('AC2.1: a perspective brief holds the frame, the storyboard and the note template, and nothing else', (t) => {
  const folder = folderWith(t, {});
  for (const p of PERSPECTIVES) {
    const r = compose(folder, p, 1);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const expected = [piece('perspective-common'), piece(p), FRAME_BODY, BOARD_TEXT, piece('perspective-output')].join('\n\n');
    assert.strictEqual(r.text, expected);
    assert.ok(!r.text.includes(DECISIONS_SENTINEL));
    assert.ok(!r.text.includes(EVIDENCE_SENTINEL));
  }
});

test('a storyboard that is not text is named by absolute path with Read this file', (t) => {
  const folder = folderWith(t, { 'design.md': design({ file: 'storyboard.png' }), 'storyboard.png': 'PNGDATA' });
  const r = compose(folder, 'user', 1);
  assert.strictEqual(r.ok, true);
  assert.ok(r.text.includes(path.join(folder, 'storyboard.png')));
  assert.ok(r.text.includes('Read this file'));
  assert.ok(!r.text.includes('PNGDATA'));
  for (const ext of ['md', 'txt', 'html']) {
    const f = `storyboard.${ext}`;
    const inline = compose(folderWith(t, { 'design.md': design({ file: f }), [f]: `INLINE-${ext}` }), 'user', 1);
    assert.ok(inline.text.includes(`INLINE-${ext}`), ext);
    assert.ok(!inline.text.includes('Read this file'), ext);
  }
});

test('builder brief drops the decisions list', (t) => {
  const folder = folderWith(t, {});
  const r = compose(folder, 'builder');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(r.text.startsWith(piece('builder')));
  assert.ok(r.text.includes(FRAME_BODY));
  assert.ok(r.text.includes('## Perspectives'));
  assert.ok(!r.text.includes('## Decisions'));
  assert.ok(!r.text.includes(DECISIONS_SENTINEL));
  const pm = compose(folder, 'pre-mortem');
  assert.ok(pm.text.startsWith(piece('pre-mortem')));
  assert.ok(!pm.text.includes(DECISIONS_SENTINEL));
});

test('a ## Decisions line inside a fence does not end the removal early or start it', (t) => {
  const text = `${design().replace('## Decisions', '```\n## Decisions\n```\n## Decisions')}`;
  const r = compose(folderWith(t, { 'design.md': text }), 'builder');
  assert.ok(r.text.includes('## Decisions\n```'), 'fenced heading kept');
  assert.ok(!r.text.includes(DECISIONS_SENTINEL));
});

test('AC4.1: brief refuses round 5', (t) => {
  const r = compose(folderWith(t, {}), 'user', 5);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'round-cap');
});

test('AC3.2: brief refuses while a note has no outcome', (t) => {
  const folder = folderWith(t, {
    'design.md': design({ boardRound: 2 }),
    'notes-round-1.md': notesFile(1, { pending: true }),
  });
  const r = compose(folder, 'user', 2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'pending-outcomes');
  assert.ok(String(r.detail).includes('1.1'));
  const ok = compose(folderWith(t, { 'design.md': design({ boardRound: 2 }), 'notes-round-1.md': notesFile(1) }), 'user', 2);
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));
});

test('only the previous round gates a perspective brief: round R pending outcomes do not', (t) => {
  const folder = folderWith(t, {
    'design.md': design({ boardRound: 2 }),
    'notes-round-1.md': notesFile(1),
    'notes-round-2.md': notesFile(2, { pending: true }),
  });
  assert.strictEqual(compose(folder, 'smallest', 2).ok, true);
});

test('pre-mortem and builder refuse while the last notes round has a pending outcome', (t) => {
  const folder = folderWith(t, { 'notes-round-1.md': notesFile(1), 'notes-round-2.md': notesFile(2, { pending: true }) });
  for (const reader of ['pre-mortem', 'builder']) {
    const r = compose(folder, reader);
    assert.strictEqual(r.ok, false, reader);
    assert.strictEqual(r.reason, 'pending-outcomes', reader);
  }
  const clean = folderWith(t, { 'notes-round-1.md': notesFile(1) });
  assert.strictEqual(compose(clean, 'builder').ok, true);
});

test('R3: a storyboard older than the round is stale', (t) => {
  const folder = folderWith(t, { 'design.md': design({ boardRound: 1 }), 'notes-round-1.md': notesFile(1) });
  const r = compose(folder, 'user', 2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'stale-storyboard');
});

test('no-frame, no-storyboard and unknown-reader refusals', (t) => {
  assert.strictEqual(compose(folderWith(t, { 'design.md': design({ frame: false }) }), 'user', 1).reason, 'no-frame');
  assert.strictEqual(compose(folderWith(t, { 'design.md': null }), 'builder').reason, 'no-frame');
  assert.strictEqual(compose(folderWith(t, { 'design.md': design({ board: false }) }), 'user', 1).reason, 'no-storyboard');
  assert.strictEqual(compose(folderWith(t, { 'storyboard.md': null }), 'user', 1).reason, 'no-storyboard');
  const unknown = compose(folderWith(t, {}), 'nobody', 1);
  assert.strictEqual(unknown.ok, false);
  assert.strictEqual(unknown.reason, 'unknown-reader');
});

test('readBlocks throws on a missing or unbalanced marker', () => {
  assert.throws(() => readBlocks(BRIEFS.replace('<!-- brief:user:end -->', '')), /user/);
  assert.throws(() => readBlocks(BRIEFS.replace('<!-- brief:smallest:start -->', '')), /smallest/);
  assert.throws(() => readBlocks(`${BRIEFS}\n<!-- brief:user:start -->\nx\n<!-- brief:user:end -->\n`), /user/);
  assert.throws(() => readBlocks('<!-- brief:a:start -->\n<!-- brief:b:start -->\n<!-- brief:b:end -->\n<!-- brief:a:end -->'), /a/);
});

test('readBlocks matches markers only at the start of a line', () => {
  const map = readBlocks('lead mentions <!-- brief:x:start --> inline and <!-- brief:x:end --> too.\n\n<!-- brief:a:start -->\nbody\n<!-- brief:a:end -->\n');
  assert.deepStrictEqual([...map.keys()], ['a']);
  assert.strictEqual(map.get('a'), 'body');
  // the live file's lead mentions the marker syntax inline and still parses
  assert.ok(BLOCKS.has('perspective-common') && BLOCKS.has('builder'));
});

test('fix1: a symlinked design.md, storyboard or notes file is refused, never read', (t) => {
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'design-outside-')), 'x.md');
  t.after(() => fs.rmSync(path.dirname(outside), { recursive: true, force: true }));
  fs.writeFileSync(outside, 'OUTSIDE-CONTENT');
  const link = (dir, name, target = outside) => { fs.rmSync(path.join(dir, name), { force: true }); fs.symlinkSync(target, path.join(dir, name)); };

  const board = folderWith(t, {});
  link(board, 'storyboard.md');
  const r1 = compose(board, 'user', 1);
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.reason, 'symlink');
  assert.ok(!JSON.stringify(r1).includes('OUTSIDE-CONTENT'));

  const des = folderWith(t, {});
  link(des, 'design.md');
  assert.strictEqual(compose(des, 'builder').reason, 'symlink');
  assert.strictEqual(compose(des, 'user', 1).reason, 'symlink');

  const prev = folderWith(t, { 'design.md': design({ boardRound: 2 }) });
  link(prev, 'notes-round-1.md');
  assert.strictEqual(compose(prev, 'user', 2).reason, 'symlink');

  const last = folderWith(t, {});
  link(last, 'notes-round-1.md');
  assert.strictEqual(compose(last, 'builder').reason, 'symlink');
});

test('fix4: a notes file past the round cap never gates pre-mortem or builder', (t) => {
  const folder = folderWith(t, { 'notes-round-1.md': notesFile(1), 'notes-round-9.md': notesFile(9, { pending: true }) });
  assert.strictEqual(compose(folder, 'builder').ok, true);
  assert.strictEqual(compose(folder, 'pre-mortem').ok, true);
  const zero = folderWith(t, { 'notes-round-0.md': notesFile(0, { pending: true }) });
  assert.strictEqual(compose(zero, 'builder').ok, true);
});

test('fix5: a File naming a directory is a no-storyboard refusal, for text and non-text names', (t) => {
  for (const file of ['boarddir.md', 'boarddir.png']) {
    const folder = folderWith(t, { 'design.md': design({ file }) });
    fs.mkdirSync(path.join(folder, file));
    const r = compose(folder, 'user', 1);
    assert.strictEqual(r.ok, false, file);
    assert.strictEqual(r.reason, 'no-storyboard', file);
  }
});

test('fix5: a non-text storyboard is checked, not read', (t) => {
  const folder = folderWith(t, { 'design.md': design({ file: 'board.png' }), 'board.png': 'x' });
  const reads = [];
  const spy = { ...fs, readFileSync: (f, ...a) => { reads.push(path.basename(String(f))); return fs.readFileSync(f, ...a); } };
  assert.strictEqual(composeBrief({ folder, reader: 'user', round: 1, briefsText: BRIEFS }, spy).ok, true);
  assert.ok(!reads.includes('board.png'));
});

const CAN_CHMOD = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

test('fix2.1: an unreadable design.md, notes file or storyboard is an IO error, never "missing"', { skip: !CAN_CHMOD }, (t) => {
  const locked = (folder, name) => { const f = path.join(folder, name); fs.chmodSync(f, 0o000); t.after(() => { try { fs.chmodSync(f, 0o644); } catch { /* folder already removed */ } }); };
  const a = folderWith(t, {});
  locked(a, 'design.md');
  assert.throws(() => compose(a, 'user', 1), /EACCES/);
  assert.throws(() => compose(a, 'builder'), /EACCES/);
  const b = folderWith(t, { 'design.md': design({ boardRound: 2 }), 'notes-round-1.md': notesFile(1) });
  locked(b, 'notes-round-1.md');
  assert.throws(() => compose(b, 'user', 2), /EACCES/);
  const c = folderWith(t, { 'notes-round-1.md': notesFile(1) });
  locked(c, 'notes-round-1.md');
  assert.throws(() => compose(c, 'builder'), /EACCES/);
  const d = folderWith(t, {});
  locked(d, 'storyboard.md');
  assert.throws(() => compose(d, 'user', 1), /EACCES/);
});

test('fix2.2: a directory named notes-round-N.md never counts as a clean round', (t) => {
  const last = folderWith(t, {});
  fs.mkdirSync(path.join(last, 'notes-round-1.md'));
  for (const reader of ['builder', 'pre-mortem']) {
    const r = compose(last, reader);
    assert.strictEqual(r.ok, false, reader);
    assert.strictEqual(r.reason, 'pending-outcomes', reader);
    assert.ok(/not a regular file/.test(r.detail), r.detail);
  }
  const prev = folderWith(t, { 'design.md': design({ boardRound: 2 }) });
  fs.mkdirSync(path.join(prev, 'notes-round-1.md'));
  const p = compose(prev, 'user', 2);
  assert.strictEqual(p.reason, 'pending-outcomes');
  assert.ok(/not a regular file/.test(p.detail) && !/is missing/.test(p.detail), p.detail);
});

test('fix3: the leaf is opened with O_NOFOLLOW, not trusted from an earlier lstat', { skip: process.platform === 'win32' }, (t) => {
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'design-race-')), 'x.md');
  t.after(() => fs.rmSync(path.dirname(outside), { recursive: true, force: true }));
  fs.writeFileSync(outside, 'OUTSIDE-CONTENT');
  const folder = folderWith(t, {});
  fs.rmSync(path.join(folder, 'storyboard.md'));
  fs.symlinkSync(outside, path.join(folder, 'storyboard.md'));
  // an lstat that reports a regular file, as a leaf swapped after the check would
  const lying = { ...fs, lstatSync: (p, ...a) => (String(p).endsWith('storyboard.md') ? fs.statSync(p, ...a) : fs.lstatSync(p, ...a)) };
  const r = composeBrief({ folder, reader: 'user', round: 1, briefsText: BRIEFS }, lying);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'symlink');
});

test('fix3.1: a FIFO named design.md is refused, not waited on', { skip: process.platform === 'win32', timeout: 5000 }, (t) => {
  const folder = folderWith(t, { 'design.md': null });
  require('child_process').execFileSync('mkfifo', [path.join(folder, 'design.md')]);
  for (const [reader, round] of [['user', 1], ['builder', undefined]]) {
    const r = compose(folder, reader, round);
    assert.strictEqual(r.ok, false, reader);
    assert.strictEqual(r.reason, 'no-frame', reader);
  }
});

test('fix3.2: a non-text storyboard is never opened or read', (t) => {
  const folder = folderWith(t, { 'design.md': design({ file: 'board.png' }), 'board.png': 'x' });
  const touched = [];
  const note = (f) => touched.push(typeof f === 'number' ? 'fd' : path.basename(String(f)));
  const spy = {
    ...fs,
    readFileSync: (f, ...a) => { note(f); return fs.readFileSync(f, ...a); },
    openSync: (f, ...a) => { note(f); return fs.openSync(f, ...a); },
  };
  assert.strictEqual(composeBrief({ folder, reader: 'user', round: 1, briefsText: BRIEFS }, spy).ok, true);
  assert.ok(!touched.includes('board.png'), touched.join());
  assert.ok(touched.includes('design.md'), 'the spy sees opens');
});

const NO_NOFOLLOW = { ...fs, constants: { ...fs.constants, O_NOFOLLOW: undefined } };
const composeWin = (folder, reader, round, fsImpl = NO_NOFOLLOW) => composeBrief({ folder, reader, round, briefsText: BRIEFS }, fsImpl);

test('fix3.3: the lstat fallback (no O_NOFOLLOW) refuses a symlink, a directory and a missing file', (t) => {
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'design-win-')), 'x.md');
  t.after(() => fs.rmSync(path.dirname(outside), { recursive: true, force: true }));
  fs.writeFileSync(outside, 'OUTSIDE-CONTENT');
  const a = folderWith(t, {});
  fs.rmSync(path.join(a, 'storyboard.md'));
  fs.symlinkSync(outside, path.join(a, 'storyboard.md'));
  assert.strictEqual(composeWin(a, 'user', 1).reason, 'symlink');

  const b = folderWith(t, {});
  fs.mkdirSync(path.join(b, 'notes-round-1.md'));
  const r = composeWin(b, 'builder');
  assert.strictEqual(r.reason, 'pending-outcomes');
  assert.ok(/not a regular file/.test(r.detail), r.detail);

  assert.strictEqual(composeWin(folderWith(t, { 'design.md': null }), 'user', 1).reason, 'no-frame');
  assert.strictEqual(composeWin(folderWith(t, {}), 'user', 1).ok, true);

  const denied = { ...NO_NOFOLLOW, lstatSync: () => { throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' }); } };
  assert.throws(() => composeWin(folderWith(t, {}), 'user', 1, denied), /EACCES|cannot inspect/);
});

test('fix3.4: a last notes round listed but gone at open refuses, never reads as clean', (t) => {
  const folder = folderWith(t, { 'notes-round-1.md': notesFile(1) });
  const gone = {
    ...fs,
    openSync: (f, ...a) => {
      if (path.basename(String(f)) === 'notes-round-1.md') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return fs.openSync(f, ...a);
    },
  };
  for (const reader of ['builder', 'pre-mortem']) {
    const r = composeBrief({ folder, reader, briefsText: BRIEFS }, gone);
    assert.strictEqual(r.ok, false, reader);
    assert.strictEqual(r.reason, 'pending-outcomes', reader);
    assert.ok(/notes-round-1\.md/.test(r.detail) && /vanished/.test(r.detail), r.detail);
  }
});
