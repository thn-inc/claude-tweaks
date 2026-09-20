'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const { ensure, isRegionCurrent } = require('../../../plugin/bin/lib/ports/ensure');
const { registryPath } = require('../../../plugin/bin/lib/ports/registry');
const { writeEnvFiles, serviceVars, LEASE_KEY, readManagedRegion, mergeManagedRegion } = require('../../../plugin/bin/lib/ports/env-file');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ports-ensure-'));
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

test('ensure: empty policyServices is a no-op, no registry file created', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'a');
  const result = await ensure(checkout, { home, policyServices: [], resolveRoot: () => checkout });
  assert.deepEqual(result, { active: false });
  assert.equal(fs.existsSync(registryPath({ home })), false);
});

test('ensure: an unresolvable checkout root is a no-op', async () => {
  const home = tmpHome();
  const result = await ensure('/nowhere', { home, policyServices: ['web'], resolveRoot: () => null });
  assert.deepEqual(result, { active: false });
});

// AC3. `probe: async () => true` avoids real socket use — this test's
// assertion is about registry/env-file bookkeeping, not bind detection,
// and the shared 20000+ pool range otherwise contends with the tests below
// (and registry.test.js's) when multiple test FILES run concurrently.
test('ensure: fresh registry activates, returns the leased block, writes .env.local', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'fresh');
  const result = await ensure(checkout, { home, policyServices: ['web', 'api'], resolveRoot: () => checkout, probe: async () => true });
  assert.equal(result.active, true);
  assert.equal(result.reallocated, null);
  assert.deepEqual(result.vars, [['CLAUDE_TWEAKS_LEASE', String(result.base)], ['PORT', String(result.base)], ['API_PORT', String(result.base + 1)]]);
  const envLocal = fs.readFileSync(path.join(checkout, '.env.local'), 'utf8');
  assert.match(envLocal, new RegExp(`PORT=${result.base}`));
});

// AC4: lease present, a port bound, but the .env.local region is current -> keep the lease.
test('ensure: a bound port with a current region keeps the lease (assumed to be our own dev server)', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'current-region');
  // Fake probe for the initial allocation only — no real port needed until
  // the actual bind-detection assertion below, which uses the real probe.
  const first = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  assert.equal(first.reallocated, null);

  const server = await listenOn(first.base);
  try {
    const second = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout });
    assert.equal(second.reallocated, null);
    assert.equal(second.base, first.base);
  } finally {
    server.close();
  }
});

// #2031 AC1: on the existing-lease-not-free branch (the same branch the test
// above exercises), ensure() must read .env.local at most once for the
// managed-region check — regionBefore's own read, never a second independent
// read+parse inside the isRegionCurrent/regionIsCurrent call. A second,
// unrelated read of the same file still happens once per call, inside
// registry.allocate's own writeEnvFiles (env-file.js's existing-content
// comparison before an idempotent write) — that read predates this record
// and is not what AC1 targets, so the true portable count on this branch is
// 2 (regionBefore + writeEnvFiles), not 1. Comparing via realpath (rather
// than the raw checkout path the test constructs) matters because
// registry.allocate resolves realPath = fs.realpathSync(checkoutPath) before
// calling writeEnvFiles: on macOS, os.tmpdir() sits under a symlinked
// /var -> /private/var, so a raw-path string comparison silently misses that
// second read entirely — passing locally with count 1 while CI (Linux, no
// such symlink layer) correctly observes 2 and fails. Normalizing both sides
// through realpathSync makes the count agree across platforms.
test('ensure: reads .env.local at most once for the managed-region check on the existing-lease-not-free branch', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'read-count');
  const first = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  assert.equal(first.reallocated, null);

  const envPath = path.join(checkout, '.env.local');
  const realEnvPath = fs.realpathSync(envPath);
  const server = await listenOn(first.base);
  const originalReadFileSync = fs.readFileSync;
  let envLocalReads = 0;
  fs.readFileSync = function (target, ...rest) {
    if (typeof target === 'string' && target.endsWith('.env.local')) {
      let real;
      try { real = fs.realpathSync(target); } catch { real = target; }
      if (real === realEnvPath) envLocalReads += 1;
    }
    return originalReadFileSync.call(fs, target, ...rest);
  };
  try {
    const second = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout });
    assert.equal(second.reallocated, null);
    assert.equal(envLocalReads, 2, '.env.local should be read exactly twice: once for the managed-region check (regionBefore), once inside writeEnvFiles\'s pre-write comparison — never a third, redundant read for the check itself');
  } finally {
    fs.readFileSync = originalReadFileSync;
    server.close();
  }
});

// AC5: lease present, a port bound, and the region is absent -> reallocate.
test('ensure: a bound port with no managed region reallocates to a fresh block', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'stale-region');
  const first = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  fs.rmSync(path.join(checkout, '.env.local'));

  const server = await listenOn(first.base);
  try {
    const second = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout });
    assert.deepEqual(second.reallocated, { from: first.base, to: second.base });
    assert.notEqual(second.base, first.base);
    const envLocal = fs.readFileSync(path.join(checkout, '.env.local'), 'utf8');
    assert.match(envLocal, new RegExp(`PORT=${second.base}`));
  } finally {
    server.close();
  }
});

test('ensure: a bound port with a region for a DIFFERENT service list reallocates (a changed port-services list moves URLs too)', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'changed-services');
  const first = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  // Region on disk still says services=['web'], but this run asks for ['web','api'] —
  // isRegionCurrent must catch the services mismatch even though PORT still matches.
  const server = await listenOn(first.base);
  try {
    const second = await ensure(checkout, { home, policyServices: ['web', 'api'], resolveRoot: () => checkout });
    assert.deepEqual(second.reallocated, { from: first.base, to: second.base });
  } finally {
    server.close();
  }
});

// #1927 AC2: a region that is current (PORT === base) but predates the lease
// line is completed in place — same base, no reallocation.
test('ensure: a current region without CLAUDE_TWEAKS_LEASE is rewritten in place with the same base and reports leaseLineAdded', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'pre-lease');
  const first = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  // Strip the lease line to fake a region written before #1927.
  const envPath = path.join(checkout, '.env.local');
  const stripped = mergeManagedRegion(fs.readFileSync(envPath, 'utf8'), [['PORT', String(first.base)]]);
  fs.writeFileSync(envPath, stripped);
  assert.equal(isRegionCurrent(checkout, first.base, ['web'], ['web']), true, 'currency semantics are unchanged by the missing line');
  assert.ok(!readManagedRegion(stripped).some(([k]) => k === LEASE_KEY));

  const second = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  assert.equal(second.reallocated, null);
  assert.equal(second.base, first.base);
  assert.equal(second.leaseLineAdded, true);
  const region = readManagedRegion(fs.readFileSync(envPath, 'utf8'));
  assert.deepEqual(region[0], [LEASE_KEY, String(first.base)], 'the lease line is first');
  assert.deepEqual(region.find(([k]) => k === 'PORT'), ['PORT', String(first.base)]);

  const mtime = fs.statSync(envPath).mtimeMs;
  const third = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  assert.equal(third.leaseLineAdded, false);
  assert.equal(fs.statSync(envPath).mtimeMs, mtime, 'a second run rewrites nothing');
});

test('ensure: a fresh checkout reports leaseLineAdded false (the line was written with the lease, not added to a prior region)', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'fresh-lease');
  const result = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  assert.equal(result.leaseLineAdded, false);
  assert.deepEqual(result.vars[0], [LEASE_KEY, String(result.base)]);
});

test('ensure: a non-current region still takes the reallocation path (leaseLineAdded false, reallocated set)', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'stale-lease');
  const first = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  fs.unlinkSync(path.join(checkout, '.env.local'));
  const server = await listenOn(first.base);
  try {
    const second = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout });
    assert.ok(second.reallocated && second.reallocated.from === first.base);
    assert.equal(second.leaseLineAdded, false);
  } finally { server.close(); }
});

// #1927 fix round 1: an orphaned region (no matching registry lease — a
// fresh registry, or a checkout whose old lease is gone) that lacks the
// lease line must NOT be reported as completed just because it predates
// #1927 — the registry hands back whatever base claimFreeBase finds free,
// not necessarily the base the stale region already carried, so this is a
// base change, not a same-base completion.
test('ensure: an orphaned region with no matching registry lease and a different base is not reported as leaseLineAdded', async () => {
  const home = tmpHome();
  const checkout = tmpCheckout(home, 'orphaned-region');
  // Pre-existing region from some other era, with no lease line — but the
  // registry has never seen this path (fresh home, no ports.json yet), so
  // it will be claimed as a brand-new lease, not recognized as this one.
  writeEnvFiles(checkout, serviceVars(['web'], 20005));
  const result = await ensure(checkout, { home, policyServices: ['web'], resolveRoot: () => checkout, probe: async () => true });
  assert.equal(result.reallocated, null);
  assert.equal(result.leaseLineAdded, false);
  const region = readManagedRegion(fs.readFileSync(path.join(checkout, '.env.local'), 'utf8'));
  assert.deepEqual(region[0], [LEASE_KEY, String(result.base)], 'the lease line is first in the freshly-claimed region');
});

test('isRegionCurrent: false when .env.local is missing, has no region, has the wrong PORT, or a different services list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ports-region-'));
  assert.equal(isRegionCurrent(dir, 20000, ['web'], ['web']), false, 'no .env.local at all');

  fs.writeFileSync(path.join(dir, '.env.local'), 'FOO=bar\n');
  assert.equal(isRegionCurrent(dir, 20000, ['web'], ['web']), false, 'no managed region');

  writeEnvFiles(dir, serviceVars(['web'], 20010));
  assert.equal(isRegionCurrent(dir, 20000, ['web'], ['web']), false, 'PORT does not match the given base');
  assert.equal(isRegionCurrent(dir, 20010, ['web'], ['web']), true, 'base and services both match');
  assert.equal(isRegionCurrent(dir, 20010, ['web'], ['api']), false, 'lease services differ from policyServices');
});
