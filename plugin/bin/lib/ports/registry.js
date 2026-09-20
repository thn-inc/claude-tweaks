// bin/lib/ports/registry.js — the allocation half of port isolation (#1791).
// One machine-wide lease registry (`~/.claude-tweaks/ports.json`) hands each
// checkout a verified-free 10-port block from a fixed pool, keyed by the
// checkout's realpath. See that issue's Decision Rationale for why a lease
// registry with bind-probe verification was chosen over a path-hash or
// OS-assigned-port-0 scheme.
//
// Lock/await/release choice (allocate's own note in the issue's Technical
// Approach): the bind-probe is async while file-lock.js's mutex is
// acquired/released synchronously. `withLock` here is called with an async
// `fn` and `failClosed: true` — file-lock.js's `withLock` awaits `fn()`'s
// returned promise before releasing, so the lock is held for the whole
// probe-then-write sequence. `failClosed: true` overrides file-lock.js's
// default fail-open posture: two allocators racing on a missed lock could
// otherwise both write, violating AC5's "no duplicate base" guarantee — a
// failed acquire raises `LOCK_TIMEOUT` (mapped below to `PORTS_LOCK_TIMEOUT`)
// instead of letting allocate proceed unlocked.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { withLock } = require('../file-lock');
const { readJsonFile, writeJsonFile } = require('../json-store');
const { blockFree } = require('./probe');
const { serviceVars, leaseVars, writeEnvFiles } = require('./env-file');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');

const POOL_BASE = 20000;
const POOL_END = 29999;
const BLOCK_SIZE = 10;
const REGISTRY_VERSION = 1;

function registryPath({ home = os.homedir() } = {}) {
  return path.join(home, '.claude-tweaks', 'ports.json');
}

function freshRegistry() {
  return { version: REGISTRY_VERSION, leases: {} };
}

// Pure degrade-open read — no gc, no write, no lock acquisition. For a
// caller (the statusline, #1793) that runs on every prompt render and must
// never mutate anything or block on a lock: a missing or corrupt file reads
// as "no leases," the same as a caller that only cares whether ITS OWN
// checkout has a lease, never as a thrown error. Unlike `status()`, this
// never persists a gc'd view — a caller that needs the pruned, canonical
// view (and can tolerate a write) uses `status()` instead.
function readRegistry({ home = os.homedir() } = {}) {
  return readJsonFile(registryPath({ home }), { fallback: freshRegistry() });
}

// Load the registry, handling a corrupt (unparseable) file per AC7: rename
// it aside with a Windows-safe timestamp suffix (colons illegal in Windows
// filenames), report the rename on stderr's caller-visible return value, and
// start fresh. A genuinely missing file is not corrupt — it's just fresh.
function loadOrInit(regPath) {
  const existed = fs.existsSync(regPath);
  const loaded = readJsonFile(regPath, { fallback: null });
  if (loaded !== null) return { registry: loaded, corruptRename: null };
  if (!existed) return { registry: freshRegistry(), corruptRename: null };

  const suffix = new Date().toISOString().replace(/:/g, '-');
  const corruptPath = `${regPath}.corrupt-${suffix}`;
  let corruptRename = null;
  try {
    fs.renameSync(regPath, corruptPath);
    corruptRename = corruptPath;
  } catch {
    // Best-effort — if the rename itself fails, fall through and overwrite
    // the corrupt file with a fresh registry on the next write anyway.
  }
  return { registry: freshRegistry(), corruptRename };
}

// Drop leases whose checkout path no longer exists on disk. Returns
// { registry, changed } — `changed` tells the caller whether a write is
// needed.
function gc(registry) {
  let changed = false;
  const leases = {};
  for (const [base, lease] of Object.entries(registry.leases || {})) {
    if (fs.existsSync(lease.path)) {
      leases[base] = lease;
    } else {
      changed = true;
    }
  }
  if (!changed) return { registry, changed: false };
  return { registry: { ...registry, leases }, changed: true };
}

function candidateBases() {
  const bases = [];
  for (let base = POOL_BASE; base + BLOCK_SIZE - 1 <= POOL_END; base += BLOCK_SIZE) {
    bases.push(base);
  }
  return bases;
}

function projectName(realPath) {
  const root = mainCheckoutRoot(realPath);
  return path.basename(root || realPath);
}

// Finds the first free candidate block, claims it for `realPath`/`services`,
// and persists the write — the shared core of allocate's "no existing lease"
// branch and reallocate's "existing lease is being replaced" branch. Must
// run inside the registry lock (see allocate's header comment on why the
// write cannot happen outside it). Throws PORTS_EXHAUSTED when no candidate
// probes free.
async function claimFreeBase(registry, regPath, realPath, services, probe) {
  for (const base of candidateBases()) {
    if (Object.prototype.hasOwnProperty.call(registry.leases, String(base))) continue;
    // eslint-disable-next-line no-await-in-loop
    const free = await probe(base, { size: BLOCK_SIZE });
    if (!free) continue;
    const lease = { path: realPath, project: projectName(realPath), services, leased: new Date().toISOString() };
    const updated = { ...registry, leases: { ...registry.leases, [base]: lease } };
    writeJsonFile(regPath, updated);
    return { base, lease };
  }
  const err = new Error('PORTS_EXHAUSTED');
  err.code = 'PORTS_EXHAUSTED';
  throw err;
}

function finishAllocation(realPath, result) {
  const vars = [...leaseVars(result.base), ...serviceVars(result.lease.services, result.base)];
  let envWriteError = null;
  try {
    writeEnvFiles(realPath, vars);
  } catch (err) {
    envWriteError = err && err.message ? err.message : String(err);
  }
  return {
    base: result.base,
    ports: Array.from({ length: BLOCK_SIZE }, (_, i) => result.base + i),
    vars,
    envWriteError,
  };
}

// (checkoutPath, { services, home, probe }) -> Promise<{ base, ports, vars, envWriteError }>
// Idempotent: a second call for the same path returns the existing lease
// without re-probing or changing its recorded services list.
async function allocate(checkoutPath, { services = [], home = os.homedir(), probe = blockFree } = {}) {
  const regPath = registryPath({ home });
  const lockPath = `${regPath}.lock`;
  const realPath = fs.realpathSync(checkoutPath);

  // The lock is a directory created by mkdirSync (no {recursive:true}) — its
  // parent must exist before the very first allocate ever runs on this
  // machine, since nothing has written the registry (and so created
  // ~/.claude-tweaks/) yet.
  fs.mkdirSync(path.dirname(regPath), { recursive: true });

  // The read, the (possibly slow, async) bind-probe, and the write all run
  // inside this one locked section — writing OUTSIDE the lock (even right
  // after it releases) reopens exactly the race the lock exists to close:
  // two allocators could both compute the same free base from a
  // not-yet-persisted read, each write their own lease, and the second
  // write silently clobbers the first (both processes then believe they
  // hold the same block).
  const result = await withLock(lockPath, async () => {
    const { registry: loaded } = loadOrInit(regPath);
    const { registry: pruned, changed: pruneChanged } = gc(loaded);
    const registry = pruned;

    for (const [base, lease] of Object.entries(registry.leases)) {
      if (lease.path === realPath) {
        if (pruneChanged) writeJsonFile(regPath, registry);
        return { base: Number(base), lease };
      }
    }

    return claimFreeBase(registry, regPath, realPath, services, probe);
  }, { failClosed: true });

  return finishAllocation(realPath, result);
}

// (checkoutPath, { services, home, probe }) -> Promise<{ base, ports, vars, envWriteError }>
// Unlike allocate, never returns an existing lease for this path — it drops
// one first (inside the same lock) and claims a fresh candidate block. For
// #1792/ensure.js's "a foreign process now holds this checkout's block, and
// nothing proves the block is still ours" case: the dropped block is
// excluded from consideration by construction (claimFreeBase only offers
// bases with no current lease entry), so a still-bound former block is never
// re-offered — probe() would reject it anyway, but dropping the stale entry
// first also stops a THIRD allocator from reading it as taken.
async function reallocate(checkoutPath, { services = [], home = os.homedir(), probe = blockFree } = {}) {
  const regPath = registryPath({ home });
  const lockPath = `${regPath}.lock`;
  const realPath = fs.realpathSync(checkoutPath);

  fs.mkdirSync(path.dirname(regPath), { recursive: true });

  const result = await withLock(lockPath, async () => {
    const { registry: loaded } = loadOrInit(regPath);
    const { registry: pruned } = gc(loaded);
    const leases = {};
    for (const [base, lease] of Object.entries(pruned.leases)) {
      if (lease.path !== realPath) leases[base] = lease;
    }
    const registry = { ...pruned, leases };
    return claimFreeBase(registry, regPath, realPath, services, probe);
  }, { failClosed: true });

  return finishAllocation(realPath, result);
}

// path -> void. Removes the lease for `path` from the registry only — it
// does not touch .env/.env.local (Unit 3's reap-time job). A path with no
// lease is a no-op.
function release(checkoutPath, { home = os.homedir() } = {}) {
  const regPath = registryPath({ home });
  const lockPath = `${regPath}.lock`;
  let realPath;
  try {
    realPath = fs.realpathSync(checkoutPath);
  } catch {
    realPath = checkoutPath;
  }

  fs.mkdirSync(path.dirname(regPath), { recursive: true });

  withLock(lockPath, () => {
    const { registry } = loadOrInit(regPath);
    const leases = {};
    let changed = false;
    for (const [base, lease] of Object.entries(registry.leases || {})) {
      if (lease.path === realPath) {
        changed = true;
      } else {
        leases[base] = lease;
      }
    }
    if (changed) writeJsonFile(regPath, { ...registry, leases });
  });
}

// {home} -> { leases }. Not purely read-only: runs the same dead-path gc as
// allocate and persists the pruned registry as a best-effort side effect
// (a write failure here is never thrown — the in-memory pruned view is
// still returned).
function status({ home = os.homedir() } = {}) {
  const regPath = registryPath({ home });
  const { registry: loaded } = loadOrInit(regPath);
  const { registry: pruned, changed } = gc(loaded);
  if (changed) {
    try { writeJsonFile(regPath, pruned); } catch { /* best-effort */ }
  }
  return pruned;
}

module.exports = {
  POOL_BASE, POOL_END, BLOCK_SIZE,
  registryPath, readRegistry, allocate, reallocate, release, status, gc, freshRegistry,
};
