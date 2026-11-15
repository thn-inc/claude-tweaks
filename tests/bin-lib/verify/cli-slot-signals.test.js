'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { slotEnv } = require('../../helpers/suite-slot-env');
const { CLI, tmpDir, tmpGitRepo, nodeCmd, baselineRepo, SUITE, headCommit, pause, waitForText } = require('./cli-helpers');

// ---- #5119: the machine-wide suite slot. Each test below builds its child env with slotEnv(),
// which strips the CT_TEST_SUITE_SLOT_HELD=1 this suite's runner sets and points
// CT_TEST_SUITE_SLOT_DIR at the test's own temp dir. Every cli*.test.js test outside it inherits
// HELD=1, so its runs take no slot, exactly as before. ----

const SLOT_POSIX_ONLY = { skip: process.platform === 'win32' && 'POSIX signal delivery and process-group kill only' };

test('a SIGTERM mid-check kills the check\'s process tree and frees the slot (#5119)', SLOT_POSIX_ONLY, async () => {
  const r = tmpGitRepo();
  const dir = tmpDir();
  const out = path.join(tmpDir(), 'pid.txt');
  const cmd = nodeCmd("require('fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 30000)", out);
  const child = spawn(process.execPath, [CLI, '--cmd', `tests=${cmd}`], { cwd: r.repo, env: slotEnv(dir), stdio: 'ignore' });
  const exited = new Promise((resolve) => { child.on('exit', (c, s) => resolve([c, s])); });
  const fixturePid = Number(await waitForText(out, /^\d+$/));
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  let gone = false;
  for (const deadline = Date.now() + 5000; Date.now() < deadline && !gone;) {
    try { process.kill(fixturePid, 0); await pause(50); } catch (err) { gone = err.code === 'ESRCH'; }
  }
  if (!gone) { try { process.kill(fixturePid, 'SIGKILL'); } catch { /* already gone */ } }
  assert.strictEqual(signal, null, 'verify.js exits through its own handler, never killed outright by the signal');
  assert.strictEqual(code, 143);
  assert.strictEqual(fs.existsSync(path.join(dir, 'slot-0.lock')), false);
  assert.ok(gone, `the check (pid ${fixturePid}) was killed, not orphaned`);
});

// Resolves true once `pid` no longer exists, false if it is still alive after `ms`.
async function waitGone(pid, ms = 10000) {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    try { process.kill(pid, 0); } catch (err) { if (err.code === 'ESRCH') return true; }
    await pause(50);
  }
  return false;
}
// verify.js with one check running `node <script> <args…>`, spawned with a timeout that turns a hang
// into a SIGKILL (and so a failed `signal === null` assertion), never a stuck test.
function spawnVerifyWithScript(r, dir, script, args) {
  const scriptPath = path.join(tmpDir(), 'check.js');
  fs.writeFileSync(scriptPath, script);
  const cmd = [`node "${scriptPath}"`, ...args.map((a) => `"${a}"`)].join(' ');
  const child = spawn(process.execPath, [CLI, '--cmd', `tests=${cmd}`], {
    cwd: r.repo, env: slotEnv(dir), stdio: 'ignore', timeout: 60000, killSignal: 'SIGKILL',
  });
  return { child, exited: new Promise((resolve) => { child.on('exit', (c, s) => resolve([c, s])); }) };
}

test('a SIGTERM mid-check reaches the check first, so its own teardown runs before verify.js frees the slot (#5119)', SLOT_POSIX_ONLY, async () => {
  const r = tmpGitRepo();
  const dir = tmpDir();
  const ready = path.join(tmpDir(), 'ready.txt');
  const marker = path.join(tmpDir(), 'teardown.txt');
  const { child, exited } = spawnVerifyWithScript(r, dir, [
    "const fs = require('fs');",
    'const [ready, marker] = process.argv.slice(2);',
    "process.on('SIGTERM', () => { fs.writeFileSync(marker, 'teardown ran'); process.exit(0); });",
    'fs.writeFileSync(ready, String(process.pid));',
    'setInterval(() => {}, 1000);',
  ].join('\n'), [ready, marker]);
  const checkPid = Number(await waitForText(ready, /^\d+$/));
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  if (!(await waitGone(checkPid, 1000))) { try { process.kill(checkPid, 'SIGKILL'); } catch { /* already gone */ } }
  assert.strictEqual(signal, null, 'verify.js exits through its own handler');
  assert.strictEqual(code, 143);
  assert.ok(fs.existsSync(marker), 'the check got the SIGTERM and ran its own handler before its tree was killed');
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'teardown ran');
  assert.strictEqual(fs.existsSync(path.join(dir, 'slot-0.lock')), false);
});

test('a SIGTERM to a check that ignores it kills the check and its forked grandchild once the grace ends, and frees the slot (#5119)', SLOT_POSIX_ONLY, async () => {
  const r = tmpGitRepo();
  const dir = tmpDir();
  const checkOut = path.join(tmpDir(), 'check.txt');
  const grandOut = path.join(tmpDir(), 'grandchild.txt');
  const { child, exited } = spawnVerifyWithScript(r, dir, [
    "const fs = require('fs');",
    "const { spawn } = require('child_process');",
    'const [checkOut, grandOut] = process.argv.slice(2);',
    "process.on('SIGTERM', () => {});",
    "const grand = \"process.on('SIGTERM', () => {}); require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);\";",
    "spawn(process.execPath, ['-e', grand, grandOut], { stdio: 'ignore', windowsHide: true });",
    'fs.writeFileSync(checkOut, String(process.pid));',
    'setInterval(() => {}, 1000);',
  ].join('\n'), [checkOut, grandOut]);
  const checkPid = Number(await waitForText(checkOut, /^\d+$/));
  const grandPid = Number(await waitForText(grandOut, /^\d+$/));
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  const goneCheck = await waitGone(checkPid);
  const goneGrand = await waitGone(grandPid);
  for (const [pid, gone] of [[checkPid, goneCheck], [grandPid, goneGrand]]) {
    if (!gone) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
  assert.strictEqual(signal, null, 'verify.js exits through its own handler');
  assert.strictEqual(code, 143);
  assert.ok(goneCheck, `the check (pid ${checkPid}) was killed, not orphaned`);
  assert.ok(goneGrand, `the check's grandchild (pid ${grandPid}) was killed with its group, not orphaned`);
  assert.strictEqual(fs.existsSync(path.join(dir, 'slot-0.lock')), false);
});

test('--baseline: a SIGINT while adjudication holds its slot still removes the scratch worktree and exits 130, freeing the slot (#5119)', SLOT_POSIX_ONLY, async () => {
  const r = baselineRepo();
  headCommit(r);
  const dir = tmpDir();
  // A private TMPDIR, as AC5.1 does, so the per-slot scratch parent this adjudication creates never lands in the real temp dir.
  const t = tmpDir();
  // The timeout turns a hang into a SIGKILL (and so a failed `signal === null` assertion), never a stuck test.
  const child = spawn(process.execPath, [CLI, '--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', 'tests=node -e "setTimeout(() => {}, 8000)" {file}'], {
    cwd: r.repo, env: slotEnv(dir, { TMPDIR: t, TMP: t, TEMP: t }), stdio: ['ignore', 'ignore', 'ignore'], timeout: 60000, killSignal: 'SIGKILL',
  });
  const exited = new Promise((resolve) => { child.on('exit', (c, s) => resolve([c, s])); });
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && (r.git('worktree', 'list', '--porcelain').match(/^worktree /gm) || []).length < 2) await pause(50);
    assert.ok(fs.existsSync(path.join(dir, 'slot-0.lock')), 'adjudication holds the full-lane slot');
  } finally {
    // Always, even when the assertion above fails: a running verify.js and its scratch worktree never leak.
    child.kill('SIGINT');
  }
  const [code, signal] = await exited;
  assert.strictEqual(signal, null);
  assert.strictEqual(code, 130, 'adjudication\'s own handler exits, after the slot handler released');
  assert.strictEqual((r.git('worktree', 'list', '--porcelain').match(/^worktree /gm) || []).length, 1, 'no registered scratch worktree afterwards');
  assert.strictEqual(fs.existsSync(path.join(dir, 'slot-0.lock')), false);
});
