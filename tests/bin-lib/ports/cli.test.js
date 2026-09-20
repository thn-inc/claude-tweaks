'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run, parseServices } = require('../../../plugin/bin/lib/ports/cli');

function fakeDeps(overrides = {}) {
  const out = [];
  const err = [];
  return {
    deps: {
      home: () => '/home/tester',
      resolvePath: () => '/repo',
      cwd: () => '/repo',
      allocate: async () => ({ base: 20000, ports: [], vars: [['PORT', '20000']], envWriteError: null }),
      release: () => {},
      status: () => ({ version: 1, leases: {} }),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      ...overrides,
    },
    out,
    err,
  };
}

test('parseServices: trims entries and drops blanks', () => {
  assert.deepEqual(parseServices('web, api ,,db'), ['web', 'api', 'db']);
  assert.deepEqual(parseServices(null), []);
});

test('env: leased path prints exactly the managed lines, no markers', async () => {
  const { deps, out } = fakeDeps({
    status: () => ({
      version: 1,
      leases: { 20010: { path: '/repo', services: ['web', 'api'], project: 'repo', leased: 'x' } },
    }),
  });
  const code = await run(['env', '--path', '/repo'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, ['CLAUDE_TWEAKS_LEASE=20010\n', 'PORT=20010\n', 'API_PORT=20011\n']);
});

// AC12
test('env: unleased path prints nothing and exits 0', async () => {
  const { deps, out, err } = fakeDeps();
  const code = await run(['env', '--path', '/repo'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
  assert.deepEqual(err, []);
});

test('unknown subcommand exits 2 with a usage line on stderr', async () => {
  const { deps, err } = fakeDeps();
  const code = await run(['bogus'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /unknown command/);
  assert.match(err.join(''), /usage: ports\.js/);
});

test('unparseable --services exits 2', async () => {
  const { deps, err } = fakeDeps();
  const code = await run(['allocate', '--path', '/repo', '--services', ',,'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /--services must be/);
});

test('allocate: happy path prints the base and exits 0', async () => {
  const { deps, out } = fakeDeps();
  const code = await run(['allocate', '--path', '/repo', '--services', 'web'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, ['20000\n']);
});

test('allocate: reports an env-write failure on stderr but still exits 0', async () => {
  const { deps, out, err } = fakeDeps({
    allocate: async () => ({ base: 20000, ports: [], vars: [], envWriteError: 'EACCES' }),
  });
  const code = await run(['allocate', '--path', '/repo'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, ['20000\n']);
  assert.match(err.join(''), /EACCES/);
});

test('pool exhaustion maps to exit 3', async () => {
  const { deps, err } = fakeDeps({
    allocate: async () => { const e = new Error('PORTS_EXHAUSTED'); e.code = 'PORTS_EXHAUSTED'; throw e; },
  });
  const code = await run(['allocate', '--path', '/repo'], deps);
  assert.equal(code, 3);
  assert.match(err.join(''), /pool exhausted/);
});

test('a lock timeout maps to exit 4 (registry unwritable)', async () => {
  const { deps, err } = fakeDeps({
    allocate: async () => { const e = new Error('could not acquire lock'); e.code = 'LOCK_TIMEOUT'; throw e; },
  });
  const code = await run(['allocate', '--path', '/repo'], deps);
  assert.equal(code, 4);
  assert.match(err.join(''), /registry unwritable/);
});

test('no --path and an unresolvable cwd exits 2', async () => {
  const { deps, err } = fakeDeps({ resolvePath: () => null });
  const code = await run(['status'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /could not be inferred/);
});
