'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resolveTarget, sanitizeId, writeStagedItem, writeStagedSidecar } = require('../../../plugin/bin/lib/stage-item/write');

test('sanitizeId: accepts kind-n shapes and safe stems, rejects path traversal and separators', () => {
  assert.equal(sanitizeId('review-2'), 'review-2');
  assert.equal(sanitizeId('leftover-my-slug'), 'leftover-my-slug');
  assert.equal(sanitizeId('polish-suggestion-3'), 'polish-suggestion-3');
  assert.equal(sanitizeId('../../etc/passwd'), null);
  assert.equal(sanitizeId('a/b'), null);
  assert.equal(sanitizeId(''), null);
  assert.equal(sanitizeId(null), null);
  assert.equal(sanitizeId('.hidden'), null);
});

test('resolveTarget: run dir under mainRoot ok; linked-worktree shadow not-anchored; missing dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-'));
  const main = path.join(root, 'main');
  const wt = path.join(main, '.claude', 'worktrees', 'wt');
  const good = path.join(main, '.claude-tweaks', 'pipelines', 'run-a');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(good, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  assert.equal(resolveTarget({ runDir: good, mainRoot: main }).ok, true);
  const bad = resolveTarget({ runDir: shadow, mainRoot: main });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not-anchored');
  assert.deepEqual(resolveTarget({ runDir: path.join(main, 'nope'), mainRoot: main }), { ok: false, reason: 'missing' });
});

test('writeStagedItem: creates staged/ and writes <id><ext> from the source extension', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-run-'));
  const r = writeStagedItem({ runDir, id: 'review-2', sourcePath: '/tmp/whatever.patch', content: 'diff --git a b\n' });
  assert.equal(r.file, path.join(runDir, 'staged', 'review-2.patch'));
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'diff --git a b\n');
});

test('writeStagedSidecar: creates staged/ and writes <id>.json regardless of the sibling item extension', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-sidecar-'));
  const r = writeStagedSidecar({ runDir, id: 'tidy-claim-releases-1', content: '[{"tag":"claim"}]' });
  assert.equal(r.file, path.join(runDir, 'staged', 'tidy-claim-releases-1.json'));
  assert.equal(fs.readFileSync(r.file, 'utf8'), '[{"tag":"claim"}]');
});

test('writeStagedItem: no extension on source writes id with no extension; overwrite replaces content', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-run2-'));
  writeStagedItem({ runDir, id: 'leftover-my-slug', sourcePath: '/tmp/body', content: 'first\n' });
  const r = writeStagedItem({ runDir, id: 'leftover-my-slug', sourcePath: '/tmp/body', content: 'second\n' });
  assert.equal(r.file, path.join(runDir, 'staged', 'leftover-my-slug'));
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'second\n');
});

// #2770: the filename counter that picks `n` in `{kind}-{n}` used to live in
// each caller's own per-invocation state, not in the run directory's actual
// contents, so two writers independently computing the same `{kind}-{n}`
// silently clobbered one another. `allocate: true` opts a numbered-kind id
// into collision-safe reallocation instead of overwriting. It is opt-in
// (not inferred from the id's shape) because a numbered-looking id can also
// be a stable identity key rather than a counter — materialize.js's
// `premise-satisfied-{issueNumber}` ends in digits too, and re-staging the
// same issue there is an intentional idempotent update, not a collision; the
// next test pins that this default (non-allocate) behavior is unchanged.

test('writeStagedItem: without allocate, a numbered-looking id still overwrites in place (materialize.js-style identity key)', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-noalloc-'));
  writeStagedItem({
    runDir, id: 'premise-satisfied-2770', sourcePath: '/tmp/a.md', content: 'first check\n',
  });
  const r = writeStagedItem({
    runDir, id: 'premise-satisfied-2770', sourcePath: '/tmp/a.md', content: 'second check\n',
  });
  assert.equal(r.file, path.join(runDir, 'staged', 'premise-satisfied-2770.md'));
  assert.equal(r.renamed, undefined);
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'second check\n');
});

test('writeStagedItem: allocate:true on a numbered-kind id collision reallocates to the next free slot — neither write is lost', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-realloc-'));
  const first = writeStagedItem({
    runDir, id: 'build-deviation-1', sourcePath: '/tmp/a.md', content: 'first\n', allocate: true,
  });
  const second = writeStagedItem({
    runDir, id: 'build-deviation-1', sourcePath: '/tmp/b.md', content: 'second\n', allocate: true,
  });
  assert.equal(first.file, path.join(runDir, 'staged', 'build-deviation-1.md'));
  assert.equal(second.file, path.join(runDir, 'staged', 'build-deviation-2.md'));
  assert.equal(second.renamed, true);
  assert.equal(second.requestedId, 'build-deviation-1');
  assert.equal(second.id, 'build-deviation-2');
  assert.equal(fs.readFileSync(first.file, 'utf8'), 'first\n');
  assert.equal(fs.readFileSync(second.file, 'utf8'), 'second\n');
});

test('writeStagedItem: allocate:true reallocation skips an id a sibling writer already claimed, not just requested-n+1', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-realloc2-'));
  writeStagedItem({
    runDir, id: 'build-deviation-1', sourcePath: '/tmp/a.md', content: 'one\n', allocate: true,
  });
  // A sibling writer independently claimed -2 directly (not via collision from -1).
  writeStagedItem({
    runDir, id: 'build-deviation-2', sourcePath: '/tmp/b.md', content: 'two\n', allocate: true,
  });
  const third = writeStagedItem({
    runDir, id: 'build-deviation-1', sourcePath: '/tmp/c.md', content: 'three\n', allocate: true,
  });
  assert.equal(third.id, 'build-deviation-3');
  assert.equal(fs.readFileSync(path.join(runDir, 'staged', 'build-deviation-1.md'), 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(path.join(runDir, 'staged', 'build-deviation-2.md'), 'utf8'), 'two\n');
  assert.equal(fs.readFileSync(path.join(runDir, 'staged', 'build-deviation-3.md'), 'utf8'), 'three\n');
});

test('writeStagedItem: allocate:true requires a "{kind}-{n}" id — throws on a bare/slug id', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-realloc-badid-'));
  assert.throws(
    () => writeStagedItem({
      runDir, id: 'leftover-my-slug', sourcePath: '/tmp/a.md', content: 'x\n', allocate: true,
    }),
    /allocate:true requires a "\{kind\}-\{n\}" id/,
  );
});

test('writeStagedItem: allocate:true reallocation also protects the sidecar pairing via the returned id', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-realloc-sidecar-'));
  writeStagedItem({
    runDir, id: 'tidy-claim-releases-1', sourcePath: '/tmp/a.json', content: '{"a":1}', allocate: true,
  });
  const second = writeStagedItem({
    runDir, id: 'tidy-claim-releases-1', sourcePath: '/tmp/b.json', content: '{"b":2}', allocate: true,
  });
  assert.equal(second.id, 'tidy-claim-releases-2');
  const sidecar = writeStagedSidecar({ runDir, id: second.id, content: '[{"tag":"claim"}]' });
  assert.equal(sidecar.file, path.join(runDir, 'staged', 'tidy-claim-releases-2.json'));
});

test('writeStagedItem: two real OS processes racing the same allocate:true numbered-kind id both survive (no lost update)', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-realloc-mp-'));
  const writeModule = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'stage-item', 'write.js');

  const WORKERS = 6;
  const workerScript = (i) => `
    const { writeStagedItem } = require(${JSON.stringify(writeModule)});
    const r = writeStagedItem({
      runDir: ${JSON.stringify(runDir)},
      id: 'race-deviation-1',
      sourcePath: '/tmp/w${i}.md',
      content: 'worker-${i}\\n',
      allocate: true,
    });
    process.stdout.write(r.file + '\\n');
  `;

  const results = await Promise.all(Array.from({ length: WORKERS }, (_, i) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', workerScript(i)]);
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('exit', (code) => (code === 0 ? resolve(stdout.trim()) : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
    p.on('error', reject);
  })));

  const files = results.filter(Boolean);
  assert.equal(new Set(files).size, WORKERS, 'every worker must land on a distinct file');
  const contents = files.map((f) => fs.readFileSync(f, 'utf8'));
  assert.equal(new Set(contents).size, WORKERS, 'every worker\'s content must survive — none clobbered');
});

// With `mainRoot: null` passed *explicitly* (not `undefined`), `resolveTarget`'s
// `if (mainRoot)` guard is falsy, so the `rootReal !== gitRoot` domain comparison
// never runs — the `.git`-is-a-FILE check on its own is the only thing standing
// between a linked-worktree (or submodule) run dir and a false `ok: true`.
test('resolveTarget: with mainRoot explicitly null, the .git-is-a-FILE check alone gates a linked worktree', () => {
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nullroot-wt-'));
  const wt = path.join(wtRoot, '.claude', 'worktrees', 'wt');
  const wtRun = path.join(wt, '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(wtRun, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  assert.deepEqual(resolveTarget({ runDir: wtRun, mainRoot: null }), { ok: false, reason: 'not-anchored' });

  const mainTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nullroot-main-'));
  const main = path.join(mainTmp, 'main');
  const mainRun = path.join(main, '.claude-tweaks', 'pipelines', 'run-b');
  fs.mkdirSync(mainRun, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  assert.equal(resolveTarget({ runDir: mainRun, mainRoot: null }).ok, true);

  const orphanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nullroot-orphan-'));
  const orphanRun = path.join(orphanRoot, 'run-c');
  fs.mkdirSync(orphanRun, { recursive: true });
  assert.deepEqual(resolveTarget({ runDir: orphanRun, mainRoot: null }), { ok: false, reason: 'not-anchored' });
});
