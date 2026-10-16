// tests/bin-lib/declined-learning/store-concurrency.test.js
//
// Review finding (whole-branch review, e90376a4..HEAD): recordDecline/clearDecline did an
// unlocked read-modify-write on the shared store.json — two parallel sessions declining
// different fingerprints near-simultaneously could each read the same pre-write snapshot, and
// the second write would silently drop the first's entry. Mirrors
// tests/hooks-context.test.js's real cross-process concurrency regression test for
// writeRunState's identical shape.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-declined-learning-'));
}

test('recordDecline serializes concurrent writers under an effectively-unbounded lock budget — no lost entries under real cross-process concurrency (finding regression)', async () => {
  const project = tmpProject();
  const storePath = path.join(project, '.claude-tweaks', 'declined-learning', 'store.json');
  const storeModulePath = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'declined-learning', 'store.js');

  const WORKERS = 8;
  const workerScript = (i) => `
    process.chdir(${JSON.stringify(project)});
    const store = require(${JSON.stringify(storeModulePath)});
    store.recordDecline('fp-${i}', { source: 'worker-${i}' });
  `;

  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    procs.push(new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', workerScript(i)], {
        env: { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '60000' },
      });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      // 'close', not 'exit': only 'close' guarantees stdio has flushed, so a failing worker's stderr is complete.
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
      p.on('error', reject);
    }));
  }
  await Promise.all(procs);

  const final = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  for (let i = 0; i < WORKERS; i++) {
    assert.ok(final[`fp-${i}`], `worker ${i}'s decline entry must not be lost to a concurrent writer's stale snapshot`);
    assert.strictEqual(final[`fp-${i}`].source, `worker-${i}`);
  }
});

test('recordDecline under the fail-open path (budget=0) — every worker still exits cleanly and the store never tears', async () => {
  const project = tmpProject();
  const storePath = path.join(project, '.claude-tweaks', 'declined-learning', 'store.json');
  const storeModulePath = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'declined-learning', 'store.js');

  const WORKERS = 8;
  const workerScript = (i) => `
    process.chdir(${JSON.stringify(project)});
    const store = require(${JSON.stringify(storeModulePath)});
    store.recordDecline('fp-${i}', { source: 'worker-${i}' });
  `;

  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    procs.push(new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', workerScript(i)], {
        env: { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' },
      });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      // 'close', not 'exit': only 'close' guarantees stdio has flushed, so a failing worker's stderr is complete.
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
      p.on('error', reject);
    }));
  }
  await Promise.all(procs);

  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(storePath, 'utf8')), 'store.json must always be valid JSON, even under a fully unlocked race');
});
