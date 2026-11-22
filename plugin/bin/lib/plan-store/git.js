// plugin/bin/lib/plan-store/git.js — git transport primitives for the plan store (#6052).
// `defaultGit` is this module's only execFileSync('git', ...). `makeGit` wraps a runner so every
// call runs `-C root` under repoPinnedEnv (an inherited GIT_DIR from a hook never redirects it).
// Each primitive returns a verdict object rather than throwing, except absoluteGitDir.
'use strict';

const { execFileSync } = require('child_process');
const { repoPinnedEnv } = require('../hooks/git-exec');
const shared = require('../shared-primitives');
const { parseNameStatusZ, splitNul } = require('../git-z');
const { PLAN_DIR, isPlanBasename } = require('./ref');

// The two shared-primitives values are read lazily, so a test override still reaches them.
function defaultGit(args, { cwd, env, input, encoding = 'utf8' } = {}) {
  return execFileSync('git', args, {
    cwd, env, input,
    encoding: encoding === 'buffer' ? 'buffer' : 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: shared.GIT_TIMEOUT_MS,
    maxBuffer: shared.LARGE_MAX_BUFFER_BYTES,
    windowsHide: true,
  });
}

function makeGit({ git = defaultGit, root, env } = {}) {
  return (args, { extraEnv, input, encoding } = {}) =>
    git(['-C', root, ...args], { cwd: root, env: { ...repoPinnedEnv(env), ...extraEnv }, input, encoding });
}

// ls-remote and fetch take the remote before any ref and have no end-of-options slot there,
// so a dash-leading remote would be read as a flag: refuse it without running git.
function badRemote(remote) {
  return typeof remote !== 'string' || !remote || remote.startsWith('-')
    ? { ok: false, reason: `invalid remote name: ${String(remote)}` }
    : null;
}

function reasonOf(err) {
  const stderr = err && err.stderr != null ? String(err.stderr).trim() : '';
  return stderr || (err && err.message) || 'git failed';
}

function resolveCommit(g, rev) {
  try {
    const out = String(g(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`])).trim();
    return out || null;
  } catch {
    return null;
  }
}

function localRef(g, ref) {
  try {
    const out = String(g(['rev-parse', '--verify', '--quiet', '--end-of-options', ref])).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ls-remote prints same-tail refs too (refs/archive/<ref>); keep only the exact ref.
function lsRemoteRef(g, remote, ref) {
  const bad = badRemote(remote);
  if (bad) return bad;
  try {
    const out = String(g(['ls-remote', remote, ref])); // git-path-read: not a path list (ref names)
    for (const line of out.split('\n')) {
      const [sha, name] = line.split('\t');
      if (name === ref && sha) return { ok: true, sha };
    }
    return { ok: true, sha: null };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

// The leading `+` forces the update: a replaced plan is not a fast-forward of the stale local ref.
function fetchRef(g, remote, ref) {
  const bad = badRemote(remote);
  if (bad) return bad;
  try {
    g(['fetch', '-q', '--no-tags', '--no-write-fetch-head', remote, `+${ref}:${ref}`]);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

function planCommitFile(g, commit) {
  const parent = resolveCommit(g, `${commit}^1`);
  if (!parent) return { ok: false, reason: `commit ${commit} has no parent` };
  let entries;
  try {
    entries = parseNameStatusZ(g(['diff-tree', '-r', '-z', '--no-renames', '--name-status', '--end-of-options', parent, commit]));
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
  if (entries.length !== 1) return { ok: false, reason: `plan commit ${commit} changes ${entries.length} files, expected 1` };
  const [{ status, paths }] = entries;
  const p = paths[0];
  if (status !== 'A' && status !== 'M') return { ok: false, reason: `plan commit ${commit} has status ${status}, expected A or M` };
  if (!p || !p.startsWith(`${PLAN_DIR}/`) || !isPlanBasename(p.slice(PLAN_DIR.length + 1))) {
    return { ok: false, reason: `plan commit ${commit} file ${p} is not directly under ${PLAN_DIR}/` };
  }
  try {
    const bytes = g(['cat-file', 'blob', `${commit}:${p}`], { encoding: 'buffer' });
    return { ok: true, parent, path: p, bytes: Buffer.from(bytes) };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

// The paths changed between `from` and `to`. With `paths`, the diff is limited to them (each a
// literal pathspec, so a glob character in a plan's path matches only itself), which bounds the
// output by what the caller asks about rather than by how far `to` has drifted from `from`.
function changedPaths(g, from, to, paths) {
  try {
    const limit = paths ? ['--', ...paths.map((p) => `:(literal)${p}`)] : [];
    const raw = g(['diff', '--no-renames', '--name-status', '-z', '--no-ext-diff', '--end-of-options', from, to, ...limit]);
    const changed = new Set();
    for (const entry of parseNameStatusZ(raw)) for (const p of entry.paths) changed.add(p);
    return { ok: true, paths: changed };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

function absoluteGitDir(g) {
  const out = splitNul(String(g(['rev-parse', '--absolute-git-dir'])).trim());
  if (!out.length) throw new Error('git rev-parse --absolute-git-dir printed nothing');
  return out[0];
}

module.exports = {
  defaultGit, makeGit, reasonOf, resolveCommit, localRef, lsRemoteRef, fetchRef, planCommitFile, changedPaths, absoluteGitDir,
};
