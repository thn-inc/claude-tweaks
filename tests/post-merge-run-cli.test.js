'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../plugin/bin/post-merge-run');
const { hasPostMergeMarker } = require('../plugin/bin/lib/reconcile/post-merge');
const { closeRunState } = require('../plugin/bin/lib/hooks/close-run-state');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'post-merge-run.js');
const RUN_ID = '2026-10-30T090000-spec-9';
const NOW = Date.now();
const MERGED_AT = new Date(NOW - 60 * 60 * 1000).toISOString();

const created = [];
test.after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });

function git(root, ...args) {
  cp.execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
}

// A temp main checkout: a real git repo with an origin and a github-issues CLAUDE.md.
function mainCheckout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'post-merge-run-')));
  created.push(root);
  git(root, 'init', '-q');
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Work records\n\nwork-backend: github-issues\n');
  return root;
}

// A run dir built with the real writers: run-state.json, closeRunState's own close, then archival's move.
function archivedRun(root, runId = RUN_ID) {
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  const live = path.join(pipelines, runId);
  fs.mkdirSync(live, { recursive: true });
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'post-merge-run-wt-'));
  created.push(worktree);
  fs.writeFileSync(path.join(live, 'run-state.json'), JSON.stringify({ status: 'active', worktree, pr: { number: 11 } }));
  closeRunState(live, { explicit: true, checkLiveWorktree: false });
  const dest = path.join(pipelines, 'archive', runId);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(live, dest);
  return dest;
}

const fakePrStates = (table) => ({ byNumberAsync: async (n) => table[n] });
const mergedState = { number: 11, state: 'MERGED', mergedAt: MERGED_AT };

function fakeClosingLinks(envelope, code = 0) {
  const calls = [];
  const fn = (argv, d) => {
    calls.push({ argv, deps: d });
    if (envelope) d.stdout(`${JSON.stringify(envelope)}\n`);
    return code;
  };
  fn.calls = calls;
  return fn;
}

const NOTHING_CLOSED = {
  action: 'nothing-closed', pr: 11, closingSet: [], reopened: [], pendingClose: [], failed: [],
};

// Runs the CLI in-process against `root`; captures stdout/stderr.
async function runCli(argv, root, overrides = {}) {
  let out = '';
  let err = '';
  const code = await run(argv, {
    cwd: () => root, mainRoot: root, ghAvailable: () => true, now: () => NOW,
    stdout: (s) => { out += s; }, stderr: (s) => { err += s; },
    ...overrides,
  });
  return { code, out, err };
}

test('--help prints usage and exits 0', async () => {
  const r = await runCli(['--help'], os.tmpdir(), { ghAvailable: () => { throw new Error('no probe before --help'); } });
  assert.equal(r.code, 0);
  assert.match(r.out, /usage: post-merge-run\.js --run <run-dir>/);
  assert.match(r.out, /already-done/);
  assert.match(r.out, /in-flight/);
  assert.match(r.out, /step40Failed/);
});

test('no --run exits 2', async () => {
  const r = await runCli([], os.tmpdir());
  assert.equal(r.code, 2);
  assert.match(r.err, /--run <run-dir> is required/);
  assert.equal(r.out, '');
});

test('an unknown flag exits 2', async () => {
  const r = await runCli(['--run', '/x', '--bogus'], os.tmpdir());
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown argument: --bogus/);
});

test('a trailing bare --run exits 2', async () => {
  assert.deepEqual(parseArgs(['--run']), { error: '--run needs a value' });
  const r = await runCli(['--run'], os.tmpdir());
  assert.equal(r.code, 2);
  assert.match(r.err, /--run needs a value/);
});

test('an empty --run value exits 2', async () => {
  const r = await runCli(['--run', ''], os.tmpdir());
  assert.equal(r.code, 2);
  assert.match(r.err, /--run needs a value/);
});

test('a run dir outside the main checkout exits 3', async () => {
  const root = mainCheckout();
  const other = mainCheckout();
  const foreign = path.join(other, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(foreign, { recursive: true });
  const anchored = await runCli(['--run', foreign], root);
  assert.equal(anchored.code, 3);
  assert.match(anchored.err, /not anchored under the main checkout/);
  assert.equal(anchored.out, '');
  const missing = await runCli(['--run', path.join(root, '.claude-tweaks', 'pipelines', 'nope')], root);
  assert.equal(missing.code, 3);
  assert.match(missing.err, /run dir does not exist/);
});

test('AC4.1 AC4.2 AC4.3 AC4.4: an archived run is processed and nothing is minted', async () => {
  const root = mainCheckout();
  const dir = archivedRun(root);
  const links = fakeClosingLinks(NOTHING_CLOSED);
  const r = await runCli(['--run', dir], root, {
    prStates: fakePrStates({ 11: mergedState }),
    postMergeDeps: { gh: () => '', closingLinksRun: links, closeParents: () => ({ closed: [], skipped: [] }) },
  });
  assert.equal(r.code, 0, r.err);
  const entry = JSON.parse(r.out);
  assert.equal(entry.action, 'ran');
  assert.equal(entry.runDir, dir);
  assert.equal(entry.pr, 11);
  assert.equal(links.calls.length, 1);
  assert.equal(links.calls[0].argv[1], dir, "closing-links' --run is the archived dir");
  assert.ok(hasPostMergeMarker(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8')));
  assert.deepEqual(fs.readdirSync(path.join(root, '.claude-tweaks', 'pipelines')), ['archive']);
});

test('a non-clean Step 4.0 prints closingLinks and the record lists', async () => {
  const root = mainCheckout();
  const dir = archivedRun(root);
  const envelope = { ...NOTHING_CLOSED, action: 'reopen-failed', failed: [{ issue: 105, error: 'x' }] };
  const r = await runCli(['--run', dir], root, {
    prStates: fakePrStates({ 11: mergedState }),
    postMergeDeps: { gh: () => '', closingLinksRun: fakeClosingLinks(envelope), closeParents: () => ({ closed: [], skipped: [] }) },
  });
  assert.equal(r.code, 0, r.err);
  const entry = JSON.parse(r.out);
  assert.equal(entry.closingLinks, 'reopen-failed');
  assert.deepEqual(entry.records.failed, [105]);
});

test('gh absent prints a gh-absent skip and makes no lookup', async () => {
  const root = mainCheckout();
  const dir = archivedRun(root);
  const r = await runCli(['--run', dir], root, {
    ghAvailable: () => false,
    prStates: { byNumberAsync: async () => { throw new Error('lookup made with gh absent'); } },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { runDir: dir, pr: null, action: 'skipped', reason: 'gh-absent' });
});

test('a throwing ghAvailable reads as gh absent: a gh-absent skip, exit 0, no lookup', async () => {
  const root = mainCheckout();
  const dir = archivedRun(root);
  const r = await runCli(['--run', dir], root, {
    ghAvailable: () => { throw new Error('probe blew up'); },
    prStates: { byNumberAsync: async () => { throw new Error('lookup made with gh absent'); } },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { runDir: dir, pr: null, action: 'skipped', reason: 'gh-absent' });
});

test('a postMergeOne that throws prints an error entry and exits 0', async () => {
  const root = mainCheckout();
  const dir = archivedRun(root);
  // A getter that throws is read inside postMergeOne's setup, outside its per-run guards.
  const r = await runCli(['--run', dir], root, {
    prStates: fakePrStates({ 11: mergedState }),
    postMergeDeps: { get gh() { throw new Error('seam exploded'); } },
  });
  assert.equal(r.code, 0, r.err);
  const entry = JSON.parse(r.out);
  assert.equal(entry.reason, 'error');
  assert.equal(entry.action, 'skipped');
  assert.equal(entry.pr, null);
  assert.equal(entry.runDir, dir);
  assert.match(entry.detail, /seam exploded/);
});

test('a relative --run resolves to the absolute real path', async () => {
  const root = mainCheckout();
  const dir = archivedRun(root);
  // resolveTarget reads a relative value against the process cwd; stand in the checkout's parent so
  // the same text resolved against the `cwd` seam (the checkout) would name a different, missing dir.
  const before = process.cwd();
  process.chdir(path.dirname(root));
  try {
    const relative = path.relative(process.cwd(), dir);
    assert.ok(!path.isAbsolute(relative), 'the fixture is a relative path');
    const links = fakeClosingLinks(NOTHING_CLOSED);
    const r = await runCli(['--run', relative], root, {
      prStates: fakePrStates({ 11: mergedState }),
      postMergeDeps: { gh: () => '', closingLinksRun: links, closeParents: () => ({ closed: [], skipped: [] }) },
    });
    assert.equal(r.code, 0, r.err);
    const entry = JSON.parse(r.out);
    assert.equal(entry.runDir, dir);
    assert.ok(path.isAbsolute(entry.runDir));
    assert.equal(entry.action, 'ran');
    assert.equal(links.calls[0].argv[1], dir);
  } finally {
    process.chdir(before);
  }
});

test('the CLI exits through process.exitCode', () => {
  const r = cp.spawnSync(process.execPath, [CLI], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: post-merge-run\.js/);
  assert.equal(r.stdout, '');
});
