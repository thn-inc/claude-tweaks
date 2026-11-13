'use strict';
// Template-copy git fixtures (#5297).
//
// Measured: the suite spent thousands of git processes per run rebuilding the
// same throwaway repos test after test (init, clone, config, commit, push). A
// fixture is now built once per test process, and every caller gets an
// `fs.cpSync` copy of it — a copy starts zero git processes.
//
// What makes a byte copy a working repo: git records absolute paths in a few
// plain-text files, and those are the only things that tie a copy to the
// template. `rewriteTemplatePaths` edits exactly those — every `config` inside
// a `.git` dir or a bare repo dir (remote urls, core.worktree), every
// `.git/worktrees/*/gitdir`, and every `.git` file (a linked worktree's
// pointer) — in each spelling git or the OS may have written (raw, realpath,
// Windows 8.3-expanded `realpath.native`; native, forward-slash and
// git-config-escaped `\\` forms). A listed spelling that survives throws. So does
// any visited file that still holds, in any case, the template's random names (the
// per-process root `ct-git-template-*` and the member base dir `tN-*`), so a
// separator, escaping, case or 8.3-shortened-ancestor variant the list lacks also
// fails the test loudly instead of silently sharing the template's state. Not
// caught: an 8.3 form of those random segments themselves, which no tool here makes.
//
// Timestamps are deliberately NOT preserved: copies get fresh mtimes, as a
// freshly built repo did, because some tests order worktrees by mtime. Git
// rehashes copied files anyway, since their inode and ctime differ from the
// ones recorded in the copied index.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitFixtureConfigEnv } = require('../../tools/run-tests');

let templateRoot = null;
let templateSeq = 0;
const cache = new Map(); // key -> { dirs: {name: path} }

function root() {
  if (templateRoot) return templateRoot;
  templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-template-'));
  process.on('exit', () => {
    try { fs.rmSync(templateRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  return templateRoot;
}

const fwd = (p) => p.replace(/\\/g, '/');
const esc = (p) => p.replace(/\\/g, '\\\\');
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every spelling of `from` that may appear on disk, each paired with `to`
// rendered in the same style. Longest first so alternation never prefers a
// shorter prefix.
function spellings(from, to) {
  const bases = new Set([from]);
  for (const real of [fs.realpathSync, fs.realpathSync.native]) {
    try { bases.add(real(from)); } catch { /* from need not exist */ }
  }
  const out = new Map();
  for (const base of bases) {
    out.set(base, to);
    out.set(fwd(base), fwd(to));
    out.set(esc(base), esc(to));
  }
  return out;
}

// A path spelling counts only as a whole path: not glued onto a longer name on
// either side (`/T/tpl-1` must not match `/T/tpl-10/o`).
function matcher(froms, tos) {
  const map = new Map();
  froms.forEach((f, i) => { for (const [s, t] of spellings(f, tos ? tos[i] : f)) map.set(s, t); });
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(reEscape);
  if (!alts.length) return { map, re: null };
  return { map, re: new RegExp(`(?<![\\w.~-])(?:${alts.join('|')})(?=[\\\\/"'\\s]|$)`, 'gm') };
}

function isGitDirLike(dir) {
  if (path.basename(dir) === '.git') return true;
  try {
    return fs.statSync(path.join(dir, 'HEAD')).isFile()
      && fs.statSync(path.join(dir, 'objects')).isDirectory()
      && fs.statSync(path.join(dir, 'refs')).isDirectory();
  } catch { return false; }
}

// The git path-bearing files under `dir`.
function pathFiles(dir, out = []) {
  const gitDir = isGitDirLike(dir);
  if (gitDir) {
    // A --shared/--reference clone stores absolute paths here.
    const alt = path.join(dir, 'objects', 'info', 'alternates');
    try { if (fs.statSync(alt).isFile()) out.push(alt); } catch { /* none */ }
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (gitDir && (ent.name === 'objects' || ent.name === 'refs' || ent.name === 'logs')) continue;
      pathFiles(full, out);
    } else if (ent.isFile()) {
      if (ent.name === '.git') out.push(full);
      else if (ent.name === 'config' && gitDir) out.push(full);
      else if (ent.name === 'gitdir' && path.basename(path.dirname(dir)) === 'worktrees') out.push(full);
    }
  }
  return out;
}

// Two independent nets: the known spellings (the rewrite's own list), and — so a spelling
// the list lacks (8.3-shortened ancestor, drive-letter case, doubled slash) cannot slip
// through both — a case-insensitive scan for `uniqueNames`, the spelling-free random names the template
// lives under (its per-process root and each member's base dir).
function assertNoTemplatePaths(rootDir, froms, uniqueNames = []) {
  const { re } = matcher(froms);
  const needles = uniqueNames.filter(Boolean).map((n) => n.toLowerCase());
  if (!re && !needles.length) return;
  for (const file of pathFiles(rootDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (re) re.lastIndex = 0;
    const lower = needles.length ? text.toLowerCase() : '';
    if ((re && re.test(text)) || needles.some((n) => lower.includes(n))) {
      throw new Error(`git-template: template path survived rewrite in ${file}`);
    }
  }
}

function rewriteTemplatePaths(rootDir, mapping, uniqueNames = []) {
  const froms = mapping.map(([f]) => f);
  const { map, re } = matcher(froms, mapping.map(([, t]) => t));
  if (re) {
    for (const file of pathFiles(rootDir)) {
      const text = fs.readFileSync(file, 'utf8');
      const next = text.replace(re, (m) => map.get(m));
      if (next !== text) writeInPlace(file, next);
    }
  }
  assertNoTemplatePaths(rootDir, froms, uniqueNames);
}

// Git for Windows marks a linked worktree's `.git` file hidden, and Windows refuses to recreate a
// hidden file (writeFileSync's 'w' flag fails with EPERM), so the existing file is truncated and rewritten.
function writeInPlace(file, text) {
  const fd = fs.openSync(file, 'r+');
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, text, 0, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Runs `fn` with git auto-maintenance off in process.env (appended after any
// inherited GIT_CONFIG_* entries), then restores process.env exactly. Without
// it, a detached `maintenance run --auto` started after the build's last commit
// touched `.git/objects` while the first `fs.cpSync` ran, giving ENOENT under a
// direct `node --test`. The keys come from tools/run-tests.js's gitFixtureConfigEnv, the
// same builder it uses for its children, so the two cannot drift.
function withMaintenanceOff(fn) {
  const next = gitFixtureConfigEnv(process.env);
  const names = Object.keys(next).filter((k) => next[k] !== process.env[k]);
  if (!names.length) return fn();
  const saved = names.map((k) => [k, process.env[k]]);
  for (const k of names) process.env[k] = next[k];
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function fromTemplateSet(key, build, layout) {
  const names = Object.keys(layout);
  let tpl = cache.get(key);
  if (!tpl) {
    const base = fs.mkdtempSync(path.join(root(), `t${templateSeq++}-`));
    const dirs = {};
    try {
      for (const n of names) {
        dirs[n] = path.join(base, n);
        fs.mkdirSync(dirs[n]);
      }
      withMaintenanceOff(() => build(dirs));
    } catch (err) {
      fs.rmSync(base, { recursive: true, force: true });
      throw err;
    }
    tpl = { dirs };
    cache.set(key, tpl);
  } else {
    const have = Object.keys(tpl.dirs).sort().join('\0');
    if (have !== [...names].sort().join('\0')) {
      throw new Error(`git-template: key "${key}" was built with a different layout`);
    }
  }
  const out = {};
  const mapping = [];
  try {
    for (const n of names) {
      const { parent = os.tmpdir(), prefix, realpath = false } = layout[n];
      let dir = fs.mkdtempSync(path.join(parent, prefix));
      out[n] = dir;
      fs.cpSync(tpl.dirs[n], dir, { recursive: true, preserveTimestamps: false, verbatimSymlinks: true });
      if (realpath) out[n] = dir = fs.realpathSync(dir);
      mapping.push([tpl.dirs[n], dir]);
    }
    const unique = [path.basename(root()), path.basename(path.dirname(tpl.dirs[names[0]]))];
    for (const n of names) rewriteTemplatePaths(out[n], mapping, unique);
  } catch (err) {
    for (const d of Object.values(out)) fs.rmSync(d, { recursive: true, force: true });
    throw err;
  }
  return out;
}

function fromTemplate(key, build, { parent, prefix, realpath = false }) {
  return fromTemplateSet(key, (dirs) => build(dirs.dir), { dir: { parent, prefix, realpath } }).dir;
}

// A push into a local bare origin runs git-receive-pack, which starts
// `maintenance run --auto` afterwards. git's local transport strips
// GIT_CONFIG_* from that side, so only the origin's own config can stop it.
function disableReceiveAutoGc(bareDir) {
  fs.appendFileSync(path.join(bareDir, 'config'), '[receive]\n\tautogc = false\n');
}

module.exports = { fromTemplate, fromTemplateSet, rewriteTemplatePaths, assertNoTemplatePaths, disableReceiveAutoGc };
