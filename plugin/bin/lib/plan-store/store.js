// plugin/bin/lib/plan-store/store.js — write and read a reviewed plan on its hidden ref (#6052).
// writePlan builds one commit (parent = base, tree = base + the plan file) on a scratch index,
// pushes it under a lease on the observed remote sha, and only then moves the local ref. The
// order is the decision: a failed push leaves the local ref and the remote as they were (AC7).
// Neither function throws.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { planRefName, PLAN_DIR, DEFAULT_REMOTE } = require('./ref');
const { resolveCommit, localRef, lsRemoteRef, fetchRef, planCommitFile, absoluteGitDir } = require('./git');

function reasonOf(err) {
  const stderr = err && err.stderr != null ? String(err.stderr).trim() : '';
  return stderr || (err && err.message) || 'git failed';
}

function writePlan({ g, remote = DEFAULT_REMOTE, push, record, basename, planBytes, base }) {
  let ref;
  try {
    ref = planRefName(record);
  } catch (err) {
    return { ok: false, kind: 'invalid', reason: err.message };
  }
  if (typeof basename !== 'string' || !basename || basename.includes('/') || basename.includes('\\') || basename.includes('\0') || basename.startsWith('-')) {
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
    commit = String(g(['commit-tree', tree, '-p', baseSha, '-m', `Plan for #${record}`], { extraEnv })).trim();
  } catch (err) {
    return { ok: false, kind: 'no-ref', reason: reasonOf(err) };
  } finally {
    try { if (index) fs.rmSync(index, { force: true }); } catch { /* best effort: a leftover scratch index is harmless */ }
  }

  if (push) {
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
