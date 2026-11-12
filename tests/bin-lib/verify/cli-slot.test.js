'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execFile, spawnSync } = require('child_process');
const { slotEnv } = require('../../helpers/suite-slot-env');
const { tmpDir, runCli, tmpGitRepo, nodeCmd, RUN_TESTS, reportAt, withoutWait, waitForText } = require('./cli-helpers');

// ---- #5119: the machine-wide suite slot. Each test below builds its child env with slotEnv(),
// which strips the CT_TEST_SUITE_SLOT_HELD=1 this suite's runner sets and points
// CT_TEST_SUITE_SLOT_DIR at the test's own temp dir. Every cli*.test.js test outside it inherits
// HELD=1, so its runs take no slot, exactly as before. ----

// A check appending `start <id> <ms>`, then `ms` later `end <id> <ms>`, to `out`.
function intervalCmd(out, id, ms = 1500) {
  return nodeCmd("const fs=require('fs'); const [out,id,ms]=process.argv.slice(1); const line=(w)=>fs.appendFileSync(out,w+' '+id+' '+Date.now()+String.fromCharCode(10)); line('start'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(ms)); line('end')", out, id, String(ms));
}
// The `start`/`end` intervals in `out`, asserted complete and pairwise non-overlapping; returns the
// ids in start order.
function assertSerialized(out, count) {
  const by = {};
  for (const l of fs.readFileSync(out, 'utf8').trim().split('\n')) {
    const [what, id, ms] = l.split(' ');
    by[id] = { ...by[id], [what]: Number(ms) };
  }
  const ivs = Object.entries(by).sort((a, b) => a[1].start - b[1].start);
  assert.strictEqual(ivs.length, count, JSON.stringify(by));
  for (const [id, iv] of ivs) assert.ok(Number.isFinite(iv.start) && Number.isFinite(iv.end), `${id}: ${JSON.stringify(by)}`);
  for (let i = 1; i < ivs.length; i++) {
    assert.ok(ivs[i][1].start >= ivs[i - 1][1].end, `${ivs[i][0]} started before ${ivs[i - 1][0]} ended: ${JSON.stringify(by)}`);
  }
  return ivs.map(([id]) => id);
}

test('AC1.1: two concurrent full runs in different worktrees serialize on one lock dir (#5119)', async () => {
  const dir = tmpDir();
  const out = path.join(tmpDir(), 'intervals.txt');
  const repos = [tmpGitRepo(), tmpGitRepo()];
  const runs = await Promise.all(repos.map((r, i) => runCli(['--cmd', `tests=${intervalCmd(out, `run${i}`)}`], { cwd: r.repo, env: slotEnv(dir) })));
  for (const run of runs) assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  assertSerialized(out, 2);
  const slots = repos.map((r) => reportAt(r).slot);
  // No waitedMs lower bound: the holder is the sibling run, so a loaded machine can start the two
  // far enough apart that neither waits. assertSerialized above is the proof.
  for (const slot of slots) assert.deepStrictEqual(withoutWait(slot), { lane: 'full', index: 0, slots: 1, source: 'default' });
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'both slots and both tickets are gone');
});

test('AC2.1: a lock naming a dead pid is reclaimed by the next verify.js run (#5119)', async () => {
  const r = tmpGitRepo();
  const dir = tmpDir();
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  fs.writeFileSync(path.join(dir, 'slot-0.lock'), JSON.stringify({ pid: dead, startedAt: new Date().toISOString(), cwd: '/gone' }));
  const run = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo, env: slotEnv(dir), timeout: 60000 });
  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  assert.strictEqual(reportAt(r).slot.index, 0);
  assert.strictEqual(fs.existsSync(path.join(dir, 'slot-0.lock')), false);
});

test('AC3.1: tools/run-tests.js and verify.js serialize on one lock dir, in both orders (#5119)', async () => {
  const probe = "'use strict';\nconst fs = require('fs');\nrequire('node:test')('interval', () => {\n"
    + "  const line = (w) => fs.appendFileSync(process.env.CT_PROBE_OUT, w + ' rt ' + Date.now() + '\\n');\n"
    + "  line('start');\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);\n  line('end');\n});\n";
  const runTests = (root, env) => new Promise((resolve) => {
    execFile(process.execPath, [RUN_TESTS, root], { cwd: path.join(__dirname, '..', '..', '..'), env, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  for (const first of ['rt', 'v']) {
    const dir = tmpDir();
    const out = path.join(tmpDir(), 'intervals.txt');
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'interval.test.js'), probe);
    // A private TMPDIR, as run-tests-isolation does, so the runner's startup sweep never scans the real one.
    const childTmp = tmpDir();
    const rtEnv = slotEnv(dir, { CT_PROBE_OUT: out, TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp });
    const r = tmpGitRepo();
    const startVerify = () => runCli(['--cmd', `tests=${intervalCmd(out, 'v', 3000)}`], { cwd: r.repo, env: slotEnv(dir) });
    const firstRun = first === 'rt' ? runTests(root, rtEnv) : startVerify();
    await waitForText(out, new RegExp(`^start ${first} `, 'm'));
    const secondRun = first === 'rt' ? startVerify() : runTests(root, rtEnv);
    const [a, b] = await Promise.all([firstRun, secondRun]);
    for (const res of [a, b]) assert.strictEqual(res.code, 0, `${first} first: ${res.stdout}${res.stderr}`);
    assert.deepStrictEqual(assertSerialized(out, 2), first === 'rt' ? ['rt', 'v'] : ['v', 'rt']);
  }
});
