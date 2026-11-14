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
//              it points at (path, ino, uid, or 'missing'), and that admin dir's
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
// A per-user JSON store (below) carries answers across processes under the same
// signature check; docs/hooks.md's "repoInfo cache" section has the contract.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../json-store');

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
    // An empty HOME is unset. git for Windows falls back to USERPROFILE for
    // ~/.gitconfig, and reads $XDG_CONFIG_HOME/git/config whenever it is set.
    const home = envGet(env, 'HOME');
    const xdg = envGet(env, 'XDG_CONFIG_HOME');
    if (xdg) out.push(path.join(xdg, 'git', 'config'));
    else if (home) out.push(path.join(home, '.config', 'git', 'config'));
    const gitHome = home || envGet(env, 'USERPROFILE');
    if (gitHome) out.push(path.join(gitHome, '.gitconfig'));
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
        sig.admin = adminStat ? { path: admin, ino: String(adminStat.ino), uid: String(adminStat.uid) } : 'missing';
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

function memoSet(key, signature, answer) {
  memo.delete(key);
  memo.set(key, { signature, answer: copyAnswer(answer) });
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value);
}

// ---- Cross-process store (#5294) -------------------------------------------
// One small per-user JSON file so a fresh hook process skips the git spawn too.
// Entries are keyed on directory + envFingerprint and validated by the same
// signature as the memo. Every store error is swallowed: a broken store never
// breaks a session or changes a verdict, the answer is simply git's own.
const MAX_STORE_ENTRIES = 200;
const STORE_VERSION = 1;

// Env names that make git discover a repo by something other than the
// directory, so a stored answer for the directory would be wrong (or the
// signature blind to it). Present-even-empty counts; the in-process memo stays.
const DISCOVERY_ENV_NAMES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];

// Read on every call, never captured at load, so a test's env change takes effect.
function storePath(env = process.env) {
  const override = envGet(env, 'CT_HOOKS_REPO_INFO_STORE');
  if (override) return override;
  return path.join(os.homedir(), '.claude-tweaks', 'repo-info-cache.json');
}

function storeBypassed(env = process.env) {
  return DISCOVERY_ENV_NAMES.some((name) => envGet(env, name) !== undefined);
}

const storeKey = (dir, env) => crypto.createHash('sha1').update(`${dir}\0${envFingerprint(env)}`).digest('hex');

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validEntry(e) {
  return isPlainObject(e)
    && isPlainObject(e.answer)
    && (e.answer.repoRoot === null || typeof e.answer.repoRoot === 'string')
    && typeof e.answer.isLinkedWorktree === 'boolean'
    && isPlainObject(e.signature)
    && typeof e.at === 'number' && Number.isFinite(e.at);
}

// -> the store's entries object, or null when absent/unreadable/not our format.
function readStoreEntries(env) {
  const raw = readJsonFile(storePath(env), { fallback: null });
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION || !isPlainObject(raw.entries)) return null;
  return raw.entries;
}

function storeLookup(dir, env, signature) {
  try {
    const entries = readStoreEntries(env);
    const entry = entries && entries[storeKey(dir, env)];
    if (validEntry(entry) && signatureMatches(entry.signature, signature)) return entry.answer;
  } catch (_) {
    // a broken store is a miss
  }
  return null;
}

function storeRemember(dir, env, signature, answer) {
  try {
    // Re-read so entries a sibling process wrote meanwhile are kept.
    const entries = readStoreEntries(env) || {};
    const key = storeKey(dir, env);
    delete entries[key]; // delete then set: insertion order tracks recency
    entries[key] = { answer: { repoRoot: answer.repoRoot, isLinkedWorktree: answer.isLinkedWorktree }, signature, at: Date.now() };
    const keys = Object.keys(entries);
    const excess = keys.length - MAX_STORE_ENTRIES;
    if (excess > 0) {
      // Lowest `at` first; the sort is stable, so ties go earliest-inserted first.
      const oldest = keys.slice().sort((a, b) => (Number(entries[a] && entries[a].at) || 0) - (Number(entries[b] && entries[b].at) || 0));
      for (const k of oldest.slice(0, excess)) delete entries[k];
    }
    writeJsonFile(storePath(env), { version: STORE_VERSION, entries });
  } catch (_) {
    // the answer returned is the one git gave
  }
}

// -> { answer, signature }: `answer` is a fresh copy of the remembered result
// when the signature still matches, else null; `signature` is the one taken now
// (null when it could not be computed), for rememberRepoInfo after the spawn.
function lookupRepoInfo(dir, env = process.env) {
  const signature = repoSignature(dir, env);
  if (!signature) return { answer: null, signature: null };
  const key = memoKey(dir, env);
  const entry = memo.get(key);
  if (entry && signatureMatches(entry.signature, signature)) {
    return { answer: copyAnswer(entry.answer), signature };
  }
  if (!storeBypassed(env)) {
    const stored = storeLookup(dir, env, signature);
    if (stored) {
      memoSet(key, signature, stored);
      return { answer: copyAnswer(stored), signature };
    }
  }
  return { answer: null, signature };
}

// No-op for a null signature or an indeterminate answer: neither may be cached.
function rememberRepoInfo(dir, env, signature, answer) {
  if (!signature || !answer || answer.indeterminate) return;
  memoSet(memoKey(dir, env), signature, answer);
  if (!storeBypassed(env)) storeRemember(dir, env, signature, answer);
}

// Tests only. A test that fakes git's output or failure (a mocked execFileSync)
// must isolate the cache first — tests/helpers/repo-info-cache.js's
// isolateRepoInfoCache(t) — or a remembered answer, in memory or in the store,
// answers instead of the fake.
function resetMemo() {
  memo.clear();
}

module.exports = {
  repoSignature, signatureMatches, envFingerprint, lookupRepoInfo, rememberRepoInfo, resetMemo,
  storePath, storeBypassed, MAX_STORE_ENTRIES,
};
