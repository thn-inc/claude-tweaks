// tests/run-tests-isolation.test.js
//
// #3969: running many full suites at once (sibling worktrees, sessions) overloaded the dev
// machine. tools/run-tests.js bounds its own load: `--test-concurrency` defaults to half the
// cores (CT_TEST_CONCURRENCY overrides) and a cross-process slot semaphore caps simultaneous
// suites (CT_TEST_SUITE_SLOTS). This pins the pure helpers; `platform`/`nodeMajor`/`env` are
// parameters, never a stubbed `process` in this process.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const {
  resolveConcurrency, resolveSlots, listTestFiles, buildTestArgs,
  isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, createRunRoot, sweepStaleRoots, readFileList, slotLane,
  subsetFallbackReason, gitFixtureConfigEnv, appendGitConfigEnv, writeGitTemplateDir, GIT_TEMPLATE_CONFIG, NODE_TEST_VALUE_FLAGS, parseRunnerOperands, canonicalPath,
  runnerChildEnv, isTemplateSampleHook, leftoverEntries, summarizeLeftovers, leftoverWarning, RUN_ROOT_OWN_ENTRIES,
} = require(path.join(ROOT, 'tools', 'run-tests.js'));

test('resolveConcurrency defaults to half the cores, at least 1', () => {
  assert.strictEqual(resolveConcurrency({}, 12), 6);
  assert.strictEqual(resolveConcurrency({}, 1), 1);
  assert.strictEqual(resolveConcurrency({}, 3), 1);
});

test('resolveConcurrency honors a positive-integer CT_TEST_CONCURRENCY', () => {
  assert.strictEqual(resolveConcurrency({ CT_TEST_CONCURRENCY: '3' }, 12), 3);
});

test('resolveConcurrency under CI defaults to cores - 1 (at least 1); CT_TEST_CONCURRENCY still wins', () => {
  assert.strictEqual(resolveConcurrency({ CI: 'true' }, 12), 11);
  assert.strictEqual(resolveConcurrency({ CI: '1' }, 4), 3);
  assert.strictEqual(resolveConcurrency({ CI: 'true' }, 1), 1);
  assert.strictEqual(resolveConcurrency({ CI: 'true', CT_TEST_CONCURRENCY: '3' }, 12), 3);
  // An empty CI is not CI: the half-the-cores default stands.
  assert.strictEqual(resolveConcurrency({ CI: '' }, 12), 6);
});

test('resolveConcurrency ignores an invalid CT_TEST_CONCURRENCY', () => {
  for (const bad of ['0', '-2', 'abc', '2.5']) {
    assert.strictEqual(resolveConcurrency({ CT_TEST_CONCURRENCY: bad }, 12), 6, bad);
  }
});

test('resolveSlots defaults to 1', () => {
  const lines = [];
  assert.strictEqual(resolveSlots({}, (l) => lines.push(l)), 1);
  assert.deepStrictEqual(lines, []);
});

test('resolveSlots honors CT_TEST_SUITE_SLOTS=3', () => {
  assert.strictEqual(resolveSlots({ CT_TEST_SUITE_SLOTS: '3' }, () => {}), 3);
});

test('resolveSlots: an invalid value falls back to 1 and logs one line naming CT_TEST_SUITE_SLOTS', () => {
  for (const bad of ['0', '-2', 'abc', '2.5']) {
    const lines = [];
    assert.strictEqual(resolveSlots({ CT_TEST_SUITE_SLOTS: bad }, (l) => lines.push(l)), 1, bad);
    assert.strictEqual(lines.length, 1, bad);
    assert.match(lines[0], /CT_TEST_SUITE_SLOTS/);
  }
});

test('resolveSlots reads the named variable — CT_TEST_SUBSET_SLOTS for the subset lane', () => {
  assert.strictEqual(resolveSlots({ CT_TEST_SUBSET_SLOTS: '2', CT_TEST_SUITE_SLOTS: '5' }, () => {}, 'CT_TEST_SUBSET_SLOTS'), 2);
  assert.strictEqual(resolveSlots({ CT_TEST_SUITE_SLOTS: '5' }, () => {}, 'CT_TEST_SUBSET_SLOTS'), 1);
  const lines = [];
  assert.strictEqual(resolveSlots({ CT_TEST_SUBSET_SLOTS: 'x' }, (l) => lines.push(l), 'CT_TEST_SUBSET_SLOTS'), 1);
  assert.match(lines[0], /CT_TEST_SUBSET_SLOTS/);
});

test('slotLane puts a --files-from subset in its own subset/ lane and every other run in the base lane', () => {
  assert.deepStrictEqual(slotLane('/slots', true), { dir: path.join('/slots', 'subset'), slotsVar: 'CT_TEST_SUBSET_SLOTS' });
  assert.deepStrictEqual(slotLane('/slots', false), { dir: '/slots', slotsVar: 'CT_TEST_SUITE_SLOTS' });
});

test('listTestFiles accepts an absolute root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-abs-root-'));
  try {
    fs.writeFileSync(path.join(tmp, 'a.test.js'), '');
    fs.writeFileSync(path.join(tmp, 'b.js'), '');
    assert.deepStrictEqual(listTestFiles(ROOT, [tmp]), [path.join(tmp, 'a.test.js')]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildTestArgs rejects a non-positive-integer concurrency; a valid one still reaches the win32/Node 20 error', () => {
  for (const bad of [undefined, 0, -1, 2.5, '4', NaN]) {
    assert.throws(() => buildTestArgs([], [], { platform: 'linux', nodeMajor: 22, concurrency: bad }), /concurrency/, String(bad));
  }
  assert.throws(() => buildTestArgs([], ['tests'], { platform: 'win32', nodeMajor: 20, concurrency: 4 }), /Node >= 22/);
});

// #4024: `--files-from <list>` runs an explicit subset (verify.js's impact-selected tests).
test('readFileList returns the listed entries in order, ignoring blank lines, CRs and repeats', () => {
  const seen = [];
  const exists = (p) => { seen.push(p); return true; };
  assert.deepStrictEqual(
    readFileList('tests/a.test.js\r\n\n  \ntests/sub/b.test.js\ntests/a.test.js\n', { exists }),
    ['tests/a.test.js', 'tests/sub/b.test.js'],
  );
  assert.deepStrictEqual(seen, ['tests/a.test.js', 'tests/sub/b.test.js']);
});

test('readFileList refuses an empty list, a missing file and a non-test entry', () => {
  assert.throws(() => readFileList('\n \n', { exists: () => true }), /no test files/);
  assert.throws(() => readFileList('tests/gone.test.js\n', { exists: () => false }), /tests\/gone\.test\.js/);
  assert.throws(() => readFileList('tests/a.test.js\nlib/x.js\n', { exists: () => true }), /lib\/x\.js.*\.test\.js|\.test\.js.*lib\/x\.js/);
});

test('readFileList refuses an entry that is not a repo-relative path', () => {
  for (const entry of ['-x.test.js', '../x.test.js', 'tests/../../x.test.js', '/abs/x.test.js', 'C:\\x.test.js', 'tests\\..\\x.test.js']) {
    assert.throws(() => readFileList(`${entry}\n`, { exists: () => true }), /not a repo-relative path/, entry);
  }
});

test('buildTestArgs with null roots (an explicit subset) passes the file list on every platform', () => {
  assert.deepStrictEqual(
    buildTestArgs(['tests/a.test.js'], null, { platform: 'win32', nodeMajor: 20, concurrency: 2 }),
    ['--test', '--test-concurrency=2', 'tests/a.test.js'],
  );
  assert.deepStrictEqual(
    buildTestArgs(['tests/a.test.js'], null, { platform: 'linux', nodeMajor: 22, concurrency: 2 }),
    ['--test', '--test-concurrency=2', 'tests/a.test.js'],
  );
});

// The slot lock and run-root helpers take `isAlive`, `now`, `sleep` and `log` as parameters, so
// these tests use fake pids (111/222/...) and a Set of "alive" ones — never a real process.
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-slot-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// `label` as tools/run-tests.js passes it: the shared module's own default is neutral (#5119).
function slotArgs(dir, over) {
  return { dir, slots: 1, pid: 111, cwd: '/work/a', isAlive: () => false, now: Date.now, log: () => {}, sleep: () => {}, label: 'run-tests.js', ...over };
}

const noSleep = () => { throw new Error('sleep must not be called'); };

function writeLock(dir, i, pid) {
  const p = path.join(dir, `slot-${i}.lock`);
  fs.writeFileSync(p, JSON.stringify({ pid, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other' }));
  return p;
}

test('acquireSlot takes a free slot', () => {
  withTempDir((dir) => {
    const lock = acquireSlot(slotArgs(dir));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
    const held = JSON.parse(fs.readFileSync(lock, 'utf8'));
    assert.strictEqual(held.pid, 111);
    assert.strictEqual(held.cwd, '/work/a');
  });
});

test("acquireSlot reclaims a dead holder's lock without sleeping", () => {
  withTempDir((dir) => {
    writeLock(dir, 0, 222);
    const lock = acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive: (pid) => pid === 111 }));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
    assert.strictEqual(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, 111);
  });
});

// Two waiters can both judge the same dead lock stale. The loser of the reclaim must not delete
// the winner's live lock: the stale verdict is re-checked under a per-slot `.reclaim` mutex.
test("acquireSlot does not delete a live winner's lock that lands after the stale verdict", () => {
  withTempDir((dir) => {
    const p = writeLock(dir, 0, 222);
    let swapped = false;
    const isAlive = (pid) => {
      if (pid === 222 && !swapped) {
        swapped = true;
        writeLock(dir, 0, 333); // another process reclaims and takes the slot right after our verdict
        return false;
      }
      return pid === 333;
    };
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).pid, 333, "the winner's lock must survive");
      fs.unlinkSync(p);
    };
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep, isAlive })), p);
    assert.strictEqual(sleeps, 1);
    assert.ok(!fs.existsSync(path.join(dir, 'slot-0.reclaim')));
  });
});

test('acquireSlot does not reclaim a slot whose fresh .reclaim mutex is held by someone else', () => {
  withTempDir((dir) => {
    const p = writeLock(dir, 0, 222);
    const mutex = path.join(dir, 'slot-0.reclaim');
    fs.writeFileSync(mutex, '');
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).pid, 222, 'not reclaimed on the first scan');
      fs.unlinkSync(mutex);
    };
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep })), p);
    assert.strictEqual(sleeps, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).pid, 111);
  });
});

test('acquireSlot clears an old .reclaim mutex left by a crashed reclaimer and reclaims', () => {
  withTempDir((dir) => {
    const p = writeLock(dir, 0, 222);
    const mutex = path.join(dir, 'slot-0.reclaim');
    fs.writeFileSync(mutex, '');
    const old = new Date(Date.now() - 31 * 1000);
    fs.utimesSync(mutex, old, old);
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep: noSleep })), p);
    assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).pid, 111);
    assert.ok(!fs.existsSync(mutex));
  });
});

test('a lock carrying pid 0 is not live forever: it counts as unparseable and is reclaimed once old', () => {
  withTempDir((dir) => {
    const p = writeLock(dir, 0, 0);
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(p, old, old);
    // isAlive says yes to everything: only the pid > 0 requirement can make this lock reclaimable.
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive: () => true })), p);
    assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).pid, 111);
  });
});

test('acquireSlot reclaims an old unparseable lock', () => {
  withTempDir((dir) => {
    const p = path.join(dir, 'slot-0.lock');
    fs.writeFileSync(p, '');
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(p, old, old);
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep: noSleep })), p);
    assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).pid, 111);
  });
});

test('a fresh unparseable lock is waited on, not reclaimed', () => {
  withTempDir((dir) => {
    const p = path.join(dir, 'slot-0.lock');
    fs.writeFileSync(p, '');
    let sleeps = 0;
    const sleep = () => { sleeps += 1; fs.unlinkSync(p); };
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep })), p);
    assert.strictEqual(sleeps, 1);
  });
});

test('acquireSlot waits for a live holder, logs once, then acquires', () => {
  withTempDir((dir) => {
    const p = writeLock(dir, 0, 333);
    const lines = [];
    let sleeps = 0;
    const sleep = (ms) => {
      sleeps += 1;
      assert.strictEqual(ms, 2000);
      if (sleeps === 2) fs.unlinkSync(p);
    };
    const lock = acquireSlot(slotArgs(dir, { sleep, log: (l) => lines.push(l), isAlive: (pid) => pid === 333 }));
    assert.strictEqual(lock, p);
    assert.strictEqual(sleeps, 2);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(
      lines[0],
      'run-tests.js: waiting for a test-suite slot — held by pid 333 (cwd /work/other) since 2026-01-01T00:00:00.000Z; set CT_TEST_SUITE_SLOTS to raise the limit (lock: ' + p + ')',
    );
  });
});

// A lock naming our own pid can only be left by a crashed run whose pid the OS reused for this
// one, and isAlive says yes (it is us): waiting on it would wait on ourselves forever.
test('acquireSlot reclaims a lock naming its own pid without sleeping, even when isAlive says it is live', () => {
  withTempDir((dir) => {
    const p = writeLock(dir, 0, 111);
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive: () => true })), p);
    assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).pid, 111);
  });
});

test('acquireSlot uses a second slot when slots=2', () => {
  withTempDir((dir) => {
    writeLock(dir, 0, 333);
    const lock = acquireSlot(slotArgs(dir, { slots: 2, sleep: noSleep, isAlive: (pid) => pid === 333 }));
    assert.strictEqual(lock, path.join(dir, 'slot-1.lock'));
  });
});

// ---- #4333: waiters are served in arrival order through ticket files. ----

function writeTicket(dir, seq, pid, slots = 1) {
  const p = path.join(dir, `ticket-${seq}.json`);
  fs.writeFileSync(p, JSON.stringify({ pid, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other', slots }));
  return p;
}

// The names of the ticket files in `dir` that belong to `pid`.
function ticketNamesOf(dir, pid) {
  return fs.readdirSync(dir)
    .filter((n) => /^ticket-\d+\.json$/.test(n))
    .filter((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')).pid === pid);
}

test('#4333 AC2.1: a later arrival waits behind a live earlier ticket even when a slot is free', () => {
  withTempDir((dir) => {
    const ticket = writeTicket(dir, 1, 222);
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      assert.ok(!fs.existsSync(path.join(dir, 'slot-0.lock')), 'the free slot must not be taken past an earlier ticket');
      fs.unlinkSync(ticket);
    };
    const lock = acquireSlot(slotArgs(dir, { sleep, isAlive: (pid) => pid === 222 }));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
    assert.strictEqual(sleeps, 1);
  });
});

test('#4333 AC3.1: a ticket left by a dead waiter is removed and does not block the queue', () => {
  withTempDir((dir) => {
    const ticket = writeTicket(dir, 1, 222);
    const lock = acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive: () => false }));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
    assert.ok(!fs.existsSync(ticket));
  });
});

test("#4333 a live waiter's ticket is never stale by age", () => {
  withTempDir((dir) => {
    const ticket = writeTicket(dir, 1, 222);
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(ticket, old, old);
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      assert.ok(fs.existsSync(ticket), 'an old ticket of a live pid must stay');
      fs.unlinkSync(ticket);
    };
    acquireSlot(slotArgs(dir, { sleep, isAlive: (pid) => pid === 222 }));
    assert.strictEqual(sleeps, 1);
  });
});

test('#4333 a ticket naming our own pid is stale', () => {
  withTempDir((dir) => {
    writeTicket(dir, 1, 111);
    const lock = acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive: () => true }));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
  });
});

test("#4333 a waiter whose own ticket was removed rejoins at the tail of the queue", () => {
  withTempDir((dir) => {
    const lockPath = writeLock(dir, 0, 333);
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      if (sleeps === 1) {
        fs.unlinkSync(path.join(dir, 'ticket-1.json'));
        writeTicket(dir, 2, 222); // a newcomer arrives while our ticket is gone
        return;
      }
      const ours = ticketNamesOf(dir, 111);
      assert.deepStrictEqual(ours, ['ticket-3.json'], 'the waiter must rejoin behind the newcomer, not at its old number');
      fs.unlinkSync(path.join(dir, 'ticket-2.json'));
      fs.unlinkSync(lockPath);
    };
    const lock = acquireSlot(slotArgs(dir, { sleep, isAlive: (pid) => pid === 333 || pid === 222 }));
    assert.strictEqual(lock, lockPath);
    assert.strictEqual(sleeps, 2);
  });
});

test('#4333 a foreign ticket at our own path makes us rejoin and is left in place', () => {
  withTempDir((dir) => {
    const lockPath = writeLock(dir, 0, 333);
    const foreign = path.join(dir, 'ticket-1.json');
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      if (sleeps === 1) {
        writeTicket(dir, 1, 222);
        return;
      }
      const ours = ticketNamesOf(dir, 111);
      assert.strictEqual(ours.length, 1);
      assert.ok(Number(/^ticket-(\d+)\.json$/.exec(ours[0])[1]) > 1, 'a new ticket is numbered after the foreign one');
      fs.unlinkSync(foreign);
      fs.unlinkSync(lockPath);
    };
    const lock = acquireSlot(slotArgs(dir, { sleep, isAlive: (pid) => pid === 333 || pid === 222 }));
    assert.strictEqual(lock, lockPath);
  });
});

test('#4333 a ticket of ours overwritten with JSON null makes us rejoin instead of crashing', () => {
  withTempDir((dir) => {
    const lockPath = writeLock(dir, 0, 333);
    const nulled = path.join(dir, 'ticket-1.json');
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      if (sleeps === 1) {
        fs.writeFileSync(nulled, 'null');
        // The slot is free from here on, so only the `null` file can still hold us back: a fresh one
        // counts as an unidentified holder ahead of the new ticket and blocks every slot index.
        fs.unlinkSync(lockPath);
        return;
      }
      fs.unlinkSync(nulled);
    };
    const lock = acquireSlot(slotArgs(dir, { sleep, isAlive: (pid) => pid === 333 }));
    assert.strictEqual(lock, lockPath);
    assert.strictEqual(sleeps, 2);
  });
});

test('#4333 acquireSlot never deletes a ticket at its path that no longer names it', () => {
  withTempDir((dir) => {
    writeLock(dir, 0, 333);
    let first = true;
    const isAlive = (pid) => {
      if (first) {
        first = false;
        writeTicket(dir, 1, 222);
      }
      return pid === 222;
    };
    const lock = acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive }));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'ticket-1.json'), 'utf8')).pid, 222);
  });
});

test('#4333 a failed slot-lock write after the ticket leaves nothing behind', () => {
  withTempDir((dir) => {
    const origWrite = fs.writeSync;
    let calls = 0;
    fs.writeSync = (...args) => {
      calls += 1;
      if (calls === 1) return origWrite(...args);
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    };
    try {
      assert.throws(
        () => acquireSlot({ dir, slots: 1, pid: 4242, cwd: '/x', isAlive: () => true, now: Date.now, sleep: () => {}, log: () => {} }),
        /no space left/,
      );
    } finally {
      fs.writeSync = origWrite;
    }
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('#4333 a ticket taken after ours does not hold us back', () => {
  withTempDir((dir) => {
    const lockPath = writeLock(dir, 0, 333);
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      writeTicket(dir, 2, 222); // ours is ticket-1
      fs.unlinkSync(lockPath);
    };
    const lock = acquireSlot(slotArgs(dir, { sleep, isAlive: (pid) => pid === 333 || pid === 222 }));
    assert.strictEqual(lock, lockPath);
    assert.strictEqual(sleeps, 1);
  });
});

test('#4333 a new arrival numbers its ticket after the highest existing one', () => {
  withTempDir((dir) => {
    const earlier = writeTicket(dir, 7, 222);
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      const mine = JSON.parse(fs.readFileSync(path.join(dir, 'ticket-8.json'), 'utf8'));
      assert.deepStrictEqual({ pid: mine.pid, cwd: mine.cwd, slots: mine.slots }, { pid: 111, cwd: '/work/a', slots: 1 });
      assert.strictEqual(typeof mine.startedAt, 'string');
      fs.unlinkSync(earlier);
    };
    acquireSlot(slotArgs(dir, { sleep, isAlive: (pid) => pid === 222 }));
    assert.strictEqual(sleeps, 1);
  });
});

test('#4333 acquireSlot leaves only its lock behind once it holds the slot', () => {
  withTempDir((dir) => {
    acquireSlot(slotArgs(dir, { sleep: noSleep }));
    assert.deepStrictEqual(fs.readdirSync(dir), ['slot-0.lock']);
  });
});

test('#4333 a queued waiter logs once, naming the lowest live ticket ahead', () => {
  withTempDir((dir) => {
    writeTicket(dir, 10, 333);
    writeTicket(dir, 9, 222);
    const lines = [];
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      fs.unlinkSync(path.join(dir, sleeps === 1 ? 'ticket-9.json' : 'ticket-10.json'));
    };
    acquireSlot(slotArgs(dir, { sleep, log: (l) => lines.push(l), isAlive: (pid) => pid === 333 || pid === 222 }));
    assert.deepStrictEqual(lines, [
      'run-tests.js: waiting for a test-suite slot — queued behind pid 222 (cwd /work/other) since 2026-01-01T00:00:00.000Z; set CT_TEST_SUITE_SLOTS to raise the limit (ticket: ' +
        path.join(dir, 'ticket-9.json') + ')',
    ]);
  });
});

test('#4333 a later arrival with a higher limit takes a slot index the waiters ahead of it cannot use', () => {
  withTempDir((dir) => {
    writeLock(dir, 0, 333);
    writeTicket(dir, 1, 222, 1);
    const isAlive = (pid) => pid === 222 || pid === 333;
    assert.strictEqual(
      acquireSlot(slotArgs(dir, { slots: 2, sleep: noSleep, isAlive })),
      path.join(dir, 'slot-1.lock'),
    );
    const lines = [];
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'slot-0.lock'), 'utf8')).pid, 333);
      assert.ok(fs.existsSync(path.join(dir, 'ticket-1.json')));
      fs.unlinkSync(path.join(dir, 'slot-0.lock'));
      fs.unlinkSync(path.join(dir, 'ticket-1.json'));
    };
    const lock = acquireSlot(slotArgs(dir, { pid: 444, slots: 1, isAlive, sleep, log: (l) => lines.push(l) }));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
    assert.strictEqual(sleeps, 1);
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].startsWith('run-tests.js: waiting for a test-suite slot — queued behind pid 222 '), lines[0]);
  });
  // The queued line names the ticket that actually blocks: ticket-1's limit of 1 leaves index 1 free,
  // so deleting it alone would not unblock a slots=2 arrival.
  withTempDir((dir) => {
    writeTicket(dir, 1, 222, 1);
    writeTicket(dir, 2, 333, 3);
    const lines = [];
    const sleep = () => {
      fs.unlinkSync(path.join(dir, 'ticket-1.json'));
      fs.unlinkSync(path.join(dir, 'ticket-2.json'));
    };
    acquireSlot(slotArgs(dir, { slots: 2, sleep, log: (l) => lines.push(l), isAlive: (pid) => pid === 222 || pid === 333 }));
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].endsWith('(ticket: ' + path.join(dir, 'ticket-2.json') + ')'), lines[0]);
  });
});

test('#4333 a ticket whose limit cannot be read blocks every slot index', () => {
  withTempDir((dir) => {
    const ticket = path.join(dir, 'ticket-1.json');
    fs.writeFileSync(ticket, JSON.stringify({ pid: 222, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other' }));
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      assert.ok(!fs.existsSync(path.join(dir, 'slot-0.lock')));
      assert.ok(!fs.existsSync(path.join(dir, 'slot-1.lock')));
      fs.unlinkSync(ticket);
    };
    acquireSlot(slotArgs(dir, { slots: 2, sleep, isAlive: (pid) => pid === 222 }));
    assert.strictEqual(sleeps, 1);
  });
});

test('#4333 a fresh ticket that cannot be parsed blocks every slot index', () => {
  withTempDir((dir) => {
    const ticket = path.join(dir, 'ticket-1.json');
    fs.writeFileSync(ticket, 'not json');
    let sleeps = 0;
    const sleep = () => {
      sleeps += 1;
      assert.ok(!fs.existsSync(path.join(dir, 'slot-0.lock')));
      assert.ok(!fs.existsSync(path.join(dir, 'slot-1.lock')));
      fs.unlinkSync(ticket);
    };
    acquireSlot(slotArgs(dir, { slots: 2, sleep }));
    assert.strictEqual(sleeps, 1);
  });
});

test('#4333 a ticket that cannot be parsed and is older than staleUnparseableMs is removed', () => {
  withTempDir((dir) => {
    const ticket = path.join(dir, 'ticket-1.json');
    fs.writeFileSync(ticket, 'not json');
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(ticket, old, old);
    const lock = acquireSlot(slotArgs(dir, { sleep: noSleep }));
    assert.strictEqual(lock, path.join(dir, 'slot-0.lock'));
    assert.ok(!fs.existsSync(ticket));
  });
});

test('#4333 a ticket in the base lane does not block the subset lane, and the subset directory is not a ticket', () => {
  withTempDir((dir) => {
    const { dir: sub } = slotLane(dir, true);
    fs.mkdirSync(sub);
    const ticket = writeTicket(dir, 1, 222);
    const isAlive = (pid) => pid === 222;
    assert.strictEqual(acquireSlot(slotArgs(sub, { sleep: noSleep, isAlive })), path.join(sub, 'slot-0.lock'));
    assert.ok(fs.existsSync(ticket));
    fs.unlinkSync(ticket);
    assert.strictEqual(acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive })), path.join(dir, 'slot-0.lock'));
    assert.ok(fs.statSync(sub).isDirectory());
  });
});

test("releaseSlot leaves another pid's lock alone", () => {
  withTempDir((dir) => {
    const p = writeLock(dir, 0, 444);
    releaseSlot(p, 111);
    assert.ok(fs.existsSync(p));
    releaseSlot(p, 444);
    assert.ok(!fs.existsSync(p));
  });
});

test('releaseSlot never throws on a missing or unparseable lock', () => {
  withTempDir((dir) => {
    assert.doesNotThrow(() => releaseSlot(path.join(dir, 'slot-0.lock'), 111));
    const p = path.join(dir, 'slot-1.lock');
    fs.writeFileSync(p, 'not json');
    assert.doesNotThrow(() => releaseSlot(p, 111));
    assert.ok(fs.existsSync(p));
  });
});

test('createRunRoot makes ct-testrun-<pid>-* under the given tmp dir', () => {
  withTempDir((dir) => {
    const root = createRunRoot(dir, 777);
    assert.strictEqual(path.dirname(root), dir);
    assert.match(path.basename(root), /^ct-testrun-777-/);
    assert.ok(fs.statSync(root).isDirectory());
  });
});

test('sweepStaleRoots removes dead-pid roots and keeps live ones', () => {
  withTempDir((dir) => {
    for (const name of ['ct-testrun-555-aaaaaa', 'ct-testrun-666-bbbbbb', 'other-dir']) {
      fs.mkdirSync(path.join(dir, name));
    }
    fs.writeFileSync(path.join(dir, 'ct-testrun-555-aaaaaa', 'junk'), 'x');
    const removed = sweepStaleRoots({ dir, isAlive: (pid) => pid === 666 });
    assert.deepStrictEqual(removed, [path.join(dir, 'ct-testrun-555-aaaaaa')]);
    assert.ok(!fs.existsSync(path.join(dir, 'ct-testrun-555-aaaaaa')));
    assert.ok(fs.existsSync(path.join(dir, 'ct-testrun-666-bbbbbb')));
    assert.ok(fs.existsSync(path.join(dir, 'other-dir')));
  });
});

test('ensureOwnDir creates a missing directory and refuses a symlink in its place', {
  skip: process.platform === 'win32' && 'win32: creating a symlink needs extra privileges',
}, () => {
  withTempDir((dir) => {
    const fresh = path.join(dir, 'fresh');
    ensureOwnDir(fresh);
    assert.ok(fs.lstatSync(fresh).isDirectory());
    const target = path.join(dir, 'elsewhere');
    fs.mkdirSync(target);
    const link = path.join(dir, 'link');
    fs.symlinkSync(target, link);
    assert.throws(() => ensureOwnDir(link), /not a directory owned by this user/);
  });
});

test('acquireSlot leaves no empty lock behind when writing its identity fails', () => {
  withTempDir((dir) => {
    const origWrite = fs.writeSync;
    fs.writeSync = () => {
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    };
    try {
      assert.throws(
        () => acquireSlot({ dir, slots: 1, pid: 4242, cwd: '/x', isAlive: () => true, now: Date.now, sleep: () => {}, log: () => {} }),
        /no space left/,
      );
    } finally {
      fs.writeSync = origWrite;
    }
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('isPidAlive is true for this process and false for an exited child', () => {
  assert.strictEqual(isPidAlive(process.pid), true);
  // pid 0 / negative would probe a process group, not a process — never "alive".
  for (const bad of [0, -1, 1.5, NaN]) assert.strictEqual(isPidAlive(bad), false, String(bad));
  const child = spawnSync(process.execPath, ['-e', '0']);
  assert.ok(child.pid > 0);
  assert.strictEqual(isPidAlive(child.pid), false);
});

// ---- Process-level tests: tools/run-tests.js as a real child over a throwaway root. ----
// Each gets a fresh sandbox (suite root holding one fixture copied in as `<name>.test.js`, a
// private slot dir, and a private TMPDIR so the runner's startup sweep never scans the real
// tmpdir) that is removed in `finally`. `CT_TEST_SUITE_SLOT_HELD` and `NODE_TEST_CONTEXT` are
// cleared from the child env: the suite this runs inside sets both, and the latter would make the
// child's own `node --test` act as a nested worker and run nothing. `CT_TEST_SUITE_SLOTS` and
// `CT_TEST_SUBSET_SLOTS` (the slot-count knobs) are cleared too: the slot tests assume exactly one
// slot, so an inherited slot count would change what they measure.
async function withSandbox(fixture, testName, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-sandbox-'));
  try {
    const sb = {
      suiteRoot: path.join(tmp, 'suite'),
      slotDir: path.join(tmp, 'slots'),
      childTmp: path.join(tmp, 'tmp'),
      probeOut: path.join(tmp, 'probe-out.json'),
    };
    for (const dir of [sb.suiteRoot, sb.slotDir, sb.childTmp]) fs.mkdirSync(dir);
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'run-tests', fixture), path.join(sb.suiteRoot, testName));
    sb.env = {
      ...process.env,
      CT_PROBE_OUT: sb.probeOut,
      CT_TEST_SUITE_SLOT_DIR: sb.slotDir,
      TMPDIR: sb.childTmp,
      TMP: sb.childTmp,
      TEMP: sb.childTmp,
    };
    delete sb.env.CT_TEST_SUITE_SLOT_HELD;
    delete sb.env.CT_TEST_SUITE_SLOTS;
    delete sb.env.CT_TEST_SUBSET_SLOTS;
    delete sb.env.NODE_TEST_CONTEXT;
    return await fn(sb);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const RUNNER = path.join(ROOT, 'tools', 'run-tests.js');
// Places a copy of the runner at `<root>/tools/run-tests.js` beside the slot-lock module it requires
// (`<root>/plugin/bin/lib/suite-slot.js`), so a copied runner starts the way the real one does.
function copyRunner(root) {
  const lib = path.join(root, 'plugin', 'bin', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'plugin', 'bin', 'lib', 'suite-slot.js'), path.join(lib, 'suite-slot.js'));
  fs.copyFileSync(RUNNER, path.join(root, 'tools', 'run-tests.js'));
}
const PROBE = ['tmpdir-probe.fixture.js', 'probe.test.js'];
const runRunner = (sb, { env = sb.env, timeout = 60000 } = {}) =>
  spawnSync(process.execPath, [RUNNER, sb.suiteRoot], { cwd: ROOT, env, encoding: 'utf8', timeout });
const SLOT_LOCKS = (dir) => fs.readdirSync(dir).filter((n) => /^slot-.*\.lock$/.test(n));

test('run-tests.js runs the suite under a ct-testrun-* TMPDIR it removes on exit', async () => {
  await withSandbox(...PROBE, (sb) => {
    const result = runRunner(sb, { timeout: 120000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const recorded = JSON.parse(fs.readFileSync(sb.probeOut, 'utf8'));
    assert.match(path.basename(recorded.tmpdir), /^ct-testrun-\d+-/);
    // Run roots live under a dedicated parent, so the startup sweep never scans the whole tmpdir.
    assert.strictEqual(
      fs.realpathSync(path.dirname(recorded.tmpdir)),
      fs.realpathSync(path.join(sb.childTmp, 'ct-test-runs')),
    );
    assert.strictEqual(fs.existsSync(recorded.tmpdir), false);
    // #5294: the repoInfo store lives inside the run root, never the real per-user location.
    assert.strictEqual(typeof recorded.repoInfoStore, 'string');
    assert.strictEqual(path.dirname(recorded.repoInfoStore), recorded.tmpdir);
    assert.strictEqual(recorded.held, '1');
    assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);
  });
});

test('run-tests.js holds the suite slot for the runner pid while the suite runs, and frees it after', async () => {
  await withSandbox(...PROBE, (sb) => {
    const result = runRunner(sb, { timeout: 120000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const recorded = JSON.parse(fs.readFileSync(sb.probeOut, 'utf8'));
    assert.strictEqual(recorded.lockPid, result.pid);
    assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);
  });
});

// #5297: the maintenance-off entries must reach the spawned `node --test` tree, appended after the
// caller's own GIT_CONFIG_* entry — the unit tests of gitFixtureConfigEnv cannot see the wiring.
test('run-tests.js gives the suite maintenance-off git config after a caller-exported entry', async () => {
  await withSandbox(...PROBE, (sb) => {
    const env = { ...sb.env };
    for (const k of Object.keys(env)) if (k.startsWith('GIT_CONFIG_')) delete env[k];
    Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true' });
    const result = runRunner(sb, { env, timeout: 120000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(sb.probeOut, 'utf8')).git, {
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'true',
      GIT_CONFIG_KEY_1: 'maintenance.auto',
      GIT_CONFIG_VALUE_1: 'false',
      GIT_CONFIG_KEY_2: 'gc.auto',
      GIT_CONFIG_VALUE_2: '0',
    });
  });
});

test('a failing suite makes run-tests.js exit non-zero, and it still frees its slot and run root', async () => {
  await withSandbox('fail-probe.fixture.js', 'fail.test.js', (sb) => {
    const result = runRunner(sb, { timeout: 120000 });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);
    assert.deepStrictEqual(fs.readdirSync(path.join(sb.childTmp, 'ct-test-runs')), []);
  });
});

test('run-tests.js sweeps a run root left by a dead pid before it runs', async () => {
  await withSandbox(...PROBE, (sb) => {
    const dead = spawnSync(process.execPath, ['-e', '0']);
    const orphan = path.join(sb.childTmp, 'ct-test-runs', `ct-testrun-${dead.pid}-orphan`);
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'leaked'), 'x');
    const result = runRunner(sb, { timeout: 120000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(fs.existsSync(orphan), false);
  });
});

test('a nested run with CT_TEST_SUITE_SLOT_HELD=1 skips the slot', async () => {
  await withSandbox(...PROBE, (sb) => {
    // A live holder (this process) would block a run that tried to take the only slot.
    const lockText = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd: ROOT });
    fs.writeFileSync(path.join(sb.slotDir, 'slot-0.lock'), lockText);
    const env = { ...sb.env, CT_TEST_SUITE_SLOT_HELD: '1' };
    const result = runRunner(sb, { env });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(fs.readFileSync(path.join(sb.slotDir, 'slot-0.lock'), 'utf8'), lockText);
  });
});

test('run-tests.js reclaims a slot held by a dead pid and frees it after the run', async () => {
  await withSandbox(...PROBE, (sb) => {
    const dead = spawnSync(process.execPath, ['-e', '0']);
    fs.writeFileSync(
      path.join(sb.slotDir, 'slot-0.lock'),
      JSON.stringify({ pid: dead.pid, startedAt: new Date().toISOString(), cwd: ROOT }),
    );
    const result = runRunner(sb);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(sb.probeOut, 'utf8')).lockPid, result.pid);
    assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);
  });
});

// `--files-from` resolves its entries against the runner's repo root, so this runs a copy of the
// runner placed at `<tmp root>/tools/run-tests.js` over fixtures copied into `<tmp root>/tests/`,
// from a subdirectory of that root. The unlisted fixture fails: had it run, the exit would be 1.
test('run-tests.js --files-from runs exactly the listed files, resolved against the repo root', async () => {
  await withSandbox(...PROBE, (sb) => {
    const root = path.join(sb.suiteRoot, 'repo root');
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    copyRunner(root);
    const fixtures = path.join(ROOT, 'tests', 'fixtures', 'run-tests');
    fs.copyFileSync(path.join(fixtures, 'tmpdir-probe.fixture.js'), path.join(root, 'tests', 'one.test.js'));
    fs.copyFileSync(path.join(fixtures, 'tmpdir-probe.fixture.js'), path.join(root, 'tests', 'two.test.js'));
    fs.copyFileSync(path.join(fixtures, 'fail-probe.fixture.js'), path.join(root, 'tests', 'unlisted.test.js'));
    const list = path.join(sb.suiteRoot, 'list.txt');
    fs.writeFileSync(list, 'tests/one.test.js\n\ntests/two.test.js\n');
    const runner = path.join(root, 'tools', 'run-tests.js');
    const result = spawnSync(process.execPath, [runner, '--files-from', list], {
      cwd: path.join(root, 'tests'), env: sb.env, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^(?:# |ℹ )tests 2$/m, result.stdout);
    assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);

    const bad = (text, extra = []) => {
      fs.writeFileSync(list, text);
      return spawnSync(process.execPath, [runner, '--files-from', list, ...extra], { cwd: root, env: sb.env, encoding: 'utf8', timeout: 60000 });
    };
    for (const [text, extra, re] of [
      ['\n', [], /no test files/],
      ['tests/missing.test.js\n', [], /tests\/missing\.test\.js/],
      ['tests/one.test.js\n', ['tests'], /--files-from/],
    ]) {
      const r = bad(text, extra);
      assert.strictEqual(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, re);
      assert.doesNotMatch(r.stdout, /tests \d/, 'no test run started');
    }
  });
});

// A bare run selects by impact (#5319). In this layout the verify modules the selector loads are absent,
// so its failure path runs for real: the whole suite runs, with one stderr line saying why.
test('AC3.7: a bare run that cannot select runs the whole suite and prints why', async () => {
  await withSandbox(...PROBE, (sb) => {
    const root = path.join(sb.suiteRoot, 'repo');
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    copyRunner(root);
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'run-tests', 'tmpdir-probe.fixture.js'), path.join(root, 'tests', 'one.test.js'));
    const env = { ...sb.env };
    delete env.CI;
    const result = spawnSync(process.execPath, [path.join(root, 'tools', 'run-tests.js')], {
      cwd: root, env, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(fs.existsSync(sb.probeOut), 'the probe ran');
    const lines = result.stderr.split('\n').filter((l) => l.startsWith('run-tests.js: running the whole suite'));
    assert.strictEqual(lines.length, 1, result.stderr);
    assert.match(lines[0], /^run-tests\.js: running the whole suite — impact selection could not narrow it: /);
    assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);
  });
});

// A live full-suite holder (this process) owns the base lane's only slot: a --files-from subset must
// run anyway from its own subset/ lane, leave the holder's lock untouched and free its own after.
// Were it queued in the base lane it would wait until the spawnSync timeout and fail on status null.
test('a --files-from subset does not wait behind a held full-suite slot', async () => {
  await withSandbox(...PROBE, (sb) => {
    const root = path.join(sb.suiteRoot, 'repo');
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    copyRunner(root);
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'run-tests', 'tmpdir-probe.fixture.js'), path.join(root, 'tests', 'one.test.js'));
    const list = path.join(sb.suiteRoot, 'list.txt');
    fs.writeFileSync(list, 'tests/one.test.js\n');
    const lockText = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd: ROOT });
    fs.writeFileSync(path.join(sb.slotDir, 'slot-0.lock'), lockText);
    const result = spawnSync(process.execPath, [path.join(root, 'tools', 'run-tests.js'), '--files-from', list], {
      cwd: root, env: sb.env, encoding: 'utf8', timeout: 30000,
    });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stderr, /waiting for a test-suite slot/);
    assert.strictEqual(fs.readFileSync(path.join(sb.slotDir, 'slot-0.lock'), 'utf8'), lockText);
    assert.deepStrictEqual(SLOT_LOCKS(path.join(sb.slotDir, 'subset')), []);
  });
});

// The subset leaf sits under the fixed-name slot base, so a pre-created base that fails the ownership
// check must be refused before the leaf is created through it.
test('a --files-from subset refuses a slot base that is a symlink', {
  skip: process.platform === 'win32' && 'win32: creating a symlink needs extra privileges',
}, async () => {
  await withSandbox(...PROBE, (sb) => {
    const root = path.join(sb.suiteRoot, 'repo');
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    copyRunner(root);
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'run-tests', 'tmpdir-probe.fixture.js'), path.join(root, 'tests', 'one.test.js'));
    const list = path.join(sb.suiteRoot, 'list.txt');
    fs.writeFileSync(list, 'tests/one.test.js\n');
    const target = path.join(sb.suiteRoot, 'slot-target');
    fs.mkdirSync(target);
    const link = path.join(sb.suiteRoot, 'slot-link');
    fs.symlinkSync(target, link);
    const result = spawnSync(process.execPath, [path.join(root, 'tools', 'run-tests.js'), '--files-from', list], {
      cwd: root, env: { ...sb.env, CT_TEST_SUITE_SLOT_DIR: link }, encoding: 'utf8', timeout: 30000,
    });
    assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /not a directory owned by this user/);
    assert.doesNotMatch(result.stdout, /tests \d/);
    assert.strictEqual(fs.existsSync(path.join(target, 'subset')), false);
  });
});

// Polls `predicate` until true or `timeoutMs` passes; rejects on timeout so a hang fails the test.
async function until(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('run-tests.js waits for a slot held by a live pid, naming the holder', async () => {
  const lockText = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd: ROOT });
  await withSandbox(...PROBE, async (sb) => {
    fs.writeFileSync(path.join(sb.slotDir, 'slot-0.lock'), lockText);
    const child = spawn(process.execPath, [RUNNER, sb.suiteRoot], { cwd: ROOT, env: sb.env, stdio: ['ignore', 'ignore', 'pipe'] });
    try {
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      await until(() => stderr.includes('waiting for a test-suite slot'), 60000, 'the slot-wait message');
      assert.ok(stderr.includes(`held by pid ${process.pid}`), stderr);
      assert.strictEqual(fs.existsSync(sb.probeOut), false, 'the suite must not run while the slot is held');
      assert.strictEqual(fs.readFileSync(path.join(sb.slotDir, 'slot-0.lock'), 'utf8'), lockText);
    } finally {
      child.kill('SIGKILL');
    }
  });
});

// #4333: real waiter processes against one slot directory. A waiter appends `waiting <name>` from
// acquireSlot's `log` callback (called the first time it has to wait) and `acquired <name>` once
// acquireSlot returns, holds the slot until a `release-<name>` file appears beside the out file,
// then releases it and exits 0. The tests read only that out file, never the slot directory's
// bookkeeping, so the same tests run against a runner that keeps none.
const WAITER = `
const fs = require('fs');
const path = require('path');
const [runner, dir, slots, pollMs, name, outFile] = process.argv.slice(1);
const { acquireSlot, releaseSlot, isPidAlive } = require(runner);
const cell = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(cell, 0, 0, ms);
const lockPath = acquireSlot({
  dir, slots: Number(slots), pid: process.pid, cwd: process.cwd(), isAlive: isPidAlive, now: Date.now,
  sleep, pollMs: Number(pollMs), log: () => fs.appendFileSync(outFile, 'waiting ' + name + '\\n'),
});
fs.appendFileSync(outFile, 'acquired ' + name + '\\n');
const releaseFile = path.join(path.dirname(outFile), 'release-' + name);
while (!fs.existsSync(releaseFile)) sleep(20);
releaseSlot(lockPath, process.pid);
process.exit(0);
`;

async function withWaiters(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-waiters-'));
  const children = [];
  const outFile = path.join(root, 'out.txt');
  const events = () => (fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean) : []);
  const start = (name, slots, pollMs) => {
    // stderr goes to a file so a crashing waiter can be quoted instead of timing out naming nothing.
    const stderrPath = path.join(root, `stderr-${name}.txt`);
    const stderrFd = fs.openSync(stderrPath, 'w');
    let child;
    try {
      child = spawn(
        process.execPath, ['-e', WAITER, RUNNER, path.join(root, 'slots'), String(slots), String(pollMs), name, outFile],
        { stdio: ['ignore', 'ignore', stderrFd] },
      );
    } finally {
      fs.closeSync(stderrFd);
    }
    const waiter = { name, child, exitCode: undefined, stderrPath };
    child.on('exit', (code, signal) => { waiter.exitCode = code === null ? signal : code; });
    children.push(waiter);
    return waiter;
  };
  const release = (name) => fs.writeFileSync(path.join(root, `release-${name}`), '');
  const stderrOf = (waiter) => {
    try {
      return fs.readFileSync(waiter.stderrPath, 'utf8').trim() || '(empty)';
    } catch (_) {
      return '(unreadable)';
    }
  };
  // Like `until`, but fails at once, quoting its stderr, when a watched waiter exits before the
  // predicate holds. Watch only waiters that are not expected to exit in the meantime.
  const waitFor = async (predicate, timeoutMs, what, watched = []) => {
    await until(() => predicate() || watched.some((w) => w.exitCode !== undefined), timeoutMs, what);
    if (predicate()) return;
    const gone = watched.find((w) => w.exitCode !== undefined);
    throw new Error(`waiter ${gone.name} exited (${gone.exitCode}) before ${what}; its stderr: ${stderrOf(gone)}`);
  };
  let failed = false;
  try {
    await fn({ root, events, start, release, waitFor });
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    let waitError = null;
    try {
      for (const { child } of children) child.kill('SIGKILL');
      await until(() => children.every((w) => w.exitCode !== undefined), 10000, 'every waiter to be gone');
    } catch (err) {
      waitError = err; // never replaces the test's own error; rmSync below still runs
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    if (waitError && !failed) throw waitError;
  }
}

test('#4333 AC1.1: N+2 waiters against N slots acquire in arrival order', async () => {
  await withWaiters(async ({ events, start, release, waitFor }) => {
    const waiters = [];
    // A and B take the two free slots. C polls slowly and D fast, so a poll-and-take-first
    // implementation hands the first freed slot to the later arrival D. That discrimination is
    // probabilistic: against the pre-change runner D (20 ms poll) beats C (1000 ms poll) only most of
    // the time (~2% of reverted runs come out green), so one green run of the reverted runner does
    // not show this test fails to discriminate.
    for (const [name, pollMs, reported] of [['A', 20, 'acquired A'], ['B', 20, 'acquired B'], ['C', 1000, 'waiting C'], ['D', 20, 'waiting D']]) {
      const waiter = start(name, 2, pollMs);
      waiters.push(waiter);
      await waitFor(() => events().includes(reported), 60000, reported, [waiter]);
    }
    const [, b, c, d] = waiters;
    release('A');
    await waitFor(() => events().filter((e) => e.startsWith('acquired ')).length >= 3, 60000, 'a third acquisition', [b, c, d]);
    release('B');
    await waitFor(() => events().filter((e) => e.startsWith('acquired ')).length >= 4, 60000, 'a fourth acquisition', [c, d]);
    assert.deepStrictEqual(
      events().filter((e) => e.startsWith('acquired ')).map((e) => e.slice('acquired '.length)),
      ['A', 'B', 'C', 'D'],
      events().join(', '),
    );
    release('C');
    release('D');
    await until(() => waiters.every((w) => w.exitCode !== undefined), 60000, 'every waiter to exit');
    assert.deepStrictEqual(waiters.map((w) => w.exitCode), [0, 0, 0, 0]);
  });
});

test('#4333 AC3.1: a waiter killed in the queue does not block the one behind it', async () => {
  await withWaiters(async ({ root, events, start, release, waitFor }) => {
    const slotDir = path.join(root, 'slots');
    fs.mkdirSync(slotDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(slotDir, 'slot-0.lock'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd: ROOT }),
    );
    const a = start('A', 1, 20);
    await waitFor(() => events().includes('waiting A'), 60000, 'waiting A', [a]);
    const b = start('B', 1, 20);
    await waitFor(() => events().includes('waiting B'), 60000, 'waiting B', [b]);
    a.child.kill('SIGKILL');
    await until(() => a.exitCode !== undefined, 60000, 'A to be killed');
    fs.unlinkSync(path.join(slotDir, 'slot-0.lock'));
    await waitFor(() => events().includes('acquired B'), 60000, 'acquired B', [b]);
    assert.strictEqual(events().includes('acquired A'), false);
    release('B');
    await until(() => b.exitCode !== undefined, 60000, 'B to exit');
    assert.strictEqual(b.exitCode, 0);
  });
});

// The fixture records its own pid once started (written whole, so an empty read means not yet).
function fixturePid(sb) {
  try {
    const n = Number(fs.readFileSync(sb.probeOut, 'utf8'));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

// POSIX only: on win32 `child.kill(signal)` terminates the runner outright, so no handler runs.
const SIGNAL_SKIP = { skip: process.platform === 'win32' && 'win32: signals terminate the process; no handler runs' };

// A signal to the runner pid alone (not its group) must reach the suite and free everything the
// runner holds. The fixture sleeps 60s, so a runner that waited for it could not exit inside the
// 30s `until` bound; the timeout rejecting is the failure signal, not a clock comparison.
for (const [signal, expectedCode] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  test(`a ${signal} to the runner alone is forwarded: it exits ${expectedCode} promptly and frees its run root, slot and test worker`, SIGNAL_SKIP, async () => {
    await withSandbox('sleep-probe.fixture.js', 'sleep.test.js', async (sb) => {
      const child = spawn(process.execPath, [RUNNER, sb.suiteRoot], { cwd: ROOT, env: sb.env, stdio: 'ignore' });
      let workerPid = null;
      try {
        let outcome = null;
        child.on('exit', (code, sig) => { outcome = { code, sig }; });
        await until(() => fixturePid(sb) !== null, 60000, 'the fixture to start');
        workerPid = fixturePid(sb);
        assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), ['slot-0.lock']);
        child.kill(signal);
        await until(() => outcome !== null, 30000, `the runner to exit after ${signal}`);
        assert.strictEqual(outcome.sig, null);
        assert.strictEqual(outcome.code, expectedCode);
        assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);
        const runsDir = path.join(sb.childTmp, 'ct-test-runs');
        assert.deepStrictEqual(fs.readdirSync(runsDir), []);
        await until(() => !isPidAlive(workerPid), 30000, 'the sleeping test worker to be gone');
      } finally {
        child.kill('SIGKILL');
        if (workerPid) {
          try {
            process.kill(workerPid, 'SIGKILL');
          } catch (_) {
            // already gone
          }
        }
      }
    });
  });
}

test('#4134 AC2.1: subsetFallbackReason is null for a subset that fits, and off win32 for any size', () => {
  const args = ['--test', '--test-concurrency=2', 'tests/a.test.js'];
  assert.strictEqual(subsetFallbackReason('C:\\node.exe', args, { platform: 'win32' }), null);
  const huge = ['--test', '--test-concurrency=2', ...Array.from({ length: 2000 }, (_, i) => `tests/${'a'.repeat(30)}${i}.test.js`)];
  assert.strictEqual(subsetFallbackReason('/usr/bin/node', huge, { platform: 'linux' }), null);
});

test('#4134 AC2.1: subsetFallbackReason names the length and the limit once the line reaches 32,767 characters', () => {
  // Each of execPath and the args costs its length + 3 (two quotes and a separator), minus 1 for the
  // missing last separator. With execPath 'C:\\node.exe' (11), '--test' (6), '--test-concurrency=2' (20)
  // and 'x'.repeat(k): (11+3) + (6+3) + (20+3) + (k+3) - 1 = 48 + k. So k = 32718 gives 32766, which
  // fits, and k = 32719 gives 32767, which falls back.
  const execPath = 'C:\\node.exe';
  const lineLength = (k) => [execPath, '--test', '--test-concurrency=2', 'x'.repeat(k)].reduce((n, a) => n + a.length + 3, 0) - 1;
  const fits = 32766 - 48;
  assert.strictEqual(lineLength(fits), 32766);
  assert.strictEqual(lineLength(fits + 1), 32767);
  const argsFor = (k) => ['--test', '--test-concurrency=2', 'x'.repeat(k)];
  assert.strictEqual(subsetFallbackReason(execPath, argsFor(fits), { platform: 'win32' }), null);
  assert.strictEqual(
    subsetFallbackReason(execPath, argsFor(fits + 1), { platform: 'win32' }),
    'a 1-file subset needs a 32767-character command line, over the Windows limit of 32767',
  );
});

// The preload fakes win32 + Node 22 and stubs child_process.spawn to print its argv and exit 0.
// The platform fake does not touch the `path` module or `os.tmpdir()`, which stay real on this host.
test('#4134 AC2.1: a win32 --files-from subset too long for the command line runs the full suite with a named reason', async () => {
  await withSandbox(...PROBE, (sb) => {
    const root = path.join(sb.suiteRoot, 'repo root');
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    copyRunner(root);
    const names = Array.from({ length: 400 }, (_, i) => `tests/${'a'.repeat(90)}${i}.test.js`);
    for (const name of names) fs.writeFileSync(path.join(root, name), '');
    const list = path.join(sb.suiteRoot, 'list.txt');
    fs.writeFileSync(list, names.join('\n') + '\n');
    const preload = path.join(ROOT, 'tests', 'fixtures', 'run-tests', 'win32-node22-spawn-capture-preload.js');
    const result = spawnSync(process.execPath, ['-r', preload, path.join(root, 'tools', 'run-tests.js'), '--files-from', list], {
      cwd: root, env: sb.env, encoding: 'utf8', timeout: 60000,
    });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stderr,
      /--files-from .*: a 400-file subset needs a \d+-character command line, over the Windows limit of 32767 — running the full suite instead\./,
    );
    const line = result.stderr.split('\n').find((l) => l.startsWith('SPAWN-ARGS: '));
    assert.ok(line, result.stderr);
    const spawned = JSON.parse(line.slice('SPAWN-ARGS: '.length));
    assert.deepStrictEqual(spawned.slice(-2), ['tests/**/*.test.js', 'tools/upstream-drift/tests/**/*.test.js']);
    for (const name of names) assert.ok(!spawned.includes(name), `${name} should not be passed`);
    // The stub exits before the runner releases its slot, so the lock marks the lane it waited in:
    // the full-suite lane is the slot dir itself, the subset lane its `subset/` child.
    assert.strictEqual(SLOT_LOCKS(sb.slotDir).length, 1, fs.readdirSync(sb.slotDir).join(', '));
    assert.ok(!fs.existsSync(path.join(sb.slotDir, 'subset')), 'a fallen-back run must not take the subset lane');
  });
});

// #5297: fixture git commits/pushes each started `git maintenance run --auto`; the suite's child
// env now carries config that turns it off, appended after any GIT_CONFIG_* the caller inherited.
test('gitFixtureConfigEnv appends the two entries at index 0 and 1 when none are inherited', () => {
  const input = { PATH: '/x' };
  const copy = { ...input };
  assert.deepStrictEqual(gitFixtureConfigEnv(input), {
    PATH: '/x',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0',
  });
  assert.deepStrictEqual(input, copy, 'the input env must not be mutated');
});

test('gitFixtureConfigEnv appends after an inherited GIT_CONFIG_COUNT without clobbering it', () => {
  const input = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true' };
  const copy = { ...input };
  assert.deepStrictEqual(gitFixtureConfigEnv(input), {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'gc.auto', GIT_CONFIG_VALUE_2: '0',
  });
  assert.deepStrictEqual(input, copy, 'the input env must not be mutated');
});

test('gitFixtureConfigEnv returns an unchanged copy when GIT_CONFIG_COUNT is not a non-negative integer', () => {
  const input = { GIT_CONFIG_COUNT: 'abc', PATH: '/x' };
  const copy = { ...input };
  const out = gitFixtureConfigEnv(input);
  assert.deepStrictEqual(out, { GIT_CONFIG_COUNT: 'abc', PATH: '/x' });
  assert.notStrictEqual(out, input);
  assert.deepStrictEqual(input, copy, 'the input env must not be mutated');
});

test('appendGitConfigEnv appends the given pairs after inherited entries', () => {
  const input = {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false',
  };
  const copy = { ...input };
  assert.deepStrictEqual(appendGitConfigEnv(input, [['branch.main.remote', 'origin']]), {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'branch.main.remote', GIT_CONFIG_VALUE_2: 'origin',
  });
  assert.deepStrictEqual(input, copy, 'the input env must not be mutated');
});

test('gitFixtureConfigEnv: real git reads maintenance.auto=false from the returned env', () => {
  const out = execFileSync('git', ['config', '--get', 'maintenance.auto'], {
    env: gitFixtureConfigEnv(process.env), encoding: 'utf8',
  }).trim();
  assert.strictEqual(out, 'false');
});

// #5547: `node tools/run-tests.js <flags> <files>` is a drop-in for a direct `node --test <flags> <files>`.
// The parser is pure apart from its injected `isFile`, and its OS-dependent path handling takes
// `pathImpl`, so each path case runs under path.posix and again under path.win32 on any host.
const OPERAND_FLAVOURS = [
  ['posix', path.posix, '/repo', '/other/x.test.js'],
  ['win32', path.win32, 'C:\\repo', 'D:\\other\\x.test.js'],
];
const operandOptions = (pathImpl, root, { cwd = root, existing = [] } = {}) => {
  const known = new Set(existing.map((p) => pathImpl.resolve(root, p)));
  return { cwd, repoRoot: root, pathImpl, isFile: (abs) => known.has(abs) };
};

test('NODE_TEST_VALUE_FLAGS is the 18 value-taking node test flags', () => {
  assert.ok(Object.isFrozen(NODE_TEST_VALUE_FLAGS));
  assert.deepStrictEqual([...NODE_TEST_VALUE_FLAGS], [
    '--experimental-test-tag-filter', '--experimental-test-isolation', '--test-concurrency', '--test-coverage-branches',
    '--test-coverage-exclude', '--test-coverage-functions', '--test-coverage-include', '--test-coverage-lines',
    '--test-global-setup', '--test-isolation', '--test-name-pattern', '--test-random-seed', '--test-reporter',
    '--test-reporter-destination', '--test-rerun-failures', '--test-shard', '--test-skip-pattern', '--test-timeout',
  ].sort());
});

test('AC1.1 AC1.2: file operands become a repo-relative subset, relative or absolute, from the root or a subdirectory', () => {
  for (const [label, p, root] of OPERAND_FLAVOURS) {
    const existing = ['tests/a.test.js', 'tests/b.test.js', '..cache/a.test.js'];
    const fromRoot = parseRunnerOperands(['tests/a.test.js', p.join(root, 'tests', 'b.test.js')], operandOptions(p, root, { existing }));
    assert.deepStrictEqual(fromRoot, {
      roots: [], files: [p.join('tests', 'a.test.js'), p.join('tests', 'b.test.js')], filesFrom: null, nodeFlags: [], concurrency: null,
    }, label);
    const fromSub = parseRunnerOperands(['a.test.js'], operandOptions(p, root, { cwd: p.join(root, 'tests'), existing }));
    assert.deepStrictEqual(fromSub.files, [p.join('tests', 'a.test.js')], label);
    const bothSpellings = parseRunnerOperands(['tests/a.test.js', p.join(root, 'tests', 'a.test.js'), 'tests/b.test.js', 'tests/a.test.js'], operandOptions(p, root, { existing }));
    assert.deepStrictEqual(bothSpellings.files, [p.join('tests', 'a.test.js'), p.join('tests', 'b.test.js')], label);
    // A directory whose name merely starts with two dots is inside the checkout, not above it.
    const dotted = parseRunnerOperands(['..cache/a.test.js'], operandOptions(p, root, { existing }));
    assert.deepStrictEqual(dotted.files, [p.join('..cache', 'a.test.js')], label);
  }
});

test('AC1.1: a file operand is compared by canonical path through the injected realpath', () => {
  const p = path.posix;
  const realpath = (abs) => (abs.startsWith('/link/') ? `/repo/${abs.slice('/link/'.length)}` : abs);
  const withReal = { ...operandOptions(p, '/repo', { existing: ['tests/a.test.js'] }), realpath };
  assert.deepStrictEqual(parseRunnerOperands(['/link/tests/a.test.js'], withReal).files, ['tests/a.test.js']);
  assert.deepStrictEqual(parseRunnerOperands(['/link/tests/a.test.js', 'tests/a.test.js'], withReal).files, ['tests/a.test.js']);
  assert.throws(() => parseRunnerOperands(['/link/tests/missing.test.js'], withReal), { message: '/link/tests/missing.test.js does not exist or is not a file' });
  // The default realpath is identity: the symlinked spelling is then outside the checkout.
  assert.throws(
    () => parseRunnerOperands(['/link/tests/a.test.js'], operandOptions(p, '/repo', { existing: ['tests/a.test.js'] })),
    { message: '/link/tests/a.test.js is outside the checkout' },
  );
  // A path inside the checkout whose canonical form leaves it is outside.
  const escape = { ...operandOptions(p, '/repo', { existing: ['/other/x.test.js'] }), realpath: (abs) => (abs === '/repo/tests/ln.test.js' ? '/other/x.test.js' : abs) };
  assert.throws(() => parseRunnerOperands(['tests/ln.test.js'], escape), { message: 'tests/ln.test.js is outside the checkout' });
});

test('canonicalPath: an existing file, a missing file under a symlinked directory, and a path no ancestor of which resolves', () => {
  const realpathSync = (p) => {
    if (p === '/link/tests/a.test.js') return '/repo/tests/a.test.js';
    if (p === '/link/tests') return '/repo/tests';
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  assert.strictEqual(canonicalPath('/link/tests/a.test.js', { realpathSync, pathImpl: path.posix }), '/repo/tests/a.test.js');
  assert.strictEqual(canonicalPath('/link/tests/missing.test.js', { realpathSync, pathImpl: path.posix }), '/repo/tests/missing.test.js');
  assert.strictEqual(canonicalPath('/link/tests/sub/missing.test.js', { realpathSync, pathImpl: path.posix }), '/repo/tests/sub/missing.test.js');
  assert.strictEqual(canonicalPath('/gone/x/y.test.js', { realpathSync, pathImpl: path.posix }), '/gone/x/y.test.js');
  const winReal = (p) => {
    if (p === 'C:\\link\\tests') return 'C:\\repo\\tests';
    throw new Error('ENOENT');
  };
  assert.strictEqual(canonicalPath('C:\\link\\tests\\m.test.js', { realpathSync: winReal, pathImpl: path.win32 }), 'C:\\repo\\tests\\m.test.js');
});

test('AC2.2: a value flag in space form takes the next argument, never as an operand', () => {
  for (const [label, p, root] of OPERAND_FLAVOURS) {
    const out = parseRunnerOperands(['--test-name-pattern', 'x', 'tests/a.test.js'], operandOptions(p, root, { existing: ['tests/a.test.js'] }));
    assert.deepStrictEqual(out.nodeFlags, ['--test-name-pattern=x'], label);
    assert.deepStrictEqual(out.files, [p.join('tests', 'a.test.js')], label);
    assert.deepStrictEqual(out.roots, [], label);
  }
});

test('a value flag with no value after it is refused, naming the flag', () => {
  const [, p, root] = OPERAND_FLAVOURS[0];
  assert.throws(() => parseRunnerOperands(['--test-reporter'], operandOptions(p, root)), { message: '--test-reporter needs a value' });
});

test('passes node test flags through unchanged', () => {
  const flags = ['--test-reporter=tap', '--test-reporter-destination=out/r.tap', '--test-only', '--experimental-test-coverage'];
  for (const [label, p, root] of OPERAND_FLAVOURS) {
    const out = parseRunnerOperands([...flags, 'tests/a.test.js'], operandOptions(p, root, { existing: ['tests/a.test.js'] }));
    assert.deepStrictEqual(out.nodeFlags, flags, label);
  }
});

test('AC5.1: --test-concurrency is taken out of the flags and returned as a number', () => {
  const [, p, root] = OPERAND_FLAVOURS[0];
  const opts = operandOptions(p, root, { existing: ['tests/a.test.js'] });
  const joined = parseRunnerOperands(['--test-concurrency=3', 'tests/a.test.js'], opts);
  assert.strictEqual(joined.concurrency, 3);
  assert.deepStrictEqual(joined.nodeFlags, []);
  const spaced = parseRunnerOperands(['--test-concurrency', '3'], opts);
  assert.strictEqual(spaced.concurrency, 3);
  assert.deepStrictEqual(spaced.nodeFlags, []);
});

test('--test-concurrency refuses a value that is not a positive integer', () => {
  const [, p, root] = OPERAND_FLAVOURS[0];
  for (const rest of [['--test-concurrency=0'], ['--test-concurrency=abc'], ['--test-concurrency=2.5'], ['--test-concurrency', '0']]) {
    assert.throws(() => parseRunnerOperands(rest, operandOptions(p, root)), { message: '--test-concurrency needs a positive integer' }, rest.join(' '));
  }
});

test('AC4.1 AC4.2 AC4.3 AC4.4 AC4.5 AC4.6: refuses a missing file, a file outside the checkout, an existing file that is not a test file, files mixed with a root or with --files-from, and an unknown option', () => {
  for (const [label, p, root, otherDrive] of OPERAND_FLAVOURS) {
    const opts = operandOptions(p, root, {
      existing: ['tests/a.test.js', '../other/x.test.js', 'tests/helpers/util.js'],
    });
    const known = opts.isFile;
    opts.isFile = (abs) => known(abs) || abs === otherDrive;
    const refuse = (rest, message) => assert.throws(() => parseRunnerOperands(rest, opts), { message }, `${label}: ${rest.join(' ')}`);
    refuse(['tests/missing.test.js'], 'tests/missing.test.js does not exist or is not a file');
    // A directory named like a test file is not a regular file: `isFile` says false for it.
    refuse(['tests/dir.test.js'], 'tests/dir.test.js does not exist or is not a file');
    refuse(['../other/x.test.js'], '../other/x.test.js is outside the checkout');
    refuse([otherDrive], `${otherDrive} is outside the checkout`);
    refuse(['tests/helpers/util.js'], 'tests/helpers/util.js is not a *.test.js file');
    refuse(['tests', 'tests/a.test.js'], 'tests/a.test.js cannot be combined with the directory root tests');
    refuse(['--files-from', 'l.txt', 'tests/a.test.js'], 'tests/a.test.js cannot be combined with --files-from');
    refuse(['--watch', 'tests/a.test.js'], 'unknown option --watch');
  }
});

test('the glob check reads the path handed to node --test: a glob directory in cwd is refused, a glob in the checkout path is not', () => {
  for (const [label, p, root] of OPERAND_FLAVOURS) {
    // cwd inside a bracket directory: the repo-relative path `t/[a]/x.test.js` would run `t/a/x.test.js`.
    // The typed operand holds no glob character, so the message names the path it resolves to.
    const bracketCwd = p.join(root, 't', '[a]');
    assert.throws(
      () => parseRunnerOperands(['x.test.js'], operandOptions(p, root, { cwd: bracketCwd, existing: ['t/[a]/x.test.js'] })),
      { message: `x.test.js resolves to ${p.join('t', '[a]', 'x.test.js')}, which holds a glob character (one of [ ] { } ( ) ! + @ * ?), which node --test would expand` },
      label,
    );
    // A symlink target holding one: the same message, naming the canonical path.
    const linked = { ...operandOptions(p, root, { existing: ['t/[a]/x.test.js'] }), realpath: (abs) => (abs === p.join(root, 'tests', 'ln.test.js') ? p.join(root, 't', '[a]', 'x.test.js') : abs) };
    assert.throws(
      () => parseRunnerOperands(['tests/ln.test.js'], linked),
      { message: `tests/ln.test.js resolves to ${p.join('t', '[a]', 'x.test.js')}, which holds a glob character (one of [ ] { } ( ) ! + @ * ?), which node --test would expand` },
      label,
    );
    // A checkout whose own path holds `(`: the repo-relative path `tests/a.test.js` is safe.
    const oddRoot = p.join(p.dirname(root), 'proj (copy)');
    const out = parseRunnerOperands([p.join(oddRoot, 'tests', 'a.test.js')], operandOptions(p, oddRoot, { existing: ['tests/a.test.js'] }));
    assert.deepStrictEqual(out.files, [p.join('tests', 'a.test.js')], label);
  }
});

test('refuses a file operand holding a glob metacharacter', () => {
  for (const [label, p, root] of OPERAND_FLAVOURS) {
    const operands = ['tests/[ab].test.js', ...[...'[]{}()!+@*?'].map((ch) => `tests/a${ch}b.test.js`)];
    const opts = operandOptions(p, root, { existing: operands });
    for (const operand of operands) {
      assert.throws(
        () => parseRunnerOperands([operand], opts),
        { message: `${operand} holds a glob character (one of [ ] { } ( ) ! + @ * ?), which node --test would expand` },
        `${label}: ${operand}`,
      );
    }
  }
});

test('AC6.1: directory roots and --files-from parse as before', () => {
  for (const [label, p, root] of OPERAND_FLAVOURS) {
    const opts = operandOptions(p, root);
    const expect = (rest, parts) => assert.deepStrictEqual(
      parseRunnerOperands(rest, opts),
      { roots: [], files: [], filesFrom: null, nodeFlags: [], concurrency: null, ...parts },
      `${label}: ${rest.join(' ')}`,
    );
    expect([], {});
    expect(['perf'], { roots: ['perf'] });
    expect(['tests', 'tools/upstream-drift/tests'], { roots: ['tests', 'tools/upstream-drift/tests'] });
    expect(['--files-from', 'l.txt'], { filesFrom: 'l.txt' });
    expect(['perf', '--test-reporter=tap'], { roots: ['perf'], nodeFlags: ['--test-reporter=tap'] });
  }
});

test('--files-from keeps its own refusals: no list, or a second list', () => {
  const [, p, root] = OPERAND_FLAVOURS[0];
  const text = '--files-from <list> takes exactly one list file and no root arguments.';
  assert.throws(() => parseRunnerOperands(['--files-from'], operandOptions(p, root)), { message: text });
  assert.throws(() => parseRunnerOperands(['--files-from', 'a.txt', '--files-from', 'b.txt'], operandOptions(p, root)), { message: text });
});

test('AC5.1: buildTestArgs places node flags after --test-concurrency and before the files', () => {
  assert.deepStrictEqual(
    buildTestArgs(['a.test.js'], null, { platform: 'linux', nodeMajor: 20, concurrency: 3, nodeFlags: ['--test-reporter=tap'] }),
    ['--test', '--test-concurrency=3', '--test-reporter=tap', 'a.test.js'],
  );
  assert.deepStrictEqual(
    buildTestArgs(['a.test.js'], null, { platform: 'linux', nodeMajor: 20, concurrency: 3 }),
    ['--test', '--test-concurrency=3', 'a.test.js'],
  );
  assert.deepStrictEqual(
    buildTestArgs(['a.test.js'], ['tests'], { platform: 'win32', nodeMajor: 22, concurrency: 3, nodeFlags: ['--test-only'] }),
    ['--test', '--test-concurrency=3', '--test-only', 'tests/**/*.test.js'],
  );
});

test('AC5.2: resolveConcurrency results are unchanged', () => {
  assert.strictEqual(resolveConcurrency({}, 12), 6);
  assert.strictEqual(resolveConcurrency({ CI: 'true' }, 12), 11);
  assert.strictEqual(resolveConcurrency({ CT_TEST_CONCURRENCY: '3' }, 12), 3);
});

test('subsetFallbackReason counts files, not flags', () => {
  const files = Array.from({ length: 400 }, (_, i) => `tests/${'a'.repeat(90)}${i}.test.js`);
  const plain = subsetFallbackReason('C:\\node.exe', ['--test', '--test-concurrency=2', ...files], { platform: 'win32' });
  assert.match(plain, /^a 400-file subset needs a \d+-character command line, over the Windows limit of 32767$/);
  const flagged = subsetFallbackReason('C:\\node.exe', ['--test', '--test-concurrency=2', '--test-reporter=tap', ...files], { platform: 'win32' });
  assert.match(flagged, /^a 400-file subset needs a \d+-character command line, over the Windows limit of 32767$/);
});

// A copied runner over a checkout-shaped layout: `<sandbox>/repo root/{tools,tests}`, two probe fixtures
// (one.test.js, two.test.js) and a failing one (unlisted.test.js) that would turn any run of it red.
function operandLayout(sb) {
  const root = path.join(sb.suiteRoot, 'repo root');
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'));
  copyRunner(root);
  const fixtures = path.join(ROOT, 'tests', 'fixtures', 'run-tests');
  fs.copyFileSync(path.join(fixtures, 'tmpdir-probe.fixture.js'), path.join(root, 'tests', 'one.test.js'));
  fs.copyFileSync(path.join(fixtures, 'tmpdir-probe.fixture.js'), path.join(root, 'tests', 'two.test.js'));
  fs.copyFileSync(path.join(fixtures, 'fail-probe.fixture.js'), path.join(root, 'tests', 'unlisted.test.js'));
  return { root, runner: path.join(root, 'tools', 'run-tests.js') };
}
const runOperands = (sb, layout, args, { cwd = layout.root, env = sb.env, timeout = 60000 } = {}) =>
  spawnSync(process.execPath, [layout.runner, ...args], { cwd, env, encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
const TESTS_RAN = (n) => new RegExp(`^(?:# |ℹ )tests ${n}$`, 'm');

test('AC1.1 AC1.2 AC1.3 AC3.1: file operands run exactly those files on the subset lane with the runner\'s environment', async () => {
  await withSandbox(...PROBE, (sb) => {
    const layout = operandLayout(sb);
    // A live holder (this process) owns the base lane's only slot: a subset must not queue behind it.
    const lockText = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd: ROOT });
    fs.writeFileSync(path.join(sb.slotDir, 'slot-0.lock'), lockText);
    // The absolute spelling is the sandbox's own: on macOS the tmpdir is a symlinked spelling (/var ->
    // /private/var) of the runner's real checkout root.
    const result = runOperands(sb, layout, ['tests/one.test.js', path.join(layout.root, 'tests', 'two.test.js')], { timeout: 30000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, TESTS_RAN(2), result.stdout);
    const recorded = JSON.parse(fs.readFileSync(sb.probeOut, 'utf8'));
    assert.strictEqual(path.basename(path.dirname(recorded.tmpdir)), 'ct-test-runs');
    assert.strictEqual(recorded.held, '1');
    const pairs = Object.entries(recorded.git).filter(([k]) => k.startsWith('GIT_CONFIG_KEY_')).map(([k, key]) => [key, recorded.git[k.replace('KEY', 'VALUE')]]);
    assert.ok(pairs.some(([key, value]) => key === 'maintenance.auto' && value === 'false'), JSON.stringify(recorded.git));
    assert.ok(pairs.some(([key, value]) => key === 'gc.auto' && value === '0'), JSON.stringify(recorded.git));
    assert.strictEqual(fs.readFileSync(path.join(sb.slotDir, 'slot-0.lock'), 'utf8'), lockText);
    assert.deepStrictEqual(SLOT_LOCKS(path.join(sb.slotDir, 'subset')), []);

    fs.rmSync(sb.probeOut);
    const fromSub = runOperands(sb, layout, ['one.test.js', 'two.test.js'], { cwd: path.join(layout.root, 'tests'), timeout: 30000 });
    assert.strictEqual(fromSub.status, 0, fromSub.stdout + fromSub.stderr);
    assert.match(fromSub.stdout, TESTS_RAN(2), fromSub.stdout);
    assert.ok(fs.existsSync(sb.probeOut), 'the probe ran');

    // The run exits with the child's code: a failing file operand makes the runner exit 1.
    const failing = runOperands(sb, layout, ['tests/unlisted.test.js'], { timeout: 30000 });
    assert.strictEqual(failing.status, 1, failing.stdout + failing.stderr);
    assert.match(failing.stdout, TESTS_RAN(1), failing.stdout);
  });
});

test('a file operand typed through a symlinked spelling of the checkout runs; a symlink inside it that leaves it is refused', {
  skip: process.platform === 'win32' && 'win32: creating a symlink needs extra privileges',
}, async () => {
  await withSandbox(...PROBE, (sb) => {
    const layout = operandLayout(sb);
    const link = path.join(sb.suiteRoot, 'checkout-link');
    fs.symlinkSync(layout.root, link, 'dir');
    const ran = runOperands(sb, layout, [path.join(link, 'tests', 'one.test.js')], { timeout: 30000 });
    assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
    assert.match(ran.stdout, TESTS_RAN(1), ran.stdout);
    const missing = runOperands(sb, layout, [path.join(link, 'tests', 'missing.test.js')], { timeout: 30000 });
    assert.strictEqual(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /missing\.test\.js does not exist or is not a file/, missing.stderr);
    const outside = path.join(sb.suiteRoot, 'outside.test.js');
    fs.writeFileSync(outside, '');
    fs.symlinkSync(outside, path.join(layout.root, 'tests', 'escape.test.js'));
    const escaped = runOperands(sb, layout, ['tests/escape.test.js'], { timeout: 30000 });
    assert.strictEqual(escaped.status, 1, escaped.stdout + escaped.stderr);
    assert.match(escaped.stderr, /tests\/escape\.test\.js is outside the checkout/, escaped.stderr);
  });
});

test('AC2.1: --test-reporter=tap puts node\'s TAP on stdout with no runner line in it', async () => {
  await withSandbox(...PROBE, (sb) => {
    const layout = operandLayout(sb);
    const result = runOperands(sb, layout, ['--test-reporter=tap', 'tests/one.test.js']);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.startsWith('TAP version 13'), result.stdout);
    assert.match(result.stdout, /^# pass 1$/m, result.stdout);
    assert.ok(!result.stdout.split('\n').some((l) => l.startsWith('run-tests.js:')), result.stdout);
  });
});

test('AC4.1 AC4.2 AC4.3 AC4.4 AC4.5 AC4.6: argument errors exit 1 with one run-tests.js line and start no test run', async () => {
  await withSandbox(...PROBE, (sb) => {
    const layout = operandLayout(sb);
    fs.writeFileSync(path.join(layout.root, 'tests', 'helper.js'), '');
    fs.mkdirSync(path.join(layout.root, 'tests', 'dir.test.js'));
    fs.writeFileSync(path.join(sb.suiteRoot, 'outside.test.js'), '');
    const list = path.join(sb.suiteRoot, 'list.txt');
    fs.writeFileSync(list, 'tests/one.test.js\n');
    for (const args of [
      ['tests/missing.test.js'],
      ['../outside.test.js'],
      ['tests/helper.js'],
      ['tests/one.test.js', 'tests'],
      ['tests/one.test.js', '--files-from', list],
      ['tests/one.test.js', '--shard', '1/2'],
      ['tests/one.test.js', '--record-durations', 'out.json'],
      ['tests/one.test.js', '--full'],
      ['--watch', 'tests/one.test.js'],
      ['tests/dir.test.js'],
      // --record-durations adds its own reporter pairs, so a typed reporter flag cannot ride along.
      ['tests', '--record-durations', 'out.json', '--test-reporter=tap'],
      ['tests', '--record-durations', 'out.json', '--test-reporter-destination', 'r.tap'],
    ]) {
      const r = runOperands(sb, layout, args, { timeout: 30000 });
      assert.strictEqual(r.status, 1, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      const lines = r.stderr.split('\n').filter((l) => l !== '');
      assert.strictEqual(lines.length, 1, `${args.join(' ')}: ${r.stderr}`);
      assert.match(lines[0], /^run-tests\.js: /, args.join(' '));
      assert.doesNotMatch(r.stdout, /tests \d/, `${args.join(' ')}: no test run started`);
    }
    assert.ok(!fs.existsSync(sb.probeOut), 'no probe ran');
    for (const [args, line] of [
      [['tests/dir.test.js'], 'run-tests.js: tests/dir.test.js does not exist or is not a file'],
      [['tests', '--record-durations', 'out.json', '--test-reporter=tap'], 'run-tests.js: --test-reporter cannot be combined with --record-durations'],
      [['tests', '--record-durations', 'out.json', '--test-reporter-destination', 'r.tap'], 'run-tests.js: --test-reporter-destination cannot be combined with --record-durations'],
    ]) {
      assert.strictEqual(runOperands(sb, layout, args, { timeout: 30000 }).stderr.trim(), line);
    }
  });
});

test('AC5.1: --test-concurrency=3 reaches the child and wins over CT_TEST_CONCURRENCY', async () => {
  await withSandbox(...PROBE, (sb) => {
    const layout = operandLayout(sb);
    const result = runOperands(sb, layout, ['--test-concurrency=3', 'tests/one.test.js'], { env: { ...sb.env, CT_TEST_CONCURRENCY: '5' } });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const { execArgv } = JSON.parse(fs.readFileSync(sb.probeOut, 'utf8'));
    assert.deepStrictEqual(execArgv.filter((a) => a.startsWith('--test-concurrency')), ['--test-concurrency=3'], JSON.stringify(execArgv));
  });
});

test('AC6.1 AC6.2: a directory root, --files-from, --full and --shard still run as before', async () => {
  await withSandbox(...PROBE, (sb) => {
    const layout = operandLayout(sb);
    const list = path.join(sb.suiteRoot, 'list.txt');
    fs.writeFileSync(list, 'tests/one.test.js\n\ntests/two.test.js\n');
    const root = runOperands(sb, layout, ['tests'], { timeout: 120000 });
    assert.strictEqual(root.status, 1, root.stdout + root.stderr);
    assert.match(root.stdout, TESTS_RAN(3), root.stdout);
    const listed = runOperands(sb, layout, ['--files-from', list], { timeout: 120000 });
    assert.strictEqual(listed.status, 0, listed.stdout + listed.stderr);
    assert.match(listed.stdout, TESTS_RAN(2), listed.stdout);
    // The copied layout has no verify modules, so --full and a one-shard run take the whole-suite path.
    for (const args of [['--full'], ['--shard', '1/1']]) {
      const whole = runOperands(sb, layout, args, { timeout: 120000 });
      assert.strictEqual(whole.status, 1, `${args.join(' ')}: ${whole.stdout}${whole.stderr}`);
      assert.match(whole.stdout, TESTS_RAN(3), `${args.join(' ')}: ${whole.stdout}`);
    }
    assert.deepStrictEqual(SLOT_LOCKS(sb.slotDir), []);
  });
});

// ---- #5768: the runner writes a git template directory whose config turns maintenance off, so every
// repository a test creates carries the settings in its own config (env-carried config does not reach
// receive-pack on a local push, product code that scrubs env config, or a test that overwrites the count).
const gitOut = (args, env) => spawnSync('git', args, { env, encoding: 'utf8', windowsHide: true });
const gitSucceeds = (args, env) => {
  const r = gitOut(args, env);
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
// process.env minus every template / env-config key, so the helper's own settings are the only source.
function envWithoutGitConfig() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'GIT_TEMPLATE_DIR' || k.startsWith('GIT_CONFIG_')) delete env[k];
  return env;
}
function withGitTemp(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-git-template-'));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
// A real empty file, never os.devNull: Git for Windows rejects that as a config path.
function emptyGlobalConfig(tmp) {
  const p = path.join(tmp, 'empty-gitconfig');
  fs.writeFileSync(p, '');
  return p;
}
const cfgOf = (dir, key) => {
  const r = gitOut(['config', '--file', path.join(dir, 'config'), '--get', key], envWithoutGitConfig());
  return r.status === 0 ? r.stdout.trim() : null;
};

test('AC1.1: writeGitTemplateDir writes the maintenance-off keys and keeps git\'s default template files', () => {
  withGitTemp((tmp) => {
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, envWithoutGitConfig()), dir);
    assert.strictEqual(cfgOf(dir, 'maintenance.auto'), 'false');
    assert.strictEqual(cfgOf(dir, 'gc.auto'), '0');
    assert.strictEqual(cfgOf(dir, 'receive.autogc'), 'false');
    assert.strictEqual(cfgOf(dir, 'core.bare'), null);
    assert.ok(fs.statSync(path.join(dir, 'info')).isDirectory());
    assert.ok(fs.statSync(path.join(dir, 'hooks')).isDirectory());
    assert.ok(!fs.existsSync(`${dir}-src`) && !fs.existsSync(`${dir}-empty-gitconfig`), 'scratch paths are removed');
  });
});

test('AC1.1: a repo initialized from the template carries the keys, bare and non-bare', () => {
  withGitTemp((tmp) => {
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, envWithoutGitConfig()), dir);
    const env = { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobalConfig(tmp) };
    for (const [name, flags, bare] of [['plain', [], 'false'], ['bare', ['--bare'], 'true']]) {
      const repo = path.join(tmp, name);
      gitSucceeds(['init', '-q', ...flags, repo], env);
      assert.strictEqual(gitSucceeds(['-C', repo, 'config', '--local', '--get', 'maintenance.auto'], env), 'false', name);
      assert.strictEqual(gitSucceeds(['-C', repo, 'config', '--local', '--get', 'core.bare'], env), bare, name);
    }
  });
});

test('writeGitTemplateDir keeps an inherited GIT_TEMPLATE_DIR\'s files and config ahead of its own keys', () => {
  withGitTemp((tmp) => {
    const inherited = path.join(tmp, 'inherited');
    fs.mkdirSync(path.join(inherited, 'info'), { recursive: true });
    fs.writeFileSync(path.join(inherited, 'config'), '[core]\n\tct-probe = yes');
    fs.writeFileSync(path.join(inherited, 'info', 'marker'), 'm');
    fs.writeFileSync(path.join(inherited, 'stray'), 's'); // an inherited entry outside hooks/info/description
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: inherited }), dir);
    assert.ok(fs.existsSync(path.join(dir, 'info', 'marker')));
    assert.ok(fs.existsSync(path.join(dir, 'stray')));
    assert.strictEqual(cfgOf(dir, 'core.ct-probe'), 'yes');
    assert.strictEqual(cfgOf(dir, 'maintenance.auto'), 'false');
  });
});

test('writeGitTemplateDir ignores an inherited GIT_DIR and object-store variables', () => {
  withGitTemp((tmp) => {
    const other = path.join(tmp, 'other');
    gitSucceeds(['init', '-q', other], { ...envWithoutGitConfig(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobalConfig(tmp) });
    const gitDir = path.join(other, '.git');
    const third = path.join(tmp, 'third');
    fs.mkdirSync(third);
    const listing = () => fs.readdirSync(path.join(gitDir, 'objects'), { recursive: true }).map(String).sort();
    const configBefore = fs.readFileSync(path.join(gitDir, 'config'));
    const listingBefore = listing();
    const env = { ...envWithoutGitConfig(), GIT_DIR: gitDir, GIT_OBJECT_DIRECTORY: path.join(gitDir, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: third };
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, env), dir);
    assert.ok(fs.readFileSync(path.join(gitDir, 'config')).equals(configBefore), 'the other repo\'s config is untouched');
    assert.deepStrictEqual(listing(), listingBefore);
    assert.deepStrictEqual(fs.readdirSync(third), []);
    // With the GIT_* drop reverted, git reinitializes the other repo and dir keeps only `config`.
    assert.ok(fs.existsSync(path.join(dir, 'info', 'exclude')));
    assert.ok(fs.statSync(path.join(dir, 'hooks')).isDirectory());
  });
});

test('writeGitTemplateDir falls back to git\'s default when the inherited GIT_TEMPLATE_DIR is missing or its config is unreadable', () => {
  withGitTemp((tmp) => {
    const missing = path.join(tmp, 'tpl-missing');
    assert.strictEqual(writeGitTemplateDir(missing, { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: path.join(tmp, 'nope') }), missing);
    assert.ok(fs.existsSync(path.join(missing, 'info', 'exclude')));
    assert.strictEqual(cfgOf(missing, 'maintenance.auto'), 'false');

    // `config` as a directory: a read that throws on every platform; the template's files must survive.
    const inherited = path.join(tmp, 'inherited');
    fs.mkdirSync(path.join(inherited, 'config'), { recursive: true });
    fs.mkdirSync(path.join(inherited, 'info'));
    fs.writeFileSync(path.join(inherited, 'info', 'marker'), 'm');
    fs.writeFileSync(path.join(inherited, 'stray'), 's'); // an inherited entry outside hooks/info/description
    const dir = path.join(tmp, 'tpl-unreadable');
    assert.strictEqual(writeGitTemplateDir(dir, { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: inherited }), dir);
    assert.ok(fs.existsSync(path.join(dir, 'info', 'marker')));
    assert.ok(fs.existsSync(path.join(dir, 'stray')), 'every inherited entry is copied, on the init-failure path too');
    assert.ok(fs.statSync(path.join(dir, 'config')).isFile(), 'the unreadable config directory is not copied: config is rebuilt as a file');
    assert.strictEqual(cfgOf(dir, 'maintenance.auto'), 'false');
  });
});

test('writeGitTemplateDir ignores the developer\'s init.templateDir', () => {
  withGitTemp((tmp) => {
    const devTpl = path.join(tmp, 'dev-template');
    fs.mkdirSync(path.join(devTpl, 'info'), { recursive: true });
    fs.writeFileSync(path.join(devTpl, 'info', 'dev-marker'), 'd');
    // Forward slashes: git config values treat a backslash as an escape.
    const devPath = devTpl.split(path.sep).join('/');
    const globalCfg = path.join(tmp, 'dev-gitconfig');
    fs.writeFileSync(globalCfg, `[init]\n\ttemplateDir = ${devPath}\n`);
    const env = {
      ...envWithoutGitConfig(),
      GIT_CONFIG_GLOBAL: globalCfg,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'init.templateDir',
      GIT_CONFIG_VALUE_0: devPath,
    };
    const control = path.join(tmp, 'control');
    gitSucceeds(['init', '-q', control], env);
    assert.ok(fs.existsSync(path.join(control, '.git', 'info', 'dev-marker')), 'the fixture really sets a template');
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, env), dir);
    assert.ok(!fs.existsSync(path.join(dir, 'info', 'dev-marker')));
    assert.ok(fs.existsSync(path.join(dir, 'info', 'exclude')), 'git\'s built-in default template');
  });
});

test('writeGitTemplateDir ignores an init.templateDir set in the developer\'s own ~/.gitconfig', () => {
  withGitTemp((tmp) => {
    const devTpl = path.join(tmp, 'dev-template');
    fs.mkdirSync(path.join(devTpl, 'info'), { recursive: true });
    fs.writeFileSync(path.join(devTpl, 'info', 'dev-marker'), 'd');
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, '.gitconfig'), `[init]\n\ttemplateDir = ${devTpl.split(path.sep).join('/')}\n`);
    // No GIT_CONFIG_GLOBAL / GIT_CONFIG_COUNT: the template reaches git only through the home directory.
    const env = { ...envWithoutGitConfig(), HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') };
    const control = path.join(tmp, 'control');
    gitSucceeds(['init', '-q', control], env);
    assert.ok(fs.existsSync(path.join(control, '.git', 'info', 'dev-marker')), 'the fixture really sets a template through ~/.gitconfig');
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, env), dir);
    assert.ok(!fs.existsSync(path.join(dir, 'info', 'dev-marker')));
    assert.ok(fs.existsSync(path.join(dir, 'info', 'exclude')), 'git\'s built-in default template');
  });
});

test('writeGitTemplateDir does not append its keys twice to a nested runner\'s template config', () => {
  withGitTemp((tmp) => {
    const outer = path.join(tmp, 'outer');
    assert.strictEqual(writeGitTemplateDir(outer, envWithoutGitConfig()), outer);
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: outer }), dir);
    for (const [key, value] of [['maintenance.auto', 'false'], ['gc.auto', '0'], ['receive.autogc', 'false']]) {
      const r = gitOut(['config', '--file', path.join(dir, 'config'), '--get-all', key], envWithoutGitConfig());
      assert.strictEqual(r.stdout.trim(), value, `${key} is set exactly once to ${value}: ${r.stdout}`);
    }
    const repo = path.join(tmp, 'repo');
    const env = { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobalConfig(tmp) };
    gitSucceeds(['init', '-q', repo], env);
    gitSucceeds(['-C', repo, 'config', 'gc.auto', '1'], env);
  });
});

test('AC2.1: writeGitTemplateDir ships empty hooks/ and an info/ dir, and drops an inherited template\'s sample hooks', () => {
  withGitTemp((tmp) => {
    const dir = path.join(tmp, 'tpl');
    assert.strictEqual(writeGitTemplateDir(dir, envWithoutGitConfig()), dir);
    assert.ok(fs.statSync(path.join(dir, 'hooks')).isDirectory());
    const hooks = fs.readdirSync(path.join(dir, 'hooks'));
    assert.deepStrictEqual(hooks.filter((n) => n.endsWith('.sample')), [], `no sample hook: ${hooks.join(', ')}`);
    assert.ok(fs.statSync(path.join(dir, 'info')).isDirectory());
    assert.ok(fs.existsSync(path.join(dir, 'info', 'exclude')));

    const inherited = path.join(tmp, 'inherited');
    fs.mkdirSync(path.join(inherited, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(inherited, 'hooks', 'pre-commit.sample'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(inherited, 'hooks', 'post-checkout'), '#!/bin/sh\n');
    const fromInherited = path.join(tmp, 'tpl-inherited');
    assert.strictEqual(writeGitTemplateDir(fromInherited, { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: inherited }), fromInherited);
    assert.deepStrictEqual(fs.readdirSync(path.join(fromInherited, 'hooks')), ['post-checkout']);
  });
});

test('writeGitTemplateDir ships an empty hooks/ even when the inherited template has none', () => {
  withGitTemp((tmp) => {
    const inherited = path.join(tmp, 'inherited');
    fs.mkdirSync(path.join(inherited, 'info'), { recursive: true });
    const dir = path.join(tmp, 'tpl-inherited');
    assert.strictEqual(writeGitTemplateDir(dir, { ...envWithoutGitConfig(), GIT_TEMPLATE_DIR: inherited }), dir);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'hooks')), []);
    assert.ok(fs.statSync(path.join(dir, 'info')).isDirectory());
  });
});

// Node 20's fs.cpSync hands its filter a namespaced `src` on win32, so a plain dirname compare
// against the inherited template's hooks dir never matched there and its samples were kept.
test('isTemplateSampleHook matches a sample hook given as a namespaced win32 path', () => {
  const hooksDir = 'C:\\ci\\tpl\\hooks';
  const ns = (leaf) => `\\\\?\\C:\\ci\\tpl\\hooks\\${leaf}`;
  assert.strictEqual(isTemplateSampleHook(ns('pre-commit.sample'), hooksDir, path.win32), true);
  assert.strictEqual(isTemplateSampleHook('C:\\ci\\tpl\\hooks\\pre-commit.sample', hooksDir, path.win32), true);
  assert.strictEqual(isTemplateSampleHook(ns('pre-commit.sample'), `\\\\?\\${hooksDir}`, path.win32), true);
  assert.strictEqual(isTemplateSampleHook(ns('post-checkout'), hooksDir, path.win32), false);
  assert.strictEqual(isTemplateSampleHook(`\\\\?\\C:\\ci\\tpl\\hooks\\sub\\x.sample`, hooksDir, path.win32), false);
  assert.strictEqual(isTemplateSampleHook(`\\\\?\\C:\\ci\\tpl\\info\\x.sample`, hooksDir, path.win32), false);
  assert.strictEqual(isTemplateSampleHook('/t/hooks/pre-commit.sample', '/t/hooks', path.posix), true);
  assert.strictEqual(isTemplateSampleHook('/t/hooks/post-checkout', '/t/hooks', path.posix), false);
  assert.strictEqual(isTemplateSampleHook('/t/info/x.sample', '/t/hooks', path.posix), false);
});

test('runnerChildEnv returns the runner\'s child env', () => {
  const env = { PATH: '/bin', TMPDIR: '/old', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c', GIT_TEMPLATE_DIR: '/outer-tpl' };
  const before = { ...env };
  const runRoot = path.join('/runs', 'r1');
  const common = {
    PATH: '/bin',
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c',
    GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'gc.auto', GIT_CONFIG_VALUE_2: '0',
    TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot,
    CT_TEST_SUITE_SLOT_HELD: '1',
    CT_HOOKS_REPO_INFO_STORE: path.join(runRoot, 'repo-info-cache.json'),
    CT_FACTORY_POLICY_FILE: path.join(runRoot, 'factory-policy.absent.yml'),
  };
  assert.deepStrictEqual(runnerChildEnv(env, { runRoot, templateDir: '/tpl' }), { ...common, GIT_TEMPLATE_DIR: '/tpl' });
  // No template: the inherited GIT_TEMPLATE_DIR passes through untouched, as the runner always did.
  assert.deepStrictEqual(runnerChildEnv(env, { runRoot, templateDir: null }), { ...common, GIT_TEMPLATE_DIR: '/outer-tpl' });
  const noTpl = { ...env };
  delete noTpl.GIT_TEMPLATE_DIR;
  const got = runnerChildEnv(noTpl, { runRoot, templateDir: null });
  assert.ok(!('GIT_TEMPLATE_DIR' in got), Object.keys(got).join(', '));
  assert.deepStrictEqual(env, before, 'env is not mutated');
});

test('runnerChildEnv drops CLAUDE_TWEAKS_FACTORY_POLICY', () => {
  const env = { PATH: '/bin', CLAUDE_TWEAKS_FACTORY_POLICY: 'model-stance: economy\n' };
  const got = runnerChildEnv(env, { runRoot: path.join('/runs', 'r1'), templateDir: null });
  assert.ok(!('CLAUDE_TWEAKS_FACTORY_POLICY' in got), Object.keys(got).join(', '));
  assert.equal(got.PATH, '/bin');
  assert.equal(env.CLAUDE_TWEAKS_FACTORY_POLICY, 'model-stance: economy\n', 'env is not mutated');
});

// #6006 final review: the factory file under HOME is the machine's own policy too. The runner relocates it to a
// path inside the run root that never exists (an inherited value is replaced), so readFactoryPolicy reads no file.
test('runnerChildEnv points CT_FACTORY_POLICY_FILE at a missing path in the run root, so the home factory file is never read', () => {
  const { readFactoryPolicy, FACTORY_POLICY_FILE_ENV } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'policy-factory.js'));
  withGitTemp((tmp) => {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude-tweaks', 'factory-policy.yml'), 'model-stance: economy\n');
    const runRoot = path.join(tmp, 'run');
    fs.mkdirSync(runRoot);
    assert.strictEqual(readFactoryPolicy({ env: { HOME: home } }).origin, 'file', 'control: the home file is readable');
    const got = runnerChildEnv({ PATH: '/bin', HOME: home, [FACTORY_POLICY_FILE_ENV]: path.join(tmp, 'elsewhere.yml') }, { runRoot, templateDir: null });
    const file = got[FACTORY_POLICY_FILE_ENV];
    assert.strictEqual(path.dirname(file), runRoot, file);
    assert.strictEqual(fs.existsSync(file), false, file);
    assert.deepStrictEqual(readFactoryPolicy({ env: got }), { raw: null, origin: null, warnings: [] });
  });
});

test('writeGitTemplateDir returns null when git fails', () => {
  withGitTemp((tmp) => {
    const git = () => { throw new Error('git is gone'); };
    assert.strictEqual(writeGitTemplateDir(path.join(tmp, 'tpl'), envWithoutGitConfig(), { git }), null);
    const seen = [];
    assert.strictEqual(writeGitTemplateDir(path.join(tmp, 'tpl2'), envWithoutGitConfig(), { git, onError: (err) => seen.push(err.message) }), null);
    assert.deepStrictEqual(seen, ['git is gone']);
  });
});

test('run-tests.js gives the suite a GIT_TEMPLATE_DIR inside its run root whose config turns maintenance off', async () => {
  await withSandbox(...PROBE, (sb) => {
    const env = { ...sb.env };
    delete env.GIT_TEMPLATE_DIR;
    const result = runRunner(sb, { env, timeout: 120000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const recorded = JSON.parse(fs.readFileSync(sb.probeOut, 'utf8'));
    assert.strictEqual(typeof recorded.gitTemplateDir, 'string');
    assert.strictEqual(path.dirname(recorded.gitTemplateDir), recorded.tmpdir);
    assert.strictEqual(typeof recorded.gitTemplateConfig, 'string');
    assert.ok(recorded.gitTemplateConfig.endsWith(GIT_TEMPLATE_CONFIG), recorded.gitTemplateConfig);
  });
});

// The post-run census: what a suite leaves at the top of its TMPDIR is what a direct `node --test` run would
// leave in the real tmpdir (597,912 entries on one dev machine, 2026-11-18), so the runner names it.
test('leftoverEntries lists the top-level entries a run left, minus the ones the runner itself made', () => {
  const names = [...RUN_ROOT_OWN_ENTRIES, 'zeta-AbCdEf', 'alpha-123456'];
  assert.deepStrictEqual(leftoverEntries('/run/root', { readdirSync: () => names }), ['alpha-123456', 'zeta-AbCdEf']);
  assert.deepStrictEqual(leftoverEntries('/run/root', { readdirSync: () => [...RUN_ROOT_OWN_ENTRIES] }), []);
});

test('leftoverEntries reports nothing for a missing or unreadable run root, never throwing', () => {
  const boom = () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); };
  assert.deepStrictEqual(leftoverEntries('/run/root', { readdirSync: boom }), []);
});

test('summarizeLeftovers groups by the name minus its six random characters, most entries first', () => {
  const names = ['ct-wtd-aaaaaa', 'ct-wtd-bbbbbb', 'ct-wtd-cccccc', 'console-resolve-dddddd', 'console-resolve-eeeeee', 'short', 'ab-xxxxxx'];
  assert.deepStrictEqual(summarizeLeftovers(names), [
    { prefix: 'ct-wtd-', count: 3 },
    { prefix: 'console-resolve-', count: 2 },
    { prefix: 'ab-', count: 1 },
    { prefix: 'short', count: 1 },
  ]);
});

test('leftoverWarning is null for a clean run and otherwise one line with the count and the biggest prefixes', () => {
  assert.strictEqual(leftoverWarning([]), null);
  const line = leftoverWarning(['a-111111', 'a-222222', 'b-333333']);
  assert.ok(!line.includes('\n'));
  assert.match(line, /^run-tests\.js: warning: the run left 3 top-level entries in its TMPDIR/);
  assert.ok(line.endsWith(': a-* x2, b-* x1'), line);
});

test('leftoverWarning caps the prefixes it names and says how many it left out', () => {
  const names = Array.from({ length: 5 }, (_, i) => `p${i}-abcdef`);
  const line = leftoverWarning(names, { limit: 2 });
  assert.ok(line.endsWith('p0-* x1, p1-* x1, and 3 more prefixes'), line);
});

test('run-tests.js warns on stderr, without failing, when a suite leaves entries in its TMPDIR', async () => {
  await withSandbox('leak-probe.fixture.js', 'leak.test.js', (sb) => {
    const result = runRunner(sb, { timeout: 120000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /run-tests\.js: warning: the run left 3 top-level entries in its TMPDIR/);
    assert.match(result.stderr, /leaky-a-\* x2, leaky-b-\* x1/);
    assert.deepStrictEqual(fs.readdirSync(path.join(sb.childTmp, 'ct-test-runs')), [], 'the run root is still removed');
  });
});

test('run-tests.js prints no leftover warning for a suite that leaves nothing', async () => {
  await withSandbox(...PROBE, (sb) => {
    const result = runRunner(sb, { timeout: 120000 });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(!result.stderr.includes('top-level entries in its TMPDIR'), result.stderr);
  });
});
