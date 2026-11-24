// tests/bin-lib/hooks/sweep-shadow-claim-concurrency.test.js
//
// Review finding (whole-branch review, e90376a4..HEAD): sweep-shadow.js's dup-slot allocation
// used to pick a free `.shadow-dup[-N]` path via fs.existsSync, then rename separately — a
// classic check-then-act race. Two overlapping sweepShadow invocations could both see the same
// slot free and both rename into it, the second silently overwriting the first's relocated file.
// The fix (claimFreeDest) claims a candidate atomically via fs.linkSync (EEXIST-safe, unlike
// fs.renameSync which clobbers). Real cross-process concurrency, mirroring
// tests/hooks-context.test.js's writeRunState regression test for the identical race shape.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { claimFreeDest } = require('../../../plugin/bin/lib/hooks/sweep-shadow');

function tmpDir() {
  return scratchDir('ct-sweep-shadow-claim-');
}

test('claimFreeDest: single caller claims the preferred path', () => {
  const dir = tmpDir();
  const src = path.join(dir, 'src.md');
  fs.writeFileSync(src, 'x');
  const dest = path.join(dir, 'dest.md');
  const claimed = claimFreeDest(src, dest);
  assert.equal(claimed, dest);
  assert.ok(fs.existsSync(dest));
  assert.ok(!fs.existsSync(src), 'src consumed by the move');
});

test('claimFreeDest: preferred path taken -> falls back to .shadow-dup, then .shadow-dup-1, ...', () => {
  const dir = tmpDir();
  const dest = path.join(dir, 'dest.md');
  fs.writeFileSync(dest, 'already here');
  fs.writeFileSync(`${dest}.shadow-dup`, 'already here too');

  const src = path.join(dir, 'src.md');
  fs.writeFileSync(src, 'x');
  const claimed = claimFreeDest(src, dest);
  assert.equal(claimed, `${dest}.shadow-dup-1`);
  assert.ok(fs.existsSync(claimed));
});

test('claimFreeDest: N real OS processes racing the same preferred path each claim a distinct slot — nothing overwritten (finding regression)', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, 'dest.md');
  const N = 8;
  const claimModule = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'hooks', 'sweep-shadow.js');

  const procs = [];
  for (let i = 0; i < N; i++) {
    const src = path.join(dir, `src-${i}.md`);
    fs.writeFileSync(src, `payload-${i}`);
    const workerScript = `
      const { claimFreeDest } = require(${JSON.stringify(claimModule)});
      const claimed = claimFreeDest(${JSON.stringify(src)}, ${JSON.stringify(dest)});
      process.stdout.write(claimed);
    `;
    procs.push(new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', workerScript]);
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      // 'exit' can fire before the child's stdio streams have finished delivering
      // buffered data to this process (Node docs: only 'close' guarantees that) —
      // under CI I/O contention this raced 'claimed' being read back truncated,
      // failing the existsSync assertion below on a path that never actually existed.
      p.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
      p.on('error', reject);
    }));
  }
  const claimedPaths = await Promise.all(procs);

  assert.equal(new Set(claimedPaths).size, N, 'every worker claimed a distinct path — no two collided on the same slot');
  for (let i = 0; i < N; i++) {
    assert.ok(fs.existsSync(claimedPaths[i]), `worker ${i}'s claimed path must exist on disk`);
    assert.equal(fs.readFileSync(claimedPaths[i], 'utf8'), `payload-${i}`, `worker ${i}'s payload must not have been overwritten by another worker`);
  }
});
