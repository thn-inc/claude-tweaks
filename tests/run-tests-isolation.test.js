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
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const {
  resolveConcurrency, resolveSlots, listTestFiles, buildTestArgs,
  isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, createRunRoot, sweepStaleRoots, readFileList, slotLane,
  subsetFallbackReason,
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

function slotArgs(dir, over) {
  return { dir, slots: 1, pid: 111, cwd: '/work/a', isAlive: () => false, now: Date.now, log: () => {}, sleep: () => {}, ...over };
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
// child's own `node --test` act as a nested worker and run nothing.
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
    delete sb.env.NODE_TEST_CONTEXT;
    return await fn(sb);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const RUNNER = path.join(ROOT, 'tools', 'run-tests.js');
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
    fs.copyFileSync(RUNNER, path.join(root, 'tools', 'run-tests.js'));
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

// A live full-suite holder (this process) owns the base lane's only slot: a --files-from subset must
// run anyway from its own subset/ lane, leave the holder's lock untouched and free its own after.
// Were it queued in the base lane it would wait until the spawnSync timeout and fail on status null.
test('a --files-from subset does not wait behind a held full-suite slot', async () => {
  await withSandbox(...PROBE, (sb) => {
    const root = path.join(sb.suiteRoot, 'repo');
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    fs.copyFileSync(RUNNER, path.join(root, 'tools', 'run-tests.js'));
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
    fs.copyFileSync(RUNNER, path.join(root, 'tools', 'run-tests.js'));
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
    fs.copyFileSync(RUNNER, path.join(root, 'tools', 'run-tests.js'));
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
