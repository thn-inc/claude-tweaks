'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { EventEmitter } = require('events');

const {
  resolveSuiteSlots, chooseLane, workerCap, holdSlot,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'slot.js'));

test('resolveSuiteSlots: the declaration wins over the flag, the flag over the default (#5119)', () => {
  assert.deepStrictEqual(resolveSuiteSlots({ declared: 2, flag: 3 }), { slots: 2, source: 'declaration' });
  assert.deepStrictEqual(resolveSuiteSlots({ declared: null, flag: 3 }), { slots: 3, source: 'flag' });
  assert.deepStrictEqual(resolveSuiteSlots({ declared: null, flag: null }), { slots: 1, source: 'default' });
});

test('chooseLane: null with no local check, full when a full suite runs, subset otherwise (#5119)', () => {
  assert.strictEqual(chooseLane({ localCheckCount: 0, fullSuiteRuns: true }), null);
  assert.strictEqual(chooseLane({ localCheckCount: 2, fullSuiteRuns: true }), 'full');
  assert.strictEqual(chooseLane({ localCheckCount: 2, fullSuiteRuns: false }), 'subset');
});

test('workerCap: cores / (2 * slots), floored, never below 1 (#5119)', () => {
  assert.strictEqual(workerCap(16, 1), 8);
  assert.strictEqual(workerCap(16, 4), 2);
  assert.strictEqual(workerCap(3, 2), 1);
  assert.strictEqual(workerCap(1, 1), 1);
});

// holdSlot runs in-process against a temp CT_TEST_SUITE_SLOT_DIR, an injected env object (never
// process.env, which this suite's runner sets CT_TEST_SUITE_SLOT_HELD=1 in) and a fake `proc`
// whose `exit` only records its code.
function tmpSlotDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-slot-test-')));
}
function fakeProc() {
  const proc = new EventEmitter();
  proc.exits = [];
  proc.exit = (code) => { proc.exits.push(code); };
  return proc;
}
function hold(dir, over = {}) {
  const proc = over.proc || fakeProc();
  const env = over.env || { CT_TEST_SUITE_SLOT_DIR: dir };
  const h = holdSlot({
    lane: 'full', slots: 1, source: 'default', env, cores: 16, proc,
    sleep: () => { throw new Error('holdSlot waited where a slot was free'); }, log: () => {},
    ...over,
  });
  return { h, proc, env };
}
const lockFile = (dir, i = 0) => path.join(dir, `slot-${i}.lock`);

test('holdSlot returns null under CT_TEST_SUITE_SLOT_HELD=1 and creates no lock (#5119 AC7.1)', () => {
  const dir = path.join(tmpSlotDir(), 'never-created');
  const { h, proc } = hold(dir, { env: { CT_TEST_SUITE_SLOT_DIR: dir, CT_TEST_SUITE_SLOT_HELD: '1' } });
  assert.strictEqual(h, null);
  assert.strictEqual(fs.existsSync(dir), false, 'not even the lock dir is created');
  assert.strictEqual(proc.listenerCount('exit'), 0);
  assert.strictEqual(hold(dir, { lane: null }).h, null, 'no lane: nothing to queue for');
  assert.strictEqual(fs.existsSync(dir), false);
});

test('holdSlot sets CT_TEST_SUITE_SLOT_HELD and CT_TEST_WORKERS while held and restores them on release (#5119 AC7.2)', () => {
  const dir = tmpSlotDir();
  const preset = hold(dir, { slots: 2, env: { CT_TEST_SUITE_SLOT_DIR: dir, CT_TEST_WORKERS: '7' } });
  assert.strictEqual(preset.env.CT_TEST_SUITE_SLOT_HELD, '1');
  assert.strictEqual(preset.env.CT_TEST_WORKERS, '7', 'a caller-set worker count wins');
  preset.h.release();
  assert.ok(!('CT_TEST_SUITE_SLOT_HELD' in preset.env), 'an unset HELD is unset again');
  assert.strictEqual(preset.env.CT_TEST_WORKERS, '7');

  const unset = hold(dir, { slots: 2 });
  assert.strictEqual(unset.env.CT_TEST_SUITE_SLOT_HELD, '1');
  assert.strictEqual(unset.env.CT_TEST_WORKERS, String(workerCap(16, 2)));
  assert.strictEqual(unset.env.CT_TEST_WORKERS, '4');
  unset.h.release();
  assert.ok(!('CT_TEST_WORKERS' in unset.env));
  assert.ok(!('CT_TEST_SUITE_SLOT_HELD' in unset.env));
});

test('holdSlot release is idempotent, removes slot-<index>.lock and every listener it added (#5119)', () => {
  const dir = tmpSlotDir();
  const { h, proc } = hold(dir);
  assert.deepStrictEqual({ lane: h.lane, index: h.index, slots: h.slots, source: h.source }, {
    lane: 'full', index: 0, slots: 1, source: 'default',
  });
  assert.ok(fs.existsSync(lockFile(dir, h.index)));
  for (const ev of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) assert.strictEqual(proc.listenerCount(ev), 1, ev);
  h.release();
  assert.strictEqual(fs.existsSync(lockFile(dir, h.index)), false);
  for (const ev of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) assert.strictEqual(proc.listenerCount(ev), 0, ev);
  fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.pid + 1, cwd: '/other', startedAt: 'x' }));
  assert.doesNotThrow(() => h.release());
  assert.ok(fs.existsSync(lockFile(dir)), 'a second release never deletes a later holder\'s lock');
});

test('holdSlot: a subset-lane hold locks under subset/, never the full lane (#5119)', () => {
  const dir = tmpSlotDir();
  const { h } = hold(dir, { lane: 'subset' });
  assert.ok(fs.existsSync(path.join(dir, 'subset', 'slot-0.lock')));
  assert.strictEqual(fs.existsSync(lockFile(dir)), false);
  h.release();
});

test('holdSlot: a signal with no other listener runs beforeRelease, releases, and exits 128+n (#5119)', () => {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const dir = tmpSlotDir();
    const order = [];
    const { proc } = hold(dir, { beforeRelease: () => order.push(fs.existsSync(lockFile(dir)) ? 'kill-while-held' : 'kill-after-release') });
    proc.emit(sig);
    assert.deepStrictEqual(order, ['kill-while-held'], sig);
    assert.strictEqual(fs.existsSync(lockFile(dir)), false, sig);
    assert.deepStrictEqual(proc.exits, [128 + os.constants.signals[sig]], sig);
  }
});

test('holdSlot: adjudication\'s own signal handler still runs and is the only one to exit (#5119)', () => {
  const dir = tmpSlotDir();
  const { proc } = hold(dir);
  const seen = [];
  proc.on('SIGTERM', () => {
    seen.push(fs.existsSync(lockFile(dir)) ? 'adjudicator-saw-held' : 'adjudicator-saw-released');
    proc.exit(143);
  });
  proc.emit('SIGTERM');
  assert.deepStrictEqual(seen, ['adjudicator-saw-released']);
  assert.deepStrictEqual(proc.exits, [143], 'exit is called once, by the later listener');
  assert.strictEqual(proc.listenerCount('SIGTERM'), 1, 'only the adjudicator\'s own listener remains');
});

test('holdSlot: the exit hook frees the slot on any exit path (#5119)', () => {
  const dir = tmpSlotDir();
  const { proc } = hold(dir);
  proc.emit('exit', 1);
  assert.strictEqual(fs.existsSync(lockFile(dir)), false);
});

test('holdSlot: index is the slot taken (#5119)', () => {
  const dir = tmpSlotDir();
  fs.writeFileSync(lockFile(dir, 0), JSON.stringify({ pid: process.pid, cwd: '/holder', startedAt: new Date().toISOString() }));
  const { h } = hold(dir, { slots: 2, pid: process.pid + 1 });
  assert.strictEqual(h.index, 1);
  assert.ok(fs.existsSync(lockFile(dir, 1)));
  h.release();
  assert.ok(fs.existsSync(lockFile(dir, 0)), 'the live holder\'s lock is untouched');
});
