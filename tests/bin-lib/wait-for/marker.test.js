'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SESSION_ID_RE,
  stopsPath,
  waitsPath,
  formatStop,
  appendStop,
  appendWait,
  readStops,
  readWaits,
  isFinalStop,
  MarkerFileError,
} = require('../../../plugin/bin/lib/wait-for/marker');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wait-marker-'));
}

const STOP_X = '{"agentId":"x","at":1,"blocked":false,"pending":0}\n';
const STOP_Y = '{"agentId":"y","at":2,"blocked":true,"pending":null}\n';

test('AC12.2: stopsPath and waitsPath return no path for an id outside [A-Za-z0-9_-]', () => {
  const tmpDir = tmp();
  for (const bad of ['a.b', 'a/b', '..', '', 'a b', undefined, 42]) {
    assert.equal(stopsPath(bad, { tmpDir }), null, String(bad));
    assert.equal(waitsPath(bad, { tmpDir }), null, String(bad));
  }
  assert.equal(stopsPath('ab_C-9', { tmpDir }), path.join(tmpDir, 'ct-agent-stops-ab_C-9.jsonl'));
  assert.equal(waitsPath('ab_C-9', { tmpDir }), path.join(tmpDir, 'ct-agent-waits-ab_C-9.jsonl'));
  assert.ok(SESSION_ID_RE.test('ab_C-9'));
  assert.equal(appendStop('a.b', { agentId: 'x', at: 1, blocked: false, pending: 0 }, { tmpDir }), false);
  assert.equal(appendWait('a.b', { kind: 'close', window: 'w', reason: 'done' }, { tmpDir }), false);
  assert.deepEqual(fs.readdirSync(tmpDir), []);
});

test('round trip: formatStop and appendStop write the spec line shape', () => {
  const tmpDir = tmp();
  appendStop('s1', { agentId: 'x', at: 1, blocked: false, pending: 0 }, { tmpDir });
  appendStop('s1', { pending: null, blocked: true, at: 2, agentId: 'y' }, { tmpDir });
  const p = stopsPath('s1', { tmpDir });
  assert.equal(fs.readFileSync(p, 'utf8'), STOP_X + STOP_Y);
  assert.equal(formatStop({ agentId: 'x', at: 1, blocked: false, pending: 0 }), STOP_X);
  const { stops, count } = readStops('s1', { tmpDir });
  assert.equal(count, 2);
  assert.deepEqual(stops, [
    { index: 0, agentId: 'x', at: 1, blocked: false, pending: 0 },
    { index: 1, agentId: 'y', at: 2, blocked: true, pending: null },
  ]);
});

test('AC10.1/AC10.2: a missing file reads as no stops', () => {
  const tmpDir = tmp();
  assert.deepEqual(readStops('s1', { tmpDir }), { stops: [], count: 0 });
  assert.deepEqual(readWaits('s1', { tmpDir }), []);
});

test('readers throw TypeError for an invalid session id', () => {
  const tmpDir = tmp();
  assert.throws(() => readStops('a.b', { tmpDir }), TypeError);
  assert.throws(() => readWaits('a.b', { tmpDir }), TypeError);
});

test('AC10.3: a symlink, a dangling one included, is refused unread', () => {
  const tmpDir = tmp();
  const real = path.join(tmpDir, 'real.jsonl');
  fs.writeFileSync(real, STOP_X);
  const p = stopsPath('s1', { tmpDir });
  fs.symlinkSync(real, p, 'file');
  assert.throws(
    () => readStops('s1', { tmpDir }),
    (e) => e instanceof MarkerFileError && e.reason === 'symlink' && e.path === p,
  );
  fs.unlinkSync(p);
  fs.symlinkSync(path.join(tmpDir, 'nowhere'), p, 'file');
  assert.throws(
    () => readStops('s1', { tmpDir }),
    (e) => e instanceof MarkerFileError && e.reason === 'symlink',
  );
  const w = waitsPath('s1', { tmpDir });
  fs.symlinkSync(real, w, 'file');
  assert.throws(
    () => readWaits('s1', { tmpDir }),
    (e) => e instanceof MarkerFileError && e.reason === 'symlink',
  );
});

test('AC10.3: a directory at the path is refused', () => {
  const tmpDir = tmp();
  fs.mkdirSync(stopsPath('s1', { tmpDir }));
  assert.throws(
    () => readStops('s1', { tmpDir }),
    (e) => e instanceof MarkerFileError && e.reason === 'not-a-file',
  );
});

test('AC10.4: a line that is not valid JSON is skipped and the rest are read', () => {
  const tmpDir = tmp();
  const text =
    STOP_X +
    '{"agentId":"y"\n' +
    '{"agentId":"z","at":3,"blocked":false,"pending":0}\n' +
    '{"agentId":"w","at":1,"blocked":"no","pending":0}\n';
  const p = stopsPath('s1', { tmpDir });
  for (const body of [text, text.replace(/\n/g, '\r\n')]) {
    fs.writeFileSync(p, body);
    const { stops, count } = readStops('s1', { tmpDir });
    assert.deepEqual(stops.map((s) => [s.index, s.agentId]), [[0, 'x'], [2, 'z']]);
    assert.equal(count, 2);
  }
});

test('a stop line with a bad field is skipped', () => {
  const tmpDir = tmp();
  const lines = [
    '{"agentId":"","at":1,"blocked":false,"pending":0}',
    '{"agentId":"a","at":"1","blocked":false,"pending":0}',
    '{"agentId":"b","at":1,"blocked":false,"pending":-1}',
    '{"agentId":"c","at":1,"blocked":false,"pending":1.5}',
    '{"agentId":"d","at":1,"blocked":false}',
    'null',
    '[]',
    '{"agentId":"ok","at":1,"blocked":false,"pending":2}',
  ];
  fs.writeFileSync(stopsPath('s1', { tmpDir }), lines.join('\n') + '\n');
  assert.deepEqual(readStops('s1', { tmpDir }).stops.map((s) => s.agentId), ['ok']);
});

test('a waits line whose fields do not match its kind is skipped', () => {
  const tmpDir = tmp();
  const lines = [
    '{"kind":"delivered","agentId":"a","stop":"x"}',
    '{"kind":"open","window":"w","target":"count","key":"k","openedAt":1,"n":2}',
    '{"kind":"close","window":"w","reason":"other"}',
    '{"kind":"mystery"}',
    '{"kind":"open","window":"w","target":"agents","key":"k","openedAt":1,"deadline":2,"n":1,"ids":["a",""]}',
    '{"kind":"delivered","agentId":"a","stop":3}',
  ];
  fs.writeFileSync(waitsPath('s1', { tmpDir }), lines.join('\n') + '\n');
  assert.deepEqual(readWaits('s1', { tmpDir }), [{ kind: 'delivered', agentId: 'a', stop: 3, index: 5 }]);
});

test('valid open and close waits lines round trip through appendWait', () => {
  const tmpDir = tmp();
  const open = { kind: 'open', window: 'w1', target: 'agents', key: 'k', openedAt: 10, deadline: 20, n: 2, ids: ['a', 'b'] };
  const close = { kind: 'close', window: 'w1', reason: 'done' };
  assert.equal(appendWait('s1', open, { tmpDir }), true);
  assert.equal(appendWait('s1', close, { tmpDir }), true);
  assert.deepEqual(readWaits('s1', { tmpDir }), [{ ...open, index: 0 }, { ...close, index: 1 }]);
});

test('isFinalStop is true only for an unblocked stop with nothing pending', () => {
  assert.equal(isFinalStop({ blocked: false, pending: 0 }), true);
  assert.equal(isFinalStop({ blocked: true, pending: 0 }), false);
  assert.equal(isFinalStop({ blocked: false, pending: 1 }), false);
  assert.equal(isFinalStop({ blocked: false, pending: null }), false);
});

test('the writer refuses a symlink where O_NOFOLLOW exists', { skip: typeof fs.constants.O_NOFOLLOW !== 'number' && 'no O_NOFOLLOW on this platform' }, () => {
  const tmpDir = tmp();
  const victim = path.join(tmpDir, 'victim.txt');
  fs.writeFileSync(victim, 'untouched');
  fs.symlinkSync(victim, stopsPath('s1', { tmpDir }), 'file');
  assert.throws(() => appendStop('s1', { agentId: 'x', at: 1, blocked: false, pending: 0 }, { tmpDir }));
  assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
});

test("the reader's swap check refuses a replaced file", (t) => {
  const tmpDir = tmp();
  fs.writeFileSync(stopsPath('s1', { tmpDir }), STOP_X);
  const real = fs.fstatSync;
  t.mock.method(fs, 'fstatSync', (fd, opts) => {
    const st = real(fd, opts);
    return { isFile: () => true, dev: st.dev, ino: st.ino + 1n };
  });
  assert.throws(
    () => readStops('s1', { tmpDir, constants: { ...fs.constants, O_NOFOLLOW: undefined } }),
    (e) => e instanceof MarkerFileError && e.reason === 'replaced',
  );
});
