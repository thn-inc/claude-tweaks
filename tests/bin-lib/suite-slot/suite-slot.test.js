'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = require('../../../plugin/bin/lib/suite-slot');
const { acquireSlot, slotIndexOf, defaultSlotBase } = mod;

test('AC2.1: run-tests.js re-exports the module\'s own functions', () => {
  const runTests = require('../../../tools/run-tests.js');
  for (const name of ['acquireSlot', 'releaseSlot', 'isPidAlive', 'ensureOwnDir', 'slotLane', 'resolveSlots']) {
    assert.strictEqual(typeof mod[name], 'function', `${name} is exported by the module`);
    assert.strictEqual(runTests[name], mod[name], `${name} is the module's own function`);
  }
});

test('slotIndexOf reads the slot number', () => {
  assert.strictEqual(slotIndexOf('/x/slot-0.lock'), 0);
  assert.strictEqual(slotIndexOf('/x/subset/slot-12.lock'), 12);
  assert.strictEqual(slotIndexOf('/x/ticket-3.json'), null);
  assert.strictEqual(slotIndexOf('/x/slot-1.reclaim'), null);
});

test('defaultSlotBase prefers CT_TEST_SUITE_SLOT_DIR', () => {
  assert.strictEqual(defaultSlotBase({ CT_TEST_SUITE_SLOT_DIR: '/d' }, '/t'), '/d');
  assert.strictEqual(defaultSlotBase({}, '/t'), path.join('/t', 'ct-test-suite-slots'));
  assert.strictEqual(defaultSlotBase({ CT_TEST_SUITE_SLOT_DIR: '' }, '/t'), path.join('/t', 'ct-test-suite-slots'));
});

// Pre-writes a live-looking holder on slot 0, calls acquireSlot, and frees the slot from the fake
// sleep so the wait loop ends after one logged poll.
function acquireBehindHolder(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-slot-test-'));
  const lock = path.join(dir, 'slot-0.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 424242, startedAt: 'then', cwd: '/elsewhere' }));
  const lines = [];
  let sleeps = 0;
  try {
    const result = acquireSlot({
      dir,
      slots: 1,
      pid: process.pid,
      cwd: '/here',
      isAlive: (p) => p === 424242,
      now: Date.now,
      sleep: () => {
        sleeps += 1;
        fs.unlinkSync(lock);
      },
      log: (line) => lines.push(line),
      ...extra,
    });
    return { result, lines, sleeps };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('acquireSlot names the caller\'s label and hint in its wait line', () => {
  const { result, lines, sleeps } = acquireBehindHolder({ label: 'verify.js [full lane]', hint: 'raise concurrency.suiteSlots' });
  assert.strictEqual(sleeps, 1);
  assert.strictEqual(lines.length, 1);
  assert.ok(
    lines[0].startsWith('verify.js [full lane]: waiting for a test-suite slot — held by pid 424242 (cwd /elsewhere)'),
    lines[0],
  );
  assert.ok(lines[0].includes('raise concurrency.suiteSlots'), lines[0]);
  assert.ok(!lines[0].includes('CT_TEST_SUITE_SLOTS'), lines[0]);
  assert.ok(result.endsWith('slot-0.lock'), result);
});

test('acquireSlot names the label and hint in its queued-behind line too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-slot-test-'));
  const ticket = path.join(dir, 'ticket-1.json');
  fs.writeFileSync(ticket, JSON.stringify({ pid: 424242, startedAt: 'then', cwd: '/elsewhere', slots: 1 }));
  const lines = [];
  try {
    acquireSlot({
      dir,
      slots: 1,
      pid: process.pid,
      cwd: '/here',
      isAlive: (p) => p === 424242,
      now: Date.now,
      sleep: () => fs.unlinkSync(ticket),
      log: (line) => lines.push(line),
      label: 'verify.js [full lane]',
      hint: 'raise concurrency.suiteSlots',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].startsWith('verify.js [full lane]: waiting for a test-suite slot — queued behind pid 424242'), lines[0]);
  assert.ok(lines[0].includes('raise concurrency.suiteSlots') && lines[0].includes('(ticket: '), lines[0]);
});

test('acquireSlot\'s default label is neutral, never a maintainer tool\'s name (#5119)', () => {
  const { lines } = acquireBehindHolder({});
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].startsWith('suite-slot: waiting for a test-suite slot — held by pid 424242'), lines[0]);
  assert.ok(lines[0].includes('set CT_TEST_SUITE_SLOTS to raise the limit (lock: '), lines[0]);
  const logged = [];
  assert.strictEqual(mod.resolveSlots({ CT_TEST_SUITE_SLOTS: 'x' }, (l) => logged.push(l)), 1);
  assert.ok(logged[0].startsWith('suite-slot: ignoring invalid CT_TEST_SUITE_SLOTS'), logged[0]);
});

test('ensureOwnDir\'s refusal names the override variable when the caller has one (#5119)', {
  skip: process.platform === 'win32' && 'win32: creating a symlink needs extra privileges',
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-slot-test-'));
  try {
    // A symlink in the directory's place: not a real directory, refused whoever owns it.
    const target = path.join(dir, 'elsewhere');
    fs.mkdirSync(target);
    const link = path.join(dir, 'link');
    fs.symlinkSync(target, link);
    assert.throws(() => mod.ensureOwnDir(link, mod.SLOT_DIR_VAR),
      (err) => err.message === `${link} is not a directory owned by this user — remove it and re-run, or set CT_TEST_SUITE_SLOT_DIR to a directory this user owns.`);
    assert.throws(() => mod.ensureOwnDir(link), (err) => err.message === `${link} is not a directory owned by this user — remove it and re-run.`);
    // acquireSlot refuses its lane directory the same way.
    assert.throws(() => acquireSlot({
      dir: link, slots: 1, pid: process.pid, cwd: '/here', isAlive: () => false, now: Date.now, sleep: () => {}, log: () => {},
    }), /or set CT_TEST_SUITE_SLOT_DIR to a directory this user owns\.$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
