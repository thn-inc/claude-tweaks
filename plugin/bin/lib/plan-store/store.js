// plugin/bin/lib/plan-store/store.js — write and read a reviewed plan on its hidden ref (#6052).
// writePlan builds one commit (parent = base, tree = base + the plan file) on a scratch index,
// pushes it under a lease on the observed remote sha, and only then moves the local ref. The
// order is the decision: a failed push leaves the local ref and the remote as they were (AC7).
// Neither function throws.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { planRefName, isPlanBasename, PLAN_DIR, DEFAULT_REMOTE } = require('./ref');
const { resolveCommit, localRef, lsRemoteRef, fetchRef, planCommitFile, absoluteGitDir, reasonOf } = require('./git');

function writePlan({ g, remote = DEFAULT_REMOTE, push, record, basename, planBytes, base }) {
  let ref;
  try {
    ref = planRefName(record);
  } catch (err) {
    return { ok: false, kind: 'invalid', reason: err.message };
  }
  if (!isPlanBasename(basename)) {
    return { ok: false, kind: 'invalid', reason: `invalid plan basename: ${String(basename)}` };
  }
  if (!Buffer.isBuffer(planBytes)) return { ok: false, kind: 'invalid', reason: 'planBytes must be a Buffer' };

  const baseSha = resolveCommit(g, base);
  if (!baseSha) return { ok: false, kind: 'invalid', reason: `base does not resolve to a commit: ${String(base)}` };

  let observed = null;
  if (push) {
    observed = lsRemoteRef(g, remote, ref);
    if (!observed.ok) return { ok: false, kind: 'no-ref', reason: observed.reason };
  }

  const prior = localRef(g, ref);

  let commit;
  let index;
  try {
    index = path.join(absoluteGitDir(g), `plan-store-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
    const extraEnv = { GIT_INDEX_FILE: index };
    g(['read-tree', '--end-of-options', baseSha], { extraEnv });
    const blob = String(g(['hash-object', '-w', '--no-filters', '--stdin'], { extraEnv, input: planBytes })).trim();
    g(['update-index', '--add', '--cacheinfo', `100644,${blob},${PLAN_DIR}/${basename}`], { extraEnv });
    const tree = String(g(['write-tree'], { extraEnv })).trim();
    // A tree equal to the base's means the base already holds this plan byte-for-byte: the commit would
    // change 0 files, which read and check always reject (AC2), so refuse instead of reporting success.
    if (tree === String(g(['rev-parse', '--verify', '--end-of-options', `${baseSha}^{tree}`])).trim()) {
      return { ok: false, kind: 'invalid', reason: 'base already holds this plan file byte-for-byte' };
    }
    commit = String(g(['commit-tree', tree, '-p', baseSha, '-m', `Plan for #${record}`], { extraEnv })).trim();
  } catch (err) {
    return { ok: false, kind: 'no-ref', reason: reasonOf(err) };
  } finally {
    try { if (index) fs.rmSync(index, { force: true }); } catch { /* best effort: a leftover scratch index is harmless */ }
  }

  if (push) {
    // The lease expects the sha ls-remote saw on the remote, not the local ref, which can lag a
    // writer in another clone. An empty expected value (`<ref>:`) means the ref must not exist yet,
    // so a first write and a replace are both refused if anyone moved the ref since ls-remote.
    // Same idiom as claims-git-cas.js's writeClaimBlobGit and release-state/store.js's writeStateGit.
    try {
      g(['push', '--no-verify', '-q', remote, `${commit}:${ref}`, `--force-with-lease=${ref}:${observed.sha || ''}`]);
    } catch (err) {
      const reason = reasonOf(err);
      return {
        ok: false, kind: 'no-ref',
        reason: /stale info|\[rejected\]/.test(reason) ? `push lost the lease on ${ref}: ${reason}` : reason,
      };
    }
  }

  // Move the local ref only now, as a compare-and-swap against the value read above (`''` means it
  // must still be absent), so a concurrent local writer makes this fail instead of being overwritten.
  // After a push the remote is the store, so a failed move still succeeds with a warning (plan-review
  // Reading B, plan-store.js's USAGE); without a push the local ref is the store, so it is no-ref.
  try {
    g(['update-ref', '-m', 'plan-store write', ref, commit, prior || '']);
  } catch (err) {
    if (push) return { ok: true, ref, commit, localRefUpdated: false, localRefReason: reasonOf(err) };
    return { ok: false, kind: 'no-ref', reason: reasonOf(err) };
  }
  return { ok: true, ref, commit, localRefUpdated: true };
}

function readPlan({ g, remote = DEFAULT_REMOTE, fetch, record, commit }) {
  try {
    const ref = planRefName(record);
    if (fetch) {
      const f = fetchRef(g, remote, ref);
      if (!f.ok) return { ok: false, reason: f.reason };
    }
    const have = localRef(g, ref);
    if (!have) return { ok: false, reason: `${ref} does not exist` };
    if (have !== commit) return { ok: false, reason: `${ref} names ${have}, not ${String(commit)}` };
    const file = planCommitFile(g, commit);
    if (!file.ok) return { ok: false, reason: file.reason };
    return { ok: true, basename: path.posix.basename(file.path), bytes: file.bytes };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

module.exports = { writePlan, readPlan };
