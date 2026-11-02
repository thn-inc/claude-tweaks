'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { run, parseArgs } = require('../../../plugin/bin/qa-scrub');

const BIN = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'qa-scrub.js');
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'qa-scrub');
const TOKEN = 'FAKE-QA-TOKEN-0000-not-a-real-secret';
const T0 = 1761818400;

const created = [];
test.after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }); });

function put(file, content, mtime) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

function tree(secrets) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scrub-cli-'));
  created.push(root);
  const shots = path.join(root, 'shots');
  const traces = path.join(root, 'traces');
  const cli = path.join(root, '.playwright-cli');
  put(path.join(shots, '00_open.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), T0 + 1);
  put(path.join(cli, 'page-a.yml'), fs.readFileSync(path.join(FIX, 'page-reveal.yml')), T0 + 2);
  put(path.join(shots, '01_reveal.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), T0 + 3);
  put(path.join(traces, 'x.trace'), fs.readFileSync(path.join(FIX, 'trace-reveal.trace')), T0 + 4);
  const secretsFile = path.join(root, 'secrets.json');
  fs.writeFileSync(secretsFile, typeof secrets === 'string' ? secrets : JSON.stringify(secrets));
  const args = ['--secrets', secretsFile, '--screenshots', shots, '--traces', traces,
    '--cli-dir', cli, '--since', new Date((T0 - 1) * 1000).toISOString()];
  return { root, shots, traces, cli, secretsFile, args };
}

const spawn = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const PATTERN = [{ pattern: 'FAKE-QA-TOKEN-\\d{4}-[a-z-]+' }];

test('exit 0 prints the outcome line JSON', () => {
  const t = tree(PATTERN);
  const r = spawn(t.args);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.line, '1 secret value(s) scrubbed from 2 artifact(s); 1 screenshot(s) removed');
  assert.equal(fs.existsSync(path.join(t.shots, '00_open.png')), true);
  assert.equal(fs.existsSync(path.join(t.shots, '01_reveal.png')), false);
});

test('exit 3 when a path remains', () => {
  const t = tree(PATTERN);
  const broken = path.join(t.traces, 'broken.trace');
  fs.symlinkSync(path.join(t.root, 'missing'), broken);
  const r = spawn(t.args);
  assert.equal(r.status, 3);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.remaining.includes(broken));
});

test('exit 1 on an invalid secrets payload, error code only', () => {
  const t = tree([{ pattern: '.*' }]);
  const r = spawn(t.args);
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout), { ok: false, error: 'pattern-matches-empty: entry 0' });
  assert.ok(fs.readFileSync(path.join(t.traces, 'x.trace'), 'utf8').includes(TOKEN), 'nothing is scrubbed on a refused payload');
});

test('exit 1 on an unreadable or unparseable secrets file', () => {
  const t = tree('not json');
  let r = spawn(t.args);
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout), { ok: false, error: 'secrets-unparseable' });
  fs.rmSync(t.secretsFile);
  r = spawn(t.args);
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /^secrets-unreadable \(ENOENT\)$/);
});

test('exit 1 when the scrub itself throws', () => {
  const t = tree(PATTERN);
  const out = []; const err = [];
  const code = run(t.args, {
    scrub: () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); },
    stdout: (s) => out.push(s), stderr: (s) => err.push(s),
  });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(out.join('')), { ok: false, error: 'scrub-crashed (EIO)' });
});

test('exit 2 on --cli-dir without --since, trailing bare flag, unknown flag, bad --since', () => {
  const t = tree(PATTERN);
  for (const args of [
    ['--secrets', t.secretsFile, '--screenshots', t.shots, '--cli-dir', t.cli],
    ['--secrets', t.secretsFile, '--screenshots'],
    ['--secrets', t.secretsFile, '--screenshots', ''],
    ['--secrets', t.secretsFile, '--screenshots', t.shots, '--bogus', 'x'],
    ['--secrets', t.secretsFile, '--screenshots', t.shots, '--constructor', 'x'],
    ['--screenshots', t.shots],
    ['--secrets', t.secretsFile],
    ['--secrets', t.secretsFile, '--screenshots', t.shots, '--cli-dir', t.cli, '--since', 'yesterday'],
    ['--secrets', t.secretsFile, '--secrets', t.secretsFile, '--screenshots', t.shots],
  ]) {
    const r = spawn(args);
    assert.equal(r.status, 2, `${args.join(' ')} → ${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /usage: qa-scrub\.js/);
  }
});

test('parseArgs accepts the minimal form', () => {
  assert.deepEqual(parseArgs(['--secrets', 's.json', '--screenshots', 'd']), {
    secrets: 's.json', screenshots: 'd', traces: null, cliDir: null, since: null,
  });
});

test('stdout never contains the secret', () => {
  const t = tree([...PATTERN, { locator: { role: 'textbox', name: 'API key' } }]);
  const r = spawn(t.args);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('FAKE-QA'));
  assert.ok(!r.stderr.includes('FAKE-QA'));
});
