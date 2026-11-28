// bin/lib/hooks/repo-info-cache.js — per-process memo for worktree-detect's
// repoInfo(), validated by a filesystem signature (#5294). One hook call asked
// git the same four-flag `rev-parse` for the same directory many times over;
// the memo answers repeats from memory, but only while the signature taken now
// equals the one taken when the answer was recorded.
//
// The signature records stats only — it never derives git's answer itself
// (which is why it does not reuse the status line's commonDirFromFs, and why
// loading it costs no status-line code in every hook):
//   - dir:     the directory's own real path (path, ino, dev), so a retargeted
//              symlink, a recreated directory or a mount over it differ.
//   - root:    the directory holding the nearest `.git` (path, uid, ino)
//   - git:     that `.git` (path, kind, ino, uid; ctime only when it is a FILE —
//              a directory's ctime moves on every index.lock, which would miss
//              the cache after ordinary git activity). null when no `.git`
//              exists up to the filesystem root.
//   - content/admin: for a `.git` file, its full text and the admin dir it
//              points at (path, ino, uid, or 'missing'). A worktree removed and
//              re-added at one path is caught by the `.git` file's own ino +
//              ctime (git rewrites it).
//   - commondir: the `commondir` text of the repo's git dir (the admin dir, or
//              the `.git` directory itself: git treats either as a linked
//              worktree when it has one). The common dir derives from it.
//   - layout:  the kind or 'missing' of the git dir's HEAD and the common dir's
//              objects and refs (no times: they move on ordinary git activity),
//              so a cached positive is re-asked once git would reject the repo.
//   - enclosing: the next `.git` above the root (path, kind, ino) and the stat
//              key of that repo's index, which git's superproject check reads.
//              null when there is no enclosing repo.
//   - configs: "{mtimeNs}:{size}:{ino}" or 'missing' for the common config,
//              the git dir's config.worktree, the global config(s) and the
//              system config(s) git may read.
// Every file whose content is read must be a regular file (a named pipe would
// block the hook). Anything that cannot be looked at (an error other than
// ENOENT, or a non-regular file where text is read) makes the signature null,
// meaning "do not cache".
//
// repoInfo takes the signature BEFORE it spawns git. A change that races the
// spawn then leaves the remembered signature describing the pre-change state,
// so the next lookup mismatches and re-asks; a signature taken after the spawn
// could pair an answer about the old state with the new state's signature.
//
// The memo is keyed on uid + directory + the git-relevant environment
// (envFingerprint), since the same directory answers differently under another
// GIT_DIR or HOME, or for another user.
// A per-user JSON store (below) carries answers across processes under the same
// signature check; docs/hooks.md's "repoInfo cache" section has the contract.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../json-store');
const { canonicalRealpath } = require('../path-guard');

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

// O_NONBLOCK makes opening a named pipe return at once instead of waiting for a
// writer. win32 has no such flag (and no named pipes on a file path).
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);

// -> the text of `p`, which must be a regular file. Throws the open error
// (ENOENT when missing) or Unknown for anything else that exists. The kind is
// checked on the open descriptor, not by a stat beforehand, so a file swapped
// for a pipe between the two calls cannot block the read either.
function readRegularFile(p) {
  const fd = fs.openSync(p, OPEN_FLAGS);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Unknown();
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Reads `p` only when it is a regular file: null when missing, Unknown for
// anything else that exists. A named pipe there would block the read (and the
// hook) for ever, and a directory or device is not something git reads as text.
function readRegularOrMissing(p) {
  try {
    return readRegularFile(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw new Unknown();
  }
}

const GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;

// A `commondir` file's text without its trailing newline, or null when absent.
function readCommondir(gitDir) {
  const raw = readRegularOrMissing(path.join(gitDir, 'commondir'));
  return raw === null ? null : raw.replace(/[\r\n]+$/, '');
}

// The kind of `p`, or 'missing'. Presence and kind only: HEAD and refs change on
// ordinary git activity, so their times would miss the cache for nothing.
function kindOrMissing(p) {
  const st = statOrMissing(p);
  return st ? kindOf(st) : 'missing';
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
    // from here: nothing is recorded (an accepted divergence). Elsewhere the
    // install prefix decides it too: /etc for a distro git, and Homebrew's
    // prefixes for a Homebrew git (Apple silicon, then Intel). All three are
    // tracked; a path this git does not read only costs a miss when it changes.
    else if (platform !== 'win32') out.push('/etc/gitconfig', '/opt/homebrew/etc/gitconfig', '/usr/local/etc/gitconfig');
  }
  return out;
}

function kindOf(st) {
  if (st.isFile()) return 'file';
  if (st.isDirectory()) return 'dir';
  return 'other';
}

// The nearest repo enclosing `root` (the next `.git` on the same upward walk),
// or null. git's superproject check lists that repo's index for a gitlink at
// `root`, and a hit forces isLinkedWorktree to false, so the index is tracked
// (by its stat key) along with the `.git` entry that leads to it.
function enclosingRepo(root) {
  let e = path.dirname(root);
  if (e === root) return null;
  for (;;) {
    const gitPath = path.join(e, '.git');
    const st = statOrMissing(gitPath);
    if (st) {
      const kind = kindOf(st);
      let indexPath;
      if (kind === 'dir') {
        indexPath = path.join(gitPath, 'index');
      } else if (kind === 'file') {
        const content = readRegularOrMissing(gitPath);
        const m = content === null ? null : GITDIR_LINE.exec(content);
        if (!m) throw new Unknown();
        indexPath = path.join(path.resolve(e, m[1]), 'index');
      } else {
        throw new Unknown();
      }
      return { path: gitPath, kind, ino: String(st.ino), index: configKey(indexPath) };
    }
    const parent = path.dirname(e);
    if (parent === e) return null;
    e = parent;
  }
}

function buildSignature(dir, env, platform) {
  // git walks the real path (it chdirs into `-C`, then reads getcwd), so the
  // signature walks it too: a symlink into a repo subdirectory would otherwise
  // walk the link's own parents and never see the repo's `.git`.
  const real = canonicalRealpath(dir);
  if (!real) throw new Unknown();
  // The directory itself (ino + dev), so a symlink retargeted within one repo,
  // a directory deleted and recreated, or a volume mounted over it all differ.
  const dirStat = statOrMissing(real);
  if (!dirStat) throw new Unknown();
  let d = real;
  let gitStat = null;
  for (;;) {
    gitStat = statOrMissing(path.join(d, '.git'));
    if (gitStat) break;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  const sig = {
    dir: { path: real, ino: String(dirStat.ino), dev: String(dirStat.dev) },
    root: null, git: null, content: null, admin: null, commondir: null, layout: null, enclosing: null, configs: [],
  };
  const configFiles = [];
  if (gitStat) {
    const rootStat = statOrMissing(d);
    if (!rootStat) throw new Unknown();
    const gitPath = path.join(d, '.git');
    const kind = kindOf(gitStat);
    sig.root = { path: d, uid: String(rootStat.uid), ino: String(rootStat.ino) };
    sig.git = { path: gitPath, kind, ino: String(gitStat.ino), uid: String(gitStat.uid) };
    // The repo's own git dir: the `.git` directory, or the admin dir a `.git`
    // file points at. A `.git` file without a `gitdir:` line has none.
    let gitDir = null;
    if (kind === 'file') {
      sig.git.ctime = String(gitStat.ctimeNs);
      const content = readRegularOrMissing(gitPath);
      if (content === null) throw new Unknown();
      sig.content = content;
      const m = GITDIR_LINE.exec(content);
      if (m) {
        gitDir = path.resolve(d, m[1]);
        const adminStat = statOrMissing(gitDir);
        sig.admin = adminStat ? { path: gitDir, ino: String(adminStat.ino), uid: String(adminStat.uid) } : 'missing';
      }
    } else if (kind === 'dir') {
      gitDir = gitPath;
    }
    if (gitDir) {
      // git treats any git dir with a `commondir` as a linked worktree, a
      // `.git` directory included, and takes its common dir from it.
      sig.commondir = readCommondir(gitDir);
      const common = sig.commondir ? path.resolve(gitDir, sig.commondir) : gitDir;
      // What git checks before it accepts a git dir. Without these, a cached
      // positive would outlive git starting to reject the repo.
      sig.layout = {
        head: kindOrMissing(path.join(gitDir, 'HEAD')),
        objects: kindOrMissing(path.join(common, 'objects')),
        refs: kindOrMissing(path.join(common, 'refs')),
      };
      configFiles.push(path.join(common, 'config'), path.join(gitDir, 'config.worktree'));
    }
    sig.enclosing = enclosingRepo(d);
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

// The process uid is part of every key: git's ownership check (safe.directory)
// depends on it, and a `sudo` run that keeps HOME reads the same store file.
const currentUid = () => (typeof process.getuid === 'function' ? process.getuid() : null);

const memoKey = (dir, env, uid) => `${uid}\0${dir}\0${envFingerprint(env)}`;

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
  if (override && path.isAbsolute(override)) return override;
  return path.join(os.homedir(), '.claude-tweaks', 'repo-info-cache.json');
}

function storeBypassed(env = process.env) {
  // A relative override would resolve against each hook's cwd and drop store
  // files into project directories. Whoever set it wanted another store than
  // the user's own, so the store is off for this process rather than falling
  // back to the real one.
  const override = envGet(env, 'CT_HOOKS_REPO_INFO_STORE');
  if (override && !path.isAbsolute(override)) return true;
  return DISCOVERY_ENV_NAMES.some((name) => envGet(env, name) !== undefined);
}

const storeKey = (dir, env, uid) => crypto.createHash('sha1').update(memoKey(dir, env, uid)).digest('hex');

// A hit refreshes its entry's `at` (so eviction drops the least recently used),
// but writes at most once per this many ms per entry.
const TOUCH_INTERVAL_MS = 60 * 1000;

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
  // Only a regular file is read: a named pipe at the store path would block
  // the read for ever, and a directory or device is not a store.
  const raw = readJsonFile(storePath(env), { readFile: readRegularFile, fallback: null });
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION || !isPlainObject(raw.entries)) return null;
  return raw.entries;
}

// The store holds which directories a user works in, so it is created
// readable by its owner only. Every write replaces the file with a temp file
// (json-store.js). `mode` applies only when that temp file is created, and a
// temp file left under this pid's name by a killed writer keeps its own mode,
// so the mode is set again after the write.
const writeOwnerOnly = (p, content) => {
  fs.writeFileSync(p, content, { mode: 0o600 });
  fs.chmodSync(p, 0o600);
};

function storeWrite(env, entries) {
  writeJsonFile(storePath(env), { version: STORE_VERSION, entries }, { writeFile: writeOwnerOnly });
}

function storeLookup(dir, env, signature, uid) {
  try {
    const entries = readStoreEntries(env);
    const key = storeKey(dir, env, uid);
    const entry = entries && entries[key];
    // The answer must also agree with the signature, as rememberRepoInfo
    // required: an edited entry must not name a root the signature does not.
    if (validEntry(entry) && signatureMatches(entry.signature, signature) && answerMatchesSignature(signature, entry.answer)) {
      if (Date.now() - entry.at > TOUCH_INTERVAL_MS) storeTouch(env, key);
      return entry.answer;
    }
  } catch (_) {
    // a broken store is a miss
  }
  return null;
}

// Refreshes one entry's `at`, re-reading first so a sibling's entries are kept.
function storeTouch(env, key) {
  try {
    const entries = readStoreEntries(env);
    if (!entries || !validEntry(entries[key])) return;
    entries[key].at = Date.now();
    storeWrite(env, entries);
  } catch (_) {
    // a failed refresh only costs recency
  }
}

function storeRemember(dir, env, signature, answer, uid) {
  try {
    // Re-read so entries a sibling process wrote meanwhile are kept.
    const entries = readStoreEntries(env) || {};
    const key = storeKey(dir, env, uid);
    delete entries[key]; // delete then set: insertion order tracks recency
    entries[key] = { answer: { repoRoot: answer.repoRoot, isLinkedWorktree: answer.isLinkedWorktree }, signature, at: Date.now() };
    const keys = Object.keys(entries);
    const excess = keys.length - MAX_STORE_ENTRIES;
    if (excess > 0) {
      // Lowest `at` first; the sort is stable, so ties go earliest-inserted first.
      const oldest = keys.slice().sort((a, b) => (Number(entries[a] && entries[a].at) || 0) - (Number(entries[b] && entries[b].at) || 0));
      for (const k of oldest.slice(0, excess)) delete entries[k];
    }
    storeWrite(env, entries);
  } catch (_) {
    // the answer returned is the one git gave
  }
}

// -> { answer, signature }: `answer` is a fresh copy of the remembered result
// when the signature still matches, else null; `signature` is the one taken now
// (null when it could not be computed), for rememberRepoInfo after the spawn.
function lookupRepoInfo(dir, env = process.env, uid = currentUid()) {
  const signature = repoSignature(dir, env);
  if (!signature) return { answer: null, signature: null };
  const key = memoKey(dir, env, uid);
  const entry = memo.get(key);
  if (entry && signatureMatches(entry.signature, signature)) {
    return { answer: copyAnswer(entry.answer), signature };
  }
  if (!storeBypassed(env)) {
    const stored = storeLookup(dir, env, signature, uid);
    if (stored) {
      memoSet(key, signature, stored);
      return { answer: copyAnswer(stored), signature };
    }
  }
  return { answer: null, signature };
}

// Whether git's answer is the one the signature describes. A `.git` git rejects
// makes git answer "not a repo", or fall through to an enclosing repo, while the
// signature tracks that `.git`. The layout tracks only presence and kind, so a
// repair that changes neither (a HEAD rewritten from garbage, say) would go
// unseen: such an answer must not be cached.
function answerMatchesSignature(signature, answer) {
  if (!answer.repoRoot) return !signature.git;
  return Boolean(signature.root) && canonicalRealpath(answer.repoRoot) === signature.root.path;
}

// No-op for a null signature, an indeterminate answer, or an answer the
// signature does not describe: none may be cached.
function rememberRepoInfo(dir, env, signature, answer, uid = currentUid()) {
  if (!signature || !answer || answer.indeterminate) return;
  if (!answerMatchesSignature(signature, answer)) return;
  memoSet(memoKey(dir, env, uid), signature, answer);
  if (!storeBypassed(env)) storeRemember(dir, env, signature, answer, uid);
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
