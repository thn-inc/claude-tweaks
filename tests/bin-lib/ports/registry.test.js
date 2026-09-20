'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const {
  POOL_BASE, BLOCK_SIZE, registryPath, allocate, release, status,
} = require('../../../plugin/bin/lib/ports/registry');
const { BEGIN_MARKER } = require('../../../plugin/bin/lib/ports/env-file');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ports-registry-'));
}

function tmpCheckout(home, name) {
  const p = path.join(home, 'checkouts', name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// A fake probe reporting every block free, for tests whose assertion is
// about registry bookkeeping rather than bind detection — avoids real
// socket use in the shared 20000+ pool range, which otherwise contends with
// this file's own bind-detection tests (and ensure.test.js's) when multiple
// test FILES run concurrently under one `node --test` invocation.
const alwaysFree = async () => true;

// AC1: fresh registry -> allocate returns base 20000 and writes the shape.
test('allocate: fresh registry returns POOL_BASE and writes {path, project, services, leased}', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'proj-a');
  const result = await allocate(checkout, { services: ['web', 'api'], home, probe: alwaysFree });
  assert.equal(result.base, POOL_BASE);
  assert.deepEqual(result.ports, Array.from({ length: BLOCK_SIZE }, (_, i) => POOL_BASE + i));

  const raw = JSON.parse(fs.readFileSync(registryPath({ home }), 'utf8'));
  const lease = raw.leases[String(POOL_BASE)];
  assert.equal(lease.path, fs.realpathSync(checkout));
  assert.deepEqual(lease.services, ['web', 'api']);
  assert.match(lease.leased, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

// AC2: a bound test listener on the first candidate block skips it.
test('allocate: skips a block with a bound port, moves to the next candidate', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'proj-b');
  const server = await listenOn(POOL_BASE + 3);
  try {
    const result = await allocate(checkout, { services: ['web'], home });
    assert.equal(result.base, POOL_BASE + BLOCK_SIZE);
  } finally {
    server.close();
  }
});

// AC3: idempotent — two calls for the same path return the same block, one lease.
test('allocate: idempotent for the same path', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'proj-c');
  const first = await allocate(checkout, { services: ['web'], home, probe: alwaysFree });
  const second = await allocate(checkout, { services: ['other'], home, probe: alwaysFree });
  assert.equal(second.base, first.base);
  const raw = JSON.parse(fs.readFileSync(registryPath({ home }), 'utf8'));
  assert.equal(Object.keys(raw.leases).length, 1);
  // The idempotent hit does not overwrite the originally recorded services.
  assert.deepEqual(raw.leases[String(first.base)].services, ['web']);
});

// AC4: a lease whose path no longer exists is gc'd, freeing its block.
test('allocate: gc drops a lease whose checkout path is gone', async () => {
  const home = tmpHome();
  const goneCheckout = tmpCheckout(home, 'gone');
  const first = await allocate(goneCheckout, { services: ['web'], home, probe: alwaysFree });
  assert.equal(first.base, POOL_BASE);
  fs.rmSync(goneCheckout, { recursive: true, force: true });

  const other = tmpCheckout(home, 'still-here');
  const second = await allocate(other, { services: ['web'], home, probe: alwaysFree });
  assert.equal(second.base, POOL_BASE, 'the dead lease\'s block became allocatable again');
});

// AC5: two concurrent allocators (separate processes) get distinct blocks.
test('allocate: two concurrent child-process allocators never receive the same base', async () => {
  const home = tmpHome();
  const checkoutA = tmpCheckout(home, 'concurrent-a');
  const checkoutB = tmpCheckout(home, 'concurrent-b');
  const registryModulePath = path.resolve(__dirname, '../../../plugin/bin/lib/ports/registry.js');

  // `node -e <script> <args...>` does NOT reserve argv[1] for the eval
  // placeholder the way running a script FILE reserves argv[1] for the
  // file's own path — argv here is [execPath, ...args], so the checkout
  // path is argv[1] and home is argv[2], not argv[2]/argv[3].
  const script = `
    const { allocate } = require(${JSON.stringify(registryModulePath)});
    allocate(process.argv[1], { services: ['web'], home: process.argv[2], probe: async () => true })
      .then((r) => { process.stdout.write(String(r.base)); })
      .catch((e) => { process.stderr.write(String(e && e.message)); process.exitCode = 1; });
  `;

  function run(checkout) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script, checkout, home], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
    });
  }

  const [baseA, baseB] = await Promise.all([run(checkoutA), run(checkoutB)]);
  assert.notEqual(baseA, baseB);

  const raw = JSON.parse(fs.readFileSync(registryPath({ home }), 'utf8'));
  const bases = Object.keys(raw.leases);
  assert.equal(new Set(bases).size, bases.length, 'no duplicate base in the registry');
});

// AC6: release removes the lease only; unknown path is a no-op.
test('release: removes the lease for a known path; no-op for an unknown path', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'proj-d');
  await allocate(checkout, { services: ['web'], home, probe: alwaysFree });

  release(path.join(home, 'checkouts', 'never-allocated'), { home });
  let raw = JSON.parse(fs.readFileSync(registryPath({ home }), 'utf8'));
  assert.equal(Object.keys(raw.leases).length, 1, 'unknown-path release changed nothing');

  release(checkout, { home });
  raw = JSON.parse(fs.readFileSync(registryPath({ home }), 'utf8'));
  assert.equal(Object.keys(raw.leases).length, 0);
});

// AC7: a corrupt registry file is renamed aside with a Windows-safe timestamp suffix.
test('allocate: a corrupt ports.json is renamed aside and a fresh registry is written', async () => {
  const home = tmpHome();
  const regPath = registryPath({ home });
  fs.mkdirSync(path.dirname(regPath), { recursive: true });
  fs.writeFileSync(regPath, '{ this is not json');

  const checkout = tmpCheckout(home, 'proj-e');
  const result = await allocate(checkout, { services: ['web'], home, probe: alwaysFree });
  assert.equal(result.base, POOL_BASE);

  const dir = fs.readdirSync(path.dirname(regPath));
  const corrupt = dir.find((f) => f.startsWith('ports.json.corrupt-'));
  assert.ok(corrupt, 'a corrupt-renamed file exists');
  assert.doesNotMatch(corrupt, /:/, 'no colon in the filename (Windows-illegal)');
});

// AC8: pool exhausted -> PORTS_EXHAUSTED, registry unchanged.
test('allocate: pool exhausted throws PORTS_EXHAUSTED and leaves the registry untouched', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'proj-f');
  const alwaysBound = async () => false;

  await assert.rejects(
    () => allocate(checkout, { services: ['web'], home, probe: alwaysBound }),
    (err) => err.code === 'PORTS_EXHAUSTED',
  );
  assert.equal(fs.existsSync(registryPath({ home })), false);
});

test('status: prunes dead leases as a side effect and returns the pruned view', async () => {
  const home = tmpHome();
  const gone = tmpCheckout(home, 'status-gone');
  await allocate(gone, { services: ['web'], home, probe: alwaysFree });
  fs.rmSync(gone, { recursive: true, force: true });

  const view = status({ home });
  assert.equal(Object.keys(view.leases).length, 0);
  const raw = JSON.parse(fs.readFileSync(registryPath({ home }), 'utf8'));
  assert.equal(Object.keys(raw.leases).length, 0, 'the prune was persisted');
});

// #1927: the registry's env write carries the lease line first.
test('allocate: the written managed region starts with CLAUDE_TWEAKS_LEASE={base} and vars carries the pair first', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ports-registry-lease-'));
  const checkout = path.join(home, 'co'); fs.mkdirSync(checkout, { recursive: true });
  const result = await allocate(checkout, { services: ['web', 'api'], home, probe: async () => true });
  assert.deepEqual(result.vars[0], ['CLAUDE_TWEAKS_LEASE', String(result.base)]);
  assert.deepEqual(result.vars[1], ['PORT', String(result.base)]);
  const text = fs.readFileSync(path.join(checkout, '.env.local'), 'utf8');
  assert.match(text, new RegExp(`${BEGIN_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nCLAUDE_TWEAKS_LEASE=${result.base}\\nPORT=${result.base}\\n`));
});
