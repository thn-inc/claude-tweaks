'use strict';
// tests/bin-lib/declined-learning-cli.test.js — #2546: exercises
// bin/declined-learning.js end to end as a real child process, mirroring
// engine-cli.test.js's shape. The store writes to .claude-tweaks/ relative
// to cwd, so each test gets its own sandboxed temp directory.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', '..', 'plugin', 'bin', 'declined-learning.js');

let sandbox;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'declined-learning-cli-'));
});

function run(args, { input } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: sandbox, input: input !== undefined ? input : undefined, encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
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

test('no verb at all exits 2 with usage', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: declined-learning\.js/);
});
