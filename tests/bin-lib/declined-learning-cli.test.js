'use strict';
// tests/bin-lib/declined-learning-cli.test.js — #2546: exercises
// bin/declined-learning.js end to end, mirroring engine-cli.test.js's shape. The
// store writes under the checkout anchored from the CLI's cwd, so each test gets
// its own git-init'd fixture directory and passes it as the injected cwd (#5385):
// the tests run in-process through run-cli.js, and a fixture-less call would land
// the store in this checkout.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { scratchDir } = require('../helpers/tmp-dir');
const os = require('node:os');
const path = require('node:path');
const { runCliSync, spawnCli } = require('../helpers/run-cli');
const { lookupDecline } = require('../../plugin/bin/lib/declined-learning/store');
const { mainCheckoutRoot } = require('../../plugin/bin/lib/hooks/worktree-detect');

const CLI = path.join(__dirname, '..', '..', 'plugin', 'bin', 'declined-learning.js');
// The complete environment for a call; NODE_OPTIONS and the counter's log path ride along on
// a spawned smoke so tools/count-node-procs.js's preload sees (and logs) the process.
const CLI_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  ...(process.env.USERPROFILE ? { USERPROFILE: process.env.USERPROFILE } : {}),
  ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
  ...(process.env.CT_COUNT_NODE_LOG ? { CT_COUNT_NODE_LOG: process.env.CT_COUNT_NODE_LOG } : {}),
};

let sandbox;

beforeEach(() => {
  sandbox = scratchDir('declined-learning-cli-');
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
  execFileSync('git', ['init', '-q'], { cwd: sandbox, env, windowsHide: true });
});

function run(args, { input = '' } = {}) {
  const r = runCliSync(CLI, args, { cwd: sandbox, env: CLI_ENV, stdin: input });
  return { status: r.code, stdout: r.stdout, stderr: r.stderr };
}

test('lookup with no prior decline prints the computed fingerprint and a null decline', () => {
  const r = run(['lookup', '--source', 'reflect'], { input: JSON.stringify({ description: 'Some insight text' }) });
  assert.strictEqual(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.match(parsed.fingerprint, /^reflect-[0-9a-f]{8}$/);
  assert.strictEqual(parsed.decline, null);
});

test('record-decline writes a decline retrievable by a subsequent lookup against the same fingerprint', () => {
  const description = 'Repeated insight about retry loops';
  const recorded = run(['record-decline', '--source', 'reflect'], {
    input: JSON.stringify({ description, reason: 'one-off, not worth capturing' }),
  });
  assert.strictEqual(recorded.status, 0, recorded.stderr);
  const recordedParsed = JSON.parse(recorded.stdout);
  assert.strictEqual(recordedParsed.entry.reason, 'one-off, not worth capturing');
  assert.strictEqual(recordedParsed.entry.source, 'reflect');
  assert.strictEqual(recordedParsed.entry.subject, description);

  const looked = run(['lookup', '--source', 'reflect'], { input: JSON.stringify({ description }) });
  assert.strictEqual(looked.status, 0, looked.stderr);
  const lookedParsed = JSON.parse(looked.stdout);
  assert.strictEqual(lookedParsed.fingerprint, recordedParsed.fingerprint);
  assert.strictEqual(lookedParsed.decline.reason, 'one-off, not worth capturing');
});

test('two different sources computing the same description text get different fingerprints', () => {
  const description = 'Shared wording across two skills';
  const a = JSON.parse(run(['lookup', '--source', 'reflect'], { input: JSON.stringify({ description }) }).stdout);
  const b = JSON.parse(run(['lookup', '--source', 'feedback'], { input: JSON.stringify({ description }) }).stdout);
  assert.notStrictEqual(a.fingerprint, b.fingerprint);
});

test('lookup without --source exits 2 with usage on stderr', () => {
  const r = run(['lookup'], { input: JSON.stringify({ description: 'x' }) });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: declined-learning\.js/);
});

test('lookup with malformed stdin JSON exits 1, not 2, naming the parse failure', () => {
  const r = run(['lookup', '--source', 'reflect'], { input: 'not json at all' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
});

test('lookup with stdin JSON missing "description" exits 1 with a clear message, never silently printing nothing', () => {
  const r = run(['lookup', '--source', 'reflect'], { input: JSON.stringify({ reason: 'oops, wrong field' }) });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /non-empty "description"/);
  assert.strictEqual(r.stdout, '');
});

test('lookup with an empty-string description exits 1', () => {
  const r = run(['lookup', '--source', 'reflect'], { input: JSON.stringify({ description: '   ' }) });
  assert.strictEqual(r.status, 1);
});

test('record-decline without --source exits 2 with usage on stderr', () => {
  const r = run(['record-decline'], { input: JSON.stringify({ description: 'x' }) });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: declined-learning\.js/);
});

test('record-decline with no "reason" still succeeds, matching recordDecline\'s own optional reason', () => {
  const r = run(['record-decline', '--source', 'feedback'], { input: JSON.stringify({ description: 'No reason given' }) });
  assert.strictEqual(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.entry.reason, null);
});

test('unknown verb exits 2 with usage', () => {
  const r = run(['bogus-verb']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: declined-learning\.js/);
});

test('no verb at all exits 2 with the exact two-line usage and an empty stdout', () => {
  // real process: proves the script entry's no-argument refusal (exit code, empty stdout, usage on stderr)
  const r = spawnCli(CLI, [], { cwd: sandbox, env: CLI_ENV });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.stderr, [
    'usage: declined-learning.js lookup --source <source>   ({"description": "..."} on stdin)',
    '       declined-learning.js record-decline --source <source>   ({"description": "...", "reason": "..."} on stdin)',
    '',
  ].join('\n'));
});

test('AC3.1: an in-process lookup reads stdin and matches the spawned call', () => {
  const payload = '{"description":"same text"}';
  const a = runCliSync(CLI, ['lookup', '--source', 'reflect'], { cwd: sandbox, env: CLI_ENV, stdin: payload });
  // real process: proves the script entry reads real stdin
  const b = spawnCli(CLI, ['lookup', '--source', 'reflect'], { cwd: sandbox, env: CLI_ENV, stdin: payload });
  assert.strictEqual(a.code, 0, a.stderr);
  assert.strictEqual(b.code, 0, b.stderr);
  assert.strictEqual(a.stdout, b.stdout);
  assert.match(b.stdout, /"fingerprint": "reflect-[0-9a-f]{8}"/);
});

test('AC9.1: record-decline writes the store under the injected cwd, not this checkout', () => {
  const description = `ac9-1 ${process.pid} ${Date.now()}`;
  const r = run(['record-decline', '--source', 'reflect'], { input: JSON.stringify({ description, reason: 'r' }) });
  assert.strictEqual(r.status, 0, r.stderr);
  const { fingerprint } = JSON.parse(r.stdout);
  const store = JSON.parse(fs.readFileSync(path.join(sandbox, '.claude-tweaks', 'declined-learning', 'store.json'), 'utf8'));
  assert.strictEqual(store[fingerprint].reason, 'r');
  assert.strictEqual(lookupDecline(fingerprint, { cwd: process.cwd() }), null, "this checkout's store must hold no entry for it");
  assert.ok(!fs.existsSync(path.join(sandbox, '.claude-tweaks', 'declined-learning', '.store.lock')), 'the lock was released');
});

test('record-decline under a non-git injected cwd lands the store there, not under the process cwd', () => {
  const plain = scratchDir('declined-learning-plain-');
  assert.strictEqual(
    mainCheckoutRoot(plain),
    null,
    `the fixture must sit outside any repository, or the run writes that repository's store: ${plain}`,
  );
  const description = `non-git ${process.pid} ${Date.now()}`;
  const r = runCliSync(CLI, ['record-decline', '--source', 'reflect'], {
    cwd: plain, env: CLI_ENV, stdin: JSON.stringify({ description, reason: 'r' }),
  });
  assert.strictEqual(r.code, 0, r.stderr);
  const { fingerprint } = JSON.parse(r.stdout);
  const store = JSON.parse(fs.readFileSync(path.join(plain, '.claude-tweaks', 'declined-learning', 'store.json'), 'utf8'));
  assert.strictEqual(store[fingerprint].reason, 'r');
  assert.strictEqual(lookupDecline(fingerprint, { cwd: process.cwd() }), null, 'the process cwd store must hold no entry for it');
});

// A deleted working directory makes the real cwd() throw. lookup degrades open as it did before
// the entry contract: the store's anchorRoot() catches the throw and the read finds nothing.
test('lookup with an unreadable cwd degrades open: exit 0 and a null decline', () => {
  const description = `deleted-cwd ${process.pid} ${Date.now()}`;
  const input = JSON.stringify({ description });
  const expected = run(['lookup', '--source', 'reflect'], { input });
  const r = runCliSync(CLI, ['lookup', '--source', 'reflect'], {
    env: CLI_ENV,
    stdin: input,
    deps: { cwd: () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); } },
  });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stderr, '');
  assert.strictEqual(r.stdout, expected.stdout);
  assert.strictEqual(JSON.parse(r.stdout).decline, null);
});

test('empty stdin keeps the not-valid-JSON exit 1', () => {
  const r = run(['lookup', '--source', 's'], { input: '' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /stdin is not valid JSON/);
});
