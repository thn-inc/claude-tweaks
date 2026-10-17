'use strict';

// Characterization tests for the three readers routed through path-guard
// (#3417). The migrations change no behavior except one named difference
// (installed-plugins.js, below), so every test here passes against the
// pre-migration code AND the migrated code; the one intended difference is
// the only test that is red before migration.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { locateTranscripts, readDispatches } = require('../../../plugin/bin/lib/timing/transcript');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-callers-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const fresh = () => {
  const d = path.join(scratch, `t${n += 1}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---- transcript.js ----------------------------------------------------------

test('transcript: locateTranscripts resolves with the JS realpathSync, never .native', () => {
  const home = fresh();
  const slugDir = path.join(home, '.claude', 'projects', '-x');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 's1.jsonl'), '{}\n');
  const realpathSync = (p) => fs.realpathSync(p);
  realpathSync.native = () => { throw new Error('native realpath must not be used here'); };
  const out = locateTranscripts({ cwd: '/x', sessionId: 's1', homeDir: home, fsImpl: { ...fs, realpathSync } });
  assert.equal(out.length, 1);
  assert.equal(out[0].path, fs.realpathSync(path.join(slugDir, 's1.jsonl')));
});

test('transcript: locateTranscripts returns [] when the projects root cannot be resolved', () => {
  assert.deepEqual(locateTranscripts({ cwd: '/x', sessionId: 's1', homeDir: fresh() }), []);
});

test('transcript: locateTranscripts skips dangling and looping symlink leaves, and a directory named like a transcript', () => {
  const home = fresh();
  const slugDir = path.join(home, '.claude', 'projects', '-x');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'real.jsonl'), '{}\n');
  fs.symlinkSync(path.join(slugDir, 'nowhere'), path.join(slugDir, 'dangling.jsonl'));
  fs.symlinkSync(path.join(slugDir, 'loop-b.jsonl'), path.join(slugDir, 'loop-a.jsonl'));
  fs.symlinkSync(path.join(slugDir, 'loop-a.jsonl'), path.join(slugDir, 'loop-b.jsonl'));
  fs.mkdirSync(path.join(slugDir, 'dir.jsonl'));
  const out = locateTranscripts({ cwd: '/x', homeDir: home });
  assert.deepEqual(out.map((r) => path.basename(r.path)), ['real.jsonl']);
});

test('transcript: locateTranscripts refuses a symlink leaf that resolves outside the projects root', () => {
  const home = fresh();
  const slugDir = path.join(home, '.claude', 'projects', '-x');
  fs.mkdirSync(slugDir, { recursive: true });
  const outside = path.join(fresh(), 'secret.jsonl');
  fs.writeFileSync(outside, '{}\n');
  fs.symlinkSync(outside, path.join(slugDir, 'leak.jsonl'));
  assert.deepEqual(locateTranscripts({ cwd: '/x', sessionId: 'leak', homeDir: home }), []);
});

test('transcript: readDispatches falls through to readdir when the subagents dir lstat fails with a non-ENOENT code', async () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ description: 'Implement Task 1' }));
  const fsImpl = { ...fs, lstatSync: (p, ...a) => { if (p === dir) throw Object.assign(new Error('io'), { code: 'EIO' }); return fs.lstatSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].agentId, 'a1');
  assert.equal(r.items[0].description, 'Implement Task 1');
});

test('transcript: readDispatches names an entry that vanishes between readdir and lstat with its ENOENT code', async () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'agent-v1.meta.json'), JSON.stringify({ description: 'Implement Task 2' }));
  fs.writeFileSync(path.join(dir, 'agent-v1.jsonl'), '{}\n');
  const fsImpl = { ...fs, lstatSync: (p, ...a) => { if (p.endsWith('agent-v1.jsonl')) throw Object.assign(new Error('gone'), { code: 'ENOENT' }); return fs.lstatSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items[0].notFound, 'transcript not readable (ENOENT)');
  assert.equal(r.items[0].description, 'Implement Task 2');
});

test('transcript: readDispatches reads a directory-typed agent entry as before (not skipped; the read itself reports EISDIR)', async () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, 'agent-d1.jsonl'));
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].notFound, 'meta not found; transcript not readable (EISDIR)');
});
