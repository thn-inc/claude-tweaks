// bin/lib/hooks/repo-info-cache.js — per-process memo for worktree-detect's
// repoInfo(), validated by a filesystem signature (#5294). One hook call asked
// git the same four-flag `rev-parse` for the same directory many times over;
// the memo answers repeats from memory, but only while the signature taken now
// equals the one taken when the answer was recorded.
//
// The signature records stats only — it never derives git's answer itself
// (which is why it does not reuse the status line's commonDirFromFs, and why
// loading it costs no status-line code in every hook):
//   - root:    the directory holding the nearest `.git` (path, uid, ino)
//   - git:     that `.git` (path, kind, ino, uid; ctime only when it is a FILE —
//              a directory's ctime moves on every index.lock, which would miss
//              the cache after ordinary git activity). null when no `.git`
//              exists up to the filesystem root.
//   - content/admin/commondir: for a `.git` file, its full text, the admin dir
//              it points at (path, ino, or 'missing'), and that admin dir's
//              `commondir` text. A worktree removed and re-added at one path is
//              caught by the `.git` file's own ino + ctime (git rewrites it).
//   - configs: "{mtimeNs}:{size}:{ino}" or 'missing' for the common config,
//              config.worktree (the admin dir's for a linked worktree, the
//              `.git` directory's own for a main checkout), the global config(s) and the
//              system config git would read.
// Anything that cannot be looked at (an error other than ENOENT) makes the
// signature null, meaning "do not cache".
//
// repoInfo takes the signature BEFORE it spawns git. A change that races the
// spawn then leaves the remembered signature describing the pre-change state,
// so the next lookup mismatches and re-asks; a signature taken after the spawn
// could pair an answer about the old state with the new state's signature.
//
// The memo is keyed on directory + the git-relevant environment (envFingerprint),
// since the same directory answers differently under another GIT_DIR or HOME.
'use strict';
const fs = require('fs');
const path = require('path');

const MEMO_LIMIT = 500;
const memo = new Map();

const ENV_NAMES = new Set(['PATH', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE']);

// Env names compare upper-cased: a plain env object is case-sensitive, while
// git on win32 (and process.env there) is not.
function envGet(env, name) {
  for (const k of Object.keys(env || {})) {
    if (k.toUpperCase() === name && env[k] !== undefined) return env[k];
  }
  return undefined;
}

function envFingerprint(env) {
  const entries = [];
  for (const k of Object.keys(env || {})) {
    const upper = k.toUpperCase();
    if (upper.startsWith('GIT_') || ENV_NAMES.has(upper)) entries.push(`${upper}=${env[k]}`);
  }
  return entries.sort().join('\0');
}

class Unknown extends Error {}

// Stats `p` (bigint), returning null on ENOENT and throwing Unknown on any
// other error.
function statOrMissing(p) {
  try {
    return fs.statSync(p, { bigint: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw new Unknown();
  }
}

function readOrMissing(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw new Unknown();
  }
}

function configKey(p) {
  const st = statOrMissing(p);
  return st ? `${st.mtimeNs}:${st.size}:${st.ino}` : 'missing';
}

// The global and system config files git reads for this env/platform.
function globalAndSystemConfigs(env, platform) {
  const out = [];
  const globalOverride = envGet(env, 'GIT_CONFIG_GLOBAL');
  if (globalOverride !== undefined) {
    out.push(globalOverride);
  } else {
    const home = envGet(env, 'HOME');
    if (home !== undefined) {
      const xdg = envGet(env, 'XDG_CONFIG_HOME');
      out.push(xdg ? path.join(xdg, 'git', 'config') : path.join(home, '.config', 'git', 'config'));
      out.push(path.join(home, '.gitconfig'));
    }
  }
  if (envGet(env, 'GIT_CONFIG_NOSYSTEM') === undefined) {
    const systemOverride = envGet(env, 'GIT_CONFIG_SYSTEM');
    if (systemOverride !== undefined) out.push(systemOverride);
    // win32's system config lives under the git install, which is not knowable
    // from here: nothing is recorded (an accepted divergence).
    else if (platform !== 'win32') out.push('/etc/gitconfig');
  }
  return out;
}

function kindOf(st) {
  if (st.isFile()) return 'file';
  if (st.isDirectory()) return 'dir';
  return 'other';
}

function buildSignature(dir, env, platform) {
  let d = path.resolve(dir);
  let gitStat = null;
  for (;;) {
    gitStat = statOrMissing(path.join(d, '.git'));
    if (gitStat) break;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  const sig = { root: null, git: null, content: null, admin: null, commondir: null, configs: [] };
  const configFiles = [];
  if (gitStat) {
    const rootStat = statOrMissing(d);
    if (!rootStat) throw new Unknown();
    const gitPath = path.join(d, '.git');
    const kind = kindOf(gitStat);
    sig.root = { path: d, uid: String(rootStat.uid), ino: String(rootStat.ino) };
    sig.git = { path: gitPath, kind, ino: String(gitStat.ino), uid: String(gitStat.uid) };
    if (kind === 'file') {
      sig.git.ctime = String(gitStat.ctimeNs);
      const content = readOrMissing(gitPath);
      if (content === null) throw new Unknown();
      sig.content = content;
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(content);
      if (m) {
        const admin = path.resolve(d, m[1]);
        const adminStat = statOrMissing(admin);
        sig.admin = adminStat ? { path: admin, ino: String(adminStat.ino) } : 'missing';
        const commondirRaw = readOrMissing(path.join(admin, 'commondir'));
        sig.commondir = commondirRaw === null ? null : commondirRaw.replace(/[\r\n]+$/, '');
        const common = sig.commondir ? path.resolve(admin, sig.commondir) : admin;
        configFiles.push(path.join(common, 'config'), path.join(admin, 'config.worktree'));
      }
    } else if (kind === 'dir') {
      configFiles.push(path.join(gitPath, 'config'), path.join(gitPath, 'config.worktree'));
    }
  }
  configFiles.push(...globalAndSystemConfigs(env, platform));
  // Files reached through [include]/[includeIf] are not tracked (an accepted divergence).
  sig.configs = configFiles.map((p) => [p, configKey(p)]);
  return sig;
}

// -> the signature object, or null when it could not be computed (do not cache).
function repoSignature(dir, env = process.env, platform = process.platform) {
  try {
    return buildSignature(dir, env, platform);
  } catch (e) {
    if (e instanceof Unknown) return null;
    throw e;
  }
}

// Both signatures are built by buildSignature in the same key order.
function signatureMatches(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const memoKey = (dir, env) => `${dir}\0${envFingerprint(env)}`;

const copyAnswer = (a) => ({ repoRoot: a.repoRoot, isLinkedWorktree: a.isLinkedWorktree, indeterminate: false });

// -> { answer, signature }: `answer` is a fresh copy of the remembered result
// when the signature still matches, else null; `signature` is the one taken now
// (null when it could not be computed), for rememberRepoInfo after the spawn.
function lookupRepoInfo(dir, env = process.env) {
  const signature = repoSignature(dir, env);
  if (!signature) return { answer: null, signature: null };
  const entry = memo.get(memoKey(dir, env));
  if (entry && signatureMatches(entry.signature, signature)) {
    return { answer: copyAnswer(entry.answer), signature };
  }
  return { answer: null, signature };
}

// No-op for a null signature or an indeterminate answer: neither may be cached.
function rememberRepoInfo(dir, env, signature, answer) {
  if (!signature || !answer || answer.indeterminate) return;
  const key = memoKey(dir, env);
  memo.delete(key);
  memo.set(key, { signature, answer: copyAnswer(answer) });
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value);
}

// Tests only.
function resetMemo() {
  memo.clear();
}

module.exports = { repoSignature, signatureMatches, envFingerprint, lookupRepoInfo, rememberRepoInfo, resetMemo };
